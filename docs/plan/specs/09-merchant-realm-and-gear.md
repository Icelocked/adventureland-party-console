# 09. Merchant realm and gear

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e) in (local checkout). Every file:line is on that ref unless it says "fork HEAD" (af92de45). The fork's live tip 21b8362d changes no code in this part: `git diff --stat af92de45 21b8362d` in pm-worktrees/pta-pull lists 17 files, all escape, pull, heal, October event and test code (characters/shared.js hunks at 68 and 18435-18962).

Short paths: bare `x.ts:N` paths are under runtime/coordinator/. `roster/` is runtime/roster/, `steam/` is runtime/steam/, `tools/steam/` is tools/steam/. Game server lines (server.js, server_functions.js, js/) are in the local clone (local checkout) (kaansoral/adventureland_mongodb 43b2c8fc), under node/ unless they start with js/.

This spec maps which realm the merchant is on and what it holds. It covers every writer of
the merchant's realm (party realm switch, party-visit realm check, job-owned realm hops, home
return, realm pause, Steam window handoff and page restarts), the roster that says which character
runs where, the merchant's hands (gathering tools, the coordinator's weapon intent, manual equip,
re-equip after gathering), and the game call budget: the server disconnects a socket whose calls
cost more than 200 in 4 s.

Jobs and how gathering yields are in [08](08-merchant-jobs.md). Items, bank and markets are in
[10](10-inventory-bank-commerce.md). Spec 10's executors make the bank and Ponty calls that cost the most.
This spec lists their costs so the budget is in one place.

Counts: 28 behaviours and 385 functions in `catalog/09-merchant-realm-and-gear.json` (counted with `node -e` over that file); 2 handoffs in `catalog/handoffs-09.json`.

How this map was made: four readers went through every function in this part on the current console (shared.js by its current line ranges, every other file start to end) and checked the full review (local checkout) and the first pass `review/merchant.md` claim by claim. Section 7 lists each review claim with its verdict. Line numbers in the full review are mostly fork HEAD lines; this spec gives current lines. A second check on 2026-10-26 opened every citation again; its log is `docs/implementation/07-verification-08-10.md`.

## 1. What it does today

### Party realm

**MRG-001 Switch the whole party to another realm.** The dashboard realm control moves every assigned character to one realm, then makes it the party realm and resumes merchant work.

Rules:

- POST /party-api/realm/switch rejects an unknown realm (400), any PVP realm (409), a switch already in phase switching or setting-home, and a running BankBoi transaction (runtime/coordinator/http/realms.ts:92-109)
- the route needs at least one assigned participant, every participant needs a status no older than 10 s, and a Steam participant needs a connected native owner (realms.ts:72-91)
- start stores the operation in state.realmSwitch and runs it without awaiting (realms.ts:43-71)
- depart pauses the merchant job, retires convoys that include a participant, deletes every participant command, sets block.realm to the destination and stops each enabled headless participant, and sends native-realm-switch to the Steam native owner only when its status realm differs (characters/realm-switch.ts:75-94)
- arrived counts a status seen after the operation start, within the last 10 s and at most 500 ms in the future, on the destination (realm-switch.ts:59-65)
- awaitArrival polls every 500 ms; the progress deadline is 60 s and renews by 60 s once per newly arrived participant; the hard deadline is 60 s per participant (realm-switch.ts:100-119)
- finish is the only runtime writer of activeRealm (setActiveRealm, realm-composition.ts:53-55, called at realm-switch.ts:249) and calls dispatchMerchant at the end (realm-switch.ts:268)
- on any error run marks the operation failed and clears commands only for homeExecutors; it leaves block.realm on the destination and does not call dispatchMerchant (realm-switch.ts:294-302). activeRealm keeps the old realm when the failure comes before finish; a setHome failure inside finish comes after setActiveRealm (realm-switch.ts:249, 256-261), so activeRealm already names the destination
- a replaced operation (state.realmSwitch !== operation) exits without touching commands (realm-composition.ts:36, realm-switch.ts:96-98, 289, 296)
- while an operation in switching or setting-home lists the merchant as a participant or home target, dispatchMerchant and dispatchMerchantIdle return at once (application.ts:1662, 1681, 1699-1701; realm-switch.ts:308-311)

Settings:

- state.activeRealm: loaded from the save or configuredRealm (initial-core.ts:29); runtime writer only setActiveRealm (realm-composition.ts:54); readers include home-recovery.ts:45, 55, 65, 85-88, 106, 145-147, merchant-realms.ts:75, ownership.ts:167, bids.ts:113, manual-orders.ts:70, 129, commands.ts:69, automation-composition.ts:59, dispatch-composition.ts:105, 150, idle-composition.ts:61, merchant-control.ts:136, navigation/manual-commands.ts:123, characters/migrate-selections.ts:30, roster-projection.ts:149
- state.realmSwitch: the current operation (realms.ts:67)

**MRG-002 Set the account home realm with a party switch.** With setHome, every participant and every other account character sets its home to the new realm; offline characters log in briefly to do it.

Rules:

- setHome refreshes the account before checking participants and re-checks conflicts after the await (realms.ts:110-118)
- assignHomeExecutor marks a participant already homed on the destination as confirmed and sends realm-set-home to the rest (realm-switch.ts:121-137)
- the character respawns if dead, walks to main 74,-34, calls set_home, waits 500 ms and posts /realm/home-complete (characters/shared.js:10970-10990)
- homeComplete accepts only the current operation in phase setting-home from a listed executor; confirmHome refreshes the account every 500 ms for up to 30 s and trusts a status home only when the status is under 5 s old and on the destination (realms.ts:29-40, 127-170)
- waitHome waits up to 120 s (realm-switch.ts:139-147); confirmAccountHomes polls the account until the 120 s deadline set at finish (realm-switch.ts:257, 270-279)
- offlineHomes logs in each account character outside the participants whose home differs, one at a time; it suspends the incumbent headless merchant when an offline merchant must log in, or a headless participant when 4 connections are in use, and refuses to replace a Steam session (realm-switch.ts:202-246)
- visitHome refuses a character that already has an instance, sets block.realm to the destination for the visit, waits up to 60 s for a fresh arrival (freshArrival, realm-switch.ts:167-172), and restores enabled and realm afterwards (realm-switch.ts:174-197)

**MRG-003 Put the merchant job back at the queue head during a party switch.** When a party realm switch starts, the merchant drops its running job and the same job goes to the front of the queue without its progress fields.

Rules:

- pauseMerchantForRealm copies the current job, keeps queuedAt (or now), deletes phase, startedAt, heartbeatAt, progressAt and handoff, unshifts it, releases a merchant convoy interruption and clears merchantCurrent (merchant/realm-pause.ts:9-26)
- the copy keeps homeRealm, realm and listings from queue time (realm-pause.ts:20), so a resumed commerce job still ends on the old home realm (problem 'stale homeRealm')

### Merchant realm moves

**MRG-004 Move a headless merchant to a target on another realm.** For a delivery or service whose target character is on another realm, the console reconnects a headless merchant on that realm and then runs the job.

Rules:

- blockedReason: realmRetryExhausted blocks with 'Merchant realm switch failed; manual retry required'; both statuses must be under 10 s old and carry a server; a realm mismatch with a Steam merchant blocks with 'merchant job failed: wrong realm' (merchant/party-realm.ts:22-38)
- eligibility skips jobs that target the merchant and logs a new realmError once (party-realm.ts:39-49); the merchant status reply carries merchantRealmErrors for queued jobs with realmError (status/response.ts:289-292)
- begin runs only for a headless merchant when the target realm differs (party-realm.ts:62-65; headless port application.ts:357)
- the travel port clears merchantHomeReturnAt, deletes the merchant command, sets block.realm, block.pendingRealm and a request {owner:'job', attempts:1}, persists and soft-kills the worker (application.ts:358-368)
- advance re-queues the job at the head once a merchant status newer than the start shows the destination and the target is fresh; a target that moved fails the attempt; 60 s without arrival fails it (party-realm.ts:77-103)
- fail counts realmAttempts, sets realmRetryExhausted at 3, sets retryAt now + 10 s and pushes the job to the queue tail (party-realm.ts:50-61)
- the job request stays until worker setup sees the arrival and deletes it (worker-setup.ts:43-56), or a later ensureHome replaces it with a home request (home-recovery.ts:84-89, 123)

Settings:

- job.realmAttempts, realmRetryExhausted, realmBlockedReason, realmError: writers party-realm.ts:43-47, 53-55; cleared by merchant-control.ts:41-45

Handed over by other specs: 1 function (02-movement).

**MRG-005 Hop realms inside a commerce or giveaway job.** Ponty, ALData buy, ALData sell and giveaway jobs ask the console to reconnect the merchant on the listing realm; Ponty and ALData buy hop back to the job home realm at the end.

Rules:

- the route accepts a hop only when the current job id matches, the reason is 'ALData marketplace purchases', 'ALData marketplace sales', 'join giveaway' or 'Ponty purchases', and the caller is the merchant (http/merchant-realms.ts:24-33, 43-44)
- it accepts any realm that resolves; it answers alreadyThere when block.realm equals the realm and the block is connected (merchant-realms.ts:45-49)
- it sets block.realm, records {owner:'job', attempts:1}, sets job phase 'switching realm', and stops the worker 150 ms later (merchant-realms.ts:50-67, merchant-job-actions.ts:42)
- four character copies of currentRealm and changeRealm: merchantPontyBuy (shared.js:8592-8598) skips the wait on alreadyThere; merchantJoinGiveaway (8708-8716), merchantALDataBuy (8825-8832) and merchantALDataSell (8969-8976) always wait and default a missing region to US and identifier to II
- Ponty hops to each listing realm (8610-8612) and back to aldataHomeRealm at the end (8660); ALData buy hops home for a gold shortfall (8851), to each listing realm (8858-8859) and home at the end (8929-8930); ALData sell hops to the order realm (8991); giveaway refuses PVP and hops to command.realm (8728-8730). Sell and giveaway do not hop back; their completion calls ensureHome (completion.ts:62-63)
- aldataHomeRealm is job.homeRealm or, when missing, the current activeRealm, for the three marketplace reasons only (merchant/commands.ts:57-69)

**MRG-027 Wire the merchant job report routes.** One composition builds the progress, marketplace, cluster, realm and seller location routes the merchant reports to, sharing the live command sequence and a deferred worker restart.

Rules:

- createCoordinatorMerchantJobActions builds the five route groups; cluster routes take nextCommand from state.nextCommandId, and realm routes take a restart that stops the block after a delay (http/merchant-job-actions.ts:30-52)
- the seller location route fetches /merchants from ALData and normalizes it as purchases or sales (merchant-job-actions.ts:44-50)
- the coordinator passes now, persist, log, resolve, block, stop, later and the ALData fetch ports (application.ts:843-870)

**MRG-006 Return the merchant to the party realm before home work.** Before gathering, stand time or any home-needing job, the console makes sure the merchant is connected on the party realm, and reconnects it there when not.

Rules:

- five reasons skip the home check: ALData purchases, ALData sales, join giveaway, Ponty purchases, stand maintenance (merchant/home-recovery.ts:28-36)
- callers: dispatcher gatherBefore (dispatcher.ts:136), available while returning (242), dispatchJob for the merchant own home jobs (301), idle homeReady (idle.ts:124-131), WTB and giveaway completion (completion.ts:62-63)
- ensureMerchantHome passes through only when a request with owner 'home' exists or the merchant runtime (native for a Steam member, headless in a slot) reported within 10 s (application.ts:1635-1655)
- arrival with a request needs block.realm == activeRealm and a status newer than requestedAt, at most 3 s old, on activeRealm (home-recovery.ts:43-49, characters/realm-request.ts:10-13); arrival clears merchantHomeReturnAt, the request and pendingRealm (home-recovery.ts:77-83)
- with no request, arrival needs a status at most 3 s old on activeRealm (home-recovery.ts:47-56); a living connected merchant on activeRealm whose status is under 15 s old holds work without a return (home-recovery.ts:63-76, 121)
- a job-owned request younger than 60 s while a job runs blocks the return (home-recovery.ts:122)
- attemptReturn sends the first attempt at once and later ones 60 s apart, and marks the request exhausted after 3 attempts with an error log (home-recovery.ts:91-111); each attempt sets block.realm, pendingRealm and merchantHomeReturnAt, deletes the merchant command and restarts after 150 ms
- the restart port writes native-realm-switch into the slot of a merchant whose status runtime is native, and stops the headless block otherwise (automation-composition.ts:55-65)
- dispatcher ready tags home jobs 'Merchant realm return failed after 3 attempts; manual retry required' while home is blocked (dispatcher.ts:115-121; homeBlocked at dispatch-composition.ts:150)
- character side: merchantIdle takes command.homeRealm (activeRealm at issue, idle.ts:169), posts /merchant/ensure-home-realm when its live realm differs, and waits for the restart (shared.js:9477-9486); the route accepts only realm == activeRealm, records {owner:'home', attempts:1} and stops the worker after 150 ms (merchant-realms.ts:69-89)
- Force stand pauses work, deletes the merchant command, sets block.realm, records {owner:'home', attempts:1}, sets merchantHomeReturnAt and stops the headless block after 100 ms (merchant-control.ts:128-136, merchant-actions.ts:42-49)
- dashboard retry deletes the request, clears merchantHomeReturnAt, deletes realmRetryExhausted, realmBlockedReason and realmError, resets realmAttempts and retryAt to 0, then dispatches (merchant-control.ts:36-48)

Settings:

- state.merchantRealmRequests[merchant] {realm, owner home|job, requestedAt, attempts, exhausted}: writers application.ts:365, merchant-realms.ts:51, 80, merchant-actions.ts:45, home-recovery.ts:87-89, 146; deleters home-recovery.ts:80, merchant-control.ts:39, worker-setup.ts:35, 48
- state.merchantHomeReturnAt: writers home-recovery.ts:78, 86, 92, 97, 105, 149, application.ts:362, merchant-actions.ts:47, merchant-control.ts:40; reader dispatch-composition.ts:146
- state.merchantForceStand: writer merchant-control.ts:131; loaded at merchant/initial-runtime.ts:50; readers dispatch-composition.ts:156, idle-composition.ts:40, shared.js:11336

Handed over by other specs: 1 function (02-movement).

**MRG-007 Abandon a stalled WTB sale and go home.** The console stops an ALData sale that runs for 3 minutes and does not retry it. It then sends the merchant back to the party realm.

Rules:

- a 1 s interval calls recoverStalledSale unless a console update runs (application.ts:489-493)
- stalledSale: reason 'ALData marketplace sales' and startedAt at least 180000 ms ago (home-recovery.ts:127-130)
- it clears merchantCurrent and the merchant command, sets block.realm, records {owner:'home', attempts:1} as request and pendingRealm, logs an error and restarts after 100 ms through the restart port, which writes native-realm-switch for a Steam merchant (home-recovery.ts:134-160; automation-composition.ts:55-65)

**MRG-008 Retire the old runtime after a realm request.** After the console agrees to a realm change, the Steam page navigates to the new realm and the old runtime waits forever so it does no more work.

Rules:

- awaitRealmRestart navigates the Steam window to /character/<name>/in/<region>/<server>/ keeping only the no_html, is_bot and code query fields, and never resolves (shared.js:8567-8587)
- on caracAL it only waits; the coordinator restart replaces the runtime (shared.js:8579-8586)
- native-realm-switch uses the same path builder and refuses on caracAL (shared.js:10963-10969)

Handed over by other specs: 1 function (02-movement).

### Roster and connections

**MRG-009 Choose the realm a headless worker connects to.** When a headless character starts, the console picks its realm from a running party switch, a pending merchant realm request, the running worker, or the account home.

Rules:

- a running party switch that lists the character as participant or home target wins and deletes its merchant request (characters/worker-setup.ts:30-42)
- then an unfulfilled request that is not exhausted; requestedRealm deletes an arrived request (worker-setup.ts:43-57)
- then block.realm while an instance runs, then the account home, then configuredRealm (worker-setup.ts:58-63)
- homeRealm prefers the realm every account character shares, then the character own home (application.ts:985-988, 1248-1250, roster-projection.ts:77-82)
- the character manager resolves realms through the account source (characters/composition.ts:78)

Handed over by other specs: 2 functions (07-hunts-and-farming, 11-settings).

**MRG-010 Show realms, homes and slots on the dashboard.** The dashboard realm panel lists the party realm, the realm the fighters share, every home, the merchant realm and the server list.

Rules:

- characterHome prefers a status home seen within 5 s, then the account home (roster-projection.ts:69-76)
- control sets currentRealm only when the non-merchant participants that report a realm (15 s cutoff) all report one realm; split is true for more than one (roster-projection.ts:136-161)
- slots: Steam members first (primary index 0), then occupied headless slots, then empty slots up to 4 in total (roster-projection.ts:91-105)
- initial slots keep saved headlessSlots (first 4) or take up to 3 enabled workers; Steam membership falls back to the legacy nativeOwner (initial-roster.ts:15-49)

Settings:

- state.headlessSlots, steamMembers, nativeOwner, steamSwitch: loaded by initial-roster.ts:15-49

Handed over by other specs: 1 function (11-settings).

**MRG-011 Fence roster changes while characters are busy.** Steam and headless handoffs refuse to start while a character is banking, stocking, upgrading, in a BankBoi transaction, or while the merchant is mid party-visit realm switch.

Rules:

- busy: a BankBoi transaction, a banking, stocking or upgrading flag in a status under 5 s old, or the merchant in 'switching party realm' started within 60 s (characters/ownership.ts:79-81, 142-152)
- validateParticipants refuses duplicates, more than 4 characters, a BankBoi transaction and any busy character (ownership.ts:176-181)
- confirmOffline needs two account reads showing offline 500 ms apart, within 8 attempts 1 s apart (ownership.ts:115-127)
- prepareSteam releases BankBoi before the merchant joins Steam (ownership.ts:162-165)

**MRG-026 Back the roster routes with coordinator state.** The roster routes read and write Steam members, headless slots, the native owner and the handoff through accessors on the coordinator state, and get readiness, realm and worker control through ports.

Rules:

- coordinatorOwnership maps steam, slots, native and handoff onto steamMembers, headlessSlots, nativeOwner and steamSwitch (ownership.ts:50-77)
- headless and native readiness need a matching runtime in a status under 5 s old (ownership.ts:134-136, 159-160); the bridge port itself always answers not ready (158)
- realm() is activeRealm or configuredRealm; realmContext gives the Steam primary observed realm (status under 5 s) and account home (ownership.ts:137-141, 167-173)
- stopHeadless disables the block, marks it stopping, stops it and marks it offline; startHeadless assigns the slot (ownership.ts:182-190)

Handed over by other specs: 1 function (13-lifecycle).

### Steam window

**MRG-012 Track which character the Steam window runs.** The Steam window posts every second; the console keeps a lease on that window and records its character, realm and running companions.

Rules:

- a lease is ready for 8 s after a post; another client cannot take it while ready unless the lease has no character and the new post reconnects a running owned character with no handoff, a complete one, or a logout (roster/bridge-session.ts:38, 47-59)
- currentRealm is the posted realm only for a version 2 bridge whose character is the native owner (bridge-session.ts:40-42, 73-74)
- a new connected CODE session completes a pending logout and rebuilds the Steam group (roster/logout-recovery.ts:3-34)

**MRG-028 Report each Steam character's connection state.** The bridge sends one observation per owned character, and the console turns it into a connection state for the dashboard.

Rules:

- connection observations keep since for an unchanged state (roster/connection-status.ts:15-24)
- a fresh heartbeat of the right runtime makes a character connected; otherwise the state becomes lost 8 s after the last observation, and delayed when the state has not been connected for 30 s (connection-status.ts:25-38)
- the bridge receive passes the parsed observations to the ownership port (bridge-session.ts:71; ownership.ts:175)

**MRG-013 Move one character between Steam and headless (legacy path).** The older one-character handoff stops the target headless worker, confirms both characters offline, then has the Steam window log the target in.

Rules:

- begin needs no pending handoff, a ready bridge, and an owned target that differs from the native owner (roster/handoff.ts:93-104)
- release waits for confirmOffline of the old native, moves the headless slot and starts the old native headless (handoff.ts:137-149, 177-192)
- expire fails a handoff after 90 s in one phase unless it is complete, failed or preparing (handoff.ts:254-262); a coordinator restart fails any handoff that is not complete, failed or awaiting a realm choice (roster/routes.ts:64-69)
- the bridge navigates the single handoff target to reply.realm, which is activeRealm or configuredRealm (steam/bridge.ts:321-323, routes.ts:152, ownership.ts:167)

**MRG-014 Change the Steam character group.** Primary, login, headless and logout actions change the set of characters the Steam window runs; one operation owns the whole set.

Rules:

- begin caps participants at 4 and asks for a realm choice when it adds a character while the primary current realm differs from its home or either is unknown (roster/steam-group.ts:28-65)
- destinationRealm is the primary current realm, else its home; choosing switch uses home and releases the whole group (steam-group.ts:63, 76-77)
- refreshRealmChoice continues once current equals home (steam-group.ts:82-95)
- observe completes the operation when every desired character runs on destinationRealm (observed since releasedAt) and the primary matches (steam-group.ts:158-166)
- an operation that is not complete, failed or awaiting a realm choice fails 180 s after its start (steam-group.ts:181-183); recover clears only affected characters after confirmOffline (steam-group.ts:193-218)

**MRG-015 Steam and slot HTTP routes.** The dashboard and the Steam window use these routes to move characters in and out of Steam and headless slots.

Rules:

- every route except /bridge is exclusive; a second call gets 409 (roster/routes.ts:70-85)
- needsRealmChoice: login or primary while a native owner exists, except restoring a single-member group, and only when the primary's current realm is unknown or differs from its home (routes.ts:112-117)
- a 1 s interval expires the group or single handoff (routes.ts:210-212)
- the bridge reply carries operation, realm (activeRealm or configuredRealm), primary, steam and member hosting (routes.ts:150-156)

**MRG-016 Run the bridge inside the Steam game window.** A script in the Steam game window posts state every second, saves the managed CODE bootstrap, releases characters and navigates to the destination realm.

Rules:

- poll posts version 2 state 1000 ms after each reply with a 10 s request timeout (steam/bridge.ts:142-152, 336-367)
- navigate accepts only US, EU and ASIA realms I to V and PVP, and sets location.href (bridge.ts:229-241)
- group navigate goes to destinationRealm, else reply.realm, when the window is not the primary, is disconnected or is on another realm (bridge.ts:287-293)
- companions start only after the earlier group members arrived (bridge.ts:242-247, 294-313)
- a Steam member missing for 8 s makes the bridge post /steam/restore (bridge.ts:254-263)
- ensureBootstrap uses a numbered CODE slot 1 to 100 and never overwrites an unknown saved slot (bridge.ts:154-203)
- characters/steam-bridge.js is the generated bundle of these sources (its line 1). The committed copy carries steamBridgeVersion 12 (steam-bridge.js:178) while runtime/steam/connection.ts:6 says 14; the Docker build regenerates the file (Dockerfile:14; tools/build-runtime.mts:25, 46-47)

Settings:

- sessionStorage party-console-steam-release-v1, localStorage party-console-steam-operation-v1 and party-console-bootstrap-slot-v1 (bridge.ts:23-25)

**MRG-017 Ask which realm to use before adding a Steam character.** When the Steam window is away from its home realm, a dialog asks to switch to home, stay, or cancel before it logs in another character.

Rules:

- the dialog is rebuilt only when the operation id or realm context changes; a poll with the same pair keeps it (steam/realm-choice.ts:28-36)
- switch and stay appear only when both realms are known and differ; cancel always appears; Escape submits cancel (realm-choice.ts:65-89)

**MRG-018 Restart a stale CODE runner in the Steam window.** When a Steam character CODE status is 20 s stale, the window restarts its CODE runner with the managed bootstrap.

Rules:

- stale: past the next try, routine not occupied, and CODE inactive or last healthy status 20000 ms old (steam/recovery.ts:29-33)
- restart backs off 5 s, 10 s, 20 s, then 30 s, and calls start_runner('maincode', bootstrap) (recovery.ts:122-134)
- recovery runs only for owned characters that were not deliberately stopped, while the socket is connected and no native logout click was seen (recovery.ts:68-90)
- trusted clicks or key presses that call start_runner or stop_runner set party-code-stopped:<name> (recovery.ts:43-66)

Settings:

- localStorage party-code-stopped:<name> (recovery.ts:17-20)

**MRG-019 Steam character panel.** A panel in the Steam window lists characters with buttons to make primary, run headless, log in and log out.

Rules:

- the panel refuses a login at 4 hosted characters; the other actions ask for confirmation (steam/switcher.ts:163-206)
- order: primary, Steam, headless, merchant last unless primary (roster/character-order.ts:2-24)
- the movement-click gate blocks on_map_click when enabled (switcher.ts:22-30); this control and the audio buttons are missing from the committed characters/steam-bridge.js (steam-bridge.js:18-175)

Settings:

- localStorage party-steam-ignore-movement-v1 (switcher.ts:16, 22)
- localStorage party-steam-minimized-v1 (switcher.ts:17, 57)

**MRG-020 Launch the local Steam client and attach the browser bridge.** When the user makes Steam primary on the hosting machine, the console launches Adventure Land, injects the Steam bridge into its single game page and re-attaches it after every navigation.

Rules:

- ensure refuses a second connection while one is pending (tools/steam/service.ts:30-34)
- a ready bridge needs no local desktop; after a hosting restart the service refreshes only a configured local Steam client (tools/steam/service.ts:36-45)
- with no game page it launches the executable, but refuses when Adventure Land already runs without the automation connection (tools/steam/service.ts:46-55)
- waits up to 45 s in 500 ms steps for one game page and fails on more than one window; attach needs the top window, the owned roster and the CODE storage functions, and evaluates the bridge source only when the page has no bridge or one whose version differs from steamBridgeVersion (tools/steam/service.ts:56-87)
- re-attaches every 2 s because navigation destroys the injected context (tools/steam/service.ts:88-101)
- the injected source is characters/steam-bridge.js read from disk (tools/steam/service.ts:103-110)

Settings:

- Steam preferences file steam-client.json (local Steam only), checked by assertLocalSteam (tools/steam/preferences.ts:14-27)

### Merchant hands

**MRG-021 Get and equip the gathering tool.** Before fishing or mining, the merchant fetches a rod or pickaxe from the bank or orders one crafted, then equips it in the mainhand.

Rules:

- ensureGatheringTool counts the tool in mainhand or bag; otherwise it closes the stand, walks to the bank and retrieves one (shared.js:9758-9771)
- with gatheringAutoCraft[mode] it posts a craft order and retries after 5 s (shared.js:9776-9783); otherwise it reports noTool and drops the mode unless the reply says noTool false (9784-9795)
- equipGatheringTool closes the stand and waits 250 ms; it records mainhand and offhand in the session when the mainhand is not a rod or pickaxe (shared.js:9798-9812)
- it picks the highest level tool, unequips the offhand first because an offhand makes the server answer cant_equip, waits 250 ms after each call and checks the result (shared.js:9813-9847)

Settings:

- gatheringAutoCraft per mode: built from merchantAutomations craft fishing and mining tools (status/response.ts:208), stored by the character from the status reply (shared.js:11325)

**MRG-022 Restore the merchant hands after gathering.** After a gathering cooldown or when gathering stops, the merchant re-equips its marked weapon, or the weapon and offhand it held before.

Rules:

- callers: the cooldown branch (shared.js:10072) and setGathering(null) (10237); fork HEAD adds restoreGatheringHandsForJob (fork HEAD shared.js:10708-10715)
- it stops when the gathering generation changes during the restore (shared.js:9852-9855)
- the marked merchantWeapon wins over the saved mainhand; the restore drops a saved rod, pickaxe or item listed for sale (shared.js:9861-9869)
- the restore skips an incompatible weapon type with an error status; a doublehand clears the offhand first (shared.js:9870-9886)
- with nothing to restore, it unequips a rod, pickaxe or listed item from the mainhand (shared.js:9895-9905)
- the restore waits 250 ms after each call and checks the result; a failure reports 'Could not restore pre-gathering equipment' and returns false (shared.js:9906-9923)
- current gatheringCommandHandoff returns true without restoring (shared.js:9994-10008); runMerchantJob suspends gathering for 5 command types without restoring (8454-8459), and its finally restarts gathering without restoring (8483-8487)

Settings:

- merchantWeapon from the status reply (shared.js:11330); coordinator writers merchant-item-commands.ts:74, transfer-commands.ts:63, 80, clear-item-marks.ts:125 (spec 10)

**MRG-023 Manual equip and the other hand writers.** Dashboard equip, the stand-listing weapon release, restore-equipment and job unequip lists also change the merchant hands; dashboard equip updates the hands gathering will restore.

Rules:

- equipDashboardItem accepts only equipment types, runs the porcupine manual hook, closes the merchant stand and finds the item by fingerprint (shared.js:6754-6766)
- with a gathering session it compares hands before and after and saves each changed hand unless the new item is a rod or pickaxe (shared.js:6769-6782; added in 5146e0d2)
- the status handler unequips a mainhand listed for sale when no job runs, no gathering runs and no merchantWeapon is marked, and clears the session mainhand when it matches (shared.js:11341-11353)
- restore-equipment equips each listed item found in the bag, with no delay and no result check (shared.js:10636-10641)
- job lists: stat scroll unequips each mark (6706) and re-equips it (6714, 6723); upgrade unequips equipped upgrades and stat marks (7314, 7321) and re-equips from command lists (7291, 7351, 7357); equipDeliveredItems equips deliveries (6792-6830)

Handed over by other specs: 1 function (12-dashboard-and-status).

### Call budget

**MRG-024 Request tracker data while a character holds a Tracktrix.** While a character carries a Tracktrix, the runtime asks the game for tracker data and hides the tracker window the game would open.

Rules:

- installSilentTracker wraps parent.socket.emit and parent.render_tracker; a manual tracker emit shows the next render within 15 s; an automatic request hides renders for 60 s (shared.js:740-770)
- the restore hook lives on the CODE frame root (shared.js:741, 759-763); stop calls it (17428)
- requestTrackerSnapshot retries every 2000 ms until a reply arrives; a reply schedules the next request in 30000 ms (shared.js:776-786, 801)
- trackerInventoryListener reads each player packet: losing the Tracktrix cancels the timer, gaining it requests at once (shared.js:787-794)
- a reply rebuilds item catalogs on the first reply and when the discovery tables changed (shared.js:795-814)

Handed over by other specs: 6 functions (12-dashboard-and-status).

**MRG-025 Poll the realm player list.** Every character asks for the realm player list every 10 s.

Rules:

- requestPlayerDirectory emits players at start and every 10000 ms (shared.js:822-824, 889-890)
- playerDirectoryListener keeps unique sorted names and drops Hidden (shared.js:815-821)
- stop clears the timer and removes the listener (shared.js:17429, 17447)
- the merchant's Ponty stock read at start and every 10000 ms (shared.js:17388-17391, 1265-1290) is INV-087 in spec 10; its cost is in the call table below

Handed over by other specs: 1 function (12-dashboard-and-status).

### Who writes the merchant's realm

Every writer, how it gets control and how it gives control back. The full review listed nine; this table has thirteen.

| Writer | Where | Gets control | Gives back | Retry and timeout |
|---|---|---|---|---|
| party visit travel port (party-realm begin) | merchant/party-realm.ts:62-76; application.ts:358-368 | dispatcher dispatchJob for a job whose target is on another realm, headless merchant only (party-realm.ts:65, dispatcher.ts:307) | advance requeues the job at the head on arrival (party-realm.ts:92-96); the job request stays until worker setup deletes it or ensureHome replaces it | 60 s per attempt, 3 attempts, retryAt +10 s (party-realm.ts:53-55, 98-100) |
| job realm route switchRealm | http/merchant-realms.ts:39-68 | character changeRealm in four executors (shared.js:8593-8598, 8711-8716, 8827-8832, 8971-8976) | Ponty and ALData buy hop home themselves at the end (8660, 8929-8930); sell and giveaway rely on ensureHome at completion (completion.ts:62-63) | none; stop after 150 ms (merchant-job-actions.ts:42) |
| ensure-home route | http/merchant-realms.ts:69-89 | merchantIdle when the live realm differs from command.homeRealm (shared.js:9477-9486) | home-recovery clearReturn on arrival (home-recovery.ts:77-83) | records attempts 1, so attemptReturn waits 60 s before the next try (home-recovery.ts:93-94) |
| attemptReturn | merchant/home-recovery.ts:91-111 via automation-composition.ts:55-65 | ensureHome from dispatcher.ts:136, 242, 301, idle.ts:129, completion.ts:62-63 | exhausted after 3 attempts; dispatcher tags home jobs until a dashboard retry (dispatcher.ts:115-121, merchant-control.ts:36-48) | first attempt at once, then 60 s apart, 3 attempts; the 15 s branch is dead (home-recovery.ts:93-94) |
| recoverStalledSale | merchant/home-recovery.ts:134-160 | 1 s interval, ALData sale running 180 s (application.ts:489-493) | one shot; a later ensureHome clears the request on arrival | restart after 100 ms; then attemptReturn rules |
| Force stand returnHome | http/merchant-actions.ts:42-49, called at merchant-control.ts:136 | Force stand enabled | one shot | headless stop after 100 ms; a Steam merchant waits for attemptReturn 60 s later |
| dashboard retry | http/merchant-control.ts:36-48 | retry button on a queued job | n/a; deletes the request and job realm fields, dispatches | n/a |
| party realm switch depart | characters/realm-switch.ts:75-94 | /party-api/realm/switch (realms.ts:99-120) | finish sets activeRealm and dispatches (realm-switch.ts:248-269); on failure run restores nothing (294-302) | 60 s progress, renewed per arrival, hard cap 60 s per participant (realm-switch.ts:100-119); setHome 120 s and 30 s confirmation (139-147, realms.ts:137) |
| set-home visit | characters/realm-switch.ts:174-197 | finish with setHome for offline account characters | restores enabled and block.realm in cleanup (188-195) | 60 s login, 120 s home confirmation |
| worker setup connectionRealm | characters/worker-setup.ts:30-63 | every worker ensure or slot assign | deletes merchant requests during a party switch or after arrival | none |
| character page navigation awaitRealmRestart | characters/shared.js:8578-8587; native-realm-switch 10963-10969 | after the job route and ensure-home route answer; native-realm-switch commands come from attemptReturn and recoverStalledSale through the restart port, and from party switch depart | never resolves; the old runtime waits to be replaced | none |
| Steam group navigate | steam/bridge.ts:229-241, 287-293; roster/steam-group.ts:63, 76 | group handoff in phase navigate | observe completes on arrival (steam-group.ts:158-166) | 180 s operation timeout (steam-group.ts:181-183) |
| Steam single handoff navigate | steam/bridge.ts:321-323 with reply.realm from roster/routes.ts:152 | single handoff in phase navigate | arrived completes it (roster/handoff.ts:214-221) | 90 s per phase (handoff.ts:254-262) |

### Game call budget: measured call costs

The server adds the cost of each handled call to the socket's 4 s window and disconnects the socket (`limitdc`) when the sum passes 200. Source: the local game server clone (kaansoral/adventureland_mongodb 43b2c8fc). The live server may differ from this clone; the one live observation, the limitdc entry ["secondhands",208] in the c3a8a57d message, matches it. Each row says whether its numbers come from code or are inference.

| Call | Cost to the caller | How the cost is derived | Where the merchant sends it | Frequency | Worst case per 4 s |
|---|---|---|---|---|---|
| rule: no base charge reaches the caller | 0 per event | server.js:4980 calls add_call_cost(-1) before current_socket = socket at 4981. After every handler current_socket is false_socket (server.js:5054; server_functions.js:4-13), so the base 1 lands in false_socket.calls (server_functions.js:5421-5447) | every emit | n/a | n/a |
| rule: CC table | auth 2, move 1.5, players 12, secondhands 16, friend 24, send_updates 12, cruise 10, random_look 10, equip 3, unequip 6, tracker 50, ccreport 3 | server.js:247-260, added at 5018-5020; equip_batch 3*(0.5+n/2) at 4990-4995; cm by message size at 4996-5016 | n/a | n/a | n/a |
| rule: resend modifiers | resend adds call_modifier for 'u', again unless 'nc', and 4*call_modifier for 'reopen' to another socket; modifier 1, skill 0.05, open_chest 0.1, target 0.5 | server.js:4632-4670, 4982; resend charges current_socket, so a resend outside a handler charges false_socket | n/a | n/a | n/a |
| rule: entry merge | consecutive charges with the same method label merge into one entry; the limitdc report shows these entries | server_functions.js:5443-5447; server.js:5024; js/game.js:3320-3324 | n/a | n/a | n/a |
| rule: transport and bank floor | transport_player_to +8; bank floor enter +32, leave +16 | server.js:4808, 5978, 5989. The locked-pack path at 5964 charges after an await, when current_socket is false_socket | smart_move through doors and into the bank | n/a | n/a |
| rule: limit and window | disconnect when the sum passes 200 (50 for a socket with no player); entries older than 4000 ms drop | server.js:261-262, 4973, 4983-4989, 5022-5026; server_functions.js:5439-5441, 5481-5489 | n/a | n/a | n/a |
| rule: charge before the handler | a rejected call costs the same | charge at server.js:5018-5020, handler call at 5028; secondhands answers 'distance' beyond 500 from Ponty at 7948-7951 | n/a | n/a | n/a |
| players | 12 | CC.players (server.js:250) | requestPlayerDirectory shared.js:822-824, timer 889-890 | start and every 10 s, every character | 12 |
| secondhands, background | 16 | CC.secondhands (server.js:251) | refreshPontyListings shared.js:1265-1290, timer 17388-17391 | every 10 s on the merchant, anywhere on the map | 16 |
| secondhands, Ponty job | 16 | same as above | merchantPontyBuy shared.js:8621-8622, plus refreshPontyListings at 8661 and 8666 | Current: once per listing after smart_move; fork: once per realm and after each buy, 1.5 s apart (fork HEAD 9215-9230) | Current: 12 reads reach 192; the 13th reaches 208 and disconnects. Fork: 48 |
| tracker | 50 | CC.tracker (server.js:258); the handler returns with no reply when player.tracker is unset (5528-5530) | requestTrackerSnapshot shared.js:780-786 through installSilentTracker 764-769 | while a Tracktrix is held: every 30 s after a reply, every 2 s while no reply (776-786, 801) | 50; 100 in the retry loop, 150 when jitter puts three requests inside 4 s (inference) |
| skill (mluck) | 0.2 | no CC entry; resend(target,'u+cid') and resend(player,'u+cid') at server.js:10900-10901 add 2 x 0.05 each | luck scan castLuckOnVisiblePlayers shared.js:5543-5575, timer 17382-17387 | scan every 750 ms while moving, up to 4 casts 125 ms apart | about 4 (inference on how many nearby players need luck) |
| move | 1.5, or 3.5 when the handler resends 'u+cid' | CC.move (server.js:249); resend at 11300 adds 2 | every smart_move segment; xmove follow in ALData buy every 1 s (shared.js:8885-8889); merchant rendezvous pursueMerchantTarget sends move() on each 200 ms pass while the target is visible within 600 and reachable (5321-5323, 5365); the fighter transfer approach sends one xmove per 500 ms poll while not moving (5380-5394) | per path segment; rendezvous up to 20 per 4 s | rendezvous 30; fork move budget caps 40 moves per 4 s = 60 (fork HEAD move-budget.ts:5, 20-26); the current console has no cap |
| transport (door) | 8 | the transport handler (server.js:5834) calls transport_player_to (6001), which adds 8 (4808) | smart_move across a door | per door | 8 each |
| transport into and out of a bank floor | 40 in, 24 out | 32 (server.js:5978) or 16 (5989) in the handler, plus 8 when the mount or unmount completes through transport_player_to (16655, 16719), which charges the player's socket by name (4808) | smart_move('bank') at shared.js:6054 (merchantVisitBank), 9767 (gathering tool), 9937 (gathering deposit), 9196, 9239, 3912, 4473, 4666, 4690, 4752 | per bank visit | 40 in, 24 out |
| town | 1 | use_skill('use_town') sends 'town' (js/functions.js:1678-1682); the handler resends 'u+nc' (server.js:6215) | merchantTownReturn use_skill('use_town') shared.js:849 | per stand return from a party | 1 |
| unequip | 8 | CC.unequip 6 + resend 'reopen+u+cid' 2 (server.js:257, 7938, 4643-4659) | stand reconcile trade1-16 with no delay between replies (shared.js:9537-9551); gathering 9823, 9833, 9883, 9900 each followed by 250 ms; status weapon release 11347; stat scroll 6706; upgrade 7314, 7321; native WTB removal 9373 | bursts | 128 for a full stand reconcile |
| equip and trade | 5 | CC.equip 3 + resend 'reopen+u+cid' 2 (server.js:256, 7626, 7895); the client trade() sends equip with a trade slot (js/functions.js:3377-3381) | gathering 9842, 9890, 9909 each followed by 250 ms; restore-equipment loop with no delay 10636-10641; stand listings 9564-9567 wait up to 3 s for the slot | per item | 13 for a gathering swap (offhand unequip and tool equip), 10 for a restore of both hands |
| wishlist | 1 | trade_wishlist has no CC entry; its resend 'reopen+u+cid+nc' adds 1 (server.js:8812); the client wishlist() sends trade_wishlist (js/functions.js:3362-3367) | native WTB 9385 | per offer | low |
| bank (retrieve, store, swap) | 1 | no CC entry; resend 'reopen' adds 1 (server.js:9478); bank_store and bank_retrieve send 'bank' (js/runner_functions.js:507-543) | retrieveFromBankUntil loop up to 100, one reply at a time (shared.js:1336-1344); ALData sell loop (8983-8987); gathering deposit | per item | 1 per item |
| buy, sell, trade_buy, buy_secondhand, join_giveaway, donate, mail | about 1 or 2 | resend parts (inference; these handlers were not read) | executors in shared.js 8589-9000 | per item | low |
| raw emits | 0 unless the handler charges | no base charge reaches the caller (first rule row) | lostandfound info shared.js:9297; exchange_buy 8360; mail_take_item 10617; test 512 | per call | low; invisible to any wrapper on game functions |

What can add up past 200:

- current Ponty job at Ponty with 13 listings: 13 reads of 16 reach 208 and the 13th disconnects. This is the observed ["secondhands",208] (c3a8a57d message): one merged entry (server_functions.js:5443-5444)
- idle merchant with lost tracker replies, then a 16-slot stand reconcile: 100 + 16 + 12 + 128 = 256 (inference: no log shows this sum)
- bank visit while the tracker loop runs: 40 + 10 (10 retrieves) + 24 + 100 + 16 + 12 = 202, plus moves (inference)
- fork Ponty job, tracker healthy: 48 + 12 + about 30 for 20 moves + buys = about 95

## 2. What goes wrong

### Stale homeRealm captured at queue time

Kind: bug. Origin: the current console. Confidence: confirmed in code.

1. bids.ts:113 and manual-orders.ts:70, 129 store homeRealm = activeRealm when they queue the job
2. a party realm switch sets activeRealm at finish (realm-switch.ts:249); pauseMerchantForRealm requeues the running job unchanged (realm-pause.ts:20); queued jobs are never rewritten
3. commands.ts:69 prefers job.homeRealm over inputs.activeRealm for aldataHomeRealm
4. the executor hops to aldataHomeRealm at the end (shared.js:8660, 8929-8930) and for a gold shortfall (8851); merchantALDataBuy also gates its bank withdrawal on that realm (8839)
5. the job route accepts any realm for a matching job (merchant-realms.ts:43-51), so the merchant reconnects on the old home
6. the next home-needing work sees block.realm != activeRealm and returns to the new realm (home-recovery.ts:45, 123): one extra hop pair per stale job

### Job realm route accepts any realm for any realm job

Kind: bug. Origin: the current console. Confidence: confirmed in code.

1. switchRealm checks only job id, reason in realmJobs and the caller (merchant-realms.ts:24-44)
2. it accepts any resolvable realm, PVP included (merchant-realms.ts:45-47); only the giveaway executor refuses PVP itself (shared.js:8728)
3. the current console has no realm hop blacklist; the fork's covers boss and event chase only (fork HEAD application.ts:1236; navigation/realm-hop-blacklist.ts:3-14)
4. job selection has no realm term (priority.ts:85-107), so queue order decides the hops

### Ledger 1: Ponty watch hopped the merchant between US II and EU II

Kind: bug. Origin: fork added. Confidence: confirmed in code.

1. an ALData job hops to EU II through the job route (shared.js:8858-8859, merchant-realms.ts:50-51, 66)
2. on EU II the 10 s Ponty timer reads secondhands and tags each listing with the live server (shared.js:17389-17390, 1265-1280)
3. first wrong decision, fork only: npc-shop matchPonty used merchant()?.server as the buy realm (npc-shop.ts is fork only; fix df1858c6 switches it to activeRealm, fork HEAD npc-shop.ts:357-380)
4. the queued Ponty job carries listings on EU II; 'Ponty purchases' skips the home check (home-recovery.ts:33) and the command carries aldataHomeRealm (commands.ts:61, 69)
5. merchantPontyBuy hops to the listing realm (shared.js:8610-8612); the route accepts (merchant-realms.ts:28, 43-51); the job ends with a hop home (8660); each job boundary is two hops
6. The current console parts that allow the loop remain: the any-realm route, realm-blind selection (priority.ts:85-107) and dispatcher planPonty against the merchant current server (dispatcher.ts:181-194, inference that the current own bid Ponty jobs can hop the same way when listings exist on two realms)

Commits:

- df1858c6 2026-10-25 Icelocked: Match Ponty watch orders against the home realm (npc-shop.ts matchPonty)

### Ledger 12: limitdc from per-listing secondhands reads

Kind: game-rule mismatch. Origin: the current console. Confidence: confirmed in code.

1. merchantPontyBuy walks to Ponty and reads Ponty with get_secondhands once per listing inside the listing loop (current shared.js:8607-8622)
2. each read charges CC.secondhands 16 to the merchant's socket (server.js:251, 5018-5020); the base charge at 4980 goes to false_socket (server.js:4980-4981, 5054)
3. consecutive reads merge into one 'secondhands' entry (server_functions.js:5443-5444); 12 reads reach 192 and the 13th reaches 208, which passes 200 (server.js:262, 5022-5026), so the server disconnects with ["secondhands",208], the entry in the c3a8a57d message
4. no character-wide budget exists; the fork pacer spaces every secondhands call 1.5 s apart and the job reads once per realm and after each buy (fork HEAD shared.js:9215-9230)

Commits:

- c3a8a57d 2026-10-24 Icelocked: Pace the merchant's Ponty secondhands calls under the game's rate limit

### Ledger 6: the rod or pickaxe stays in hand after a job preempts gathering

Kind: bug. Origin: the current console. Confidence: confirmed in code.

1. equipGatheringTool records the hands and equips the tool; it stays in hand through misses and recasts, until a cooldown tick restores (shared.js:9806-9812, 9842, 10133-10147, 10072)
2. only the cooldown branch (10072) and setGathering(null) (10237) restore the hands
3. first wrong decision: gatheringCommandHandoff returns true with the tool in hand, at once when no attempt runs (9996) or after cancelling one (10003-10007)
4. runMerchantJob suspends gathering for 5 command types by bumping the generation (8454-8459), which also aborts a restore that is already running (9852-9855); merchant-ponty-buy is not in that list
5. the job finally restarts gathering without restoring (8483-8487), and merchant-idle does not touch the hands
6. fork 0ce1071a restores at handoff when the mainhand is the session tool (fork HEAD shared.js:10688-10715); open gaps: a failed restore still returns true (10712-10714), commands without the merchant- prefix skip it (10710), only the mainhand triggers it

Commits:

- 0ce1071a 2026-10-24 Icelocked: Restore merchant hands when a job preempts gathering

### Dead 15 s branch in attemptReturn

Kind: dead code. Origin: the current console. Confidence: confirmed in code.

1. arrivalWindow is 15000 when attempts is 0 (home-recovery.ts:93)
2. the early return runs only when attempts !== 0 (home-recovery.ts:94), so attemptReturn never compares the 15000 value
3. the first attempt always goes out at once; the 15 s hold lives in awaitingFreshHomeReport instead (home-recovery.ts:71-76)

### Four changeRealm copies disagree

Kind: duplicate rule. Origin: the current console. Confidence: confirmed in code.

1. merchantPontyBuy continues on alreadyThere (shared.js:8597)
2. merchantJoinGiveaway, merchantALDataBuy and merchantALDataSell always call awaitRealmRestart (8715, 8831, 8975), which never resolves (8586)
3. when the route answers alreadyThere (block.realm equal and connected, merchant-realms.ts:49) the route schedules no restart. A headless merchant running one of those three copies then hangs until something else restarts the worker; a Steam merchant reloads its page to the same realm instead (8579-8584) (inference: needs block.realm already set while the live realm differs, as in the 100 to 150 ms before a home-route or Force stand restart)
4. three copies default a missing region and identifier to US and II (8709, 8825-8826, 8969-8970); the Ponty copy has no default (8592) and uses the live realm for a listing without one (8610-8611)

### Failed party realm switch leaves workers on the destination

Kind: bug. Origin: the current console. Confidence: confirmed in code.

1. depart sets block.realm to the destination for every headless participant before arrival is known (realm-switch.ts:81-85)
2. on failure run marks the operation failed and returns; it restores no block.realm and does not call dispatchMerchant (realm-switch.ts:294-302). A failure before finish keeps the old activeRealm; a setHome failure inside finish leaves activeRealm on the destination (249, 256-261)
3. after a failure before finish, headless workers reconnect on the destination while activeRealm names the old realm; the next heartbeat dispatch or idle pass (status/merchant-scheduling.ts:274-277) runs ensureHome, which moves the merchant back to the old realm alone (home-recovery.ts:45, 123) (inference for the combined effect)

### Background secondhands read costs 16 away from Ponty

Kind: game-rule mismatch. Origin: the current console. Confidence: confirmed in code.

1. the merchant runtime calls refreshPontyListings at start and every 10000 ms anywhere on the map (shared.js:17388-17391)
2. the server charges 16 before the handler and answers 'distance' beyond 500 from Ponty (server.js:251, 5018-5020, 7948-7951)
3. the read runs during bank visits, jobs and gathering, adding 16 per 10 s with no data back

### Tracker retry every 2 s at cost 50

Kind: game-rule mismatch. Origin: the current console. Confidence: inference.

1. requestTrackerSnapshot reschedules itself in 2000 ms before every emit; only a reply moves it to 30000 ms (shared.js:780-786, 801)
2. each tracker call costs CC.tracker 50 (server.js:258)
3. the server answers only when player.tracker is set (server.js:5528-5530), and it sets that flag when the bag holds a tracker (1492-1496), the same test the client uses (shared.js:772-774). A reply slower than 2 s or a lost reply costs another 50 per retry, 100 to 150 per 4 s while it lasts (inference: this check found no code path that holds a Tracktrix and never gets a reply)

### Stand reconcile sends up to 16 unequips back to back

Kind: game-rule mismatch. Origin: the current console. Confidence: confirmed in code.

1. merchantIdle walks trade1 to trade16 and unequips every sell slot that no listing matches, one reply at a time with no delay (shared.js:9537-9551)
2. each unequip costs CC.unequip 6 + 2 for the 'reopen+u+cid' resend = 8 (server.js:257, 7938, 4643-4659)
3. 16 unequips cost 128 within the round trips, before the listing loop adds trades (9552-9570)

### Socket listeners and the emit wrapper survive a CODE frame replacement

Kind: bug. Origin: the current console. Confidence: inference.

1. stop removes listeners with socket.off (shared.js:17438-17460), but a native start_runner replaces the iframe without running stop (inference from recovery.ts:130 and the loader dispose condition)
2. the next runtime sweeps old handlers by source signature only for action, hit, death, kill_credit, disappearing_text, chest_opened, disappear, entities and game_response (shared.js:303-322); q_data, tracker, player and players handlers (879-884) are not swept
3. installSilentTracker looks for its restore hook on the new frame root (741), so the old emit wrapper stays in the chain and the new frame wraps it again (757-763)
4. a handler from a detached frame matches the Steam orphan runner 'Cannot read properties of null' errors (inference; no stack trace)

### Committed steam-bridge.js lags its TypeScript source

Kind: stale generated file. Origin: the current console. Confidence: confirmed in code for the mismatch; inference for the effect.

1. characters/steam-bridge.js says it is generated from TypeScript (line 1) and carries steamBridgeVersion 12 (178); runtime/steam/connection.ts:6 says 14
2. its switcher has no movement-click gate and no audio buttons (steam-bridge.js:18-175 versus switcher.ts:22-119)
3. the Docker build regenerates the file with --publish (Dockerfile:14; tools/build-runtime.mts:25, 46-47), so an image serves version 14. Hosting copies characters/steam-bridge.js from the app directory (tools/console-build/hosting.ts:58-59)
4. a run that serves the committed copy would make the loader reinstall the bridge every 2 s, because the installed version differs from 14 (connection.ts:7-9, universal-loader.ts:158-172), and the local Steam service would evaluate it on every 2 s attach (tools/steam/service.ts:79, 88-101) (inference: whether any supported run skips the build)

### Steam navigation uses two different realm sources

Kind: duplicate rule. Origin: the current console. Confidence: confirmed in code.

1. the single handoff navigates to reply.realm = activeRealm or configuredRealm (steam/bridge.ts:321-323, roster/routes.ts:152, ownership.ts:167)
2. the group handoff navigates to the primary current realm or its home (steam-group.ts:63, 76; bridge.ts:288)
3. neither consults merchantRealmRequests, so a roster action can navigate a Steam merchant away on a job realm to a realm the merchant owner did not choose (inference)

### Force stand return for a Steam merchant waits 60 s

Kind: bug. Origin: the current console. Confidence: confirmed in code.

1. returnHome stops only the headless block (merchant-actions.ts:48) and records {owner:'home', attempts:1} (45)
2. a Steam merchant has no headless worker to stop, so nothing moves it at once
3. ensureHome reuses that request (home-recovery.ts:85) and attemptReturn waits 60 s because attempts is 1 (93-94) before it writes native-realm-switch (automation-composition.ts:57-62)

### Two normal-hands records

Kind: duplicate rule. Origin: the current console. Confidence: confirmed in code.

1. gatheringSession.mainhand and offhand hold the hands to restore (shared.js:9809-9812)
2. the coordinator merchantWeapon intent holds a marked weapon (merchant-item-commands.ts:74, transfer-commands.ts:55-63)
3. manual equip writes both: the session in equipDashboardItem (shared.js:6769-6782) and the intent in rememberManualWeapon (transfer-commands.ts:55-69), both from 5146e0d2
4. restoreGatheringEquipment prefers merchantWeapon over the session (9861-9869); restore-equipment and the job lists keep their own records (10636-10641, 6714, 7351)

Commits:

- 5146e0d2 2026-10-08 Breene26: fix: preserve manual merchant gear through gathering

### Home failure text differs between log and job tag

Kind: typo. Origin: the current console. Confidence: confirmed in code.

1. attemptReturn logs 'retry a queued job to resume' (home-recovery.ts:98)
2. dispatcher tags jobs 'manual retry required' and matches that exact text to clear it (dispatcher.ts:116-121)

## 3. Fork differences

What the fork (af92de45) adds or changes in this part. Fork code is not in the current catalog; its lines are fork HEAD.

| What | Commits | What it patches | Where |
|---|---|---|---|
| Ponty watch matching uses activeRealm | df1858c6 | ledger 1 hop loop (fork-only npc-shop matchPonty used the merchant live server) | fork HEAD runtime/coordinator/commerce/npc-shop.ts:357-380 |
| pontySecondhands pacer, 1.5 s between secondhands calls, and pontyStock read once per realm and after each buy | c3a8a57d | ledger 12 limitdc; also paces the 10 s background refresh | fork HEAD shared.js:9215-9230 and merchantPontyBuy |
| restoreGatheringHandsForJob in gatheringCommandHandoff | 0ce1071a | ledger 6 rod left in hand; works around current 9994-10008 | fork HEAD shared.js:10688-10715 |
| move budget: 40 moves per 4 s, defer while character.cc >= 150 | not traced | move bursts against the 200 per 4 s limit; moves only. Its comment prices a move at 2.5 (fork HEAD move-budget.ts:1-3); the clone charges 1.5, so the cap is 60 of 200 | fork HEAD runtime/characters/move-budget.ts:5, 20-26 |
| realm hop blacklist for boss and event chase | not traced | automatic hops to realms the user dislikes; merchant job hops are not covered | fork HEAD runtime/coordinator/navigation/realm-hop-blacklist.ts:3-14, application.ts:1236 |

## 4. Tests today

The first pass mapped tests to behaviours by what they load and by shared words between the test name and the behaviour title. The 2026-10-26 check read every test name against its behaviour, moved 30 tests to a better behaviour in this spec and took out 39 that test other parts (dashboard state, hosting and pairing, Hunt settings, convoys, appearance); the verification log lists them. The per-test list is in the catalog file. No one has reviewed yet whether each test proves what its name says, passes for the right reason and matches the game (Gaps).

| Test file | Tests mapped here | Behaviours |
|---|---|---|
| e2e/console.spec.ts | 3 | MRG-008, MRG-016, MRG-020 |
| scripts/tests/character-connection-status.test.cjs | 3 | MRG-028 |
| scripts/tests/coordinator-marketplace-location.test.cjs | 2 | MRG-006 |
| scripts/tests/coordinator-merchant-automation.test.cjs | 1 | MRG-006 |
| scripts/tests/coordinator-merchant-job-actions.test.cjs | 3 | MRG-005, MRG-027 |
| scripts/tests/coordinator-navigation-commands.test.cjs | 1 | MRG-006 |
| scripts/tests/coordinator-no-merchant.test.cjs | 2 | MRG-006, MRG-007 |
| scripts/tests/coordinator-ownership.test.cjs | 5 | MRG-011, MRG-015, MRG-026 |
| scripts/tests/coordinator-public-state.test.cjs | 1 | MRG-028 |
| scripts/tests/coordinator-realm-actions.test.cjs | 1 | MRG-001 |
| scripts/tests/coordinator-realm-pause.test.cjs | 2 | MRG-003 |
| scripts/tests/coordinator-realm-routes.test.cjs | 8 | MRG-001, MRG-002 |
| scripts/tests/coordinator-realm-switch.test.cjs | 7 | MRG-001, MRG-002 |
| scripts/tests/coordinator-roster-projection.test.cjs | 4 | MRG-010 |
| scripts/tests/coordinator-worker-setup.test.cjs | 1 | MRG-009 |
| scripts/tests/gathering-equipment-restore.test.cjs | 4 | MRG-021, MRG-022 |
| scripts/tests/gathering-tool.test.cjs | 3 | MRG-021 |
| scripts/tests/hosting.test.cjs | 1 | MRG-016 |
| scripts/tests/item-action-safety.test.cjs | 2 | MRG-023 |
| scripts/tests/loader-connection.test.cjs | 3 | MRG-016 |
| scripts/tests/merchant-recovery.test.cjs | 7 | MRG-006, MRG-007 |
| scripts/tests/public-handoff.test.cjs | 2 | MRG-013 |
| scripts/tests/roster-routes.test.cjs | 19 | MRG-011, MRG-012, MRG-014, MRG-015, MRG-026 |
| scripts/tests/steam-bridge.test.cjs | 9 | MRG-016, MRG-019 |
| scripts/tests/steam-desktop.test.cjs | 12 | MRG-020 |
| scripts/tests/steam-group.test.cjs | 26 | MRG-014, MRG-019, MRG-024 |
| scripts/tests/steam-handoff.test.cjs | 7 | MRG-013 |
| scripts/tests/steam-realm-choice.test.cjs | 4 | MRG-016, MRG-017 |
| scripts/tests/steam-recovery.test.cjs | 7 | MRG-016, MRG-018 |
| scripts/tests/tracktrix-refresh.test.cjs | 2 | MRG-024 |

Behaviours with no mapped test (2): MRG-004, MRG-025.

## 5. Needs your review

Each question gives Today, Options and a Recommendation. The coordinator copies them into REVIEW-QUEUE.md.

### Q1. When a job interrupts gathering, what must happen to the merchant's hands?

**Today:** in the current console `gatheringCommandHandoff` cancels the gathering attempt and returns
without restoring the hands (characters/shared.js:9994-10008), and `runMerchantJob` never restores
them (characters/shared.js:8420-8487). The merchant walks to the job with the rod or pickaxe and no
offhand (ledger 6). The fork's 0ce1071a runs the full gathering restore, both hands, before commands
whose type starts with `merchant-`, only while the tool is in the mainhand, and ignores a failed
restore (fork HEAD characters/shared.js:10708-10715).

**Options:**
- A. Restore both hands before any command that is not gathering itself, and report the command
  as deferred when the restore fails, so the coordinator retries it. Negatives: every command after
  a cast waits for 2 to 4 equip calls with their 250 ms settles; a restore that keeps failing (the
  weapon was sold or moved) holds every command until the user fixes the hands.
- B. Restore only before merchant jobs, as the fork does, but treat a failed restore as a deferral.
  Negatives: party travel, event and manual commands still leave with the tool; the same hold on
  merchant jobs when a restore keeps failing.
- C. Keep the tool and re-equip only at the stand. Negatives: the merchant travels and stands in
  events with a rod and no offhand; it saves only a few call-cost points.

**Recommendation:** A, with a cap: after 3 failed restores the command runs anyway and the merchant
logs the failure. It beats B because one rule covers event and travel commands, where the hands matter
most, and drops the `merchant-` prefix case. It beats C because the hands are right during the job.
A restore costs 5 per equip and 8 per unequip of the 200 per 4 s (call table). Its own negatives:
up to about 1 s more before each job that follows gathering, and the cap means a job can still run
with the tool after 3 failures.

### Q2. Should the merchant leave the party's realm for commerce?

**Today:** Ponty, ALData buy and sell, and giveaway jobs hop to the listing's realm through four
separate `changeRealm` copies (characters/shared.js:8593-8598, 8711-8716, 8827-8832,
8971-8976); Ponty and ALData buy hop back at the end. The job realm route accepts any resolvable
realm for a job whose reason is in its list (runtime/coordinator/http/merchant-realms.ts:39-68);
only the giveaway step refuses PVP (characters/shared.js:8728). The current console has no realm
hop blacklist; the fork's covers boss and event chase only (fork HEAD
runtime/coordinator/navigation/realm-hop-blacklist.ts:3-14). Job selection ignores realm
(runtime/coordinator/merchant/priority.ts:85-107). The fork's watch orders buy on the home realm
only (fork HEAD runtime/coordinator/commerce/npc-shop.ts:357-380, df1858c6).

**Options:**
- A. Home realm only for every automatic job; other realms only for a manual order the user
  places. Negatives: automatic bids and ALData buys miss cheaper listings elsewhere, and
  the merchant skips giveaways on other realms.
- B. Allow hops, but the route refuses PVP and blacklisted realms, the dispatcher groups ready jobs
  by realm and returns home once per group. Negatives: selection gains a realm term, so a home job
  can wait behind a realm group; more dispatcher code.
- C. Keep today's rule. Negatives: a hop pair at job boundaries (ledger 1), and PVP hops stay
  possible for three of the four reasons.

**Recommendation:** B, with A as the default for the fork's watch orders. It beats A because it
keeps the current cross-realm buying, which is part of the current design. It beats C because it
removes the hop pair at each job boundary and the PVP hops. Its own negatives: a home job can wait
up to one realm group, so the group needs an end rule (for example, the group ends when a home job
of higher priority is ready), and the blacklist has to move from the fork into the base.

### Q3. What should happen when a party realm switch fails halfway?

**Today:** the switch moves headless workers to the destination first and sets the party realm
only when everything arrives. On failure nothing rolls back: workers that already left stay on the
destination, and `run` does not dispatch the merchant itself
(runtime/coordinator/characters/realm-switch.ts:81-85, 294-302); the next heartbeat dispatch or idle pass
sends the merchant back to the old realm alone (runtime/coordinator/status/merchant-scheduling.ts:274-277;
merchant/home-recovery.ts:45, 123). A failure before `finish` keeps the old `activeRealm`; a setHome
failure inside `finish` comes after `activeRealm` already names the destination (realm-switch.ts:249,
256-261). The fork does not change this.

**Options:**
- A. Roll every moved character back to the old realm and report the failure. Negatives: one more
  set of logins of up to 60 s each, and a rollback login can fail too.
- B. Keep going: retry the stragglers to the destination once, then roll back. Negatives: more
  states in the operation, and the party waits up to another 60 s before a rollback starts.
- C. Keep today's state and let the user fix it. Negatives: the party stays split across realms
  until the user notices, and the merchant returns to the old realm alone.

**Recommendation:** B with one retry per straggler, then A. It beats A because a straggler that
only missed the deadline arrives without a full rollback. It beats C because the party always ends
on one known realm. Its own negatives: the worst case is about 2 minutes before the party is whole
again, and the rollback must also restore `activeRealm` for the setHome case.

### Q4. When the call budget is tight, which calls wait?

**Today:** nothing on the merchant checks `character.cc` before a burst. The only check is the
fighter's `cc <= 120` wait before sending items (characters/shared.js:5719-5720, in
`waitForHandoffSendWindow`). Background reads run on timers wherever the merchant is: players
every 10 s (cost 12), Ponty every 10 s (cost 16, even far from Ponty), the Tracktrix tracker every
2 s while no reply comes (cost 50). The fork adds a move budget (fork HEAD
runtime/characters/move-budget.ts) and a 1.5 s Ponty pacer (fork HEAD characters/shared.js:9221-9230).

**Options:**
- A. One budget on `parent.socket.emit` that reads the server's own count in `character.cc`, as the
  fork move budget does (fork HEAD move-budget.ts:24-25), with priorities: survival and combat
  first, job steps next, background reads last. Background reads pause above a threshold (for
  example 120 of 200) and the Ponty read runs only within reach of Ponty. Negatives: every emit
  passes one more layer; background lists go stale while a job is busy.
- B. Fixed shares per source (for example 40 per 4 s for background reads). Negatives: a job can wait
  while another source's share sits unused. The shares need tuning per role.
- C. Keep per-call throttles where a disconnect happened. Negatives: each new burst needs its own
  throttle after a disconnect, and the throttles do not see each other's calls.

**Recommendation:** A. It beats B because no share sits unused. It beats C because it covers bursts
before the first disconnect, including the stand reconcile and the tracker retry in the call table.
Reading `character.cc` keeps the client's cost table out of the decision, so a wrong table entry
(the fork's move comment says 2.5, the clone charges 1.5) only changes the order. Its own
negatives: Ponty and player lists can be one window stale during busy jobs, and a bug in the
wrapper affects every call.

## 6. Gaps

`node tools/check-claims.mjs` (run with `LIMIT=100000`), filtered to this spec:

- Functions claimed by this spec and by another spec: 0.
- Claims naming no known function: 0.
- Behaviours with no test: 2 (MRG-004, MRG-025).
- Unclaimed functions across all specs: 0.

Not yet verified:

- runtime/coordinator/merchant/dispatch-composition.ts beyond the ports grep (reader 09).
- runtime/coordinator/commerce/manual-orders.ts and bids.ts beyond the homeRealm lines (reader 09).
- Game server handlers for buy, sell, trade_buy, buy_secondhand, join_giveaway, donate and mail (the call table marks their resend costs as inference).
- Whether the live game server charges calls the way the clone does. The one live log matches the clone.
- Test accuracy: no one has reviewed whether each test in section 4 proves what its name says (method step 2).
- The catalog maps tests by file and test name; a test can prove more behaviours than the one it maps to.

## 7. Review claims checked

| Claim | Verdict | Evidence |
|---|---|---|
| 2.1: activeRealm has one writer, setActiveRealm, called only by realm-switch finish | CONFIRMED | git grep 'activeRealm *=' runtime finds only realm-composition.ts:54; call at realm-switch.ts:249; initial-core.ts:29 is the load default |
| 2.1 writer 1: party visit begin via travel port at application.ts:381-391 | PARTLY | begin party-realm.ts:62-76 correct; the travel port is application.ts:358-368 on the current console; 381 is the fork HEAD line |
| 2.1 writer 1 fail after 60 s, 3 attempts | CONFIRMED | party-realm.ts:53-55, 98-100 |
| 2.1 writer 2: switchRealm route has no intent, PVP or blacklist check | CONFIRMED | merchant-realms.ts:39-51 |
| 2.1 writer 2 executor lines 9130-9135, 9266-9271, 9438-9443, 9582-9587 | PARTLY | HEAD lines; current lines are shared.js:8593-8598, 8711-8716, 8827-8832, 8971-8976 |
| 2.1 writer 3: ensureHome route from merchantIdle | CONFIRMED | merchant-realms.ts:69-89; current shared.js:9477-9486 |
| 2.1 writer 4: attemptReturn 3 attempts 60 s apart, Steam gets native-realm-switch | CONFIRMED | home-recovery.ts:91-111; automation-composition.ts:55-65 |
| 2.1 writer 8: dispatchMerchant returns early at application.ts:1798, 1835-1837 | PARTLY | fork HEAD lines (dispatchMerchant 1797, realmOwnsMerchant 1835); on the current console the early return is application.ts:1662 (dispatchMerchant) and 1681 (dispatchMerchantIdle) through realmOwnsMerchant 1699-1701 |
| 2.1 writer 9: awaitRealmRestart at 9105-9114 | PARTLY | HEAD lines; current shared.js:8578-8587 |
| 2.1: only ensureHome (60 s job back-off) and switchRealm (current job) look at another writer | PARTLY | also worker-setup.ts:30-42 deletes merchant requests during a party switch, and ownership.ts:149-151 fences roster changes during a party visit |
| 2.4: suspend list has six command types | PARTLY | six on fork HEAD (shared.js:8981 adds merchant-prim-stack); five on the current console (shared.js:8454) |
| 2.4: status handler release of a listed weapon 12064-12076 | PARTLY | HEAD lines; current shared.js:11341-11353; gate also needs no merchantWeapon mark |
| 2.4: restore-equipment equips each item with no checks | CONFIRMED | current shared.js:10636-10641 |
| 2.4: equipDashboardItem rewrites the gathering session (5146e0d2) | CONFIRMED | current shared.js:6769-6782 |
| 2.4: coordinator merchantWeapon writers merchant-item-commands.ts:74, transfer-commands.ts:63, 80, clear-item-marks.ts:125 | CONFIRMED | git grep merchantWeapon on the current console |
| 2.4: equipGatheringTool records displaced hands | CONFIRMED | current shared.js:9806-9812 |
| 2.4: restoreGatheringEquipment bails when the generation changes and returns false on failure | CONFIRMED | current shared.js:9852-9855, 9918-9923 |
| 5.1 ledger 1 chain | PARTLY | current parts confirmed (merchant-realms.ts:28, 43-51; home-recovery.ts:33; commands.ts:69; priority.ts:85-107); the first wrong decision lives in fork-only npc-shop.ts, and the application.ts:1556-1560 queueMatches line is fork HEAD (the current queuePontyMatches is application.ts:1423-1425 and calls bidPurchases.queuePonty) |
| 5.2 ledger 6 chain | CONFIRMED | current shared.js:9994-10008 (return true at 9996 and 10007), 8454, 8483-8487; fork 0ce1071a at fork HEAD shared.js:10688-10715 |
| 5.3 ledger 12 chain: 17 per read, 13 reads cost 221, limit 200 per 4 s | PARTLY | 16 per read: the base charge at server.js:4980 runs before current_socket is set at 4981 and lands on false_socket (5054; server_functions.js:4-13). 13 reads cost 208, the logged ["secondhands",208]; the 200 limit is confirmed (server.js:262, 5022-5026) |
| 5.4: writer lock fixed in the current process-lock.ts:13-55 | PARTLY | the file is runtime/coordinator/persistence/process-lock.ts; processLockIdentity 13-22 records start time and boot id on Linux only; sameProcessStart 49-55 rejects a reused PID |
| 5.4: production.attempts prune in production.ts:65-72 | PARTLY | the file is runtime/coordinator/inventory/production.ts; completed attempts beyond the newest 2048 are pruned at 65-72 |
| 5.4: Steam orphan runner chain | PARTLY | code facts confirmed: recovery start_runner (recovery.ts:122-134), signature sweep omits q_data, tracker, player, players (shared.js:303-322, 879-884), restore hook on frame root (741, 759-763); the link to the errors stays inference |
| 6.1: base cost 1 per handled event, CC table, 200 per 4 s, quarter limit with no player | PARTLY | the CC table, 200 per 4 s and the quarter limit are confirmed (server.js:247-262, 4983-4989, 5018-5026; server_functions.js:5421-5448, 5473-5490). The base 1 is charged to false_socket, not to the caller (server.js:4980-4981, 5054) |
| 6.1: resend adds call_modifier for u and for no nc, 4x for reopen to another socket | CONFIRMED | server.js:4632-4670, 4982 |
| 6.1: transport adds 8; bank floor enter 32, leave 16 | CONFIRMED | server.js:4808, 5964, 5978, 5989; the 5964 path charges after an await, when current_socket is false_socket |
| 6.1: secondhands charged before the distance check | CONFIRMED | charge at server.js:5018-5020 before f(data) at 5028; distance answer 7948-7951 |
| 6.2: pursueMerchantTarget moves every 200 ms | CONFIRMED | pursueMerchantTarget sends move() on each 200 ms pass while the target is visible within 600 and reachable (shared.js:5321-5323, 5365); the 500 ms xmove loop at 5380-5394 is the fighter side of waitForPlayer, which hands a merchant to pursueMerchantTarget (5379) |
| 2.1 bids.ts:113, manual-orders.ts:70, 129, commands.ts:69, realm-pause.ts:20 keep a stale homeRealm | CONFIRMED | those lines on the current console |
| 8.1: the 15 s return window at home-recovery.ts:93-94 is unreachable | CONFIRMED | home-recovery.ts:93-94 |

## 8. Settings index

| Setting | Default | Read at | Written at |
|---|---|---|---|
| activeRealm | the saved value, else configuredRealm (initial-core.ts:29) | home-recovery.ts:45; merchant-realms.ts:75; ownership.ts:167; bids.ts:113; manual-orders.ts:70; commands.ts:69; idle-composition.ts:61; automation-composition.ts:59; dispatch-composition.ts:105, 150; full list in MRG-001 | realm-composition.ts:54 |
| merchantRealmRequests | {} | home-recovery.ts:116; worker-setup.ts:34, 44; application.ts:1642; dispatch-composition.ts:146, 150 | application.ts:365; merchant-realms.ts:51, 80; merchant-actions.ts:45; home-recovery.ts:87, 146 |
| merchantHomeReturnAt | 0 | dispatch-composition.ts:146 (returningHome port) | home-recovery.ts:78, 86, 92, 97, 105, 149; application.ts:362; merchant-actions.ts:47; merchant-control.ts:40 |
| merchantForceStand | false (merchant/initial-runtime.ts:50) | dispatch-composition.ts:156; idle-composition.ts:40; shared.js:11336 | merchant-control.ts:131 |
| merchantWeapon | null | shared.js:11330, 9861, 11342 | merchant-item-commands.ts:74; transfer-commands.ts:63, 80; clear-item-marks.ts:125 |
| gatheringAutoCraft | {} | shared.js:9776 | status/response.ts:208 from merchantAutomations; stored at shared.js:11325 |
| realmSwitch | null | application.ts:1700; worker-setup.ts:31; realms.ts:93; realm-composition.ts:36 | realms.ts:67 |

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
