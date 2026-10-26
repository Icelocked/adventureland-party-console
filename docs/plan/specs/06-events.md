# 06 Events

Checked against Ryan's base `refs/review/ryan-1.5` (b9b5c91e) in
`F:/CodingProjects/pm-worktrees/review`. Every `file:line` below is on that
ref unless it says "fork" (af92de45, HEAD of the same checkout). Behaviour
ids are `EVT-001` onward; `catalog/06-events.json` lists the functions and
tests for each one. Evidence leads came from
`backups/party-console/review/full/events.md` (with Appendix A and B),
`review/events.md` and the bug ledger in `review/BRIEF.md`; every claim here
was re-read on the Ryan ref, and line numbers differ from the reviews, which
cite the fork.

Words used below:

- **Event**: a game event the party can attend. Three kinds exist today, but
  only as name lists: *join* events teleport with `join()` (Goobrawl, Crab,
  Franky, Ice Golem, A/B testing), *walk* events are reached on foot (Snowman,
  Mr. Green, Mr. Pumpkin, Slenderman, Horseman, Graveyard), *interaction*
  events need clicks, not fights (Trick or Treat doors, Witch's Cipher).
  Anniversary is a fourth, separate machine.
- **Occurrence**: one round of an event on one realm.
- **Character side**: `characters/shared.js`, one closure per character.
  **Coordinator side**: `runtime/coordinator/*`.

## 1. What it does today

### 1.1 Event catalog, clock and schedule

- **EVT-001 Event catalog.** The character treats every `G.events` key plus 8
  literal names as supported (`supportedEventNames`, shared.js:11471-11477).
  Separate literal lists decide the kind: `halloweenEvent` (4 names, 11479),
  `scheduledWalkEvent` (4 names, 11480), `eventRequiresJoin` (join unless a
  Halloween or October name, 12764-12769), `eventIsSupported` (12771-12775).
  Per-event monster lists are hand-written for Goobrawl, Graveyard, Horseman,
  Mr. Green and Mr. Pumpkin (`deriveEventMonsterTypes`, 12744-12762); the
  Graveyard setting filters its list (12739-12740). The coordinator has its
  own catalog (`dashboard/lib/event-policy.ts:32-41`), with 14 names.
- **EVT-002 Status and server clock.** `nativeEventStatus` reads `S`
  (11452-11454). `eventStatus` copies it with deadlines shifted by the clock
  offset (11455-11469). The offset comes from a `test` echo midpoint, rejected
  when the round trip exceeds 5 s (500-508, 509-513). The feed counts as
  current only while the socket is connected and the clock was synced within
  360 s (`halloweenFeedCurrent`, 11481-11486).
- **EVT-003 Schedule report.** Each heartbeat carries an `eventSchedules`
  entry per supported event: next occurrence, door counts, Cipher board and
  runtime snapshot, ingredient sources (`eventScheduleSnapshot`, 514-548).
  The coordinator shows the latest fresh report from the leader's realm
  (15 s, `schedule-reports.ts:25-50`) and computes Trick or Treat door counts
  per account (52-78).

### 1.2 Selection and the "may attend" answer

- **EVT-004 Selection.** On the character, `eventSelected` is the heartbeat's
  `eventSelections` list, or "anniversary only" before the first list arrives
  (498). On the coordinator, a follower uses its leader's selections and
  priority order; the merchant also gets Witch's Cipher when the leader picked
  it (`event-policy.ts:43-70`). The heartbeat sends only selections whose
  occurrence is not exhausted (`application.ts:561`, `eventInstanceAllowed`).
  A selection change bumps `eventSelectionRevision` and queues a "pending
  disable" for each dropped event (shared.js:11263-11274).
- **EVT-005 The enabled answer.** `eventsEnabledFor(name, event)` returns
  selected, then not exhausted, then `dungeons.eventAllowed` (application.ts:
  1236-1242). The dungeon step can retire a held visit or dispatch a Cave exit
  (service.ts:241-253), so this question writes state; 01 GRP-018 owns that
  gate. Every heartbeat runs attendance limits, then the event observer
  (application.ts:1081-1084).

### 1.3 Live and staging reports

- **EVT-006 Live report.** The character lists every supported event that is
  live in `S`, with an instance id taken from the first of id, event_id,
  round, start, end or expires (`rawServerLiveEvents`, 11548-11567). For the
  two October events it calls `octoberRuntime().activity()` instead, which can
  save a gathering plan (11555).
- **EVT-007 Character staging.** For Mr. Green, Mr. Pumpkin, Horseman and
  Graveyard, `halloweenAttendance` opens a staging window from 120 s before to
  120 s after the announced spawn, taken from `S` or the calendar
  (11508-11537; literals at 11519 and 11532). It writes `halloweenStages` and
  resets the Slenderman search as it goes. Staging entries go out as
  `serverStagingEvents` (11539-11546).
- **EVT-008 Coordinator staging.** A staging report is valid for those 4
  names, within 120 s of spawn, and only if the character joined it or was
  admitted before joining (`observations.ts:147-162`). It creates a staging
  session with a fixed spawn id (163-188). While a staging session lasts
  (spawn + 120 s, still announced in fresh reports) the event does not end
  (396-399, 408-414). The enabled check treats staging as live
  (application.ts:1685-1697). The 120 s literal sits on 5 lines across the
  two sides (command: `git grep -n 120000 refs/review/ryan-1.5 -- characters/shared.js runtime/coordinator/events/observations.ts runtime/coordinator/application.ts`,
  lines 11519, 11532, observations.ts:161, 398, application.ts:1696).

### 1.4 Choosing the event

- **EVT-009 Event choice (character).** `activeCombatEvent` (12869-12911):
  clears a manual suppression whose `S` entry is gone or changed (12871-12878);
  October events come from `activity()` (12880-12881); walk events need an
  open attendance window; other events need `S` present and not `live:false`,
  or a party hint, or visible Goo on goobrawl (12884-12900). A pending
  anniversary visit hides any event the user ranked below anniversary
  (12889-12898). The list sorts by selected priority, then "current map or
  joined", then earliest end (12903-12910). 37 call sites read it (command:
  `grep -o 'activeCombatEvent()' shared.js | wc -l` gives 38, one is the
  declaration).
- **EVT-010 Party hint.** The coordinator names the first selected event that
  another fresh, enabled member reports live (`response.ts:142-155`,
  `partyEventHint` at 282).
- **EVT-011 Event pending flag.** The character reports `huntEventPending`
  when an event is active or an anniversary visit is due within 90 s
  (11899-11911); the Hunt turn-in waits for it (01 GRP-009).

### 1.5 Admission

- **EVT-012 Admission.** Before each travel step the character calls
  `eventTravelAllowed`: no Cave, merchants always yes, no Hunt turn-in and no
  non-preemptible convoy, then POST `/hunt-event-permission` (11913-11926).
  The route allows unless the member is in the event return, Hunt owns a
  turn-in, or navigation is cancelled (`hunt-control.ts:68-71`), then calls
  `observations.authorize` and opens a hunt event trip (72-83). `authorize`
  hands off an open anniversary cycle, records participation, copies
  anniversary waypoints, adopts deferred members and persists
  (`observations.ts:244-259`). A permission request is therefore a write.
  16 character call sites ask (command: `grep -n 'eventTravelAllowed(' shared.js`,
  lines 11825, 11835, 11848, 11855, 11932, 11941, 11946, 12082, 12240, 12311,
  13317, 13381, 13402, 13416, 13732, 13743); the kiss posts begin and end
  directly (12264-12266, 12445-12447).
- **EVT-013 Live sessions.** Each enabled character that reports an event live
  gets a session holding the checkpoint and waypoints captured at its start
  (`reportLive`, `liveSession`, `sessionSnapshot`, observations.ts:93-144).
  Sessions are keyed by character name.
- **EVT-014 Observation order.** Every heartbeat runs, in this order: live
  sessions, staging, observed participation, anniversary handoff, released
  members, ended return, stale members, deferred resume
  (`observe`, 581-596).
- **EVT-015 Hunt event trips.** An admitted departure opens a trip per
  character, or reuses the open trip for the same event (`hunt-trip.ts:12-28`,
  cap 32). Trips end on Town or return. Deaths during a trip count for the
  event, not the Hunt (shared.js:616-622 builds a trip from `joinedEvent`
  when none is open).
- **EVT-016 Assisted participation.** A follower whose live, local target is
  Mr. Green, Mr. Pumpkin or Slenderman counts as attending without the join
  flag (observations.ts:546-579).

### 1.6 Travel and joining (character)

- **EVT-017 pollEvents.** A 10 s timer (shared.js:17358) plus 7 immediate
  kicks run `pollEvents` (13280-13428). Order: Cave, maintenance, escape,
  busy, Hunt turn-in and non-preemptible convoy guards (13281-13285); the
  merchant cancels gathering and closes its stand (13288-13301); an event
  outranks anniversary staging but never an active kiss (13311-13331);
  `joinedEvent` is rebuilt from the current map (13335-13340); with no event,
  a joined event missing for 10 s is reported with `/event-ended`
  (13342-13370). Otherwise it sets targets (none while staging, 13373), asks
  permission (13381), and either joins (13401-13407), runs the October
  interaction (13414), searches for Slenderman (13415) or walks with the
  shared walk (13416-13417). For walk events `joinedEvent` is set before the
  walk starts (13408-13413). Failures are only logged (13418-13421).
- **EVT-018 Destination.** October runtime, fixed Graveyard point
  `spookytown 255,-1425`, a fresh peer boss sighting, `S` coordinates, fixed
  Horseman point `halloween -405,-1640`, the event map spawn, the boss spawn,
  any listed monster spawn, else stay (12797-12835).
- **EVT-019 Joining.** `joinCombatEvent` calls `join()` when a rejoin is
  required, the character is not joined, or it is on the wrong map, then waits
  5 s for the map change (13188-13204). `joinEventDestination` joins when a
  follow or return-leader target is an event map, without a permission call
  (12837-12850, used at 10920 and 17767).
- **EVT-020 Slenderman search.** 180 s over halloween, spookytown and cave,
  60 s per map, walking to spawns, packs and NPCs and chasing fresh sightings;
  exhaustion ends the round for this character (13206-13278).
- **EVT-021 Respawn rejoin.** After a respawn the role runner calls
  `rejoinActiveEventAfterRespawn` (runner.ts:76-78; shared.js:13721-13759),
  a second travel owner beside pollEvents guarded by the same
  `eventTraveling` flag.
- **EVT-022 Event combat support.** Target reachability (12930-12935), boss
  sighting in the heartbeat with a Cipher gather exception (12937-12953),
  Goobrawl aggressive mode (13049-13052). Target choice itself
  (`nearestEventTarget`, 12955-13047) is claimed by spec 04.

### 1.7 Attendance, limits and manual skips

- **EVT-023 Attendance limits.** One `AttendanceInstance` per character per
  event occurrence, matched by native id or "not ended" on the realm
  (`attendance-limits.ts:43-67`). Attending time and deaths during attendance
  are counted (69-99). Over the death or time limit the instance is
  `ignored` until the occurrence ends (81-85, 101); it ends 10 s after it
  leaves the report (86-91). `eventInstanceAllowed` blocks a character whose
  own instance is ignored, or whose leader's instance is ignored for any
  reason except manual travel (116-121).
- **EVT-024 Manual-move skips.** Every manual travel command marks each live
  occurrence the actor is in as `ignored:'manual travel'` and
  `manualTravel:true`, and seeds an instance for an admitted pre-join
  (160-177). Callers: `manual-commands.ts:79, 96, 109, 126, 144`,
  `party-actions.ts:68, 108`, `monster-selection.ts:69` (command:
  `git grep -n skipManualEventOccurrences refs/review/ryan-1.5 -- runtime`).
  A skipped occurrence cannot install a competing return (180-185,
  `event-recovery.ts:64, 85`).
- **EVT-025 Failed entry.** A retry-exhausted event shared walk becomes a
  forced return with the saved checkpoints, and every walker's instance is
  marked `travel failure` (`failed-entry.ts:51-66`). Only walks reach this
  path (14-18).

### 1.8 Returns

- **EVT-026 Event end.** An event ends when no staging session holds it, no
  enabled member reports it live, Goobrawl is not still fighting, and 10 s
  passed since the last live report (`observations.ts:387-406`). Members that
  have another live event carry their checkpoint into it instead of returning
  (416-432, 337-355).
- **EVT-027 Party return.** `state.eventReturn` (returns.ts): begin or reuse a
  return (194-212; a same event within 60 s does not restart, 78-84), Town
  commands to each participant (130-135), wait for every member, then
  dispatch the leader's checkpoint convoy (226-241) and complete (214-221).
  Each tick reconciles orphan commands, Goobrawl, lost anniversary handoffs,
  policy, Hunt handoff, walk repair, a new anniversary round, deferred
  members, participants, the Franky exit, commands and progress, in that
  order (298-317). Consumed idle exits get a new Town command (334-353).
- **EVT-028 Return policy.** A farming mode change during a return re-targets
  the saved checkpoint for members still on that revision
  (`return-policy.ts:5-33`).
- **EVT-029 Return walk repair.** A failed return walk is cancelled and its
  members re-issued Town, unless a merchant command is in flight
  (`repair-return-walk.ts:15-52`).
- **EVT-030 Goobrawl wait.** No return starts, and a started one is dropped,
  while any fresh member still fights on goobrawl (`return-guards.ts:13-23`,
  returns.ts:66-76, 166-168).
- **EVT-031 Franky exit.** A Franky return first walks remote members to
  Main (0,0) as a `franky-exit` convoy, with a walking fallback after a failed
  Town (returns.ts:86-128, `return-composition.ts:116-117`).
- **EVT-032 Return into Hunt.** With Hunt selected, the return finishes into
  the current Hunt once every member is fresh, out of the event map, at Main
  within 90 or acknowledged, and owns its command (`hunt-resume.ts:13-89`);
  during a Hunt Daisy return it hands over to that journey instead
  (`hunt-return.ts:25-111`). Both write `monsterHunt.stage` and `message`.
- **EVT-033 Deferred returns.** A member released to another live event, or
  silent for 10 s after a 30 s old return, becomes a per-member deferred
  return (`observations.ts:357-385, 441-463`) that goes Town then checkpoint
  on its own (489-544, `acknowledgements.ts:35-67`). A later admission adopts
  its checkpoint and pulls its fresh peers along (260-291). Deferred records
  are root-wide, not scoped (01 GRP-002).
- **EVT-034 Character exit.** `event-return-town` takes movement, clears
  `joinedEvent`, leaves the event map (goobrawl transporter, abtesting or
  ship0 `leave` then transport, 3 attempts), walks or Towns until Main within
  90, with a 45 s deadline and 2.5 s retry (shared.js:10754-10860,
  11633-11743). Each heartbeat sets `__partyEventRecoveryCycleId` from
  `eventReturnCycleId` and cancels an exit owner of another cycle, fenced by
  timestamp because both the fast transport path and the tick call it
  (10302-10324, 3259, 11206; `response.ts:172-177`).
- **EVT-035 Rendezvous.** Event walks go through the shared walk, which owns
  rendezvous and coalescing (`navigation/shared-walk.ts`, spec 02). No
  function is claimed here.
- **EVT-049 Acknowledgement routes.** Town complete, return complete, resume
  complete and engagement stamps (`http/event-acknowledgements.ts`), return
  progress (`http/return-progress.ts`) and the character writer
  `saveReturnPhase` (shared.js:11024-11031), which Town returns also use.
- **EVT-050 Disable and ended routes.** Deselecting an event starts a forced
  return for its real participants; for anniversary the leader's deselection
  aborts the round and a follower's returns only that member
  (`http/event-recovery.ts:39-96`). `/event-ended` starts a return only after
  10 s of absence with nobody inside (108-126). On the character the pending
  disable stops movement unless a convoy, force travel, Town, event exit or
  reunion owns it, then posts `/event-disabled` (shared.js:11288-11295).

### 1.9 October runtime (Trick or Treat, Witch's Cipher)

- **EVT-036 Door route.** Fixed order `[1,0,5,6,2,3,4]` (october.ts:79), walk
  to each door +40 y, knock within 75, record knocked and limit replies
  (`october-runtime.ts:111-132`).
- **EVT-037 Cipher plan.** One owner (the leader when it selected Cipher)
  picks a party-wide plan from a fresh shared stock: gather the scarcest
  ingredient, or brew once every count is above zero, or finished after
  `gather_end` (44-77; brewing chosen at 63-65). The coordinator builds the
  shared stock and owner (`response.ts:63-93`).
- **EVT-038 Activity and destination.** `activity()` returns a gather-monster
  event in gathering mode and an interaction for every member otherwise
  (81-99; 98), writing `phase` and `detail` as it goes. Destination is the
  gather spawn or the Witch (+30 y) (100-109; shared.js:479-480).
- **EVT-039 Brewing.** The merchant transfers, checks the daily limit and
  realm, walks to the Witch, waits for `minClues` clues (default 1,
  october.ts:27; gate at october-runtime.ts:159 and 168), solves (minimax over
  1,024 recipes, october.ts:51-69), checks affordability (175-183), then brews
  with a journal that never replays an unknown outcome (134-145, 188-201).
  Errors wait 15 s (203-209).
- **EVT-040 Character ports.** `octoberRuntime` builds one runtime with clock,
  stock, journal in localStorage, knock, brew, Witch point, and an
  ingredient transfer to the Cipher merchant within 350 (shared.js:460-493).

### 1.10 Anniversary

- **EVT-041 Live round.** The coordinator picks the active schedule from the
  leader's realm, updates the cycle, and sets a party hold when an owned
  character is featured (`anniversary/live.ts:8-91`, snapshot.ts).
- **EVT-042 Combat handoff.** Kiss operations (180 s expiry) block a combat
  departure until they end (`observations.ts:190-243`). An admitted combat
  departure or a joined report hands the anniversary cycle to the event
  return (220-238, 293-318); the return then owns the way home.
- **EVT-043 Anniversary return and abort.** Dispatch after all visits, after
  the one-minute featured hold, at window end, or after a skipped round
  (`anniversary/returns.ts:13-156`). A second failed approach for a
  target-missing, unreachable or unconfirmed kiss skips the round
  (`abort.ts:93-108`). A finished visit hands back to the current Hunt
  (`hunt-handoff.ts:60-68`).
- **EVT-044 Character staging and kiss.** 1 s tick (`runAnniversaryTick`,
  12632-12639): preempt a farming convoy, stage at Main, report staging and
  return-ready, travel to the featured player with two approaches, kiss
  (8 s timeout), confirm by slice or buff, recover a consumed ticket, abort a
  skipped round (11824-11991, 11993-12451).
- **EVT-045 Slices.** Fighters send slices to the merchant (falls back to the
  name `GoldMajesty`, 12490); the merchant collects, swaps 1:1 with other
  players, returns owed slices and advertises (12454-12630; coordinator
  handoffs, slices, trades, supplies).
- **EVT-051 Anniversary routes.** Staging, return-ready, preempt, attempt,
  failure, claim, handoff, trade, chat and supplies routes
  (`http/anniversary-*.ts`).

### 1.11 Merchant, A/B testing, Franky

- **EVT-046 Merchant reservation.** The merchant is reserved while joined,
  travelling, returning, under coordinator recovery, or while a selected
  event is live (shared.js:11601-11604); merchant jobs are deferred
  (10475-10481) and a running job checkpoints with `merchant_yield`
  (11606-11615). Anniversary control adds featured, kiss-due and busy holds
  (11617-11631, application.ts:847-850, 1668-1678).
- **EVT-047 A/B testing.** Teams resolve to uniform, balanced or split with
  sabotage feeders after 20 s or once all teams report
  (`abtesting.ts:78-101`); the character picks opponents and feeds
  (shared.js:13054-13113; the sabotage loop at 13158 is claimed by spec 03).
- **EVT-048 Franky attendance.** Franky combat runs while selected and joined
  or on its map, unless any of 14 other owners holds the character
  (12915-12922).

## 2. What goes wrong

Each item: cause chain on the Ryan ref, then patches. "Inference" marks what
the code alone does not prove.

### 2.1 Manual move ends the round for that character (ledger 14 family)

1. Any manual command calls `skipManualEventOccurrences`
   (`manual-commands.ts:79`, etc., EVT-024).
2. The live occurrence becomes `ignored:'manual travel'`
   (`attendance-limits.ts:166-168`).
3. `eventInstanceAllowed` turns false (116-121), so the heartbeat drops the
   event from `eventSelections` (application.ts:561).
4. The character's pending disable stops movement, posts `/event-disabled`
   and clears `joinedEvent` (shared.js:11288-11295). Inference: a plain
   `character-travel` (10861-10866) has none of the exempt flags, so the stop
   can cancel the user's own move.
5. `ended()` skips the member because it is no longer enabled
   (observations.ts:388); no return starts.
Patches: Ryan d009eb22 made this the rule. No later patch.

### 2.2 Join failures have no owner ("cant_join" every 10 s)

1. `activeCombatEvent` keeps returning a join event while `S` lists it
   (12899-12900).
2. pollEvents asks permission (a write, EVT-012) at 13381 and 13402.
3. `join()` rejects; pollEvents logs "Event travel failed" (13418-13421).
4. Nothing reports the failure; `failed-entry.ts` accepts only walks (14-18).
   The trip stays open (hunt-trip.ts:20), so Hunt stays paused (01 GRP-011).
Inference: the game rejects `join` after its join window while `S` still
lists the event. No patch.

### 2.3 Staging claims the party at spawn minus 120 s (ledger 14)

1. `halloweenAttendance` opens at spawn-120 s (11532).
2. `activeCombatEvent` returns the staging entry; the heartbeat reports it as
   `activeEvent` (2987).
3. pollEvents sets `joinedEvent` and starts the walk at once (13408-13417).
4. Every Hunt copy of "at an event" fires (01 GRP-013), so Hunt pauses and
   cancels its convoy (hunt/travel.ts:15-28).
5. The lead is a literal, not route time plus a margin (5 lines, EVT-008).
Patch: Ryan dropped the fork's timeout-forced return in #151 (his
`docs/pr-151-integration.md`, "Excluded"); the "spawn hold" was a test
harness change. "Several minutes early" is not proven from code.

### 2.4 Witch's Cipher deadlock and idle fighters (ledger 2)

- Merchant: `minClues` defaults to 1 (october.ts:27) and the gate runs before
  the solver and the affordability branch (october-runtime.ts:159, 168, 175).
  The solver works with zero clues (october.ts:51-69). With an empty realm
  board the merchant waits forever "waiting for clues". The user can set 0
  (`event-policy.ts:14`).
- Fighters: brewing is chosen once every ingredient count is above zero
  (63-65) though a mix uses five, and brewing mode gives every member an
  interaction at the Witch (98).
Patches: fork da499b7b (merchant sits out gathering), 7253caef (restricted
maps last), e9e4bda3 at 21b8362d (`stockedGatherType`, fighters gather in a
stocked round). `minClues` is untouched.

### 2.5 Reads that write

`activeCombatEvent` clears suppression (12871-12878) and through its callees
writes `halloweenStages`, the Slenderman search and the October journal and
phase (11508-11537, october-runtime.ts:33-42, 44-77, 81-99). The heartbeat
alone reaches `activity()` through 3 paths (2987 via `activeCombatEvent`,
11555, 12939). `authorize` writes on a permission request (EVT-012).
`eventsEnabledFor` can retire or exit a Cave visit (EVT-005). Call order then
decides state.

### 2.6 One session slot per character

`reportLive` keys sessions by character (observations.ts:138-144). With two
enabled live events, each heartbeat replaces A's session with a fresh B
session, then `participate` rebuilds A for a joined member with a new
snapshot (585-590), persisting twice. Inference (impact): prejoin
authorization and the checkpoint captured before the event are lost while
both are live.

### 2.7 Event knowledge as name lists and literals

Kinds, monster lists, staging names and fixed points live in at least 8
literal lists on the character (EVT-001, EVT-007, EVT-018) and 4 on the
coordinator (observations.ts:159, 550; application.ts:1688;
event-policy.ts:32-35), plus Goobrawl, Franky and abtesting cases in
returns.ts (66-76, 96-128, 207). Every October addition appended names to
each list.

### 2.8 Deferred return fix chain

The deferred return is a second return machine per member beside
`eventReturn`, and both race with new admissions. Ryan's 2026-10-08..14
chain: 5487c9f0, 9264b7f5, 7d3c5c1b, 0f07fd0b, dce39092, ea49a71a, 0a85cb1e,
f781044d, b012e091, a6b0307d, d009eb22, 545ca932; each added a phase or a
fence (`awaiting-event-handoff`, `awaiting-reconnect`,
`awaiting-event-admission`, `returning-to-checkpoint`, `returning-to-town`;
observations.ts:371, 455, 480, 542). Command for the history:
`git log --oneline refs/review/ryan-1.5 -- runtime/coordinator/events runtime/coordinator/hunt runtime/hunt runtime/events runtime/coordinator/http/hunt-control.ts`
(45 commits since 2026-09-15 per the full review; not recounted here).

### 2.9 Stale joinedEvent

16 lines write `joinedEvent` (command: `grep -nE "joinedEvent = [^=]" shared.js`).
Escape clears only the local copy (237), so a reload restores the event from
`root.__partyJoinedEvent` (552) and death attribution (619) and Hunt (01
GRP-013) read a finished event.

### 2.10 Smaller findings

- Manual suppression clears itself for events with no `S` entry
  (12874-12877), so a manual monster override during staging or a door round
  lasts one call (inference for the `S` shape).
- `anniversaryReturnToTown` asks permission four times in one call
  (11825, 11835, 11848, 11855).
- Three radii for "in Main Town": 90 here (shared.js:10801,
  hunt-resume.ts:33, observations.ts:492, 517), 65 in death recovery,
  none for the Franky exit target (return-composition.ts:116-117).
- `anniversaryWithTimeout` is the general timeout helper outside anniversary
  (Town 10823, event exits 11648, 11655).
- Hard-coded merchant name `GoldMajesty` (12490; trades.ts:59).
- `eventInstanceAllowed` special-cases the reason string `manual travel`
  (attendance-limits.ts:120).

## 3. Fork differences

Fork ref af92de45; verified by reading the named fork lines.

- **Boss chase** (e990e787, 3ed84536, d22cec71): a new owner that hops realms
  for 7 bosses on a 60 s tick; it checks only `realmSwitchBusy`
  (fork boss-chase.ts:371-387). It reads raw selections, so it ignores
  follower inheritance, attendance limits and the dungeon gate.
- **Achievement Hunt** gates on any event session (fork application.ts:829-832);
  sessions exist for every member reporting a selected live event, attended
  or not. AH target switches go through monster-selection with `keepPolicy`,
  which still calls `skipManualEventOccurrences` (fork monster-selection.ts:76),
  so an automated switch marks live occurrences "manual travel".
- **Failed event leg chain** in shared-walk.ts: b0c4d1ef, 029f590b, 5c504443,
  653238e1, c5eacf1b, each patching the previous one on top of Ryan's
  retained failure.
- **Cipher patches**: da499b7b (`merchantEventCombat`, merchant sits out
  gathering), 7253caef, e9e4bda3 (2.4).
- **Event exit repair** cb210ad0: counts only the Town radius as returned; adds
  a fourth copy of the 90 radius.
- **Franky routines and auto tank** d6f67a97: boss-encounter layer with typeof
  guards; deaths counted by `joinedEvent`.
- **Console Pause** 9a34a4c1, 250c61e1: joins `returnCombatActive` behind a
  typeof guard (ledger 10).

## 4. Tests today

Label format: what it proves / what it does not cover / accuracy /
patch guard. Accuracy is "not reviewed" until the method's step 2 runs; the
labels come from each test's name and the code it exercises.

| Test file | Behaviours | Proves | Does not cover | Accuracy | Patch guard |
|---|---|---|---|---|---|
| e2e/live-event-pretravel.spec.ts | EVT-007 | walk events leave 2 min early | route-based lead; Hunt pause message | not reviewed | no, it pins the 120 s literal |
| e2e/live-halloween.spec.ts | EVT-007, 008, 020 | staging, deadline, Slenderman search on a native server | two live events at once | not reviewed | no |
| e2e/live-hunt-manual-event-override.spec.ts | EVT-024 | a manual move skips only the current occurrence | moves inside the event map; rejoin | not reviewed | no, it pins 2.1 as intended |
| scripts/tests/manual-event-override.test.cjs | EVT-024 | prejoin seeding | in-map moves | not reviewed | yes (d009eb22 fence) |
| e2e/live-event-entry-failure.spec.ts | EVT-025 | walk entry failures end the occurrence | join failures (2.2) | not reviewed | no |
| scripts/tests/franky-recovery.test.cjs | EVT-019, 021 | join retries, delayed arrival | coordinator join failure budget | not reviewed | partly |
| scripts/tests/coordinator-event-observation.test.cjs | EVT-012..016, 026, 033, 042 | admission, sessions, deferred phases, kiss fences | two live events (2.6) | not reviewed | many cases guard the 2.8 chain |
| scripts/tests/coordinator-event-routes.test.cjs | EVT-027, 049, 050 | acknowledgements and absence rules | in-map manual move | not reviewed | partly |
| scripts/tests/event-return.test.cjs | EVT-034 | every exit mechanism and retry | Main radius disagreement | not reviewed | no |
| scripts/tests/hunt-event-resume.test.cjs | EVT-032 | return into current Hunt | cancelled intent message (01) | not reviewed | no |
| e2e/live-october-events.spec.ts | EVT-036..040 | door tour, constrained Cipher solve, gathering | empty board with `minClues` 1 (2.4) | not reviewed | no |
| scripts/tests/anniversary-kiss.test.cjs | EVT-044 | featured hold, two approaches, buff recovery | combat event arriving mid-kiss | not reviewed | several guard timer patches |
| scripts/tests/merchant-events.test.cjs, merchant-anniversary-reservation.test.cjs | EVT-046 | merchant reservation and yield | gathering tools after yield (ledger 6) | not reviewed | no |
| scripts/tests/abtesting-routing.test.cjs, coordinator-abtesting-update.test.cjs | EVT-047 | feeder search, strategy persistence | live team play | not reviewed | no |

The full test list per behaviour is in `catalog/06-events.json` (269
distinct tests; command: the node one-liner in Gaps). No test covers EVT-010.
No test covers join failures (2.2), two live events (2.6), `minClues` on an
empty board (2.4) or a stale `joinedEvent` after escape and reload (2.9).

## 5. Needs your review

1. **Manual move during an event (2.1).** (a) Keep: any manual command leaves
   the occurrence for good. (b) Only a move whose destination leaves the
   event map, or an explicit "leave event" action, skips; moves inside the
   map keep attendance. (c) As (b) plus a "rejoin" button that clears the
   skip.
2. **Staging lead (2.3).** (a) Keep 120 s before spawn for every walk event.
   (b) Lead = planned route time plus a margin. (c) As (b), and staging does
   not pause Hunt until the walk actually starts.
3. **Join failures (2.2).** After a rejected `join`: (a) keep retrying every
   10 s; (b) back off and skip the occurrence after N failures (which N?);
   (c) skip at once when the game says the join window closed.
4. **Witch's Cipher (2.4).** (a) Default `minClues` to 0 and move the gate
   after affordability; (b) fighters keep gathering until `gather_end` while
   the merchant brews (per-role plan); (c) both.
5. **Two live events at once.** Today the selected priority list decides on
   the character, but the coordinator keeps one session per character
   (2.6). Should a member attend only its top event (the list), or may the
   party split across two events?
6. **Anniversary versus a combat event.** Today an event ranked above
   anniversary interrupts staging and featured holds but never an active kiss
   (13311-13331). Keep, or should a featured hold also be protected?

## 6. Gaps

`node tools/check-claims.mjs` run 2026-10-26 with all catalogs present at
that time (01, 03, 04, 05, 06, 07, 11, 13):

- Functions claimed by 06: 542 (424 from the 06 proposal, 32 triage, 86
  released to 06 by specs 04, 05, 07, 11 and 13). Command:
  `node -e "const c=require('./catalog/06-events.json');console.log(c.behaviours.flatMap(b=>b.functions).length)"`.
- Functions in the 06 proposal not claimed by 06: 8, all handed off
  (`catalog/handoffs-06.json`: 4 to 12, 4 to 01).
- Claimed by more than one spec involving 06: 0.
- Claims naming no known function: 0.
- Behaviours with no test: EVT-010.
- Requested from other specs, not claimed: 39 functions
  (`catalog/handoffs-06.json`, reason starting "Requested"), among them
  `eventTravelAllowed`, `nearestEventTarget`, `rejoinActiveEventAfterRespawn`,
  `dashboard/lib/event-policy.ts` and `http/hunt-control.ts` admission.
  Each behaviour cites them, but they stay with their specs until those
  specs release them.

Not yet verified:

- Test accuracy review (method step 2) for every test listed in the catalog.
- The 45-commit count in 2.8 (taken from the full review, not rerun).
- Game semantics of `cant_join` (no game source checked out).
- characters/shared.js `tick` (11114-11450) and `handleCommand`
  (10416-10991) hold event code but stay in triage; their event branches are
  cited above, not claimed.

## 7. M1

Design, what changes for the player, proof and migration: M1.
