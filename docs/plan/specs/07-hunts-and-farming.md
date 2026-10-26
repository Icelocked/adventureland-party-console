# 07 Hunts and farming

Milestone M0 (the map). Prefix `HNT`. Checked against Ryan's base `refs/review/ryan-1.5`
(b9b5c91e) in (local checkout); fork lines are marked "fork af92de45".
Every file:line is on the Ryan ref unless marked. "Inference:" marks a claim that the code alone
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

- **Proposed functions.** `catalog/proposed-sections.json` proposes 591 functions for this spec (`node -e "console.log(require('./catalog/proposed-sections.json').filter(x=>x.spec==='07-hunts-and-farming').length)"`). Every one is either claimed by a behaviour in `catalog/07-hunts-and-farming.json` or handed off in `catalog/handoffs-07.json`. Triage functions that wire this spec's services are claimed too.
- **Requested functions.** The heuristic put several of this spec's modules in other specs: `navigation/rare-hunting.ts` and the farm-area modules in 02, the Hunt and farming HTTP routes in 13, and the farm-zone library in 12. Those functions are described here and listed under a `requested` key on the behaviour they implement. The coordinator decides whether they move to 07 (section 6).
- **Tests.** Test ids are `file::test name` as found by `scripts/tests/*.test.cjs` and `e2e/*.spec.ts` on the ref. The index was built with a regex over `test(` and `it(` calls; names built at run time are missing from it (section 6).


## 1. What it does today


### 1.1 Monster Hunt

Words used here: a **cycle** is one `state.monsterHunt` record (`hunt/lifecycle.ts:155-176`). Its **stage** is a plain string; the stages that code writes are `daisy-sync-travel`, `checking-quests`, `assigning`, `at-daisy`, `waiting-expiry`, `returning`, `mission-travel`, `farming`, `paused-event`, `blacklist-retreat`, `backup-travel`, `backup-farming`, `batch-loot` and `ended` (`git grep -n -E "stage *= *['\"]" refs/review/ryan-1.5 -- runtime/coordinator/hunt`). A **mission** is one quest target with its owners and destination (`policy.ts:49-53`). **Daisy** is the Monster Hunter NPC (`monsterHunterLocation`).

#### Hunt mode and cycle

**HNT-001 Selecting Hunt.** The dashboard posts mode `hunt` to the farming-mode route (`http/hunt-mode.ts:70-86`, described with the farming modes). The route then calls `createHuntMode.select` (`hunt/mode.ts:115-130`).
- Rules: Hunt restarts when a backup was supplied, the previous mode was not Hunt, any participant cancelled navigation or an escape runs, or no cycle exists (`mode.ts:93-98`). A supplied backup focus replaces the shared focus and clears the followers' own focus (`mode.ts:88-92`). On a restart, unless the party is fighting, the coordinator releases escape and authorizes the party to the given location, else Daisy, else the first live quest's spawn (`mode.ts:70-81, 126`). The previous non-Hunt mode is kept as the cycle's return policy; from Hunt it reuses the saved one or `auto` (`mode.ts:99-101`).
- Selecting Hunt again while a cycle runs and nothing is cancelled does nothing to the cycle (`mode.ts:93-98`, test monster-hunt-start).
- Settings: backup focus and backup area (required, `hunt-mode.ts:52-61`).

**HNT-002 Leaving Hunt.** Choosing another mode from Hunt releases escape, clears Hunt state, the death recovery record and the farm-area recovery record, then starts a convoy to the leader's configured farm (`mode.ts:37-50, 51-69`). It skips that convoy while a member has an open event trip (`mode.ts:55-61`). While an event return runs, the change is queued: the mode is written, the cycle is reset, and the return's post-exit destination becomes the leader's farm (`mode.ts:105-114`).

**HNT-003 Starting or resuming a cycle.** `begin` clears the farm-area pause, failures and pending move (`lifecycle.ts:214-218`, a write into the farm-area owner's record). A resume (explicit retry with a cycle that is not ended) deletes the route budget, cancels the Hunt convoy, clears Hunt commands, goes to `checking-quests` and prepares quests unless loot is pending or a member is at an event (`lifecycle.ts:125-140`). A new cycle takes the leader plus current participants that are in the fresh party (`lifecycle.ts:185-188`), keeps unfinished loot from the old cycle (`lifecycle.ts:189-192, 200-202`), records each member's last death as a baseline (`lifecycle.ts:142-153`) and starts in `checking-quests` (`lifecycle.ts:194-195`).

**HNT-004 The Hunt tick.** `monsterHuntTick` runs the party Hunt when a leader exists and the dungeon does not own the party, then every solo scope's Hunt, saving when a solo cycle changed (`application.ts:2136-2144`). `createHuntTick.tick` (`tick.ts:74-94`) runs only in Hunt mode or exit mode (`tick.ts:106-108`). With no cycle it begins one if no convoy runs (`tick.ts:77-80`). Then, in this order: roster repair (81), communication hold (82), failed return (83-86), arrival reconcile (87), rare encounter (88), expiry (89), combat event (92), then `advance` (24-38): backup farming, loot barrier, batch loot, turn-in ownership, return message, deaths, then death-recovery wait, route recovery, farm-walk recovery, pause, quest check, blacklist retreat, roster reconcile and travel (57-70). The order decides which pause wins and which message shows (see B.1).

#### Party roster

**HNT-005 Who takes part.** Participants are the leader and its followers that are online, not merchants and on the leader's server, sorted leader first; none at all when the leader is stale over 10 s or is a merchant (`controls.ts:34-52`). `currentHuntParty` applies the same rule to every character seen in the last 10 s (`current-party.ts:4-7`).

**HNT-006 Repairing a saved roster.** Each tick (and before preparing quests) the cycle drops members no longer in the current party and drops their Hunt commands; if the quest owner or turn-in owner left, the owner, turn-in, missions and target are cleared and the cycle returns to `checking-quests` (`current-party.ts:33-53`, 9-31). It does nothing while the leader itself is missing (41), during a geometry reload (54-57), or while the Hunt convoy has a communication hold or a member report older than 3 s (58-63).

**HNT-007 Follow changes and late members.** Each travel step drops participants that no longer follow, puts the leader first (`participants.ts:32-39`) and cancels any active convoy whose purpose is not `monster-hunt` (`participants.ts:89-92`; precedence by side effect, asks 01). Late members join a version 3 cycle directly; an older cycle rebuilds its missions when untouched (`participants.ts:40-67`). A version 1 cycle stuck in `waiting-expiry` with only the leader's quest is moved to `assigning` (`participants.ts:69-83`).

**HNT-008 Fresh status gate.** Most steps wait with "Waiting for fresh Hunt status from X" while any participant is missing, older than 10 s, dead, or on another server than the leader (`lifecycle.ts:35-50`).

#### Quest selection and Daisy

**HNT-009 Which quest.** `policy.selection` (`policy.ts:34-48`): a selected quest with time left stays selected while its owner is still in the party, unless it became blacklisted with kills left (37-40). Otherwise members are checked leader first: no quest or an expired one means `pickup` (43), a finished count means `claim` (44), a quest that is not blacklisted means `farm` (45). Blacklisted quests with kills left are skipped; when every member is skipped there is no selection (47). One quest is farmed at a time: `missions` returns at most one mission (49-53). `owner` and `quest` read the turn-in owner while a turn-in runs, else the selected owner while the leader is unchanged (22-29). `build` stamps a new mission revision and policy version 3 (`quests.ts:54-64`).

**HNT-010 Preparing quests.** `prepare` (`quests.ts:157-191`) repairs the roster, moves a backup cycle to `backup-travel`, waits for fresh status, and waits with "Waiting for combat event before checking Hunt quests" while any participant reports an event or an event return runs (164-172). A batch pickup walks to Daisy (173-182). Otherwise it adopts the selection (116-124) and either walks to Daisy to pick up a quest, returns to claim, restarts travel to the current mission, or rebuilds missions and advances (126-155).

**HNT-011 Missions in order.** `advance` cancels the Hunt convoy and starts the next mission that is not skipped, not blacklisted and still has kills (`quests.ts:84-102`). A mission without a spawn destination is marked skipped (94). With no mission left the next selection decides: none goes to backup farming, `pickup` prepares, anything else returns to Daisy (103-113).

**HNT-012 At Daisy.** Travel to Daisy ends when every participant is fresh (3 s), alive and within 100 of Daisy (`travel.ts:54-86`). At Daisy `process` (`quests.ts:324-336`) regroups anyone farther than 100 (281-301), clears completed interaction commands (193-201; a command also counts as done 15 s after issue once a newer status arrives, 27-34), runs a batch pickup (303-323), issues one `assign` to the selected owner when a pickup is pending (207-225) or `claim` to every member with a finished quest (227-235). The character confirms each interaction through `/hunt-interaction` (`http/hunt-control.ts:122-152`); a failure clears the command and shows "Retrying <action> for <name>".

**HNT-013 Turn-in.** A quest is due when the owner has no live quest or its count is 0 (`policy.ts:30-33`). A due quest starts the turn-in: the turn-in record takes the owner and phase `returning`, Town fallback state resets, and a convoy to Daisy starts (`policy.ts:54-61`; `quests.ts:66-75`; `travel.ts:8-13`). The turn-in owns travel until its phase is `complete` (`policy.ts:17-21`, handed to 01 as a precedence predicate). Rewards checked set phase `complete` and open a 2 s window in which events may start before the next quest (`policy.ts:62-72`; `quests.ts:329-334`). A cycle saved by an older policy or under another leader is rebuilt (`policy.ts:73-75`; `recovery.ts:37-52`).

**HNT-014 Expiry.** While a mission travels or farms, `observeHuntExpiry` records each owner's attempt with a deadline from its fresh report (`expiry.ts:22-46`). When a fresh report shows the quest gone after the deadline, the attempt counts one expiration failure, once, unless the target is already blacklisted (`expiry.ts:58-78`). At Daisy, an unfinished quest that must expire sets `waiting-expiry` with "Waiting at Daisy for the selected hunt to expire; events remain allowed" (`quests.ts:261-279`); `blacklistExpired` records an expiration when no attempt tracked it (250-259).

**HNT-015 Exit mode.** After rewards, a cycle with `exitMode` clears Hunt and starts a convoy to the leader's configured farm (`quests.ts:237-248`). No production code sets `exitMode` to a value: `git grep -n -E "exitMode *(=|:) *['\"a-z]" refs/review/ryan-1.5 -- runtime scripts characters ':!scripts/tests'` finds nothing, and the only writes set it to null (`lifecycle.ts:94, 106`; `recovery.ts:31`). Inference: this path runs only for cycles saved by an older build or built by tests.

#### Travel and farming the quest

**HNT-016 Starting a Hunt convoy.** `createHuntConvoy.start` (`convoy.ts:121-146`) refuses with a message when: a return is asked while any member lacks convoy protocol 4, location data is missing, or loot is pending (16-29); a convoy already runs; a member cancelled navigation or an escape runs (31-41); travel defense is not clear, except an outbound mission may start while defending (130-137). A return when everyone is already within 100 of Daisy goes straight to `at-daisy` (138-143). Otherwise it authorizes the party and starts a `monster-hunt` convoy (101-119) and copies the routing flags onto the convoy and every issued command: no combat handoff, Hunt target on outbound legs, non-preemptible continuous return on returns, native fallback, Town policy (72-99). When no leader is online on the convoy realm it shows "Waiting for an online party leader on the convoy realm" (109-111).

**HNT-017 Which spawn.** The mission destination is the saved preferred spawn for that monster, else the nearest catalog zone on the leader's map, with cross-map zones last (`controls.ts:86-112`). Preferences are keyed by map and spawn center (`spawn-preferences.ts:2-10`). Settings: Hunt setting `preferredSpawns`.

**HNT-018 Arrival.** Mission travel ends only when every participant is fresh (3 s, at most 500 ms in the future), alive, on the destination map and instance, on the leader's server, and inside the spawn area with the character's search radius (`travel.ts:244-258`). Without a convoy, `reconcileArrival` (`travel.ts:281-300`) moves the cycle to `farming` only when the last convoy's expected revisions still match, no member cancelled, and no member reports an event. The rare owner calls it when it hands travel back (`application.ts:1777`). Convoy arrival is accepted through the convoy engagement route with `huntSafety.acceptArrival` (`application.ts:771`; described in HNT-059).

**HNT-019 Farming the quest.** In `farming`, Hunt repairs a cycle that never reached the spawn (`travel.ts:232-238`), waits while members recover from a death (back within 800, `travel.ts:121-146`), returns to Daisy when due, and waits while the party fights (`travel.ts:240-242`). When the leader is outside the destination with a 150 margin and no handoff or arrival grace protects it, Hunt logs "Hunt arrival recovery" and restarts mission travel (`travel.ts:181-230`, 148-164). When the quest timer runs out it returns to Daisy; when no owner has kills left it advances (`travel.ts:166-179`).

**HNT-020 No handoff to farming combat.** A Hunt convoy never hands off to combat; an old client asking for a handoff is refused, and replacement commands keep the Hunt target for attacks while moving (`engagement.ts:5-23`).

**HNT-021 Temporary encounters.** A cycle with an `encounter` record pauses travel and fights it (`travel.ts:275-280`; `encounter.ts:74-113`). The encounter ends when the monster's death is confirmed, the quest is due, or the monster is absent for 5 s of fresh observations; observation time does not advance while reports are stale (`encounter.ts:15-72`). A nearby Hunt target seen by a member continues the encounter (`encounter.ts:98-111`; `nearby-target.ts:9-39`). Loot is collected before travel resumes (`encounter.ts:85`). No production code creates an encounter: commit 829b85ba (2026-09-22) removed the writer from `engagement.ts` (`git show 829b85ba | grep "^-  else hunt.encounter = "`), and `git grep` finds no other writer. Inference: this runs only for cycles saved before that commit and in tests.

**HNT-022 Legacy destination repair.** A mission whose destination predates `destinationVersion` 1 is matched to the spawn catalog; an unmatched point is replaced by a catalog spawn when the party is fresh and not fighting (`encounter.ts:120-157`). It runs on every step until each saved cycle is repaired.

#### Loot barrier

**HNT-023 Loot before leaving.** When a mission's owners all finished their quest (fresh within 3 s), Hunt creates a loot barrier at the leader's position and cancels the Hunt convoy until the leader reports a matching completed loot pass within 180 of that spot after the barrier started (`loot.ts:23-89, 131-144`). The barrier id is the cycle, revision, mission index, target and owners (`loot-identity.ts:1-4`). A collector that moved away from the barrier releases it (`loot.ts:102-118`). Events, a cancelled or dead member and an event return skip it (`loot.ts:11-22`). Batch loot waits for a complete barrier, fresh status, no event return and no member at an event before preparing (`tick.ts:39-56`).

#### Pauses, deaths and recovery

**HNT-024 Combat event pause (asks 01).** When any participant reports `activeEvent` or `joinedEvent` and no turn-in owns travel, Hunt saves its stage, sets `paused-event` with "Paused for combat event" and cancels its convoy (`travel.ts:15-28`). The tick checks this before `advance` (`tick.ts:92`), and travel checks it twice more (`travel.ts:262, 277`). Resuming fights a held encounter, returns when due, or restarts mission travel (`travel.ts:30-52`).

**HNT-025 Other-owner pause (asks 01).** `recovery.pause` (`recovery.ts:157-177`) first drops a stale normal-farming fallback convoy (`recovery.ts:125-139`, matched by purpose `hunt-fallback` or by its label text). Then: when another owner holds travel (`policy.eventOwnsTravel`, handed to 01: an event return, any non-Hunt convoy, or an open anniversary cycle, `policy.ts:82-93`) it sets `paused-event` with a message from the convoy or event return (140-156); when the farm-area owner is paused or has a pending move it waits with that owner's message (167-170); when a member cancelled navigation it cancels the Hunt convoy with "Hunt movement is paused; select Hunt again to resume" (171-176).

**HNT-026 Communication hold and rare encounter.** A communication hold on the Hunt convoy stops the tick with the hold reason, after counting deaths (`tick.ts:100-105`). An active rare encounter stops the tick with the convoy's defense reason or the encounter message (`tick.ts:95-99`; asks 01).

**HNT-027 Return status text.** While returning, Hunt shows the return leg, Town interruptions, preparation blockers, geometry repair, or "Daisy return held; request Retry return to resume: <failure>" (`recovery.ts:5-23, 54-82`).

**HNT-028 Failed return and fallback.** A cycle in stage `failed-return` ends when a member cancelled navigation, else `finishFailed` authorizes the party and starts a `hunt-fallback` convoy to the saved backup farm and ends the cycle (`recovery.ts:28-35`; `lifecycle.ts:72-100`). No production code sets stage `failed-return` or `endReason` (`git grep -n "failed-return\|endReason" refs/review/ryan-1.5 -- runtime scripts characters` shows reads only). The live path for a failed turn-in is the held convoy plus the manual Retry return route, which needs a failed `monster-hunt` convoy, fresh members with protocol 4, no foreign command and no escape (`http/hunt-control.ts:84-121`).

**HNT-029 Deaths.** `huntSafety.recordDeaths` returns the participants that died since the last count, without deaths on an event trip (`scripts/hunt-safety.cjs:42-74`, in HNT-059). Hunt clears the farm-area pause and pending move (`recovery.ts:100-103`), adds the deaths to the target's death count (`recovery.ts:84-94`), cancels its convoy, and below the threshold keeps the quest in `farming` with "Recovering after a party death; continuing the current Hunt" and waits for every member to be back within 800 of the destination (`recovery.ts:107-113`; `travel.ts:121-146`). At the threshold the mission is skipped and the cycle enters `blacklist-retreat` (`recovery.ts:114-122`). While a death recovery (`state.combatRecovery`) is active, Hunt only shows its reason, "Recovering after party death" by default (`tick.ts:58-61`). Death recovery itself belongs to spec 05.

**HNT-030 Blacklist retreat.** In `blacklist-retreat`, or while the current target is blacklisted, Hunt waits while an event return runs or any member is stale or at an event, then rebuilds missions and advances (`recovery.ts:179-199`).

**HNT-031 Restart after an exhausted escape.** When an escape during a Hunt death recovery reports `recoveryFailed` for a fresh living member, Hunt cancels the recovery, releases the escape, starts a new cycle with the old return policy and location, and logs "restarting hunting routine due to failure", once per escape id (`retreat-restart.ts:29-83`). It waits while an event return, any convoy, or a member event field exists (37-42), and requires the recovery to match the current leader, focus and navigation revisions (30-36).

**HNT-032 Route recovery.** When a `monster-hunt` convoy (or the Hunt's farm-recovery walk) fails with code `route-failed`, the failure is recorded per destination and leader geometry (`route-recovery.ts:58-87, 223-244`). The first failure from a non-native planner gets one native-planner attempt; any other failure excludes the spawn (88-103), and Hunt tries the next spawn of the same monster that is not excluded (148-184). With none left it shows "No reachable <monster> spawn remains in this Hunt cycle" (160-167). A changed geometry fingerprint, or a first failure whose text matches `preparationChanged` (`navigation/shared-departure.ts:57-60`), deletes the budget (245-251). Route recovery waits for farm pause, event return, escape, an encounter, a newer owner of any member, stale status, cancellation or member events (104-131). It also restores a mission spawn that the old farming retry owner replaced with a waypoint (285-303). A user resume deletes all budgets (HNT-003).

**HNT-033 Farm-recovery walk under Hunt.** The character's farm reunion starts a `shared-walk` with `walkingActivity: "farm-recovery"`. When Hunt owns that walk (same participants and revisions, not non-preemptible) and the quest becomes due or the walk failed, Hunt cancels it, resumes `farming` or `mission-travel`, and returns to Daisy if due (`farm-walk.ts:15-47, 95-105`). A failed farm relocation (pending reason starting `Travel failed:`) for the mission's own spawn, during `paused-event`, resumes mission travel (`farm-walk.ts:49-94`). An expired anniversary checkpoint yields to the Hunt turn-in and is marked superseded (`expired-anniversary.ts:5-24`).

#### Blacklist and backup farming

**HNT-034 Hunt settings and the blacklist.** Settings (`hunt/settings.ts:10-16`): `relocateIfCompeting` true, `blacklistDeaths` true with `deathThreshold` 1, `blacklistExpirations` true with `expirationThreshold` 1, and `preferredSpawns`. Thresholds must be whole numbers of at least 1 (`settings.ts:29-41`). Failure counts keep growing while a threshold is off, and turning it on applies the saved counts (`settings.ts:55-84`; test hunt-settings). The blacklist route adds a monster ("Manually blacklisted"), removes one with its counts, or clears all (`http/hunt-control.ts:169-201`). Blacklists and counts survive Hunt restarts; only the clear action resets them (`mode.ts:40-41`).

**HNT-035 Backup farming.** When no member has an eligible quest, Hunt cancels its convoy and enters backup with "Backup farming: waiting for all blacklisted quests to expire" (`lifecycle.ts:102-118`). Each tick shows how many members are ready (quest gone) and waits for fresh status (`backup.ts:176-201`). A member's eligible quest resumes normal assignment; when every member is ready Hunt picks up a whole batch at Daisy (`backup.ts:69-89, 202-206`; `quests.ts:303-323`). Meanwhile it travels to the backup area, which is the saved area if it still contains a focus monster, else the leader's selection (`lifecycle.ts:52-70`; `backup.ts:123-173`). It does not start travel while fighting at the area or while farm travel recovers (130-139). Manual cancel, escape, death recovery and events pause it (`backup.ts:33-68`).

#### Wiring

**HNT-036 Composition.** `createCoordinatorHunt` wires the lifecycle, convoy, quests and tick around one state (`composition.ts:47-114`). The party copy is at `application.ts:445-478` and the Hunt actions at 718-744; `createSoloServices` repeats both for each independent character (`application.ts:1830-1861, 1944-1969`). `cancelCoordinatorHuntConvoy` cancels only a `monster-hunt` convoy and its Hunt commands; `clearCoordinatorHunt` also drops the Hunt's farm-recovery child walk and orphan Hunt commands (`controls.ts:55-78`).

### 1.2 Farming modes, focus and farm areas

Words used here: the **policy** (`farmingPolicy`) is what the user picked (auto, default, scatter, hunt). The **party mode** (`partyFarmingMode`) is what the coordinator tells characters this moment: `scatter` (each fighter takes its own target) or `default` (the party fights one queue together). **Focus** is the list of monsters to farm. The **farm area** is the saved spawn region (`party.location`) the party farms in.

#### Farming modes

**HNT-037 The farming mode route.** The dashboard posts a mode to the farming-mode route (http/hunt-mode.ts:70-86).
- Rules: only `auto`, `default`, `scatter` and `hunt` are accepted (hunt-mode.ts:73); anything else is a 400. Hunt also needs an online non-merchant leader and either Daisy's location in the catalog or a member holding a live quest (hunt-mode.ts:32-44). Hunt needs a backup farming area with at least one monster that is not `all` (hunt-mode.ts:52-61); a supplied backup must match a catalog farm area exactly (hunt-mode.ts:79-84, validFarmingLocation). The route then hands the change to the Hunt mode owner (`modes.select`, hunt/mode.ts, HNT-001) and saves (hunt-mode.ts:62-63).
- The return location for Hunt is the Hunt's saved return location when already in Hunt, else the leader's waypoint (hunt-mode.ts:27-31).
- Settings: the mode itself; backup focus and location.

**HNT-038 Farming scopes: follow the leader or farm alone.** Every combat character either belongs to the leader's farming scope or owns its own scope with a full copy of the farming services.
- Rules: a character is a combat character unless it is the merchant or has class merchant (application.ts:2050-2052). `soloFor` builds services only for a combat character whose scope owner is not the leader, once per character (application.ts:2053-2058). `createSoloServices` builds, per character, farming navigation, party convoys, Hunt, farm areas, heartbeat response, event returns and observations, focus route, Hunt actions and navigation actions (application.ts:1784-2007), with a rare stub that never owns anything (application.ts:1787) and one-member name lists (application.ts:1786, 1794). `independentServices` lists the solo scopes of active combat characters other than the leader (application.ts:2008-2011); farm-area ticks and Hunt ticks loop over them (application.ts:2088, 2139).
- A follower's mode change only saves its future preference (http/saved-farming-mode.ts:5-34): it accepts `auto, default, scatter, hunt` (line 12), and Hunt needs a valid backup focus and location (lines 19-25). The scoped route sends a character's request to its solo service, to the follower save path, or to the leader's route, and adds `farmingOwner`, `savedFarmingPolicy` and `effectiveFarmingPolicy` to the reply (http/farming-scope.ts:14-48). Edits for a merchant or a follower are refused with "Merchants do not run Monster Hunts" or "following leader settings" (farming-scope.ts:31-34).
- Character commands read the effective scope of the named character (application.ts:948).
- Settings: Follow (followers map), leader.

**HNT-039 The coordinator picks the party mode.** On every status report, status ingestion runs `observeScatter` for the reporter's scope (status/composition.ts:68-74; status/ingestion.ts:96).
- Members are the active leader and followers, without the merchant (composition.ts:71-72). The leader's status is the authority (composition.ts:73).
- A change of members clears learned types, bumps the scatter epoch and sets mode `default` (scatter.ts:31-41).
- While the mode is scatter, any member whose target, combat deviation or attacker is a different monster type than the party's type sets a **scatter break** (scatter.ts:47-70, 80-86). The break lasts until no member reports that monster for 3 s (scatter.ts:87-90).
- The party monster type is the break's type, else the leader's `farmingMonsterType`, its target's type, or the newest learned type (scatter.ts:117-120).
- Mode rule (scatter.ts:93-99): policy `default` gives default; policy `scatter` gives scatter; every other policy (auto, hunt, and the fork's achievements) gives scatter only when there is no break and the type is in the learned list. When the rare owner owns the scope, the mode is `default` (scatter.ts:123; application.ts:1062).
- Settings: the policy; Follow.

**HNT-040 Learning scatter types.** A character adds a monster type to its one-shot list when its own hit kills a focus monster with damage at or above the monster's full HP (characters/shared.js:1036-1044). It reports the list with the current epoch (shared.js:3075-3076). The coordinator appends new types only when the epoch matches (status/catalogs.ts:83-99), and a new epoch from the coordinator clears the character's list (shared.js:11389-11395). The comment at shared.js:1040 says the coordinator persists the learned type; initialFarmingState resets the list and the epoch on every start (navigation/initial-farming.ts:48-49), so learning starts over after a restart.

**HNT-041 The farming part of each heartbeat response.** `farmingResponse` (status/response.ts:215-229) sends: the character's focus; the Hunt target, only when the policy is `hunt` and Hunt is in stage `farming`; the character's monster priorities; the leader's search radius (default 400); and the party mode, forced to `default` while the rare owner owns the party or a death recovery is not complete or cancelled (response.ts:222-227).

**HNT-042 The character applies the mode.** The heartbeat handler copies focus, priorities, radius, scatter types, policy, Hunt target and mode (shared.js:11374-11404). A focus change sets mode `default` for 3 s and clears the current target (shared.js:11376-11384). The mode is scatter only for non-merchants when the coordinator says scatter (shared.js:11402).
- `groupedFarming` (shared.js:14127-14133): inside the Cave every non-merchant groups; a dungeon-owned character outside the Cave does not; otherwise a non-merchant groups when the mode is not scatter (or the convoy is defending), it is the leader or follows it, and no event travel, joined event, event target types or event map applies.
- `getFarmingMode`, the port the role runner reads, returns `default` in the Cave and during a rare encounter, else the mode (shared.js:17952-17955).
- `calculateFarmingMode` (shared.js:14786-14819) runs on every snapshot (shared.js:2837). It sets `farmingMonsterType` from the current target, the best visible focus monster in the area, the single focus monster, or the last type (lines 14800-14815), which the coordinator reads as the party type (HNT-039). Its return value is discarded.

#### Focus and monster selection

**HNT-043 The focus route.** The focus route (http/focus.ts:42-89) sets the monster list, priorities and search radius.
- Validation: at most 256 ids, word characters only, never `tinyp` (focus.ts:17-25); priorities 0 to 1000 (26-34); radius 1 to 10000 (35-40). `all` collapses the list to `["all"]`; duplicates drop (focus.ts:73).
- With a character name, `characterFocus` stores that character's focus; for the leader it becomes the shared focus and clears every follower override (navigation/focus.ts:37-52). Without a name the shared focus changes (focus.ts:78-81). The radius stays as before unless sent; an empty focus resets it to 400 (focus.ts:22-26).
- Any change resets scatter: learned types, epoch, mode default, party type, break (focus.ts:30-36, 59, 81).
- A change triggers a farm-area focus relocation (HNT-052) unless an active Hunt owns the focus (focus.ts:62-69, 83). An empty focus invalidates the navigation intent of the whole party (shared) or of that character (focus.ts:84-87; application.ts:704-705, solo copy 1941).

**HNT-044 Focus and mode at load.** `initialFarmingSelections` takes focus from the new selections record, then the legacy settings, then `["goo"]` (initial-focus.ts:3-7, 15). The saved policy loads only when it is `auto, default, scatter, hunt`; any other value becomes `auto` (initial-focus.ts:22-24). `migrateSharedMonsterFocus` promotes a legacy leader override to the shared focus (migrate-focus.ts:9-18); `migrateEmptyFocusIntents` cancels intents for saved empty focuses when no intents were saved (migrate-focus.ts:21-40).

**HNT-045 A bestiary pick.** The monster-selection route (http/monster-selection.ts:28-49) refuses `tinyp` (31-34), a Phoenix pick without all five regions (35-36), an unknown id (37), and an offline leader (38-39). It resolves the location from the request or the nearest Hunt destination (40-43; application.ts:785-788) and releases a held dungeon (44, 24-27).
- `select` (navigation/monster-selection.ts:62-78) releases escape, replaces `farmAreaState` with only the preferred location, clears Hunt, sets policy `auto`, sets focus to the one monster, clears follower and leader overrides, resets scatter, and clears event returns, deferred returns and event sessions (44-61). It authorizes the whole party to the location and starts a `manual-monster-override` convoy (66-68), then marks every live event occurrence the members attend as skipped for manual travel (69), flags `party-monster-travel` commands as a manual override (70-73), and starts or stops the Phoenix patrol (74-75).
- Wiring: application.ts:781-800.

**HNT-046 Passive hunting settings.** The passive route validates the body with the rare owner's validator, refuses unknown monsters and `fieldgen0`, and hands the rules to the rare owner (http/monster-selection.ts:50-63; application.ts:797-798). The rare part of spec 07 describes what the rules do.

#### Farm areas and relocation

**HNT-047 Farm areas from the spawn catalog.** `zones` turns each focus monster's catalog spawns into areas and merges overlapping shaped spawns of the same monster on one map (dashboard/lib/farming-zones.ts:171-207). `farmingAreas` deduplicates identical regions and adds the intersection of overlapping areas of different monsters, so shared regions list several monsters; it sorts areas with more monsters first (farming-areas.ts:16-86). `contains` measures shapes by polygon distance (zero inside) and point spawns by radius (farming-zones.ts:45-95). `resolve` matches a saved location to its catalog area (farming-zones.ts:208-231). `validFarmingLocation` accepts only an area whose map, x and y equal the request exactly (farming-areas.ts:87-104). `defaultPhoenixOrder` maps five fixed points to areas (farming-areas.ts:5-13).

**HNT-048 Area membership on the character.** `inFarmArea` uses the zone shapes when loaded, else the search radius around the area point (shared.js:14870-14876); `inFarmRadius` uses the radius only (14909-14912). `selectFarmCandidates` keeps only the Hunt target type within the radius during Hunt farming; otherwise it prefers targets inside the area and falls back to the radius (14913-14921). `farmingEntryPoint` picks the walkable search point of a shaped area nearest the character, and throws "No walkable entry point" when none exists (15067-15078).

**HNT-049 Competition evidence on the character.** `observeFarmHit` records damage, kills and deaths that a non-party player deals to a monster inside the area, keeping the newest 20 (shared.js:14923-14934). `farmCompetitionObservation` counts live monsters by type and non-party players within the search radius (14935-14948). `observeFarmArea` remembers visible monsters and reports the area as fully observed when all four corners of its bounds are within 400 of the character (14949-14961). The snapshot sends all three (shared.js:3054-3056).

**HNT-050 Contested areas.** `record` (scripts/farm-area-control.cjs:8-28) reads each report's evidence, ignores party members, hits older than 10 s and duplicates, and marks an area contested for 120 s (`COOLDOWN`, line 2) after one kill or two hits within 10 s (19-21). A fully observed area is recorded as quiet (24-25). `prune` drops old entries (33-37); the coordinator also prunes saved farm-area records at load (application.ts:24-30). `alternatives` excludes the active area, excluded areas and contested areas, and ranks same map first, then more monsters, then quiet, then distance (farm-area-control.cjs:38-44). `fighting` is true for a fresh living member with a live threat or a target it can attack or attacked within 3 s (3-7).

**HNT-051 Relocating away from a competitor.** The farm-area owner ticks at most once a second (navigation/farm-areas.ts:257-272; application.ts:2086-2089, solo scopes included), and skips while the rare owner owns travel (258), while Hunt is in mission travel or owns the route (254-256, 266), and while the dungeon owns the party (application.ts:2087).
- Each tick records evidence (HNT-050), then stops when any member is stale, dead, cancelled or at an event, or an event return or escape runs (farm-areas.ts:240-245).
- `movement` (173-194) stops while Hunt's turn-in or any other travel owner holds the party (`workflowOwns`, 196-198; asks 01), while any convoy runs or farming is paused (186), and outside Hunt stage farming (191).
- `relocateBusy` (144-171) applies only to shaped areas. A contested area counts as busy only 120 s after the last move (117-120). `competitionHold` (farm-competition.ts:65-97) holds the move when Hunt's `relocateIfCompeting` setting is off, when any member lacks a fresh matching observation, when any member still sees a focus monster, or when the competitor is no longer seen. Otherwise the best alternative becomes a pending relocation with the members' intent revisions (farm-areas.ts:156-170; farm-area-recovery.ts:10-23).
- `processPending` (121-142) drops the pending move when a member's revision changed, cancels a conflict move whose hold returns (109-116), waits for its start time, and waits for travel defense to be clear. `startPending` (80-107) sends a Hunt mission to the new area through Hunt's convoy, or authorizes the party and starts a `farm-relocation` convoy.
- Settings: Hunt setting `relocateIfCompeting`; search radius.

**HNT-052 Moving after a focus change.** `focusChanged` (farm-areas.ts:273-293) does nothing in Hunt, for a custom waypoint, an empty or `all` focus, a focus that still includes a farmed species, no members, or any cancelled member. Otherwise it queues a pending move to the best alternative for the new focus, marked `focusChange`, and waits for other owners (comment 287-289).

**HNT-053 Failed farm travel.** When the active convoy failed and its purpose is none, `monster-hunt`, `farm-relocation` or `empty-spawn-recovery` (farm-areas.ts:200-216), recovery runs (farm-area-recovery.ts:86-115):
- A stale empty-spawn convoy is cancelled (26-31, 95).
- The failure is transient when its text matches a regex of 13 words (72-74); otherwise the area's failure count goes up (75).
- A `geometry-mismatch` failure pauses farming with no retry (97-99).
- Otherwise the convoy is cancelled and a pending move is queued: the same area after 10 s for transient failures, after 2 s for counted ones, or the best alternative after more than one counted failure (102-111). With no destination a Hunt mission is skipped and advanced, else farming pauses with "no reachable zone; select a farming area to retry" (32-45).
- `clearArrivedFailure` clears the last failure once every member is inside the area plus 150 (54-78). `migrate` resets old records once (24-32). `promoteShape` replaces a point location with its shaped area and also edits the current Hunt mission destination (34-40).

**HNT-054 Recovering to the saved spawn.** The leader's client can ask the farming-return route to walk the party back (http/farming-return.ts:83-99). It refuses when another owner holds travel: any convoy, the Phoenix patrol, a rare encounter, an event return, a pending farm move, an active Hunt, an open anniversary cycle, scatter mode, a cancelled intent, or any event field on the leader (38-59; asks 01). It skips when the leader is inside, refuses while a fighter has a target or within 10 s of the last request (31-37), and starts an `empty-spawn-recovery` convoy (60-82).

**HNT-055 Handing a farming convoy to combat.** `engageFarming` lets the leader's report of a focus target inside the destination end a farming convoy early (navigation/farming-engagement.ts:5-24). It applies only to purposes none, `party-travel`, `farm-relocation`, `manual-monster-override` and `empty-spawn-recovery`, not to conflict moves, forced travel or a convoy that already engaged (39-42), and only with matching revisions and commands (43-50). If every member is already in place the convoy ends; otherwise it switches to defending (16-23). On the client, `pollFarmingCombatHandoff` stops following the leader and targets a reachable farm target when no other activity owns movement (shared.js:17652-17664).

**HNT-056 Farming waypoints and intent.** Each member has a navigation intent with a revision and a cancelled flag, and a waypoint: its own location or the shared `party.location` (scripts/farming-navigation.cjs:7-23). `authorize` first invalidates the members (a new revision), then clears the cancellation, sets the destination, and copies the new waypoint into every open event owner (127-150). `invalidate` bumps the revision, cancels the intent, drops travel commands, and cancels or rebuilds a convoy that includes the member (82-126). A Hunt participant's "monster focus cleared" cancellation is ignored while Hunt owns the destination (11-13). The event return dispatch in the same file belongs to spec 06.

**HNT-057 Farming state at load.** `initialFarmingState` restores Hunt, Hunt settings and failures, passive rules, Phoenix order and checkpoint, rare return and progress, the farm-area record and the blacklist, and resets scatter learning, party mode and the Daisy location (navigation/initial-farming.ts:30-54).

**HNT-058 Rejoining the farm after respawn.** The role runner's `rejoinFarm` port calls the shared routine's farm reunion (runtime/characters/roles/runner.ts:79).

#### Monster Hunt support on the farming path

These are Monster Hunt behaviours that live in farming files; section 1.1 refers to them.

**HNT-059 Hunt safety helpers.** `missionDestination` pins the current mission's destination once resolved (scripts/hunt-safety.cjs:1-5). `acceptArrival` turns a matching `monster-hunt` convoy arrival into stage `farming` (or `backup-farming` for backup travel) and records an arrival handoff (9-28). `arrivalProtected` keeps the handoff for 10 s while the cycle, mission, target, leader, revision, runtime and destination still match (29-41). `recordDeaths` counts a participant's death once per report, skips deaths during an event trip, and clears the arrival handoff (42-74). `partyFighting` checks for a live target or threat (75-82). Wiring: application.ts:461-477 (HNT-019).

**HNT-060 Hunt arrival at the spawn.** When every Hunt participant is fresh, alive and inside the mission area, `stepHuntArrival` holds the convoy (`shared-hold`), waits until every member is stopped on the same runtime, then deletes the commands, ends the convoy and sets stage `farming` (navigation/hunt-arrival.ts:50-71, 78-88). Event returns, escape, route relocation, merchant interruption and geometry waits block it (12-15). A member drifting out after the hold resumes the route (96-103).

**HNT-061 Hunt acquisition while travelling.** On a Hunt convoy the character picks the nearest monster of the Hunt type that passes `huntCandidateRejection` (visible, alive, same map, in radius, allowed, in range or reachable) (shared.js:15029-15039, 15040-15061). It stops while dead, cancelled, escaping or at an event (15022-15028), and logs the reason, at most every 2 s per channel and every 10 s for a repeat (15008-15021).

**HNT-062 Planning the Daisy return.** `planHuntReturn` prepares the route twice, walking only and with Town allowed (once only when Town is disabled), scores each by time (Town 7000, transport 1000, walking by distance over the slowest speed), and turns the cheaper plot into walk and Town legs with saved segments (shared.js:15723-15773). With no route it throws "No route to Daisy could be prepared".

**HNT-063 Daisy's location.** The coordinator keeps the `monsterHunterLocation` a character reports only when it is on map `main` with finite x and y (status/catalogs.ts:30-39).

**HNT-064 Hunt loot hold on departure.** `huntPending` holds departure while the mission is active, the character is a participant, and the mission has a loot barrier, batch pickup, a return or turn-in stage, a matching loot or final kill, or every owner's quest is complete; capacity recovery releases it during farming (runtime/combat/departure-loot.ts:72-81). The `questFor` port reads a peer's quest from fresh party positions (shared.js:17983).

**HNT-065 Hunt change detection.** Status ingestion snapshots the Hunt record without its message before and after the Hunt and farm-area ticks and saves only on a change (status/composition.ts:101; status/ingestion.ts:91-94).

### 1.3 Rares and Phoenix

A "rare" is one of six monsters the party drops its current work for: Fairy (`tinyp`), Phoenix,
Golden Bat, Cute Bee, Hen and Rooster (rare-hunting.ts:29-44). One coordinator owner,
`createRareHunting` (rare-hunting.ts:69-939), runs two activities: a rare encounter (chase, fight,
loot, go back) and the Phoenix patrol (walk the five Phoenix regions until one shows up). It is
built once for the party in application.ts:1776-1780. Most of its code is proposed to spec 02;
this spec describes it and lists those functions as "requested" so they can move to 07.

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
  within 3 s (rare-hunting.ts:338-345, FRESH 3000 at 45). An observation must match the member's
  `combatSelection.runtimeId` and be at most 3 s old and 1 s ahead (358-361). A sighting needs a
  known type, a string id, `visible`, finite x, y and positive hp (294-297). Sightings are keyed
  `realm|map|instance|id` (49-50) and dropped after 30 s; cooldowns and kill memory expire on the
  same pass (697-701). A kill counts only within 10 s of now (326-328) and is remembered 120 s
  (333).
- Settings: the passive rules decide which types are reported (HNT-068).

**HNT-067 Three paths feed and tick the rare owner.**
- Status ingestion calls `rareReport` then `rareTick` for every full heartbeat
  (status/ingestion.ts:87-88, wired at application.ts:1072-1073). The fast combat report does the
  same (status/combat-ingestion.ts:51-52), and keeps the older `rareObservation` when a report from
  the same runtime carries an older one (`preserveRare`, combat-ingestion.ts:16-23). The travel
  clock ticks it every 250 ms (navigation/runtime.ts:77-83, wired at application.ts:1743).
  `setSettings` ticks it once more (rare-hunting.ts:932-937).
- Both wired ticks skip while a dungeon owns the party (application.ts:1073, 1743).
- Order of one tick (rare-hunting.ts:862-880): restore saved rejections, expire observations, stop
  if the owner snapshot is stale, pause for protected activity, restore a saved patrol, take a
  patrol sighting, run the grouped path or the farming return, take a passive sighting, then step
  the encounter or the patrol, then publish `party.rareHuntState`.

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
- An encounter stays enabled while its rule is on and its level is under the cap, or while it is a
  Phoenix the patrol is assisting, or while grouped combat has locked it (`enabled`, 550-552).
- On the character, `passiveLevelAllowed` treats a missing cap or -1 as no cap
  (shared.js:3491-3494), and `passiveRareCandidate` makes an enabled rare, or a Phoenix while focus
  includes `phoenix`, a combat candidate that bypasses focus and farm-zone rules
  (shared.js:14300-14302, used at 14285-14298).
- The constructor runs two migrations on every start: passive settings from the old
  `passiveRareHunts` shape (rare-hunting.ts:101-102), and removing `tinyp` from saved focus lists
  (106-111).

**HNT-069 Passive acquisition.**
- A sighting is eligible when it is known, its retry evidence allows it (HNT-074), it is not a
  "keep moving" rule (those are passing attacks, spec 02/04) unless it is a Phoenix during a patrol,
  it has no cooldown or kill memory, nobody outside the party claims it, and its rule is enabled
  (rare-hunting.ts:730-754).
- Passive acquisition takes only sightings that are fresh, from a member, on the leader's map,
  instance and realm (816-824), whose target is not a non-member (477-479), and whose priority is
  at least the priority of the leader's current target (rare rule priority, else the leader's
  monster priority, default 50), or strictly higher than the current encounter's (825-838). It
  picks the highest priority, then the nearest to the leader (843-848).
- It does not run while grouped combat has fights, and in grouped mode it runs only while the active
  convoy is `farm-relocation`, `monster-hunt`, `manual-monster-override` or `party-travel`
  (839-842).

**HNT-070 The rare owner yields to protected activity (asks 01).**
- `protectedActivity` is true when the leader is missing, stale over 3 s or dead, Town is cycling,
  an event return or open anniversary cycle exists, death recovery is open, Hunt loot is
  unfinished, an escape is not released, Hunt owns a turn-in, or any member is protected
  (rare-hunting.ts:141-159). A member is protected when joined to or travelling to an event, dead,
  under 35% HP, or running a command other than party monster travel with one of six purposes
  (118-140).
- While protected, the tick ends any encounter that grouped combat has not locked, cancels rare
  travel, holds the farming return and shows a waiting message (702-719). `control()` sends no
  rare control in that state (894-896).
- Which activities win over rares is a precedence rule for spec 01; this spec only records the
  current list.

#### Rare encounter

**HNT-071 Beginning an encounter.**
- `begin` asks Hunt to reconcile its arrival, writes `rare:<type>` as the interruption on Hunt's
  travel checkpoint (rare-hunting.ts:395-397, 372-375), and cools down any previous encounter for
  3 s (400).
- If the active convoy is interruptible Hunt travel, it keeps that convoy and commits the rare into
  its `huntTravel` record as `committed` and `primary` with reason `passive-setting`; otherwise it
  cancels the convoy (376-388; `interruptibleTravel` in runtime/combat/hunt-travel.ts).
- It sets `partyFarmingMode = "default"` so scatter farming fights the rare as a group (403-405),
  clears `scatterBreakTarget` (426), and records the encounter with an owner snapshot (leader,
  realm, focus, policy, each member's navigation revision; 171-179), the return location and the
  current Hunt (406-422). It restores saved pursuit progress for that monster id (212-222) and
  saves the farming return obligation (389-391).
- Any change to leader, leader realm, focus, farming policy or a member's navigation revision ends
  the encounter as "new navigation" (`validIntent` 160-170; tick 865-867, 555-557).

**HNT-072 Encounter stage and movement.**
- In grouped mode, grouped combat moves the party; the stage is `combat` once the fight is locked
  (rare-hunting.ts:511-514). Outside grouped mode, the stage is `combat` once the leader's own
  sightings show the rare (504-510, 515-517); otherwise the owner starts a `rare-hunt` convoy to the
  sighting, at most every 3 s, only when no convoy is active (518-523).
- Progress resets when the rare's hp drops (467-476) or when a member's approach report shows it
  closing in by at least 8 units of deficit or waypoint distance after moving 2 units
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
  (497-503); a member fighting some other attacker extends progress (488-496).
- An encounter that ends with "selection released", "no progress" or "time limit" in its reason text
  stores a retry rejection (267-269). A rejected rare can start again only after a newer sighting
  with lower hp, new party engagement or new reachability on the same map
  (rare-retry-evidence.ts:31-39). Saved rejections are re-applied to grouped combat on every tick
  (rare-hunting.ts:859-861) and at construction (90).
- Pursuit progress (start, progress, lowest hp) is saved per monster id (217-222). Both records
  keep the newest 100 entries (rare-retention.ts:8-17).

**HNT-075 Fairy and field generators.**
- For Fairy the nearest member holding `fieldgen0` becomes the deployer unless the user turned
  generators off (rare-hunting.ts:362-371, 427-431). The deployer walks within 200 of the Fairy and
  equips the generator once per encounter (shared.js:3663-3680). The coordinator marks
  "field active" when any fresh member sees a generator within 300 of the Fairy
  (rare-hunting.ts:433-447, 542-549), and falls back to ordinary attacks after 3 s without
  confirmation, on a failed deployment, or 20 s after the start (527-541).
- The attack rule that keeps projectiles off an unprotected Fairy is target choice
  (shared.js:3608-3642, spec 04).

**HNT-076 Kill and loot.**
- The rare counts as dead on a loot stage, kill memory or a grouped death record (rare-hunting.ts:448-450).
  A death without confirmed party engagement ends the encounter without loot (451-457). With
  grouped fights still running it waits "Finishing party combat before rare loot" (458-464).
- Loot: the stage becomes `loot` and the client leader loots once its walk reaches the spot
  (shared.js:3683-3686, `pollRareLoot` 3705-3715). The encounter finishes on the leader's
  `rareLoot` receipt for this encounter id at the same realm, map and instance, observed after
  the kill (rare-hunting.ts:578-594), or on a retained Hunt convoy's loot pass that started after the
  death (595-614).
- `finish` stores rejection evidence, clears progress for a kill, cancels rare travel, sets a 3 s
  cooldown unless killed, releases the target in grouped combat and restores farming (243-260).

#### Return after a rare

**HNT-077 Back to farming or to the Hunt mission.**
- `restore` writes the saved return location back to `party.location` and stores
  `party.rareHuntReturn` (rare-hunting.ts:223-242). It skips both when the encounter rode a
  retained convoy (224) or when the owner snapshot is stale (225), and skips the return during a
  patrol (227-230).
- scripts/rare-farming-return.cjs: the return clears itself when leader, focus or policy changed,
  the leader left, or the leader's fresh realm differs (24-32). It waits while paused or while the
  leader is stale (33-35). If it saved a Hunt and Hunt is still the same cycle, it sets
  `hunt.convoyId = null`, moves `farming` back to `mission-travel` and hands travel to Hunt (36-43).
  Otherwise it finishes when every remaining member is within 180 of the location or inside its
  shape (17-23, 45-48), never preempts another convoy (49-53), and starts a `rare-hunt` convoy
  "Resuming farming" for online members every 5 s at most (54-64). Offline members stay in the
  obligation (60-61).

#### Rare owner ports

**HNT-078 What other owners ask.**
- `owns()` is true during an encounter, a patrol, or a farming return still moving
  (rare-hunting.ts:918). Farm areas (application.ts:392), the heartbeat response (563) and status
  ingestion's scatter rule (1062, scatter.ts:123) read it. `encounter()` pauses Hunt
  (hunt/tick.ts:88, 95-99). `blocksPulls()` holds pulls while the rare is dead or looting (926-930).
- A party death calls `abandon()` through recovery hooks (application.ts:1772), which drops the
  encounter and the return without cooldown (920-925). `stop()` drops everything and cools the
  target 3 s (270-283).

**HNT-079 Independent characters have no rare owner.**
- `createSoloServices` gives each independent character a stub whose `owns`, `encounter` and
  `control` return false or null (application.ts:1787), and wires it into farm areas, the
  heartbeat and Hunt like the party one (1875, 1907, 1918).

#### Heartbeat control and client legs

**HNT-080 rareControl and the client.**
- The heartbeat sends `rareControl` per member (application.ts:552; status/response.ts:246, 265):
  for an encounter its id, kind (`encounter` or `loot`), target, destination, deployer, generator,
  kill time, Phoenix assist flag and that member's revision (rare-hunting.ts:881-893); for a
  patrol the current scan point (900-910).
- The client stores it from the full heartbeat (shared.js:11218-11226) or from the combat-only
  response (`acceptRareCombatControl`, 3561-3579). A new encounter during a `phoenix-patrol` convoy
  stops that convoy locally (3570-3578). Control is current for 3.5 s, while the navigation
  revision matches and the character is not dead, in Town, travelling to or joined to an event,
  or escaping (3580-3584). An unfinished fight on a different target suspends it (3585-3590).
- `pollRareHunting` (shared.js:3649-3703), called from the role runner (runtime/characters/roles/runner.ts:224):
  patrol control only holds the character (3652); in grouped farming only the Fairy deployer walks
  (3653-3656); any convoy, bank, stock, upgrade, forced or Town travel wins (3659); otherwise it
  walks to the destination with `smart_move`, gives up after 30 s with "Rare route timed out", and
  stops at 30 units, where loot control loots (3683-3701).

#### Phoenix patrol

**HNT-081 Starting, restoring and stopping a patrol.**
- Picking Phoenix as the farming target with a region order starts the patrol
  (application.ts:784, 794-795 to rare-hunting.ts:284-293). The order must name each of the five
  catalog Phoenix regions exactly once, and the catalog must have exactly five
  (rare-hunting.ts:53-68). `party.phoenixPatrolActive` and a checkpoint (leader, realm, focus,
  policy, revisions, region, respawn time) persist it (625-630, phoenix-patrol.ts:50-60); after a
  restart `restorePatrol` rebuilds it at the saved region (rare-hunting.ts:720-729).
- The patrol stops when the owner snapshot changes, the policy becomes `hunt`, or focus is anything
  but exactly `phoenix` (631-640).

**HNT-082 Scanning the regions.**
- Each region gets a serpentine list of scan points spaced for a 550 by 350 view, with a 1.7 step
  (phoenix-patrol.ts:16-32), and 60-unit sample points that count as covered when a fresh
  observation from a living member on the region's map and realm falls within 570 by 370
  (4-13, 112-133).
- The whole party travels each leg by a `phoenix-patrol` convoy (rare-hunting.ts:651-653,
  phoenix-patrol.ts:209). Arrival is within 40; the leg completes 1 s after arrival once the
  convoy is gone, and the region ends when every sample is covered (171-188).
- A failed convoy or 30 s without 10 units of movement is a failure (134-147, 224-228). A point's
  second failure adds one of four 200-unit offset points inside the region; after four the region
  is skipped as incomplete (148-170). All five incomplete pauses the patrol
  "All Phoenix regions unreachable" (95-111). A runtime reload failure retries the same point
  after 5 s (214-223).

**HNT-083 Phoenix sightings and the respawn wait.**
- During an unpaused patrol any fresh, eligible Phoenix sighting on the leader's map starts an
  encounter, nearest first, while no other convoy runs (rare-hunting.ts:851-858). Phoenix needs no
  passive rule then (`assist`, 656-658; used in 552, 659-661, 753) and the client gets
  `allowPhoenixAssist` (890, 905).
- Grouped combat receives each member's fresh Phoenix observations as candidates at priority 100.5
  (phoenix-candidates.ts:5-24).
- After a Phoenix kill, or a death without engagement during a patrol, the patrol waits until 35 s
  after the death in the current region, or plans routes to all five and picks the shortest
  reachable (rare-hunting.ts:662-696; phoenix-patrol.ts:231-252; route distance with 400 per map
  change, rare-route-distance.ts:3-28). No reachable region pauses the patrol (689-691).

### 1.4 Cave and daily dungeons

The Cave of Many Dreams is the game's daily dungeon. The console runs it as a manual visit: the user presses Enter on the dashboard, the coordinator takes the party, walks it to the Cave keeper Dorr in Main, sends it in, and from then on issues one command per member (gather, enter, move, vote, buy, talk, stairs, revival, exit). Each character runs the command, records a receipt, and reports what it sees. All file:line cites are on `refs/review/ryan-1.5` unless marked.

The coordinator half lives in `runtime/coordinator/dungeons/` (service.ts, travel.ts, progress.ts, priest-recovery.ts, combat.ts) with the shared types and the ownership test in `runtime/dungeons/contracts.ts`. The character half is `runtime/characters/dungeons.ts`, `cave-request.ts`, `dungeon-journal.ts`, wired into the character by the dungeon block in `characters/shared.js` (2595-2814). Priest healing and reviving on the character (`runtime/characters/cave-recovery.ts`, `shared.js` caveRecovery 2658-2694) and Cave target rules (`dungeonTargetAllowed`, `getDungeonTarget`, `dungeonCombatThreat`, `dungeonEncounterEnemy`, shared.js 2608-2638) are proposed to specs 05 and 04; this spec only names them ("asks 05", "asks 04"). Movement legs inside the cave (`dungeonRuntime>move`, `travel`, `sharedRoute`, shared.js 2744-2789) are proposed to 02 ("asks 02").

How the dungeon's ownership stops other parts of the console is a precedence question for spec 01 ("asks 01"); the facts are listed under {{HNT-084}} and in B.1.

#### Visit owner and phases

**{{HNT-084}}** One saved visit record per party; every phase except `idle` owns the party.
- `createDungeons` keeps `party.dailyDungeons` and creates it on first use with `protectFromEvents: true`, phase `idle`, no participants (service.ts:21-28).
- A member's status counts as fresh for 3000 ms (service.ts:30-31). Every rule below reads only fresh members.
- `issue` writes one command per member with id `<operation>:<name>` and saves settings (service.ts:53-62).
- `dungeonOwns(party, name?)` is true for every phase except `idle`, and with a name only for participants (contracts.ts:142-145). Phases are `idle, gathering, entering, active, exiting, held` (contracts.ts:107).
- Facts for 01: while `dungeonOwns(party)` is true the coordinator skips escape, death recovery, rare hunting, event return, anniversary return (application.ts:1741-1745, 1073), farm areas (2087) and the Monster Hunt tick (2138); merchant jobs that target a participant do not start (merchant/dispatch-composition.ts:143); party actions route through it (http/party-actions.ts:146). A participant gets grouped combat in its heartbeat (application.ts:1095). On the character, an owned runtime skips the rest of the heartbeat after applying the combat queue (shared.js:11158-11168) and blocks respawn (characters/roles.js:2623-2624, runtime/characters/roles/runner.ts:67).
- Settings: `protectFromEvents` (see {{HNT-090}}).

**{{HNT-085}}** The entry roster is the leader plus online combat followers, never the merchant, at most three, and the in-game party must match.
- `candidates` takes the leader and every follower seen in the last 10000 ms, minus `merchantCharacter`, without duplicates (service.ts:44-52). The comment at 45 says the 10 s window matches roster presence and entry still requires 3 s freshness.
- `validateCandidates` needs a leader first and at most three names (service.ts:99-102). Inference: the limit of three matches the game's Cave party size; not checked against game data here.
- `validateLaunch` asks the application port `canStart`, which refuses while the merchant is visiting one of the names (application.ts:164-166), then checks the in-game party unless every member resumes a visit (service.ts:95-98).
- `validateParty` needs every member `ready` (out of combat and loot), the in-game leader equal to the console leader, and the in-game member list equal to the participants; a lone member with no party passes (service.ts:189-202).

**{{HNT-086}}** Manual entry takes the party, gathers it at Dorr, checks again, then enters.
- `begin` (POST action `enter` or `resume`, service.ts:296-297) refuses unless the phase is `idle` or `held` (66-67), validates roster, launch and each member's entry (68-71), needs Dorr's position from the leader (72-73), resets 17 fields (74-91), calls the `cancel` port (application.ts:168-171: cancels the active convoy and deletes the members' party commands) and sends every member a `gather` to Dorr (service.ts:93).
- `validateEntry` needs a fresh status, a supported runtime with protocol 1, alive, same server as the leader (103-110); `validateVisit` needs an eligibility check younger than 45000 ms, a visit available or a resume, and a resume on the current server (111-119).
- `gathered` needs the member on Dorr's map within 80 and a complete receipt for its gather (157-164). `reconcileGather` checks entry and party again, then phase `entering` and an `enter` command for the leader only, or for every member when resuming (165-188).

**{{HNT-087}}** A visit already in progress is adopted.
- `adopt`: when the phase is `idle` and any fresh roster member reports a cave, the roster becomes the participants, phase `entering`, the error "Reconciling an existing dungeon visit", and the `cancel` port runs (service.ts:133-146).
- No test names this rule (see D).

**{{HNT-088}}** Every observer advances the visit; POSTs are deduplicated by operation id.
- `reconcile` runs adopt, copies receipts into `error` and `exitDispatched` (`observeAction`, 150-156), and, when every participant is fresh, runs gather, returns, cave phases, priest revival, exploration and travel in that order (120-132). With a stale participant only receipts are read (125).
- Callers: the GET route through `snapshot` (35-36, 582), every POST through `action` (284), `release` (264), `control` for every heartbeat (539), the heartbeat response builder (application.ts:1089) and the Monster Hunt tick (2137).
- `action` needs an operation id up to 160 characters, ignores one it already ran, keeps the last 200 ids, and dispatches to settings, progress, enter, resume, exit, release, retry, recover, or else `perform` (283-309). A handler that throws does not record its id, so the same id can be sent again. `install` registers GET and POST `/party-api/daily-dungeons`; errors answer 409 with the message (581-593).

**{{HNT-089}}** Active, exiting and held.
- `reconcileCaves`: from `entering` or `active`, when every participant reports a cave with the same run, phase `active`, commands cleared (209-220). From `active` or `exiting`, when every participant reports no cave, phase `held`, commands and run cleared (221-226). In `held`, any participant back in a cave gets an exit (205-207).
- `exit` saves the interrupted phase and commands, sets phase `exiting` and sends `exit` to every participant (228-240). It refuses when the dungeon does not own the party (230) and ignores a second event exit while one runs (231).
- `held` ends only through `release` or the pending event (see {{HNT-090}}). `release` (POST action `release`, or the manual navigation route at application.ts:941-944) needs phase `held` and every participant fresh and outside, else it throws "Exit the dungeon before resuming ordinary travel" (263-274). `retire` sets `idle` and deletes six fields so `settings` cannot restore a stale interrupted phase (comment 275-276, 277-282).
- `begin` also accepts `held` (66), so a new entry is a second way out.

**{{HNT-090}}** Event protection.
- `eventAllowed(name, event, eligible)` answers "may this member do events" and is reached through `eventsEnabledFor` (application.ts:1236-1242). Non-participants always pass (service.ts:242).
- In `held` with a pending event that matches, `eligible` and every member fresh, it retires the visit and answers yes (244-248, 254-262).
- With no event name it answers `protectFromEvents === false` (249).
- With protection off, an eligible live event and a phase other than `held`, it calls `exit` with that event as pending, and answers no (250-252). `eligible` is `liveEventFor`: fresh status listing the event live, or its staging window (application.ts:1229-1234).
- `settings` sets `protectFromEvents`; turning it back on before the exit reached any member (`exitDispatched` false) restores the interrupted phase and commands (service.ts:355-365).
- Setting: `protectFromEvents`, default true (22-23).

**{{HNT-091}}** Retry and recover.
- `retry` needs at least one fresh member whose receipt for its command is `failed` (310-316). During travel it restarts travel to the same target and keeps the three spent repair counters (317-323, commit 480b0451); otherwise it sends each failed command again under the new id (325-327).
- `recover` (phase `entering` or `active`) sends a resume `gather` to Dorr to every participant that reports no cave, after checking entry and a server resume for each (329-344). `reconcileReturn` sends `enter` to a gathered resuming member that is outside with a resume (345-354).

#### In-cave actions

**{{HNT-092}}** Waypoints, room moves and merchant talk.
- `perform` needs phase `active`, the matching run, every member fresh, a cave on the leader and settled earlier actions (366-377).
- `waypoint`: no open encounter, same floor as the leader, finite x and y; stops exploration and starts travel (378-384).
- `move`: a valid destination (not locked, not done unless a merchant room, no open encounter, 430-437); the exit point becomes `exit` (417); a target on another floor is refused (418-419); a merchant room whose shop is not in any member's view is reopened by `talk` from the nearest live member within 100 (420-421, 438-464). The comment at 447-449 says the server allows 160; the console uses 100. Otherwise it stops exploration, records the target and starts travel; a stairs target is kept as the stair continuation (422-428).

**{{HNT-093}}** Votes and purchases.
- `choose`: the choice must be current (472); a vote needs an open choice before its deadline and an available option (475-476); a paid option needs `confirmed` and the same quoted cost and amber (499-507); the vote goes to every participant that has not voted (478-489).
- `buy`: confirmed, resolved, shop present and unsold, enough gold, the same price, and a participant near the merchant; the buyer gets the command (508-537). `currentChoice` also looks at shops only one member sees (495-498).
- `ensureSettled` blocks a new action while an earlier non-move, non-gather, non-talk command lacks a complete receipt; a vote counts as settled when the same choice is resolved natively (394-409).

#### In-cave travel

**{{HNT-094}}** Heartbeat control and the movement gate.
- `control(name)` reconciles, marks an exit as dispatched the first time it is handed out (542-545), and returns `owned`, the command, the leader's route while travelling (554-557), the priest assignment for that member, and `movementReady` (538-553).
- `movementReady` needs every participant fresh, alive, ready and not paused (577-580), plus the formation rule: during travel a member may move only while its walked distance is at most 100 more than the least distance of any member still walking; independent repair legs and assembly are exempt (558-576). The comment at 568-569 says walked distance replaced straight-line distance because it deadlocked corridors (545ca932).
- On the character, `canMove` allows movement inside the cave only with a control younger than 3000 ms, `movementReady`, local readiness and no open encounter (runtime/characters/dungeons.ts:349-351).

**{{HNT-095}}** Assemble, travel together, then stairs.
- `start` refuses a target on another floor, raises the serial, records the leader's position as the assembly point, and sends `gather` to it (travel.ts:23-48).
- `tick` (phase `active`, no member paused) runs repairs first (72), then: all members at the assembly point within 50 with complete receipts moves to `travelling` and sends `move` with `cruiseSpeed` set to the slowest member's speed, default 100 (73-83); all at the target finishes (84).
- `finish` sends `stairs` for a stairs target once every member is ready, else clears `cruiseSpeed` (148-159).
- On the character the default cruise is 500 (dungeons.ts:104, 340-341).

**{{HNT-096}}** Three repair counters, three each.
- `repair`: any failed receipt restarts travel to the same target, at most 3 times (`repairs`); at the cap it stops with no error text (travel.ts:136-147, 142).
- `regroup`: during assembly, members whose gather completed but who are not at the point get a new gather, at most 3 (`assemblyRepairs`), then the error "Cave assembly repeatedly displaced..." (98-110).
- `repairDestination`: during travel, members whose move completed but who are not at the target get an independent move, at most 3 (`destinationRepairs`), then a matching error (114-135).
- Commits: 27d7dbeb (travel), a3986593 (regroup), 545ca932 (destination repair), 480b0451 (counters survive Retry).

**{{HNT-097}}** Automatic exploration.
- POST `progress` with `enabled` turns it on or off in phase `active` (service.ts:292-295, progress.ts:146-155). Turning it off deletes travel, the stair continuation and every move and gather command.
- `tick`: an open encounter on any member stops exploration but keeps the stair continuation (83-92); after the stairs, travel resumes toward the saved stairs on the new floor or clears (121-135); otherwise, when enabled, every member fresh, alive, in the run and not paused, and every earlier action settled, it picks a target (108-120).
- `choose`: unlocked stairs down first; else the current or nearest required, unfinished room on this floor (24-32). `route` travels there, waits, and sends `stairs` once all arrived within 50 and are ready (66-82).
- With nothing left it shows "Waiting for stairs to unlock" or "Floor complete; no further stairs. Exit remains manual." (63-65). Exploration never picks the exit or stairs up.

#### Revival

**{{HNT-098}}** Priest revival assignment and manual Nera.
- `reconcile` (phase `active`) counts a death generation per member (5-19), and when no manual revival runs, picks a dead participant that was not tried yet: priests first, then the leader, then by name (35-49), with an alive priest in the run on the same map holding an Essence of Life (20-34).
- The assignment is authorized once per death, after the priest reports `ready`, and saved before delivery (92-106). A failed or complete attempt moves to the next target (87-91). A target that comes back alive ends the assignment (75-80).
- `revival` (in-cave action) asks Nera for the first fallen member; it refuses during an open vote (service.ts:385-393) and while a priest revival is unresolved (`blocksNera`, priest-recovery.ts:107-120).
- The character's half (heal the grave, cast Revive, report phases) asks 05.

#### Combat inside the Cave

**{{HNT-099}}** Grouped combat queue scoped to run and floor.
- `caveCombat` builds the queue for scope `run:floor` from the leader's floor, reuses the previous queue only for the same scope, merges candidates from fresh members on the leader's map and instance, and pauses when any member is out of the floor or in an encounter (combat.ts:9-25, 37-43).
- `member` sets `activeEvent`, `joinedEvent` and `mapEvent` to null and drops travel commands and passing encounters (26-35), so event checks do not fire inside the Cave. Called from navigation/grouped-snapshot.ts:112.
- Target rules on the character ask 04.

#### Character side

**{{HNT-100}}** The character dungeon runtime.
- `receive(control)` stops current movement when ownership starts or the command changes while one runs (dungeons.ts:331-334), stores the command, installs the leader's shared route for followers (339), sets cruise (340-341), settles journal entries from native state (342), and runs the command (344-347). Ownership is the coordinator's `owned` or a cave in view (332, 360).
- `execute` runs one command at a time and never one already in the journal (286); `validate` refuses superseded commands and changed state (248-284); move and gather walk and then validate again (301-306); talk is saved complete with no dispatched state (308-314); other actions are saved `dispatched` before the request (315-318). A rejected request after dispatch is saved `uncertain`, before it `failed` (325-326).
- `report` returns protocol 1, readiness, party, eligibility, cave, Dorr and the current or latest receipt (215-247).
- shared.js wiring: `dungeonRuntime` builds the ports, with a stub when the runtime is missing (2699-2701); `ready` outside the cave needs alive, no departure combat and no departure chests, inside it no threat, no open encounter and no chest in reach (2716-2721); `keeper` reads Dorr (`dreamkeeper`) from game data (2739-2742); `stop` tears down convoy travel, farming travel, reunion and follow, then cancels movement (2791-2809); the journal lives in localStorage `party-dungeon-actions:<name>` (2702, 2810-2811).
- `dungeonOwned` (shared.js:2597-2599) is the character's ownership test, exported at 17485 and read by roles.js (2623-2764) and many shared.js sites. `cavePartyNames` uses the Cave queue's members when the scope matches, else the party list (2600-2603); `cavePartyMembers` returns the visible members on the same map and instance (2604-2607).

**{{HNT-101}}** Daily eligibility polling.
- `refresh` asks the server for the visit every 30000 ms, gives up after 12000 ms and retries after 5000 ms, and ignores a late answer from a superseded check (dungeons.ts:173-214). A new run clears the cached visit and checks again (217-222); a passed reset time also triggers a check (223-230). `available` includes `unlimited` (201).

**{{HNT-102}}** Wire normalization.
- `normalized` turns doors and objectives into points with ids `<run>:<floor>:<kind>:<index>`, labels doors "Exit dungeon", "Stairs down" or "Stairs up", converts deadlines and expiry with a server clock offset, and translates text (dungeons.ts:115-172). `caveText` falls back to the raw text when a headless client stringifies the translation as `[object Object]` (108-114, f094ffcb).

**{{HNT-103}}** Cave interaction transport.
- `requestCave` emits one `interaction` of type `cave` with a request id and resolves on the matching `game_response` with place `interaction`; it rejects on a failed reply, on disconnect, or after 150000 ms for enter and 10000 ms otherwise (cave-request.ts:18-59). It listens with `prependAny` when present so native UI handlers that throw cannot hide the reply (49-52, 51e8bf4a).
- `requestDungeon` makes the id `cave:<name>:<time>:<random>` (shared.js:2695-2698). The `request` port maps actions: enter and exit through requestCave, stairs through `transport` with a 10 s timeout, revival through `respawn()`, vote, buy and talk through requestCave (2726-2738).

**{{HNT-104}}** The action journal.
- `save` keeps the newest 200 entries plus every unresolved one (`dispatched` or `uncertain`) and writes before the in-memory list changes (dungeon-journal.ts:22-30).
- `reconcile` settles an unresolved entry from native state: entered, climbed to the target floor, exited, voted, bought, or a revival followed by a new choice (31-58).
- `blocked` is true while an unresolved entry exists for the same run, or one without a run (64-69). `execute` refuses every action except exit while blocked (dungeons.ts:299-300).

**{{HNT-105}}** Chest loot inside the cave.
- `lootDungeonChests` opens each chest of this map and instance within 380 of the character's real position, not yet opened this run, with a 2500 ms timeout, and stops when dead, outside or in an encounter (shared.js:2639-2656). The comment at 2651-2652 says the server radius is 400 between centres; 380 keeps a margin. Called from `smartLoot` inside the cave (5440).

**{{HNT-106}}** Cave floor geometry.
- The application asks for full floors only for the leader's worker (application.ts:270; characters/manager.ts:52-54).
- `liveCaveMapDefinition` sends one floor's tiles, placements and tileset files with the map frame, once per floor unless the coordinator answers that it needs it again (shared.js:3746-3763). The handshake itself (runtime/lifecycle/cave-floor-handshake.ts) asks 13.

## 2. What goes wrong


### 2.1 Monster Hunt

**B.1 Ledger 13: the wrong pause message, set by call order (Ryan, no patch).**
1. A member reports `activeEvent` during the 120 s staging window (`characters/shared.js:11532` opens it; the heartbeat sends `activeEvent` at `shared.js:2987`), or a stale `joinedEvent`: `escapePulse` clears the local variable at `shared.js:237` but not `root.__partyJoinedEvent`, which a reload restores at `shared.js:552`.
2. `tick.ts:92` runs `travel.combatEvent` before `advance` reaches `recovery.pause` (`tick.ts:37 -> 63`).
3. `combatEvent` sets `paused-event`, "Paused for combat event", and cancels the Hunt convoy (`travel.ts:21-25`).
4. `recovery.pause`, which would write "select Hunt again" for a cancelled member (`recovery.ts:171-176`), never runs that tick.
5. Later `resumeEvent` restarts mission travel without checking the cancellation (`travel.ts:30-52`); `convoy.start` then refuses and writes "Hunt movement is paused; select Hunt again to resume" (`convoy.ts:31-35`).
Second producer: any non-Hunt convoy makes `eventOwnsTravel` true (`policy.ts:90-91`), so a rare return or farm-recovery walk shows "Waiting for rare-hunt travel to finish" or "Waiting for shared-walk travel to finish" (`recovery.ts:147-150`). With no convoy and no event return the text says "anniversary" whatever held travel (`recovery.ts:150`). The message is free text written in 55 places across 12 Hunt files (`git grep -n -E "hunt\.message *=" refs/review/ryan-1.5 -- runtime/coordinator/hunt/ | wc -l`). History: `git log -s -L 74,94:runtime/coordinator/hunt/tick.ts refs/review/ryan-1.5` shows 9fbeadab, 9a41afd0, 51eb5324, f023f304, 0631e72c: a new gate added in each. Root cause: no owner record says who holds the party; asks 01.

**B.2 Ledger 5: Hunt stuck after death (Ryan; fork patch ce6e7c1a).**
1. Death recovery escapes (`scripts/combat-disengagement.cjs:77-82`).
2. The escape completes when the priest reaches the Blink landing (`scripts/party-escape.cjs:96`).
3. Recovery waits until every member is at Main within 65 at half HP (`combat-disengagement.cjs:83-90`).
4. No owner walks members from the landing to Main.
5. Hunt shows "Recovering after party death" and waits (`tick.ts:58-61`).
Fork ce6e7c1a makes escape continue when the landing is off Main, by copying the 65 rule into `party-escape.cjs`. The Hunt side has no change. Death recovery belongs to spec 05; Hunt only waits.

**B.3 "At an event" copied 15 times in Hunt.** `activeEvent || joinedEvent` appears at `backup.ts:42`, `encounter-ownership.ts:13`, `farm-walk.ts:26, 89`, `lifecycle.ts:29, 206`, `loot.ts:15`, `nearby-target.ts:27`, `quests.ts:166`, `recovery.ts:185`, `retreat-restart.ts:40` (also `mapEvent`, `eventTraveling`), `route-recovery.ts:118`, `tick.ts:49`, `travel.ts:18, 294` (`git grep -n activeEvent refs/review/ryan-1.5 -- runtime/coordinator/hunt/ ':!*contracts.ts'`). None checks the occurrence, the realm or whether the admission is current, so staging or a stale `joinedEvent` pauses Hunt (B.1). Asks 01 and 06.

**B.4 Hunt writes other owners' state, and they write Hunt's.** Hunt writes `farmAreaState` (`recovery.ts:100-103`, `mode.ts:44-49`, `lifecycle.ts:214-217`, `route-recovery.ts:175-178, 296`, `farm-walk.ts:58`), `state.location` (`route-recovery.ts:139, 294`), the anniversary cycle (`expired-anniversary.ts:21-23`), and cancels every non-Hunt convoy each step (`participants.ts:89-92`). The farm-area owner writes Hunt's mission and convoy (HNT-051; section 2.2, B8), the rare owner writes Hunt's stage and checkpoint (section 2.3), and event returns write `monsterHunt.stage`, `convoyId` and `message` (`events/hunt-resume.ts`, spec 06). Root cause: no private state per owner.

**B.5 Route budget reset by failure text (Ryan, d5279eab).** `resetChangedGeometry` deletes a destination's budget whenever `preparationChanged(firstFailure)` matches one of seven phrases (`route-recovery.ts:245-251`; `shared-departure.ts:57-60`) and cancels the convoy; the next tick dispatches again (185-199). A failure whose text matches never builds a budget. Inference: a leader that keeps moving during planning loops start, fail, reset without a limit; a candidate coordinator half of ledger 8.

**B.6 Dead paths kept alive by tests and saved state (Ryan).** Three Hunt paths have no production writer:
- the temporary encounter (writer removed by 829b85ba, HNT-021): `encounter.ts`, `nearby-target.ts`, `encounterLootPending` and `travel.temporaryStop`, tested by 16 tests in `hunt-temporary-encounter.test.cjs` that build the record by hand (line 41);
- `exitMode` (HNT-015);
- stage `failed-return` and `endReason` (HNT-028), including `newCycle`'s batch recovery keyed on the text "no eligible quests remain (Hunt blacklist)" (`lifecycle.ts:182-184`).
Inference: these keep old saved cycles working; nothing says when they can go.

**B.7 Migrations that run every tick.** `needsReconcile` (`policy.ts:73-75`, `policyVersion !== 3`), `reconcileLateMembers`' old-version branch (`participants.ts:44-66`), `repairOldAssignment` (`participants.ts:69-83`), `reconcileHuntDestination` (`encounter.ts:131-157`), `advanceRecovery`'s retirement of old relocation phases (`route-recovery.ts:258-265`) and `migrateHuntFailures` on every count (`settings.ts:45-54`, with a reason string compare at 51).

**B.8 Two writers of one expiration count.** `observeHuntExpiry` (`expiry.ts:69-78`) and `quests.blacklistExpired` (`quests.ts:250-259`) both call `recordHuntFailure(..., 'expirations')`; the second skips when the first tracked the same target and revision (253). Patch on a patch: the duplicate guard exists because two places decide "this quest expired".

**B.9 Wrong values and literals.**
- `finishFailed` says "two party deaths" when no reason is set (`lifecycle.ts:97`), but the default death threshold is 1 (`settings.ts:13`). The path is dead (B.6), so no user sees it.
- Daisy arrival is 100 in three places (`travel.ts:84`, `quests.ts:290`, `convoy.ts:51`) and departure 120 (`convoy.ts:66`); the game's NPC interaction range is not checked against these. Inference: not verified against game data.
- Freshness windows: 10000 ms (`lifecycle.ts:40`, `backup.ts:13`, `controls.ts:40`, `current-party.ts:6`, `travel.ts:128`, `recovery.ts:185`), 3000 ms (`travel.ts:83, 248`, `convoy.ts:49`, `encounter.ts:16`, `loot.ts:32`, `expiry.ts:11`, `current-party.ts:62`), plus 800 (recovery), 180 (loot), 150 (arrival margin), 15000 (stale interaction), 2000 (event release), 5000 (encounter absence). Each is a literal at its use.
- The search radius default 400 appears in `travel.ts:193, 257`, `backup.ts:100` and `nearby-target.ts:17` (section 2.2, B10 counts them all).

**B.10 Duplicated wiring for solo characters (Ryan).** `createSoloServices` (`application.ts:1784-2007`) repeats the Hunt composition and actions with small port differences (rare stub at 1787). A new Hunt port must be added twice; section 2.2, B11 counts the same for farm areas.

**B.11 Event admission does not see escape or death recovery (Ryan; asks 06).** `hunt-control.ts:68-71` allows event travel unless the member is in the event return, Hunt is in a turn-in, or the intent is cancelled. Inference: a member respawning during death recovery can be admitted to an event and put Hunt into `paused-event`.

### 2.2 Farming modes, focus and farm areas

**B1. Nine writers of the policy, and two whitelists without the fork's mode.** Writers: hunt/mode.ts:109, 127 (via http/hunt-mode.ts:62); navigation/monster-selection.ts:48 (every pick sets `auto`); http/saved-farming-mode.ts:30; initial-focus.ts:22 at load; hunt/scopes.ts defaults and profile restore (handed to 01). Fork af92de45 adds achievement-hunt.ts `stop()` and console-control.ts:234-236, 291-303. Each writer validates its own list: hunt-mode.ts:73, saved-farming-mode.ts:12, initial-focus.ts:22, and scatter.ts:93-99 treats any unknown value as auto. Root cause: the mode set is a string with a list per reader, not one registry (spec 11).

**B2. The mode rule lives in two places and one copy is dead.** scatter.ts:93-99 decides the party mode on the coordinator. `calculateFarmingMode` on the character repeats the same policy rule (shared.js:14816-14818) without the scatter break, and its result is discarded (shared.js:2837); the character uses the coordinator's `partyFarmingMode` (shared.js:11402). Only its side effect, `farmingMonsterType`, matters. Inference: a future edit to one copy will not change behaviour and may look like it does.

**B3. Default mode is forced from three places with different owner lists.** scatter.ts:123 forces default when the rare owner owns the scope; response.ts:222-227 forces default for rare or death recovery; the character forces default for convoy defense, death recovery, rare activity, a focus change, merchants, events and `all` focus (shared.js:14787-14794) and for the Cave and rare in `getFarmingMode` (17952-17955). Asks 01: who owns the party right now.

**B4. Learned scatter types reset on restart, against the comment.** shared.js:1040 says the coordinator persists them; initial-farming.ts:48-49 resets them with a new epoch, and the character clears its own list on the epoch change (shared.js:11389-11395). Review question FARM-Q2.

**B5. A bestiary pick ends live events for every member.** monster-selection.ts:69 calls `skipManualEventOccurrences` for every member, and `reset` clears event returns, deferred returns and sessions (55-60). The full events review traced the chain: the skipped occurrence drops from the heartbeat selection and the character posts `/event-disabled` (review/full/events.md section 6, "A manual move during an event"). Ryan design (d009eb22). Review question FARM-Q1.

**B6. Failure classified by free text, and a pause with no retry.** farm-area-recovery.ts:72 decides transient failures by a regex over the failure text. 829b85ba added `geometry` to that regex and a `geometry-mismatch` code branch that pauses with no retry (97-99), so the two halves disagree on geometry failures. Hunt waits on `farmAreaState.paused` until a Hunt begin, mode reset, death or a new pick clears it (hunt/recovery.ts:167-170, HNT-025). History: `git log -L` on recordFailure and failed shows 9fbeadab then 829b85ba (review/full/events.md Appendix B 3.3). Review question FARM-Q3.

**B7. Two recovery owners for a failed Hunt convoy.** farm-areas.ts:200-216 handles a failed `monster-hunt` convoy, and Hunt route recovery handles the same failure (hunt/route-recovery.ts, HNT-032). d5279eab added `huntTravelOwns` (farm-areas.ts:254-256, 266) so the farm side stops while Hunt travels. Inference: the mission-travel branch of `noDestination` (farm-area-recovery.ts:33-40) is unreachable since that guard. Asks 01.

**B8. The farm-area owner writes Hunt's state.** `promoteShape` edits the Hunt mission destination (farm-areas.ts:37-38); `startPending` writes `hunt.travelCause` and the mission destination and starts Hunt's convoy (89-93); recovery sets `hunt.convoyId = null` (farm-area-recovery.ts:101) and skips missions (33-40). Hunt in turn writes `farmAreaState` (section 2.1, B.4). Root cause: no owner record; each pauses the other by editing its fields.

**B9. Owner lists copied per reader.** The farm-area gates (farm-areas.ts:42-52, 184-186, 196-198, 240-245, 254-258), the farming-return gates (farming-return.ts:38-59) and the client handoff gate (shared.js:17654-17658) each list a different set of owners. None checks the dungeon (the caller does, application.ts:2087) and only farming-return checks the anniversary cycle. Asks 01.

**B10. The search radius default is a literal copied many times.** `git grep -n -E "\|\| ?400\b|= ?400\b|radius = 400" refs/review/ryan-1.5 -- runtime/coordinator characters/shared.js dashboard/lib scripts/*.cjs` gives 35 lines; the farming and Hunt ones are in shared.js (9), farming-zones.ts (4), farming-return.ts (2), focus.ts, http/focus.ts, farm-areas.ts, farm-competition.ts, hunt-arrival.ts, response.ts, hunt/travel.ts (2), hunt/backup.ts, hunt/nearby-target.ts, convoy-defense.ts. Separately, `observeFarmArea` uses a fixed 400 for "whole area observed" whatever the search radius (shared.js:14958).

**B11. Duplicated wiring for solo scopes.** createSoloServices (application.ts:1784-2007) repeats the farm-area, Hunt and heartbeat port blocks of the party wiring (application.ts:387-414, 445-478, 545-564). Any new port has to be added twice. Its rare stub means a solo scope never yields to a rare encounter (application.ts:1787).

**B12. Test harness slices.** Several tests slice shared.js by function name, using `calculateFarmingMode` only as the end marker of a slice (scripts/tests/passive-rare-queue.test.cjs:11). Moving or renaming the function breaks unrelated tests. Same mechanism as ledger 10.

### 2.3 Rares and Phoenix

**B1. The rare owner writes other owners' state to pause and resume them.** Ryan base.
1. `begin` writes Hunt's travel checkpoint interruption (rare-hunting.ts:372-375).
2. It writes the Hunt convoy's `huntTravel.committed/primary/reason` (382-388), and rare-combat's
   `release` edits the same record plus `groupedCombat.fights/queue/target/selection`
   (rare-combat.cjs:33-54).
3. It sets `party.partyFarmingMode = "default"` and `scatterBreakTarget = null` (rare-hunting.ts:405,
   426); nothing restores them on finish, and scatter.ts:123 recomputes the mode only on the next
   status ingestion while `owns()` is false.
4. `restore` writes `party.location` (226); the farming return writes `hunt.convoyId` and
   `hunt.stage` (rare-farming-return.cjs:41-42).
- Each field is a place where Hunt, scatter or grouped combat resume in a state they did not pick.
  Commits: 0df7a387, then f023f304 "preserve Hunt ownership through rare encounters" changed the
  cancel into the commit (`git log -L` on retainTravelConvoy).

**B2. "Is the rare still selected" has two owners; three fixes in five days.** Ryan base.
`released` infers the release from grouped combat's selected, queued and locked state with a 10 s
grace and a queue acknowledgement (rare-hunting.ts:755-774). History (`git log refs/review/ryan-1.5
-L '/function released(/,/^  }/:runtime/coordinator/navigation/rare-hunting.ts' -s`): 9fbeadab,
04fb9d9f (2026-10-08, queued is not released), c46722dc (2026-10-12, wait for acknowledgement),
72f6c570 (2026-10-12, lint split). Each patches a new race between the coordinator nomination and
the client queue.

**B3. Several "who owns the party" lists for rares alone (asks 01).** Ryan base.
`protectedActivity` (rare-hunting.ts:153-159), `commandProtected`'s purpose list (118-133), the
interruptible-travel purpose list in `acquirePassive` (841), and the client's `rareControlCurrent`
(shared.js:3580-3584) each decide a part of "someone else owns the party". None checks the
dungeon; the wiring skips the tick instead (application.ts:1073, 1743).

**B4. Convoy purposes carry behaviour by name; `rare-hunt` names two activities.** Ryan base.
`rare-hunt` is the pursuit (rare-hunting.ts:522) and the "Resuming farming" return
(rare-farming-return.cjs:63). `cancelTravel` cancels both (rare-hunting.ts:180-183). The pursuit
purpose also appears in lists elsewhere (rare-hunting.ts:126-127).

**B5. Ledger 13 producer (narrow on Ryan's base).**
1. While an encounter exists, Hunt's tick pauses in `rarePaused` with the encounter message before
   any event check (hunt/tick.ts:88, 95-99).
2. Without an encounter, a `rare-hunt` convoy makes `eventOwnsTravel` true because its purpose is not
   `monster-hunt` (runtime/hunt/policy.ts:90-91).
3. `pause` then sets `paused-event` and shows "Waiting for rare-hunt travel to finish"
   (hunt/recovery.ts:157-165, 150).
- Inference: on Ryan's base step 2 needs a farming return convoy for a non-Hunt saved return while a
  Hunt cycle runs, since a saved Hunt return hands travel back without a convoy
  (rare-farming-return.cjs:36-43). The appendix B claim that every `rare-hunt` convoy produces the
  mislabel is wider than the code shows.

**B6. Failure classified by reason text.** Ryan base. `rejectUnproductive` stores a rejection when
the reason matches `/selection released|no progress|time limit/i` (rare-hunting.ts:268). Changing a
message string changes the retry rule.

**B7. A client route failure is a resting state with no reader.** Ryan base.
1. The 30 s timer or a `smart_move` rejection sets `rareNavigation = {id, failed:true}`
   (shared.js:3694-3700).
2. `pollRareHunting` then returns true for that control id on every poll (3688), so the character
   holds still.
3. The heartbeat reports `rareNavigation` (2873), but no coordinator code reads it
   (`git grep -n rareNavigation refs/review/ryan-1.5 -- runtime dashboard`: only the type
   rare-types.ts:99 and a debug field, telemetry/character-fields.ts:209).
4. The encounter ends only through the coordinator's 30 s no-progress timer (rare-hunting.ts:497-503).
- The fork patches step 2 with a client retry (C2).

**B8. The rare tick runs from three periodic paths.** Ryan base. 250 ms travel clock
(navigation/runtime.ts:77-83), every status ingestion (status/ingestion.ts:88) and every combat
report (combat-ingestion.ts:52), plus `setSettings` (rare-hunting.ts:935). Each tick re-applies
saved rejections (859-861) and builds a new `rareHuntState` object (184-211). Inference: with three
fighters at 1 Hz heartbeats this is about 7 ticks per second, and the order of status ingestion
against the timer decides which sightings a tick sees.

**B9. Per-monster lists and migrations that never end.** Ryan base.
- The six rares are listed in rare-hunting.ts:29-44, again in the client default
  (shared.js:440, 11223) and in the hit tracker (shared.js:1005).
- `tinyp` is removed from saved focus on every start (rare-hunting.ts:106-111), and passive settings
  are migrated on every start (101-102).
- The patrol is fixed to five regions (rare-hunting.ts:62-64, 200; phoenix-patrol.ts:100, 106). If
  game data ever lists another Phoenix spawn area, `validateOrder` rejects every order and the
  patrol cannot start. Inference: today the catalog has five, per the test fixture
  (scripts/tests/rare-hunting.test.cjs:4-5).

**B10. A dead hook and a dead branch.** Ryan base.
- `recoveryHooks.rare.resumeHunt` (navigation/recovery-hooks.ts:35-44) is passed to
  `createRareHunting` (application.ts:1776) but rare-hunting.ts never calls `hooks.resumeHunt`
  (`git grep -n resumeHunt refs/review/ryan-1.5 -- runtime scripts/*.cjs`). A unit test still
  covers it (D, coordinator-recovery-hooks).
- In `pollRareHunting`, `control.kind === "patrol" && character.name !== leader` (shared.js:3662)
  cannot run: patrol control already returned at 3652.

**B11. typeof guards around rare functions.** Ryan base. 17 call sites test
`typeof rareActive/rareTarget/acceptRareCombatControl/passiveRareCandidate === "function"`
(`grep -n "typeof \(rareActive\|rareTarget\|rareControlCurrent\|acceptRareCombatControl\|passiveRareCandidate\)" ryan-shared.js`).
All are declarations in the same closure, so the guards are always true in production. They exist
because unit tests run slices of shared.js (rare-hunting-client.test.cjs:4, 19-20). Same mechanism
as ledger 10.

**B12. A farming-mode change cancels a rare.** Ryan base. The owner snapshot includes
`farmingPolicy` (rare-hunting.ts:165, 176) and the return checks it (rare-farming-return.cjs:29), so
any mode change ends the encounter and the return as "new navigation". Whether that is intended is a
review question (E2).

### 2.4 Cave and daily dungeons

**B.1 `held` owns everything and ends only by hand.** (Ryan, 4e00a4b8 design; 9162890d patched the stale fields)
1. All members leave the cave (manual exit or run expiry): `reconcileCaves` sets `held` (service.ts:221-226).
2. `dungeonOwns` stays true in `held` (contracts.ts:142-145).
3. The coordinator skips escape, death recovery, rare, event return, anniversary, farm areas and Hunt (application.ts:1741-1745, 2087, 2138).
4. `control` keeps handing out `owned: true` (service.ts:547), so the character's runtime owns it (dungeons.ts:332, 360), `dungeonOwned` is true (shared.js:2598), the heartbeat is cut short (shared.js:11160-11167) and respawn is refused (roles.js:2623-2624).
5. `held` ends only through `release`, which throws when any participant is stale or not reported outside (service.ts:267-271), or a matching pending event (244-248), or a new entry (66).
- Inference: after a visit the party waits at Main until the user acts; a participant that went offline blocks Release and therefore every manual travel command, which calls `release()` first and answers 409 (application.ts:941-945); a member dead outside the cave does not respawn until release.
- Precedence of the dungeon over other owners asks 01; Cave Q1 to Q3 ask the user.

**B.2 Reads that write.** (Ryan)
- GET `/party-api/daily-dungeons` runs `reconcile`, which can issue commands and persist (service.ts:35-36, 582).
- `control` sets `exitDispatched` while building a heartbeat response (542-545), after the response builder already ran `reconcile` (application.ts:1089, 1096), so every heartbeat response reconciles twice.
- `eventAllowed` can retire the visit or start an exit (service.ts:244-251) and is reached through `eventsEnabledFor` (application.ts:1240), which event code calls as a question. Root cause: the dungeon owner has no tick of its own; any observer advances it.

**B.3 Cave travel repairs: a counter per failure shape.** (Ryan)
1. 27d7dbeb adds travel with `repairs` (cap 3) for failed receipts (travel.ts:136-147).
2. a3986593 adds `assemblyRepairs` because combat moved members after a completed gather (98-110).
3. 545ca932 adds `destinationRepairs` for the same after a completed move, and walk-distance formation (114-135; service.ts:558-576).
4. 480b0451 carries all three across Retry so repeated presses do not add more (service.ts:317-323).
- Arrival uses three radii: 80 at Dorr (service.ts:162), 50 in travel and exploration (travel.ts:60, progress.ts:39), and the character walks to tolerance 1 for gather and 20 for move (shared.js:2770). Inference: the coordinator infers displacement after the character reported completion; the character does not own "stay at the point until released".
- At the `repairs` cap travel stops with no error of its own (travel.ts:142); only the progress message says "Travel failed" (progress.ts:105). Cave Q5.

**B.4 The same settlement rule in two places, and they differ.** (Ryan)
- `service.ensureSettled` and `voteResolved` settle a vote only when the native choice with the same id is resolved (service.ts:394-409).
- `progress.actionSettled` settles a vote whenever the current native choice is resolved, whatever its id (progress.ts:14-19).
- "move, gather and talk never block" is copied in both (service.ts:397, progress.ts:15).
- Inference: after a new choice opens and resolves, exploration treats an older vote with no receipt as settled while manual actions still refuse; no observed bug.

**B.5 Journal entries without a run block everything except exit.** (Ryan)
- `blocked` counts an unresolved entry with no `run` against every command (dungeon-journal.ts:64-69). `enter` commands carry no run (service.ts:183-187).
- Unresolved entries are never pruned (dungeon-journal.ts:27).
- `reconcile` settles an `enter` only once a cave or a resume run is seen (36).
- Inference: an uncertain entry that the server never confirms keeps blocking later actions on that character until a cave or resume appears. Not observed.

**B.6 Test hooks and dead API in production.** (Ryan)
- `commandIdentity` has callers only in e2e/live-cave.spec.ts:722-723 (dungeons.ts:354-357, 99a6a74b).
- `paused()` has no caller (dungeons.ts:361; `git grep -n "\.paused()" refs/review/ryan-1.5 -- characters runtime` finds none).
- daily-dungeons-combat.test.cjs slices shared.js between `function dungeonOwned()` and `function dungeonRuntime()` and runs the slice in a vm (its lines 5-17), the same fragment-loading pattern as ledger 10.

**B.7 Values and text.**
- Dorr arrival 80 (service.ts:162) and speaker reach 100 against the server's 160 (447-455) are margins, not mismatches.
- Chest reach 380 against the server's 400 (shared.js:2651-2655): margin by design.
- Two user-facing progress messages contain an em dash character (progress.ts:138, 144). Text only.

## 3. Fork differences


### 3.1 Monster Hunt

The fork changes no Monster Hunt logic file except `hunt/scopes.ts`, which adds Achievement Hunt and Franky fields to the scoped list (`git diff --stat refs/review/ryan-1.5 HEAD -- runtime/coordinator/hunt runtime/hunt` shows 13 changed lines in scopes.ts and three new files). Fork ce6e7c1a patches B.2 on the escape side.

**Achievement Hunt** (fork af92de45; 17 commits touch its four files, `git log --no-merges refs/review/ryan-1.5..HEAD -- runtime/coordinator/hunt/achievement-hunt.ts runtime/hunt/achievement-policy.ts runtime/coordinator/hunt/achievement-settings.ts runtime/coordinator/http/achievement-hunt.ts`).

What it does:
- A fifth farming mode, `achievements`, runs `createAchievementHunt.tick` (fork `achievement-hunt.ts:419-441`) beside the Hunt tick. Another mode releases its target and restores what it changed (420-425).
- It orders the selected monsters by kill-achievement ladder and XP from game data, treats rares and boss-like monsters (at most 2 world spawns and at least 50,000 HP) as special, and picks the next unfinished step (fork `achievement-policy.ts:54-162, 63-64, 216-282`).
- It keeps a target until its milestone, unless a monster at a lower step appears (`achievement-hunt.ts:268-276`), prefers a rarer variant that shares spawn ground (328-355), and starts each target through Ryan's monster selection with `keepPolicy` (301-325; fork `navigation/monster-selection.ts:67-86`).
- It focuses the target plus nearby fillers and writes every member's `monsterPrioritiesByCharacter` (90 target, 10 filler), saving the old values to restore (`achievement-hunt.ts:193-224`).
- It switches passive rare rules on for wanted rares and restores them later (146-176).
- It counts deaths per target (event-trip deaths skipped) and blacklists at 6 deaths by default (227-254; fork `achievement-settings.ts`), keeps the newest 500 entries (fork `rare-retention.ts`, cd7bd857), skips an unroutable target for 10 minutes (81, 106-110), and leaves a target for 10 minutes once an avoided boss attacks a member (111-140).
- It walks the party back to the target's spawn every 30 s while away (357-389, 408-417) and waits while `busy()` or a member is dead (391-397).
- It leaves the mode for Auto when the user changes focus more than 15 s after its own switch (186-191, 256-261).
- On the character, boss avoidance adds keep-out zones around avoided bosses and a retreat mover that runs before grouped movement (fork `shared.js:3758-3920`; 45344db5, b5a7c68c).

What it patches or bypasses:
- **A fourth "who owns travel" list.** `achievementHuntBusy` (fork `application.ts:833-841`) checks dungeon, event sessions, event return, deferred returns, rare owner and any moving convoy. It does not check escape, death recovery, boss chase or farm relocation. `achievementHuntEventBusy` (829-832) holds on any `eventSessions` key, and sessions exist for every member that reports a selected event live (`events/observations.ts:138-144`). Inference: Achievement Hunt waits through every Franky window. Asks 01.
- **An automated switch counts as manual travel.** `select(..., keepPolicy)` keeps the policy and event state but still calls `skipManualEventOccurrences` for every member (fork `monster-selection.ts:76`), so a target switch marks every live occurrence `ignored: 'manual travel'` for the rest of the occurrence. Today the over-broad busy gate mostly hides this; fixing the gate alone would expose it (review/full/events.md 4.7).
- **Farm relocation and Achievement Hunt fight over `party.location`.** Farm areas have no Achievement Hunt check, so a competition move can go to a filler's spawn and Achievement Hunt walks back after 30 s (orphan comment at fork `achievement-hunt.ts:357`; section 3.2).
- **User settings as working state.** It is a second writer of `monsterFocus`, `monsterPrioritiesByCharacter` and passive rare rules. Inference: a crash or a manual edit during a target leaves the saved restore copy stale.
- **Mode lists.** `achievements` is missing from `saved-farming-mode.ts:12` and `initial-focus.ts:12` (fork), so a follower cannot save it and a legacy state loads it as Auto.
- **Per-character copy.** 5854cb05 builds a second monster-selection instance with stub ports for each independent character (fork `application.ts` `createAchievementHuntService`).

**The fix count.** fork-inventory section 6 lists Achievement Hunt as needing 21 fixes and names them as rows #103 to #106, #108, #109, #111 to #116, #122, #123 and #125 to #130. That list has 20 entries (count of the named rows), so either the count or the list is off by one. Fix chains named there: monster classification (5 special-case additions: f6a35a4b, 7be05712, 4bc9d3da, 4e694d44, cf7cba08), fillers and variants (9ba45f10, ae058969, cf7cba08, 5792d0d0), away-from-target (9ba45f10, 4e694d44), boss avoidance (cf7cba08, 4b213e7f, b5a7c68c, 45344db5), persistence (09a417ca, a04cc9f3, cd7bd857). `switchTo` has five fix commits and `tick` six (fork-inventory section 5). Each added a special case or a timer instead of an owner record.

### 3.2 Farming modes, focus and farm areas

- **Achievement Hunt mode value (fdcbbd81).** The fork adds `achievements` to the mode route (fork af92de45 http/hunt-mode.ts:72-83, with `achievementsAvailable`). It did not add it to saved-farming-mode.ts:12 or initial-focus.ts:12 (fork af92de45), so a follower cannot save it and a legacy state reloads it as `auto`. Profiles keep the real value, so the live leader is unaffected (review/full/events.md Appendix B F-FA5). scatter.ts treats it as automatic (selectMode falls through). Review question FARM-Q4.
- **monster-selection keepPolicy (3bae33fc, cf7cba08).** `select(..., keepPolicy)` keeps the policy and the event state when Achievement Hunt switches targets (fork af92de45 navigation/monster-selection.ts:44-68), but still calls `skipManualEventOccurrences` for every member (review/full/events.md 4.7). The fork also skips the party convoy for a Phoenix pick so fighters split from where they stand (3849a095).
- **Farm relocation fights Achievement Hunt over the location.** farm-areas.ts has no Achievement Hunt check, so `relocateBusy` can move the party to a filler's spawn; Achievement Hunt walks it back after 30 s (fork af92de45 achievement-hunt.ts:77, 357, 389). The orphan comment at achievement-hunt.ts:357 shows the case was seen. Review question FARM-Q5.
- **Console Play writes the mode (b33aee77, 9a34a4c1).** Play restores `farmingPolicy`, `location`, `monsterFocus`, `partyFarmingMode` and the Achievement Hunt fields saved at Pause (fork af92de45 lifecycle/console-control.ts:234-236, 272-279, 291-303), overwriting changes made during the pause.
- **Scatter per engagement (d798cac8, 1865916c, 31dd61f4).** The fork replaces Ryan's one-shot learning on the coordinator with per-engagement estimates: a type is learned when a fighter could kill it alone before help arrives, and a hard-coded set of 19 special monsters always groups (fork af92de45 status/scatter.ts, `SPECIAL_MONSTERS`, `regroupMs`, `soloEngagement`, `learnEngagements`). `git diff --stat refs/review/ryan-1.5 HEAD -- runtime/coordinator/status/scatter.ts` gives 181 lines changed. The explicit Scatter policy keeps Ryan's rule.
- **Heartbeat avoid list.** The farming response adds `avoidMonsters` in achievements mode (fork af92de45 status/response.ts:216-221).
- **Saved selections.** initial-focus.ts also loads Franky encounter routines and death limits (fork af92de45 initial-focus.ts:19-28).

### 3.3 Rares and Phoenix

**C1. Phoenix split search (fork 3849a095, ported from Fonze).** It replaces the whole-party
`phoenix-patrol` convoy with one region per fresh fighter, walked by client `smart_move`
(fork af92de45 shared.js:4049-4058, 4062-4088), adds a converge stage when any searcher sees a
Phoenix (fork rare-hunting.ts:486-535), a second protection list with a 10 s leader grace
(fork 182-194), and a realm-hop suspend (fork 829-866). Diff: rare-hunting.ts +287/-105,
phoenix-patrol.ts +166/-217 (`git diff --numstat refs/review/ryan-1.5 HEAD`).
- It patches: no owner for a stuck whole-party scan, and realm hops by boss chase, which the rare
  owner learns only from the leader's realm (fork 202-213, comment 835-836).
- It leaves `phoenix-patrol` in lists with no writer (fork rare-hunting.ts:137, 224, 759, 1000;
  shared.js:3956). Convoy safety (travel defense, formation, geometry repair) does not cover these
  client walks.
- New constants: GATHER_RANGE 300, CONVERGE_LOST 10 s, GATHER_MINIMUM 5 min, SEARCH_LEADER_GRACE 10 s
  (fork rare-hunting.ts:49-55), absence grace 10 s, planner reset 20 s, retry 5 s, stall 30 s
  (fork phoenix-patrol.ts:67-193), respawn wait 35 s.

**C2. Client route retry with a missing timestamp (fork bug).** The fork retries encounter and loot
routes 5 s after a failure (fork af92de45 shared.js:4127-4133), but the 30 s timeout writes
`rareNavigation` without `at` (4135-4136). `Number(undefined || 0)` makes the 5 s check false, so
the route restarts on the next poll. Fix: add `at: Date.now()` at 4136.

**C3. Achievement Hunt writes passive rare rules** through `rareControl.setSettings` and restores them
later (fork achievement-hunt.ts:146-176), a second writer of a user setting. AH's blacklist cap lives
in rare-retention.ts (fork cd7bd857, keepNewestAchievementBlacklist). Covered in the AH part.

**C4. Realm-hop blacklist (fork d22cec71)** is read only by boss chase (fork application.ts:1236);
its comment names a "daily-event chase" consumer that does not exist (fork realm-hop-blacklist.ts:4).

### 3.4 Cave and daily dungeons

`git diff refs/review/ryan-1.5 HEAD --stat` over the dungeon files changes only cave-request.ts (+9/-1) and dungeon-journal.ts (+4/-2); service, travel, progress, priest recovery, combat and contracts are unchanged.
- **7ea350fb** (fork) `requestCave` takes a fourth argument and calls the native `push_deferred("interaction")` before emitting, because the game client logs an error for every interaction reply that no deferred waits for (fork cave-request.ts:10-13, 59-62). `requestDungeon` passes `parent` (fork shared.js:2887). A second native-client workaround in the same function after 51e8bf4a.
- **3a3fa3ae** (fork) the journal settles a vote when the choice was replaced or resolved, not only when the native vote matches, because the game drops a vote that arrives after the others resolved it (fork dungeon-journal.ts:40-46). This makes a third copy of the vote rule (B.4) with a third meaning.
- Achievement Hunt (fork) waits while `dungeonOwns(state)` with "a daily dungeon is running" and skips its tick under the dungeon (fork application.ts, `git diff` lines 84, 283, 288).
- 0e179c4b (fork) releases a Cave fight on a won practice trainer in reset-fight.ts; combat, asks 04.

## 4. Tests today

Each test id is listed under its behaviour in `catalog/07-hunts-and-farming.json`. No tests were run for this spec. "Accurate" means the setup and assertions match the code path, read from the test source.

### 4.1 Monster Hunt

All test ids are listed per behaviour in `catalog/07-hunts-and-farming.json`. Tests were not run for this spec; "accurate" means the test's setup and assertions match the code path named, read from the test source.

| Test file (count) | Behaviours | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|---|
| scripts/tests/hunt-safety.test.cjs (41) | HNT-009, HNT-010, HNT-013, HNT-014, HNT-019, HNT-025, HNT-029, HNT-035, HNT-059 | quest selection order, blacklist skips, backup batches, arrival grace, death threshold | transpiles application.ts and runs the real tick through `helpers/coordinator-hunt.cjs` with stub convoys; no real movement | yes for the coordinator; the convoy is a stub | the arrival-grace tests (357-372) guard the arrival handoff timer; 40 guards `releaseFallback` |
| scripts/tests/departure-loot.test.cjs (14) | HNT-023, HNT-064 | barrier needs a matching fresh acknowledgement; moved collector releases it | real loot timing | yes | 97 and 108 guard the inherited-barrier rule |
| scripts/tests/hunt-temporary-encounter.test.cjs (16) | HNT-021, HNT-022 | encounter end rules, absence timer, legacy repair | builds `monsterHunt.encounter` by hand (line 41); no production path creates one (B.6) | accurate for the code, not for live play | yes: it guards a dead path |
| scripts/tests/hunt-farm-walk.test.cjs (12) | HNT-033 | due quest or failed walk releases the farm walk; anniversary yields | live reunion | yes | yes (829b85ba orphan relocation, 4030efac) |
| scripts/tests/hunt-route-recovery.test.cjs (6), shared-convoy.test.cjs::planning-origin drift... | HNT-032 | one native attempt then next spawn; geometry reset | the preparation-text reset loop (B.5) | yes | 42 guards the geometry reset |
| scripts/tests/hunt-route-acquisition.test.cjs (6) | HNT-018, HNT-020 | whole-party arrival, no early handoff | real terrain | yes | 20, 31 guard the removed handoff |
| scripts/tests/coordinator-hunt-composition.test.cjs (9) | HNT-003, HNT-006, HNT-008, HNT-016, HNT-026, HNT-035 | resume keeps backup, roster repair, start despite attackers | live convoys | yes | 137 guards f023f304's rare message |
| scripts/tests/coordinator-hunt-controls.test.cjs (4) | HNT-005, HNT-017, HNT-036 | participants rule, spawn choice ties, scoped cancel | preferred spawn | yes | no |
| scripts/tests/hunt-settings.test.cjs (3), hunt-spawn-preferences (1), rare-hunting-ui::Hunt settings... | HNT-014, HNT-017, HNT-034 | thresholds, migration, expiry once, settings route | dashboard save round trip | yes | 8 guards the migration |
| scripts/tests/hunt-mode-reset.test.cjs (2), coordinator-hunt-actions (1), monster-hunt-start (3) | HNT-001, HNT-002, HNT-036 | off/on resets execution, keeps quests | event-trip skip of the exit convoy | yes | no |
| scripts/tests/hunt-event-resume.test.cjs (9), hunt-ab-return (4), completed-return-cleanup (2), farming-navigation::Hunt resumes after anniversary... | HNT-002, HNT-013, HNT-024, HNT-025 | event return hands back to Hunt | staging and stale `joinedEvent` (B.1) | yes | several guard event-return handoffs (spec 06) |
| scripts/tests/hunt-event-handoff.test.cjs (3 mapped), hunt-retreat-restart (3), hunt-missing-destination (2), hunt-geometry-roster (1), hunt-fallback-owner (2), hunt-return-recovery (2), hunt-return-town (2), hunt-selector (1), continuous-hunt-return (1), convoy-communication (3), convoy-defense (1), solo-hunt (8) | HNT-006 to HNT-036 as listed in the catalog | as named | live play | yes | hunt-geometry-roster guards `geometryOwnsRoster`; solo-hunt 162 guards owner departure |
| e2e live-hunt-lifecycle (11), live-hunt-combat (2), live-hunt-recovery (1), live-hunt-departure (1), live-hunt-events (1), live-hunt-controls (1), hunt.spec (1) | HNT-001, HNT-004, HNT-012, HNT-013, HNT-014, HNT-018, HNT-024, HNT-029, HNT-032 | real game: quests, Daisy rewards, expiry, deaths, restarts, preferred spawn | staging, rare returns during Hunt, backup farming in the live game | yes (native game harness) | no |

Behaviours with no test: HNT-015 (exit mode, dead path). Not mapped: `e2e/live-hunt-*` specs about terrain, approach and combat (targetron, hawk, mage range, engaged terrain, multi-corner, planned terrain, ice roamer, merchant, code identity, cold defense, round2 recovery, town recovery, failed collection, empty spawn, committed corner, manual event override, sparkbot follow) prove combat, movement, survival and events behaviours under a Hunt; they belong to specs 02 to 06 and are not counted here.

### 4.2 Farming modes, focus and farm areas

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| coordinator-scatter.test.cjs (3 tests) | HNT-039: first learned kill sets the type, off-type threat holds scatter 3 s, member change resets, explicit policy wins | rare override, hunt and achievements policy values | yes | no |
| coordinator-status-composition.test.cjs::rare ownership keeps the coordinator grouped... | HNT-039 rare forces default, scatter resumes after | uses `farmingPolicy:'automatic'` (line 6), not a real value; passes only because unknown values act as auto | partly | no |
| coordinator-status-ingestion.test.cjs::scatter learning respects epochs... | HNT-040 coordinator half | the client one-shot rule (shared.js:1041) | yes | no |
| queue-markers, passive-rare-queue (2 named) | HNT-042 indirectly: grouped vs scatter markers and claims | groupedFarming rules themselves; they stub `groupedFarming` | partly | no |
| monster-hunt-start.test.cjs (2), e2e live-hunt-lifecycle "invalid backup..." | HNT-037 Daisy and backup refusals | auto/default/scatter switches | yes | no |
| solo-hunt.test.cjs (2), solo-hunt-ui (1) | HNT-038 separate scopes and saved follower mode | per-port parity between party and solo wiring | yes | no |
| coordinator-focus-routes.test.cjs (4) | HNT-043 validation, override clearing, scatter reset, invalidation | the focusChanged relocation | yes | no |
| coordinator-migrate-focus.test.cjs (4) | HNT-044 migrations | initialFarmingSelections policy whitelist | yes | yes (legacy migration) |
| farming-areas.test.cjs::bestiary validates selection..., e2e live-hunt-manual-event-override | HNT-045 validation order; event skip on manual travel | Phoenix start/stop | yes | no |
| rare-hunting-settings.test.cjs::invalid passive settings... | HNT-046 rejection | accepted rules | yes | no |
| farming-zones (3), farming-areas (4) | HNT-047 merging, holes, legacy points, ranking, exact validation | resolve() matching rules | yes | no |
| farm-zone-recovery "wild boar entry point", "idle leader outside..." | HNT-048 entry point and routing in | inFarmArea radius fallback | yes | no |
| farm-competition "client observes...", farming-zones "competition requires damage evidence" | HNT-049, HNT-050 | observeFarmArea full-observation rule | yes | no |
| farming-zones "one observed kill...", "unreachable selected target..." | HNT-050 | prune at load | yes | no |
| farm-zone-recovery (3 competition tests), farm-competition "all member radii...", coordinator-farm-composition (2) | HNT-051 | the 120 s busy window after a move | yes | coordinator-farm-composition "Hunt route recovery retains its spawn" guards d5279eab (huntTravelOwns) |
| farm-zone-recovery (6 failure tests) | HNT-053 | the 10 s and 2 s delays; noDestination mission branch | yes | "exhausted geometry repair holds..." guards 829b85ba |
| farming-respawn-wait (4), e2e live-hunt-empty-spawn | HNT-054 | anniversary gate | yes | no |
| farming-engagement (5), e2e live-farming-handoff | HNT-055 | the client pollFarmingCombatHandoff gate list | yes | no |
| farming-navigation (3 named) | HNT-056 | authorize copying into event owners | yes | no |
| hunt-settings "defaults, historical migration..." | HNT-057 restore | scatter reset at load | yes | partly (migration) |
| farm-reunion "already-respawned runtime..." | HNT-058 | the runner port itself | yes | no |
| hunt-safety (7 named), hunt-area-arrival (5), hunt-route-acquisition (2), hunt-return-regression (2), departure-loot (2), loot-capacity-recovery (1), monster-hunt-start "missing Daisy catalog" | HNT-059 to HNT-064 | see section 4.1 | yes | hunt-safety arrival-grace tests guard the arrival handoff timer |

No test found for HNT-041 (farmingResponse forcing default), HNT-052 (focus-change relocation) or HNT-065 (Hunt snapshot persistence): `git grep -n "focusChanged\|farmingResponse\|huntSnapshot" refs/review/ryan-1.5 -- scripts/tests e2e` returns one hit, a stub port in scripts/tests/character-appearance.test.cjs:32, and no test that exercises them.

### 4.3 Rares and Phoenix

Accuracy below comes from reading the test against the code, not from running it (no tests were run).
"Patch guard" means the test pins a fix for an interaction between owners rather than a player-facing
behaviour.

| Test | Behaviours | Proves | Does not cover | Accurate? | Patch guard? |
|---|---|---|---|---|---|
| scripts/tests/rare-hunting.test.cjs (31 indexed, plus 4 generated names per rare type) | HNT-068 to HNT-078, HNT-081 to HNT-083 | Coordinator owner end to end with a fake party: acquisition, priority, expiry, generator, loot, return, patrol | Real heartbeats, real grouped combat, real movement; runs the generated scripts/rare-hunting.cjs bundle, not the .ts | Yes for the scenarios read (L86 uses `turnIn` and `joinedEvent` as named) | L253, L333 guard B2 and B1 fixes |
| scripts/tests/phoenix-patrol-regression.test.cjs (25) | HNT-081 to HNT-083, HNT-070, HNT-074 | Patrol coverage, failures, respawn wait, sightings, region choice | Real planner routes; more than one realm | Yes for names read | L126, L153, L289, L301 pin past fixes |
| scripts/tests/rare-hunting-client.test.cjs (12) | HNT-075, HNT-076, HNT-080 | Client control acceptance, deployment, loot retry state | Runs a text slice of shared.js (L4, 19-20), so it cannot see callers outside the slice (cause of B11) | Yes | No |
| scripts/tests/rare-farming-return.test.cjs (6) | HNT-077 | Return retries, offline members, protected pause, shape arrival, Hunt hand back | Real convoys | Yes | L41 guards the Hunt hand back |
| scripts/tests/rare-retry-evidence.test.cjs (4) | HNT-074 | Rejection receipts and what reopens them | Interaction with grouped rejections | Yes | No |
| scripts/tests/passive-rare-queue.test.cjs (4) | HNT-066, HNT-073 | Client reports and coordinator queue retention | Live combat | Yes | L40 |
| scripts/tests/coordinator-recovery-hooks.test.cjs L11 | HNT-071 | `rare.resumeHunt` resets a Hunt | Nothing in production calls it (B10) | Tests dead code | Yes |
| scripts/tests/coordinator-recovery-hooks.test.cjs L22 | HNT-070 | A Daisy return is not replaced by a Fairy | Other protected kinds | Yes | Yes (turn-in precedence) |
| scripts/tests/coordinator-retention.test.cjs L33, L47; e2e/console-persistence.spec.ts L159 | HNT-074 | 100-entry caps on write and load | Nothing else | Yes | No |
| scripts/tests/encounter-recovery.test.cjs L20, L63, L87 | HNT-072 | Approach progress and cross-map Phoenix | Grouped release | Not checked in detail | No |
| scripts/tests/passive-hunting.test.cjs L9, L99, L223 | HNT-068, HNT-083 | Settings migration; passing attacks during a patrol | Encounter flow | Not checked in detail | No |
| scripts/tests/rare-hunting-settings.test.cjs L11; rare-hunting-ui.test.cjs L27, L39, L56, L63 | HNT-068, HNT-081 | Settings validation and the dashboard pickers | Coordinator effect | Yes | No |
| e2e/hunt.spec.ts L4; e2e/live-hunt-events.spec.ts L213 | HNT-068 | Level caps save; a disabled rare stays alive during Hunt | Enabled rare in a live game | Not checked in detail | No |
| e2e/live-hunt-engaged-terrain, live-hunt-mage-range, live-hunt-planned-terrain (one test each) | HNT-072 | Real native movement and combat reach a Phoenix | The rare owner's state machine (combat reach only) | Not checked in detail | No |

No test covers HNT-079 (solo stub) or B7 (client route failure with no reader). HNT-067 has
one indirect test (phoenix-patrol-regression L226); nothing tests the three tick paths together.

### 4.4 Cave and daily dungeons

Test names come from `node tools/tests-for.cjs tests.json "dungeon|cave" --names`. The two main live-cave journeys build their name with a ternary (e2e/live-cave.spec.ts:12-14), so the test index does not list them; they are cited by their two literal names.

| Test | Behaviours | Proves | Does not cover | Accurate? | Guards a patch? |
|---|---|---|---|---|---|
| daily-dungeons.test.cjs (25 tests) | HNT-084 to HNT-086, HNT-088 to HNT-090, HNT-093, HNT-094, HNT-098, HNT-100 to HNT-104 | Roster rules, entry through Dorr, event protection, purchase and paid vote checks, held and late entry, restart identity, journal and dispatch safety, eligibility polling, text fallback | `adopt`, `recover`, `retry` without travel, `release` with an offline member, multi-floor travel | Yes; unit level with hand-built statuses | "persisted Cave travel without leader observations" and "command identity" guard specific fixes (route crash, 99a6a74b hook) |
| cave-assembly-drift.test.cjs (6) | HNT-096 | Regroup and destination repair, caps, rejection of stale evidence | Failed-receipt `repair` cap and its silent stop | Yes | Yes: guards a3986593 and 545ca932 |
| cave-progress.test.cjs (5) | HNT-097, HNT-104 | Room then stairs order, waits, encounter pause, final floor, lost stairs reply | Merchant room handling, stair continuation across a stale member | Yes | No |
| cave-combat-queue.test.cjs (2) | HNT-099 | Three-slot queue, follower sightings, scope change on a new floor, votes stop pulls | Masked event fields | Yes | No |
| cave-priest-recovery.test.cjs (4 of 12 cover the coordinator) | HNT-098 | One authorization per death, priest priority, manual Nera rules | Revival across a floor change; the other 8 tests are the character half (05) | Yes | No |
| cave-request.test.cjs (6) | HNT-103 | Correlation, cleanup, failures, capture before native handlers, timer receiver | The 150 s enter timeout value | Yes | "captured before a throwing game UI listener" guards 51e8bf4a |
| daily-dungeons-combat.test.cjs (2 of 8 mapped here) | HNT-100, HNT-105 | Chest loot scope; healing roster from captured participants | The other 6 test target rules (04) and healing (05) | Yes, but runs a text slice of shared.js | Fragment loading (B.6) |
| e2e/live-cave.spec.ts "Cave entry closes settings..." and "Cave completes native rooms..." | HNT-086, HNT-088, HNT-092, HNT-095, HNT-097 | Full native journeys on a local game server: entry, votes, waypoints, room completion, stairs, exit to held | Release, events, revival | Yes; long (2,700 s budget) | No |
| e2e/live-cave.spec.ts "Cave shared-route pacing..." | HNT-094, HNT-095 | Followers walk the leader's route at one cruise, gap under 220, Stop clears moves | Repairs | Yes | No |
| e2e/live-cave.spec.ts "Cave assembly regroups..." (two layouts) | HNT-096 | Regroup after a native displacement | Destination repair | Yes | Yes: a3986593 |
| e2e/live-cave-headless.spec.ts | HNT-086, HNT-089, HNT-106 | Headless entry, only the leader gets full floors, exit to held, release to idle with no leftover fields | Release with a stale member | Yes | Guards 9162890d (fields cleared at idle) |
| e2e/live-cave-talk.spec.ts | HNT-091, HNT-092, HNT-093, HNT-096 | Talk reopens a merchant, buy, Retry keeps three spent repairs | Recover | Yes | Guards a5e336d7 and 480b0451 |

Not mapped here: daily-dungeons-dashboard.test.cjs (dashboard panel, 12); cave-return-progress.test.cjs (escape and return progress, 05 and 06); movement-service.test.cjs Cave cases (02).

## 5. Needs your review

Questions only the user can answer. The coordinator copies them into `REVIEW-QUEUE.md`.

### 5.1 Monster Hunt

1. **MH-Q1. What pauses Monster Hunt for an event?** Today any member's `activeEvent` or `joinedEvent` pauses Hunt, including the 120 s staging window and a stale value after a reload (B.1, B.3). A. Keep today's rule. B. Pause only when the member is admitted to an occurrence that is live now (the attendance record). C. Pause only the members at the event; the rest keep farming the quest.
2. **MH-Q2. Which message wins when several things hold Hunt?** Today the first check in call order wins (B.1). A. Show the highest-precedence owner from 01's table. B. Show every holder in one line. C. Keep call order.
3. **MH-Q3. Old saved cycles.** Temporary encounters, exit mode and failed-return have no production writer (B.6). A. Drop them after one release that converts old saved cycles. B. Keep them. C. Drop them now and reset any old cycle to `checking-quests`.
4. **MH-Q4. Route budget reset by preparation drift.** A drifting leader can restart Hunt travel without a limit (B.5). A. Count drift resets and stop after N with a visible hold. B. Keep resetting. C. Wait for the party to stand still before planning.
5. **MH-Q5. Death threshold default.** The default blacklists a quest monster after one party death (`settings.ts:13`). A. Keep 1. B. 2, as the dead fallback text suggests. C. Ask on first use.
6. **AH-Q1 (fork). Achievement Hunt and events.** It waits whenever any selected event is live in any member's report, and each target switch skips live events as manual travel. A. Wait only while the party attends an event; switches never skip events. B. Pause Achievement Hunt during an event and resume after. C. Keep today's behaviour.
7. **AH-Q2 (fork). Achievement Hunt and user settings.** It rewrites focus, priorities and passive rare rules and restores them later. A. Use a temporary override that the settings owner restores (spec 11). B. Keep direct writes. C. Use its own target fields and leave user settings alone.

### 5.2 Farming modes, focus and farm areas

1. **FARM-Q1.** A bestiary pick (and the fork's Achievement Hunt target switch) marks every live event occurrence as skipped for all party members (navigation/monster-selection.ts:69). Should picking a monster end the party's current event? A. Yes, any monster pick leaves the event for the rest of the occurrence (today); B. Only when the new spawn is off the event map; C. Never; the pick waits until the event ends; D. Ask in the dashboard when an event is live.
2. **FARM-Q2.** Learned scatter types reset on every coordinator restart (initial-farming.ts:48-49 sets scatterMonsterTypes to [] and a new epoch), so the party fights grouped until each type is one-shot again. Keep learned types across restarts? A. Relearn after restart (today); B. Save learned types per party roster and reload them; C. Save them, but clear on gear or level change.
3. **FARM-Q3.** A geometry-mismatch farm travel failure pauses farming with no retry (farm-area-recovery.ts:97-99) until you pick an area again or Hunt restarts. What should happen? A. Stay paused until you act (today); B. Retry once after a delay, then pause; C. Move to the next area, then pause if every area fails.
4. **FARM-Q4.** Fork only: should Achievement Hunt survive as the saved mode? Today a follower cannot save it (saved-farming-mode.ts:12) and a legacy state loads it as auto (initial-focus.ts:22). A. Leader only, legacy load becomes auto (today); B. Add achievements to both lists so any scope keeps it; C. Keep it for the leader across restarts, never for followers.
5. **FARM-Q5.** Fork only: farm-area relocation away from a competing player runs during Achievement Hunt and moves the party off the target's spawn, then Achievement Hunt walks it back 30 s later. Which should win? A. Achievement Hunt's target spawn wins; no competition relocation in that mode; B. Relocation wins, but only to another spawn of the same target; C. Leave both (today).
6. **FARM-Q6.** Competition relocation during Hunt follows the Hunt setting relocateIfCompeting (farm-competition.ts:74), but in other modes it always runs for shaped areas. Should ordinary farming have its own on/off setting? A. Always on outside Hunt (today); B. One shared setting for every mode; C. Separate setting for ordinary farming.

### 5.3 Rares and Phoenix

1. **RARE-Q1.** What may a rare interrupt? (a) keep today's list (farming, Hunt mission, manual monster and party travel); (b) never interrupt Hunt mission travel; (c) user choice per rare. Precedence itself is spec 01.
2. **RARE-Q2.** Should a farming-mode change end a rare encounter? (a) keep (cancels rare and return); (b) finish the rare, then apply the mode; (c) finish only Fairy and Phoenix.
3. **RARE-Q3.** After a rare, where does the party go? (a) back to the saved farm location or the Hunt mission, offline members kept; (b) stay where the rare died if the farm target spawns there; (c) drop offline members.
4. **RARE-Q4.** Phoenix patrol movement: (a) Ryan's whole-party convoy patrol; (b) the fork's split search with converge; (c) split search only with at least N fighters.
5. **RARE-Q5.** Scatter during a rare: (a) keep forcing grouped without direct restore; (b) restore scatter right after the rare; (c) let scatter members fight rares separately.

### 5.4 Cave and daily dungeons

1. Cave Q1. After a visit ends (manual exit or the run expires), the party sits in `held`: it stays at Main, other owners do not tick, and dead members do not respawn until someone presses Release. What should happen? (a) keep today's manual Release; (b) release on its own once every fresh participant is outside and nothing is pending, then resume the previous farming; (c) release on its own but go to Town and wait for a new order.
2. Cave Q2. Release today refuses while any participant is offline or more than 3 s stale. Should an offline participant block the rest of the party from leaving `held`? (a) yes, as today; (b) no, release the online members and drop the offline one from the visit; (c) no, but warn on the dashboard.
3. Cave Q3. While the dungeon owns the party, escape and death recovery do not run and a dead member does not respawn, including in `held` outside the cave. Should death handling stay off outside the cave? (a) yes, as today; (b) no, outside the cave (held) the normal escape, death recovery and respawn apply; (c) only respawn applies.
4. Cave Q4. With event protection off, a live eligible event makes the whole party exit the visit at once, including mid-encounter. Is that the behaviour you want? (a) yes; (b) exit only between encounters (no open vote, no fight); (c) never exit for an event, only skip events.
5. Cave Q5. When automatic Cave travel uses up its three repairs, it stops with no error text of its own; the dashboard shows 'Travel failed; use Retry failed preparation'. Should the console (a) keep this; (b) show which repair ran out and why; (c) also exit the run after the cap?

## 6. Gaps

### 6.1 check-claims

Command: `LIMIT=100000 node tools/check-claims.mjs`, run in this folder after writing `catalog/07-hunts-and-farming.json`, filtered to lines naming `07-hunts-and-farming`. Other specs were being written at the same time, so the totals across all specs change between runs.

| Check | Result for spec 07 |
|---|---|
| Functions claimed by this spec | 518 (in 106 behaviours) |
| Claimed by more than one spec | 0 |
| Claims naming no known function | 0 |
| Behaviours with no test | 6 |

Behaviours with no test:

- HNT-015: Exit mode after a turn-in sends the party to the leader's saved farm; no production code sets exitMode in Ryan's base
- HNT-041: Each heartbeat response sends focus, priorities, search radius, Hunt target and the party mode (default during rare or death recovery)
- HNT-052: A focus change that replaces the farmed species queues a move to an area of the new focus
- HNT-065: Status ingestion persists only when the Hunt record changed, ignoring its message
- HNT-079: Independent (solo) characters get a stub rare owner: no rare hunting outside the party scope
- HNT-087: Adopt a visit in progress: an idle roster member seen inside a cave puts the party in entering

The tool does not list unclaimed functions by spec. Every one of the 591 functions proposed for 07 is either claimed here (477) or handed off in `catalog/handoffs-07.json` (114); 41 triage functions are claimed as well. Checked with a node one-liner over the two files and `proposed-sections.json`.

### 6.1a Ownership the coordinator has to settle

- **Requested from other specs: 294 functions** that implement behaviours in this spec but are proposed elsewhere: 215 in 02-movement (rare-hunting.ts, phoenix-patrol.ts, farm-areas.ts and the other navigation farming modules), 53 in 13-lifecycle (Hunt and farming HTTP routes), 20 in 12-dashboard-and-status (farming-zones.ts, farming-areas.ts) and 6 in 04-targeting (`monsterHuntTick`, `beginMonsterHuntCycle`, `clearMonsterHuntState`, the party and solo `monsterDestination`, and `status/scatter.ts` `reportsTarget`). Count from the `requested` keys in `catalog/07-hunts-and-farming.json`. They stay with their proposed spec until the coordinator moves them.
- **Yielded to 02 (5) and 04 (1).** Spec 02 claims `planHuntReturn` and its two closures (HNT-062) and the convoy arrival port `acceptArrival` with its solo copy (HNT-018); spec 04 claims `passiveLevelAllowed` (HNT-068).
- **Yielded to 01: 95 functions.** Spec 01 already claims the Hunt roster (`hunt/controls.ts` participants, `hunt/current-party.ts`), Follow changes (`participants.ts`), the mode switch (`hunt/mode.ts`), turn-in precedence, the pause order, the "at an event" copies, the anniversary yield, the solo-service wiring and the dungeon gate (GRP-001 to GRP-018). Spec 07 still describes those behaviours (HNT-001 to HNT-007, HNT-013, HNT-023 to HNT-036, HNT-038, HNT-043, HNT-050, HNT-051, HNT-079, HNT-084, HNT-090) and lists each function in `catalog/handoffs-07.json` with the GRP behaviour that holds it. If the coordinator decides the Hunt roster or mode switch belongs here, those entries move back.
- **Fork-only code is not in the Ryan index**, so Achievement Hunt (section 3.1) has no catalog behaviour. `catalog/functions-fork.json` would hold it if the fork gets its own catalog.

### 6.2 Monster Hunt (part notes)

- The `check-claims.mjs` counts are in 6.1.
- Not verified against game data: Daisy interaction range (100 and 120), the 800 death-recovery radius.
- Tests were mapped by reading names and setups, not by running them; accuracy labels for the e2e specs are from their names and the first-pass review.
- `git log -L` histories cited in B were rerun for tick, combatEvent, pause, resetChangedGeometry, mode.exit and recoverHuntFarmWalk only; the rest come from review/full/events.md section 5.2.

### 6.3 Farming modes, focus and farm areas (part notes)

- Not claimed, described only: 138 function ids in `requested` (02-movement 78, 13-lifecycle 39, 12-dashboard-and-status 20, 04-targeting 1). The coordinator moves them to 07 or keeps them with their proposed spec.
- Triage closures in application.ts left for others: farming-navigation and party-convoy ports (417-420, 1802-1805), heartbeat response ports (546-559, 1901-1914), navigation action ports (761-779 except 771, 1978-1996 except 1988), party configuration ports for events and formation (700, 702, 708-712), solo walks (2000-2002). Inference: these belong to 02-movement, 06-events or 12-dashboard-and-status. Monster Hunt wiring closures are claimed in section 1.1.
- Behaviours without a test: HNT-041, HNT-052, HNT-065.
- Not verified: the client farm reunion that `rejoinFarm` calls (shared.js beginFarmReunion) was not read here; it is movement or survival code. The full list of `farmingPolicy` readers was taken from review/full/events.md Appendix B 2.6 and not re-counted on the Ryan ref.

### 6.4 Rares and Phoenix (part notes)

- Not claimed here, proposed to 02-movement: every function in rare-hunting.ts (102), phoenix-patrol.ts
  (21), phoenix-candidates.ts (2), rare-progress.ts (3), rare-retention.ts (1),
  rare-retry-evidence.ts (5), rare-route-distance.ts (1). They are listed as "requested" in
  `catalog/07-hunts-and-farming.json` (135 ids) for the coordinator to move to 07.
- Related functions left with their proposed specs: shared.js `ownedRareTarget`, `rareTarget`,
  `rareAttackAllowed` (04), `cancelRarePath` (02), `tinyProjectileProtected` (triage; belongs with
  `rareAttackAllowed` in 04), navigation/recovery-hooks.ts (02, holds the dead `rare.resumeHunt`),
  passive-settings.ts (02), application.ts `rareEncounter` ports (04), `blocksPulls@2426` and
  `patrolAcquisitionAllowed@2427` (11), `reconcileHuntArrival@1777` (07, left to the Monster Hunt part).
- Test index gap: rare-hunting.test.cjs L32 builds four test names at run time (`id+' passive setting
  acquires at priority 100 and yields to Fairy'`), so the test index does not list them.
- Not verified: the accuracy of the e2e tests (not read in full); the 7 ticks per second estimate (B8);
  the game's real Phoenix spawn count (B9).
- No tests were run.

### 6.5 Cave and daily dungeons (part notes)

- {{HNT-087}} (adopt) has no test.
- The two main live-cave journeys are not in the test index (ternary name); their ids in the catalog are written by hand.
- Not verified against game data: the three-member Cave party limit (service.ts:100) and the Dorr NPC id `dreamkeeper` (shared.js:2740).
- B.4 and B.5 effects are inference; no run log shows them.
- No tests were run.
- Functions named here but owned by other proposals: cave-recovery.ts and caveRecovery (05), Cave target rules (04), `dungeonRuntime>move/travel/sharedRoute/preparedCaveRoute` and `canMove` (02), cave-floor-handshake.ts and the `releaseDungeon`/`exitDungeon` routes (13), dashboard dungeon panel (12).

## 7. The design

M1.

## 8. What changes for the player

M1.

## 9. Proof

M1.

## 10. Migration

M1.
