# 07 Hunts and farming

Milestone M0 (the map). Prefix `HNT`. Checked against the current console `refs/review/ryan-1.5`
(b9b5c91e) in (local checkout); fork lines are marked "fork af92de45".
Every file:line is on the current console unless marked. "Inference:" marks a claim that the code alone
does not prove.

## Scope

This spec covers what the party farms and why:

- **Monster Hunt.** Daisy's quests, quest selection, travel to the spawn, turn-in, loot before leaving, deaths and the blacklist, backup farming, and recovery from failed routes and walks.
- **Farming modes.** The policies auto, default, scatter and hunt (plus the fork's achievements), and the party mode the coordinator sends each tick.
- **Focus, monster selection and farm areas.** Which monsters, which spawn, and moving away from a competing player.
- **Rares and the Phoenix patrol.**
- **The Cave of Many Dreams.** The daily dungeon.
- **Achievement Hunt.** Fork only, in section 3.

### Owners this spec asks, and owners that ask it

| Question | Owner | How this spec refers to it |
|---|---|---|
| Which task wins when Hunt, a rare, the Cave, an event, escape or farm relocation all want the party | 01 Groups and tasks | "asks 01"; pure precedence predicates are handed off in `catalog/handoffs-07.json` |
| Which group a character belongs to (Follow, solo scopes) | 01 Groups and tasks | `hunt/scopes.ts` and `hunt/membership.ts` handed off |
| Convoys, shared walks, arrival holds and route planning | 02 Movement | Hunt, farm areas, rares and the Cave start convoys through it |
| Target choice, grouped combat queue, passing attacks | 04 Targeting | rare nomination, Cave target rules |
| Death recovery, escape, priest revival | 05 Survival | Hunt and the Cave wait on it |
| Event admission, event returns, anniversary | 06 Events | Hunt pauses for events and resumes from event returns |
| Saved values (Hunt settings, focus, priorities, passive rules) | 11 Settings | |
| Dashboard panels and status text | 12 Dashboard and status | Hunt's free-text `message` |
| HTTP routes, loader, start and stop | 13 Lifecycle | Hunt and farming routes are proposed to 13 and requested here |

Specs 02, 04 and 13 also ask this spec: what the Hunt target is, whether Hunt owns a convoy, and which farm area is active.

### How the catalog was built

- **Proposed functions.** `catalog/proposed-sections.json` proposes 591 functions for this spec (`node -e "console.log(require('./catalog/proposed-sections.json').filter(x=>x.spec==='07-hunts-and-farming').length)"`). This catalog claims 477 of them; other specs claim the other 114, and 108 of those are listed in `catalog/handoffs-07.json` (section 6.1). Triage functions that wire this spec's services are claimed too.
- **Requested functions.** The heuristic put several of this spec's modules in other specs: `navigation/rare-hunting.ts` and the farm-area modules in 02, the Hunt and farming HTTP routes in 13, and the farm-zone library in 12. Those functions are described here and listed under a `requested` key on the behaviour they implement. Most have since moved to 07; section 6.1a counts the ones that stay elsewhere.
- **Tests.** Test ids are `file::test name` as found by `scripts/tests/*.test.cjs` and `e2e/*.spec.ts` on the ref. The index was built with a regex over `test(` and `it(` calls; names built at run time are missing from it (section 6).


## 1. What it does today


### 1.1 Monster Hunt

Words used here: a **cycle** is one `state.monsterHunt` record (`hunt/lifecycle.ts:155-176`). Its **stage** is a plain string. The stages that code writes are `daisy-sync-travel`, `checking-quests`, `assigning`, `at-daisy`, `waiting-expiry`, `returning`, `mission-travel`, `farming`, `paused-event`, `blacklist-retreat`, `backup-travel`, `backup-farming`, `batch-loot` and `ended`. Twelve appear as `stage = '<name>'` literals (`git grep -n -o -E "stage *= *['\"][a-z-]+['\"]" refs/review/ryan-1.5 -- runtime/coordinator/hunt`); `daisy-sync-travel` is the initial value in `create` (`lifecycle.ts:163`), and `returning`, `daisy-sync-travel` and `mission-travel` are also set by `convoy.start` from its stage argument (`convoy.ts:115`). `navigation/hunt-arrival.ts:68` and `scripts/hunt-safety.cjs:11, 18, 26` also write `farming` and `backup-farming`. A **mission** is one quest target with its owners and destination (`runtime/hunt/policy.ts:49-53`). **Daisy** is the Monster Hunter NPC: the character reports its position from `find_npc("monsterhunter")` (`characters/shared.js:1869-1872`) and the coordinator keeps it as `monsterHunterLocation`.

#### Hunt mode and cycle

**HNT-001 Selecting Hunt.** The dashboard posts mode `hunt` to `/party-api/farming-mode` (`http/registration.ts:105`; route in `http/hunt-mode.ts:70-86`, described with the farming modes in HNT-037). The route then calls `createHuntMode.select` (`hunt/mode.ts:115-130`).
- Rules: Hunt restarts when a backup was supplied, the previous mode was not Hunt, any participant cancelled navigation or an escape runs, or no cycle exists (`mode.ts:93-98`). A supplied backup focus replaces the shared focus and deletes the per-character focus of every participant, the leader included (`mode.ts:88-92`). On a restart, unless the party is fighting, the coordinator releases escape and authorizes the party to the given location, else Daisy, else the first live quest's spawn (`mode.ts:70-81, 126`). The previous non-Hunt mode becomes the cycle's return policy; from Hunt it reuses the saved one or `auto` (`mode.ts:99-101`).
- Selecting Hunt again without a backup while a cycle runs and nothing is cancelled does nothing to the cycle (`mode.ts:93-98`, test monster-hunt-start). The route sends `supplied` whenever the body has a `backup` key (`hunt-mode.ts:85`), so a dashboard save that includes the backup restarts the cycle.
- Settings: backup focus and backup area (required, `hunt-mode.ts:52-61`).

**HNT-002 Leaving Hunt.** Choosing another mode from Hunt releases escape, clears Hunt state, the death recovery record (`combatRecovery`, `combatHuntBoundary`) and the farm-area pending move, failures, pause and message, then starts a convoy to the leader's configured farm (`mode.ts:37-50, 51-69`). It skips that convoy while a member has an open event trip (`mode.ts:55-61`). While an event return runs, the change is queued: the mode is written, the cycle is reset, and the return's post-exit destination becomes the leader's farm, else the given location (`mode.ts:102-114`).

**HNT-003 Starting a cycle.** `begin` first clears the farm-area pause, failures and pending move (`lifecycle.ts:214-218`), a write into the farm-area owner's record. A new cycle takes the leader plus current participants that are in the fresh party (`lifecycle.ts:185-188`), keeps unfinished loot from the old cycle (`lifecycle.ts:189-192, 200-202`), records each member's last death as a baseline (`lifecycle.ts:142-153`) and starts in `checking-quests`, or in `batch-loot` when the ended cycle's reason was the blacklist text (`lifecycle.ts:182-184, 193-195`). It prepares quests unless loot is pending or a member is at an event (195). Production callers are the tick with no cycle (`tick.ts:78`), the mode route (`mode.ts:112, 129`) and the retreat restart (`retreat-restart.ts:78`); none passes `resume` (`composition.ts:91`; `mode.ts` passes `false`).

**HNT-111 The resume branch of `begin` (test only).** With `shouldResume` true, a cycle that is not ended and has no `exitMode` is kept: `resume` deletes the route budget, cancels the Hunt convoy, sets `pickupPending` for pickup stages, clears Hunt commands, goes to `checking-quests` and prepares quests unless loot is pending or a member is at an event (`lifecycle.ts:125-140, 220-226`). No production code passes `true` (`git grep -n "begin(" refs/review/ryan-1.5 -- runtime/coordinator`); tests call it directly (`scripts/tests/coordinator-hunt-composition.test.cjs:37`, `hunt-safety.test.cjs:204, 220`). Inference: it is left from an older retry path.

**HNT-004 The Hunt tick.** `monsterHuntTick` runs `dungeons.reconcile`, then the party Hunt when a leader exists and the dungeon does not own the party, then every solo scope's Hunt, saving when a solo cycle changed (`application.ts:2136-2144`). The solo ticks have no dungeon check. `createHuntTick.tick` (`tick.ts:74-94`) runs only in Hunt mode or exit mode (`tick.ts:106-108`). With no cycle it begins one if no convoy runs (`tick.ts:77-80`). Then, in this order: roster repair (81), communication hold (82), failed return (83-86), arrival reconcile (87), rare encounter (88), expiry (89), combat event (92), then `advance` (24-38): backup farming, loot barrier, batch loot, turn-in ownership and the event release window, return message, deaths, then `advanceAfterDeaths` (57-70): death-recovery wait, route recovery, farm-walk recovery, pause, quest check, blacklist retreat, roster reconcile and travel. The order decides which pause wins and which message shows (see B.1).

#### Party roster

**HNT-005 Who takes part.** Participants are the leader and its followers that are active, not merchants and on the leader's server, sorted leader first and then by name; none at all when the leader is stale over 10 s or is a merchant (`controls.ts:34-52`). `currentHuntParty` applies the same rule to every character seen in the last 10 s (`current-party.ts:4-7`).

**HNT-006 Repairing a saved roster.** Each tick (`tick.ts:81`) and before preparing quests (`quests.ts:158`) the cycle drops members no longer in the current party and deletes their `monster-hunt` commands for this cycle, cancels the Hunt convoy, and returns to `checking-quests` unless a turn-in runs, the cycle ended or exit mode is set (`current-party.ts:9-15, 27-53`). If the quest owner or turn-in owner left, it also clears the owner, turn-in, encounter, arrival handoff, missions and target (17-25). It does nothing while the leader itself is missing (41), during a geometry reload or after a `geometry-mismatch` failure (54-57), or while the Hunt convoy has a communication hold or a member report older than 3 s (58-63).

**HNT-007 Follow changes and late members.** `participants.reconcile` runs before travel (`tick.ts:68`). It confirms completed interactions (`participants.ts:22-30`), stops when the leader is stale over 10 s (87), drops participants that no longer follow and puts the leader first unless a turn-in owns travel (32-39), and cancels any active convoy whose purpose is not `monster-hunt` (89-92; precedence by side effect, asks 01). Late members join a cycle with `policyVersion` 3 directly (44-47). In an older cycle, late members that own a mission join, and other late members rebuild the missions only when the cycle is untouched (48-67). A cycle without version 2 stuck in `waiting-expiry` with only the leader's quest moves to `assigning` (69-83).

**HNT-008 Fresh status gate.** Most steps wait with "Waiting for fresh Hunt status from X" while any participant is missing, older than 10 s, dead, or on another server than the leader (`lifecycle.ts:35-50`).

#### Quest selection and Daisy

**HNT-009 Which quest.** The character reports its quest from the game's `character.s.monsterhunt` as id, count, remaining time and server (`characters/shared.js:1858-1867`). `policy.selection` (`policy.ts:34-48`): a selected quest with time left stays selected while the selection leader is unchanged and its owner is still in the party, unless it became blacklisted with kills left (37-40). Otherwise members are checked leader first: no quest or an expired one means `pickup` (43), a finished count means `claim` (44), a quest that is not blacklisted means `farm` (45). Blacklisted quests with kills left are skipped; when every member is skipped there is no selection (47). One quest is farmed at a time: `missions` returns at most one mission (49-53). `owner` and `quest` read the turn-in owner while a turn-in runs, else the selected owner while the leader is unchanged (22-29). `build` stamps a new mission revision and policy version 3 (`quests.ts:54-64`).

**HNT-010 Preparing quests.** `prepare` (`quests.ts:157-191`) repairs the roster, moves a backup cycle to `backup-travel`, waits for fresh status, and waits with "Waiting for combat event before checking Hunt quests" while any participant reports an event or an event return runs (164-172). A batch pickup walks to Daisy (173-182). With no selection it enters backup farming (184-187). Otherwise it adopts the selection (116-124) and either walks to Daisy to pick up a quest, returns to claim, restarts travel to the current mission, or rebuilds missions and advances (126-155).

**HNT-011 Missions in order.** `advance` cancels the Hunt convoy and starts the next mission that is not skipped, not blacklisted and still has kills (`quests.ts:84-102`). A mission without a spawn destination is marked skipped (94). With no mission left the next selection decides: none goes to backup farming, `pickup` prepares, anything else returns to Daisy (103-113).

**HNT-012 At Daisy.** Travel to Daisy ends when every participant is fresh (3 s), alive and within 100 of Daisy (`travel.ts:54-86`). At Daisy `process` (`quests.ts:324-336`) regroups anyone farther than 100 (281-301), clears completed interaction commands (193-201; a command also counts as done 15 s after issue once a newer status arrives, 27-34), runs a batch pickup (303-323), issues one `assign` to the selected owner when a pickup is pending (207-225) or `claim` to every member with a finished quest (227-235). The character confirms each interaction through `/party-api/monster-hunt-interact-complete` (`http/registration.ts:108-111`; `http/hunt-control.ts:122-152`); a failure clears the command and shows "Retrying <action> for <name>". The game itself accepts the request within `B.sell_dist`, 400, of Daisy (`game node/server.js:225, 5483`).

**HNT-013 Turn-in.** A quest is due when the owner has no live quest or its count is 0 (`policy.ts:30-33`). A due quest starts the turn-in: the turn-in record takes the owner and phase `returning`, Town fallback state resets, and a convoy to Daisy starts (`policy.ts:54-61`; `quests.ts:66-75`; `travel.ts:8-13`). The turn-in owns travel until its phase is `complete` (`policy.ts:17-21`, handed to 01 as a precedence predicate). Rewards checked set phase `complete` and hold Hunt for 2 s, or while a member reports `huntEventPending`, so events may start before the next quest (`policy.ts:62-72`; `quests.ts:329-334`; `tick.ts:20-21`). A cycle saved by an older policy or under another leader is rebuilt (`policy.ts:73-75`; `recovery.ts:37-52`).

**HNT-014 Expiry.** While a mission travels or farms, `observeHuntExpiry` records each owner's attempt with a deadline from its fresh report (`expiry.ts:13-57`). When a fresh report shows the quest gone after the deadline, the attempt counts one expiration failure, once, unless the target is already blacklisted (`expiry.ts:58-78`). At Daisy, an unfinished quest that must expire sets `waiting-expiry` with "Waiting at Daisy for the selected hunt to expire; events remain allowed" (`quests.ts:261-279`); `blacklistExpired` records an expiration when no attempt tracked it (250-259). The game gives a quest 30 minutes (`ms: 30 * 60 * 1000`, `game node/server.js:5513`).

**HNT-015 Exit mode.** After rewards, a cycle with `exitMode` clears Hunt and starts a convoy to the leader's configured farm (`quests.ts:237-248`). No production code sets `exitMode` to a value: `git grep -n -E "exitMode *(=|:) *['\"a-z]" refs/review/ryan-1.5 -- runtime scripts characters ':!scripts/tests'` finds only the three writes that set it to null (`lifecycle.ts:94, 106`; `recovery.ts:31`). Inference: this path runs only for cycles saved by an older build or built by tests.

#### Travel and farming the quest

**HNT-016 Starting a Hunt convoy.** `createHuntConvoy.start` (`convoy.ts:121-145`) refuses with a message when a return is asked while any member lacks convoy protocol 4, location data is missing, or loot is pending (16-29), and when a member cancelled navigation or an escape runs (31-41). It refuses without a message while a convoy already runs (129). When travel defense is not clear it sets the stage, writes the defense message and does not start, except that an outbound mission may start while defending (130-137). A return when everyone is fresh, alive and within 100 of Daisy goes straight to `at-daisy` (138-143). Otherwise it authorizes the party and starts a `monster-hunt` convoy (101-119) and copies the routing flags onto the convoy and every issued command: no combat handoff, Hunt target on outbound legs, non-preemptible continuous return on returns, native fallback, Town policy (72-99). When the start port refuses it shows "Waiting for an online party leader on the convoy realm" (109-111).

**HNT-017 Which spawn.** The mission destination is the saved preferred spawn for that monster, else the nearest catalog zone on the leader's map, with cross-map zones last (`controls.ts:86-112`). Preferences are keyed by map and spawn center (`spawn-preferences.ts:2-10`). Settings: Hunt setting `preferredSpawns`.

**HNT-018 Arrival.** Mission travel ends only when every participant is fresh (3 s, at most 500 ms in the future), alive, on the destination map and instance, on the leader's server, and inside the spawn area with the character's search radius (`travel.ts:244-258`). Without a convoy, `reconcileArrival` (`travel.ts:291-300`) moves the cycle to `farming` when the target is set, no event return runs, no member cancelled and no member reports an event. Its revision check `arrivalOwned` (281-290) returns true at 283 whenever no convoy exists, and `reconcileArrival` runs only without a convoy, so the revision comparison at 285-289 never runs from there. The rare owner calls it when it hands travel back (`application.ts:1777`). Convoy arrival is accepted through the convoy engagement route with `huntSafety.acceptArrival` (`application.ts:771`; described in HNT-059).

**HNT-019 Farming the quest.** In `farming`, Hunt repairs a cycle that never reached the spawn (`travel.ts:232-238`), waits while members recover from a death (back within 800, `travel.ts:121-146`), returns to Daisy when due, and waits while the party fights (`travel.ts:240-242`). When the leader is outside the destination with a 150 margin and no handoff or arrival grace protects it, Hunt logs "Hunt arrival recovery" and restarts mission travel (`travel.ts:181-230`, 148-164). When the quest timer runs out it returns to Daisy; when no owner has kills left it advances (`travel.ts:166-179`).

**HNT-020 No handoff to farming combat.** A Hunt convoy never hands off to combat; an old client asking for a handoff is refused, and replacement commands keep the Hunt target for attacks while moving (`engagement.ts:5-23`).

**HNT-021 Temporary encounters.** A cycle with an `encounter` record pauses travel and fights it (`travel.ts:275-280`; `encounter.ts:74-113`). The encounter ends when the monster's death is confirmed, the quest is due, or the monster is absent for 5 s of fresh observations; observation time does not advance while reports are stale (`encounter.ts:15-72`). A nearby Hunt target seen by a member continues the encounter (`encounter.ts:98-111`; `nearby-target.ts:9-39`). Loot is collected before travel resumes (`encounter.ts:85`; `loot.ts:97-101`). No production code creates an encounter: commit 829b85ba (2026-09-22) removed the writer from `engagement.ts` (`git show 829b85ba | grep "^-  else hunt.encounter = "`), and `git grep` finds no other writer. Inference: this runs only for cycles saved before that commit and in tests.

**HNT-022 Legacy destination repair.** A mission whose destination predates `destinationVersion` 1 is matched to the spawn catalog; an unmatched point is replaced by a catalog spawn when the party is fresh and not fighting (`encounter.ts:120-157`). The check runs on every travel step in `mission-travel` and `farming` (`travel.ts:265, 272-274`) and returns at once for a repaired mission.

#### Loot barrier

**HNT-023 Loot before leaving.** When a mission's owners all finished their quest (fresh within 3 s), Hunt creates a loot barrier at the leader's position and cancels the Hunt convoy until the leader reports a matching completed loot pass within 180 of that spot after the barrier started (`loot.ts:23-89, 131-144`). The barrier id is the cycle, revision, mission index, target and owners (`loot-identity.ts:1-4`). A collector that moved away from the barrier releases it (`loot.ts:102-118`). Events, a cancelled or dead member, an event return and stages other than travel, farming, `paused-event` and `batch-loot` skip it (`loot.ts:11-22`). Loot collection waits while death recovery or escape runs (`tick.ts:39-44`). Batch loot waits for a complete barrier, fresh status, no event return and no member cancelled or at an event before preparing (`tick.ts:45-56`).

#### Pauses, deaths and recovery

**HNT-024 Combat event pause (asks 01).** When any participant reports `activeEvent` or `joinedEvent` and no turn-in owns travel, Hunt saves its stage, sets `paused-event` with "Paused for combat event" and cancels its convoy (`travel.ts:15-28`). The tick checks this before `advance` (`tick.ts:92`), and travel checks it twice more (`travel.ts:262, 277`). Resuming fights a held encounter, returns when due, sets `farming` when the party already stands in the spawn, or restarts mission travel (`travel.ts:30-52`).

**HNT-025 Other-owner pause (asks 01).** `recovery.pause` (`recovery.ts:157-177`) first drops a stale normal-farming fallback convoy (`recovery.ts:125-139`, matched by purpose `hunt-fallback` or by its label text). Then: when another owner holds travel (`policy.eventOwnsTravel`, handed to 01: an event return, any non-Hunt convoy except a completed anniversary return, or an open anniversary cycle, `policy.ts:82-93`) it sets `paused-event` with a message from the convoy or event return (140-156); when the farm-area owner is paused or has a pending move it waits with that owner's message (167-170); when a member cancelled navigation it cancels the Hunt convoy with "Hunt movement is paused; select Hunt again to resume" (171-176).

**HNT-026 Communication hold and rare encounter.** A communication hold on the Hunt convoy stops the tick with the hold reason, after counting deaths (`tick.ts:100-105`). An active rare encounter stops the tick with the convoy's defense reason, the encounter message or "Travel encounter in progress" (`tick.ts:95-99`; asks 01).

**HNT-027 Return status text.** While returning, Hunt shows the return leg, Town interruptions, preparation blockers, geometry repair, or "Daisy return held; request Retry return to resume: <failure>" (`recovery.ts:5-23, 54-82`).

**HNT-028 Failed return and fallback (no production writer).** A cycle in stage `failed-return` ends when a member cancelled navigation, else `finishFailed` authorizes the party and starts a `hunt-fallback` convoy to the saved backup farm and ends the cycle (`recovery.ts:28-35`; `lifecycle.ts:72-100`). No production code sets stage `failed-return` or `endReason` (`git grep -n "failed-return\|endReason" refs/review/ryan-1.5 -- runtime scripts characters dashboard ':!scripts/tests'` shows reads and one `delete` at `lifecycle.ts:114`).

**HNT-112 Retry return.** The live path for a failed turn-in is the held convoy (HNT-027) plus the Retry return route `/party-api/monster-hunt/retry-return` (`http/registration.ts:107`). It needs a cycle in `returning` that owns travel with no convoy or a failed `monster-hunt` convoy, fresh members with protocol 4, no cancelled or dead member, no command from another convoy and no escape; it then keeps the native fallback flag and starts the return again (`http/hunt-control.ts:84-121`).

**HNT-029 Deaths.** `huntSafety.recordDeaths` returns the participants that died since the last count, without deaths on an event trip (`scripts/hunt-safety.cjs:42-74`, in HNT-059). Hunt clears the farm-area pause and pending move (`recovery.ts:100-103`), adds the deaths to the target's death count (`recovery.ts:84-94`), cancels its convoy, and below the threshold keeps the quest in `farming` with "Recovering after a party death; continuing the current Hunt" and waits for every member to be back within 800 of the destination (`recovery.ts:107-113`; `travel.ts:121-146`). At the threshold the mission is skipped and the cycle enters `blacklist-retreat` (`recovery.ts:114-122`). While a death recovery (`state.combatRecovery`) is active, Hunt only shows its reason, "Recovering after party death" by default (`tick.ts:58-61`). Death recovery itself belongs to spec 05.

**HNT-030 Blacklist retreat.** In `blacklist-retreat`, or while the current target is blacklisted, Hunt waits while an event return runs or any member is stale over 10 s or at an event, then rebuilds missions and advances (`recovery.ts:179-199`).

**HNT-031 Restart after an exhausted escape.** When an escape during a Hunt death recovery reports `recoveryFailed` for a fresh living member, Hunt cancels the recovery, releases the escape, starts a new cycle with the old return policy and location, and logs "restarting hunting routine due to failure", once per escape id (`retreat-restart.ts:29-83`). It waits while an event return, any convoy, or a member event field exists (37-42), and requires the recovery to match the current leader, focus and navigation revisions with no command on any member (30-36). Recovery hooks call it (`application.ts:1754-1774`; `navigation/recovery-hooks.ts:22, 66`).

**HNT-032 Route recovery.** When a `monster-hunt` convoy (or the Hunt's farm-recovery walk to the mission spawn) fails with code `route-failed`, the failure is recorded per destination and leader geometry (`route-recovery.ts:58-87, 223-244`). The first failure from a non-native planner gets one native-planner attempt; any other failure excludes the spawn (88-103), and Hunt tries the next spawn of the same monster that is not excluded or held (148-184). With none left it shows "No reachable <monster> spawn remains in this Hunt cycle" and holds (160-167). A changed geometry fingerprint, or a first failure whose text matches `preparationChanged` (`navigation/shared-departure.ts:57-60`), deletes the budget and cancels the active convoy (245-251; see B.5). Route recovery waits for farm pause, event return, escape, an encounter, a newer owner of any member, stale status, cancellation or member events (104-131). It also restores a mission spawn that the old farming retry owner replaced with a waypoint (285-303). A new cycle starts with no budget; the resume branch that deletes it is test only (HNT-111).

**HNT-033 Farm-recovery walk under Hunt.** The character's farm reunion starts a `shared-walk` with `walkingActivity: "farm-recovery"`. When Hunt owns that walk (same participants and revisions, not non-preemptible) and the quest becomes due or the walk failed, Hunt cancels it, resumes `farming` or `mission-travel`, and returns to Daisy if due (`farm-walk.ts:15-47, 95-105`). A failed farm relocation (pending reason starting `Travel failed:`) for the mission's own spawn, during `paused-event`, resumes mission travel (`farm-walk.ts:49-94`). An expired anniversary checkpoint yields to the Hunt turn-in, is marked superseded and its event trips end (`expired-anniversary.ts:5-24`).

#### Blacklist and backup farming

**HNT-034 Hunt settings.** Settings (`hunt/settings.ts:10-16`): `relocateIfCompeting` true, `blacklistDeaths` true with `deathThreshold` 1, `blacklistExpirations` true with `expirationThreshold` 1, and `preferredSpawns` (no default). Thresholds must be whole numbers of at least 1 (`settings.ts:29-41`). Failure counts keep growing while a threshold is off, and the settings route applies the saved counts when a threshold is turned on (`settings.ts:55-84`; `http/hunt-settings.ts:31`; test hunt-settings). Blacklists and counts survive Hunt restarts (`mode.ts:40-41`); the blacklist route (HNT-110) is the only way to remove them.

**HNT-035 Backup farming.** When no member has an eligible quest, Hunt cancels its convoy and enters backup with "Backup farming: waiting for all blacklisted quests to expire" (`lifecycle.ts:102-118`). Each tick shows how many members are ready (quest gone) and waits for fresh status (`backup.ts:176-201`). A member's eligible quest resumes normal assignment; when every member is ready Hunt moves to `batch-loot` and then picks up a whole batch at Daisy (`backup.ts:69-89, 202-206`; `quests.ts:303-323`). Meanwhile it travels to the backup area, which is the saved area if it still contains a focus monster and the focus is unchanged, else the leader's selection (`lifecycle.ts:52-70`; `backup.ts:123-173`). It does not start travel while fighting at the area or while farm travel recovers (130-139). Manual cancel, escape, death recovery and events pause it (`backup.ts:33-68`).

#### Wiring

**HNT-036 Composition.** `createCoordinatorHunt` wires the lifecycle, convoy, quests and tick around one state (`composition.ts:47-114`). The party copy is at `application.ts:445-478` and the Hunt actions at 718-744; `createSoloServices` repeats both for each independent character (`application.ts:1829-1861, 1943-1970`). `cancelCoordinatorHuntConvoy` cancels only a `monster-hunt` convoy and its Hunt commands; `clearCoordinatorHunt` also drops the Hunt's farm-recovery child walk and orphan Hunt commands (`controls.ts:55-78`).

### 1.2 Farming modes, focus and farm areas

Words used here: the **policy** (`farmingPolicy`) is what the user picked (auto, default, scatter, hunt). The **party mode** (`partyFarmingMode`) is what the coordinator tells characters this moment: `scatter` (each fighter takes its own target) or `default` (the party fights one queue together). **Focus** is the list of monsters to farm. The **farm area** is the saved spawn region (`party.location`) the party farms in.

#### Farming modes

**HNT-037 The farming mode route.** The dashboard posts a mode to the farming-mode route (http/hunt-mode.ts:70-86).
- Rules: only `auto`, `default`, `scatter` and `hunt` are accepted (hunt-mode.ts:73); anything else is a 400. Hunt also needs a leader and at least one Hunt participant, and either Daisy's location in the catalog or a participant holding a live quest; otherwise the route answers 409 (hunt-mode.ts:32-44, 75-76). Hunt needs a return location, and the backup focus (else the shared focus) must hold a monster other than `all`; otherwise the route answers 409 `backup_required` (hunt-mode.ts:52-61). A supplied backup with an empty focus or `all` is a 400 (`backupValue`, 14-23), and its area must match a catalog farm area exactly (hunt-mode.ts:79-84; `validFarmingLocation`, wired at application.ts:737). The route then hands the change to the Hunt mode owner (`modes.select`, hunt/mode.ts, HNT-001) and saves (hunt-mode.ts:62-63).
- The return location for Hunt is the Hunt's saved return location when already in Hunt, else the leader's waypoint (hunt-mode.ts:27-31).
- Settings: the mode itself; backup focus and location.

**HNT-038 Farming scopes: follow the leader or farm alone.** Every combat character either belongs to the leader's farming scope or owns its own scope with a full copy of the farming services.
- Rules: a character is a combat character unless it is the merchant or has class merchant (application.ts:2050-2052). `soloFor` builds services only for a combat character whose scope owner is not the leader, once per character (application.ts:2053-2058). `createSoloServices` builds, per character, farming navigation, party convoys, Hunt, farm areas, heartbeat response, event returns, observations and recovery routes, focus route, Hunt actions and navigation actions (application.ts:1784-2007), with a rare stub that never owns anything (application.ts:1787) and one-member name lists (application.ts:1786, 1794). `independentServices` lists the solo scopes of active combat characters other than the leader (application.ts:2008-2011); farm-area ticks and Hunt ticks loop over them (application.ts:2088, 2139).
- The scoped route sends a character's request to its solo service, to the follower save path (HNT-113), or to the leader's route, and adds `farmingOwner`, `savedFarmingPolicy` and `effectiveFarmingPolicy` to the reply (http/farming-scope.ts:14-48, wired at application.ts:2021-2030). On a route without a follower save path, edits for a merchant or a follower are refused with "Merchants do not run Monster Hunts" or "following leader settings" (farming-scope.ts:22-23, 31-34).
- Character commands read the effective scope of the named character (application.ts:948).
- Settings: Follow (followers map), leader.

**HNT-113 A follower's saved mode.** A follower's mode change only saves its future preference in its own profile and runs no controller (http/saved-farming-mode.ts:5-34).
- It accepts `auto, default, scatter, hunt` (line 12). Hunt needs a backup focus without `all` and a location that matches a catalog farm area (lines 19-25, 36-38); the focus and location then go into the profile too (26-29).
- It writes `profile.farmingPolicy` (30) and answers `savedOnly: true`.
- Settings: the follower's saved mode, backup focus and location.

**HNT-039 The coordinator picks the party mode.** On every full status report (combat-only reports take another path, ingestion.ts:117-118), status ingestion runs `observeScatter` for the reporter's scope (status/composition.ts:68-74; status/ingestion.ts:96, 131).
- Members are the active leader and followers, without the merchant (composition.ts:71-72). The leader's status is the authority, else the reporter's (composition.ts:73).
- A change of members after the first observation clears learned types, the party type and the break, bumps the scatter epoch and sets mode `default` (scatter.ts:31-41).
- While the mode is scatter and a party type is set, the first member whose combat deviation, target or attacker has an id and a different monster type than the party's type sets a **scatter break** (scatter.ts:43-70, 80-86). The break lasts until no member reports that monster id for 3 s (scatter.ts:87-90).
- The party monster type is the break's type, else the authority's `farmingMonsterType`, its target's type, or the first type this report newly taught (`learned[0]`, scatter.ts:117-120; status/catalogs.ts:94-98).
- Mode rule (scatter.ts:93-99): policy `default` gives default; policy `scatter` gives scatter; every other policy (auto, hunt, and the fork's achievements) gives scatter only when there is no break and the type is in the learned list. When the rare owner owns the scope, the mode is `default` (scatter.ts:123; application.ts:1062).
- Settings: the policy; Follow.

**HNT-040 Learning scatter types.** A character adds a monster type to its one-shot list when its own hit kills a focus monster with damage at or above the monster's full HP (characters/shared.js:1032-1044). It reports the list with the current epoch (shared.js:3075-3076). The coordinator appends new types only when the epoch matches and the id is word characters (status/catalogs.ts:83-99); a type repeated in one report is appended twice, which scripts/tests/coordinator-status-ingestion.test.cjs:20 asserts (`['rat','rat']`). A new epoch from the coordinator clears the character's list (shared.js:11390-11395). The comment at shared.js:1040 says the coordinator persists the learned type; initialFarmingState resets the list and the epoch on every start (navigation/initial-farming.ts:48-49), so learning starts over after a restart.

**HNT-041 The farming part of each heartbeat response.** `farmingResponse` (status/response.ts:215-229) sends: the character's focus, which is the Hunt target alone whenever the policy is `hunt` and Hunt has a target, else the shared focus for the leader and followers, else the character's own (`monsterFocus`, status/response-party.ts:94-101); the Hunt target, only when the policy is `hunt` and Hunt is in stage `farming`; the character's monster priorities; the leader's search radius (default 400); and the party mode, forced to `default` while the rare owner owns the party or a death recovery is not complete or cancelled (response.ts:222-227). The `rareEncounter` ports claimed with this behaviour (application.ts:556, solo 1911) feed `turnInPriority` in the travel response (response.ts:178-181, spec 01), not `farmingResponse`.

**HNT-042 The character applies the mode.** The heartbeat handler copies focus, priorities, radius, scatter types, policy, Hunt target and mode (shared.js:11374-11404). A focus change sets mode `default` for 3 s and clears the current target (shared.js:11376-11385). The mode is scatter only for non-merchants when the coordinator says scatter (shared.js:11402).
- `groupedFarming` (shared.js:14127-14133): inside the Cave every non-merchant groups; a dungeon-owned character outside the Cave does not; otherwise a non-merchant groups when the mode is not scatter (or the convoy is defending), it is the leader or follows it, and no event travel, joined event, event target types or event map applies.
- `getFarmingMode`, the port the role runner reads, returns `default` in the Cave and during a rare encounter, else the mode (shared.js:17952-17955).

**HNT-114 The character's farming monster type.** `calculateFarmingMode` (shared.js:14786-14819) runs on every snapshot (shared.js:2837), its only caller. It sets `farmingMonsterType` from the current target, the best visible focus monster in the area, the single focus monster, or the last type (lines 14795-14815), and the snapshot reports it (3070), which the coordinator reads as the party type (HNT-039). During a focus change reset, an event, `all` or empty focus, or on a merchant, it sets the type to null (14790-14793); during convoy defense, death recovery or a rare it returns early and leaves the type as it was (14787-14789). Its return value is discarded (2.2 B2).

#### Focus and monster selection

**HNT-043 The focus route.** The focus route (http/focus.ts:42-89) sets the monster list, priorities and search radius.
- Validation: at most 256 ids, word characters only, never `tinyp` (focus.ts:17-25); priorities 0 to 1000 (26-34); radius 1 to 10000 (35-40). `all` collapses the list to `["all"]`; duplicates drop (focus.ts:73).
- With a character name, `characterFocus` stores that character's focus, priorities and radius; for the leader it becomes the shared focus and clears every follower override (navigation/focus.ts:37-58). Without a name only the shared focus changes; priorities and radius are ignored and the reply shows radius 400 (navigation/focus.ts:78-81; http/focus.ts:58). A named character's radius stays as before unless sent; an empty focus resets it to 400 (navigation/focus.ts:22-26).
- Any change resets scatter: learned types, epoch, mode default, party type, break (navigation/focus.ts:30-36, 59, 81).
- A change triggers a farm-area focus relocation (HNT-052) unless an active Hunt owns the focus (navigation/focus.ts:62-69, 83). An empty focus invalidates the navigation intent of the whole party (no name or the leader) or of that character (navigation/focus.ts:84-87; application.ts:704-705, solo copy 1941).

**HNT-044 Focus and mode at load.** `initialFarmingSelections` takes focus from the new selections record, then the legacy settings, then `["goo"]` (initial-focus.ts:3-7, 15). The saved policy loads only when it is `auto, default, scatter, hunt`; any other value becomes `auto` (initial-focus.ts:22-24). `migrateSharedMonsterFocus` promotes a legacy leader override to the shared focus (migrate-focus.ts:9-18); `migrateEmptyFocusIntents` cancels intents for saved empty focuses when no intents were saved (migrate-focus.ts:21-40).

**HNT-045 A bestiary pick.** The monster-selection route (http/monster-selection.ts:28-49) refuses `tinyp` (31-34), a Phoenix pick without all five regions (35-36), an unknown id (37), and an offline leader (38-39). It resolves the location from the request or the nearest Hunt destination (40-43; application.ts:785-788) and releases a held dungeon, answering 409 when the release throws (44, 24-27). A convoy that does not start answers 409 after the reset below has already run (45-47; navigation/monster-selection.ts:65-68).
- `select` (navigation/monster-selection.ts:62-78) releases escape, replaces `farmAreaState` with only the preferred location, clears Hunt, sets policy `auto`, sets focus to the one monster, clears follower and leader overrides, resets scatter, and clears event returns, deferred returns and event sessions (44-61). It authorizes the whole party to the location and starts a `manual-monster-override` convoy (66-68), then marks every live event occurrence the members attend as skipped for manual travel, using the sessions saved before the reset (64, 69; spec 06 section 2.1), flags `party-monster-travel` commands as a manual override (70-73), and starts or stops the Phoenix patrol (74-75).
- Wiring: application.ts:781-800.

**HNT-046 Passive hunting settings.** The passive route validates the body with the rare owner's validator, refuses unknown monsters and `fieldgen0`, and hands the rules to the rare owner (http/monster-selection.ts:50-63; application.ts:797-798). The rare part of spec 07 describes what the rules do.

#### Farm areas and relocation

**HNT-047 Farm areas from the spawn catalog.** `zones` turns each focus monster's catalog spawns into areas and merges overlapping shaped spawns of the same monster on one map (dashboard/lib/farming-zones.ts:171-207). `farmingAreas` deduplicates identical regions and adds the intersection of overlapping areas of different monsters, so shared regions list several monsters; it sorts areas with more monsters first (farming-areas.ts:16-86). `contains` measures shapes by polygon distance (zero inside), an intersection area by its farthest member area, and point spawns by radius (farming-zones.ts:45-95). The coordinator, scripts and character load generated CommonJS copies of the same code (dashboard/lib/farming-areas.cjs, required at infrastructure/dependencies.ts:53; characters/farming-zones.cjs). `resolve` matches a saved location to its catalog area (farming-zones.ts:208-231). `validFarmingLocation` accepts only an area whose map, x and y equal the request exactly (farming-areas.ts:87-104). `defaultPhoenixOrder` maps five fixed points to areas (farming-areas.ts:5-13).

**HNT-048 Area membership on the character.** `inFarmArea` uses the zone shapes when loaded, else the search radius around the area point (shared.js:14870-14876); `inFarmRadius` uses the radius only (14909-14912). `selectFarmCandidates` keeps only the Hunt target type within the search radius of the character while the coordinator sends a Hunt target (Hunt stage `farming`, HNT-041); otherwise it prefers targets inside the area and falls back to the radius around the area point (14913-14921). `farmingEntryPoint` picks the walkable search point of a shaped area nearest the character, or nearest the area point when the character is on another map, and throws "No walkable entry point in selected farming zone" when none exists (15067-15078).

**HNT-049 Competition evidence on the character.** `observeFarmHit` records damage, kills and deaths that a non-party player deals to a monster inside the area, keeping the newest 20 (shared.js:14923-14934). `farmCompetitionObservation` counts live monsters by type and non-party players within the search radius (14935-14948). `observeFarmArea` remembers visible monsters and reports the area as fully observed when all four corners of its bounds are within 400 of the character (14949-14961). The snapshot sends all three (shared.js:3054-3056).

**HNT-050 Contested areas.** `record` (scripts/farm-area-control.cjs:8-28) reads each report's evidence, ignores the console's own characters (every managed worker, navigation/farm-composition.ts:37-38), hits older than 10 s or more than 1 s ahead, and duplicates, and marks an area contested for 120 s (`COOLDOWN`, line 2) after one kill or two hits within 10 s (19-21). A fully observed area is recorded as quiet (24-25). `prune` drops old entries (33-37); the coordinator also prunes saved farm-area records at load (application.ts:24-30). `alternatives` excludes the active area, excluded areas and contested areas, and ranks same map first, then more monsters, then quiet, then distance (farm-area-control.cjs:38-43). `fighting` is true for a fresh living member with a live threat or a target it can attack or attacked within 3 s (3-7).

**HNT-051 Relocating away from a competitor.** The farm-area owner ticks at most once a second (navigation/farm-areas.ts:257-272; application.ts:2086-2089, solo scopes included), and skips while the rare owner owns travel (258), while Hunt is in mission travel or owns the route (254-256, 266), and while the dungeon owns the party (application.ts:2087).
- Each tick records evidence (HNT-050), then stops when any member is stale, dead, cancelled or at an event, or an event return or escape runs (farm-areas.ts:240-245).
- `movement` (173-194) stops, when the policy is Hunt, while Hunt's turn-in or an event return, a non-Hunt convoy or an open anniversary cycle holds travel (`workflowOwns`, 196-198, with `huntPolicy.eventOwnsTravel` wired at application.ts:402-403 and navigation/farm-composition.ts:39; asks 01). Failed-convoy recovery runs next (185, HNT-053); then it stops while any convoy runs or farming is paused (186), and outside Hunt stage farming (191).
- `relocateBusy` (144-171) applies only to shaped areas and intersection areas (151). A contested area counts as busy only 120 s after the last move (117-120). `competitionHold` (farm-competition.ts:65-97) holds the move when Hunt's `relocateIfCompeting` setting is off, when any member lacks a fresh matching observation, when any member still sees a focus monster (the Hunt target under Hunt), or when the competitor is no longer seen. Otherwise the best alternative becomes a pending relocation with the members' intent revisions (farm-areas.ts:156-170; farm-area-recovery.ts:10-23); with no alternative it shows "Sharing this zone; no uncontested alternative observed" (157-160).
- `processPending` (121-142) drops the pending move when a member's revision changed, cancels a conflict move whose hold returns (109-116), waits for its start time, and waits for travel defense to be clear. `startPending` (80-107) sends a Hunt mission to the new area through Hunt's convoy, or authorizes the party and starts a `farm-relocation` convoy.
- Settings: Hunt setting `relocateIfCompeting`; search radius.

**HNT-052 Moving after a focus change.** `focusChanged` (farm-areas.ts:273-293) does nothing in Hunt. Otherwise it first drops an earlier pending focus-change move (276), then stops for a custom waypoint, an empty or `all` focus, a focus that still includes a farmed species, no members, or any cancelled member. Otherwise it queues a pending move to the best alternative for the new focus, marked `focusChange`, and waits for other owners (comment 287-289).

**HNT-053 Failed farm travel.** When the active convoy failed and its purpose is none, `monster-hunt`, `farm-relocation` or `empty-spawn-recovery` (farm-areas.ts:200-216), recovery runs (farm-area-recovery.ts:86-115):
- A stale empty-spawn convoy is cancelled (26-31, 95).
- The failure is transient when its text matches a regex with 12 alternatives (`geometry`, `restarted`, `interrupted`, `runtime`, `owner`, `unavailable`, `dead`, `formation`, `cruise`, `command lost`, `prepared route lost`, `movement lock`; 71-74); otherwise the area's failure count goes up (75).
- A `geometry-mismatch` failure is recorded, then pauses farming with no retry (96-99).
- Otherwise the convoy is cancelled and a pending move is queued: the same area after 10 s for transient failures, after 2 s for counted ones, or, once this area has more than one counted failure, the best alternative that has not failed more than once (47-65, 102-111). With no destination a Hunt mission is skipped and advanced, else farming pauses with "Farming travel paused: no reachable zone; select a farming area to retry" (32-45). The Hunt branch cannot run: `tick` returns for stage `mission-travel` before recovery (farm-areas.ts:254-256, 266), and `failed` is reached only from `tick` (2.2 B7).
- `clearArrivedFailure` (farm-areas.ts:54-78) clears the last failure once every member is inside the area plus 150.

**HNT-115 Upgrading the saved farm-area state.** Two upgrades run on the farm-area owner's own path.
- `migrate` (farm-areas.ts:24-32) runs on every tick and on a focus change (264, 283) but changes state once: a record without `recoveryVersion` 2 has its pause, failures, pending move and message cleared, and is marked version 2.
- `promoteShape` (farm-areas.ts:34-40) runs on every observed tick (227): when the catalog area is shaped and the saved `party.location` is a point, it replaces the location with the shaped area and also writes the current Hunt mission's destination (2.2 B8).

**HNT-054 Recovering to the saved spawn.** The leader's client (`pollFarmingSpawnRecovery`, shared.js:17665) can ask the farming-return route to walk the party back (http/farming-return.ts:83-99); only the online leader may ask (87-91). It refuses when another owner holds travel: any convoy, the Phoenix patrol, a rare encounter, an event return, a pending farm move, an active Hunt, an open anniversary cycle, scatter mode, a cancelled intent, or any event field on the leader (38-59; asks 01). It skips when the leader is inside, refuses while any active non-merchant member has a target or within 10 s of the last request (26-37), and starts an `empty-spawn-recovery` convoy and logs it to the leader's combat log (60-82). The route has no dungeon check (2.2 B9).

**HNT-055 Handing a farming convoy to combat.** `engageFarming` lets the leader's report of a focus target inside the destination end a farming convoy early (navigation/farming-engagement.ts:5-24). It applies only to purposes none, `party-travel`, `farm-relocation`, `manual-monster-override` and `empty-spawn-recovery`, not to conflict moves, forced travel, a convoy without `combatHandoffAllowed` or one that already engaged, and only in phases `shared-prepare`, `scheduled` and `travel` (39-42), and only with matching revisions and commands (43-50). If every member is already in place the convoy ends; otherwise it switches to defending (16-23). On the client, `pollFarmingCombatHandoff` stops following the leader and targets a reachable farm target when no other activity owns movement (shared.js:17652-17664).

**HNT-056 Farming waypoints and intent.** Each member has a navigation intent with a revision and a cancelled flag, and a waypoint: its own location or the shared `party.location` (scripts/farming-navigation.cjs:7-23). `authorize` first invalidates the members (a new revision), then clears the cancellation, sets the destination, copies the new waypoint into every open event owner, and releases those members from a manual Town cycle (127-150). `invalidate` bumps the revision, cancels the intent, drops six travel command types, ends the member's open Hunt event trip unless the reason is a new destination, and cancels a convoy that includes the member, restarting it for the rest when the leader remains (82-126). A Hunt participant's "monster focus cleared" cancellation is ignored while Hunt owns the destination (11-13). The event return dispatch in the same file belongs to spec 06.

**HNT-057 Farming state at load.** `initialFarmingState` restores farming profiles, Hunt, Hunt settings (over the defaults) and failures, passive rules, Phoenix order and checkpoint, rare return, retry evidence and progress (capped first, 24-27, 31), the farm-area record and the blacklist, and resets scatter learning, party mode and the Daisy location (navigation/initial-farming.ts:30-54).

**HNT-058 Rejoining the farm after respawn.** The role runner's `rejoinFarm` port calls the shared routine's farm reunion (runtime/characters/roles/runner.ts:79).

#### Monster Hunt support on the farming path

These are Monster Hunt behaviours that live in farming files; section 1.1 refers to them.

**HNT-059 Hunt safety helpers.** `missionDestination` pins the current mission's destination once resolved (scripts/hunt-safety.cjs:1-5). `acceptArrival` turns a matching `monster-hunt` convoy arrival into stage `farming` (or `backup-farming` for backup travel) and records an arrival handoff (9-28). `arrivalProtected` keeps the handoff for 10 s while the cycle, mission, target, leader, revision, runtime and destination still match (29-41). A convoy arrival that matches a held encounter sets `farming` with "Fighting encountered <target>" and no handoff (15-21). `partyFighting` checks for a fresh living participant with a live target it can attack or a live threat (75-82). Wiring: application.ts:461-477 (HNT-019).

**HNT-116 Counting Hunt deaths.** `recordDeaths` (scripts/hunt-safety.cjs:49-74, wired at application.ts:465) counts a fresh participant's death once, on the dead edge or on a new `lastDeath` report after the cycle start and more than 2 s after the last count. `eventDeath` (42-48) skips a death inside an event trip, or one reported while the member is joined to an event. A counted death clears the arrival handoff and raises `deathCount`; a skipped one is still consumed (67-68). Hunt's use of the result is HNT-029.

**HNT-060 Hunt arrival at the spawn.** When every Hunt participant is fresh, alive and inside the mission area, `stepHuntArrival` holds the convoy (`shared-hold`), waits until every member reports phase `held` and is stopped on the runtime recorded at the hold, then deletes the commands, ends the convoy and sets stage `farming` (navigation/hunt-arrival.ts:42-48, 50-71, 78-88). Event returns, escape, route relocation, merchant interruption and geometry waits block it (12-15); an unfinished convoy loot pass waits (55, 90). A member drifting out after the hold resumes the route (96-103).

**HNT-061 Hunt acquisition while travelling.** On a Hunt convoy the character picks the nearest monster of the Hunt type that passes `huntCandidateRejection` (visible, alive, same map, in radius, allowed, in range or reachable) (shared.js:15029-15039, 15040-15058); in scatter mode it tries monsters no other member targets first (15046-15049), and it does nothing on a conflict move or a command without combat handoff (15041). It stops while dead, cancelled, escaping or at an event (15022-15028), and logs the reason, at most every 2 s per channel and every 10 s for a repeat (15008-15021).

**HNT-062 Planning the Daisy return.** `planHuntReturn` prepares the route twice, walking only and with Town allowed (once only when Town is disabled), scores each by time (Town 7000, transport or leave 1000, a map change 1000, walking by distance over the slowest speed), and turns the cheaper plot into walk and Town legs with saved segments (shared.js:15723-15773). With no route it throws "No route to Daisy could be prepared".

**HNT-063 Daisy's location.** The coordinator keeps the `monsterHunterLocation` a character reports only when it is on map `main` with finite x and y (status/catalogs.ts:30-39).

**HNT-064 Hunt loot hold on departure.** `huntPending` holds departure while a convoy defense loot hold runs (73), or while the mission is active, the character is a participant, and the mission has a loot barrier, batch pickup, a return or turn-in stage, a matching loot or final kill, or every owner's quest is complete; capacity recovery releases it during farming (runtime/combat/departure-loot.ts:72-81). The `questFor` port reads a peer's quest from fresh party positions (shared.js:17983).

**HNT-065 Hunt change detection.** Status ingestion snapshots the Hunt record without its message before and after the Hunt and farm-area ticks and saves only on a change (status/composition.ts:101; status/ingestion.ts:91-94).

### 1.3 Rares and Phoenix

A "rare" is one of six monsters the party drops its current work for: Fairy (`tinyp`), Phoenix,
Golden Bat, Cute Bee, Hen and Rooster (rare-hunting.ts:29-44). One coordinator owner,
`createRareHunting` (rare-hunting.ts:69-939), runs two activities: a rare encounter (chase, fight,
loot, go back) and the Phoenix patrol (walk the five Phoenix regions until one shows up). It is
built once for the party in application.ts:1776-1780. This catalog claims 88 of the 102 indexed
functions in rare-hunting.ts; spec 01 holds the five protection checks (GRP-017) and spec 02 the
nine convoy and control functions (MOV-148 to MOV-150). Section 6.4 lists the rest.

#### Rare sightings and kills

**HNT-066 Characters report rares; the coordinator keeps fresh sightings.**
- Each heartbeat carries `rareSightings`, `rareObservation`, `rareFields` and `rareKills`
  (shared.js:2868-2873). `rareSightings()` lists visible, living monsters whose type is an enabled
  passive rare or Phoenix, skipping passing encounters, sorted by priority, at most 64
  (shared.js:3538-3550). `rareObservationReport()` wraps them with the runtime id, map, instance,
  server and position (3551-3555). `rareFields()` lists live field generators (`fieldgen0`,
  3556-3560). A kill of a remembered rare id appends to `rareKills`, newest 20 kept
  (shared.js:1009-1014).
- The coordinator accepts a report only from a party member that is not the merchant and is fresh
  within 3 s (rare-hunting.ts:338-345, FRESH 3000 at 45). The members are the Hunt participants
  (`recoveryHooks.rare.members`, navigation/recovery-hooks.ts:29). An observation must match the
  member's `combatSelection.runtimeId` and be at most 3 s old and 1 s ahead (358-361). A sighting
  needs a known type, a string id, `visible`, finite x and y, and finite positive hp (294-297).
  Sightings are keyed `realm|map|instance|id` (49-50) and dropped after 30 s; cooldowns and kill
  memory expire on the same pass (697-701). A kill counts only within 10 s of now (326-328) and is
  remembered 120 s (333).
- Settings: the passive rules decide which types are reported (HNT-068).

**HNT-067 Three paths feed and tick the rare owner.**
- Status ingestion calls `rareReport` then `rareTick` for every full heartbeat
  (status/ingestion.ts:87-88, wired at application.ts:1072-1073). The fast combat report does the
  same (status/combat-ingestion.ts:51-52) through the same ports (status/ingestion.ts:61), and
  keeps the older `rareObservation` when a report from the same runtime carries an older one
  (`preserveRare`, combat-ingestion.ts:16-23). The travel clock ticks it every 250 ms
  (navigation/runtime.ts:77-83, wired at application.ts:1743). `setSettings` ticks it once more
  (rare-hunting.ts:932-937).
- The two wired ticks skip while a dungeon owns the party (application.ts:1073, 1743).
  `setSettings` calls `tick()` directly, so a passive settings change ticks the owner during a
  dungeon visit (rare-hunting.ts:935).
- Order of one tick (rare-hunting.ts:862-880): restore saved rejections, expire observations, stop
  if the encounter or patrol owner snapshot no longer matches, pause for protected activity,
  restore a saved patrol, take a patrol sighting, run the grouped path or the farming return (the
  tick ends there when either acts), take a passive sighting, then step the encounter or the
  patrol, then publish `party.rareHuntState`.

#### Which rares the party hunts

**HNT-068 Passive rare rules.**
- The user sets per rare: enabled, priority, maximum level, "keep moving", and one global "use
  field generators" (dashboard passive hunting menu; validated and saved through
  application.ts:797-798 to `rareHunting.validPassiveSettings` and `setSettings`,
  rare-hunting.ts:932-937, 940). `party.passiveRareHunts` is the committed on/off map
  (rare-hunting.ts:101-102, 934).
- Priority comes from the saved rule, else the built-in table (101 Fairy, 100 the rest), else 100
  (rare-hunting.ts:104). A type counts as known if it is in the built-in table or enabled, never
  `fieldgen0` (105).
- An encounter stays enabled while its rule is on and its level is at or under the cap, or while
  it is a Phoenix the patrol is assisting, or while grouped combat has locked it (`enabled`,
  550-552; `passiveLevelAllowed`, navigation/passive-settings.ts:6-9).
- On the character, `passiveLevelAllowed` treats a missing cap or -1 as no cap and otherwise needs
  a level at or under the cap (shared.js:3491-3494), and `passiveRareCandidate` makes an enabled
  rare, or a Phoenix while focus includes `phoenix`, a combat candidate that bypasses focus and
  farm-zone rules (shared.js:14300-14302, used at 14283-14298).
- The constructor runs two migrations on every start: passive settings from the old
  `passiveRareHunts` shape (rare-hunting.ts:101-102), and removing `tinyp` from saved focus lists
  (107-111).

**HNT-069 Passive acquisition.**
- A sighting is eligible when it is known, its retry evidence allows it (HNT-074), it is not a
  "keep moving" rule (those are passing attacks, spec 02/04) unless it is a Phoenix while a patrol
  exists, it has no cooldown or kill memory, grouped combat holds no external claim on it, and its
  rule is enabled (rare-hunting.ts:730-754).
- Passive acquisition takes only sightings that are fresh, from a member, on the leader's map,
  instance and realm (816-824), whose target is not a non-member (477-479), and whose priority is
  at least the priority of the leader's current target (rare rule priority when that target is a
  committed passive rare, else the leader's monster priority, default 50; 0 with no target), or
  strictly higher than the current encounter's while that encounter is not looting (825-838). It
  picks the highest priority, then the nearest to the leader (843-848).
- It does not run while grouped combat has fights, and in grouped mode it runs only while the active
  convoy is `farm-relocation`, `monster-hunt`, `manual-monster-override` or `party-travel`
  (839-842).

**HNT-070 The rare owner yields to protected activity (asks 01).**
- `protectedActivity` is true when the leader is missing, stale over 3 s or dead, Town is cycling,
  an event return or open anniversary cycle exists, death recovery is open, Hunt loot is
  unfinished, an escape is not released, Hunt owns a turn-in, or any member is protected
  (rare-hunting.ts:141-159). A member is protected when joined to or travelling to an event, dead,
  or under 35% HP (137-138). It is also protected when it runs any command other than
  `party-monster-travel` or `event-resume-travel`, or one of those two without a purpose or with a
  purpose outside six travel purposes (118-133).
- While protected, the tick ends any encounter that grouped combat has not locked, cancels rare
  travel, holds the farming return and shows a waiting message (702-719). `control()` sends no
  rare control in that state unless grouped combat has locked the encounter (894-896).
- Which activities win over rares is a precedence rule for spec 01; this spec only records the
  current list.

#### Rare encounter

**HNT-071 Beginning an encounter.**
- `begin` asks Hunt to reconcile its arrival, writes `rare:<type>` as the interruption on Hunt's
  travel checkpoint (rare-hunting.ts:395-397, 372-375), and cools down any previous encounter for
  3 s (400).
- It keeps the active convoy when that convoy is interruptible travel or already carries a
  `huntTravel` reason, and adds the rare to that convoy's `huntTravel.committed` list, sets it as
  `primary` when no primary exists, and sets reason `passive-setting`; otherwise it cancels the
  convoy (376-388). `interruptibleTravel` (runtime/combat/hunt-travel.ts:18-22) accepts any convoy
  that is not forced, navigation exempt, non-preemptible or a continuous return, not one of six
  purposes (`escape-recovery`, `franky-exit`, `event-return`, `rare-hunt`, `phoenix-patrol`,
  `shared-walk-return`), and not a `monster-hunt` convoy without a Hunt target.
- It sets `partyFarmingMode = "default"` so scatter farming fights the rare as a group (403-405),
  clears `scatterBreakTarget` (426), and records the encounter with an owner snapshot (leader,
  realm, focus, policy, each member's navigation revision; 171-179), the return location and the
  current Hunt (406-422). It restores saved pursuit progress for that monster id (212-216) and
  saves the farming return obligation (389-391, called at 424).
- Any change to leader, leader realm, focus, farming policy or a member's navigation revision ends
  the encounter: the tick stops it as "Rare route superseded" (865-867) and `tickEncounter` as
  "Rare pursuit cancelled by new navigation" (555-557); `validIntent` is at 160-170.

**HNT-072 Encounter stage and movement.**
- In grouped mode, grouped combat moves the party; the stage is `combat` once the fight is locked
  (rare-hunting.ts:511-514). Outside grouped mode, the stage is `combat` once the leader's own
  sightings show the rare (504-510, 515-517); otherwise the owner starts a `rare-hunt` convoy to the
  sighting, at most every 3 s, only when no convoy is active (518-523).
- Progress resets when the rare's hp drops (467-476) or when a member's fresh approach report shows
  it closing in by at least 8 units of deficit or waypoint distance after moving 2 units
  (rare-progress.ts:3-22).
- The message reads "Pursuing" or "Fighting" plus the name, and for Fairy the generator state (576).

**HNT-073 Bridge to grouped combat.**
- scripts/rare-combat.cjs reads `party.groupedCombat`: grouped means not scatter, more than one
  member, and some member on protocol 4 (9-10); selected, queued, locked, engaged, killed and
  claimed compare by id, map, instance and realm (7-20). `current()` turns the grouped target into
  a sighting with placeholder hp 1 (55-60).
- `release` removes the rare from the convoy's committed list and, when rejected for good, marks it
  rejected there; it adds a rejection to `groupedCombat.rareRejections` (kept at least 120 s) and
  removes the rare from evidence, fights, queue and target unless a member attacked it in the last
  3 s (rare-combat.cjs:33-54). `allow` and `rejected` undo and test that mark (21-32).
- In grouped mode the owner adopts grouped combat's current target when it is eligible
  (rare-hunting.ts:795-800), ends the encounter when the target is claimed outside the party before
  engagement (775-777, 780-781), and ends it as "selection released" when grouped combat no longer
  selects, queues or locks it (760-774). A new nomination waits up to 10 s, or until every member
  acknowledges the queue revision, before a missing selection counts as released (755-769).

**HNT-074 Expiry and rejection memory.**
- An unengaged encounter ends when claimed outside, targeting a non-member, or unseen for 3 s
  (rare-hunting.ts:480-483). Any encounter ends at 30 s unseen, 300 s total or 30 s without progress
  (497-503). While grouped combat does not select the rare, a member fighting some other attacker
  keeps progress fresh (488-496).
- An encounter that ends with "selection released", "no progress" or "time limit" in its reason text
  stores a retry rejection (267-269). A rejected rare can start again only after a newer sighting
  with lower hp, new party engagement or new reachability on the same map
  (rare-retry-evidence.ts:31-39). Saved rejections are re-applied to grouped combat on every tick
  (rare-hunting.ts:859-861) and at construction (90).
- Pursuit progress (start, progress, lowest hp) is saved per monster id (217-222). Both records
  keep the newest 100 entries (rare-retention.ts:8-17).

**HNT-075 Fairy and field generators.**
- For Fairy the nearest member holding `fieldgen0` becomes the deployer unless the user turned
  generators off (rare-hunting.ts:362-371, 427-431). Outside grouped farming the deployer walks to
  the Fairy; within 200 it equips the generator once per encounter (shared.js:3663-3680). In
  grouped farming the deployer acts only when already within 200 of a visible Fairy and grouped
  combat does the moving (3653-3656). The coordinator marks "field active" when any fresh status
  on the Fairy's realm, map and instance reports a generator within 300 of it
  (rare-hunting.ts:433-447, 542-549), and falls back to ordinary attacks 3 s after the deployer's
  report without a field, on a failed deployment, or 20 s after the start (527-541).
- The 300 matches the game: a projectile at an escapist monster (Fairy is `escapist`, game
  design/monsters.js:1104) ports it away unless a `fieldgen0` is within 300 (game
  node/server.js:3620-3630).
- The attack rule that keeps projectiles off an unprotected Fairy is target choice
  (shared.js:3608-3642, spec 04).

**HNT-076 Kill and loot.**
- The rare counts as dead on a loot stage, kill memory or a grouped death record (rare-hunting.ts:448-450).
  A death without confirmed party engagement ends the encounter without loot (451-457). With
  grouped fights still running it waits "Finishing party combat before rare loot" (458-464).
- Loot: the stage becomes `loot` and `killedAt` is set (615-621). Every member whose control is
  current gets `kind: "loot"` and walks to the kill spot; at 30 units `pollRareLoot` runs the loot
  client's rare pass (shared.js:3683-3686, 3705-3715). The loot client loots as soon as the member
  is within 180 of the spot (HNT-108). The encounter finishes on the leader's `rareLoot` receipt for
  this encounter id at the same realm, map and instance, observed after `killedAt`
  (rare-hunting.ts:578-594), or on a retained convoy's loot pass that started after the death
  (595-614).
- `finish` stores rejection evidence, clears progress for a kill or a rejected rare, cancels rare
  travel, sets a 3 s cooldown unless killed, releases the target in grouped combat and restores
  farming (243-260).

#### Return after a rare

**HNT-077 Back to farming or to the Hunt mission.**
- `restore` writes the saved return location back to `party.location` and stores
  `party.rareHuntReturn` (rare-hunting.ts:223-242). It skips both when the encounter rode a
  retained convoy (224) or when the owner snapshot no longer matches (225), and skips the return
  during a patrol (227-230).
- scripts/rare-farming-return.cjs: the return clears itself when leader, focus or policy changed,
  the leader left, or the leader's fresh realm differs (24-32). It waits while paused or while the
  leader is stale (33-35). If it saved a Hunt and Hunt is still the same cycle, it sets
  `hunt.convoyId = null`, moves `farming` back to `mission-travel` and hands travel to Hunt (36-43).
  Otherwise it finishes when every remaining member is within 180 of the location or of its
  shape (17-23, 45-48), never preempts another convoy (49-53), and starts a `rare-hunt` convoy
  "Resuming farming" for online members every 5 s at most (54-64). Offline members stay in the
  obligation (60-61).

#### Rare owner ports

**HNT-078 What other owners ask.**
- `owns()` is true during an encounter, a patrol, or a farming return still moving
  (rare-hunting.ts:918). Farm areas (application.ts:392), the heartbeat response (563) and status
  ingestion's scatter rule (1062, scatter.ts:123) read it. `encounter()` pauses Hunt
  (hunt/tick.ts:88, 95-99; wired at application.ts:454). `blocksPulls()` holds pulls while the rare
  is dead or looting (926-930; wired at application.ts:2426).
- A party death calls `abandon()` through recovery hooks (application.ts:1772), which drops the
  encounter and the return without cooldown (920-925). `stop()` drops everything and cools the
  target 3 s (270-283).

**HNT-120 Recovery hooks wire the rare owner.**
- `createCoordinatorRecoveryHooks` gives the rare owner the Hunt participants as its members, the
  navigation intent, Hunt turn-in priority, convoy start and cancel, and persist
  (navigation/recovery-hooks.ts:28-34; spread into `createRareHunting` at application.ts:1776).
- It also passes `rare.resumeHunt` (35-44), which resets a Hunt cycle to `checking-quests`. No
  code in rare-hunting.ts or rare-farming-return.cjs calls it (B10).

**HNT-079 Independent characters have no rare owner.**
- `createSoloServices` gives each independent character a stub whose `owns`, `encounter` and
  `control` return false or null (application.ts:1787), and wires it into Hunt (1838), farm areas
  (1875) and the heartbeat (1907, 1911, 1918) like the party one.

#### Heartbeat control and client legs

**HNT-080 rareControl and the client.**
- The heartbeat sends `rareControl` per member (application.ts:552; status/response.ts:246, 265):
  for an encounter its id, kind (`encounter` or `loot`), target, destination, deployer, generator,
  kill time, Phoenix assist flag and that member's revision (rare-hunting.ts:881-893); for an
  unpaused patrol past its retry time the current scan point (900-910).
- The client stores it from the full heartbeat (shared.js:11222-11226) or from the combat-only
  response (`acceptRareCombatControl`, 3561-3579). A new encounter during a `phoenix-patrol` convoy
  stops that convoy locally when the response has no convoy signal (3570-3578). Control is current
  for 3.5 s, while the navigation revision matches and the character is not dead, in Town,
  travelling to or joined to an event, or escaping (3580-3584). An unfinished fight on a different
  target suspends it (3585-3590).
- `pollRareHunting` (shared.js:3649-3703), called from the role runner (runtime/characters/roles/runner.ts:224):
  patrol control only holds the character (3652); in grouped farming the poll acts only for the
  Fairy deployer within 200 of a visible Fairy (3653-3656); any convoy, bank, stock, upgrade, forced
  or Town travel wins (3659); otherwise it walks to the destination with `smart_move`, gives up
  after 30 s with "Rare route timed out", and stops at 30 units, where loot control loots
  (3683-3701).

#### Phoenix patrol

**HNT-081 Starting, restoring and stopping a patrol.**
- Picking Phoenix as the farming target with a region order starts the patrol
  (application.ts:784, 794-795; navigation/monster-selection.ts:74-75 to rare-hunting.ts:284-293).
  The order must name each of the five catalog Phoenix regions exactly once, and the catalog must
  have exactly five (rare-hunting.ts:53-68). The game defines one Phoenix spawn with five
  boundaries, one of which the server picks at random on each spawn (game design/maps.js:650-661,
  a sixth `tunnel` boundary commented out at 657; node/server.js:13491-13497).
  `party.phoenixPatrolActive` and a checkpoint (leader, realm, focus, policy, revisions, region,
  respawn time) persist it (625-630, phoenix-patrol.ts:50-60); after a restart `restorePatrol`
  rebuilds it at the saved region (rare-hunting.ts:720-729).
- The patrol stops when the owner snapshot changes, the policy becomes `hunt`, or focus is anything
  but exactly `phoenix` (631-640).

**HNT-082 Scanning the regions.**
- Each region gets a serpentine list of scan points with half-widths 550 by 350 and a step of 1.7
  half-widths (phoenix-patrol.ts:16-32), and 60-unit sample points that count as covered when a
  fresh observation from a living member on the region's map and realm falls within 570 by 370
  (4-13, 112-133).
- The whole party travels each leg by a `phoenix-patrol` convoy (rare-hunting.ts:651-653,
  phoenix-patrol.ts:209). Arrival is within 40; the leg completes 1 s after arrival once the
  convoy is gone, and the region ends when every sample is covered (171-188).
- A failed convoy or 30 s without 10 units of movement is a failure (134-147, 224-228). From a
  point's second failure on, each failure adds one of four 200-unit offset points, clamped inside
  the region; after four the region is skipped as incomplete (148-170). All five incomplete pauses
  the patrol "All Phoenix regions unreachable" (95-111). A runtime reload failure retries the same
  point after 5 s (214-223).

**HNT-083 Phoenix sightings during a patrol.**
- During an unpaused patrol with no encounter and no grouped fights, any fresh, eligible Phoenix
  sighting on the leader's map, instance and realm starts an encounter, nearest first, while no
  convoy other than `phoenix-patrol` runs (rare-hunting.ts:851-858). Phoenix needs no passive rule
  then (`assist`, 656-658; used at 454, 478, 552 and 660) and the client gets `allowPhoenixAssist`
  (890, 905).
- While the patrol runs and acquisition is allowed, grouped combat receives each member's fresh
  Phoenix observations as candidates at priority 100.5 (phoenix-candidates.ts:5-24, called at
  navigation/grouped-snapshot.ts:222-223).

**HNT-119 The respawn wait after a Phoenix.**
- After a Phoenix kill, or a death without engagement during a patrol, the patrol waits until 35 s
  after the death in the current region, or plans routes to all five and picks the shortest
  reachable (rare-hunting.ts:662-696; phoenix-patrol.ts:231-252; route distance with 400 per map
  change, rare-route-distance.ts:3-28). No reachable region pauses the patrol (688-691).
- The game respawns a Phoenix 32 s after death plus up to 0.9 s (game design/monsters.js:450-451
  `respawn: 32`; node/server.js:13428), so the 35 s wait has about 2 s of margin.

### 1.4 Cave and daily dungeons

The Cave of Many Dreams is the game's daily dungeon. The console runs it as a manual visit: the user presses Enter on the dashboard, the coordinator takes the party, walks it to the Cave keeper Dorr in Main, sends it in, and from then on issues commands to the members (gather, enter, move, vote, buy, talk, stairs, revival, exit). Each character runs its command, records a receipt, and reports what it sees. All file:line cites are on `refs/review/ryan-1.5` unless marked. Game rules are cited from the local game server copy at (local checkout) (commit 43b2c8fc) as `game <path>:N`.

The coordinator half lives in `runtime/coordinator/dungeons/` (service.ts, travel.ts, progress.ts, priest-recovery.ts, combat.ts) with the shared types and the ownership test in `runtime/dungeons/contracts.ts`. The character half is `runtime/characters/dungeons.ts`, `cave-request.ts`, `dungeon-journal.ts`, wired into the character by the dungeon block in `characters/shared.js` (2595-2814). Priest healing and reviving on the character (`runtime/characters/cave-recovery.ts`, `shared.js` caveRecovery 2658-2694) and Cave target rules (`dungeonTargetAllowed`, `getDungeonTarget`, `dungeonCombatThreat`, `dungeonEncounterEnemy`, shared.js 2608-2638) are proposed to specs 05 and 04; this spec only names them ("asks 05", "asks 04"). Movement legs inside the cave (`dungeonRuntime>travel`, `sharedRoute`, `move`, shared.js 2744-2789) are proposed to 02 ("asks 02").

How the dungeon's ownership stops other parts of the console is a precedence question for spec 01 (GRP-018, section 2.6); the facts are listed after **HNT-084** and in B.1.

#### Visit owner and phases

**HNT-084** One saved visit record per party.
- `createDungeons` keeps `party.dailyDungeons` and creates it on first use with `protectFromEvents: true`, phase `idle`, no participants, no commands and no operation ids (service.ts:21-28).
- A member's status counts as fresh for 3000 ms (service.ts:30-31). Entry, release, `perform` and the reconcile pass read freshness; the entry roster uses a 10 s window instead (**HNT-085**).
- `issue` writes one command per named member with id `<operation>:<name>` and calls the `persist` port (service.ts:53-62).
- `dungeonOwns(party, name?)` is true for every phase except `idle`, and with a name only for participants (contracts.ts:142-145). Phases are `idle, gathering, entering, active, exiting, held` (contracts.ts:107).
- Settings: `protectFromEvents` (see **HNT-090**).

Facts for 01 (GRP-018 holds the gate). While `dungeonOwns(party)` is true:
- The travel clock skips escape, death recovery, rare hunting, event return and anniversary return (application.ts:1741-1745), and status ingestion skips the rare tick (1073).
- The party's farm areas and Monster Hunt skip their tick (2087, 2138); the solo services' loops do not check the dungeon (2088, 2139-2143).
- Merchant jobs that target a participant do not start (merchant/dispatch-composition.ts:143).
- The party actions Travel and Resume call `release` first and answer 409 when it throws; Town and Escape try `release` and otherwise send an exit (http/party-actions.ts:62, 105, 137, 141, 145-156).
- A participant gets grouped combat in its heartbeat (application.ts:1095), and the grouped snapshot builds the Cave queue instead of the farming one in any phase but idle (navigation/grouped-snapshot.ts:110-113).
- On the character, an owned runtime skips the rest of the heartbeat after applying the combat queue (shared.js:11158-11168) and death recovery neither respawns nor runs (characters/roles.js:2623-2624, runtime/characters/roles/runner.ts:67-69).

**HNT-085** The entry roster is the leader plus followers seen in the last 10 s, never the configured merchant, at most three, and the in-game party must match.
- `candidates` takes the leader and every follower seen in the last 10000 ms, minus `merchantCharacter`, without duplicates (service.ts:44-52). The comment at 45 says the 10 s window matches roster presence and entry still requires 3 s freshness. A follower of class merchant that is not `merchantCharacter` is not removed.
- `validateCandidates` needs the leader first and at most three names (service.ts:99-102). The game refuses entry with `party_too_large` when the in-game party has more than three members (game node/logic/generated_maps.js:465), and it takes the whole in-game party of the entering player (459-461, 482-486).
- `validateLaunch` asks the application port `canStart`, which refuses while the merchant is visiting one of the names (application.ts:164-166), then checks the in-game party unless every member resumes a visit (service.ts:95-98).
- `validateParty` needs every member `ready` (out of combat and loot), the in-game leader equal to the first participant, and the in-game member list equal to the participants; a lone member with no party passes (service.ts:189-202).

**HNT-086** Manual entry takes the party, gathers it at Dorr, checks again, then enters.
- `begin` (POST action `enter` or `resume`, service.ts:296-297) refuses unless the phase is `idle` or `held` (66-67), validates roster, launch and each member's entry (68-71), needs Dorr's position from the leader (72-73), sets 16 fields (participants, phase `gathering`, server, and 13 resets, 74-91), calls the `cancel` port (application.ts:168-171: cancels the active convoy and deletes the members' party commands) and sends every member a `gather` to Dorr (service.ts:93).
- `validateEntry` needs a fresh status, a supported runtime with protocol 1, alive, same server as the leader (103-110); `validateVisit` needs an eligibility check younger than 45000 ms, a visit available or a resume, and a resume on the current server (111-119).
- `gathered` needs the member on Dorr's map within 80 and a complete receipt for its gather (157-164). `reconcileGather` runs once every member is gathered: it checks entry again, checks the in-game party unless resuming, then sets phase `entering` and sends `enter` to the leader only, or to every member when resuming (165-188).
- The game admits the party only when every member is alive, connected, out of combat, on protocol 1 and within 160 of Dorr at (816, 1200) (game node/logic/generated_maps.js:462-479; Dorr is `dreamkeeper` at game design/maps.js:1966).

**HNT-087** A visit already in progress is adopted.
- `adopt`: when the phase is `idle` and any fresh roster member reports a cave, the roster becomes the participants, phase `entering`, commands cleared, the error "Reconciling an existing dungeon visit", and the `cancel` port runs (service.ts:133-146).
- No test names this rule (see 4.4).

**HNT-088** Every observer advances the visit.
- `reconcile` runs adopt, copies receipts into `error` and `exitDispatched` (`observeAction`, 150-156), and, when every participant is fresh, runs gather, returns, cave phases, priest revival, exploration and travel in that order (120-132). With a stale participant only receipts are read (124-125).
- Callers: the GET route through `snapshot` (35-36, 582), every POST through `action` (284), `release` (264), `control` for every heartbeat (539), the heartbeat response builder (application.ts:1089) and the Monster Hunt tick that status ingestion runs on every full report (application.ts:2137; status/ingestion.ts:92).

**HNT-123** Dashboard routes deduplicate POSTs by operation id.
- `install` registers GET and POST `/party-api/daily-dungeons`; POST errors answer 409 with the message (service.ts:581-593).
- `action` needs an operation id up to 160 characters, ignores one it already ran, keeps the last 200 ids, and dispatches to settings, progress, enter, resume, exit, release, retry, recover, or else `perform` (283-309). A handler that throws does not record its id, so the same id can be sent again.

**HNT-089** Active, exiting and held.
- `reconcileCaves`: from `entering` or `active`, when every participant reports a cave with the same run, phase `active`, commands cleared (209-220). From `active` or `exiting`, when every participant reports no cave, phase `held`, commands and run cleared (221-226). In `held`, any participant back in a cave makes every participant get an exit (205-207).
- `exit` saves the interrupted phase and commands, sets phase `exiting` and sends `exit` to every participant (228-240). It refuses when the dungeon does not own the party (230) and ignores a second event exit while one runs (231).
- `held` ends through `release`, the pending event (see **HNT-090**) or a new entry. `release` (POST action `release`, the manual navigation route at application.ts:941-945 for five command types, and the party actions in http/party-actions.ts:145-156) needs phase `held` and every participant fresh and outside, else it throws "Exit the dungeon before resuming ordinary travel" (service.ts:263-274). `retire` sets `idle`, clears commands and deletes six fields so `settings` cannot restore a stale interrupted phase (comment 275-276, 277-282).
- `begin` also accepts `held` (66), so a new entry is a second way out.

**HNT-090** Event protection.
- `eventAllowed(name, event, eligible)` answers "may this member do events" and is reached through `eventsEnabledFor` (application.ts:1236-1242), which the application passes as the `enabled` port at 13 sites and calls directly at two more (application.ts:1672, 2148). Non-participants always pass (service.ts:242).
- In `held` with a pending event that matches, `eligible` and every member fresh, it retires the visit and answers yes (244-248, 254-262).
- With no event name it answers `protectFromEvents === false` (249).
- With protection off, an eligible live event and a phase other than `held`, it calls `exit` with that event as pending, and answers no (250-252). `eligible` is `liveEventFor`: a status fresh within 3 s that lists the event live, or its staging window (application.ts:1229-1234).
- `settings` sets `protectFromEvents`; turning it back on while an exit is pending and not yet handed out (`exitDispatched` false) restores the interrupted phase and commands (service.ts:355-365).
- Setting: `protectFromEvents`, default true (22-23).

**HNT-091** Retry and recover.
- `retry` needs at least one fresh member whose receipt for its command is `failed` (310-316). During travel it restarts travel to the same target and keeps the three spent repair counters (317-323; 480b0451 kept `repairs`, the merge 5a390871 added the other two); otherwise it sends each failed command again under the new id (325-327).
- `recover` (phase `entering` or `active`) sends a resume `gather` to Dorr to every participant that reports no cave, after checking entry, a server-confirmed resume and Dorr's position for each (329-344). `reconcileReturn` sends `enter` to a gathered resuming member that is outside with a resume (345-354).

#### In-cave actions

**HNT-092** Waypoints, room moves and merchant talk.
- `perform` needs phase `active`, the matching run, every member fresh, a cave on the leader and settled earlier actions (366-377).
- `waypoint`: no open encounter, same floor as the leader, finite x and y; stops exploration and starts travel (378-384).
- `move`: a valid destination (not locked, not done unless a merchant room, no open encounter, 430-437); the exit point becomes `exit` (417); a target on another floor is refused (418-419); a merchant room whose shop is not in any member's view is reopened by `talk` from the nearest live member within 100 (420-421, 438-464). The comment at 447-449 says the server allows 160, which the game confirms (game node/logic/cave_of_many_dreams.js:1940); the console uses 100. Otherwise it stops exploration, records the target and starts travel; a stairs-down target is kept as the stair continuation (422-428).

**HNT-093** Votes and purchases.
- `choose`: the choice must be current (472); a vote needs an open choice before its deadline and an available option (475-476); a paid option needs `confirmed` and the same quoted cost and amber (499-507); the vote goes to every participant that has not voted (478-489).
- `buy`: confirmed, resolved, shop present and unsold, enough gold, the same price, and a participant near the merchant; the buyer gets the command (508-537). `currentChoice` also looks at shops only one member sees (495-498).
- `ensureSettled` blocks a new action while an earlier non-move, non-gather, non-talk command lacks a complete receipt; a vote counts as settled when the same choice is resolved natively (394-409).

#### In-cave travel

**HNT-094** Heartbeat control and the movement gate.
- `control(name)` reconciles, marks an exit as dispatched the first time it is handed out (542-545), and returns `owned`, the command, the leader's route while travelling (554-557), the priest assignment for that member, and `movementReady` (538-553).
- `movementReady` needs every participant fresh, alive, ready and not paused (577-580), plus the formation rule: during travel a member may move only while its walked distance is at most 100 more than the least distance of any member still walking; independent repair legs, assembly and no travel are exempt (558-576). The comment at 568-569 says walked distance replaced straight-line distance because straight-line distance deadlocked corridors; that comment and rule came with 27d7dbeb.
- On the character, `canMove` is true when the runtime is not owned; when owned it needs `movementReady` (or a resuming gather outside the cave), a control younger than 3000 ms, local readiness and no open encounter (runtime/characters/dungeons.ts:349-351).

**HNT-095** Assemble, travel together, then stairs.
- `start` refuses a target on another floor, raises the serial, records the leader's position as the assembly point, and sends `gather` to it (travel.ts:23-48).
- `tick` (phase `active`, no member paused) runs repairs first (72), then: all members at the assembly point within 50 with complete receipts moves to `travelling` and sends `move` with `cruiseSpeed` set to the slowest member's speed, default 100 (73-83); all at the target finishes (84).
- `finish` waits for every member to be ready and sends `stairs` for a stairs-down target; for any other target it clears `cruiseSpeed`; both delete the travel record (148-159).
- On the character the default cruise is 500 (dungeons.ts:104, 340-341).

**HNT-096** Three repair counters, three each.
- `repair`: any failed receipt restarts travel to the same target once every member is ready, at most 3 times (`repairs`); at the cap it returns true on every tick, so travel stays stopped with no error text of its own (travel.ts:136-147, 142). The restart calls `start`, which builds a new travel record, so `assemblyRepairs` and `destinationRepairs` go back to 0 (143-144, 30-41).
- `regroup`: during assembly, once every member is fresh, alive, ready and in the run, members whose gather completed but who are not at the point get a new gather, at most 3 (`assemblyRepairs`), then the error "Cave assembly repeatedly displaced..." (98-110).
- `repairDestination`: during travel, members whose move completed but who are not at the target get an independent move, at most 3 (`destinationRepairs`), then a matching error (114-135).
- Commits: 27d7dbeb (travel and `repairs`), a3986593 (regroup), 545ca932 (destination repair), 480b0451 (`repairs` survives Retry), 5a390871 (all three survive Retry).

**HNT-097** Automatic exploration.
- POST `progress` with `enabled` turns it on or off in phase `active` (service.ts:292-295, progress.ts:146-155). Either way it deletes travel and the stair continuation; turning it off also deletes every move and gather command.
- `tick`: an open encounter on any member stops exploration but keeps the stair continuation (83-92). While the party is still on the floor of a saved stairs-down point, travel restarts toward it once nothing blocks, or the continuation is dropped when those stairs are gone or locked; once every member is on another floor the continuation and commands clear (121-135). Otherwise, when enabled, every member fresh, alive, in the run and not paused, every earlier action settled, and every member on the leader's floor, it picks a target (108-120).
- `choose`: unlocked stairs down first; else the current or nearest required, unfinished room on this floor (24-32). `route` travels there, waits, and sends `stairs` once all arrived within 50 and are ready (66-82).
- With nothing left it shows "Waiting for stairs to unlock" or "Floor complete; no further stairs. Exit remains manual." (63-65). Exploration never picks the exit or stairs up.

#### Revival

**HNT-098** Priest revival assignment and manual Nera.
- `reconcile` (phase `active`) counts a death generation per member (5-19), and when no manual revival runs, picks a dead participant that was not tried yet: priests first, then the leader, then by name (35-49), with an alive priest in the run on the same map holding an Essence of Life (20-34; the character reports `essenceoflife` at shared.js:2665).
- The assignment is authorized once per death, after the priest reports `ready` outside an open encounter, and saved before delivery (92-106). A failed or complete attempt moves to the next target (87-91). A target that comes back alive ends the assignment (75-80).
- `revival` (in-cave action) sends the first fallen member a `revival` command, which the character runs as `respawn()` (shared.js:2733); inside a Cave the game answers a respawn by calling Nera (game node/server.js:6224-6226, node/logic/cave_of_many_dreams.js:2091, 2127). It refuses during an open vote (service.ts:385-393) and while a priest revival is unresolved or any participant reports a revive in progress (`blocksNera`, priest-recovery.ts:107-113, used by `manual` 114-120).
- The character's half (heal the grave, cast Revive, report phases) asks 05.

#### Combat inside the Cave

**HNT-099** Grouped combat queue scoped to run and floor.
- `caveCombat` builds the queue for scope `run:floor` from the leader's floor, reuses the previous queue only for the same scope, merges candidates from members fresh within 3 s on the leader's server, map and instance, and pauses when any member has no cave, another run or floor, or an open encounter (combat.ts:9-25, 37-43).
- `member` sets `activeEvent`, `joinedEvent` and `mapEvent` to null and drops loot pending, travel commands and passing encounters (26-35), so event checks do not fire inside the Cave. Called from navigation/grouped-snapshot.ts:112.
- Target rules on the character ask 04.

#### Character side

**HNT-100** The character dungeon runtime.
- `receive(control)` stops current movement when ownership starts or the command changes while one runs (dungeons.ts:331-334), stores the command, installs the leader's shared route (339; the port acts only on followers, shared.js:2761-2765), sets cruise (340-341), settles journal entries from native state (342), and runs the command (344-347). Ownership is the coordinator's `owned` or a cave in view (332, 360).
- `execute` runs one command at a time and never one already in the journal (286); `validate` refuses superseded commands and changed state (248-284); move and gather walk and then validate again (301-306); talk is saved complete with no dispatched state (308-314); other actions are saved `dispatched` before the request (315-318). A failure before dispatch is saved `failed`; a rejected request after dispatch is saved `uncertain` (325-326).
- `report` returns protocol 1, support, alive, readiness, travel progress, party, eligibility, cave, Dorr and the current or latest receipt (215-247).

**HNT-121** The shared.js ports of the dungeon runtime.
- `dungeonRuntime` builds the ports once, with a stub when the runtime is missing (shared.js:2699-2701).
- `ready` outside the cave needs alive, no departure combat and no departure chests; inside it needs alive, no threat, no open encounter and no chest in reach (2716-2721).
- `keeper` reads Dorr (`dreamkeeper`) from the game data on map `main` (2739-2742; the game places it at (816, 1200), game design/maps.js:1966, named Dorr in game design/npcs.js:1135).
- `stop` releases the Cave route gate, tears down convoy travel, farming travel, reunion and follow, then cancels movement (2791-2809).
- The journal lives in localStorage `party-dungeon-actions:<name>` (2702, 2810-2811).

**HNT-122** The character's dungeon ownership test and Cave party names.
- `dungeonOwned` (shared.js:2597-2599) is true with a cave in view or while the runtime owns the character. It is exported at 17485 and read at 12 other shared.js sites and by roles.js (2623-2764), including death recovery, which neither respawns nor runs while it is true (roles.js:2623-2624).
- `cavePartyNames` uses the Cave queue's members when the scope matches, else the party list (2600-2603); `cavePartyMembers` returns the character and the party members `get_player` finds on the same map and instance (2604-2607).

**HNT-101** Daily eligibility polling.
- `refresh` asks the server for the visit every 30000 ms, gives up after 12000 ms and retries after 5000 ms, retries a failed read after 5000 ms, and ignores a late answer from a superseded check (dungeons.ts:173-214). A new run clears the cached visit and checks again (217-222); an unavailable visit whose reset time passed also triggers a check (223-230). `available` includes `unlimited` (201).

**HNT-102** Wire normalization.
- `normalized` turns doors and objectives into points with ids `<run>:<floor>:<kind>:<index>`, labels doors "Exit dungeon", "Stairs down" or "Stairs up", converts deadlines and expiry with a server clock offset, and translates text (dungeons.ts:115-172). `caveText` falls back to the raw text when a headless client stringifies the translation as `[object Object]` (108-114, f094ffcb).

**HNT-103** Cave interaction transport.
- `requestCave` emits one `interaction` of type `cave` with a request id and resolves on the matching `game_response` with place `interaction`; it rejects on a disconnected socket, a failed reply, a throwing emit, a disconnect, or after 150000 ms for enter and 10000 ms otherwise (cave-request.ts:18-59). It listens with `prependAny` when present so native UI handlers that throw cannot hide the reply (49-52, 51e8bf4a).
- `requestDungeon` makes the id `cave:<name>:<time>:<random>` (shared.js:2695-2698). The `request` port maps actions: enter and exit through requestCave, stairs through `transport` with a 10 s timeout, revival through `respawn()`, vote, buy and talk through requestCave (2726-2738).

**HNT-104** The action journal.
- `save` keeps the newest 200 entries plus every unresolved one (`dispatched` or `uncertain`) and writes before the in-memory list changes (dungeon-journal.ts:22-30).
- `reconcile` settles an unresolved entry from native state: entered, climbed to the target floor, exited, voted, bought, or a revival followed by a new choice (31-58).
- `blocked` is true while an unresolved entry exists for the same run, or one without a run (64-69). `execute` refuses every action except exit while blocked (dungeons.ts:299-300).

**HNT-105** Chest loot inside the cave.
- `lootDungeonChests` opens each chest of this map and instance within 380 of the character's real position, not yet opened this run, with a 2500 ms timeout, and stops when dead, outside or in an encounter (shared.js:2639-2656). The comment at 2651-2652 says the server radius is 400 between centres; the game refuses a chest beyond 400 by `simple_distance`, which measures centres (game node/logic/cave_of_many_dreams.js:558, js/old_common_functions.js:1222-1226). Called from `smartLoot` inside the cave (5440).

**HNT-106** Cave floor geometry.
- The application asks for full floors only for the leader's worker (application.ts:270; runtime/coordinator/characters/manager.ts:51-54).
- `liveCaveMapDefinition` sends one floor's tiles, placements, groups and tileset files inside the map frame (shared.js:3746-3763, 3778), once per floor unless the coordinator answers that it needs it again. The handshake itself (runtime/lifecycle/cave-floor-handshake.ts) asks 13.

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **HNT-107** The rare owner publishes its encounter and patrol state with a message as `party.rareHuntState` on every tick path (rare-hunting.ts:184-211), and writes rare diagnostics to the leader's combat log, at most once per 3 s for each message and monster id, keeping the newest 200 entries (92-100; Phoenix sightings during a patrol at 322-325). Code: `runtime/coordinator/navigation/rare-hunting.ts`.
- **HNT-108** The character loot client (`installLootClient`, runtime/combat/departure-loot.ts:43-107) runs three loot passes from one engine (`createDepartureLoot`, 3-41) on a 100 ms timer (61). A pass loots only on the control's realm, map and instance within 180 of its spot while the character is not cancelled, dead, escaping or at an event (12-15; shared.js:17988), waits for the next `entities` socket message (3 s timeout, 47-52), and reports `{id, realm, map, in, observedAt, complete, error}` (32-35). The rare pass takes a `rareControl` of kind `loot` (96-102). Code: `characters/shared.js` (`departureLootPorts`, 17981-17995), `runtime/combat/departure-loot.ts`.
- **HNT-117** The Hunt loot pass takes the Hunt loot barrier while it is unfinished (departure-loot.ts:103). During a Hunt encounter it counts only engaged non-passing monsters as defense (55; shared.js:17990-17992). Code: `runtime/combat/departure-loot.ts`, `characters/shared.js`.
- **HNT-118** The convoy defense loot pass takes the convoy's loot spot while the convoy signal is `defending`, `communication-hold` or `observing`, and suspends collection outside `defending` without retiring the loot id (departure-loot.ts:56, 85-90). Code: `runtime/combat/departure-loot.ts`.
- **HNT-109** A character farm destination is the catalog spawn of its focus monsters with the highest monster priority (default 50), then the nearest (`navigation/selected-destination.ts:24-65`). Followers and the leader use the shared focus. The Hunt backup fallback (`hunt/lifecycle.ts:52-60`), leaving Hunt (`hunt/mode.ts:62-68, 103`), the exit-mode convoy (`hunt/quests.ts:243-245`) and the farming-return route (`application.ts:766`) use it; Hunt start does not. Code: `runtime/coordinator/application.ts`, `runtime/coordinator/navigation/selected-destination.ts`.
- **HNT-110** The Hunt blacklist route `/party-api/hunt-blacklist` adds a manual entry ("Manually blacklisted"), removes one with its failure counts, or clears every entry and count; saved entries stay removable before the catalog loads (`http/hunt-control.ts:156-196`; `http/registration.ts:103`). Code: `runtime/coordinator/http/hunt-control.ts`.

## 2. What goes wrong


### 2.1 Monster Hunt

**B.1 Ledger 13: the wrong pause message, set by call order (current, no patch).**
1. A member reports `activeEvent` during the 120 s staging window (`characters/shared.js:11532` opens it; the heartbeat reports it through `activeCombatEvent()` at `shared.js:2864` and 2987), or a stale `joinedEvent`: `escapePulse` clears the local variable at `shared.js:237` but not `root.__partyJoinedEvent`, which a reload restores at `shared.js:552`.
2. `tick.ts:92` runs `travel.combatEvent` before `advance` reaches `recovery.pause` (`tick.ts:37 -> 63`).
3. `combatEvent` sets `paused-event`, "Paused for combat event", and cancels the Hunt convoy (`travel.ts:21-25`).
4. While the event field is set, `recovery.pause`, which would write "select Hunt again" for a cancelled member (`recovery.ts:171-176`), never runs.
5. Once the field clears, `recovery.pause` (`tick.ts:63`) runs before `travel.step` (`tick.ts:69`) and writes the cancelled-member message. `resumeEvent` (`travel.ts:30-52`) runs only when no member is cancelled, and `convoy.start` refuses a cancelled member too (`convoy.ts:32-33`). The wrong message therefore lasts as long as the event field.
Second producer: any non-Hunt convoy makes `eventOwnsTravel` true (`policy.ts:90-91`), so a rare return or a farm-recovery walk that Hunt does not release shows "Waiting for rare-hunt travel to finish" or "Waiting for shared-walk travel to finish" (`recovery.ts:147-150`); geometry repair, a failed convoy and a defense reason take that text's place first (140-146). With no convoy and no event return, the only case left is an open anniversary cycle (`policy.ts:92`), so the "anniversary" fallback text at `recovery.ts:150` names the right owner. The message is free text written in 55 places across 12 Hunt files (`git grep -n -E "hunt\.message *=" refs/review/ryan-1.5 -- runtime/coordinator/hunt/ | wc -l`), plus 4 outside them (`events/hunt-resume.ts:82`, `events/hunt-return.ts:87`, `http/hunt-control.ts:143`, `scripts/hunt-safety.cjs:19`). History: `git log -s -L 74,94:runtime/coordinator/hunt/tick.ts refs/review/ryan-1.5` shows 9fbeadab (initial), then 9a41afd0 (roster repair), 51eb5324 (communication hold), f023f304 (rare message and arrival reconcile) and 0631e72c (combat event): each later commit adds or changes a gate. Root cause: no owner record says who holds the party; asks 01.

**B.2 Ledger 5: Hunt stuck after death (current; fork patch ce6e7c1a).**
1. Death recovery escapes (`scripts/combat-disengagement.cjs:77-82`).
2. The escape completes when the priest reaches the Blink landing (`scripts/party-escape.cjs:96`).
3. Recovery waits until every member is at Main within 65 of (0, 0) at half HP with no threats (`combat-disengagement.cjs:83-88`).
4. No owner walks members from the landing to Main.
5. Hunt shows "Recovering after party death" and waits (`tick.ts:58-61`).
Fork ce6e7c1a makes escape continue when the landing is off Main, by copying the 65 rule into `party-escape.cjs`; it changes only that file and two tests (`git show --stat ce6e7c1a`), so the Hunt side has no change. Death recovery belongs to spec 05; Hunt only waits.

**B.3 "At an event" copied 15 times in Hunt.** `activeEvent || joinedEvent` appears at `backup.ts:42`, `encounter-ownership.ts:13`, `farm-walk.ts:26, 89`, `lifecycle.ts:29, 206`, `loot.ts:15`, `nearby-target.ts:27`, `quests.ts:166`, `recovery.ts:185`, `retreat-restart.ts:40` (also `mapEvent`, `eventTraveling`), `route-recovery.ts:118`, `tick.ts:49`, `travel.ts:18, 294` (`git grep -n -E "activeEvent|joinedEvent" refs/review/ryan-1.5 -- runtime/coordinator/hunt/ ':!*contracts.ts'`). None checks the occurrence, the realm or whether the admission is current, so staging or a stale `joinedEvent` pauses Hunt (B.1). Asks 01 and 06.

**B.4 Hunt writes other owners' state, and they write Hunt's.** Hunt writes `farmAreaState` (`recovery.ts:100-103`, `mode.ts:44-49`, `lifecycle.ts:214-217`, `route-recovery.ts:175-178, 296`, `farm-walk.ts:58`), `state.location` (`route-recovery.ts:139, 294`), the anniversary cycle (`expired-anniversary.ts:21-23`), and cancels every non-Hunt convoy each step (`participants.ts:89-92`). The farm-area owner writes Hunt's mission and convoy (HNT-051; section 2.2, B8), the rare owner writes Hunt's stage and checkpoint (section 2.3), and event returns write `monsterHunt.stage`, `convoyId` and `message` (`events/hunt-resume.ts`, spec 06). Root cause: no private state per owner.

**B.5 Route budget reset by failure text (current, d5279eab).** `resetChangedGeometry` deletes a destination's budget whenever `preparationChanged(firstFailure)` matches one of seven phrases (`route-recovery.ts:245-251`; `shared-departure.ts:57-60`) and cancels the active convoy (249). The sequence: the first failure records an entry and dispatches the native attempt in the same tick (`route-recovery.ts:236-241, 270-271, 185-199`); on the next tick the reset deletes the entry and cancels that native convoy, because `recoveryReleased` keeps the recovery convoy owned (218-221, 36); ordinary mission travel then starts again (`travel.ts:94-98`). An entry with a matching first failure lives one tick, so the budget never grows and the native attempt never finishes. Inference: a leader that keeps moving during planning loops start, fail, reset without a limit; a candidate coordinator half of ledger 8.

**B.6 Dead paths kept alive by tests and saved state (current).** Four Hunt paths have no production writer or caller:
- the temporary encounter (writer removed by 829b85ba, HNT-021): `encounter.ts`, `nearby-target.ts`, `encounterLootPending` and `travel.temporaryStop`, tested by the 16 tests in `hunt-temporary-encounter.test.cjs` that build the record by hand (line 41);
- `exitMode` (HNT-015);
- stage `failed-return` and `endReason` (HNT-028), including `newCycle`'s batch recovery keyed on the text "no eligible quests remain (Hunt blacklist)" (`lifecycle.ts:182-184`);
- the `resume` branch of `lifecycle.begin` (HNT-111), called only by tests.
Inference: the first three keep old saved cycles working; nothing says when they can go.

**B.7 Migrations that run on every pass.** `needsReconcile` (`policy.ts:73-75`, `policyVersion !== 3`) on every `advance`, `reconcileLateMembers`' old-version branch (`participants.ts:48-66`), `repairOldAssignment` (`participants.ts:69-83`), `reconcileHuntDestination` (`encounter.ts:131-157`) on every travel step, `advanceRecovery`'s retirement of old relocation phases (`route-recovery.ts:258-265`) and `migrateHuntFailures` on every count and settings save (`settings.ts:45-54`, with a reason string compare at 51).

**B.8 Two writers of one expiration count.** `observeHuntExpiry` (`expiry.ts:69-78`) and `quests.blacklistExpired` (`quests.ts:250-259`) both call `recordHuntFailure(..., 'expirations')`; the second skips when the first tracked the same target and revision (253). Patch on a patch: the duplicate guard exists because two places decide "this quest expired".

**B.9 Wrong values and literals.**
- `finishFailed` says "two party deaths" when no reason is set (`lifecycle.ts:97`), but the default death threshold is 1 (`settings.ts:13`). The path is dead (B.6), so no user sees it.
- Daisy arrival is 100 in three places (`travel.ts:84`, `quests.ts:290`, `convoy.ts:51`) and departure 120 (`convoy.ts:66`). The game accepts a Monster Hunt request within `B.sell_dist`, 400, of Daisy (`game node/server.js:225, 5483`), so 100 is a margin, not a game rule.
- Freshness windows: 10000 ms at 9 sites (`lifecycle.ts:28, 40`, `backup.ts:13`, `controls.ts:40`, `current-party.ts:6`, `participants.ts:87`, `membership.ts:72`, `travel.ts:128`, `recovery.ts:185`) and 3000 ms at 14 (`travel.ts:83, 248`, `convoy.ts:49`, `encounter.ts:16, 58`, `loot.ts:32, 94`, `expiry.ts:11`, `current-party.ts:62`, `backup.ts:116`, `farm-walk.ts:88`, `nearby-target.ts:24, 38`, `retreat-restart.ts:46`), plus 800 (recovery, `travel.ts:132`), 180 (loot, `loot.ts:50, 105`), 150 (arrival margin, `travel.ts:192`, `backup.ts:100`), 15000 (stale interaction, `quests.ts:32`), 2000 (event release, `policy.ts:70`), 5000 (encounter absence, `encounter.ts:69`). Each is a literal at its use (`git grep -n -E "\b(10000|3000)\b" refs/review/ryan-1.5 -- runtime/coordinator/hunt runtime/hunt`).
- The search radius default 400 appears in `travel.ts:193, 257`, `backup.ts:100` and `nearby-target.ts:17` (section 2.2, B10 counts them all).

**B.10 Duplicated wiring for solo characters (current).** `createSoloServices` (`application.ts:1784-2007`) repeats the Hunt composition and actions with small port differences (rare stub at 1787). A new Hunt port must be added twice; section 2.2, B11 counts the same for farm areas.

**B.11 Event admission does not see escape or death recovery (current; asks 06).** `hunt-control.ts:68-71` allows event travel unless the member is in the event return, Hunt is in a turn-in, or the intent is cancelled, and the departure check `eventObservations.authorize` adds only the event setting and the cancelled intent (`events/observations.ts:244-247`). Neither reads `escape` or `combatRecovery`. Inference: a member respawning during death recovery can be admitted to an event and put Hunt into `paused-event`.

### 2.2 Farming modes, focus and farm areas

**B1. Six writers of the policy on the current console, eight in the fork, and 44 reading lines.** Counted with `git grep -n farmingPolicy refs/review/ryan-1.5 -- runtime scripts characters dashboard ':!scripts/tests'`, without type declarations and the generated scripts/rare-hunting.cjs.
- Writers on the current console: hunt/mode.ts:109 (a queued change during an event return) and 127 (`select`, reached from http/hunt-mode.ts:62); navigation/monster-selection.ts:48 (every pick sets `auto`); http/saved-farming-mode.ts:30 (a follower's profile); navigation/initial-focus.ts:22 at load (through initial-state.ts:95); hunt/scopes.ts:25, the default for a new profile, which scopes.ts:42 and 46 merge with saved profiles (handed to 01). Every write to the root field lands in the leader's profile through the scope setter (scopes.ts:52-55). The character keeps its own copy from each heartbeat (shared.js:11400).
- Fork af92de45 adds two: achievement-hunt.ts:187 (`stop()` sets `auto`) and console-control.ts `restoreFields` (272-279) over `profileKeys` (234-236) when Play restores a pause (291-303). Its monster-selection.ts:50 skips the write under `keepPolicy`.
- Readers on the current console: 44 lines in 31 files. 25 compare with `hunt` (for example tick.ts:107, farm-areas.ts:154, 265, 274, response.ts:218, response-party.ts:95, roles.js:2425); 4 compare with `default` or `scatter` (scatter.ts:94-95, shared.js:14816-14817); 6 put the policy in an owner snapshot, so any mode change invalidates that owner (rare-hunting.ts:165, 176; scripts/combat-disengagement.cjs:38, 43; scripts/party-escape.cjs:3; scripts/rare-farming-return.cjs:29); 4 are field lists for saving, the heartbeat and the dashboard (persistence/snapshots.ts:107, status/response-types.ts:67, telemetry/public-state-types.ts:60, public-state.ts:89); 5 pass it through or show it (hunt/mode.ts:121, http/hunt-mode.ts:66, application.ts:2024, dashboard/features/party/farming-context.ts:14-15).
- Each accepting site keeps its own list of valid values: hunt-mode.ts:73, saved-farming-mode.ts:12, initial-focus.ts:22. scatter.ts:93-99 treats any other value as auto. Root cause: the mode set is a string with a list per reader, not one registry (spec 11).

**B2. The mode rule lives in two places and one copy is dead.** scatter.ts:93-99 decides the party mode on the coordinator. `calculateFarmingMode` on the character repeats the same policy rule (shared.js:14816-14818) without the scatter break, and its result is discarded (shared.js:2837); the character uses the coordinator's `partyFarmingMode` (shared.js:11402). Only its side effect, `farmingMonsterType`, matters. Inference: a future edit to one copy will not change behaviour and may look like it does.

**B3. Default mode is forced from three places with different owner lists.** scatter.ts:123 forces default when the rare owner owns the scope; response.ts:222-227 forces default for rare or death recovery; the character forces default for convoy defense, death recovery, rare activity, a focus change, merchants, event target types, a joined event, and `all` or empty focus (shared.js:14787-14794) and for the Cave and rare in `getFarmingMode` (17952-17955). Asks 01: who owns the party right now.

**B4. Learned scatter types reset on restart, against the comment.** shared.js:1040 says the coordinator persists them; initial-farming.ts:48-49 resets them with a new epoch, and the character clears its own list on the epoch change (shared.js:11390-11395). Review question FARM-Q2.

**B5. A bestiary pick ends live events for every member.** monster-selection.ts:69 calls `skipManualEventOccurrences` for every member, and `reset` clears event returns, deferred returns and sessions (58-60). Spec 06 section 2.1 traces the rest: the occurrence becomes `ignored:'manual travel'`, drops from the heartbeat selection, and the character stops and posts `/event-disabled` (also review/full/events.md section 6, "A manual move during an event"). d009eb22 ("preserve manual event exits") made this the current design. Review question FARM-Q1.

**B6. Failure classified by free text, and a pause with no retry.** farm-area-recovery.ts:72 decides transient failures by a regex over the failure text. 829b85ba added `geometry` to that regex and a `geometry-mismatch` code branch that pauses with no retry (97-99), so the two halves disagree on geometry failures. Hunt waits on `farmAreaState.paused` (hunt/recovery.ts:167-170, HNT-025) until one of these clears it: a Hunt begin (lifecycle.ts:215), leaving Hunt (mode.ts:47), a party death (recovery.ts:102), a bestiary pick (navigation/monster-selection.ts:46) or a character travel command with a location (http/character-command.ts:63). History: `git log -L` on recordFailure and failed shows 9fbeadab then 829b85ba (review/full/events.md Appendix B 3.3). Review question FARM-Q3.

**B7. Two recovery owners for a failed Hunt convoy.** farm-areas.ts:200-216 handles a failed `monster-hunt` convoy, and Hunt route recovery handles the same failure (hunt/route-recovery.ts, HNT-032). d5279eab added `huntTravelOwns` (farm-areas.ts:254-256, 266; `git blame` on those lines) so the farm side stops while Hunt travels. Since then the mission-travel branch of `noDestination` (farm-area-recovery.ts:33-40) cannot run: `tick` returns for stage `mission-travel` at 266, and `failed` has no caller outside `tick` (farm-areas.ts:185, 214, 251). Asks 01.

**B8. The farm-area owner writes Hunt's state.** `promoteShape` edits the Hunt mission destination (farm-areas.ts:37-38); `startPending` writes `hunt.travelCause` and the mission destination and starts Hunt's convoy (89-93); recovery sets `hunt.convoyId = null` (farm-area-recovery.ts:101); its mission skip (33-40) is dead code (B7). Hunt in turn writes `farmAreaState` (section 2.1, B.4). Root cause: no owner record; each pauses the other by editing its fields.

**B9. Owner lists copied per reader.** The farm-area gates (farm-areas.ts:42-52, 184-186, 196-198, 240-245, 254-258), the farming-return gates (farming-return.ts:38-59) and the client handoff gate (shared.js:17654-17658) each list a different set of owners. None checks the dungeon; only the party farm-area tick is skipped by its caller (application.ts:2087), so the farming-return route and solo scopes have no dungeon check. Outside Hunt only farming-return checks the anniversary cycle; the farm-area gates see it only under the Hunt policy, through `eventOwnsTravel` (runtime/hunt/policy.ts:89-92). Asks 01.

**B10. The search radius default is a literal copied many times.** `git grep -n -E "\|\| ?400\b|= ?400\b|radius = 400" refs/review/ryan-1.5 -- runtime/coordinator characters/shared.js dashboard/lib 'scripts/*.cjs' ':!scripts/tests'` gives 35 lines (without the test exclusion the `scripts/*.cjs` pathspec also matches scripts/tests and gives 47). 23 of the 35 default the search radius: shared.js:444, farming-zones.ts (4), farming-areas.cjs (2, generated), convoy-engagement.ts (2), event-acknowledgements.ts, farming-return.ts (2), http/focus.ts, navigation/focus.ts, farm-areas.ts, farm-competition.ts, hunt-arrival.ts, response.ts, convoy-defense.ts, hunt/travel.ts (2), hunt/backup.ts, hunt/nearby-target.ts. The other 12 are other 400s: eight in shared.js (skill ranges, the Cave target reach at 2629, the whole-area check at 14958 and other distances) and four in runtime/coordinator/inventory (HTTP status defaults and a distance). The grep misses the `: 400` fallback at shared.js:11389. Separately, `observeFarmArea` uses a fixed 400 for "whole area observed" whatever the search radius (shared.js:14958).

**B11. Duplicated wiring for solo scopes.** createSoloServices (application.ts:1784-2007) repeats the farm-area, Hunt and heartbeat port blocks of the party wiring (application.ts:387-414, 445-478, 545-564). Any new port has to be added twice. Its rare stub means a solo scope never yields to a rare encounter (application.ts:1787).

**B12. Test harness slices.** Several tests slice shared.js by function name, using `calculateFarmingMode` only as the end marker of a slice (scripts/tests/passive-rare-queue.test.cjs:11). Moving or renaming the function breaks unrelated tests. Same mechanism as ledger 10.

### 2.3 Rares and Phoenix

**B1. The rare owner writes other owners' state to pause and resume them.** The current console.
1. `begin` writes Hunt's travel checkpoint interruption (rare-hunting.ts:372-375).
2. It writes the kept convoy's `huntTravel.committed/primary/reason` (382-388), and rare-combat's
   `release` edits the same record plus `groupedCombat.rareRejections/evidence/fights/queue/target`
   and, when no member is attacking, `committed/selection` (rare-combat.cjs:33-54).
3. It sets `party.partyFarmingMode = "default"` and `scatterBreakTarget = null` (rare-hunting.ts:405,
   426); nothing restores them on finish, and scatter.ts:123 recomputes the mode only on the next
   status ingestion while `owns()` is false.
4. `restore` writes `party.location` (226); the farming return writes `hunt.convoyId` and
   `hunt.stage` (rare-farming-return.cjs:41-42).
- Each field is a place where Hunt, scatter or grouped combat resume in a state they did not pick.
  History (`git log -L` on `retainTravelConvoy`): 0df7a387 (2026-09-23) kept a convoy that already
  carried a `huntTravel` reason and cancelled the rest; f023f304 (2026-09-24, "preserve Hunt
  ownership through rare encounters") also kept any interruptible convoy and added the commit into
  `huntTravel`.

**B2. "Is the rare still selected" has two owners; two fixes in four days.** The current console.
`released` infers the release from grouped combat's selected, queued and locked state with a 10 s
grace and a queue acknowledgement (rare-hunting.ts:755-774). History (`git log refs/review/ryan-1.5
-L '/function released(/,/^  }/:runtime/coordinator/navigation/rare-hunting.ts' -s`): 9fbeadab
(2026-09-20, initial), 04fb9d9f (2026-10-08, queued is not released), c46722dc (2026-10-12, wait
for acknowledgement), 72f6c570 (2026-10-12, lint split, no behaviour change). Each fix patches a
new race between the coordinator nomination and the client queue.

**B3. Several "who owns the party" lists for rares alone (asks 01).** The current console.
`protectedActivity` (rare-hunting.ts:153-159), `commandProtected`'s purpose list (118-133), the
interruptible-travel purpose list in `acquirePassive` (841), `interruptibleTravel` in `begin`
(runtime/combat/hunt-travel.ts:18-22), and the client's `rareControlCurrent` (shared.js:3580-3584)
each decide a part of "someone else owns the party". None checks the dungeon; the wiring skips the
tick instead (application.ts:1073, 1743), and `setSettings` ticks without that check
(rare-hunting.ts:935).

**B4. Convoy purposes carry behaviour by name; `rare-hunt` names two activities.** The current console.
`rare-hunt` is the pursuit (rare-hunting.ts:522) and the "Resuming farming" return
(rare-farming-return.cjs:63). `cancelTravel` cancels both (rare-hunting.ts:180-183). The purpose
also appears in lists elsewhere (rare-hunting.ts:126; runtime/combat/hunt-travel.ts:20).

**B5. Ledger 13 producer (narrow on the current console).**
1. While an encounter exists, Hunt's tick pauses in `rarePaused` with the convoy's defense reason
   or the encounter message before any event check (hunt/tick.ts:88, 95-99).
2. Without an encounter, a `rare-hunt` convoy makes `eventOwnsTravel` true because its purpose is not
   `monster-hunt`, unless a Hunt turn-in holds priority (runtime/hunt/policy.ts:87, 90-91).
3. `pause` then sets `paused-event` (hunt/recovery.ts:157-165). Its message is the convoy's
   geometry, failure or defense text when present, else "Waiting for rare-hunt travel to finish"
   (140-150).
- Inference: on the current console step 2 needs a farming return convoy for a non-Hunt saved return while a
  Hunt cycle runs, since a saved Hunt return hands travel back without a convoy
  (rare-farming-return.cjs:36-43). The appendix B claim that every `rare-hunt` convoy produces the
  mislabel is wider than the code shows.

**B6. Failure classified by reason text.** The current console. `rejectUnproductive` stores a rejection when
the reason matches `/selection released|no progress|time limit/i` (rare-hunting.ts:268). Changing a
message string changes the retry rule.

**B7. A client route failure is a resting state with no reader.** The current console.
1. The 30 s timer or a `smart_move` rejection sets `rareNavigation = {id, failed:true}`
   (shared.js:3694-3700).
2. `pollRareHunting` then returns true for that control id on every poll (3688), so the character
   holds still.
3. The heartbeat reports `rareNavigation` (2873), but no coordinator code reads it
   (`git grep -n rareNavigation refs/review/ryan-1.5 -- runtime dashboard`: only the type
   rare-types.ts:99 and a debug field, telemetry/character-fields.ts:209).
4. The encounter ends only through the coordinator's own end rules: 30 s unseen, 30 s without
   progress or 300 s total (rare-hunting.ts:497-503), or the unengaged 3 s rule (480-483).
- The fork patches step 2 with a client retry (C2).

**B8. The rare tick runs from three periodic paths.** The current console. 250 ms travel clock
(navigation/runtime.ts:77-83), every status ingestion (status/ingestion.ts:88) and every combat
report (combat-ingestion.ts:52), plus `setSettings` (rare-hunting.ts:935). Each tick re-applies
saved rejections (859-861), and every tick path ends in `publish`, which builds a new
`rareHuntState` object (184-211). Inference: the tick runs at least four times a second from the
clock plus once per report; the rate per second was not measured, and the order of status
ingestion against the timer decides which sightings a tick sees.

**B9. Per-monster lists and migrations that never end.** The current console.
- rare-hunting.ts:29-44 lists the six rares, and they appear again in the client default
  (shared.js:440, 11223) and in the hit tracker (shared.js:1005).
- `tinyp` is removed from saved focus on every start (rare-hunting.ts:107-111), and passive settings
  are migrated on every start (101-102).
- The patrol is fixed to five regions (rare-hunting.ts:62-64, 200; phoenix-patrol.ts:100, 106). If
  game data ever lists another Phoenix spawn area, `validateOrder` rejects every order and the
  patrol cannot start. Today the game defines exactly five boundaries for its one Phoenix spawn
  (game design/maps.js:650-661); a sixth, `tunnel`, is commented out (657). The test fixture uses
  the same five boxes (scripts/tests/rare-hunting.test.cjs:4-5).

**B10. A dead hook and a dead branch.** The current console.
- `recoveryHooks.rare.resumeHunt` (navigation/recovery-hooks.ts:35-44) is passed to
  `createRareHunting` (application.ts:1776) but rare-hunting.ts never calls `hooks.resumeHunt`
  (`git grep -n resumeHunt refs/review/ryan-1.5 -- runtime scripts/*.cjs`). A unit test still
  covers it (section 4.3, coordinator-recovery-hooks).
- In `pollRareHunting`, `control.kind === "patrol" && character.name !== leader` (shared.js:3662)
  cannot run: patrol control already returned at 3652.

**B11. typeof guards around rare functions.** The current console. 17 lines test
`typeof rareActive/rareTarget/rareControlCurrent/acceptRareCombatControl/passiveRareCandidate === "function"`
(`git show refs/review/ryan-1.5:characters/shared.js | grep -c "typeof \(rareActive\|rareTarget\|rareControlCurrent\|acceptRareCombatControl\|passiveRareCandidate\)"`).
All five are declarations in the same closure (shared.js:3561, 3580, 3585, 3601, 14300), so the
guards are always true in production. They exist because unit tests run slices of shared.js
(rare-hunting-client.test.cjs:4, 19-20). Same mechanism as ledger 10.

**B12. A farming-mode change cancels a rare.** The current console. The owner snapshot includes
`farmingPolicy` (rare-hunting.ts:165, 176) and the return checks it (rare-farming-return.cjs:29), so
any mode change ends the encounter and the return as "new navigation". Whether that is intended is
RARE-Q2.

### 2.4 Cave and daily dungeons

**B.1 `held` owns everything and ends only by hand.** (current, 4e00a4b8 design; 9162890d patched the stale fields)
1. All members leave the cave (manual exit or run expiry): `reconcileCaves` sets `held` (service.ts:221-226).
2. `dungeonOwns` stays true in `held` (contracts.ts:142-145).
3. The coordinator skips escape, death recovery, rare, event return and anniversary (application.ts:1741-1745, 1073), and the party's farm areas and Hunt (2087, 2138).
4. `control` keeps handing out `owned: true` (service.ts:547), so the character's runtime owns it (dungeons.ts:332, 360), `dungeonOwned` is true (shared.js:2598), the heartbeat is cut short (shared.js:11160-11167) and death recovery does not respawn (roles.js:2623-2624; runner.ts:67-69).
5. `held` ends only through `release`, which throws when any participant is stale or not reported outside (service.ts:267-271), a matching pending event (244-248), or a new entry (66). Town and Escape try `release` and otherwise send a new exit, which ends in `held` again once every member reports no cave (http/party-actions.ts:145-152; service.ts:221-226).
- Inference: after a visit the party waits at Main until the user acts. A participant that went offline blocks Release, and with it the manual navigation commands that call `release()` first and answer 409 (application.ts:941-945, five command types) and the Travel and Resume party actions (party-actions.ts:62, 141, 153-156). A member dead outside the cave does not respawn until release.
- Precedence of the dungeon over other owners asks 01 (spec 01 question 5); Cave Q1 to Q3 ask the user.

**B.2 Reads that write.** (current)
- GET `/party-api/daily-dungeons` runs `reconcile`, which can issue commands and persist (service.ts:35-36, 582).
- One full status report reconciles three times: the Monster Hunt tick (application.ts:2137, run by status ingestion at status/ingestion.ts:92), the response builder (application.ts:1089), and `control` (service.ts:539), which the response calls whenever a visit record exists (application.ts:1096). `control` also sets `exitDispatched` while building that response (542-545).
- `eventAllowed` can retire the visit or start an exit (service.ts:244-251) and is reached through `eventsEnabledFor` (application.ts:1240), which event code calls as a question. Root cause: the dungeon owner has no tick of its own; any observer advances it.

**B.3 Cave travel repairs: a counter per failure shape.** (current)
1. 27d7dbeb adds travel with `repairs` (cap 3) for failed receipts (travel.ts:136-147), and the walked-distance formation rule (service.ts:558-576).
2. a3986593 adds `assemblyRepairs` because combat moved members after a completed gather (98-110).
3. 545ca932 adds `destinationRepairs` for the same after a completed move (114-135).
4. 480b0451 carries `repairs` across Retry so repeated presses do not add more; the merge 5a390871 extends that to all three counters (service.ts:317-323).
- A `repair` restart calls `start`, which builds a new travel record, so each failed-receipt repair resets `assemblyRepairs` and `destinationRepairs` to 0 (travel.ts:30-41, 143-144). The three caps of three therefore do not bound the total number of regroups.
- Arrival uses three radii: 80 at Dorr (service.ts:162), 50 in travel and exploration (travel.ts:60, progress.ts:39), and the character walks to tolerance 1 for gather and 20 for move (shared.js:2770). Inference: the coordinator infers displacement after the character reported completion; the character does not own "stay at the point until released".
- At the `repairs` cap travel stops with no error of its own (travel.ts:142); only the progress message says "Travel failed" (progress.ts:105). Cave Q5.

**B.4 The same settlement rule in two places, and they differ.** (current)
- `service.ensureSettled` and `voteResolved` settle a vote only when the native choice with the same id is resolved (service.ts:394-409).
- `progress.actionSettled` settles a vote whenever the current native choice is resolved, whatever its id (progress.ts:14-19).
- "move, gather and talk never block" is copied in both (service.ts:397, progress.ts:15).
- Inference: after a new choice opens and resolves, exploration treats an older vote with no receipt as settled while manual actions still refuse; no observed bug.

**B.5 Journal entries without a run block everything except exit.** (current)
- `blocked` counts an unresolved entry with no `run` against every command (dungeon-journal.ts:64-69). `enter` commands carry no run (service.ts:183-187).
- Unresolved entries are never pruned (dungeon-journal.ts:27).
- `reconcile` settles an `enter` only once a cave or a resume run is seen (36).
- Inference: an uncertain entry that the server never confirms keeps blocking later actions on that character until a cave or resume appears. Not observed.

**B.6 Test hooks and dead API in production.** (current)
- `commandIdentity` (dungeons.ts:354-357, 99a6a74b) has callers only in test code: e2e/live-cave.spec.ts:722-723, 769, 1001, 1085, e2e/live-game-client.ts:206 and scripts/tests/daily-dungeons.test.cjs:310-313.
- `paused()` (dungeons.ts:361) has no caller; `git grep -n "\.paused()" refs/review/ryan-1.5 -- characters runtime` finds only an unrelated metrics method at runtime/characters/movement.ts:377.
- daily-dungeons-combat.test.cjs slices shared.js between `function dungeonOwned()` and `function dungeonRuntime()` and runs the slice in a vm (its lines 5-16), the same fragment-loading pattern as ledger 10.

**B.7 Values and text.**
- Dorr arrival 80 (service.ts:162) against the game's 160 entry radius (game node/logic/generated_maps.js:478), and speaker reach 100 against the game's 160 (service.ts:447-455; game node/logic/cave_of_many_dreams.js:1940), are margins, not mismatches.
- Chest reach 380 against the game's 400 between centres (shared.js:2651-2655; game node/logic/cave_of_many_dreams.js:558): margin by design.
- Two user-facing progress messages contain an em dash character (progress.ts:138, 144). Text only.

## 3. Fork differences


### 3.1 Monster Hunt

The fork changes no Monster Hunt logic file except `hunt/scopes.ts`, which adds Achievement Hunt and Franky fields to the scoped list (`git diff --stat refs/review/ryan-1.5 af92de45 -- runtime/coordinator/hunt runtime/hunt` shows 13 changed lines in scopes.ts and three new files: `achievement-hunt.ts`, `achievement-settings.ts`, `achievement-policy.ts`). Fork ce6e7c1a patches B.2 on the escape side.

**Achievement Hunt** (fork af92de45; 17 commits touch its four files, `git log --no-merges refs/review/ryan-1.5..af92de45 -- runtime/coordinator/hunt/achievement-hunt.ts runtime/hunt/achievement-policy.ts runtime/coordinator/hunt/achievement-settings.ts runtime/coordinator/http/achievement-hunt.ts`).

What it does:
- A fifth farming mode, `achievements`, runs `createAchievementHunt.tick` (fork `achievement-hunt.ts:419-441`) right after the Hunt tick, for the party and for each solo scope, skipped while the dungeon owns the scope (fork `application.ts:2292, 2297`). Another mode releases its target, restores the priorities it changed and puts back the passive rules it switched on (420-425).
- It orders the selected monsters by kill-achievement ladder and XP from game data, treats rares and boss-like monsters (at most 2 world spawns and at least 50,000 HP) as special, and picks the next unfinished step (fork `achievement-policy.ts:54-162, 63-64, 216-282`).
- It keeps a target until its milestone, unless a monster at a lower step appears (`achievement-hunt.ts:268-276`), prefers a rarer variant that shares spawn ground (328-355), and starts each target through the current monster selection with `keepPolicy` (301-325; fork `navigation/monster-selection.ts:67-86`).
- It focuses the target plus nearby fillers; when there are fillers it writes every member's `monsterPrioritiesByCharacter` (90 target, 10 filler) and saves the old values to restore (`achievement-hunt.ts:193-224`).
- It switches passive rare rules on for wanted rares and restores them later (146-176).
- It counts deaths per target (deaths flagged as an event trip are skipped) and blacklists at 6 deaths by default (227-254; fork `achievement-settings.ts:45`), keeps the newest 500 entries (fork `rare-retention.ts:20-23`, cd7bd857), skips an unroutable target for 10 minutes (81, 106-110), and leaves a target once an avoided boss attacks a member, until nobody has seen that boss for `bossRecheckMinutes`, default 10 (111-140; fork `achievement-settings.ts:48`).
- It walks the party back to the target's spawn while away, at most every 30 s (357-389, 408-417), and waits while `busy()` or a member is dead (391-397).
- It leaves the mode for Auto when the focus differs from its own more than 15 s after its own switch (186-191, 256-261).
- On the character, boss avoidance adds keep-out zones around avoided bosses and a retreat mover that runs before grouped movement (fork `shared.js:3758-3920`, used at 15597 and 15610; 45344db5, b5a7c68c).

What it patches or bypasses:
- **A fourth "who owns travel" list.** `achievementHuntBusy` (fork `application.ts:833-841`) checks dungeon, event sessions, event return, deferred returns, rare owner and any convoy that is not its own `manual-monster-override` and not complete or failed. It does not read `escape`, `combatRecovery` or a pending farm move (`farmAreaState.pending`). `achievementHuntEventBusy` (829-832) holds on any `eventSessions` key, and a session exists for every member that reports an enabled event live (`events/observations.ts:138-144`). Inference: Achievement Hunt waits through every Franky window. Asks 01.
- **An automated switch counts as manual travel.** `select(..., keepPolicy)` keeps the policy and event state but still calls `skipManualEventOccurrences` for every member (fork `monster-selection.ts:76`), so a target switch marks every live occurrence `ignored: 'manual travel'` for the rest of the occurrence. Today the over-broad busy gate mostly hides this; fixing the gate alone would expose it (review/full/events.md 4.7).
- **Farm relocation and Achievement Hunt fight over `party.location`.** Farm areas have no Achievement Hunt check, so a competition move can go to a filler's spawn and Achievement Hunt walks back after 30 s (orphan comment at fork `achievement-hunt.ts:357`; section 3.2).
- **User settings as working state.** It is a second writer of `monsterFocus`, `monsterPrioritiesByCharacter`, passive rare rules and `farmingPolicy` (set to `auto` in `stop`, fork `achievement-hunt.ts:187`). Inference: a crash or a manual edit during a target leaves the saved restore copy stale.
- **Mode lists.** `achievements` is missing from `saved-farming-mode.ts:12` and `initial-focus.ts:12` (fork), so a follower cannot save it and a legacy state loads it as Auto.
- **Per-character copy.** 5854cb05 builds a second monster-selection instance with stub ports for each independent character (fork `application.ts:2142-2156`, inside `createSoloServices`).

**The fix count.** fork-inventory section 6 names 20 fix rows for Achievement Hunt: #103 to #106, #108, #109, #111 to #116, #122, #123 and #125 to #130. Its count column says 21, one more than the rows it names; this spec uses 20. Fix chains named there (section 4): monster classification (5 special-case additions: f6a35a4b, 7be05712, 4bc9d3da, 4e694d44, cf7cba08), fillers and variants (9ba45f10, ae058969, cf7cba08, 5792d0d0), away-from-target (9ba45f10, 4e694d44), boss avoidance (cf7cba08, 4b213e7f, b5a7c68c, 45344db5), persistence (09a417ca, a04cc9f3, cd7bd857). Section 5 lists five fix commits on `switchTo` and six on `tick`. `git log -s -L` on af92de45 shows 7 commits on `switchTo` and 9 on `tick`; the difference is the creating commit 3bae33fc, the feature extension 9ba45f10 and, for `tick`, the end-to-end commit 78424eb4, which the inventory does not count as fixes. Inference: each fix added a special case or a timer instead of an owner record.

### 3.2 Farming modes, focus and farm areas

- **Achievement Hunt mode value (fdcbbd81).** The fork adds `achievements` to the mode route (fork af92de45 http/hunt-mode.ts:72-83, with `achievementsAvailable`). It did not add it to saved-farming-mode.ts:12 or initial-focus.ts:12 (fork af92de45), so a follower cannot save it and a legacy state reloads it as `auto`. Profiles keep the real value, so the live leader is unaffected (review/full/events.md Appendix B F-FA5). scatter.ts treats it as automatic (selectMode falls through). Review question FARM-Q4.
- **monster-selection keepPolicy (3bae33fc, cf7cba08).** `select(..., keepPolicy)` keeps the policy and the event state when Achievement Hunt switches targets (fork af92de45 navigation/monster-selection.ts:46-66, 50, 62), but still calls `skipManualEventOccurrences` for every member (fork 76; review/full/events.md 4.7). The fork also skips the party convoy for a Phoenix pick so fighters split from where they stand (fork 72-75, 3849a095).
- **Farm relocation fights Achievement Hunt over the location.** farm-areas.ts has no Achievement Hunt check, so `relocateBusy` can move the party to a filler's spawn; Achievement Hunt walks it back after 30 s (fork af92de45 achievement-hunt.ts:77, 357, 389). The orphan comment at achievement-hunt.ts:357 shows the case was seen. Review question FARM-Q5.
- **Console Play writes the mode (b33aee77, 9a34a4c1).** Play restores `farmingPolicy`, `location`, `monsterFocus`, `partyFarmingMode` and the Achievement Hunt fields saved at Pause (fork af92de45 lifecycle/console-control.ts:234-236, 272-279, 291-303), overwriting changes made during the pause.
- **Scatter per engagement (d798cac8, 1865916c, 31dd61f4).** The fork replaces the current one-shot learning on the coordinator with per-engagement estimates: a type is learned when a fighter could kill it alone before help arrives, and a hard-coded set of 19 special monsters, monsters flagged in the bestiary catalog and Achievement Hunt's avoid list always group (fork af92de45 status/scatter.ts:59-62, 78-82, `regroupMs` 90, `soloEngagement` 115, `learnEngagements` 140). `git diff --stat refs/review/ryan-1.5 HEAD -- runtime/coordinator/status/scatter.ts` gives 181 lines changed (165 added, 16 removed), from d798cac8, 1865916c and 31dd61f4. The explicit Default and Scatter policies keep the current rule (fork scatter.ts:232-236).
- **Heartbeat avoid list.** The farming response adds `avoidMonsters` in achievements mode when the target has bosses to avoid (fork af92de45 status/response.ts:218-221, 227).
- **Saved selections.** initial-focus.ts also loads encounter routines, automatic death limits and death counts (fork af92de45 initial-focus.ts:26-28).

### 3.3 Rares and Phoenix

**C1. Phoenix split search (fork 3849a095, ported from a community fork).** It replaces the whole-party
`phoenix-patrol` convoy with a search where each free fighter takes the nearest unclaimed region
(fork af92de45 phoenix-patrol.ts:51-68), walked by client `smart_move` (fork af92de45
shared.js:4049-4058, 4062-4088). It adds a converge stage when any searcher sees a Phoenix (fork
rare-hunting.ts:486-535), a second protection list with a 10 s leader grace (fork 182-194), and a
realm-hop suspend (fork 829-866). Diff: rare-hunting.ts +287/-105, phoenix-patrol.ts +166/-217
(`git diff --numstat refs/review/ryan-1.5 af92de45`).
- It patches: no owner for a stuck whole-party scan, and realm hops, which the rare owner learns
  only from the leader's realm (fork 202-213, comment 835-836). Boss chase made the observed hop;
  with it gone, a manual realm switch is the remaining source.
- It leaves `phoenix-patrol` in purpose lists with no writer: no fork code starts a convoy with that
  purpose (`git grep -n phoenix-patrol af92de45 -- runtime characters scripts ':!scripts/tests'`).
  The lists are at fork rare-hunting.ts:137, 224, 759, 1000; shared.js:3608, 3956, 14931, 14938,
  15840; hunt-travel.ts:20; navigation/convoy.ts:229, 256; travel-defense.ts:139;
  shared-navigation.ts:108. Convoy safety (travel defense, formation, geometry repair) does not
  cover these client walks.
- New constants: GATHER_RANGE 300, CONVERGE_LOST 10 s, GATHER_MINIMUM 5 min, SEARCH_LEADER_GRACE 10 s
  (fork rare-hunting.ts:49-55); absence grace 10 s (fork phoenix-patrol.ts:71), planner reset 20 s
  (67), stall 30 s (141), assignment retry 5 s (193); the respawn wait stays 35 s (fork
  rare-hunting.ts:797).

**C2. Client route retry with a missing timestamp (fork bug).** The fork retries encounter and loot
routes 5 s after a failure (fork af92de45 shared.js:4130-4133), but the 30 s timeout writes
`rareNavigation` without `at` (4135-4136). `Number(undefined || 0)` makes the 5 s check false, so
the route restarts on the next poll. The `smart_move` rejection path sets `at` (4055). Fix: add
`at: Date.now()` at 4136. Still unfixed at 21b8362d (shared.js:4138).

**C3. Achievement Hunt writes passive rare rules** through `rareControl.setSettings` (fork
application.ts:878) and restores them later (fork achievement-hunt.ts:146-176), a second writer of
a user setting. AH's blacklist cap lives in rare-retention.ts (fork cd7bd857,
`keepNewestAchievementBlacklist`, 500 entries). Covered in the AH part.

**C4. Boss chase and the realm-hop blacklist**: the fork drops both (972c9fce). Boss chase was the
blacklist's only reader.

### 3.4 Cave and daily dungeons

`git diff --stat refs/review/ryan-1.5 af92de45` over the dungeon files changes only cave-request.ts (+9/-1) and dungeon-journal.ts (+4/-2); service, travel, progress, priest recovery, combat, contracts, the character runtime and cave-recovery.ts are unchanged.
- **7ea350fb** (fork) `requestCave` takes a sixth argument, `native`, and calls the native `push_deferred("interaction")` before emitting, because the game client logs an error for every interaction reply that no deferred waits for (fork cave-request.ts:10-13, 31, 59-62). `requestDungeon` passes `parent` (fork shared.js:2887). A second native-client workaround in the same function after 51e8bf4a.
- **3a3fa3ae** (fork) the journal settles a vote when the choice was replaced or resolved, not only when the native vote matches, because the game drops a vote that arrives after the others resolved it (fork dungeon-journal.ts:40-46). This makes a third copy of the vote rule (B.4) with a third meaning.
- Achievement Hunt (fork) reports "a daily dungeon is running" as busy (fork application.ts:834) and skips its party tick and each solo tick under the dungeon (fork application.ts:2292, 2297).
- 0e179c4b (fork) releases a Cave fight on a won practice trainer (runtime/combat/reset-fight.ts, runtime/combat/grouped.ts, shared.js); combat, asks 04.

## 4. Tests today

`catalog/07-hunts-and-farming.json` lists each test id under its behaviour. This pass ran no tests for this spec. "Accurate" means the setup and assertions match the code path, read from the test source.

### 4.1 Monster Hunt

Counts are "tests in the file / tests mapped to section 1.1". File counts are `test(` and `it(` call sites on the ref; a call inside a loop counts once.

| Test file (in file / mapped) | Behaviours | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|---|
| scripts/tests/hunt-safety.test.cjs (41 / 41) | HNT-003, HNT-006, HNT-007, HNT-009, HNT-010, HNT-012 to HNT-014, HNT-016, HNT-017, HNT-019, HNT-024, HNT-025, HNT-027 to HNT-029, HNT-034, HNT-035, HNT-111 | quest selection order, blacklist skips, backup batches, arrival grace, death threshold | transpiles application.ts and runs the real tick through `helpers/coordinator-hunt.cjs` with stub convoys; no real movement | yes for the coordinator; the convoy is a stub | the arrival-grace tests (357-372) guard the arrival handoff timer; the test at 40 guards `releaseFallback` |
| scripts/tests/departure-loot.test.cjs (14 / 12) | HNT-023 | barrier needs a matching fresh acknowledgement; moved collector releases it | real loot timing | yes | 97 and 108 guard the inherited-barrier rule |
| scripts/tests/hunt-temporary-encounter.test.cjs (16 / 16) | HNT-019, HNT-021, HNT-022 | encounter end rules, absence timer, legacy repair | builds `monsterHunt.encounter` by hand (line 41); no production path creates one (B.6) | accurate for the code, not for live play | yes: it guards a dead path |
| scripts/tests/hunt-farm-walk.test.cjs (12 / 12) | HNT-004, HNT-033 | due quest or failed walk releases the farm walk; anniversary yields | live reunion | yes | yes (4030efac, 829b85ba orphan relocation) |
| scripts/tests/hunt-route-recovery.test.cjs (6 / 6), shared-convoy (2 mapped) | HNT-018, HNT-032 | one native attempt then next spawn; geometry reset | the preparation-text reset loop (B.5) | yes | 42 guards the geometry reset |
| scripts/tests/hunt-route-acquisition.test.cjs (6 / 6) | HNT-018, HNT-020 | whole-party arrival, no early handoff | real terrain | yes | 20 and 31 guard the removed handoff |
| scripts/tests/coordinator-hunt-composition.test.cjs (9 / 9) | HNT-003, HNT-006, HNT-008, HNT-016, HNT-026, HNT-035, HNT-111 | resume keeps backup (test only, HNT-111), roster repair, start despite attackers | live convoys | yes | 137 guards f023f304's rare message |
| scripts/tests/coordinator-hunt-controls.test.cjs (4 / 4) | HNT-005, HNT-017, HNT-036 | participants rule, spawn choice ties, scoped cancel | preferred spawn | yes | no |
| scripts/tests/hunt-settings.test.cjs (3 / 3), hunt-spawn-preferences (1 / 1), rare-hunting-ui (1 mapped) | HNT-014, HNT-017, HNT-034 | thresholds, migration, expiry once, settings route | dashboard save round trip | yes | 8 guards the migration |
| scripts/tests/hunt-mode-reset.test.cjs (2 / 2), coordinator-hunt-actions (1 / 1), monster-hunt-start (3 / 3) | HNT-001, HNT-002, HNT-036 | off/on resets execution, keeps quests | event-trip skip of the exit convoy | yes | no |
| scripts/tests/hunt-event-resume.test.cjs (9 / 6), hunt-ab-return (4 / 2), completed-return-cleanup (5 / 2), farming-navigation (1 mapped) | HNT-001, HNT-002, HNT-013, HNT-024, HNT-025 | event return hands back to Hunt | staging and stale `joinedEvent` (B.1) | yes | several guard event-return handoffs (spec 06) |
| scripts/tests/coordinator-hunt-control.test.cjs (4 / 2), hunt-return-recovery (3 / 2) | HNT-012, HNT-016, HNT-112 | interaction receipts; Retry return waits for protocol and command ownership and keeps native fallback | Retry with a stale member | yes | no |
| scripts/tests/hunt-event-handoff.test.cjs (10 / 4), hunt-retreat-restart (3 / 3), hunt-missing-destination (2 / 2), hunt-geometry-roster (1 / 1), hunt-fallback-owner (2 / 2), hunt-return-town (9 / 2), hunt-selector (4 / 1), continuous-hunt-return (2 / 1), convoy-communication (22 / 3), convoy-defense (11 / 1), solo-hunt (11 / 7) | HNT-003, HNT-006, HNT-007, HNT-009, HNT-011, HNT-012, HNT-016, HNT-026, HNT-027, HNT-029 to HNT-031, HNT-034 to HNT-036 as listed in the catalog | as named | live play | yes | hunt-geometry-roster guards `geometryOwnsRoster`; solo-hunt 162 guards owner departure |
| e2e live-hunt-lifecycle (11 mapped), live-hunt-combat (2), live-hunt-recovery (1), live-hunt-departure (1), live-hunt-events (1), live-hunt-controls (1), hunt.spec (1) | HNT-001, HNT-004, HNT-010, HNT-012 to HNT-014, HNT-017, HNT-018, HNT-024, HNT-026, HNT-029, HNT-032, HNT-036, HNT-110 | real game: quests, Daisy rewards, expiry, deaths, restarts, preferred spawn, blacklist add and remove (live-hunt-lifecycle 283-300) | staging, rare returns during Hunt, backup farming in the live game | not read in full; names and the cited lines only | no |
| scripts/tests/coordinator-selected-destination.test.cjs (3 / 3), e2e/console.spec.ts (1 mapped) | HNT-109, HNT-110 | priority before distance, default 50, shared focus for party members; blacklists survive mode changes, restart and export | the Hunt callers of the destination | yes for the unit test; the e2e test is not read in full | no |

Behaviours with no test: HNT-015 (exit mode, dead path). Not mapped: `e2e/live-hunt-*` specs about terrain, approach and combat (targetron, hawk, mage range, engaged terrain, multi-corner, planned terrain, ice roamer, merchant, code identity, cold defense, round2 recovery, town recovery, failed collection, empty spawn, committed corner, manual event override, sparkbot follow) prove combat, movement, survival and events behaviours under a Hunt; they belong to specs 02 to 06 and are not counted here.

### 4.2 Farming modes, focus and farm areas

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| coordinator-scatter.test.cjs (3 tests) | HNT-039: first learned kill sets the type, off-type threat holds scatter 3 s, member change resets, explicit policy wins | rare override, hunt and achievements policy values | yes | no |
| coordinator-status-composition.test.cjs::rare ownership keeps the coordinator grouped... | HNT-039 rare forces default, scatter resumes after | uses `farmingPolicy:'automatic'` (line 6), not a real value; passes only because unknown values act as auto | partly | no |
| coordinator-status-ingestion.test.cjs::scatter learning respects epochs... | HNT-040 coordinator half, including the duplicate append it asserts at line 20 | the client one-shot rule (shared.js:1041) | yes | no |
| queue-markers, passive-rare-queue (2 named) | HNT-042 indirectly: grouped vs scatter markers and claims | groupedFarming rules themselves; they stub `groupedFarming` | partly | no |
| monster-hunt-start.test.cjs (2), e2e live-hunt-lifecycle "invalid backup..." | HNT-037 Daisy and backup refusals | auto/default/scatter switches | yes | no |
| solo-hunt.test.cjs (2 of 11), solo-hunt-ui (1) | HNT-038 separate scopes (solo-hunt); HNT-113 saved follower mode (solo-hunt-ui, a dashboard test) | per-port parity between party and solo wiring; the saved-farming-mode route itself | yes | no |
| coordinator-focus-routes.test.cjs (4 of 5) | HNT-043 validation, override clearing, scatter reset, invalidation | the focusChanged relocation | yes | no |
| coordinator-migrate-focus.test.cjs (4) | HNT-044 migrations | initialFarmingSelections policy whitelist | yes | yes (legacy migration) |
| farming-areas.test.cjs::bestiary validates selection..., e2e live-hunt-manual-event-override | HNT-045 validation order; event skip on manual travel | Phoenix start/stop | yes | no |
| rare-hunting-settings.test.cjs::invalid passive settings... | HNT-046 rejection | accepted rules | yes | no |
| farming-zones (3 of 6), farming-areas (4 of 5) | HNT-047 merging, holes, legacy points, ranking, exact validation | resolve() matching rules | yes | no |
| farm-zone-recovery "wild boar entry point", "idle leader outside..." | HNT-048 entry point and routing in | inFarmArea radius fallback | yes | no |
| farm-competition "client observes...", farming-zones "competition requires damage evidence" | HNT-049, HNT-050 | observeFarmArea full-observation rule | yes | no |
| farming-zones "one observed kill...", "unreachable selected target..." | HNT-050 | prune at load | yes | no |
| farm-zone-recovery (3 competition tests), farm-competition "all member radii...", coordinator-farm-composition (2) | HNT-051 | the 120 s busy window after a move | yes | coordinator-farm-composition "Hunt route recovery retains its spawn" guards d5279eab (huntTravelOwns) |
| farm-zone-recovery (5 failure tests of 29) | HNT-053 | the 10 s and 2 s delays; the dead noDestination mission branch | yes | "exhausted geometry repair holds..." guards 829b85ba (`git blame` on line 130) |
| farm-zone-recovery "obsolete recovery pause is cleared once..." | HNT-115 `migrate` | `promoteShape` and its Hunt mission write | yes | no |
| farming-respawn-wait (4), e2e live-hunt-empty-spawn | HNT-054 | anniversary gate | yes | no |
| farming-engagement (5), e2e live-farming-handoff | HNT-055 | the client pollFarmingCombatHandoff gate list | yes | no |
| farming-navigation (3 named) | HNT-056 | authorize copying into event owners | yes | no |
| hunt-settings "defaults, historical migration..." | HNT-057 restore | scatter reset at load | yes | partly (migration) |
| farm-reunion "already-respawned runtime..." | HNT-058 | the runner port itself | yes | no |
| hunt-safety (7 of 36: 5 for HNT-059, 2 for HNT-116), hunt-area-arrival (5 of 7), hunt-route-acquisition (2 of 5), hunt-return-regression (2 of 5), departure-loot (2 of 14), loot-capacity-recovery (1 of 3), monster-hunt-start "missing Daisy catalog" | HNT-059 to HNT-064, HNT-116 | see section 4.1 | yes | hunt-safety arrival-grace tests guard the arrival handoff timer |

No test found for HNT-041 (farmingResponse forcing default), HNT-052 (focus-change relocation), HNT-065 (Hunt snapshot persistence) or HNT-114 (`calculateFarmingMode`, used in tests only as a slice end marker, B12): `git grep -n "focusChanged\|farmingResponse\|huntSnapshot" refs/review/ryan-1.5 -- scripts/tests e2e` returns one hit, a stub port in scripts/tests/character-appearance.test.cjs:32, and no test that exercises them.

### 4.3 Rares and Phoenix

Accuracy below comes from reading the test against the code; this pass ran no tests.
"Patch guard" means the test pins a fix for an interaction between owners rather than a player-facing
behaviour. Counts are `test(` calls in the file on the ref; a call inside a loop makes one test per
loop value at run time.

| Test | Behaviours | Proves | Does not cover | Accurate? | Patch guard? |
|---|---|---|---|---|---|
| scripts/tests/rare-hunting.test.cjs (31 calls: 24 with literal names and 7 loops at L32, 51, 160, 176, 194, 284, 315 that make 28 more, 52 at run time) | HNT-068 to HNT-078, HNT-081 to HNT-083, HNT-119 | Coordinator owner end to end with a fake party: acquisition, priority, expiry, generator, loot, return, patrol | Real heartbeats, real grouped combat, real movement; it loads scripts/rare-hunting.cjs, which re-exports `.build/runtime/rare-hunting.cjs` built from the .ts (L3) | Yes for the scenarios read (L86 sets `party.turnIn` and a member's `joinedEvent`) | L253 guards c46722dc (B2), L333 guards f023f304 (B1) |
| scripts/tests/phoenix-patrol-regression.test.cjs (25 calls: 24 literal and a loop at L315 that makes 12, 36 at run time) | HNT-070, HNT-074, HNT-081 to HNT-083, HNT-119, HNT-107 | Patrol coverage, failures, respawn wait, sightings, region choice | Real planner routes; more than one realm | Yes for names read | L126, L153, L289, L301 pin past fixes |
| scripts/tests/rare-hunting-client.test.cjs (12) | HNT-066, HNT-072, HNT-075, HNT-076, HNT-080 | Client control acceptance, deployment, loot retry state | Runs a text slice of shared.js (L4, 19-20), so it cannot see callers outside the slice (cause of B11) | Yes | No |
| scripts/tests/rare-farming-return.test.cjs (6) | HNT-077 | Return retries, offline members, protected pause, shape arrival, Hunt hand back | Real convoys | Yes | L41 guards the Hunt hand back |
| scripts/tests/rare-retry-evidence.test.cjs (4) | HNT-074 | Rejection receipts and what reopens them | Interaction with grouped rejections | Yes | No |
| scripts/tests/passive-rare-queue.test.cjs (4) | HNT-066, HNT-073 | Client reports and coordinator queue retention | Live combat | Yes | L40 |
| scripts/tests/coordinator-recovery-hooks.test.cjs L11 (2 of its 4 tests are mapped here) | HNT-120 | `rare.resumeHunt` resets a Hunt | Nothing in production calls it (B10) | Tests dead code | Yes |
| scripts/tests/coordinator-recovery-hooks.test.cjs L22 | HNT-070 | A Daisy return is not replaced by a Fairy | Other protected kinds | Yes | Yes (turn-in precedence) |
| scripts/tests/coordinator-retention.test.cjs L33, L47; e2e/console-persistence.spec.ts L159 | HNT-074 | 100-entry caps on write and load | Nothing else | Yes | No |
| scripts/tests/encounter-recovery.test.cjs L20, L63, L87 (3 of 8 calls) | HNT-072 | Approach progress and cross-map Phoenix | Grouped release | Not checked in detail | No |
| scripts/tests/passive-hunting.test.cjs L9, L99, L223 (3 of 23 calls) | HNT-068, HNT-083 | Settings migration; passing attacks during a patrol | Encounter flow | Not checked in detail | No |
| scripts/tests/rare-hunting-settings.test.cjs L11; rare-hunting-ui.test.cjs L27, L39, L56, L63 | HNT-068, HNT-081 | Settings validation and the dashboard pickers | Coordinator effect | Yes | No |
| e2e/hunt.spec.ts L4; e2e/live-hunt-events.spec.ts L213 | HNT-068 | Level caps save; a disabled rare stays alive during Hunt | Enabled rare in a live game | Not checked in detail | No |
| e2e/live-hunt-engaged-terrain, live-hunt-mage-range, live-hunt-planned-terrain (one test each) | HNT-072 | Real native movement and combat reach a Phoenix | The rare owner's state machine (combat reach only) | Not checked in detail | No |
| scripts/tests/departure-loot.test.cjs L45, L50, L62 (engine); L6 (Hunt pass); L145 (convoy pass) | HNT-108, HNT-117, HNT-118 | A pass needs collection plus a fresh observation; failures stay retryable; a replaced control cannot be acknowledged; Hunt and convoy defense gates | Real chests and native loot replies | Yes | L145 guards the communication-hold suspension |

No test covers HNT-079 (solo stub) or B7 (client route failure with no reader). HNT-067 has
one indirect test (phoenix-patrol-regression L226); nothing tests the three tick paths together.
HNT-107 has only indirect tests that read `rareHuntState.patrol` (phoenix-patrol-regression L58,
L69); nothing tests the diagnostics log.

### 4.4 Cave and daily dungeons

This pass read test names and counts from the test files on the ref; a count is the number of `test(` calls, and a call inside a `for` loop runs once per loop value. The two main live-cave journeys build their name with a ternary (e2e/live-cave.spec.ts:12-14), so the test index does not list them; this section cites them by their two literal names.

| Test | Behaviours | Proves | Does not cover | Accurate? | Guards a patch? |
|---|---|---|---|---|---|
| daily-dungeons.test.cjs (25 calls, 26 at run time) | HNT-084 to HNT-086, HNT-088 to HNT-090, HNT-093, HNT-094, HNT-098, HNT-100 to HNT-102, HNT-104, HNT-122 | Roster rules, entry through Dorr, event protection, purchase and paid vote checks, held and late entry, restart identity, journal and dispatch safety, eligibility polling, text fallback | `adopt`, `recover`, `retry`, `release` with an offline member, multi-floor travel | Yes; unit level with hand-built statuses | "persisted Cave travel without leader observations" and "Cave command identity..." guard specific fixes (route crash, 99a6a74b hook) |
| cave-assembly-drift.test.cjs (6) | HNT-096 | Regroup and destination repair, caps, rejection of stale evidence | Failed-receipt `repair` cap, its silent stop, and the counter reset on a repair restart | Yes | Yes: added by a3986593 and 545ca932 |
| cave-progress.test.cjs (5) | HNT-097, HNT-104 | Room then stairs order, waits, encounter pause, final floor, lost stairs reply | Merchant room handling, stair continuation across a stale member | Yes | No |
| cave-combat-queue.test.cjs (2) | HNT-099 | Three-slot queue, follower sightings, scope change on a new floor, votes stop pulls | Masked event fields | Yes | No |
| cave-priest-recovery.test.cjs (4 of 12 cover the coordinator) | HNT-098 | One authorization per death, priest priority, manual Nera rules | Revival across a floor change; the other 8 tests are the character half (05) | Yes | No |
| cave-request.test.cjs (6 calls, 7 at run time) | HNT-103 | Correlation, cleanup, failures, capture before native handlers, timer receiver | The 150 s enter timeout value | Yes | "native cave response is captured before a throwing game UI listener" guards 51e8bf4a |
| daily-dungeons-combat.test.cjs (2 of 8 calls mapped here) | HNT-122, HNT-105 | Chest loot scope; healing roster from captured participants | The other 6 test target rules (04) and healing (05) | Yes, but runs a text slice of shared.js | Fragment loading (B.6) |
| e2e/live-cave.spec.ts "Cave entry closes settings..." and "Cave completes native rooms..." | HNT-086, HNT-088, HNT-092, HNT-095, HNT-097 | Full native journeys on a local game server: entry, votes, waypoints, room completion, stairs, exit to held | Release, events, revival | Yes; long (2,700 s budget, :16) | No |
| e2e/live-cave.spec.ts "Cave shared-route pacing..." | HNT-094, HNT-095 | Followers walk the leader's route at one cruise, gap under 220, Stop clears moves | Repairs | Yes | No |
| e2e/live-cave.spec.ts "Cave assembly regroups..." (two layouts) | HNT-096 | Regroup after a native displacement | Destination repair | Yes | Yes: a3986593 |
| e2e/live-cave-headless.spec.ts | HNT-086, HNT-089, HNT-106 | Headless entry, only the leader gets full floors, exit to held, release to idle with the six fields cleared (:128-132) | Release with a stale member | Yes | Guards 9162890d (fields cleared at idle) |
| e2e/live-cave-talk.spec.ts | HNT-091, HNT-092, HNT-093, HNT-096 | Talk reopens a merchant, buy, Retry keeps spent repairs | Recover | Yes | Guards a5e336d7 and 480b0451 |

Not mapped here: daily-dungeons-dashboard.test.cjs (dashboard panel, 2 tests); cave-return-progress.test.cjs (escape and return progress, 6 tests, 05 and 06); movement-service.test.cjs Cave cases (02).

## 5. Needs your review

### Decided 2026-10-26

These decisions replace any working assumption or recommendation for the same item elsewhere in this document.

- **C8** (MOV-Q20 and RARE-Q4: how the party searches for the Phoenix; decided by your answer): The plan settles the search by working out find time plus regroup time for each option from the Phoenix region distances and walk speed, and keeps the faster one.
- **A11** (FARM-Q1: a bestiary pick during an event; decided by your answer): Only a bestiary pick (choosing a monster from the monster list) off the event map drops the party from the event, with the same rejoin button.
- **A12** (EVT-Q2, GRP-Q2 and MH-Q1: walking to an event and pausing Hunt; decided by your answer): The event walk starts when the route time says it must, and the party may arrive a few seconds late but never more than 60 s after the spawn.
- **A13** (GRP-Q5, Cave Q1 and Cave Q3: after the Cave run; decided by your answer): Escape and death handling work after the Cave, and the party resumes once everyone is out and walking, with no fixed wait; Release still ends it sooner.
- **A31** (MOV-Q19 and RARE-Q1: which trips a rare monster may interrupt; decided by the plan): One list: a rare can interrupt farming and Hunt travel, trips you start by hand finish, and each rare has a may interrupt Hunt travel switch.
- **A33** (RARE-Q2: changing farming mode during a rare fight; decided by the plan): A mode change applies at once; during a rare fight the card warns that the change ends the fight and its loot, and you can go ahead anyway (rule R3).
- **A34** (RARE-Q3: where the party goes after a rare; decided by the plan): The party walks back to its saved farm spot after a rare, as today.
- **A35** (RARE-Q5: scatter mode during a rare; decided by the plan): The party fights rares grouped and goes back to the farming style Auto has set, default or scatter, once the rare is done (rule R4).
- **A48** (MH-Q4: Hunt travel restarted by a drifting leader; decided by the plan): Hunt travel keeps going while the party gets closer to its target, a drifting leader no longer restarts it, and the card says stuck when it makes no progress (rule R2).
- **A49** (MH-Q5: deaths before Hunt blacklists a monster, for new installs; decided by the plan): The deaths before blacklisting default for a new install stays at today's 1 (rule R2).
- **A50** (FARM-Q2: scatter monsters after a restart; decided by the plan): The party saves which monsters it can scatter on, so that knowledge survives a restart (rule R3).
- **A51** (FARM-Q3: farm travel failing on the map's shape; decided by the plan): A map-shape travel failure retries with growing waits and a message that names the problem.
- **A52** (FARM-Q6: leaving a contested spawn outside Hunt; decided by the plan): One relocate if competing setting covers every mode, on by default.
- **A53** (Cave Q2: an offline member after the Cave; decided by the plan): A member drops from the Cave visit when the game reports it offline or it stops making progress, not after a fixed 5 minutes, and a member that reconnects inside the cave leaves alone (rule R2).
- **A54** (Cave Q4: an event during a Cave visit; decided by the plan): With Don't leave the Cave of Many Dreams for other events off, the party leaves between encounters while that still lands it at the event within 60 s of the spawn (rule R6).
- **A55** (Cave Q5: travel inside the Cave that keeps failing; decided by the plan): Cave travel repairs keep going with growing waits, and the card names the failing member and why.
- **B4** (AH-Q1: Achievement Hunt and events (fork); decided by the plan): Achievement Hunt keeps farming until someone actually attends an event, and target switches cost no event rounds (rule R4).
- **B5** (AH-Q2: Achievement Hunt and your settings (fork); decided by the plan): Achievement Hunt lays a temporary override over your settings and never rewrites your saved values (rule R4).
- **B6** (FARM-Q4: Achievement Hunt as a saved mode (fork); decided by the plan): One list of valid modes everywhere, so followers can save Achievement Hunt too, and Hunt and Achievement Hunt stay toggles that cannot both be on (rule R4).
- **B7** (FARM-Q5: a contested spawn during Achievement Hunt (fork); decided by the plan): Relocation during Achievement Hunt moves only to another spawn of the same target (rule R4).


Questions only the user can answer. The coordinator copies them into the review queue.

### 5.1 Monster Hunt

1. **MH-Q1. What pauses Monster Hunt for an event?**
   **Today:** any participant's `activeEvent` or `joinedEvent` pauses Hunt and cancels its convoy unless a turn-in owns travel (`hunt/travel.ts:15-28`, checked first at `hunt/tick.ts:92`). That includes the 120 s staging window (`characters/shared.js:11532`, reported at 2864 and 2987) and a stale `joinedEvent` restored after a reload (`shared.js:237, 552`). The same two fields are read at 15 places in Hunt (B.3).
   **Options:**
   (a) Keep today's rule. Negatives: Hunt stops for the whole staging lead; a stale field after a reload pauses Hunt with no event running; one member at an event stops every member's quest.
   (b) Pause only while a member is admitted to an occurrence that is live now (the attendance record, spec 06), or has started the event walk (spec 01 question 2). Negatives: the 15 reads must move to one predicate; Hunt depends on spec 06's attendance record being correct.
   (c) Pause only the members at the event; the rest keep farming the quest. Negatives: the Hunt party splits, so the convoy, the loot barrier and the turn-in need a partial roster; a quest owner at the event leaves the rest farming a quest they cannot turn in.
   **Recommendation:** (b). Hunt keeps farming until a member leaves for the event, and the stale-field pause goes away. It beats (a) because staging and reload leftovers no longer stop the quest, and it beats (c) because the roster, loot and turn-in rules stay whole-party. It matches spec 01 question 2 (b). Negatives: one shared predicate to build and test, and it is only as good as the attendance record.
2. **MH-Q2. Which message shows when several things hold Hunt?**
   **Today:** the first check in call order writes `hunt.message` (`hunt/tick.ts:74-94`; B.1), so "Paused for combat event" hides a cancelled intent, and `paused-event` shows for rare-hunt and farm-recovery walks (`hunt/recovery.ts:150`). The message has 49 writers in 12 Hunt files (`git grep -nE "hunt\.message *= *[^=]" refs/review/ryan-1.5 -- runtime/coordinator/hunt`).
   **Options:**
   (a) Show only the highest-precedence holder from spec 01's table. Negatives: a holder waiting behind it is invisible, so the user cannot tell why Hunt will not resume after the event.
   (b) Show every holder, highest first. Negatives: longer status lines on the phone cards; every holder must report a reason.
   (c) Keep call order. Negatives: the text depends on the order of 15 or more gates, so a reorder or a new gate changes what the user sees.
   **Recommendation:** (b), as one top line with the other reasons after it, matching spec 01 question 3. It beats (a) because the user sees the cancelled intent behind the event, and beats (c) because the text no longer depends on code order. Negatives: each owner needs a reason string, and the card needs room for a second line.
3. **MH-Q3. Old saved cycles and test-only paths.**
   **Today:** temporary encounters (HNT-021), exit mode (HNT-015), `failed-return` with `endReason` (HNT-028) and the `resume` branch of `begin` (HNT-111) have no production writer or caller (B.6). Their tests build the state by hand (`hunt-temporary-encounter.test.cjs:41`, `coordinator-hunt-composition.test.cjs:37`).
   **Options:**
   (a) Ship one release that converts old saved cycles (clear `encounter`, `exitMode`, `endReason`, map `failed-return` to `checking-quests`), then remove the paths and their tests. Negatives: two releases instead of one; the converter itself needs a proof, and that proof is a ChronAL E2E scenario that saves a cycle with each of these fields, restarts the console and checks the loaded stage (persistence coverage, AGENTS.md: E2E first).
   (b) Keep them. Negatives: 26 catalog functions (HNT-015, HNT-021, HNT-028, HNT-111) and at least the 16 hand-built encounter tests cover code no player reaches, and each Hunt change must keep them working.
   (c) Remove them now and reset any old cycle to `checking-quests` at load. Negatives: a player who upgrades mid-encounter or mid-return loses that step and walks back to Daisy.
   **Recommendation:** (a). It removes the dead code without dropping a saved cycle on the floor. It beats (b) because the dead paths stop costing test and review time, and beats (c) because no saved cycle loses its place. Negatives: the converter release must ship first, and nothing measures how many saved cycles still carry these fields.
4. **MH-Q4. Route budget reset by preparation drift.**
   **Today:** a first failure whose text matches `preparationChanged` (`navigation/shared-departure.ts:57-60`) is recorded, a native attempt starts, and the next tick deletes the entry and cancels that attempt (`hunt/route-recovery.ts:245-251`; B.5). The budget never grows, so a drifting leader can restart Hunt travel without a limit.
   **Options:**
   (a) Count drift resets per destination and hold with a visible message after N. Negatives: N is a guess; the hold needs a way out (Retry, or a new mode selection).
   (b) Keep resetting. Negatives: an unbounded start, fail, reset loop, and the native attempt never finishes.
   (c) Wait until the leader stands still before planning. Negatives: a leader that keeps kiting or fighting never stands still, so Hunt never leaves; it needs its own timeout.
   (d) Count a drift reset as a failure on the task ladder (`01-groups-and-tasks-design.md` 4.1): repeated resets climb to a regroup, then the walk to the saved farm point, then the 5, 15, 30 and 60 s backoff, with no hold. Negatives: a leader that keeps drifting walks the party back to the saved farm point and then retries every 60 s; it depends on the task ladder.
   **Recommendation:** (d), and stop the reset from cancelling a native attempt that is already running. It beats (a) because (a)'s hold needs Retry or a new mode selection after N, and N is a guess; it beats (b) because the loop climbs instead of repeating, and beats (c) because a busy leader cannot hold Hunt forever. Negatives: the first retries still cost time, and the walk back to the farm point costs a trip.
   **Changed:** the earlier recommendation was (a), which ends in a hold that needs the user; the upstream priorities (00-overview) rule that out, so (d) is new and now recommended, matching the task design's D11 (the review queue A48).
5. **MH-Q5. Death threshold default.**
   **Today:** the default blacklists a Hunt monster after one party death (`hunt/settings.ts:13`), and the blacklist lasts until the user removes it (HNT-110). The dead fallback text says "two party deaths" (`hunt/lifecycle.ts:97`). The fork's Achievement Hunt defaults to 6 after a live test (fork `achievement-settings.ts:41-45`). The game has no such rule.
   **Options:**
   (a) Keep 1. Negatives: one unlucky death, for example from an event monster passing through, removes a monster from Hunt until the user clears it.
   (b) 2. Negatives: the party dies twice at a dangerous spawn before Hunt moves on.
   (c) Ask on first use. Negatives: one more dialog; a user who skips it still gets a default.
   **Recommendation:** (b), unless the user's own Hunt runs say otherwise. A second death is better evidence that the spawn is unsafe, and the blacklist does not expire on its own. It beats (a) because a single accident no longer costs a monster for good, and beats (c) because it needs no dialog. Negatives: one extra death at dangerous spawns; no measured data backs 2 over 1.
6. **AH-Q1 (fork). Achievement Hunt and events.**
   **Today:** Achievement Hunt waits while any `eventSessions` key exists (fork `application.ts:829-832`), and a session exists for every member reporting an enabled event live (`events/observations.ts:138-144`). Each target switch calls `skipManualEventOccurrences` for every member (fork `monster-selection.ts:76`).
   **Options:**
   (a) Wait only while a member attends an event (the attendance record), and make target switches skip no events. Negatives: the busy gate and the switch path both change; the switch must not be mistaken for a manual move by spec 06's rules.
   (b) Pause Achievement Hunt during an event and resume after, with switches unchanged. Negatives: switches still mark live occurrences as manual travel.
   (c) Keep today's behaviour. Negatives: Achievement Hunt idles through every live event window, and fixing only the gate exposes the skip on every switch.
   **Recommendation:** (a). Achievement Hunt farms while no one attends, and its own switches stop costing event rounds. It beats (b) because (b) leaves the skip in place, and beats (c) because (c) idles and hides a second bug. Negatives: two changes that must ship together, and the fork's switch keeps its own code path.
7. **AH-Q2 (fork). Achievement Hunt and user settings.**
   **Today:** it writes `monsterFocus`, `monsterPrioritiesByCharacter`, passive rare rules and `farmingPolicy`, and restores saved copies later (fork `achievement-hunt.ts:146-224, 187`).
   **Options:**
   (a) A temporary override that the settings owner restores (spec 11). Negatives: spec 11 must offer an override layer; every reader must read the effective value.
   (b) Keep direct writes. Negatives: a crash or a manual edit during a target leaves the saved restore copy stale; the user's own settings change under them.
   (c) Its own target fields, leaving user settings alone. Negatives: the character code that reads focus and priorities must also read the Achievement Hunt fields.
   **Recommendation:** (a). The user's saved values stay theirs, and one owner decides what is in effect. It beats (b) because a crash cannot leave a stale copy, and beats (c) because readers keep one source of the effective value. Negatives: it depends on spec 11's override design.

### 5.2 Farming modes, focus and farm areas

1. **FARM-Q1. Should a bestiary pick end the party's live event (2.2 B5)?**
   **Today:** a pick marks every live occurrence each member attends `ignored:'manual travel'` for the rest of the occurrence and clears event returns and sessions (`navigation/monster-selection.ts:58-60, 69`). In the fork, an Achievement Hunt target switch takes the same skip (fork monster-selection.ts:76). Spec 06 question 1 asks the same for every manual command.
   **Options:**
   (a) Keep: any pick leaves the event. Negatives: a pick made to reposition near the event costs the round for every member; the fork's automated switches count as manual.
   (b) Skip only when the picked spawn is off the event map. Negatives: needs a map check per pick; a misclick that leaves the map still costs the round.
   (c) As (b), plus the rejoin control from spec 06 question 1. Negatives: one more control; rejoin must clear only `manual travel`.
   (d) Ask in the dashboard when an event is live. Negatives: a prompt on every pick during events; automated callers cannot answer it.
   **Recommendation:** (c), to match spec 06 question 1. Picks that stay on the event map keep attendance, and a mistaken leave can be undone. It beats (a) because (a) drops the round without asking, (b) because (b) has no way back, and (d) because a prompt does not work for automated switches. Automated callers such as Achievement Hunt do not use the manual skip (spec 06 question 1). Negatives: a map check and a control.
2. **FARM-Q2. Keep learned scatter types across restarts (2.2 B4)?**
   **Today:** `initialFarmingState` sets `scatterMonsterTypes` to `[]` and a new epoch on every start (`navigation/initial-farming.ts:48-49`), and the character drops its list on the new epoch (shared.js:11390-11395), so the party fights grouped until each type is one-shot again. The comment at shared.js:1040 says the coordinator persists the list.
   **Options:**
   (a) Relearn after restart, and fix the comment. Negatives: slower farming after each restart until a lethal single hit repeats; a monster that only some hits kill at once can take long to relearn.
   (b) Save the list with the roster signature (`scatterPartySignature`) and reload it only for the same roster. Negatives: a type can outlive the gear or level that made it true, and then members fight alone a monster they cannot kill quickly; more saved state.
   (c) As (b), and clear the list on a gear or level change. Negatives: needs a gear and level signature per member, a new rule to keep correct.
   **Recommendation:** (a). Grouped fighting is the safe fallback, and one observed kill restores scatter. It beats (b) because a stale saved type sends members off alone with no check, and beats (c) because the extra signature costs more than the time it saves. The fork's per-engagement learning (3.2) replaces this rule there. Negatives: the slow start after each restart stays.
3. **FARM-Q3. What should follow a `geometry-mismatch` farm travel failure (2.2 B6)?**
   **Today:** the failure is recorded, then farming pauses with no retry and no message of its own beyond "Travel failed: ..." (`farm-area-recovery.ts:82, 96-99`). The pause also holds Hunt (hunt/recovery.ts:167-170). It ends only on a Hunt begin, leaving Hunt, a party death, a bestiary pick or a character travel command (2.2 B6). The regex at 72 also calls any "geometry" text transient, so the two halves disagree.
   **Options:**
   (a) Stay paused until the user acts. Negatives: an unattended party stands still, Hunt included; the dashboard shows only the travel failure text.
   (b) Retry once after a delay, then pause with a message that names the mismatch. Negatives: a lasting mismatch costs one more failed trip; a timer and a counter to keep.
   (c) Move to the next area, then pause when every area fails. Negatives: a mismatch on the map's geometry likely fails every area on that map the same way, so the party walks several failed trips first.
   (d) Retry on the backoff with no end (5, 15, 30, then every 60 s, the task ladder's last step), with a message that names the mismatch. Negatives: a lasting mismatch costs a failed trip every 60 s.
   **Recommendation:** (d). The pause follows an exhausted geometry repair (scripts/tests/farm-zone-recovery.test.cjs:130), so a retry helps only when the mismatch passes with time, and the backoff keeps a lasting one to one trip a minute. It beats (a) and (b) because both end in a pause that waits for the user, and beats (c) because (c) repeats a failure that is about the map, not the area. In every option the regex drops `geometry`, so one rule decides. Negatives: a failed trip every 60 s while the mismatch lasts.
   **Changed:** the earlier recommendation was (b), which pauses after one retry until the user acts; the upstream priorities (00-overview) rule that out, so (d) is new and now recommended (the review queue A51).
4. **FARM-Q4 (fork). Should Achievement Hunt survive as a saved mode?**
   **Today:** the fork's leader route accepts `achievements` (fork http/hunt-mode.ts:81), but the follower save path refuses it (saved-farming-mode.ts:12) and a legacy root value loads as `auto` (fork initial-focus.ts:12). Saved profiles keep the value (hunt/scopes.ts:42), so the leader keeps it across restarts.
   **Options:**
   (a) Keep: leader only, legacy load becomes auto. Negatives: three lists disagree with no stated reason; a follower that later farms alone cannot have it saved.
   (b) Take the valid modes from one list that every route and loader reads (2.2 B1), which adds `achievements` everywhere. Negatives: followers can then save a mode that runs through the fork's per-character copy with stub ports (3.1), which has less testing.
   (c) Keep it for the leader across restarts and refuse it for followers on purpose. Negatives: a third special case to keep, in a list that already drifts.
   **Recommendation:** (b). One list removes the drift that caused this gap. It beats (a) because (a) keeps the gap, and beats (c) because (c) adds another rule to a set of lists that already disagree. Negatives: the per-character Achievement Hunt copy becomes reachable from more scopes.
5. **FARM-Q5 (fork). Competition relocation during Achievement Hunt.**
   **Today:** farm areas have no Achievement Hunt check (farm-areas.ts unchanged in the fork), so `relocateBusy` can move the party to a filler's spawn, and Achievement Hunt walks it back after 30 s (fork achievement-hunt.ts:77, 357, 389).
   **Options:**
   (a) Achievement Hunt's target spawn wins: no competition relocation in that mode. Negatives: the party shares a spawn with a competitor for the whole target.
   (b) Relocation stays, but only to another spawn of the same target. Negatives: farm areas must read the Achievement Hunt target; a target with one spawn, such as most bosses, then never relocates.
   (c) Keep both. Negatives: the party can walk back and forth every 30 s.
   **Recommendation:** (b). It keeps both goals: away from the competitor and on the target. It beats (a) because (a) gives up relocation entirely, and beats (c) because (c) loops. Negatives: one more input to the farm-area owner, the location claim that spec 01 would settle.
6. **FARM-Q6. An on/off setting for competition relocation outside Hunt?**
   **Today:** only Hunt has a setting: `competitionHold` checks `relocateIfCompeting` only when the policy is `hunt` (`farm-competition.ts:74`). In other modes relocation always runs for shaped and intersection areas (farm-areas.ts:151).
   **Options:**
   (a) Keep: always on outside Hunt. Negatives: a user who wants to stay in a shared spawn cannot.
   (b) One setting for every mode, default on. Negatives: changing it for Hunt also changes ordinary farming; the setting moves out of the Hunt settings record (spec 11).
   (c) A separate setting for ordinary farming. Negatives: two settings with the same meaning to explain.
   **Recommendation:** (b). One setting with one meaning. It beats (a) because (a) gives no choice, and beats (c) because two settings for the same rule invite mismatched values. Negatives: a settings migration.

### 5.3 Rares and Phoenix

1. **RARE-Q1. What may a rare interrupt?**
   **Today:** passive acquisition waits while grouped combat has fights, and in grouped mode it
   runs only during a `farm-relocation`, `monster-hunt`, `manual-monster-override` or
   `party-travel` convoy (rare-hunting.ts:839-842). `begin` keeps an interruptible convoy, Hunt
   mission travel included, and commits the rare into it (376-388; hunt-travel.ts:18-22). The
   protected list in HNT-070 blocks rares outright (141-159). Precedence itself is spec 01.
   **Options:**
   (a) Keep today's list. Negatives: Hunt mission travel stops for any enabled rare while the quest
   timer runs; the list lives in four places (B3).
   (b) Never interrupt Hunt mission travel. Negatives: a Fairy or Phoenix seen on the way to a Hunt
   spawn is passed by; the commit path that f023f304 added for Hunt convoys loses its main use.
   (c) A per-rare choice, "may interrupt Hunt travel", defaulting to today's behaviour. Negatives:
   one more field per passive rule, its validation in `validPassiveSettings`, and a ChronAL E2E case
   per rule.
   **Recommendation:** (c). It keeps today's behaviour for users who change nothing, and lets a
   user who farms Hunt quests against the timer protect that travel. It beats (a) because (a) gives
   no way to protect Hunt travel, and beats (b) because (b) passes by a Fairy (priority 101) even
   when the user wants it. Negatives: a new setting, and the interrupt list still needs spec 01's
   single owner record to stop living in four places.
2. **RARE-Q2. Should a farming-mode change end a rare encounter?**
   **Today:** the owner snapshot includes `farmingPolicy` (rare-hunting.ts:165, 176), so a mode
   change ends the encounter as new navigation (555-557, 865-867) and clears the return
   (rare-farming-return.cjs:28-31). The patrol also stops when the policy becomes `hunt` (635). The
   rare gets a 3 s cooldown and no loot (270-283).
   **Options:**
   (a) Keep: any mode change cancels the rare and its return. Negatives: a mode click during a
   Phoenix or Fairy fight drops it and its loot.
   (b) Finish the rare, then apply the mode. Negatives: the change waits up to the 300 s encounter
   cap (500); it needs a pending-mode record; the dashboard must show that the mode is queued.
   (c) Finish only Fairy and Phoenix, cancel the rest. Negatives: two rules for one event; which
   rares count is a fixed list, another copy of the rare list (B9).
   **Recommendation:** (b). A mode change says what to do next, not to drop the fight in progress,
   and leader, focus and revision changes still cancel at once. It beats (a) because (a) loses the
   kill and loot, and beats (c) because (c) adds another per-monster list. Negatives: a pending-mode
   record, a visible delay of up to 300 s, and one more case for the owner snapshot.
3. **RARE-Q3. After a rare, where does the party go?**
   **Today:** `restore` writes the saved location back (rare-hunting.ts:226) and the farming return
   walks the online members there, or hands travel back to the same Hunt cycle
   (rare-farming-return.cjs:36-64). Offline members stay in the obligation (60-61) but do not keep
   the owner busy, since `moving()` counts only fresh members (68-74).
   **Options:**
   (a) Keep: back to the saved farm location or the Hunt mission, offline members kept. Negatives:
   a walk back even when the farm monster also spawns where the rare died.
   (b) Stay where the rare died when a focus monster spawns there. Negatives: changes the farm area
   without the user choosing it; needs a spawn catalog check; the saved `party.location` and the
   real position differ.
   (c) Drop offline members from the return. Negatives: a member that reconnects is not walked back
   by the return and relies on its own farm reunion.
   **Recommendation:** (a). The saved location is the user's choice, and offline members already do
   not hold the party. It beats (b) because (b) moves the farm area silently, and beats (c) because
   (c) removes the only walk back for a member that reconnects. Negatives: an extra walk when the
   rare died inside another good area.
4. **RARE-Q4. Phoenix patrol movement.**
   **Today:** the whole party walks each scan leg in one `phoenix-patrol` convoy
   (rare-hunting.ts:651-653; phoenix-patrol.ts:209). The game spawns the one Phoenix in a random
   one of its five boundaries, 32 s after death (game design/maps.js:650-661,
   node/server.js:13491-13497, design/monsters.js:450-451). The fork runs a split search (C1).
   **Options:**
   (a) Keep the whole-party convoy patrol. Negatives: one region at a time; a stuck leg stalls the
   whole party for 30 s per failure (phoenix-patrol.ts:134-147).
   (b) The fork's split search with converge. Negatives: the walks run outside convoy safety
   (travel defense, formation, geometry repair); it carries the C2 retry bug and purpose lists with
   no writer; a lone searcher meets the Phoenix alone and must hold fire until the others arrive,
   up to the 5-minute gather window.
   (c) Split search only with at least N fighters, convoy patrol otherwise. Negatives: two movement
   paths to keep and test; N needs a choice.
   **Recommendation:** (b), with C2 fixed and the dead `phoenix-patrol` lists removed. With one
   random region of five per spawn, three searchers check three regions at once instead of one. It
   beats (a) on time to find, and beats (c) because one path is easier to keep correct than two.
   Negatives: client walks without convoy safety, and a gather wait before the fight.
5. **RARE-Q5. Scatter during a rare.**
   **Today:** `begin` sets `partyFarmingMode` to `default` (rare-hunting.ts:405). While `owns()` is
   true, the heartbeat and status ingestion force `default` (status/response.ts:222-227,
   scatter.ts:123). Nothing restores scatter on finish; the next status ingestion recomputes it once
   `owns()` is false.
   **Options:**
   (a) Keep forcing grouped, with no direct restore. Negatives: the forced `default` sits in three
   places (2.2 B3); scatter resumes one status report late.
   (b) Restore scatter right after the rare. Negatives: a saved mode field for a gap of one report;
   one more writer of `partyFarmingMode`.
   (c) Let scatter members fight rares separately. Negatives: breaks the Fairy deployer rule and the
   leader-only loot receipt (rare-hunting.ts:578-591); a lone member can pull a Phoenix alone.
   **Recommendation:** (a). The gap is one status report, because scatter.ts recomputes the mode on
   every ingestion. It beats (b) because (b) adds a writer for no visible gain, and beats (c)
   because (c) breaks the loot and generator rules. Negatives: the forced default stays in three
   places until spec 01 gives one owner record.

### 5.4 Cave and daily dungeons

1. **Cave Q1. After a visit ends.**
   **Today:** when every participant reports no cave (manual exit or run expiry) the visit enters `held` (service.ts:221-226). `held` still owns the party (contracts.ts:142-145): escape, death recovery, rare, event return, anniversary, the party's farm areas and Hunt do not tick (application.ts:1741-1745, 1073, 2087, 2138), and the character does not respawn (roles.js:2623-2624). It ends on Release, which needs every participant fresh and outside (service.ts:263-274), on its pending event (244-248), or on a new entry (66). Town and Escape try Release and otherwise send a new exit (http/party-actions.ts:145-152).
   **Options:**
   (a) Keep the manual Release. Negatives: the party idles at Main until the user acts; with today's gates a member dead outside the cave stays dead (Cave Q3).
   (b) Release on its own once every fresh participant is outside and nothing is pending, then resume the previous farming. Negatives: a user who wanted the party to wait loses that; an offline member still blocks it (Cave Q2); farming starts before the user has read the run result.
   (c) Release on its own but go to Town and wait for a new order. Negatives: a Town trip nobody asked for; the party still idles afterwards; an offline member still blocks it.
   (d) Release on its own 5 minutes after every fresh participant is outside, then resume the waiting task; Release ends the hold sooner (`01-groups-and-tasks-design.md` D9). Negatives: a hold the user wanted longer ends after 5 minutes unless the user pauses the console; 5 minutes is not measured; an offline member still blocks it unless Cave Q2 (d) drops it.
   **Recommendation:** (d), together with Cave Q3 (b) and Cave Q2 (d), which matches spec 01 question 5 (d): death handling no longer waits on the hold, and the party farms again without the user once the run result has been visible for 5 minutes. It beats (a) because (a) leaves the party idle until the user presses Release, beats (b) because the result stays on the card before farming starts, and beats (c) because (c) adds travel with no target and no farming. Negatives: a deliberate hold ends after 5 minutes unless the user pauses the console.
   **Changed:** the earlier recommendation was (a), the manual Release; the upstream priorities (00-overview) rate a party that idles until the user acts as high to critical, so (d) is new and now recommended (the review queue A13).
2. **Cave Q2. An offline participant and Release.**
   **Today:** Release refuses while any participant is offline or more than 3 s stale (service.ts:30-31, 267-271). The manual navigation commands and the Travel and Resume actions call Release first and answer 409 (application.ts:941-945; http/party-actions.ts:62, 141, 153-156), so one stale member blocks travel for the whole party.
   **Options:**
   (a) Keep: an offline member blocks Release. Negatives: the online members cannot travel until the offline one reconnects or the user starts a new entry.
   (b) Release the online members and drop the offline one from the visit. Negatives: the offline member may still be inside the cave; when it reconnects inside a run, `adopt` puts the whole idle roster back in `entering` (service.ts:133-146).
   (c) Keep blocking, name the stale member on the dashboard, and offer an explicit "drop from visit" action. Negatives: one more control; the user still has to act.
   (d) Drop a participant on its own once it has been offline or stale for 5 minutes, the wait Cave Q1 (d) gives a held visit; release the others; and limit `adopt` (service.ts:133-146) to the members that report inside, so a dropped member that reconnects inside the cave exits alone. The dashboard names the stale member, and (c)'s action drops it sooner. Negatives: the online members wait up to 5 minutes; while the reconnected member exits, the visit owns the party again, so its farming pauses for that exit; `adopt` changes; 5 minutes is not measured.
   **Recommendation:** (d). No stale member keeps the party waiting for the user, and a member that comes back inside the cave gets out without pulling the whole roster into `entering`. It beats (c) because (c) still needs the user, beats (b) because a short disconnect does not drop a member and `adopt` no longer restarts the whole visit, and beats (a) because the online members move again. Negatives: up to 5 minutes of waiting, the farming pause during a late exit, and the `adopt` change and its E2E.
   **Changed:** the earlier recommendation was (c), which leaves the party waiting until the user acts; the upstream priorities (00-overview) rule that out, so (d) is new and now recommended (the review queue A53).
3. **Cave Q3. Death handling outside the cave.**
   **Today:** while the dungeon owns the party, the coordinator skips escape and death recovery (application.ts:1741-1742), and the character's death recovery neither respawns nor runs while `dungeonOwned` is true (roles.js:2623-2624; runner.ts:67-69). `dungeonOwned` stays true in `held` outside the cave because the coordinator keeps sending `owned: true` (service.ts:547; dungeons.ts:332, 360). Inside the cave the game answers a respawn by calling Nera (game node/server.js:6224-6226).
   **Options:**
   (a) Keep death handling off for the whole visit. Negatives: a member that dies outside the cave stays dead until Release (inference, not observed).
   (b) Outside the cave (`held`, and members outside during `gathering`), the normal escape, death recovery and respawn apply. Negatives: the coordinator gates and the character test must tell `held` from the other phases; escape can move members the user wanted held (spec 01 question 5).
   (c) Only respawn applies outside the cave. Negatives: a respawned member waits in Town with no death recovery walk back, and escape still never runs.
   **Recommendation:** (b), as spec 01 question 5 (d) recommends. It beats (a) because a death outside the cave is handled without waiting for the user, and beats (c) because (c) respawns the member and then leaves it alone in Town. Negatives: a phase check in each gate (application.ts:1741-1742, roles.js:2623-2624) and the risk that escape moves a held member.
4. **Cave Q4. Event exit during an encounter.**
   **Today:** with event protection off, an eligible live event makes every participant exit at once in any phase but `held` (service.ts:250-251). `exit` does not look at an open vote or a fight (228-240), and the character runs an exit even while the journal blocks other actions (dungeons.ts:299-300).
   **Options:**
   (a) Keep the immediate exit. Negatives: an open vote and a running fight are abandoned.
   (b) Exit only between encounters: no open vote (`cave.paused`) and no fight, with a time cap after which the exit goes anyway. Negatives: the party reaches the event later; a new rule plus a cap value to choose.
   (c) Never exit for an event; only skip events. Negatives: the same as protection on, so the setting loses its meaning.
   **Recommendation:** (b). It beats (a) because the party does not lose a vote or a fight it is in, and beats (c) because the user's choice to leave for events still works. Negatives: delay before the event and one more timer.
5. **Cave Q5. Travel after the repair cap.**
   **Today:** after 3 failed-receipt repairs travel stops with no error of its own (travel.ts:142); the dashboard shows "Travel failed; use Retry failed preparation" (progress.ts:105), the same text as for the first failure. The receipt error of the failed member is copied into `error` (service.ts:154). A repair restart resets the regroup counters (travel.ts:30-41, 143-144).
   **Options:**
   (a) Keep. Negatives: the user cannot tell a first failure from an exhausted cap, or which member failed.
   (b) Show which repair ran out, the member and its receipt error. Negatives: more dashboard text; the counter reset (B.3) needs a fix in the same change so the count shown is true.
   (c) Also exit the run after the cap. Negatives: the remaining run time and rewards are lost for a travel problem that a manual move or Retry may fix.
   (d) No fixed cap: each failed repair is followed by the next one on the backoff (5, 15, 30, then every 60 s) while the run lasts, with (b)'s display of the member and its receipt error; the run's own expiry still ends the visit (service.ts:221-226). Negatives: a lasting failure costs a repair every 60 s and the party spends that run time standing; the counter reset still needs its fix so the count shown is true.
   **Recommendation:** (d), with (b)'s display. It beats (a) and (b) because both stop after 3 repairs until the user presses Retry or moves the party, and beats (c) because it keeps the run. Negatives: a dashboard change, a fix to the counter reset, and one repair a minute while a failure lasts.
   **Changed:** the earlier recommendation was (b), which keeps the cap of 3 at travel.ts:142, a fixed retry count that ends travel inside the cave until the user acts; the upstream priorities (00-overview) rule that out, so (d) is new and now recommended (the review queue A55).

## 6. Gaps

### 6.1 check-claims

Command: `LIMIT=100000 node tools/check-claims.mjs`, run in this folder after the verification
(docs/implementation/08-verification-07.md), filtered to lines naming `07-hunts-and-farming`.
Whole index: 9,421 functions, 0 unclaimed, 0 claimed by more than one spec, 0 unknown.

| Check | Result for spec 07 |
|---|---|
| Functions claimed by this spec | 802 (in 123 behaviours) |
| Claimed by more than one spec | 0 |
| Claims naming no known function | 0 |
| Behaviours with no test | 7 |

Behaviours with no test:

- HNT-015: Exit mode after a turn-in sends the party to the leader's saved farm; no production code sets exitMode in the current console
- HNT-041: Each heartbeat response sends focus (the Hunt target under Hunt), priorities, search radius, Hunt target and the party mode (default during rare or death recovery)
- HNT-052: A focus change that replaces the farmed species queues a move to an area of the new focus
- HNT-065: Status ingestion persists only when the Hunt record changed, ignoring its message
- HNT-079: Independent (solo) characters get a stub rare owner: no rare hunting outside the party scope
- HNT-087: Adopt a visit in progress: an idle roster member seen inside a cave puts the party in entering
- HNT-114: On every snapshot the character computes its farming monster type for the coordinator; the mode it computes is discarded

The tool does not list unclaimed functions by spec. Of the 591 functions proposed for 07, this
catalog claims 477 and other specs claim 114: 108 of those are listed in `catalog/handoffs-07.json`
and 6 are claimed elsewhere without a handoff entry. The other 325 functions claimed here were
proposed to other specs or found in triage (50 triage, 157 from 02-movement, 52 from 13-lifecycle,
22 from 04-targeting, 20 from 12-dashboard-and-status, 21 from the shared 03/04/05 group and 3 from
05-survival). Checked with a node one-liner over the catalogs and `proposed-sections.json`.

### 6.1a Ownership the coordinator has to settle

- **The `requested` keys are mostly stale.** They hold 285 distinct ids. 207 of them are now
  claimed by this catalog, so for those the key only repeats the claim. The other 78 are claimed by
  02-movement (60), 01-groups-and-tasks (14), 04-targeting (2) and 12-dashboard-and-status (2). The
  verification dropped 9 entries that repeated a function of the same behaviour (HNT-110, HNT-112,
  HNT-119).
- **Handed to 02 (4) and 04 (6).** Spec 02 claims `planHuntReturn` and its two closures (MOV-077)
  and the party convoy arrival port `acceptArrival@771` (MOV-160). The solo copy
  `acceptArrival@1988` is claimed by 01 (GRP-003). Spec 04 claims `passiveLevelAllowed` (TGT-014);
  the other five 04 handoffs (`queueRequest`, the role runner `request`, `closerHunt`, its
  `distance` closure and `huntReplacement`) matched this spec by name only. Eleven more handoffs to
  06, 08, 09, 10, 12, 13 and 15 are name matches of the same kind.
- **Handed to 01: 121 functions** (89 of them proposed to 07). Spec 01 claims the Hunt roster
  (`hunt/controls.ts` participants, `hunt/current-party.ts`), Follow changes (`participants.ts`),
  the mode switch (`hunt/mode.ts`), turn-in precedence, the pause order, the "at an event" copies,
  the anniversary yield, the solo-service wiring and the dungeon gate. Spec 07 still describes those
  behaviours (HNT-001 to HNT-007, HNT-013, HNT-023 to HNT-036, HNT-038, HNT-043, HNT-050, HNT-051,
  HNT-079, HNT-084, HNT-090) and `catalog/handoffs-07.json` lists each function with its target
  spec. If the coordinator decides the Hunt roster or mode switch belongs here, those entries move
  back.
- **Fork-only code is not in the current index**, so Achievement Hunt (section 3.1) has no catalog behaviour. `catalog/functions-fork.json` would hold it if the fork gets its own catalog.

### 6.2 Monster Hunt (part notes)

- The `check-claims.mjs` counts are in 6.1.
- Checked against the local game server copy ((local checkout), commit 43b2c8fc): the game accepts a Monster Hunt request within `B.sell_dist`, 400, of Daisy (`game node/server.js:225, 5483`), and a quest lasts 30 minutes (5513). The console's 100 and 120 are margins inside that. The 800 death-recovery radius is a console value with no game counterpart.
- This pass mapped tests by reading names and setups, without running them, and read the e2e specs only at the cited lines.
- Histories rerun on the ref for this check: `git log -s -L 74,94:runtime/coordinator/hunt/tick.ts` (B.1) and `git log -S "preparationChanged(prior.firstFailure)"` for `resetChangedGeometry` (d5279eab, B.5). On the fork, `git log -s -L` for Achievement Hunt `switchTo` and `tick` (section 3.1). The other histories come from review/full/events.md section 5.2.

### 6.3 Farming modes, focus and farm areas (part notes)

- The `requested` keys of HNT-037 to HNT-065 and HNT-113 to HNT-116 name 138 ids, proposed to 02-movement (78), 13-lifecycle (39), 12-dashboard-and-status (20) and 04-targeting (1) in `catalog/proposed-sections.json`. Today 89 of them are claimed by 07 itself; 49 stay with other specs: 02 (39), 01 (9) and 12 (1).
- Triage closures in application.ts in the listed ranges (417-420, 1802-1805, 546-559, 1901-1914, 761-779, 1978-1996, 700, 702, 708-712, 2000-2002) are now claimed by other specs: 01 (GRP-003, GRP-004, GRP-009, most solo ports), 02 (MOV-156b, MOV-159 to MOV-162, including `acceptArrival` at 771), 06 (EVT-004), 10 (INV-053) and 12 (DSH-270). Spec 07 claims four of them: the `rareControl` ports at 552 and 1907 (HNT-080, HNT-079) and the `rareEncounter` ports at 556 and 1911 (HNT-041). Monster Hunt wiring closures are claimed in section 1.1.
- Behaviours without a test: HNT-041, HNT-052, HNT-065, HNT-114.
- Not verified: this pass did not read the client farm reunion that `rejoinFarm` calls (shared.js beginFarmReunion); it is movement or survival code. This pass recounted the `farmingPolicy` writers and readers on the current console (2.2 B1): 6 writers and 44 reading lines in 31 files; the fork adds 2 writers.

### 6.4 Rares and Phoenix (part notes)

- Who claims the rare files today (`node tools/check-claims.mjs` inputs, counted with a node
  one-liner over every `catalog/NN-*.json`): rare-hunting.ts 102 functions (07: 88, 01: 5, 02: 9);
  phoenix-patrol.ts 21 (07: 11, 02: 9, 12: 1); phoenix-candidates.ts 2 (04); rare-progress.ts 3,
  rare-retention.ts 1, rare-retry-evidence.ts 5, rare-combat.cjs 16, rare-farming-return.cjs 8 and
  passive-settings.ts 8 (all 07); rare-route-distance.ts 1 (02); recovery-hooks.ts 6 (02: 4, 01: 1,
  07: 1).
- The `requested` keys of HNT-066 to HNT-083 name 135 distinct ids. 108 of them are claimed by 07
  itself; 27 stay with other specs: 19 in 02 (MOV-148 to MOV-152), 5 in 01 (GRP-017, the
  protection checks), 2 in 04 (TGT-025, `phoenixCandidates`) and 1 in 12 (DSH-053, the scan
  message).
- Related functions held by other specs: shared.js `ownedRareTarget`, `rareTarget`,
  `nativeAttackProjectile`, `tinyProjectileProtected`, `rareAttackAllowed` (04, TGT-013),
  `passiveLevelAllowed` (04, TGT-014), `cancelRarePath` (02, MOV-049), application.ts `rareTick@1743`
  (01, GRP-018), `blocksPulls@2426` and `patrolAcquisitionAllowed@2427` (04, TGT-037).
- Test index gap: rare-hunting.test.cjs has seven loops that build 28 test names at run time
  (L32, 51, 160, 176, 194, 284, 315), and phoenix-patrol-regression.test.cjs one that builds 12
  (L315). A regex index over `test(` calls does not list those names.
- Checked against the local game server copy: the Phoenix has one spawn entry with five
  boundaries (game design/maps.js:650-661), the server picks one at random per spawn
  (node/server.js:13491-13497), and it respawns after 32 s plus up to 0.9 s (design/monsters.js:450-451,
  node/server.js:13428). The 300 field generator radius matches node/server.js:3620-3630.
- Not verified: the accuracy of the e2e tests (not read in full); the rare tick rate per second
  (B8).
- This pass ran no tests.

### 6.5 Cave and daily dungeons (part notes)

- **HNT-087** (adopt) has no test.
- The two main live-cave journeys are not in the test index (ternary name); the catalog lists their ids by hand.
- Checked against the local game server copy (commit 43b2c8fc): the three-member limit (game node/logic/generated_maps.js:465), the Dorr NPC id `dreamkeeper` and its position (game design/maps.js:1966, design/npcs.js:1135), the 160 entry radius (generated_maps.js:478), the 160 talk reach (node/logic/cave_of_many_dreams.js:1940), the 400 chest radius between centres (cave_of_many_dreams.js:558), and Nera on a respawn inside the Cave (node/server.js:6224-6226).
- B.4 and B.5 effects are inference; no run log shows them.
- This pass ran no tests.
- Functions named here but owned by other proposals: cave-recovery.ts and caveRecovery (05), Cave target rules (04), `dungeonRuntime>move/travel/sharedRoute/preparedCaveRoute` and `canMove` (02), cave-floor-handshake.ts (13), dashboard dungeon panel (12). The party-action helpers `exitDungeon` and `releaseDungeon` are claimed here under **HNT-089**.

## 7. The design

M1.

## 8. What changes for the player

M1.

## 9. Proof

M1.

## 10. Migration

M1.
