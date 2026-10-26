# 01 Groups and tasks

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e) in
(local checkout). Every `file:line` is on that ref
unless it says "fork" (af92de45). Behaviour ids are `GRP-001` onward;
`catalog/01-groups-and-tasks.json` lists functions and tests. The proposal
gave this spec no functions by path, so it claims, from the 07, 02 and 06
lists and triage, only the functions whose job is group membership or
precedence; every move is in `catalog/handoffs-01.json`. Leads came from
`backups/party-console/review/full/events.md` and `review/events.md`; this
pass re-read each on the current console. A claim-by-claim check of this page is
in `docs/implementation/06-verification-01-06.md`.

Words used below:

- **Group**: the set of characters doing one task. Today there are three
  kinds: the **party** (the leader plus the characters that follow it), a
  **solo character** (a combat character that does not follow; it is a group
  of one), and the **merchant**, which is outside both (spec 08).
- **Task**: what a group is doing: farming in a mode, a Monster Hunt mission
  or turn-in, an event, an event return, death recovery, an escape, a rare
  hunt, a Cave visit.
- **Owner**: the code that decides it holds the group's movement right now.

Paths: `hunt/`, `navigation/`, `events/`, `http/`, `status/`, `anniversary/`
and `dungeons/` are under `runtime/coordinator/`. This spec names
`runtime/hunt/policy.ts` and `runtime/dungeons/contracts.ts` in full.

## 1. What it does today

### 1.1 Who is in which group

- **GRP-001 Combat roster.** A group exists only around a fresh leader: the
  leader must be seen within 10 s and not be a merchant; its members are the
  active, non-merchant characters on the leader's realm that are the leader
  or follow it, leader first (`hunt/controls.ts:28-52`). "Active" means seen
  within 10 s (`application.ts:1703-1705`, `events/abtesting-update.ts:12-20`).
- **GRP-021 Saved Hunt roster repair.** A saved Hunt roster drops members
  and quest owners that left the current party, cancels the Hunt convoy and
  returns to quest checking (`hunt/current-party.ts:33-53`). It skips the
  repair during a geometry repair, during a communication hold (54-63), and
  when the leader is missing from the current party (41).
- **GRP-002 Farming scopes.** 29 fields (farming policy, Hunt, location,
  focus, convoy, farm-area state, combat recovery, event return, event
  sessions, A/B strategy, rare state, and more) live in a per-character
  profile (`hunt/scopes.ts:6-10`; `sed -n 6,10p hunt/scopes.ts | grep -o '"[a-zA-Z]*"' | wc -l`
  gives 29). The party scope is the leader's profile; the root state's
  fields are getters onto it (52-55). A character's owner is the leader when
  it follows, else itself; the merchant is always its own owner (56-58). A
  solo view is a proxy that reads its own profile and passes everything else
  to the root, except escape, Town cycle and the anniversary cycle, which it
  sees only when it takes part (64-91). Combat characters exclude the
  merchant (`application.ts:2050-2052`). A solo service exists for each
  combat character that owns its scope, other than the leader (2053-2058).
  "Independent services" are the active ones among those (2008-2011).
- **GRP-022 Scoped settings routes.** Farming settings requests pick the
  scope by character (`http/farming-scope.ts:14-27`, wired at
  `application.ts:2021-2030`). The route saves a follower's mode change only
  as its own preference (20-21); an edit for the merchant or for a follower's
  inherited settings returns 409 (22-23, 31-34).
- **GRP-003 Solo services.** `createSoloServices` builds, per solo character,
  its own copy of farming navigation, party convoys, Hunt, farm areas,
  heartbeat response, event returns, event observations, event recovery
  routes, focus route, Hunt actions and navigation actions
  (`application.ts:1784-2007`). The copy differs in small ways: no rare
  control (1787), no disengagement (1818-1819), escape release is a no-op
  (1953, where the party wiring calls `escapeControl.release()` at 710),
  and walks allow only Town and event returns during a turn-in (2002). Each
  tick loops over the independent services after the party (convoys
  2012-2020, farm areas 2086-2089, Hunt 2136-2144, event returns 2208-2211).
- **GRP-004 Follow changes.** When Follow or the leader changes, the
  coordinator retires each member whose owner changed from its old scope and
  joins it to the new one (`hunt/membership.ts:37-78`, called from `application.ts:700`). The
  retire step ends the old scope's whole convoy if the member was in it and
  deletes every member's command for that convoy (16-24). It removes the
  member's Hunt and farming-follow commands, bumps its navigation revision,
  resets combat and deletes its saved location (49-53). A character that
  owned its old scope clears that scope's Hunt and death recovery and
  restores the Hunt's return location (54-57); a follower is removed from
  the Hunt (58). The join step adds a new follower to the Hunt and gives it
  `return-leader` when the leader is fresh and the member has no command
  (60-77).
- **GRP-005 In-game party sync.** On the character, the leader leaves a party
  led by someone else and invites one missing desired member per pass; a
  follower leaves a wrong party and requests to join its leader; a
  non-follower leaves any party; at most one action per 4 s
  (`shared.js:12672-12728`), on a 5 s timer (17355-17356). The character
  accepts an invite only from its configured leader while it follows
  (12651-12658), and a join request only from a desired member while it is
  the leader (12660-12667).
- **GRP-006 Follow decision.** The character follows its leader unless
  navigation is cancelled or an event return owns movement (both waived
  while an event is active), grouped protocol 4 decides instead, or A/B
  testing puts the leader on the other team (`shared.js:17704-17712`).
- **GRP-007 Hunt roster follows Follow.** Outside a turn-in the Hunt keeps
  only the leader and followers and adds late members
  (`hunt/participants.ts:32-67`). With Hunt policy version 3 the Hunt
  appends late members (44-46); otherwise it appends late quest owners, and
  other late members restart assignment only before any mission advanced (48-66).
  Whenever the leader is fresh, turn-in or not, the Hunt cancels any convoy
  that is not `monster-hunt` (84-92).

### 1.2 What the group is doing: the farming policy

- **GRP-008 Farming policy.** One string per scope, `farmingPolicy`
  (`auto`, `default`, `scatter`, `hunt`; the fork adds `achievements`, fork
  `http/hunt-mode.ts:81`). The mode route calls `select`
  (`hunt/mode.ts:115-130`): Hunt restarts when newly selected, re-selected
  after a cancel or escape, given a backup focus, or missing (93-98);
  leaving Hunt starts a farming convoy to the leader's focus unless a Hunt
  participant has an open event trip (51-69). During a running event return
  the policy changes at once (109), and the return saves the new farming
  destination as `postExitLocation` (111), which `events/return-policy.ts:5-33`
  applies once no member is still leaving the event. Six lines write the
  policy: `hunt/mode.ts:109, 127`, `navigation/monster-selection.ts:48` (a
  manual monster pick sets `auto`), `http/saved-farming-mode.ts:30` (a
  follower's saved mode), `navigation/initial-focus.ts:22` (startup) and the
  scope default at `hunt/scopes.ts:25` (command:
  `grep -rnE "farmingPolicy\s*=[^=]|farmingPolicy:\s*\"" runtime scripts --include=*.ts --include=*.cjs`,
  tests excluded). Three owners snapshot the policy and treat a change as
  new navigation: rare hunting (`navigation/rare-hunting.ts:165, 176`),
  death recovery (`scripts/combat-disengagement.cjs:38, 43`) and escape
  (`scripts/party-escape.cjs:3`).

### 1.3 Which task wins

There is no single decision. Each owner checks some of the others. The
table lists what each reader checks on the current console.

| Reader | Yields to | Does not check |
|---|---|---|
| Hunt tick (`hunt/tick.ts:74-94`) | leader present and no dungeon (application.ts:2138), comms hold, rare encounter, any member at an event, turn-in, death recovery, route and farm-walk recovery, event return / non-Hunt convoy / anniversary, farm-area hold, cancelled intent | escape, except through the loot gate (tick.ts:39-44) and an escape convoy counted by `eventOwnsTravel`; boss chase and AH (fork) |
| Event admission (`http/hunt-control.ts:68-71`, `events/observations.ts:246`) | event return membership, Hunt turn-in, cancelled intent, selection and limits, dungeon, a registered anniversary kiss (observations.ts:225-228) | escape, death recovery, rare |
| Event return (`events/returns.ts:226-241`) | Hunt handoff, anniversary hold, any convoy, Town cycle | rare, escape, death recovery (none is read in returns.ts, return-guards.ts, return-policy.ts or repair-return-walk.ts) |
| Rare hunt (`navigation/rare-hunting.ts:118-159`) | stale or dead leader, Town cycle, event return, anniversary, death recovery, Hunt loot, escape, turn-in, members that joined or travel to an event, are dead, below 35% HP or hold a protected command | farm-area relocation; a member's staging `activeEvent` (137 reads `joinedEvent`, `movement.event` and `eventTraveling` only) |
| Farm areas (`navigation/farm-areas.ts:42-52, 184-198, 241-243, 254-266`) | rare, Hunt travel, members at an event, event return, escape, any convoy; turn-in and "event owns travel" only while Hunt is the policy (196-198, 265) | anniversary outside Hunt, deferred returns, death recovery (farm-areas.ts never reads `combatRecovery`) |
| Dungeon gate (`application.ts:1741-1745, 2087, 2138`) | nothing; it suspends the party's other owners | the solo services: their farm areas and Hunt run without the check (2088, 2139-2143) |
| Character reunion (`shared.js:13456-13472`) | dungeon, event exit, escape, attackers, turn-in, rare, 16 flags | none listed |

- **GRP-009 Hunt turn-in precedence.** A Daisy return or turn-in owns travel
  (`runtime/hunt/policy.ts:17-21`). `reconcileOwnership` starts the turn-in
  and, after it completes, holds the Hunt 2 s or while a member reports a
  pending event, so events get one poll first (`hunt/tick.ts:18-23`,
  `policy.ts:62-72`). The heartbeat sends `huntTurnInPriority` to
  non-merchant Hunt members while the turn-in owns travel and no rare
  encounter runs (`status/response.ts:178-181`); the character then refuses
  event travel (`shared.js:11916`, 13285).
- **GRP-010 "Another owner holds travel".** `eventOwnsTravel` is false while
  a turn-in owns travel (`runtime/hunt/policy.ts:87`). Otherwise it is true
  for an event return, any convoy that is not `monster-hunt` (except a
  finished anniversary return), or an open anniversary cycle (88-99). Hunt
  pause, backup Hunt and farm areas use it (`hunt/recovery.ts:159`,
  `hunt/backup.ts:41`, `navigation/farm-areas.ts:197` via
  `application.ts:403`).
- **GRP-011 Hunt pause order.** Within one tick (`hunt/tick.ts:74-94`,
  `24-38`, `57-70`):
  1. scope check (`farmingPolicy === "hunt"` or an exit mode, 106-108);
  2. roster repair; communication hold; failed return; arrival;
  3. rare encounter pauses with its own message (95-99);
  4. expiry;
  5. **combat event**: any member with `activeEvent || joinedEvent` and no
     turn-in sets `paused-event`, "Paused for combat event", and cancels the
     Hunt convoy (`hunt/travel.ts:15-28`);
  6. backup step, loot barrier, batch loot;
  7. turn-in ownership (GRP-009);
  8. return message, deaths;
  9. death recovery ("Recovering after party death", 58-61);
  10. route and farm-walk recovery (71-73);
  11. **pause**: other owner holds travel (`paused-event` with its message),
      else farm-area hold, else cancelled intent ("select Hunt again")
      (`hunt/recovery.ts:157-177`);
  12. a dead member, checking quests, retreat, roster, then travel, which
      checks the combat event again (`hunt/travel.ts:262, 277`).
  After the event, `resumeEvent` restarts mission travel
  (`hunt/travel.ts:30-52`); event returns also write `stage` back from
  `paused-event` (`events/hunt-resume.ts:81`, spec 06 EVT-032).
- **GRP-012 Backup Hunt pause.** Manual cancel first, then escape or death
  recovery, then events (`hunt/backup.ts:33-68`).
- **GRP-013 and GRP-014 The event check copies.** The coordinator computes
  "a member is at an event" from the status fields `activeEvent || joinedEvent` (sometimes
  with `mapEvent` or `eventTraveling`) in 33 places. 23 sit under
  `runtime/coordinator`:
  anniversary/hunt-handoff.ts:36, http/farming-return.ts:45-47,
  hunt/backup.ts:42, encounter-ownership.ts:13, farm-walk.ts:26, 89,
  lifecycle.ts:29-30, 206, loot.ts:15, nearby-target.ts:27, quests.ts:166,
  recovery.ts:185, retreat-restart.ts:40, route-recovery.ts:118-119,
  tick.ts:49-50, travel.ts:18, 294, navigation/convoy-defense.ts:40,
  farm-areas.ts:49-50, grouped-snapshot.ts:106, hunt-arrival.ts:26,
  travel-defense.ts:149, status/response-party.ts:31. Nine more sit in
  `runtime/combat` (claims.ts:9, 20; composition.ts:6;
  formation-recovery.ts:28; grouped.ts:70, 75; independent-approach.ts:5;
  pursuit.ts:23; unseen-primary.ts:7) and one in
  `scripts/combat-disengagement.cjs:10`. Command:
  `git grep -nE "activeEvent|joinedEvent" refs/review/ryan-1.5 -- runtime/coordinator runtime/combat scripts ':!*.test.*' ':!*/tests/*'`,
  then reading each hit and dropping type declarations, writes and
  event-specific tests (`=== event`). Six more lines test `joinedEvent` or
  `mapEvent` without `activeEvent` and are not in the 33:
  `navigation/rare-hunting.ts:137`, `navigation/manual-commands.ts:105`,
  `events/attendance-limits.ts:94, 158`, `events/observations.ts:573`,
  `scripts/hunt-safety.cjs:47`. `dungeons/combat.ts:29` blanks the three
  fields in the Cave's grouped combat members, so the nine `runtime/combat`
  copies do not fire for Cave members; the coordinator copies read the raw
  statuses. The full review counted 22 at the fork tip, including the
  fork-only `lifecycle/console-control.ts:100`; on the current console it
  missed farming-return.ts and farm-areas.ts (`review/full/events.md`
  section 2.3). None of the copies checks the occurrence, the realm or
  whether the admission is still current.
- **GRP-015 Anniversary versus Hunt.** An open anniversary cycle holds Hunt
  farm-walk recovery; once expired it yields its checkpoint to the Daisy
  turn-in (`hunt/expired-anniversary.ts:5-24`, `hunt/farm-walk.ts:6-14, 74-78`).
- **GRP-016 Escape and death recovery in Hunt.** Loot waits for both
  (`hunt/tick.ts:39-44`). An exhausted retreat restarts Hunt once per escape
  id (`hunt/retreat-restart.ts:66-82`, the id check at 68 and 74). It never
  restarts while an event return runs, any convoy exists or a member
  reports an event field (37-42).
- **GRP-017 Rare yields** (table above, `navigation/rare-hunting.ts:118-159`).
- **GRP-018 Dungeon gate.** While `dungeonOwns` (any phase but idle,
  `runtime/dungeons/contracts.ts:142-145`) the travel clock skips escape,
  death recovery, rare, event return and anniversary
  (`application.ts:1741-1745`), and the party's farm areas and Hunt skip
  their tick (2087, 2138); the solo services' loops have no such check
  (2088, 2139-2143). `eventAllowed` refuses events for a member of the visit
  unless protection is off (`dungeons/service.ts:241-253`). With protection
  off, an eligible event starts a Cave exit unless the visit is held
  (250-251). The service retires a held visit when its pending event comes
  back and every participant is fresh (244-248, 254-262).
- **GRP-019 Character owner lists.** 22 conditions block the reunion
  (`shared.js:13456-13472`); "event exit owns movement" merges three sources
  (13451-13455). Similar lists: `frankyCombatActive` (12915-12922, spec 06
  EVT-048), `passiveRegenerationEligible` (13810, spec 05).

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **GRP-020** Each full heartbeat sends party data: desired in-game members
  (the leader and followers on the leader's realm), every member position
  with combat fields, the threats that members other than the leader
  report, every member's target (`status/response-party.ts:59-91`), and the
  leader's location, target and combat selection (`status/response.ts:157-170`,
  added at 284). Combat polls leave all of these out (242-254).

## 2. What goes wrong

### 2.1 Wrong Hunt message (ledger 13)

1. A member's status has `activeEvent` (staging from spawn-120 s,
   `shared.js:11532`, reported through `activeCombatEvent()` at 2864 and
   2987) or a stale `joinedEvent` (escape clears only the local copy, 237;
   reload restores it, 552).
2. Step 5 of the pause order fires before step 11 (`hunt/tick.ts:92` before
   `63`).
3. While the event field is set, "Paused for combat event" replaces the
   cancelled-intent message (`hunt/recovery.ts:175`), which never runs.
4. Once the field clears, step 11 runs before travel and writes the
   cancelled-intent message (`hunt/recovery.ts:171-176`). `resumeEvent`
   (`hunt/travel.ts:30-52`) runs only when no member's intent is cancelled,
   and the convoy start refuses a cancelled member too (`hunt/convoy.ts:32-33`).
   The wrong message therefore lasts as long as the event field.
5. A `rare-hunt` convoy or the reunion's `farm-recovery` shared walk makes
   `eventOwnsTravel` true (`runtime/hunt/policy.ts:90-91`), so `paused-event`
   also shows "Waiting for rare-hunt travel to finish" or "Waiting for
   shared-walk travel to finish" (`hunt/recovery.ts:150`): the stage says
   "event" for non-events. A running `farm-recovery` walk reaches step 11
   because farm-walk recovery releases only a failed or due walk
   (`hunt/farm-walk.ts:34-35`).
No patch.

### 2.2 Hunt stuck after death (ledger 5)

1. Death recovery escapes (`scripts/combat-disengagement.cjs:77-82`).
2. Escape completes when the priest reaches the Blink landing
   (`scripts/party-escape.cjs:96`).
3. Recovery resumes only when every member is at Main within 65 at 50% HP
   (`scripts/combat-disengagement.cjs:83-88`).
4. Nothing walks members from the landing to Main.
5. Hunt waits on `combatRecovery` (`hunt/tick.ts:58-61`).
Patch: fork ce6e7c1a moves escape to `recovering` when a death-owned rescue
lands off Main, copying the 65 rule into party-escape.cjs. Three radii for
"in Main Town" (65, 90, none; spec 06 2.10) are the same shape.

### 2.3 Precedence lives in call order and copied lists

Root cause of 2.1 and of most items below: each owner keeps its own list of
the others (1.3), 23 coordinator copies of one status test (GRP-013), and the
order of calls in `hunt/tick.ts` decides which owner's message and stage
win. A new owner (anniversary, Cipher, dungeon, console Pause, AH, boss
chase) means editing every list; a missed list is a bug.

### 2.4 Owners write each other's state

Event returns write `monsterHunt.stage`, `convoyId` and `message`
(`events/hunt-resume.ts:78-87`, `events/hunt-return.ts:87, 93`); the
anniversary handoff does the same (`anniversary/hunt-handoff.ts:51-58`);
Hunt writes `farmAreaState` (`hunt/recovery.ts:100-103`, `hunt/mode.ts:44-49`)
and the anniversary cycle (`hunt/expired-anniversary.ts:21-23`); the Hunt
roster cancels any non-Hunt convoy (`hunt/participants.ts:89-92`).

### 2.5 Scoping is inconsistent

`eventReturn`, `eventSessions` and `activeConvoy` are per scope
(`hunt/scopes.ts:6-10`); `deferredEventReturns`, `eventAttendance`,
`huntEventTrips`, `combatEventHandoff`, `anniversary`, `escape` and
`townCycle` are root-wide. `mode.exit` reads trips only for the scope's Hunt
participants (`hunt/mode.ts:55-58`). The root-wide read is the handoff:
`combatEventHandoff` ends only when no character has an open trip
(`events/hunt-trip.ts:30-33, 44`), and the party's event target cleanup
waits for that end (`navigation/grouped-snapshot.ts:264-274`). Inference: a
solo character's open event trip delays the party's event target cleanup.

### 2.6 Dungeon `held` blocks everything

`held` counts as owning (`runtime/dungeons/contracts.ts:142-145`) and ends
by manual release, which throws unless every participant is fresh and
outside (`dungeons/service.ts:263-274`), or by its pending event (GRP-018).
While held, escape and death recovery do not tick (`application.ts:1741-1742`).
Inference: nothing recovers a member that dies after leaving the Cave until
the user releases the visit.

### 2.7 Duplicated wiring for solo characters

Each owner check goes into the party wiring and again into
`createSoloServices` (`application.ts:1784-2007`), and the two already differ
(GRP-003, and the missing dungeon check in GRP-018).

### 2.8 Admission ignores escape and death recovery

`travelAllowed` (`http/hunt-control.ts:68-71`) and `authorize`
(`events/observations.ts:244-259`) do not read `escape` or `combatRecovery`.
The character checks its own escape first (`shared.js:13283`). Inference:
admission can let a respawned member in during death recovery and put Hunt
into `paused-event`.

## 3. Fork differences

Fork ref af92de45, read at the named lines.

- **Achievement Hunt** (3bae33fc .. cd7bd857): farming mode `achievements`,
  its own busy list: dungeon, any event session, event return or deferred
  return, rare, any travelling convoy (fork application.ts:829-841). It does
  not check escape, death recovery, boss chase or farm relocation. The event
  gate treats any session as a trip, and a session exists for every enabled
  member that reports the event live (`events/observations.ts:138-144`), so
  it waits whenever a selected event is live anywhere on the realm
  (inference). Its target switches mark live event occurrences "manual
  travel" (fork navigation/monster-selection.ts:76; spec 06 section 3).
  `achievements` is missing from two mode whitelists (fork
  navigation/initial-focus.ts:12, fork http/saved-farming-mode.ts:12; full
  review F-FA5).
- **Boss chase** (e990e787, 3ed84536): a realm-hopping owner whose tick
  checks only a running realm switch (fork events/boss-chase.ts:371-387). No
  other owner reads its state; outside boss-chase.ts only the wiring,
  telemetry and the dashboard route use it (fork application.ts:1260-1265,
  2442).
- **Console Pause and Play** (9a34a4c1, b33aee77): Play writes back the
  saved profile fields (farming policy, location, focus, AH target and
  more) and settings that changed during the pause, and restores a Hunt only
  when its cycle changed (fork lifecycle/console-control.ts:234-283).
- **Farm relocation versus AH** (full review F-FA1): farm areas do not read
  AH state (fork navigation/farm-areas.ts has no `achievement` match), so a
  relocation can move the party off AH's target, and AH sends it back at
  most every 30 s (fork hunt/achievement-hunt.ts:77, 389).

## 4. Tests today

Labels: proves / does not cover / accuracy / patch guard. Accuracy is "not
reviewed" until method step 2.

| Test file | Behaviours | Proves | Does not cover | Accuracy | Patch guard |
|---|---|---|---|---|---|
| scripts/tests/solo-hunt.test.cjs | GRP-002..004 | concurrent Hunts, Follow on/off, scope-owned event recovery | solo deferred returns (2.5) | not reviewed | no |
| scripts/tests/coordinator-hunt-controls.test.cjs | GRP-001 | roster needs a fresh leader and same-realm followers | merchant and realm switch | not reviewed | no |
| scripts/tests/coordinator-hunt-composition.test.cjs, hunt-geometry-roster.test.cjs | GRP-021 | offline members and quest owners leave the saved roster; a reloading member stays during a geometry repair | communication hold | not reviewed | no |
| scripts/tests/ui-cleanup-behavior.test.cjs | GRP-022 | a follower's mode save stays a preference; merchant edits are refused | solo scope edits | not reviewed | no |
| scripts/tests/hunt-event-priority.test.cjs | GRP-009 | turn-in blocks events on the character | coordinator admission during escape (2.8) | not reviewed | partly |
| scripts/tests/hunt-safety.test.cjs | GRP-009..011 | turn-in, event return wait, cancel handling | message precedence (2.1) | not reviewed | several guard patches |
| e2e/live-game.spec.ts (Goobrawl interrupts Hunt) | GRP-011 | event pause and resume on a native server | staging pause, cancelled intent | not reviewed | no |
| scripts/tests/daily-dungeons.test.cjs | GRP-018 | protection blocks events; recovery paused in Cave | `held` after exit (2.6); solo services under a visit | not reviewed | no |
| scripts/tests/rare-hunting.test.cjs | GRP-017 | event combat prevents rare interruption | boss chase | not reviewed | no |
| scripts/tests/farm-reunion.test.cjs | GRP-019 | reunion blocked by convoy, anniversary, event exit, attackers and cancelled navigation | the other 17 conditions one by one | not reviewed | no |
| scripts/tests/hunt-farm-walk.test.cjs | GRP-015 | expired anniversary yields to Daisy | live anniversary | not reviewed | yes (reported Ghost stall) |

Full list in `catalog/01-groups-and-tasks.json` (112 distinct tests;
command in Gaps). No test covers GRP-005 (in-game party sync), GRP-020
(heartbeat party data), the Hunt message order (2.1), or ledger 5's
landing-to-Main leg end to end on the current console (the fork adds
`e2e/live-hunt-death-escape.spec.ts` in ce6e7c1a).

## 5. Needs your review

1. **Precedence order.**
   **Today:** there is no single order. Each owner checks a different
   partial list (table 1.3), and inside the Hunt tick the order of calls
   decides (GRP-011, `hunt/tick.ts:74-94`). Admission does not read escape or
   death recovery (2.8); farm areas do not read death recovery; the fork's
   AH and boss chase keep their own lists (section 3).
   **Options:**
   (a) One fixed ranking: escape > death recovery > dungeon visit > Hunt
   turn-in > event return > event attendance > rare encounter > Hunt
   mission > Achievement Hunt (fork) > boss chase (fork) > farm-area moves.
   Negatives: a live boss never pulls the party off a quest mission; every
   owner below event attendance stops whenever an event starts.
   (b) As (a), with boss chase above Hunt missions. Negatives: a realm hop
   in the middle of a mission throws away its travel, and the quest timer
   keeps running while the party is away.
   (c) As (a), with a featured anniversary hold above event attendance.
   Negatives: the party reaches combat events up to one minute late during
   a featured round.
   **Recommendation:** (a). It keeps the order most of today's checks
   already follow (turn-in before events, GRP-009; events before Hunt,
   GRP-011; the dungeon suspends the rest, GRP-018), so the player sees few
   changes, and one list replaces the seven in table 1.3. It beats (b)
   because the Hunt is the mode the user picked, and boss chase is an extra
   the user can pick instead. It beats (c) because the featured hold lasts
   one minute and an event already interrupts it today
   (`shared.js:13314-13330`). Negatives: boss chase and AH always lose to an
   active quest, and every new owner has to take a place in the list before
   it ships.
2. **Staging and Hunt.**
   **Today:** staging opens 120 s before spawn (`shared.js:11532`). From that
   moment the heartbeat reports `activeEvent` (2864, 2987), the character
   sets `joinedEvent` and walks at once (13408-13417), and Hunt pauses and
   cancels its convoy (`hunt/travel.ts:15-28`).
   **Options:**
   (a) Keep: staging pauses Hunt. Negatives: Hunt stops for the whole lead
   even when the event is close, and it throws away a mission convoy.
   (b) Pause Hunt only once the event walk starts, with the walk timed by
   spec 06 question 2. Negatives: Hunt must read a "walking to the event"
   signal instead of `activeEvent`, and stop cleanly mid-mission when the
   walk starts.
   (c) Never pause Hunt for staging; Hunt continues until the event is
   live. Negatives: the party starts walking only at spawn, so it arrives
   after the boss appears and misses the start of the fight.
   **Recommendation:** (b). Hunt keeps farming until the party has to leave,
   and the party still arrives on time. It beats (a) because the time
   before the walk is not wasted, and beats (c) because the party is at the
   spawn when it opens. Negatives: it depends on spec 06 question 2's route
   time estimate, and a wrong estimate makes the party late.
3. **What the dashboard shows when several owners hold the party.**
   **Today:** the Hunt message comes from whichever check runs first in the
   tick (GRP-011), so "Paused for combat event" hides a cancelled intent
   (2.1), and `paused-event` shows for rare-hunt and farm-recovery walks
   (`hunt/recovery.ts:150`).
   **Options:**
   (a) Show only the highest owner from question 1. Negatives: an owner
   waiting behind it is invisible, so the user cannot tell why Hunt will
   not resume after the event.
   (b) Show all of them, highest first. Negatives: longer status lines,
   which matter on the phone cards; every owner must report a reason.
   **Recommendation:** (b), as one top line with the other reasons in a
   collapsed list. Bug 2.1 is a hidden second reason, and (a) keeps that
   bug. Negatives: more dashboard work, and each owner needs a reason
   string.
4. **Solo characters and party tasks.**
   **Today:** event returns, sessions and convoys are per scope, but
   deferred returns, attendance, trips and the event handoff are root-wide
   (2.5). The account-wide handoff ends only when no character has an open
   trip (`events/hunt-trip.ts:30-33, 44`).
   **Options:**
   (a) Never: each group is independent. Negatives: a solo character and
   the party at the same event run two returns with two checkpoints.
   (b) Only for events both groups attend. Negatives: needs one event
   session shared across scopes, the same kind of shared state that the
   deferred-return fixes in spec 06 2.8 kept patching.
   **Recommendation:** (a). It removes the cross-group wait and matches how
   the scopes already split everything else (GRP-002). It beats (b)
   because (b) adds a cross-scope session machine. Negatives: two groups at
   the same event return separately, and the anniversary cycle, one round
   for the realm, stays a shared exception.
5. **Dungeon `held`.**
   **Today:** a held visit owns the party until manual release, which needs
   every participant fresh and outside (`dungeons/service.ts:263-274`), or
   until its pending event comes back (244-248). Escape and death recovery
   do not tick while it owns (`application.ts:1741-1742`).
   **Options:**
   (a) Keep blocking until manual release. Negatives: a member that dies
   after leaving the Cave is not recovered (2.6, inference); farming waits
   for the user.
   (b) Release on its own once every fresh member is out. Negatives: a user
   who held the party on purpose loses the hold; an offline member still
   keeps it.
   (c) Keep the travel block, but always run escape and death recovery.
   Negatives: farming still waits for the user; escape can move members
   the user wanted held.
   **Recommendation:** (c). Escape and death recovery protect the
   characters and never wait on a farming choice. The hold stays the user's
   call. It beats (a) because death recovery reaches a death outside the
   Cave, and beats (b) because it keeps an explicit hold. Negatives:
   the party still sits idle until the user releases it.
6. **Follow during A/B testing.**
   **Today:** a follower stops following a leader on the other team
   (`shared.js:17709-17711`) and acts alone. The game puts each character on
   a random team unless it already joined this round (game
   `node/server.js:12688-12692`, local copy at commit 43b2c8fc).
   **Options:**
   (a) Keep: no follow across teams. Negatives: a lone follower has no
   healer or tank nearby for the round.
   (b) Follow the highest-level owned character on the same team.
   Negatives: a new rule for a short event; several followers can pile on
   one character; the party's planned formation is lost for the round.
   **Recommendation:** (b). A same-team group keeps healing and tanking
   working, which (a) gives up for the whole round. Negatives: extra code
   for an event that runs rarely, and the highest-level character may not
   be the best one to follow.

## 6. Gaps

`node tools/check-claims.mjs` run 2026-10-26 after the verification split
(all catalogs present):

- Totals: 9,421 functions, all claimed; claimed by more than one spec: 0;
  claims naming no known function: 0.
- Functions claimed by 01: 193 in 22 behaviours; 112 distinct tests.
  Command:
  `node -e "const c=require('./catalog/01-groups-and-tasks.json');console.log(c.behaviours.flatMap(b=>b.functions).length, new Set(c.behaviours.flatMap(b=>b.tests)).size)"`.
- Behaviours with no test: GRP-005, GRP-020.
- Requested, not claimed: `application.ts monsterHuntTick` and
  `http/farming-return.ts blocked` (both claimed by 07); the
  `combat-disengagement.cjs event` copy is claimed by 05 (SRV-010).

Not yet verified:

- Test accuracy review for every listed test.
- Escape and death recovery precedence inside `scripts/party-escape.cjs` and
  `scripts/combat-disengagement.cjs` beyond the ledger 5 lines; they belong
  to specs 02 and 05 and need a cross-check of what they yield to.
- `characters/shared.js` `tick` (claimed by 12) and `handleCommand`
  (claimed by 08) keep group and precedence branches (leader, follow,
  turn-in flag, 11232-11242); this spec cites them but does not claim them.

## 7. M1

Design, what changes for the player, proof and migration: M1.
