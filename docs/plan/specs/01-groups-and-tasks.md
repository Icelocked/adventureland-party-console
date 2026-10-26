# 01 Groups and tasks

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e) in
(local checkout). Every `file:line` is on that ref
unless it says "fork" (af92de45). Behaviour ids are `GRP-001` onward;
`catalog/01-groups-and-tasks.json` lists functions and tests. The proposal
gave this spec no functions by path, so it claims, from the 07, 02 and 06
lists and triage, only the functions whose job is group membership or
precedence; every move is in `catalog/handoffs-01.json`. Leads came from
`backups/party-console/review/full/events.md` and `review/events.md`; each
was re-read on the current console.

Words used below:

- **Group**: the set of characters doing one task. Today there are three
  kinds: the **party** (the leader plus the characters that follow it), a
  **solo character** (a combat character that does not follow; it is a group
  of one), and the **merchant**, which is outside both (spec 08).
- **Task**: what a group is doing: farming in a mode, a Monster Hunt mission
  or turn-in, an event, an event return, death recovery, an escape, a rare
  hunt, a Cave visit.
- **Owner**: the code that decides it holds the group's movement right now.

## 1. What it does today

### 1.1 Who is in which group

- **GRP-001 Combat roster.** A group exists only around a fresh leader: the
  leader must be seen within 10 s and not be a merchant; its members are the
  active characters on the leader's realm that are the leader or follow it,
  leader first (`hunt/controls.ts:28-52`). "Active" means seen within 10 s
  (`application.ts:1703-1705`, `abtesting-update.ts:12-20`). A saved Hunt
  roster is repaired when members leave or the quest owner departs, except
  during a geometry repair or a communication hold
  (`hunt/current-party.ts:33-63`).
- **GRP-002 Farming scopes.** 29 fields (farming policy, Hunt, location,
  focus, convoy, farm-area state, combat recovery, event return, event
  sessions, A/B strategy, rare state, and more) live in a per-character
  profile (`hunt/scopes.ts:6-10`). The party scope is the leader's profile;
  the root state's fields are getters onto it (52-55). A character's owner is
  the leader when it follows, else itself (56-58). A solo view is a proxy that
  reads its own profile and passes everything else to the root, except
  escape, Town cycle and the anniversary cycle, which it sees only when it
  takes part (64-91). Combat characters exclude the merchant
  (`application.ts:2050-2052`); a solo service exists for each non-following
  combat character (2053-2058); "independent services" are the active ones
  (2008-2011). HTTP settings routes pick the scope by character
  (`http/farming-scope.ts:14-45`).
- **GRP-003 Solo services.** `createSoloServices` builds, per solo character,
  its own copy of farming navigation, party convoys, Hunt, farm areas,
  heartbeat response, event returns, event observations, event recovery
  routes, focus route, Hunt actions and navigation actions
  (`application.ts:1784-2007`). The copy differs in small ways: no rare
  control (1787), no disengagement (1818-1819), escape release is a no-op
  (1953), and walks allow only Town and event returns during a turn-in
  (2002). Each tick loops over the independent services after the party
  (convoys 2012-2020, farm areas 2086-2089, Hunt 2136-2144, event returns
  2208-2211).
- **GRP-004 Follow changes.** When Follow or the leader changes, each member
  whose owner changed leaves the old scope's convoy and Hunt role, gets a new
  navigation revision and a combat reset, and loses its saved location; a
  departing owner takes its Hunt with it; a joining follower is added to the
  Hunt and gets `return-leader` (`hunt/membership.ts:37-78`, called from
  `application.ts:700`).
- **GRP-005 In-game party sync.** On the character, the leader leaves a party
  led by someone else and invites missing desired members; a follower leaves
  a wrong party and requests to join its leader; a non-follower leaves any
  party; at most one action per 4 s (`shared.js:12672-12728`). Invites and
  requests are accepted only from the configured leader or desired members
  (12651-12670).
- **GRP-006 Follow decision.** The character follows its leader unless
  navigation is cancelled or an event return owns movement (both waived
  while an event is active), grouped protocol 4 decides instead, or A/B
  testing puts the leader on the other team (`shared.js:17704-17712`). The
  coordinator sends leader location, target and combat selection in every
  heartbeat (`response.ts:157-170`).
- **GRP-007 Hunt roster follows Follow.** Outside a turn-in the Hunt keeps
  only the leader and followers, adds late members, and cancels any convoy
  that is not `monster-hunt` (`hunt/participants.ts:32-96`, cancel at 89-92).

### 1.2 What the group is doing: the farming policy

- **GRP-008 Farming policy.** One string per scope, `farmingPolicy`
  (`auto`, `default`, `scatter`, `hunt`; the fork adds `achievements`). The
  mode route calls `select` (`hunt/mode.ts:115-130`): Hunt restarts when
  newly selected, re-selected after a cancel or escape, or given a backup
  focus (93-98); leaving Hunt starts a farming convoy to the leader's focus
  unless a member has an open event trip (51-69); a running event return
  keeps the party, and the new mode waits as `postExitLocation`
  (105-114). Other writers: a manual monster pick sets `auto`
  (`monster-selection.ts:48`), saved follower mode, initial focus and the
  scope defaults (full review Appendix B 2.6). Three owners snapshot the
  policy and treat a change as new navigation: rare hunting, death recovery,
  escape (`rare-hunting.ts:165`, `combat-disengagement.cjs`, `party-escape.cjs`).

### 1.3 Which task wins

There is no single decision. Each owner checks some of the others. The
table lists what each reader checks on the current console.

| Reader | Yields to | Does not check |
|---|---|---|
| Hunt tick (`hunt/tick.ts:74-94`) | leader present and no dungeon (application.ts:2138), comms hold, rare encounter, any member at an event, turn-in, death recovery, route and farm-walk recovery, event return / non-Hunt convoy / anniversary, farm-area hold, cancelled intent | boss chase and AH (fork) |
| Event admission (`hunt-control.ts:68-71`, `observations.ts:246`) | event return membership, Hunt turn-in, cancelled intent, selection and limits, dungeon | escape, death recovery, rare |
| Event return (`returns.ts:226-241`) | Hunt handoff, anniversary hold, any convoy, Town cycle | rare |
| Rare hunt (`rare-hunting.ts:118-159`) | stale leader, Town cycle, event return, anniversary, death recovery, Hunt loot, escape, turn-in, members at an event or below 35% HP | farm-area relocation |
| Farm areas (`farm-areas.ts:42-52, 196-198, 254-266`) | rare, Hunt travel, turn-in, "event owns travel", members at an event, event return, escape, any convoy | anniversary, deferred returns |
| Dungeon gate (`application.ts:1741-1745, 2087, 2138`) | nothing; it suspends the others | n/a |
| Character reunion (`shared.js:13456-13472`) | dungeon, event exit, escape, attackers, turn-in, rare, 16 flags | none listed |

- **GRP-009 Hunt turn-in precedence.** A Daisy return or turn-in owns travel
  (`hunt/policy.ts:17-21`). `reconcileOwnership` starts the turn-in and,
  after it completes, holds the Hunt 2 s or while a member reports a pending
  event, so events get one poll first (`tick.ts:18-23`, `policy.ts:62-72`).
  The heartbeat sends `huntTurnInPriority` to members in the Hunt unless a
  rare encounter runs (`response.ts:178-181`); the character then refuses
  event travel (`shared.js:11916`, 13285).
- **GRP-010 "Another owner holds travel".** `eventOwnsTravel` is true for an
  event return, any convoy that is not `monster-hunt` (except a finished
  anniversary return), or an open anniversary cycle (`policy.ts:82-99`).
  Hunt pause, backup Hunt and farm areas use it (`recovery.ts:159`,
  `backup.ts:41`, `farm-areas.ts:197` via `application.ts:403`).
- **GRP-011 Hunt pause order.** Within one tick (`tick.ts:74-94`, `24-38`,
  `57-70`):
  1. scope check (`farmingPolicy === "hunt"` or an exit mode, 106-108);
  2. roster repair; communication hold; failed return; arrival;
  3. rare encounter pauses with its own message (95-99);
  4. expiry;
  5. **combat event**: any member with `activeEvent || joinedEvent` and no
     turn-in sets `paused-event`, "Paused for combat event", and cancels the
     Hunt convoy (`travel.ts:15-28`);
  6. backup step, loot barrier, batch loot;
  7. turn-in ownership (GRP-009);
  8. return message, deaths;
  9. death recovery ("Recovering after party death", 58-61);
  10. route and farm-walk recovery (71-73);
  11. **pause**: other owner holds travel (`paused-event` with its message),
      else farm-area hold, else cancelled intent ("select Hunt again")
      (`recovery.ts:157-177`);
  12. a dead member, checking quests, retreat, roster, then travel, which
      checks the combat event again (`travel.ts:262, 277`).
  After the event, `resumeEvent` restarts mission travel (30-52); event
  returns also write `stage` back from `paused-event` (spec 06 EVT-032).
- **GRP-012 Backup Hunt pause.** Manual cancel first, then escape or death
  recovery, then events (`backup.ts:33-68`).
- **GRP-013 and GRP-014 The event check copies.** "A member is at an event"
  is computed from the status fields `activeEvent || joinedEvent` (sometimes
  with `mapEvent` or `eventTraveling`) in 23 places under
  `runtime/coordinator`:
  anniversary/hunt-handoff.ts:36, http/farming-return.ts:45-47,
  hunt/backup.ts:42, encounter-ownership.ts:13, farm-walk.ts:26, 89,
  lifecycle.ts:29-30, 206, loot.ts:15, nearby-target.ts:27, quests.ts:166,
  recovery.ts:185, retreat-restart.ts:40, route-recovery.ts:118-119,
  tick.ts:49-50, travel.ts:18, 294, navigation/convoy-defense.ts:40,
  farm-areas.ts:49-50, grouped-snapshot.ts:106, hunt-arrival.ts:26,
  travel-defense.ts:149, status/response-party.ts:31. Eight more sit in
  `runtime/combat` (claims.ts:9, 20; composition.ts:6;
  formation-recovery.ts:28; grouped.ts:70, 75; independent-approach.ts:5;
  pursuit.ts:23; unseen-primary.ts:7) and one in
  `scripts/combat-disengagement.cjs:10`. `dungeons/combat.ts:29` blanks the
  fields so none of them fire inside the Cave. Command:
  `git grep -n joinedEvent refs/review/ryan-1.5 -- runtime/coordinator runtime/combat scripts ':!*.test.*'`,
  then reading each hit. The review counted 22 at the fork tip, including
  the fork-only `lifecycle/console-control.ts:100`; on the current console it missed
  farming-return.ts and farm-areas.ts. None of the copies checks the
  occurrence, the realm or whether the admission is still current.
- **GRP-015 Anniversary versus Hunt.** An open anniversary cycle holds Hunt
  farm-walk recovery; once expired it yields its checkpoint to the Daisy
  turn-in (`hunt/expired-anniversary.ts:5-24`, `farm-walk.ts:6-14, 74-78`).
- **GRP-016 Escape and death recovery in Hunt.** Loot waits for both
  (`tick.ts:39-44`); an exhausted retreat restarts Hunt once, never during an
  event (`retreat-restart.ts:37-58`).
- **GRP-017 Rare yields** (table above, `rare-hunting.ts:118-159`).
- **GRP-018 Dungeon gate.** While `dungeonOwns` (any phase but idle,
  `dungeons/contracts.ts:142-145`) the travel clock skips escape, death
  recovery, rare, event return and anniversary (`application.ts:1741-1745`),
  farm areas and Hunt skip the party (2087, 2138), and events are refused
  unless protection is off, in which case an event triggers a Cave exit
  (`dungeons/service.ts:241-262`).
- **GRP-019 Character owner lists.** The reunion is blocked by 22 conditions
  (`shared.js:13456-13472`); "event exit owns movement" merges three sources
  (13451-13455). Similar lists: `frankyCombatActive` (spec 06 EVT-048),
  `passiveRegenerationEligible` (spec 05).

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **GRP-020** Each heartbeat sends party data: desired in-game members, every member position with combat fields, and the threats and targets other members report. Code: `runtime/coordinator/status/response-party.ts`.

## 2. What goes wrong

### 2.1 Wrong Hunt message (ledger 13)

1. A member's status has `activeEvent` (staging from spawn-120 s,
   `shared.js:11532` to the snapshot at 2987) or a stale `joinedEvent`
   (escape clears only the local copy, 237; reload restores it, 552).
2. Step 5 of the pause order fires before step 11 (`tick.ts:92` before
   `63`).
3. "Paused for combat event" replaces the cancelled-intent message
   (`recovery.ts:175`), which never runs.
4. After the event, `resumeEvent` restarts travel without checking the
   cancelled intent (`travel.ts:30-52`); the convoy start then refuses and
   writes the cancel text (`hunt/convoy.ts`).
5. A `rare-hunt` convoy or the reunion's `farm-recovery` shared walk makes
   `eventOwnsTravel` true (`policy.ts:90-91`), so `paused-event` also shows
   "Waiting for rare-hunt travel to finish" (`recovery.ts:150`): the stage
   says "event" for non-events.
No patch.

### 2.2 Hunt stuck after death (ledger 5)

1. Death recovery escapes (`combat-disengagement.cjs:77-82`).
2. Escape completes when the priest reaches the Blink landing
   (`party-escape.cjs:96`).
3. Recovery resumes only when every member is at Main within 65 at 50% HP
   (`combat-disengagement.cjs:83-88`).
4. Nothing walks members from the landing to Main.
5. Hunt waits on `combatRecovery` (`tick.ts:58-61`).
Patch: fork ce6e7c1a moves escape to `recovering` when a death-owned rescue
lands off Main, copying the 65 rule into party-escape.cjs. Three radii for
"in Main Town" (65, 90, none; spec 06 2.10) are the same shape.

### 2.3 Precedence lives in call order and copied lists

Root cause of 2.1 and of most items below: each owner keeps its own list of
the others (1.3), 23 coordinator copies of one status test (GRP-013), and the
order of calls in `tick.ts` decides which owner's message and stage win. A
new owner (anniversary, Cipher, dungeon, console Pause, AH, boss chase) means
editing every list; a missed list is a bug.

### 2.4 Owners write each other's state

Event returns write `monsterHunt.stage`, `convoyId` and `message`
(`hunt-resume.ts:78-87`, `hunt-return.ts:87, 93`); the anniversary handoff
does the same (`anniversary/hunt-handoff.ts:51-58`); Hunt writes
`farmAreaState` (`recovery.ts:100-103`, `mode.ts:44-49`) and the
anniversary cycle (`expired-anniversary.ts:21-23`); the Hunt roster cancels
any non-Hunt convoy (`participants.ts:89-92`).

### 2.5 Scoping is inconsistent

`eventReturn`, `eventSessions` and `activeConvoy` are per scope
(`scopes.ts:6-10`); `deferredEventReturns`, `eventAttendance`,
`huntEventTrips`, `anniversary`, `escape` and `townCycle` are root-wide.
`mode.exit` reads root `huntEventTrips` (`mode.ts:55-58`). Inference: a solo
character's open event trip keeps the party from starting its farming
convoy when the party leaves Hunt.

### 2.6 Dungeon `held` blocks everything

`held` counts as owning (contracts.ts:142-145) and ends only by manual
release, which throws unless every participant is fresh and outside
(`service.ts:263-274`). While held, escape and death recovery do not tick
(`application.ts:1741-1742`). Inference: a member that dies after leaving
the Cave is not recovered until the user releases the visit.

### 2.7 Duplicated wiring for solo characters

Every owner check has to be added in the party wiring and in
`createSoloServices` (application.ts:1784-2007), and the two already differ
(GRP-003).

### 2.8 Admission ignores escape and death recovery

`travelAllowed` (`hunt-control.ts:68-71`) and `authorize`
(`observations.ts:246`) do not read `escape` or `combatRecovery`. The
character checks its own escape first (`shared.js:13283`). Inference: a
respawned member can be admitted during death recovery and put Hunt into
`paused-event`.

## 3. Fork differences

Fork ref af92de45, read at the named lines.

- **Achievement Hunt** (3bae33fc .. cd7bd857): farming mode `achievements`,
  its own busy list: dungeon, any event session, event return or deferred
  return, rare, any travelling convoy (fork application.ts:829-841). It does
  not check escape, death recovery, boss chase or farm relocation. The event
  gate treats any session as a trip, so it waits whenever a selected event is
  live anywhere (inference). Its target switches skip live event
  occurrences (spec 06 section 3). `achievements` is missing from two mode
  whitelists (current `initial-focus.ts:22`, `saved-farming-mode.ts:12`, full review
  F-FA5).
- **Boss chase** (e990e787, 3ed84536): a realm-hopping owner whose tick
  checks only a running realm switch (fork boss-chase.ts:371-387). No other
  owner checks it.
- **Console Pause and Play** (9a34a4c1, b33aee77): Play restores farming
  policy, location, focus and AH target over anything changed during the
  pause.
- **Farm relocation versus AH** (full review F-FA1): farm areas do not check
  AH, so a relocation can move the party off AH's target and AH walks back
  every 30 s.

## 4. Tests today

Labels: proves / does not cover / accuracy / patch guard. Accuracy is "not
reviewed" until method step 2.

| Test file | Behaviours | Proves | Does not cover | Accuracy | Patch guard |
|---|---|---|---|---|---|
| scripts/tests/solo-hunt.test.cjs | GRP-002..004 | concurrent Hunts, Follow on/off, scope-owned event recovery | solo deferred returns (2.5) | not reviewed | no |
| scripts/tests/coordinator-hunt-controls.test.cjs | GRP-001 | roster needs a fresh leader and same-realm followers | merchant and realm switch | not reviewed | no |
| scripts/tests/hunt-event-priority.test.cjs | GRP-009 | turn-in blocks events on the character | coordinator admission during escape (2.8) | not reviewed | partly |
| scripts/tests/hunt-safety.test.cjs | GRP-009..011 | turn-in, event return wait, cancel handling | message precedence (2.1) | not reviewed | several guard patches |
| e2e/live-game.spec.ts (Goobrawl interrupts Hunt) | GRP-011 | event pause and resume on a native server | staging pause, cancelled intent | not reviewed | no |
| scripts/tests/daily-dungeons.test.cjs | GRP-018 | protection blocks events; recovery paused in Cave | `held` after exit (2.6) | not reviewed | no |
| scripts/tests/rare-hunting.test.cjs | GRP-017 | event combat prevents rare interruption | boss chase | not reviewed | no |
| scripts/tests/farm-reunion.test.cjs | GRP-019 | reunion blocked by convoy, anniversary, event exit | other 19 conditions one by one | not reviewed | no |
| scripts/tests/hunt-farm-walk.test.cjs | GRP-015 | expired anniversary yields to Daisy | live anniversary | not reviewed | yes (reported Ghost stall) |

Full list in `catalog/01-groups-and-tasks.json` (110 distinct tests). No test
covers GRP-005 (in-game party sync), the Hunt message order (2.1), or ledger
5's landing-to-Main leg end to end.

## 5. Needs your review

1. **Precedence order.** Proposed for M1: escape > death recovery > dungeon
   visit > Hunt turn-in > event return > event attendance > rare encounter >
   Hunt mission > Achievement Hunt (fork) > boss chase (fork) > farm-area
   moves. Options: (a) accept; (b) move boss chase above Hunt missions so a
   live boss can pull the party off a quest; (c) let a featured anniversary
   hold rank above event attendance.
2. **Staging and Hunt.** Should the 120 s staging window pause Hunt? (a) Yes,
   as today; (b) only once the walk starts; (c) never; Hunt continues until
   the event is live.
3. **What the dashboard shows when several owners hold the party.** (a) The
   highest owner from question 1; (b) all of them, highest first.
4. **Solo characters and party tasks.** Should a solo character's event trip
   or deferred return ever hold the party's task? (a) Never: each group is
   independent; (b) only for events both groups attend.
5. **Dungeon `held`.** After everyone left the Cave: (a) keep blocking until
   manual release; (b) release on its own once all fresh members are out;
   (c) keep the travel block but always allow escape and death recovery.
6. **Follow during A/B testing.** Today a follower stops following a leader
   on the other team. Keep, or follow the strongest same-team member?

## 6. Gaps

`node tools/check-claims.mjs` run 2026-10-26 with catalogs 01, 03, 04, 05,
06, 07, 11 and 13 present:

- Functions claimed by 01: 177 (89 from the 07 proposal, 17 from 02, 4 from
  06, 61 triage, 6 released by 11 and 13; 07 also released 26 of the 89). Command:
  `node -e "const c=require('./catalog/01-groups-and-tasks.json');console.log(c.behaviours.flatMap(b=>b.functions).length)"`.
- Claimed by more than one spec involving 01: 96, all shared with 07. Spec 07
  was written at the same time and kept the Hunt pause, roster, farming mode,
  event-check copies, dungeon gate and solo-service functions this spec claims
  as precedence or membership (see `catalog/handoffs-01.json`). The
  coordinator decides which spec keeps each; `isLeader` was left to 04.
- Claims naming no known function: 0.
- Behaviours with no test: GRP-005.
- Requested, not claimed: `application.ts monsterHuntTick` (04),
  `combat-disengagement.cjs event` (05), `http/farming-return.ts blocked`
  (13) (`catalog/handoffs-01.json`).

Not yet verified:

- Test accuracy review for every listed test.
- Escape and death recovery precedence inside `scripts/party-escape.cjs` and
  `scripts/combat-disengagement.cjs` beyond the ledger 5 lines; they belong
  to specs 02 and 05 and need a cross-check of what they yield to.
- The 8 `farmingPolicy` writers were taken from the full review (Appendix B
  2.6) and spot-checked, not all reread.
- characters/shared.js `tick` and `handleCommand` keep group and precedence
  branches (leader, follow, turn-in flag, 11232-11242) but stay in triage.

## 7. M1

Design, what changes for the player, proof and migration: M1.
