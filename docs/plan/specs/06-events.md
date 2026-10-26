# 06 Events

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e) in
(local checkout). Every `file:line` below is on that
ref unless it says "fork" (af92de45, HEAD of the same checkout). Behaviour
ids are `EVT-001` onward; `catalog/06-events.json` lists the functions and
tests for each one. Evidence leads came from
`backups/party-console/review/full/events.md` (with Appendix A and B),
`review/events.md` and the bug ledger in `review/BRIEF.md`; this pass re-read
every claim on the current console. Line numbers differ from the reviews, which
cite the fork. A claim-by-claim check of this page is in
`docs/implementation/06-verification-01-06.md`.

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
- **Game server**: the local copy of the game server source at
  (local checkout) (commit
  43b2c8fc, 2026-10-21).

Bare `shared.js:N` and bare line numbers in a character-side item are
`characters/shared.js`. `events/`, `http/`, `status/`, `anniversary/`,
`navigation/` and `hunt/` are under `runtime/coordinator/`.

## 1. What it does today

### 1.1 Event catalog, clock and schedule

- **EVT-001 Event catalog.** The character treats every `G.events` key plus 8
  literal names as supported (`supportedEventNames`, shared.js:11471-11477).
  Separate literal lists decide the kind: `halloweenEvent` (4 names, 11479),
  `scheduledWalkEvent` (4 names, 11480), `eventRequiresJoin` (join unless a
  Halloween or October name, 12764-12769), `eventIsSupported` (12771-12775).
  `deriveEventMonsterTypes` (12744-12762) hard-codes the monster lists for
  Goobrawl, Graveyard and Horseman, and adds the `hp:` spawn adds from
  `G.monsters` for Mr. Green and Mr. Pumpkin (12754-12757); the Graveyard
  setting filters its list (12739-12740). The coordinator has its own
  catalog (`dashboard/lib/event-policy.ts:32-41`), with 14 names.
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
  (15 s, `events/schedule-reports.ts:25-50`) and computes Trick or Treat door
  counts per account (52-78).

### 1.2 Selection and the "may attend" answer

- **EVT-004 Selection.** On the character, `eventSelected` is the heartbeat's
  `eventSelections` list. Without a list it returns true for anniversary,
  and for every event while `eventsEnabled` is set (498), which is false
  until the first heartbeat (457, 11267). On the coordinator, a follower uses
  its leader's selections and priority order; the merchant also gets Witch's
  Cipher when the leader picked it (`dashboard/lib/event-policy.ts:43-70`).
  The heartbeat sends only selections whose occurrence is not exhausted
  (`application.ts:561`, `eventInstanceAllowed`). A selection change bumps
  `eventSelectionRevision` and queues a "pending disable" for each dropped
  event (shared.js:11263-11274).
- **EVT-055 Saved selection migration.** At startup, legacy all-events flags
  become explicit selections; explicit empty selections stay as saved
  (`characters/migrate-selections.ts`).
- **EVT-005 The enabled answer.** `eventsEnabledFor(name, event)` returns
  selected, then not exhausted, then `dungeons.eventAllowed` (application.ts:
  1236-1242). The dungeon step gets a flag that is true when the member
  reports the event live or staging within 3 s (`liveEventFor`, 1229-1234).
  The dungeon step can retire a held visit or dispatch a Cave exit
  (`dungeons/service.ts:241-253`), so this question writes state; 01 GRP-018
  owns that gate.

### 1.3 Live and staging reports

- **EVT-006 Live report.** The character lists every supported event that is
  live in `S`, with an instance id taken from the first of id, event_id,
  round, start, end or expires (`rawServerLiveEvents`, 11548-11567). A
  Halloween event also needs a current feed and `live: true` (11557-11558).
  For the two October events it calls `octoberRuntime().activity()` instead,
  only when selected, which can save a gathering plan (11555).
- **EVT-007 Character staging.** For Mr. Green, Mr. Pumpkin, Horseman and
  Graveyard, `halloweenAttendance` opens a staging window from 120 s before to
  120 s after the announced spawn, taken from `S` or the calendar
  (11508-11537; literals at 11519 and 11532). It writes `halloweenStages` and
  resets the Slenderman search as it goes. Staging entries for selected
  events go out as `serverStagingEvents` (11539-11546, 2989).
- **EVT-008 Coordinator staging.** A staging report is valid for those 4
  names, within 120 s of spawn, and only if the character joined it or was
  admitted before joining (`events/observations.ts:147-162`). It creates a
  staging session with a fixed spawn id (163-188). While a staging session
  lasts (spawn + 120 s, still announced in fresh reports) the event does not
  end (396-399, 408-414). The 120 s literal sits on 5 lines across the two
  sides: shared.js:11519, 11532, observations.ts:161, 398 and
  application.ts:1696 (command:
  `git grep -n 120000 refs/review/ryan-1.5 -- characters/shared.js runtime/coordinator/events/observations.ts runtime/coordinator/application.ts`,
  which also prints 4 unrelated lines: shared.js:5498, 15316, 15326, 15331).

### 1.4 Choosing the event

- **EVT-009 Event choice (character).** `activeCombatEvent` (12869-12911):
  clears a manual suppression whose `S` entry is gone, `live: false` or has
  a new id (12871-12878); October events come from `activity()`
  (12880-12881); walk events need an open attendance window; other events
  need `S` present and not `live:false`, or a party hint, or visible Goo on
  goobrawl (12884-12900). A pending anniversary visit hides any event the
  user ranked below anniversary (12889-12898). The list sorts by selected
  priority, then "current map or joined", then earliest end (12903-12910). 37
  call sites read it (command: `grep -o 'activeCombatEvent()' shared.js | wc -l`
  gives 38, one is the declaration).
- **EVT-010 Party hint.** The coordinator takes the first active member,
  the recipient included, that is enabled and reports any live event the
  recipient may attend, and names the first selected event that this member
  lists live (`status/response.ts:142-155`, `partyEventHint` at 282).
- **EVT-011 Event pending flag.** The character reports `huntEventPending`
  when an event is active or an anniversary visit is due within 90 s
  (11899-11911); the Hunt turn-in waits for it (01 GRP-009).

### 1.5 Admission

- **EVT-012 Admission.** Before each travel step the character calls
  `eventTravelAllowed`: no Cave, merchants always yes, no Hunt turn-in and no
  non-preemptible convoy, then POST `/hunt-event-permission` (11913-11926).
  The route allows unless the member is in the event return, Hunt owns a
  turn-in, or navigation is cancelled (`http/hunt-control.ts:68-71`), then
  calls `observations.authorize` and opens a hunt event trip (72-83).
  `authorize` hands off an open anniversary cycle, records participation,
  copies anniversary waypoints, adopts deferred members and persists
  (`events/observations.ts:244-259`). A permission request is therefore a
  write. 16 character call sites ask (command:
  `grep -n 'eventTravelAllowed(' shared.js`, lines 11825, 11835, 11848, 11855,
  11932, 11941, 11946, 12082, 12240, 12311, 13317, 13381, 13402, 13416,
  13732, 13743); the kiss posts begin and end directly (12264-12266,
  12445-12447).
- **EVT-013 Live sessions.** Each enabled character that reports an event live
  gets a session holding the checkpoint and waypoints captured at its start
  (`reportLive`, `liveSession`, `sessionSnapshot`, observations.ts:93-144).
  Sessions are keyed by character name.
- **EVT-014 Observation order.** Every heartbeat runs attendance limits,
  then the scope's event observer (`application.ts:1081-1084`). The
  observer runs, in this order: live sessions, staging, observed
  participation, anniversary handoff, released members, ended return, stale
  members, deferred resume (`observe`, observations.ts:581-596).
- **EVT-015 Hunt event trips.** An admitted departure opens a trip per
  character, or reuses the open trip for the same event
  (`events/hunt-trip.ts:12-28`, cap 32). A trip ends when an event return
  or a deferred return completes (`events/hunt-resume.ts:62`,
  `events/hunt-return.ts:101`, `events/acknowledgements.ts:44, 61`), when a
  trip for another event begins (hunt-trip.ts:21), when a finished
  anniversary return is reconciled (`http/hunt-control.ts:47`,
  `events/observation-composition.ts:88`), or when an expired anniversary
  yields to Hunt (`hunt/expired-anniversary.ts:23`). Deaths during a trip
  count for the event, not the Hunt; when no trip is stored at all,
  shared.js:616-622 builds one from `joinedEvent`.
- **EVT-016 Assisted participation.** A character whose live, local target
  is Mr. Green, Mr. Pumpkin or Slenderman counts as attending without the
  join flag, when that event is in its own live reports
  (observations.ts:546-579). The code does not check Follow; the comment at
  576-577 names a following fighter as the case.

### 1.6 Travel and joining (character)

- **EVT-017 pollEvents.** A 10 s timer (shared.js:17358), a startup call
  (17357) and 7 immediate kicks run `pollEvents` (13280-13428). Order: Cave,
  maintenance, escape, busy, Hunt turn-in and non-preemptible convoy guards
  (13281-13285); the merchant cancels gathering and closes its stand
  (13288-13301); an event outranks anniversary staging but never an active
  kiss (13311-13331); `joinedEvent` is rebuilt from the current map
  (13335-13340); with no event, a joined event missing for 10 s is reported
  with `/event-ended` (13342-13370). Otherwise it sets targets (none while
  staging, 13373), asks permission (13381), and either joins (13401-13407),
  runs the October interaction (13414), searches for Slenderman (13415) or
  walks with the shared walk (13416-13417). For walk events `joinedEvent` is
  set before the walk starts (13408-13413). Failures are only logged
  (13418-13421).
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
  `rejoinActiveEventAfterRespawn` (`runtime/characters/roles/runner.ts:76-78`;
  shared.js:13721-13759), a second travel owner beside pollEvents guarded by
  the same `eventTraveling` flag.
- **EVT-022 Event combat support.** Target reachability (12930-12935), boss
  sighting in the heartbeat with a Cipher gather exception (12937-12953),
  Goobrawl aggressive mode (13049-13052). Target choice itself
  (`nearestEventTarget`, 12955-13047) is claimed by spec 04.

### 1.7 Attendance, limits and manual skips

- **EVT-023 Attendance limits.** One `AttendanceInstance` per character per
  event occurrence, matched by native id or "not ended" on the realm
  (`events/attendance-limits.ts:43-67`). Attending time and deaths during
  attendance are counted (69-99). Over the death or time limit the instance
  is `ignored` until the occurrence ends (81-85, 101); it ends 10 s after it
  leaves the report (86-91). `eventInstanceAllowed` blocks a character whose
  own instance is ignored, or whose leader's instance is ignored for any
  reason except manual travel (116-121).
- **EVT-024 Manual-move skips.** Manual travel commands mark each live
  occurrence the actor is in as `ignored:'manual travel'` (unless a stronger
  reason is already set) and `manualTravel:true`, and seed an instance for an
  admitted pre-join (160-177). Callers: `navigation/manual-commands.ts:79,
  96, 109, 126, 144`, `http/party-actions.ts:68, 108`,
  `navigation/monster-selection.ts:69` (command:
  `git grep -n skipManualEventOccurrences refs/review/ryan-1.5 -- runtime`).
  A party travel with `resumeAfterEvent` skips none (manual-commands.ts:95-96).
  A skipped occurrence cannot install a competing return (180-185,
  `http/event-recovery.ts:64, 85`).
- **EVT-025 Failed entry.** A retry-exhausted event shared walk becomes a
  forced return with the saved checkpoints, and every walker's instance is
  marked `travel failure` (`events/failed-entry.ts:51-66`). Only walks reach
  this path (14-18).

### 1.8 Returns

- **EVT-026 Event end.** An event ends when no staging session holds it, no
  enabled member reports it live, Goobrawl is not still fighting, and 10 s
  passed since the last live report (`events/observations.ts:387-406`).
  Members that have another live event carry their checkpoint into it
  instead of returning (416-432, 337-355).
- **EVT-027 Party return.** `state.eventReturn` (`events/returns.ts`): begin
  or reuse a return (194-212; a same event within 60 s does not restart,
  78-84), Town commands to each participant (130-135), wait for every
  member, then dispatch the leader's checkpoint convoy (226-241) and complete
  (214-221). The dispatch waits while the anniversary holds, any convoy runs
  or the Town cycle is busy (231), so an escape-recovery or death-recovery
  convoy also holds it. The return reads neither escape nor death recovery,
  so the escape stages and recovery phases that run without a convoy do not
  hold it (spec 01 table 1.3). Each tick reconciles orphan commands, Goobrawl, lost
  anniversary handoffs, policy, Hunt handoff, walk repair, obsolete walks, a
  new anniversary round, deferred members, participants, the Franky exit,
  commands and progress, in that order (298-317). Consumed idle exits get a
  new Town command (334-353). Beginning an A/B testing return clears the A/B
  strategy (207).
- **EVT-028 Return policy.** A farming mode change during a return re-targets
  the saved checkpoint for members still on that revision, once no member is
  still pending (`events/return-policy.ts:5-33`, the pending check at 7).
- **EVT-029 Return walk repair.** A failed return walk is cancelled and its
  members re-issued Town, unless a merchant command is in flight
  (`events/repair-return-walk.ts:15-52`).
- **EVT-030 Goobrawl wait.** No return starts, and a started one is dropped,
  while any fresh member still fights on goobrawl
  (`events/return-guards.ts:13-23`, returns.ts:66-76, 166-168).
- **EVT-031 Franky exit.** A Franky return first walks remote members to
  Main (0,0) as a `franky-exit` convoy, with a walking fallback after a failed
  Town (returns.ts:86-128, `events/return-composition.ts:116-117`).
- **EVT-032 Return into Hunt.** With Hunt selected, the return finishes into
  the current Hunt once every member is fresh, out of the event map, at Main
  within 90 or acknowledged, and owns its command (`events/hunt-resume.ts:13-89`);
  this path writes `monsterHunt.stage`, `convoyId` and `message` (80-82).
  During a Hunt Daisy return it hands over to that journey instead
  (`events/hunt-return.ts:25-111`), which writes `message` and `convoyId`
  (87, 93) and waits while escape or death recovery runs (46-49).
- **EVT-033 Deferred returns.** A member released to another live event, or
  silent for 10 s after a 30 s old return, becomes a per-member deferred
  return (observations.ts:357-385, 441-463) that goes Town then checkpoint
  on its own (489-544, `events/acknowledgements.ts:35-67`). A later admission
  adopts its checkpoint and pulls its fresh peers along (260-291). Deferred
  records are root-wide, not scoped (01 GRP-002).
- **EVT-034 Character exit.** `event-return-town` takes movement, clears
  `joinedEvent`, leaves the event map (goobrawl transporter, abtesting or
  ship0 `leave` then transport, 3 attempts), walks or Towns until Main within
  90, with a 45 s deadline and 2.5 s retry (shared.js:10754-10860,
  11633-11743). Each heartbeat sets `__partyEventRecoveryCycleId` from
  `eventReturnCycleId` and cancels an exit owner of another cycle, fenced by
  timestamp because both the fast transport path and the tick call it
  (10302-10324, 3259, 11206; `status/response.ts:172-177`).
- **EVT-035 Rendezvous.** Event walks go through the shared walk, which owns
  rendezvous and coalescing (`navigation/shared-walk.ts`, spec 02). No
  function is claimed here.
- **EVT-049 Acknowledgement routes.** Town complete, return complete, resume
  complete and engagement stamps (`http/event-acknowledgements.ts`).
- **EVT-058 Return progress.** The character writer `saveReturnPhase`
  (shared.js:11024-11031) and the `/return-progress` route
  (`http/return-progress.ts`) keep each member's return phase per cycle and
  navigation revision; event exits, Town returns and escapes use it.
- **EVT-050 Disable and ended routes.** Deselecting an event starts a forced
  return for its real participants; for anniversary the leader's deselection
  aborts the round and a follower's returns only that member
  (`http/event-recovery.ts:39-96`). `/event-ended` starts a return only after
  10 s of absence with nobody inside (108-126). On the character the pending
  disable stops movement unless a convoy, force travel, Town, event exit or
  reunion owns it, then posts `/event-disabled` (shared.js:11288-11295).

### 1.9 October runtime (Trick or Treat, Witch's Cipher)

- **EVT-036 Door route.** Fixed order `[1,0,5,6,2,3,4]`
  (`runtime/events/october.ts:79`), walk to each door +40 y, knock within
  75, record knocked and limit replies (`runtime/events/october-runtime.ts:111-132`).
- **EVT-060 Door order planner.** A development tool
  (`tools/game/plan-trick-or-treat.mts`) computes that order; october.ts:76-78
  names the command and the route length.
- **EVT-037 Cipher plan.** One owner (the leader when it selected Cipher)
  picks a party-wide plan from a fresh shared stock: gather the scarcest
  ingredient, or brew once every count is above zero, or finished after
  `gather_end` (october-runtime.ts:44-77; brewing chosen at 63-65). The
  coordinator builds the shared stock and owner (`status/response.ts:63-93`).
- **EVT-038 Activity and destination.** `activity()` returns a gather-monster
  event in gathering mode and an interaction for every member otherwise
  (81-99; 98), writing `phase` and `detail` as it goes. Destination is the
  gather spawn or the Witch (+30 y) (100-109; shared.js:479-480).
- **EVT-039 Brewing.** Every member's Cipher run first hands its ingredients
  to the merchant when the merchant is within 350 (october-runtime.ts:147;
  shared.js:481-490, which does nothing for the merchant itself); then only
  the merchant goes on (149). The merchant settles an earlier unconfirmed
  brew, checks the daily limit and realm, walks to the Witch, waits for
  `minClues` clues (default 1, october.ts:27; gate at october-runtime.ts:159
  and 168), solves (minimax over 1,024 recipes, october.ts:51-69), checks
  affordability (175-183), then brews with a journal that never replays an
  unknown outcome (134-145, 188-201). Errors wait 15 s (203-209).
- **EVT-040 Character ports.** `octoberRuntime` builds one runtime with clock,
  stock, journal in localStorage, knock, brew, Witch point, and an
  ingredient transfer to the Cipher merchant within 350 (shared.js:460-493).

### 1.10 Anniversary

- **EVT-041 Live round.** The coordinator picks the active schedule from the
  leader's realm, updates the cycle, and sets a party hold when the leader
  or a follower is featured (`anniversary/live.ts:8-91`).
- **EVT-052 Public snapshot and initial state.** The round, return and count
  view that the heartbeat and dashboard read (`anniversary/snapshot.ts`,
  `anniversary/snapshot-composition.ts`, `application.ts:1351`), and the
  empty state a fresh coordinator starts from (`anniversary/initial-state.ts`).
- **EVT-042 Combat handoff.** Kiss operations (180 s expiry) block a combat
  departure until they end (observations.ts:190-243). An admitted combat
  departure or a joined report hands the anniversary cycle to the event
  return (220-238, 293-318); the return then owns the way home.
- **EVT-043 Anniversary return.** Dispatch after all visits, after the
  one-minute featured hold, at window end, or after a skipped round
  (`anniversary/returns.ts:13-156`).
- **EVT-053 Round abort.** A second failed approach for a target-missing,
  target-unreachable, kiss-timeout or kiss-unconfirmed report skips the
  round, unless the report is for a stale round or stale navigation
  (`anniversary/abort.ts:93-108`).
- **EVT-054 Hand back to Hunt.** A finished visit hands back to the current
  Hunt once every participant is fresh, out of combat and owns its command,
  and no event return or Town cycle runs (`anniversary/hunt-handoff.ts:18-68`).
- **EVT-044 Character staging and kiss.** 1 s tick (`runAnniversaryTick`,
  12632-12639, timer at 17360): preempt a farming convoy, stage at Main,
  report staging and return-ready, travel to the featured player with two
  approaches, kiss (8 s timeout, 12346), confirm by slice or buff, recover a
  consumed ticket, abort a skipped round (11824-11991, 11993-12451).
- **EVT-059 Timeout helper.** `anniversaryWithTimeout` (shared.js:11802-11822)
  rejects a game call after a deadline without cancelling it. Its name is
  historical: 33 of its 36 calls sit outside the anniversary code
  (shared.js:11774-12639), in escape (44-272), the Cave (2647, 2677, 2731),
  merchant and commerce jobs (5288-9515), Town (10823, 11019), event exits
  (11648-11717), the reunion (13687-13709) and convoy rendezvous (15316,
  15331) (command: `grep -n 'anniversaryWithTimeout(' shared.js` gives 37
  lines, one the declaration).
- **EVT-045 Slices.** Fighters send slices to the merchant (falls back to the
  name `GoldMajesty`, 12490); the merchant collects, swaps 1:1 with other
  players, returns owed slices and advertises (12453-12630; coordinator
  handoffs, slices, trades, supplies).
- **EVT-051 Anniversary routes.** Staging, return-ready, preempt, attempt,
  failure, claim, handoff, trade, chat and supplies routes
  (`http/anniversary-*.ts`).

### 1.11 Merchant, A/B testing, Franky

- **EVT-046 Merchant reservation.** The merchant is reserved while joined,
  travelling, returning, under coordinator recovery, or while a selected
  event is live or staging (shared.js:11601-11604); merchant jobs are
  deferred (10475-10481) and a running job checkpoints with `merchant_yield`
  (11606-11615). Anniversary control adds featured, kiss-due and busy holds
  (11617-11631, application.ts:847-850, 1668-1678).
- **EVT-056 Merchant event combat.** The merchant fights while it has
  joined a selected event, no event exit runs and no merchant job is active
  (`merchantEventCombatActive`, shared.js:17481-17484).
- **EVT-047 A/B testing strategy.** Teams resolve to uniform, balanced or
  split with sabotage feeders after 20 s or once every expected member
  reports a team (`events/abtesting.ts:78-101`, 20 s at 22).
- **EVT-057 A/B testing on the character.** Team lookup, enemy spawn,
  opponent choice and the feed or pending mode (shared.js:13054-13113; the
  sabotage loop at 13158 is claimed by spec 03).
- **EVT-048 Franky attendance.** Franky combat runs while selected and joined
  or on its map, unless any of 14 other owners holds the character
  (12915-12922).

## 2. What goes wrong

Each item: cause chain on the current console, then patches. "Inference" marks what
the code alone does not prove.

### 2.1 Manual move ends the round for that character (ledger 14 family)

1. A manual command calls `skipManualEventOccurrences`
   (`navigation/manual-commands.ts:79`, etc., EVT-024); only a party travel
   with `resumeAfterEvent` skips nothing (95-96).
2. The live occurrence becomes `ignored:'manual travel'`
   (`events/attendance-limits.ts:166-168`).
3. `eventInstanceAllowed` turns false (116-121), so the heartbeat drops the
   event from `eventSelections` (application.ts:561).
4. The character's pending disable stops movement, posts `/event-disabled`
   and clears `joinedEvent` (shared.js:11288-11295). Inference: a plain
   `character-travel` (10861-10866) has none of the exempt flags, so the stop
   can cancel the user's own move.
5. `/event-disabled` sees the manual skip and only deletes the member's
   session (`http/event-recovery.ts:85-87`), and `ended()` skips the member
   because it is no longer enabled (observations.ts:388); no return starts.
Patches: upstream commit d009eb22 made this the rule. No later patch.

### 2.2 Join failures have no owner ("cant_join" every 10 s)

1. `activeCombatEvent` keeps returning a join event while `S` lists it
   (12899-12900).
2. pollEvents asks permission (a write, EVT-012) at 13381 and 13402.
3. `join()` rejects; pollEvents logs "Event travel failed" (13418-13421).
4. Nothing reports the failure; `events/failed-entry.ts` accepts only walks
   (14-18). The heartbeat keeps reporting the event as `activeEvent`
   (2864, 2987), so Hunt stays paused (01 GRP-011), and the open trip
   keeps leaving Hunt from starting its farming convoy (`hunt/mode.ts:55-61`).
What the game's reply means (game server `node/server.js:12641-12711`):
the `join` handler refuses merchants (`no_merchants`, 12647), hop-sick
characters (`cant_when_sick`, 12650) and characters in the bank
(`cant_in_bank`, 12653). It refuses A/B testing more than 120 s after the
start for a character not already in this round (`join_too_late`,
12683-12687). It replies `cant_join` when the server's own event flag for
that name is off, or when the name has no join branch (12709). The server
clears that flag and the `S` entry together when a join event ends
(`node/server_functions.js:2571-2573, 2582-2584, 2627-2628, 2888-2890`).
Inference: `cant_join` while the character's `S` still lists the event
means its copy of `S` is stale. No patch.

### 2.3 Staging claims the party at spawn minus 120 s (ledger 14)

1. `halloweenAttendance` opens at spawn-120 s (11532).
2. `activeCombatEvent` returns the staging entry; the heartbeat reports it as
   `activeEvent` (2864, 2987).
3. pollEvents sets `joinedEvent` and starts the walk at once (13408-13417).
4. Every Hunt copy of "at an event" fires (01 GRP-013), so Hunt pauses and
   cancels its convoy (`hunt/travel.ts:15-28`).
5. The lead is a literal, not route time plus a margin (5 lines, EVT-008).
Patch: the integration notes for PR #151 excluded a proposed timeout-driven
forced return (upstream `docs/pr-151-integration.md:7`). The code does not
prove "several minutes early".

### 2.4 Witch's Cipher deadlock and idle fighters (ledger 2)

- Merchant: `minClues` defaults to 1 (october.ts:27) and the gate runs before
  the solver and the affordability branch (october-runtime.ts:159, 168, 175).
  The solver works with zero clues (october.ts:51-69). With an empty realm
  board the merchant waits "waiting for clues" until another player on the
  realm brews a mix; inference: on a quiet realm that never happens. The
  user can set 0 (`dashboard/lib/event-policy.ts:14`).
- Fighters: the runtime chooses brewing once every ingredient count is above
  zero (october-runtime.ts:63-65) though a mix uses five, and brewing mode gives
  every member the Witch interaction (98). The e9e4bda3 message reports the
  fighters stood at the Witch for the whole drop window.
Patches: fork da499b7b (merchant sits out gathering), 7253caef (restricted
maps last), e9e4bda3 at 21b8362d (`stockedGatherType`, fighters gather in a
stocked round). `minClues` is untouched.

### 2.5 Reads that write

`activeCombatEvent` clears suppression (12871-12878) and through its callees
writes `halloweenStages`, the Slenderman search and the October journal and
phase (11508-11537, october-runtime.ts:33-42, 44-77, 81-99). The heartbeat
alone reaches `activity()` through 3 paths (2864 via `activeCombatEvent`,
2865 via `rawServerLiveEvents` at 11555, 3053 via `eventCombatSighting` at
12939). `authorize` writes on a permission request (EVT-012).
`eventsEnabledFor` can retire or exit a Cave visit (EVT-005). Call order then
decides state.

### 2.6 One session slot per character

`reportLive` keys sessions by character (observations.ts:138-144). With two
enabled live events, each heartbeat replaces A's session with a fresh B
session, then `participate` rebuilds A for a joined member with a new
snapshot (585-590). Each rebuild persists (143, 136), so one heartbeat
persists up to three times. Inference (impact): prejoin authorization and the
checkpoint captured before the event are lost while both are live.

### 2.7 Event knowledge as name lists and literals

Kinds, monster lists, staging names and fixed points live in at least 8
literal lists on the character (EVT-001, EVT-007, EVT-018) and 4 on the
coordinator (observations.ts:159, 550; application.ts:1688;
event-policy.ts:32-35), plus Goobrawl, Franky and abtesting cases in
returns.ts (66-76, 96-128, 207). The October names appear as literals at
shared.js:11473, 11480, 12767, 12774 and event-policy.ts:35.

### 2.8 Deferred return fix chain

The deferred return is a second return machine per member beside
`eventReturn`, and both race with new admissions. The current 2026-10-08..14
chain of event return and admission fixes: 5487c9f0, 9264b7f5, 7d3c5c1b,
0f07fd0b, dce39092, ea49a71a, 0a85cb1e, f781044d, b012e091, a6b0307d,
d009eb22, 545ca932 (each changes `events/` files, `git show --stat`). The
deferred phases are `awaiting-event-handoff`, `awaiting-reconnect`,
`awaiting-event-admission` (added by b012e091), `returning-to-checkpoint` and
`returning-to-town` (observations.ts:371, 455, 480-481, 542). Command for the
history:
`git log --oneline --since=2026-09-15 refs/review/ryan-1.5 -- runtime/coordinator/events runtime/coordinator/hunt runtime/hunt runtime/events runtime/coordinator/http/hunt-control.ts | wc -l`
gives 45.

### 2.9 Stale joinedEvent

16 lines match `grep -nE "joinedEvent = [^=]" shared.js`: 15 writes and the
declaration at 552. Escape clears only the local copy (237), so a reload
restores the event from `root.__partyJoinedEvent` (552), and death
attribution (619, when no trip is stored) and Hunt (01 GRP-013) read a
finished event.

### 2.10 Smaller findings

- Manual suppression clears itself for events whose `S` entry is missing or
  `live: false` (12874-12877), so a manual monster override during staging
  or a door round lasts one call (inference for the `S` shape).
- `anniversaryReturnToTown` asks permission up to four times in one call
  (11825, 11835, 11848, 11855; 11848 only on a joinable event map).
- Three radii for "in Main Town": 90 here (shared.js:10801,
  hunt-resume.ts:33, observations.ts:492, 517), 65 in death recovery,
  none for the Franky exit target (return-composition.ts:116-117).
- `anniversaryWithTimeout` is the general timeout helper outside
  anniversary (EVT-059).
- Hard-coded merchant name `GoldMajesty` (12490; trades.ts:59 in a message;
  also `merchant/initial-runtime.ts:36` as the default merchant and
  `http/anniversary-commerce.ts:187` in a log line).
- `eventInstanceAllowed` special-cases the reason string `manual travel`
  (attendance-limits.ts:120).

## 3. Fork differences

Fork ref af92de45; verified by reading the named fork lines.

- **Boss chase** (e990e787, 3ed84536, d22cec71): a new owner that hops realms
  for 7 bosses (fork events/boss-chase.ts:14) on a 60 s tick (90); its tick
  checks only `realmSwitchBusy` (371-387), and the realm hop blacklist
  from d22cec71 at hop time. It reads raw selections (fork
  application.ts:1237-1241), so it ignores follower inheritance, attendance
  limits and the dungeon gate.
- **Achievement Hunt** gates on any event session (fork application.ts:829-832);
  sessions exist for every member reporting a selected live event, attended
  or not. AH target switches go through monster-selection with `keepPolicy`,
  which still calls `skipManualEventOccurrences` (fork monster-selection.ts:76),
  so an automated switch marks live occurrences "manual travel".
- **Failed event leg chain** in shared-walk.ts: b0c4d1ef, 5c504443,
  653238e1 and c5eacf1b, each patching the previous one on top of the
  current retained failure; 029f590b between them is a lint refactor with
  no behaviour change (its message).
- **Cipher patches**: da499b7b (`merchantEventCombat`, merchant sits out
  gathering), 7253caef, e9e4bda3 (2.4).
- **Event exit repair** cb210ad0: counts only the Town radius as returned
  (fork events/repair-return-walk.ts); adds a fifth copy of the 90 radius.
- **Franky routines and auto tank** d6f67a97: boss-encounter layer with typeof
  guards (20 added `typeof` lines); deaths counted by `joinedEvent`.
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
| scripts/tests/cave-return-progress.test.cjs | EVT-058 | return progress per cycle and revision, exit attempt budget | anniversary returns | not reviewed | no |
| scripts/tests/event-return.test.cjs | EVT-034 | every exit mechanism and retry | Main radius disagreement | not reviewed | no |
| scripts/tests/hunt-event-resume.test.cjs | EVT-032 | return into current Hunt | cancelled intent message (01) | not reviewed | no |
| e2e/live-october-events.spec.ts | EVT-036..040 | door tour, constrained Cipher solve, gathering | empty board with `minClues` 1 (2.4) | not reviewed | no |
| scripts/tests/anniversary-kiss.test.cjs | EVT-044, 059 | featured hold, two approaches, buff recovery, kiss timeout | combat event arriving mid-kiss | not reviewed | several guard timer patches |
| scripts/tests/farming-navigation.test.cjs (abort cases) | EVT-053 | abort persists, stale reports cannot abort | a first failed approach | not reviewed | no |
| scripts/tests/merchant-events.test.cjs, merchant-anniversary-reservation.test.cjs | EVT-046, 056 | merchant reservation, yield and event attacks | gathering tools after yield (ledger 6) | not reviewed | no |
| scripts/tests/abtesting-routing.test.cjs, coordinator-abtesting-update.test.cjs | EVT-047, 057 | feeder search, strategy persistence | live team play | not reviewed | no |

The full test list per behaviour is in `catalog/06-events.json` (270
distinct tests; command: the node one-liner in Gaps). No test covers EVT-010
or EVT-060. No test covers join failures (2.2), two live events (2.6),
`minClues` on an empty board (2.4) or a stale `joinedEvent` after escape and
reload (2.9).

## 5. Needs your review

1. **Manual move during an event (2.1).**
   **Today:** most manual commands mark the actor's live occurrence "manual
   travel" for the rest of the occurrence (`navigation/manual-commands.ts:79,
   109, 126, 144`, `http/party-actions.ts:68, 108`,
   `navigation/monster-selection.ts:69`); only a party travel with
   `resumeAfterEvent` skips nothing (95-96). The character then stops and
   leaves, and no return starts (2.1). In the fork, automated AH target
   switches take the same path (fork monster-selection.ts:76).
   **Options:**
   (a) Keep: any manual command leaves the occurrence for good. Negatives:
   repositioning inside the event map ends the round for that character;
   AH switches in the fork count as manual.
   (b) Skip only for a move whose destination leaves the event map, or an
   explicit "leave event" action. Negatives: each command needs a
   destination map check; a misclick that leaves the map still costs the
   round.
   (c) As (b), plus a "rejoin" button that clears the skip. Negatives: one
   more control; rejoin must clear only `manual travel`, never a death or
   time limit (`events/attendance-limits.ts:81-85`).
   **Recommendation:** (c). Moves inside the event keep attendance, leaving
   still ends it, and the user can undo a mistaken leave. It beats (a)
   because (a) drops the round without asking, and beats (b) because (b)
   has no way back from a misclick. Automated callers such as the fork's AH
   do not use the manual skip. Negatives: a button and a check
   per command.
2. **Staging lead (2.3).**
   **Today:** staging opens 120 s before spawn for every walk event, a
   literal on 5 lines (EVT-008), and the walk starts at once (13408-13417).
   **Options:**
   (a) Keep 120 s for every walk event. Negatives: Hunt and farming stop for
   the whole lead even when the spawn is close; a far spawn gets the same
   lead as a near one.
   (b) Lead = planned route time plus a margin. Negatives: needs a route
   time estimate from the planner; the coordinator's staging checks
   (observations.ts:161, 398, application.ts:1696) must follow the new
   lead.
   (c) As (b), and staging does not pause Hunt until the walk
   starts (spec 01 question 2). Negatives: as (b), and Hunt must stop
   cleanly mid-mission when the walk starts.
   **Recommendation:** (c). The party leaves when it has to and keeps
   farming until then. It beats (a) because the waiting time is not lost,
   and beats (b) because (b) alone still pauses Hunt for the whole new lead.
   Negatives: a wrong route estimate makes the party late, so the margin
   needs a measured value. A ChronAL E2E scenario per walk event measures
   it: seconds between arrival at the spawn and the spawn time, with the
   threshold "at the spawn before it opens".
3. **Join failures (2.2).**
   **Today:** a rejected `join` is logged and retried on the next 10 s poll
   (13418-13421, 17358), and each try asks permission, which writes
   (EVT-012). The game's server source defines its replies: `cant_join`
   means the server has no running event of that name, `join_too_late` ends
   A/B testing entry 120 s after the start, and `cant_when_sick`,
   `cant_in_bank` and `no_merchants` describe the character (2.2).
   **Options:**
   (a) Keep retrying every 10 s. Negatives: an endless log line; Hunt stays
   paused while the character still reports the event; a permission write
   every 10 s.
   (b) Back off and skip the occurrence after N failures. Negatives: N has
   to be picked; a short hop sickness can cost the round.
   (c) Skip the occurrence at once for `cant_join` and `join_too_late`, and
   retry with a back-off for `cant_when_sick` and `cant_in_bank`.
   Negatives: depends on the game's reply strings, which can change; the
   reply has to reach the coordinator.
   **Recommendation:** (c). `cant_join` and `join_too_late` cannot change
   during the occurrence (the server clears the event and its `S` entry
   together), so retrying them only repeats the failure, while the other
   replies can clear. It beats (a) because it ends the loop, and beats (b)
   because it does not wait N tries for a reply that is already final.
   Negatives: an unknown reply string falls back to (b)'s back-off, so (b)
   is still needed as the default.
4. **Witch's Cipher (2.4).**
   **Today:** `minClues` defaults to 1 and its gate runs before the solver
   and the affordability check (october.ts:27; october-runtime.ts:159, 168,
   175). Brewing mode starts once every ingredient count is above zero and
   gives every member the Witch interaction (63-65, 98). The fork at
   21b8362d (e9e4bda3) sends fighters to gather in a stocked round.
   **Options:**
   (a) Default `minClues` to 0 and move the gate after affordability.
   Negatives: on an empty board the first mix is a guess (the solver still
   picks the most informative one).
   (b) Fighters keep gathering until `gather_end` while the merchant brews
   (a plan per role). Negatives: two plans to keep in step; fighters keep
   farming ingredients the merchant may not need.
   (c) Both. Negatives: the negatives of both.
   **Recommendation:** (c). (a) removes the merchant's wait on an empty
   board and (b) removes the idle fighters; each fixes a different half of
   2.4, so either alone leaves one half broken. Negatives: the first mix of
   a quiet realm is spent without clues, and extra ingredients pile up in
   the merchant's inventory.
5. **Two live events at once.**
   **Today:** the character picks one event by selected priority
   (12903-12910), but the coordinator keeps one session per character and
   rebuilds it each heartbeat when two are live (2.6).
   **Options:**
   (a) Each member attends only its top event, with sessions kept per
   character and event so the second event no longer overwrites the first.
   Negatives: a lower-priority event is skipped even when one member would
   be enough for it.
   (b) The party may split across two events. Negatives: needs a session,
   return and checkpoint per event per member; a split party loses its
   healer on one side; more deaths.
   **Recommendation:** (a). It keeps the party together and removes the
   data loss in 2.6. It beats (b) because (b) multiplies the return
   machinery that 2.8 shows is already fragile. Negatives: the lower event
   is missed when both are live.
6. **Anniversary versus a combat event.**
   **Today:** an event ranked above anniversary interrupts anniversary
   staging and the featured hold, which runs as staging (12166-12168,
   12204), but never an active kiss (13311-13331), and the coordinator
   blocks a combat departure while a kiss is registered
   (observations.ts:214-228). An event ranked below anniversary is hidden
   while a visit is pending (12889-12898).
   **Options:**
   (a) Keep. Negatives: a featured character can leave the square during
   its one-minute hold when a higher event starts.
   (b) Also protect a featured hold. Negatives: the party reaches the combat
   event up to one minute late.
   **Recommendation:** (a). The user already sets this order with the
   priority list: ranking anniversary above the event protects the hold
   today. It beats (b) because (b) overrides that list for one case.
   Negatives: a user who ranked the event higher by mistake loses the
   featured hold.

## 6. Gaps

`node tools/check-claims.mjs` run 2026-10-26 after the verification split
(all catalogs present):

- Totals: 9,421 functions, all claimed; claimed by more than one spec: 0;
  claims naming no known function: 0.
- Functions claimed by 06: 558 in 60 behaviours; 270 distinct tests.
  Command:
  `node -e "const c=require('./catalog/06-events.json');console.log(c.behaviours.flatMap(b=>b.functions).length, new Set(c.behaviours.flatMap(b=>b.tests)).size)"`.
  The verification moved `activeCoordinatorNames` to 01 GRP-001.
- Behaviours with no test: EVT-010, EVT-060.
- Requested functions: 13 of the 14 "Requested" entries in
  `catalog/handoffs-06.json` are now claimed by 06 and one (`travelAllowed`)
  by 01. `eventTravelAllowed` is claimed by 02 (MOV-054),
  `nearestEventTarget` by 04 (TGT-005) and `rejoinActiveEventAfterRespawn` by
  05 (SRV-012); this spec cites them.

Not yet verified:

- Test accuracy review (method step 2) for every test listed in the catalog.
- characters/shared.js `tick` (11114-11450, claimed by 12) and
  `handleCommand` (10416-10991, claimed by 08) hold event code; their event
  branches are cited above, not claimed.

## 7. M1

Design, what changes for the player, proof and migration: M1.
