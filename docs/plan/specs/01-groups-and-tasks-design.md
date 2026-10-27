# 01 Groups and tasks: M1 design draft

Draft of the M1 design for spec 01 (groups and tasks: which task each group is doing and which
one wins). It goes into 01-groups-and-tasks.md section 7 later. It builds on sections 1 to 6 of that
spec as checked claim by claim (docs/implementation/06-verification-01-06.md), on the checked specs
05, 06, 07 and 08, and on the movement design (02-movement-design.md), whose group walks take their
rank from this design's table (movement 2.5, ranks 56 to 70). "Corrections to the checked specs" at
the end lists what this design found wrong or missing in them.

Refs. Line numbers are on the current console at `b9b5c91e` (`refs/review/ryan-1.5` in
(local checkout), read with `git show refs/review/ryan-1.5:<path>`) unless
marked (fork) for `af92de45`. `shared.js` means `characters/shared.js`. Bare `hunt/`, `events/`,
`navigation/`, `http/`, `status/`, `anniversary/`, `merchant/` and `dungeons/` paths are under
`runtime/coordinator/`; `application.ts` is `runtime/coordinator/application.ts`. Game rules cite
kaansoral/adventureland_mongodb at `43b2c8fc`, as the movement design does.

The design marks decisions that wait on the user "pending your answer (queue A#)" or "pending your
answer (D#)" and uses the review queue recommendation as the working assumption. Section 11 lists
every decision.

## 0. The design in one page

- Each **group** gets one **task owner** on the coordinator: the party (the leader and its
  followers), each solo character (a group of one), and the merchant. The owner decides which task
  holds the group. Movement, turns and cooldowns stay with each character (movement design 1.1).
- Every task **requests** the group with a kind and an owner identity. One rule table decides:
  grant, keep, wait, or refuse. The interrupted task is **suspended with its progress** or
  **cancelled**, as its row says. No task reads another task's state to decide whether it may act.
- The table is one list, highest first: escape, death recovery, Cave, lifecycle, Town, manual
  travel, Hunt turn-in, event return, event attendance, rare, Hunt mission, the add-on band (the
  fork's Achievement Hunt), farming, idle (queue A1).
- **Every member always has an assignment**: the live task of its group. A respawned character
  asks its group "what am I doing now?" and the answer is never empty (UP-3).
- **One event fact.** `presence(name)` replaces the 33 copies of "a member is at an event": 17 of
  them were precedence checks, which the table now answers, and 16 were facts, which read
  `presence`.
- **One status line per group**, `{phase, label, since, reasons}`, written only by the owner.
  The 49 `hunt.message` writes and the `paused-event` stage for non-events stop being the status
  source (queue A44, A69, A70).
- **Failures climb a ladder** that ends in "back to the safe point, start the task again, then
  retry every 60 s", never in a hold that waits for the player (00-overview "Upstream
  priorities").
- **Hooks:** one request hook for add-on tasks (rank capped at 57 to 63) and four notices (task
  started, suspended, resumed, ended), in the one hook registry.
- **Records:** a 128-entry decision ring per group, saved to disk only on a death, a task failure,
  an escalation to the safe point, or churn.
- **No new saved state.** The owner rebuilds its table at load from the records the tasks already
  save (Hunt cycle, event return, death recovery, Cave visit).

## 1. The task owner

### 1.1 Where it lives

One owner per group, on the coordinator, in `runtime/coordinator/tasks/owner.ts`. The rule table
is one module, `runtime/tasks/task-rules.ts`, that the owner and the movement rule module
(`runtime/navigation/movement-rules.ts`, movement 1.1) both import, so a group walk's movement rank
and its task rank come from the same row.

The owner sits on the coordinator because every task it ranks keeps its record there: the Hunt
cycle (`hunt/lifecycle.ts:155-176`), the event return (`events/returns.ts:194-212`), death recovery
(`scripts/combat-disengagement.cjs:77-82`), the Cave visit (`dungeons/service.ts:21-28`) and the
farm-area record (`navigation/farm-areas.ts:262`). The character learns its assignment from the
heartbeat (1.3).

The owner wraps the existing services; it does not replace their state machines. Each service
becomes a **task provider**: it keeps its own record and steps, asks the owner for the group
before it acts on travel or commands, and reacts to suspend, resume and end. A provider that is
not live still runs its observers (Hunt death counts, `hunt/recovery.ts:96-123`; quest expiry,
`hunt/expiry.ts:13-78`; rare sightings and retry evidence, `navigation/rare-hunting.ts:267-269`),
because those observers decide nothing about travel.

### 1.2 Groups and what the owner holds

Groups come from Follow and the leader, as the farming scopes do today (`hunt/scopes.ts:56-63`):

| Group | Id | Members | Providers today |
|---|---|---|---|
| party | `party:<leader>` | the leader and active, non-merchant followers on the leader's realm (`hunt/controls.ts:28-52`) | the main wiring (`application.ts:395-1782`) |
| solo | `solo:<name>` | one combat character that owns its scope and is not the leader (`application.ts:2008-2011`) | `createSoloServices` (`application.ts:1784-2007`): no escape controller (one serves the party, 1781), no party death recovery (1818-1819), a rare stub (1787) |
| merchant | `merchant:<name>` | `merchantCharacter` (`hunt/scopes.ts:57`) | the merchant dispatcher (`merchant/dispatcher.ts:275-308`), event and anniversary reserves (`merchant/event-control.ts:15-29`, `merchant/anniversary-control.ts:31-147`) |

Each group has a row for every task kind; a group whose wiring has no provider for a row never
requests it. A solo group therefore has no escape, Cave or rare task, as today, and the merchant
group has no Hunt, Cave, rare or farming task.

The owner holds only what it decides from:

| Field | What | Bound |
|---|---|---|
| `members` | the group's names, leader first | the roster |
| `live` | the task that holds the group: `{id, kind, owner, rank, members, phase, label, since, deadline}` | 1 |
| `waiting` | tasks that asked and lost, and tasks the table suspended, highest rank first; each entry `{id, kind, owner, rank, phase, label, since, expires, suspendedAt?}` | one per row (16) |
| `ladder` | the escalation step of the live task: `{step, failures, nextAt, progressAt}` | 1 |
| `status` | the group's status line (3.2) | 1, with at most one reason per row |
| `ring` | the decision ring (section 6) | 128 entries |

It holds no flags about the tasks' internals. "Is a convoy running", "is Hunt in a turn-in", "is a
member at an event" become `live.kind` or `presence(name)`.

**No saved owner state** (D12). `live` and `waiting` are rebuilt at load: each provider looks at
its own saved record and asks again, and the table orders the answers. The only loss is the
`since` stamp, which restarts at load. A leader change needs no state move either: the party scope
is the new leader's profile (`hunt/scopes.ts:51-55`), and its providers ask again from that
profile's records.

### 1.3 API

Every call carries the caller's **owner identity**: a string the provider picks and keeps, such as
`hunt:<cycleId>`, `event-return:<cycleId>`, `attend:<event>:<occurrence>`, `rare:<encounterId>`,
`death:<recoveryId>`, `cave:<visit>`, `farm:<locationId>`. The owner treats two requests with the
same identity as the same task.

- **`request({kind, owner, members, phase, label, deadline, rank?})`** returns a handle
  `{id, status}`. `rank` is read only for add-ons (section 5); core kinds take their row's rank.
  `status` is one of:
  - `live`: the task holds the group now; when it took over, the table's wind-down ran first (2.2);
  - `kept`: the same identity is already live; nothing changes;
  - `waiting`: a higher-ranked task holds the group; this one becomes live when that one ends,
    if its own `expires` has not passed;
  - `refused`: the row does not wait (for example a rare against a higher task); the provider asks
    again on its own tick if it still wants the group.
- **`update(handle, {phase, label, deadline})`**: the live or waiting task changes its sub-phase
  or label. This is the only way task text reaches the status line (3.2).
- **`release(handle, code)`**: the holder ends its task with an end code (section 5). The owner
  then makes the highest waiting task live. A handle that is no longer live or waiting is a no-op.
- **`suspend(handle, reason)`**: the owner calls it on the loser when a higher task takes over; a
  provider may also call it on its own live task to yield (for example Hunt waiting at Daisy for an
  expiry, `hunt/quests.ts:261-279`). The provider's `onSuspend` stops its travel and commands and
  keeps its record.
- **`resume(handle)`**: the owner calls it when a suspended task becomes live again. The
  provider's `onResume` continues from its record (for Hunt, today's `resumeEvent`,
  `hunt/travel.ts:30-52`). A provider cannot resume itself above a live higher task.
- **`live()`**: `{kind, owner, rank, members, since}` for readers that only need "what holds the
  group".
- **`assignment(name)`**: `{kind, owner, rank, goal}` for one member (rule 2.3.2). The heartbeat
  carries it to the character as `task: {kind, owner, rank}`, which replaces the
  `huntTurnInPriority` flag (`status/response.ts:178-181`) and its three readers on the character
  (`shared.js:11916`, 13285, 13466).
- **`allows(question, name)`**: answers a cross-group question from a column of the table (2.2):
  "may a merchant visit this member", "may this member be admitted to an event". It replaces the
  admission checks (`http/hunt-control.ts:68-71`) and the merchant target checks
  (`merchant/dispatch-composition.ts:143`, `merchant/movement-block.ts:7-9`).
- **`status()`**: the group's status line (3.2).

### 1.4 Membership changes

Today the formation route saves Follow or the leader and calls `reconcileFarmingMembership`
(`http/formation.ts:79-100`, `application.ts:700`). For each member whose scope owner changed it
retires the member from the old scope, which ends the old scope's whole convoy and deletes every
member's command for it (`hunt/membership.ts:16-24`), and joins it to the new one, with
`return-leader` for a new follower when the leader is fresh and the member has no command (60-77).
The route has no dungeon check, so a Follow or leader change during a Cave visit makes a
participant solo while it is still in the visit (correction 1).

With the owner, `groups.move(name, from, to)` runs in four steps:

1. **Wait while a rank 90 or higher task holds the member** (escape, death recovery, Cave).
   The route saves the setting at once and answers `{ok, pendingMove: true}`; the move runs when
   that task releases the member, and the status line shows "Follow change waits for <task>".
   Pending your answer (D5).
2. **Leave the old group.** The old group's live task gets `memberLeft(name)` and its row says what
   happens: Hunt drops the member and, if it owned the quest or the turn-in, goes back to quest
   checking (`hunt/membership.ts:25-35`, kept); an event return drops it from its participants; a
   group walk rebuilds for the remaining members under a new epoch (movement 5.1) instead of
   ending (D5). A member that owned the old scope takes that scope's records with it, as today:
   the Hunt is cleared and its return location restored (`hunt/membership.ts:54-57`).
3. **Join the new group.** A new follower gets the party's live task as its assignment; the
   `return-leader` command (`hunt/membership.ts:70-76`) becomes that assignment's walk when the
   live task is farming. A character that becomes solo starts a group whose providers ask from its
   own profile: farming at its saved location, or Hunt when its saved policy is `hunt` (the tick
   begins a cycle when none exists, `hunt/tick.ts:77-79`).
4. **Character state** resets as today: a new navigation revision (`hunt/membership.ts:50`), the
   saved location cleared (51), combat reset (52-53).

The merchant never moves between groups (`hunt/scopes.ts:57` keeps it its own owner).

## 2. The rule table

### 2.1 Rows

Rank: higher wins. "Walk row" is the movement row the task's walks use (movement 2.1). Ranks 56 to
70 are the group walk ranks of movement 2.5, unchanged.

| Rank | Kind | Providers today | Groups | Walk row |
|---|---|---|---|---|
| 100 | `escape` | coordinator escape stages (`scripts/party-escape.cjs:25-97`), started by death recovery (`scripts/combat-disengagement.cjs:68-76`) and the Escape party action (the `escape` port, `application.ts:714`); escape never owns a merchant (`shared.js:34`) | party | `escape` |
| 95 | `death-recovery` | party: finish or escape, regroup at Main, back to the farm or Hunt (`scripts/combat-disengagement.cjs:77-149`); every character: respawn and rejoin (`runtime/characters/roles/death-recovery.ts:18-74`) | party (both halves); solo and merchant (the character half) | `death-recovery` |
| 90 | `cave` | the visit owner (`dungeons/service.ts:66-93` entry, 221-226 held; phases `runtime/dungeons/contracts.ts:107`) | party (participants are the leader and followers at entry, `dungeons/service.ts:44-52`) | `cave` |
| 88 | `lifecycle` | Load in Main and checkpoint return (`shared.js:2445`, 2455), maintenance park (11153); spec 13 | every group | `lifecycle` |
| 85 | `town` | party Town (`town-party`, `shared.js:10692-10753`; the root `townCycle`, `hunt/scopes.ts:20`), manual Town (`navigation/manual-commands.ts:107-118`) | party, solo | `town` |
| 75 | `manual` | dashboard party travel, character travel, return to leader, force travel (`navigation/manual-commands.ts:75-147`); a bestiary pick's convoy (`navigation/monster-selection.ts:62-78`) | party, solo | `manual` |
| 70 | `hunt-turn-in` | turn-in ownership (`runtime/hunt/policy.ts:17-21`, 54-72; `hunt/tick.ts:18-23`; `hunt/quests.ts:66-75`), Retry return (`http/hunt-control.ts:84-121`) | party, solo | `group-walk` 70 |
| 68 | `event-return` | party return (`events/returns.ts:194-241`, 298-317), Franky exit (86-128), deferred returns (`events/observations.ts:357-385`, 441-463), anniversary returns | party, solo, merchant | `group-walk` 68 |
| 66 | `event-attendance` | admission (`http/hunt-control.ts:68-83`; `events/observations.ts:244-259`), trips (`events/hunt-trip.ts:12-28`), the character's event poll (`shared.js:13280-13428`), anniversary rounds and kisses (`events/observations.ts:214-238`), A/B testing | party, solo, merchant | `group-walk` 66 |
| 64 | `rare` | rare encounter and Phoenix patrol (`navigation/rare-hunting.ts:118-159` blocks, 376-424 begin) | party | `group-walk` 64 |
| 62 | `hunt-mission` | quest selection, mission travel, farming the quest, backup farming, blacklist retreat (`hunt/tick.ts:74-94`; `hunt/backup.ts:33-206`); farm-area moves under Hunt go through Hunt's convoy (`navigation/farm-areas.ts:80-107`) | party, solo | `group-walk` 62 |
| 57-63 | `addon:<name>` | add-on tasks through the request hook (section 5); the fork's Achievement Hunt at 60 (fork `application.ts:829-841`) | by registration | `group-walk` at its rank |
| 56 | `farming` | farm areas and relocation (`navigation/farm-areas.ts:257-272`), the farming return route (`http/farming-return.ts:83-99`), the return after a rare (`scripts/rare-farming-return.cjs:36-64`), the farm reunion on the character (`shared.js:13456-13485`), the convoy after leaving Hunt (`hunt/mode.ts:51-69`) | party, solo | `group-walk` 56 |
| 0 | `idle` | none today: a group with nothing to do stands where it is | every group | none |

Two rows exist only in the merchant group and come from spec 08: `merchant-job` at 65 (the job the
dispatcher picked; spec 08 ranks jobs among themselves, `merchant/priority.ts:44-50`) and
`realm-hold` at 88 (the realm owner holds the merchant, `application.ts:1662`; spec 09). They
appear in 2.5. `realm-hold` shares 88 with `lifecycle`, so whichever holds the merchant first keeps
it (rule 2.3.1); a deploy and a realm switch do not run on the merchant at once today
(`application.ts:1662` returns while either holds it).

Rank notes:
- The order from escape to farm-area moves is queue A1's working assumption, as the movement
  design maps it (movement 2.5). Pending your answer (queue A1).
- `lifecycle`, `town` and `manual` sit at their movement ranks, so a task and its walks never rank
  differently (D2).
- Ordinary farming walks (party travel to the farm, empty-spawn recovery, the return after a rare,
  the farm reunion) share rank 56 with farm-area moves; movement 2.5 named only farm-area moves
  (correction 7). Pending your answer (D2).
- The add-on band 57 to 63 sits above farming and below every core interrupt (D6).
- Anniversary rounds are event attendance. Which event a group attends when two compete is spec
  06's selection, by the user's priority list (queue A42, A43); the table sees one
  `event-attendance` task.

### 2.2 Interruption, wind-down and cross-group columns

"When interrupted" is what happens to this row's task when a higher one takes the group.
"Wind-down" is what the group does before this row's task acts, when it takes the group from a
lower one. "Merchant visit" says whether a merchant job may visit a member while this row is live
(`allows('merchant-visit', name)`).

| Kind | When interrupted | Wind-down when it takes over | Merchant visit |
|---|---|---|---|
| `escape` | nothing outranks it | none: it starts at once and cancels lower walks, as today (`shared.js:150-157`) | no (new) |
| `death-recovery` | suspended under its own escape (today phase `escaping`, `scripts/combat-disengagement.cjs:69`); resumes at `recovering` (90-91) | finish, by today's rule: foes at or below 25% HP and every survivor at or above 50% (63-67, 77-82); otherwise escape | no (new) |
| `cave` | suspended only for members outside the cave, by escape and death recovery (queue A13) | finish and regroup at Dorr: entry cancels the active convoy (`application.ts:168-171`), sends `gather` (`dungeons/service.ts:93`) and needs every member out of combat (189-202) | no (`merchant/dispatch-composition.ts:143`) |
| `lifecycle` | suspended | finish (spec 13 "Load when safe") | no |
| `town` | suspended (D3) | none; the cast is exclusive on the character (movement queue A30) | no |
| `manual` | suspended (D3) | none: a user command acts at once, as today | yes |
| `hunt-turn-in` | suspended: the turn-in record stays (`runtime/hunt/policy.ts:54-61`) and the Daisy return restarts from where the members stand | finish and the loot barrier (`hunt/loot.ts:23-89`) | no (non-preemptible return convoy, `merchant/movement-block.ts:7-9`) |
| `event-return` | suspended: the return record and each member's return progress stay (`http/return-progress.ts`) | finish: no return starts while a member still fights on goobrawl (`events/return-guards.ts:13-23`); then Town legs (`events/returns.ts:130-135`) | yes: a collection keeps the return's purpose (`navigation/merchant-interruption.ts:39-40`) |
| `event-attendance` | suspended with its occurrence; it resumes only while that occurrence is live and allowed (`events/attendance-limits.ts:116-121`), otherwise it ends `event-over` | by queue A25: a short-window boss takes the group at once, other events wait for the live walk to arrive or fail; a fighter walk waits for the healer (queue C7); the walk starts when the group has to leave (queue A12) | yes, when the walk admits the pause (`navigation/merchant-interruption.ts:17-28`) |
| `rare` | cancelled; its retry evidence stays (`navigation/rare-retry-evidence.ts:31-39`), so a newer sighting can start it again (today escape abandons it, `scripts/combat-disengagement.cjs:71`) | none: it keeps an interruptible convoy and commits into it (`navigation/rare-hunting.ts:376-388`) | yes, as for any walk |
| `hunt-mission` | suspended: the cycle keeps stage, mission and target (today `resumeStage`, `hunt/travel.ts:22`) | finish | yes, as for any walk |
| `addon:<name>` | as the add-on declares: suspend or cancel | as the add-on declares: none, finish, or finish and regroup | yes, as for any walk |
| `farming` | suspended: it resumes with a walk back to the saved farm point; a pending farm-area move is cancelled (today Hunt deaths clear it, `hunt/recovery.ts:100-103`) | finish | yes |
| `idle` | nothing to keep | none | yes |

**Wind-down steps.** Three steps, each with a deadline, run in this order for the rows that list
them:
1. **finish**: wait while a monster targets a member or a member's engaged target lives (today's
   `afterCombat` test, `shared.js:14839-14850`, which has no deadline), at most 30 s; then the task
   acts and combat steps keep defending during the walk (movement 2.4). Pending your answer (D4).
2. **regroup**: wait until every fresh member stands within the rally range of the leader, 55
   (movement queue A27), at most 20 s, the wait the shared walk already gives members that have not
   asked (`navigation/shared-walk.ts:43-45`, movement 5.2).
3. **travel**: the task's group walk (movement 5.1).

### 2.3 Rules for every row

1. **A request ranks against the live task.** A higher rank takes the group after the taker's
   wind-down. An equal rank keeps the live task. Two requests of the same kind with different
   identities follow that kind's own owner: spec 06's selection for events, spec 07's encounter
   rules for rares.
2. **Every member has an assignment.** The live task covers every member of the group. A member the
   task cannot use (not admitted, dead, offline, not in the task's participant list) still gets
   the live task's kind and goal, and its walk waits at the task's rally point or follows the
   leader. This is the UP-3 rule (4.4): the assignment never depends on a task's own participant
   list (`events/returns.ts:137-146`, 202-209 today).
3. **A waiting entry expires.** Event attendance at its occurrence's end; a rare at its encounter's
   end; Hunt at its cycle's end; manual at a newer manual command or a cancel; survival tasks when
   their record completes. Farming never expires: it is every combat group's fallback.
4. **User holds are not tasks.** A cancelled navigation intent ("select Hunt again",
   `hunt/recovery.ts:171-176`) and the fork's console Pause (queue B9) pause the group's walks
   with `pause.by = 'user'` and mark the status line "needs your action". They have no deadline,
   because the user chose them. Escape and death recovery still run under a user hold, outside the
   cave. A held Cave visit is not a user hold: it ends on its own 5 minutes after every fresh
   participant is outside (queue A13, D9).
5. **Escape and death recovery run only outside the cave.** Inside, the game answers a respawn by
   calling Nera (game `node/server.js:6224-6226`) and Cave revival is spec 05 (SRV-011), so their
   providers do not ask for a member that reports a cave. Pending your answer (queue A13).
6. **Precedence is read from the table only.** No provider reads another provider's state to decide
   whether it may act. The 17 precedence copies of the event check (3.1) and the lists in spec 01
   table 1.3 go (section 7).
7. **A suspended provider still observes.** It counts deaths, tracks expiry and records sightings,
   and it sends no travel and no commands.
8. **Deaths during an event keep today's rule.** Party death recovery does not start for a death on
   an event trip (`scripts/combat-disengagement.cjs:31`, 147-148), and the attendance death limit
   ends the occurrence for that character (`events/attendance-limits.ts:81-85`). The dead member's
   own respawn asks its group for the assignment, which is the event while the occurrence lives
   (UP-1, 4.4). Pending your answer (D8).

### 2.4 The gaps spec 01 found, closed

Spec 01 table 1.3 and section 2 found these gaps in the owners' own lists. Each closes by rank:

1. **The dungeon gate misses the solo services.** The party's farm areas and Hunt skip their tick
   while the dungeon owns the party (`application.ts:2087`, 2138), and the solo loops do not check
   (2088, 2139-2143). A solo group only holds a visit participant after a Follow or leader change
   during the visit (correction 1). With the owner, that change waits until the visit is idle
   (1.4 step 1), and a group that holds a participant has the `cave` task live at rank 90, so its
   farming (56) and Hunt (62) wait whatever group it is.
2. **Farm areas never read death recovery** (no `combatRecovery` read in
   `navigation/farm-areas.ts`). Farming (56) waits behind `death-recovery` (95), so no relocation
   starts in the `finishing` phase, the one window today's other checks leave open (correction 2).
3. **The event return reads neither escape nor death recovery** (no read in `events/returns.ts`,
   `return-guards.ts`, `return-policy.ts` or `repair-return-walk.ts`). Its dispatch already waits
   for any convoy (`events/returns.ts:231`), so the gap is the escape stages and recovery phases
   that run without one. With the owner, the event return (68) is suspended under escape (100) and
   death recovery (95) and resumes after them with its record.
4. **Admission reads neither** (`http/hunt-control.ts:68-71`; `events/observations.ts:244-259`).
   Admission becomes `allows('event-attendance', name)`, false while the member's group has a task
   above 66 live (spec 01 section 2.8).
5. **The Hunt roster cancels every non-Hunt convoy whenever the leader is fresh, during a turn-in
   too** (`hunt/participants.ts:89-92`). The cancel goes; a new walk replaces the group's walk only
   when its task ranks higher (movement 5.1). A Hunt mission (62) or turn-in (70) never replaces an
   escape-recovery (100) or death-recovery (95) walk. A turn-in still takes over an event return's
   walk, as the Daisy handoff does today (`events/hunt-return.ts:25-111`).
6. **Rare does not read farm-area relocation** (spec 01 table 1.3). Rare (64) outranks farming
   (56), the order today's passive acquisition already follows during a `farm-relocation` convoy
   (`navigation/rare-hunting.ts:839-842`).
7. **The fork's Achievement Hunt reads neither escape, death recovery nor farm relocation** (fork
   `application.ts:829-841`). As an add-on at 60 it waits behind every core interrupt and takes the
   group from farming.

### 2.5 The merchant group

The merchant is its own group with its own rows:

| Rank | Kind | Today | When interrupted |
|---|---|---|---|
| 95 | `death-recovery` | respawn (`runtime/characters/roles/death-recovery.ts:18-74`) | nothing outranks it |
| 88 | `realm-hold` | the realm owner holds the merchant (`application.ts:1662`; spec 09) | suspended |
| 68 | `event-return` | the merchant leaves an event (`merchant/event-control.ts:15-20`) | suspended |
| 66 | `event-attendance` | the merchant event reserve (`merchant/event-control.ts:22-29`) and the anniversary reserve (`merchant/anniversary-control.ts:31-147`) | suspended with its occurrence |
| 65 | `merchant-job` | the job the dispatcher assigned (`merchant/dispatcher.ts:275-308`) | suspended: the job keeps its resume state (spec 08 MJB-023), as the reserves do today |
| 0 | `idle` | stand and idle (spec 08 MJB-024) | nothing to keep |

- The job owner (spec 08) keeps its own gates (production hold, BankBoi, force stand, home
  return); the task owner sees one `merchant-job` task whose label is the job's label.
- **The merchant has its own event return** (D10). Today it can be a participant of the party's
  event return and hold a session in the party's sessions (`merchant/event-control.ts:18-19`),
  because event returns live in the root scope. Convoys never include it
  (`navigation/convoy.ts:97-131`), so its own return is a Town and a walk of its own, which is how
  it travels today. Pending your answer (D10, queue A45).
- Cross-group visits ask the fighter's group: a job that visits a member starts only when
  `allows('merchant-visit', name)` is true (2.2), which keeps today's two refusals (Cave
  participant, non-preemptible convoy member) and adds escape and death recovery.

## 3. One event fact and one status line

### 3.1 `presence(name)`: is this character at an event

Today the coordinator computes "a member is at an event" from `activeEvent || joinedEvent`
(sometimes with `mapEvent` or `eventTraveling`) in 33 places, and none of them checks the
occurrence, the realm or whether the admission is still current (spec 01 GRP-013). The raw fields
are also wrong in two known cases: staging reports `activeEvent` from spawn minus 120 s
(`shared.js:11532`, reported at 2864 and 2987), and a reload restores a stale `joinedEvent`
(`shared.js:237`, 552).

`presence(name)` returns `null` or `{event, occurrence, realm, phase, since}`:

- `walking`: the member's group has `event-attendance` live for that occurrence and has issued its
  walk, and the member's trip is open (`events/hunt-trip.ts:12-28`).
- `attending`: the member's attendance instance for a live occurrence on its own realm is not
  ignored (`events/attendance-limits.ts:43-67`, 81-85, 116-121) and it attends
  (`recordAttendance`, 92-99), or it counts as assisted participation
  (`events/observations.ts:546-579`). A dead member keeps `attending` while the instance lives,
  so its group still knows where it belongs.
- `returning`: the member is in its group's event return or has a deferred return
  (`events/returns.ts`; `events/observations.ts:357-385`).
- `null` otherwise. The status fields count only as evidence for a live occurrence on the same
  realm. Staging alone, before the walk, gives `null`, and so does a `joinedEvent` with no live
  occurrence. A Cave participant is always `null`, because events are refused for it
  (`dungeons/service.ts:241-253`). Pending your answer (queue A12).

Status ingestion computes it once per full report for the reporter, after attendance limits and
before the event observer (`application.ts:1081-1084`), and keeps it in one map per character. The
33 copies then go in two ways:

- **17 precedence reads go to the rule table.** They ask "may this task act while a member is at an
  event", which the table answers: `http/farming-return.ts:45-47`; `hunt/backup.ts:42`;
  `hunt/encounter-ownership.ts:13`; `hunt/farm-walk.ts:26`, 89; `hunt/lifecycle.ts:206`;
  `hunt/loot.ts:15`; `hunt/quests.ts:166`; `hunt/recovery.ts:185`; `hunt/retreat-restart.ts:40`;
  `hunt/route-recovery.ts:118-119`; `hunt/tick.ts:49-50`; `hunt/travel.ts:18`, 294;
  `navigation/hunt-arrival.ts:26`; `navigation/farm-areas.ts:49-50`;
  `scripts/combat-disengagement.cjs:10`.
- **16 fact reads become `presence(name) !== null`** or a phase test. They ask whether a member
  takes part in something else: `anniversary/hunt-handoff.ts:36`; `hunt/lifecycle.ts:29-30`;
  `hunt/nearby-target.ts:27`; `navigation/convoy-defense.ts:40`;
  `navigation/grouped-snapshot.ts:106`; `navigation/travel-defense.ts:149`;
  `status/response-party.ts:31`; and the nine in `runtime/combat` (claims.ts:9, 20;
  composition.ts:6; formation-recovery.ts:28; grouped.ts:70, 75; independent-approach.ts:5;
  pursuit.ts:23; unseen-primary.ts:7). The Cave's blanking of the three fields in its grouped combat
  members (`dungeons/combat.ts:29`) goes, because `presence` is already `null` there.

The six near-copies that test `joinedEvent` or `mapEvent` alone (spec 01 GRP-013) move the same
way: `navigation/rare-hunting.ts:137` and `scripts/hunt-safety.cjs:47` are precedence reads,
`navigation/manual-commands.ts:105`, `events/attendance-limits.ts:94`, 158 and
`events/observations.ts:573` are spec 06's own records and stay.

`presence` belongs to spec 06's records; this design defines its shape because spec 01 is the main
reader. Spec 06's M1 design owns how the attendance record stays correct.

### 3.2 One status line per group

Today the first check in call order writes `hunt.message`: 49 writes in 12 files
(`git grep -nE "hunt\.message *= *[^=]" refs/review/ryan-1.5 -- runtime/coordinator/hunt | wc -l`;
`-l` gives 12 files). So "Paused for combat event" hides a cancelled intent (spec 01 2.1), and
`paused-event` shows for rare and shared walks with the text "Waiting for rare-hunt travel to
finish" (`hunt/recovery.ts:147-150`).

The owner publishes one line per group, the `{phase, label, since}` idea of spec 12 Q1:

```
status = {
  group, phase, label, since,            // the top line
  reasons: [{kind, label, since, needsAction}]   // at most one per row
}
```

- `phase` is `<kind>:<sub-phase>` of the live task, for example `hunt-mission:travel` or
  `event-return:town`. `label` and the sub-phase come only from the task's own `request` and
  `update` calls (1.3).
- `reasons` lists every waiting task's label and every user hold (2.3 rule 4), so the user sees
  why Hunt does not resume after the event. Pending your answer (queue A44).
- **Top line:** a reason with `needsAction` (a user hold) comes first, then the live task. Pending
  your answer (queue A70).
- Every member's card shows its group's line. A member's own survival state (dead, respawning,
  escaping alone) adds one line from the movement owner's `live()` (movement 1.3), so a member's
  card can differ from its group's while it recovers. Pending your answer (D13, queue A69).
- Convoy progress reaches the card through the same label: the walk's phase is the task's
  sub-phase (queue A71), and convoy text stops going to the merchant log
  (`application.ts:416`, 1801).
- The line is derived state: it is not saved, and it is written only when the top line or the
  reason set changes.

The free-text races it replaces: `hunt.message` as the status source (the 49 writes stay only as
the Hunt provider's label for its own phases, given through `update`); the `paused-event` stage for
non-events and its message builders (`hunt/recovery.ts:140-166`); the rare pause text
(`hunt/tick.ts:95-99`); Hunt showing death recovery's reason (`hunt/tick.ts:58-61`); and Hunt
passing on the farm-area message (`hunt/recovery.ts:167-169`).

## 4. Failure handling

### 4.1 The task ladder

Movement's ladder (movement 3.2) handles a walk that fails; it ends at "walk to the safe point,
end the request with `returned-to-safe`, tell the requester". This ladder is the requester's
answer, one level up. A failure moves the live task one step up; progress moves it back to step 0.
Progress is a phase advance toward the task's goal: a Hunt kill or stage change toward the quest, an
arrival at the event or the farm, a return leg completed. Counts choose the step; no count ends the
ladder.

| Step | What the owner does | Today's nearest equivalent |
|---|---|---|
| T0 walk ladder | the task's walk climbs movement's steps 0 to 3 (replan, other route, relocate, regroup) | per-walk retries (movement 3.2 table) |
| T1 alternative | the task's own alternative: the next spawn of the same monster (`hunt/route-recovery.ts:148-184`), the next farm area (`navigation/farm-area-recovery.ts:47-65`), the lone walk for an event (`shared.js:15081`) | the same code, which then holds |
| T2 regroup | the group regroups at the leader (2.2 wind-down step 2) and the task starts its current phase again | regroup budgets that end (movement 3.2) |
| T3 safe point | the group walks to the task's safe point (movement section 4: `death` for survival, `town` for Town and event returns, the saved farm point for farming tasks) and the task starts again from its first phase | none |
| T4 fall back | the task ends with `failed:<code>`; the highest waiting task becomes live, or farming at the saved farm point, or idle at the safe point | dead-end holds (4.2) |
| T5 wait and restart | a group whose fallback also fails waits at its safe point and asks again after 5, 15, 30, then 60 s, and the 60 s wait repeats; the status line shows "stuck for N minutes" after 5 minutes | death recovery's farm return waits 5, 15, 30, 60 s, and the 60 s repeats (`scripts/combat-disengagement.cjs:113`) |

The backoff is movement's N7, so a task and its walk back off on the same clock.

### 4.2 Fixed counts and dead-end holds at the task level, and what replaces them

Movement 3.2 lists every count inside a walk. These are the ones that end a task or leave a group
waiting for the player:

| Count or hold | file:line | Replacement |
|---|---|---|
| Hunt restart after an exhausted retreat, once per escape id | `hunt/retreat-restart.ts:66-82` (check at 68, 74) | the escape task's ladder (movement UP-2), then T3 for Hunt |
| "No reachable <monster> spawn remains in this Hunt cycle" hold | `hunt/route-recovery.ts:160-167` | T1 exhausted: T3 restarts the mission from the safe point; T4 skips the mission (the farm-area path already skips, `navigation/farm-area-recovery.ts:33-40`) |
| "Farming travel paused: no reachable zone; select a farming area to retry" | `navigation/farm-area-recovery.ts:41-44` | T3 back to the saved farm point, then T5 |
| `geometry-mismatch` pause with no retry | `navigation/farm-area-recovery.ts:96-99` | T5 backoff; queue A51's single retry becomes the first T5 wait. Pending your answer (queue A51) |
| "Daisy return held; request Retry return to resume" | `hunt/recovery.ts:68-73`; Retry route `http/hunt-control.ts:84-121` | the turn-in climbs T0 to T5; Retry stays as a manual shortcut to step 0 |
| Hunt drift resets with no bound | `hunt/route-recovery.ts:245-251` | a drift reset counts as a T0 failure, so it climbs the ladder instead of resetting it; the reset no longer cancels a running native attempt (queue A48's second half). Pending your answer (queue A48, D11) |
| Cave travel repairs, 3 | `dungeons/travel.ts:98-147` (cap at 142) | the Cave leg's ladder; inside the cave the next repair waits on the T5 backoff in place of a T3 walk, because a Cave has no safe point, and the run's own expiry ends the visit (`dungeons/service.ts:221-226`); the status line names the member and its receipt error (queue A55) |
| merchant home return, 3 attempts, then "retry a queued job to resume" | `merchant/home-recovery.ts:95-99` | spec 09's realm owner climbs the same ladder; the merchant group's `realm-hold` keeps a due step at all times. Pending your answer (queue A90) |
| a failed rare walk, never retried | `shared.js:3688` | movement queue A32: step 0, then the rare task ends `failed:route` and the group resumes its waiting task |
| an event join refused, retried every 1 s or 10 s | `runtime/characters/roles/death-recovery.ts:43-46`; `shared.js:13418-13421` | `cant_join` and `join_too_late` end the attendance with `event-over`; other replies climb T5 (queue A41) |
| a retry-exhausted event walk | `events/failed-entry.ts:51-66` | kept: it already ends the attendance with a forced return, a next step |

### 4.3 Invariants

The owner checks four on every coordinator task tick:

1. **Every group has exactly one live task**, idle included, and it has a deadline, a walk, or a
   ladder step with a due time. Idle's due time is the next task tick, when the owner asks every
   provider again. A live task with none of these is a bug; the owner records it in the ring and
   starts the next ladder step.
2. **Every member has an assignment** (2.3 rule 2).
3. **Every waiting entry has an expiry** (2.3 rule 3), so the list cannot keep a stale task.
4. **Every task end names the next task**: the end code plus the kind that became live. A
   `journey.ended` from movement always reaches the task that asked for the walk, which answers
   with a new request or a ladder step (movement 3.2 invariant 3).

### 4.4 Upstream cases at the task level

Movement 3.3 traces UP-1, UP-2 and UP-3 through the walk. Here is the task half.

#### UP-1: a party death during an event, then no way back

Today (movement 3.3 UP-1 has the full chain): party death recovery skips event deaths
(`scripts/combat-disengagement.cjs:31`) and returns while any member is at an event (134); each
dead character respawns and calls the rejoin (`runtime/characters/roles/death-recovery.ts:40-47`),
which asks the coordinator for a shared walk and can get the old failure of the party's earlier
event walk on every try (`navigation/shared-walk.ts:343-349`).

With the owner:
- The group's live task stays `event-attendance` for the occurrence (2.3 rule 8). A member's death
  does not end it.
- Each respawned member reads its assignment from the heartbeat: `event-attendance`, with the
  occurrence's walk identity as the goal. Its rejoin is movement's `death-recovery` walk toward that
  goal (movement 3.3).
- When every member died, they all respawn at Main and the attendance task runs its wind-down
  again: regroup at Main, then a new walk under a new epoch. A failed earlier walk is a ladder step
  of the task (T0 to T3), not an answer stored for later requests.
- When the occurrence ends before the members are back, the task ends `event-over` and the group
  gets its next task (UP-3).
- Proof: G9 (10.3), with movement's UP-1 scenario.

#### UP-3: after a respawn, the character does not go back to its activity

Today: when the event ended before the rejoin, the rejoin returns `cancelled`
(`shared.js:13724-13726`) and death recovery clears its pending return without a farm return
(`runtime/characters/roles/death-recovery.ts:48-50`); the event return reaches a member only when
it is in the return's participant list (`events/returns.ts:137-146`, 202-209).

With the owner:
- The event's end is a task end, `event-over`. The owner makes the group's next task live: the
  event return while any member is still on the event map, else the suspended task (Hunt mission
  or farming) with its record.
- The respawned member's assignment is that live task, by rule 2.3.2, whether or not the return
  listed it. If the live task is the event return and the member already stands at Main, its Town
  leg counts as done and it waits for the checkpoint walk.
- The character asks no question that can go unanswered: the heartbeat names the assignment on
  every full response, and movement's 10 s fallback to the saved farm point (movement 3.3 UP-3)
  covers only a lost heartbeat.
- Proof: G10 (10.3), with movement's UP-3 scenario.

#### UP-2

The escape walk home and its deadlines are movement's (movement 3.3 UP-2). At the task level the
escape and death recovery tasks always have a due step (invariant 1), so a stalled `recovering`
stage is a ladder input and never a final state.

## 5. Hooks

Declared in the one hook registry, `runtime/hooks/registry.ts` (movement section 6). With nothing
registered, each hook point is one check of an empty list.

| Hook | Kind | Receives | May return | Decision point |
|---|---|---|---|---|
| `task.request` | request | `{group, groupKind: 'party' or 'solo' or 'merchant', members, live, tick}` once per task tick per group | one request `{kind: 'addon:<name>', owner, rank, members, phase, label, deadline, interrupted: 'suspend' or 'cancel', windDown: 'none' or 'finish' or 'finish-regroup'}`, or nothing | ranked by the rule table |
| `task.started` | notice | `{group, taskId, kind, owner, rank, members, resumed}` | nothing | after `live` and after `resume` |
| `task.suspended` | notice | `{group, taskId, kind, owner, by}` | nothing | when the table suspends a task |
| `task.resumed` | notice | `{group, taskId, kind, owner}` | nothing | when a suspended task becomes live again |
| `task.ended` | notice | `{group, taskId, kind, owner, code, next}` | nothing | every end |

- **Rank cap:** an add-on task ranks from 57 to 63, above farming (56) and below rare (64), so no
  add-on outranks the Hunt mission's interrupters, events, the user's commands, the Cave or
  survival. The owner clamps a value outside the band and records the clamp in the ring. An add-on
  above Hunt missions fits the band at 63 without a core change.
  Pending your answer (D6).
- **An add-on's walks** go through movement's request path with the task's rank, so movement's own
  cap (74, movement section 6) never binds a task add-on.
- **End codes are a fixed list,** not text: `done`, `released`, `replaced:<kind>`,
  `cancelled:<kind>`, `expired`, `event-over`, `member-left`, `failed:<code>`,
  `returned-to-safe`, `user`, `runtime-replaced`.
- **The status line is not a hook.** An add-on's label reaches it through its request and
  `update`, so no third hook kind is needed.
- **Fork features as add-ons:** Achievement Hunt (queue B4 to B7) registers `task.request`; it
  was built beside the current owners (spec 01 section 3).

## 6. Bounded records

- **Decision ring:** 128 entries per group, in memory. An entry is `{at, decision, kind, owner,
  rank, members, code, by, ladderStep}`, about 150 bytes, so about 19 KB per group. Decisions are
  requests, keeps, waits, refusals, takeovers, suspends, resumes, ends, membership moves and ladder
  steps. A label change is not a decision.
- **Not in the heartbeat or the dashboard state.** The ring is read on demand through a
  diagnostics lease (movement queue A73).
- **Saved to disk only when:**
  1. a member of the group dies (the death the heartbeat reports, `shared.js:1079-1097`);
  2. the live task reaches ladder step T3;
  3. a task ends with `failed:<code>`;
  4. churn: 6 changes of the live task within 60 s. An event round changes it three times
     (attendance, return, resume), so 6 is above any normal sequence.
- **Pruning:** at most 20 saved snapshots per group and none older than 7 days, pruned when a new
  one is written.
- The comparison log used during migration (10.2) is a separate ring of the same size and goes
  with the comparison code.

## 7. What it replaces and deletes

### 7.1 On the current console

| Stand-in | file:line | Why it goes |
|---|---|---|
| `eventOwnsTravel` and its readers | `runtime/hunt/policy.ts:82-99`; `hunt/recovery.ts:159`; `hunt/backup.ts:41`; `navigation/farm-areas.ts:197` via `application.ts:403` | the rule table |
| Hunt's combat event pause and its two travel re-checks | `hunt/travel.ts:15-28`, read at `hunt/tick.ts:92` and `hunt/travel.ts:262`, 277 | the owner suspends Hunt; Hunt resumes on `resume` |
| `paused-event` for holders that are not events, and its message builders | `hunt/recovery.ts:140-166` | the status line's reasons |
| rare pause, death recovery wait and loot gate in the Hunt tick | `hunt/tick.ts:39-44`, 58-61, 88, 95-99 | rank: Hunt is suspended while a higher task is live |
| Hunt roster cancel of non-Hunt convoys | `hunt/participants.ts:89-92` | walk replacement by rank (movement 5.1) |
| dungeon gate wrappers | `application.ts:1741-1745`, 1073, 2087, 2138 | the `cave` row and rule 2.3.5 |
| four copies of each solo loop | `application.ts:2012-2020`, 2086-2089, 2136-2144, 2208-2211 | one loop over groups: `for (const group of groups()) group.tick()` |
| the solo walk allow list during a turn-in | `application.ts:2002` | rank |
| `huntTurnInPriority` | `status/response.ts:178-181`; `shared.js:11916`, 13285, 13466 | the heartbeat `task` assignment |
| 17 precedence copies of the event check, and two near-copies | section 3.1 | the rule table |
| 16 fact copies of the event check, and `dungeons/combat.ts:29` | section 3.1 | `presence(name)` |
| event return writes into Hunt | `events/hunt-resume.ts:78-87`; `events/hunt-return.ts:87`, 93 | Hunt resumes from its own record |
| anniversary handoff writes into Hunt | `anniversary/hunt-handoff.ts:51-58` | same |
| Hunt writes into the farm-area and anniversary records | `hunt/recovery.ts:100-103`; `hunt/mode.ts:44-49`; `hunt/lifecycle.ts:214-218`; `hunt/expired-anniversary.ts:21-23` | farming is suspended or its pending move cancelled by the table; the anniversary yield is rank |
| farm areas' owner checks | `navigation/farm-areas.ts:196-198`, 240-245 (event return, escape), 254-258, 266 | rank |
| the farming return route's refusal list | `http/farming-return.ts:38-59` | rank |
| admission's own checks | `http/hunt-control.ts:68-71` | `allows('event-attendance', name)` |
| `combatEventHandoff`, root-wide | `events/hunt-trip.ts:23-24`, 30-33, 44; read for the party's event target cleanup at `navigation/grouped-snapshot.ts:264-274` | per group (queue A45) |
| retreat restart once per escape id | `hunt/retreat-restart.ts:29-83` | the ladder |
| the task entries in the reunion blocker list | `shared.js:13457-13459`, 13466-13467, 13470 (dungeon, event exit, escape, turn-in, rare, anniversary and event entries) | the reunion runs only while the member's assignment is `farming` |
| the task entries in the follow decision | `shared.js:17705-17706` | the assignment |
| merchant target checks | `merchant/dispatch-composition.ts:143`; `merchant/movement-block.ts:7-9` | `allows('merchant-visit', name)` |
| dead-end holds | section 4.2 | the ladder |

The movement entries of the reunion list (attackers, banking, Town, convoys) are movement's
(movement 8.1).

### 7.2 On the fork (af92de45)

| Stand-in | file:line | Why it goes |
|---|---|---|
| Achievement Hunt's busy list | fork `application.ts:829-841` | an add-on at 60 through `task.request` |
| Achievement Hunt waiting on any event session | fork `application.ts:829-832` | `presence` for its members (queue B4) |
| Achievement Hunt target switches marking events as manual travel | fork `navigation/monster-selection.ts:76` | automated switches are not manual commands (queue B4, spec 06 question 1) |
| farm relocation moving the party off Achievement Hunt's target, then a walk back every 30 s | no `achievement` in fork `navigation/farm-areas.ts`; fork `hunt/achievement-hunt.ts:77`, 389 | the add-on is live above farming, so farming's relocation waits; queue B7's same-target relocation becomes the add-on's own step |
| console Pause snapshot and restore | fork `lifecycle/console-control.ts:234-283` | a user hold (2.3 rule 4, queue B9) |
| the seventh event check copy | fork `lifecycle/console-control.ts:100` | `presence` |

## 8. Efficiency

### 8.1 What goes away

| Cost | Where today | After |
|---|---|---|
| a Hunt convoy cancel and a later restart for every staging window, stale `joinedEvent`, rare walk and farm-recovery walk | `hunt/travel.ts:25`; `hunt/recovery.ts:163` | only an event walk that starts suspends Hunt (queue A12), and only once |
| a convoy ended for every member on a Follow change | `hunt/membership.ts:16-24` | the walk rebuilds for the rest (D5) |
| non-Hunt convoys cancelled by the Hunt roster, then started again by their owner | `hunt/participants.ts:89-92` | none |
| 33 event field tests per member, each on its own tick or report | section 3.1 | one `presence` per full report |
| four loops over the solo services on separate clocks, each with its own gate list | `application.ts:2012-2020`, 2086-2089, 2136-2144, 2208-2211 | one loop over groups |

### 8.2 What the owner adds

- Per task tick per group: one pass over at most 16 waiting entries and one rank compare per new
  request.
- Per full report: one `presence` computation, a few map lookups.
- Per heartbeat response: `task: {kind, owner, rank}` per member, about 60 bytes, in place of one
  boolean.
- Per dashboard state: one status object per group, about 200 bytes with two reasons.
- Memory: about 19 KB per group for the ring.

### 8.3 How both are measured

Before and after, on the same farm and party, with the method's benchmark set
(docs/implementation/00-method.md "Proof of efficiency"):

- **Console cost:** CPU time per coordinator tick; persistence writes per minute
  (`tools/benchmark-persistence.mts`); heartbeat response bytes and dashboard payload bytes
  (`scripts/benchmark-dashboard-*.cjs`).
- **Game cost:** convoy starts and cancels per hour by cause, read from the convoy history
  (`recordConvoyHistory`, as in `navigation/merchant-interruption.ts:26`); route plans per minute.
- **Play results:** Hunt kills per hour; seconds of event time lost (arrival time minus spawn
  time); seconds a group spends with no live step (invariant 1); recovery steps per hour by ladder
  step; e2e runs through `tools/sim/e2e-benchmark.mts` and `tools/sim/e2e-rate-benchmark.mts`.
- **Pass rule:** no row gets worse on console cost or game cost; the owner does not ship until it
  holds (00-overview "No efficiency regressions").

## 9. Player-visible changes

Every change on purpose. Anything not listed stays the same.

1. **Hunt keeps farming during an event's staging lead** until the walk to the event starts, and a
   stale event field after a reload no longer pauses it. (queue A12)
2. **The status line shows every reason**, with the one that needs you on top: "Paused for combat
   event" no longer hides "select Hunt again", and a rare or shared walk no longer shows as an
   event. (queue A44, A70)
3. **Escape and death recovery run outside the cave during a held visit**, so a member that dies
   after the visit is recovered. (queue A13)
4. **No farm relocation starts during death recovery.**
5. **An event return waits behind escape and death recovery and continues after them.**
6. **Hunt no longer cancels an escape or death-recovery walk**, during a turn-in or otherwise.
7. **A respawned character goes back to its group's current activity**, including its farm or
   Hunt when the event it died at has ended. (UP-1, UP-3)
8. **Nothing waits for you after a failure.** "No reachable spawn remains", "select a farming area
   to retry", "request Retry return" and the merchant's "retry a queued job to resume" holds
   become the ladder: back to the safe point, start again, then retry every 60 s with a "stuck for
   N minutes" line. (upstream priority; queue A48, A51, A55, A90)
9. **A Follow change waits while the member is in an escape, death recovery or a Cave visit**, and
   the rest of the party keeps walking when a member leaves mid-walk. (D5)
10. **Manual travel during an escape or death recovery waits for it to finish** instead of ending
    it. (D7)
11. **A solo character's event trip no longer holds the party**, and the merchant leaves events on
    its own. (queue A45, D10)
12. **A merchant visit never starts while the member escapes or recovers from a death.**
13. **Fork: Achievement Hunt waits for escape and death recovery**, and Achievement
    Hunt farms while no member attends an event. (queue B4)
14. **A Cave visit ends on its own after a hold window** once every fresh member is outside, if
    you choose D9.

## 10. Migration

### 10.1 Steps

Each step is one shippable change with its own rollback. A setting
`PARTY_TASK_OWNER=off|compare|on` selects the path, as `PARTY_MOVEMENT_OWNER` does for movement
(movement 11.1).

1. **Records first, no behaviour change.** Add the ring and the end codes; compute the status line
   from today's fields and show it beside the current Hunt line.
2. **`presence` beside the 33 copies.** Compute it and log every report where it and the raw fields
   disagree. This alone shows how often staging and stale fields pause Hunt today.
3. **The owner in comparison mode** (10.2).
4. **Survival and the Cave:** escape, death recovery and the Cave as tasks; the dungeon gate becomes
   the `cave` row, with rule 2.3.5. This step follows movement step 3 (safe goals), because the
   survival tasks hand their walks to it.
5. **Events:** attendance and return as tasks; admission reads `allows`; the merchant's own return.
6. **Hunt as a provider:** delete the pause order, `eventOwnsTravel`, the roster cancel and the
   writes from other owners; Hunt text goes through `update`.
7. **Farming, farm areas and rares as providers.**
8. **Membership through `groups.move`;** the four solo loops collapse into one.
9. **The task ladder** (section 4), with movement step 8 (the walk's ladder).
10. **Fork add-ons** through `task.request`, then delete the fork stand-ins (7.2).
11. **Delete the current stand-ins (7.1) and the comparison code.**

**Rollback:** each step is one commit or a short series, reverted on its own; steps 4 to 9 also fall
back to `PARTY_TASK_OWNER=compare` without a deploy of old code.

**Every step** (00-method "Rules every change follows", from the console's `AGENTS.md`):
- Its E2E scenarios from 10.3 are written, with their measures and thresholds, before its code,
  and pass on ChronAL virtual time before the next step starts.
- It ends with `npm run typecheck` and a completed console artifact. The artifact stays staged; the
  user decides when to load it.
- Every step touches the coordinator, so each starts from `runtime/coordinator/README.md` and edits
  maintained sources: the TypeScript under `runtime/coordinator/` and the legacy services it loads
  (`scripts/combat-disengagement.cjs`, `scripts/party-escape.cjs`, `scripts/hunt-safety.cjs`,
  `scripts/rare-farming-return.cjs`), never the generated `.build/runtime/coordinator-*.cjs`
  bundles.
- Game-object types the owner reads (character status, monster) come from `typed-adventureland`
  through `Pick` or indexed access; the request, handle, notice, status and ring types are the
  console's own protocol and stay local.

### 10.2 Comparison mode

With `compare`, every provider still runs its own checks and acts as today. Beside each tick the
owner computes what it would decide (which task is live, which wait, which are suspended or
cancelled, each member's assignment, the status line) and writes a ring entry whenever it differs
from what the providers did. A separate check resolves each difference as a bug in the owner, a bug
in the old code, or an intended change in section 9. The owner takes over when the list is empty
on real play (00-method "Proof on real play"). The comparison costs one table pass per tick per
group, and 8.3 measures it separately.

### 10.3 Tests

Current tests that prove each rule (all in `scripts/tests/` or `e2e/` on the current console;
spec 01 section 4 maps them):

| Rule | Current tests |
|---|---|
| groups and Follow changes (1.2, 1.4) | `solo-hunt.test.cjs`, `coordinator-hunt-controls.test.cjs`, `coordinator-hunt-composition.test.cjs`, `hunt-geometry-roster.test.cjs`, `ui-cleanup-behavior.test.cjs` |
| turn-in over events (2.1) | `hunt-event-priority.test.cjs`, `hunt-safety.test.cjs` |
| event pause and resume (2.2) | `e2e/live-game.spec.ts` "Goobrawl interrupts Hunt" |
| Cave gate (2.3 rule 5) | `daily-dungeons.test.cjs` |
| rare yields (2.1) | `rare-hunting.test.cjs` |
| reunion blockers (7.1) | `farm-reunion.test.cjs` |
| anniversary yields to the turn-in (2.1) | `hunt-farm-walk.test.cjs` |

These are the baseline (00-method "Proof of function", step 1). Four change on purpose, and each
changed expectation is shown old and new side by side (method step 4):
- `hunt-safety.test.cjs` tests that expect the call-order message ("Paused for combat event" over
  the cancel text) expect the status line's reasons instead (queue A44, A70).
- `daily-dungeons.test.cjs` "recovery paused in Cave" keeps its in-cave case and gains a held case
  where recovery runs (queue A13).
- `solo-hunt.test.cjs` Follow on and off cases that expect the whole convoy to end expect the walk
  to rebuild for the rest (D5).
- `farm-reunion.test.cjs` blocker tests for convoy, anniversary and event exit expect the
  assignment check instead of the flags.

Each changed unit test changes only its expected value. Its proof moves to the E2E scenario of the
same rule below, and it retires once that scenario passes (method step 5).

#### The owner's proof: ChronAL E2E scenarios by rule

Every scenario is a gameplay E2E under `e2e/` on ChronAL virtual time, run through `npm test` with
the live fixtures (spec 15 TST-026 to TST-029): a disposable game server, the production
coordinator and native game clients, with browser, persistence and telemetry coverage. Each run
writes the e2e report artifact and removes its own workspace. Each scenario follows 00-method
"Every test is defined, measurable and labelled":
- **Label:** the rules it proves and the gaps it leaves.
- **Setup:** map, monsters, gear, settings, Follow and positions, fixed in the scenario file.
- **Measures:** counted from the decision ring (section 6), the end codes (section 5), the status
  line, the heartbeat `task` field and the convoy history.
- **Invariants:** the four invariants of 4.3, checked on every coordinator task tick; the run fails
  at the first break and saves the ring with it.
- **Checks:** asynchronous state is read with a bounded poll for exact values from one fresh
  snapshot, with no sleeps and no widened timeouts. No assertion reads source text, callback order
  or CSS classes.

**G1. Ranked takeover, suspend and resume** (2.1, 2.2, 2.3 rules 1 to 3; D3).
- Setup: a warrior, mage and priest on a Hunt mission walk. A walk event (not short-window) opens;
  the party attends, the event ends, the return runs. A second run starts a rare during farming and
  a manual party travel during the rare.
- Measures and thresholds: decisions whose live task differs from the 2.1 table: 0; Hunt mission
  index and target after resume equal to before the event: every case; seconds from the return's
  end to the Hunt mission walk request: under 2; rare tasks resumed after the manual travel: 0
  (cancel row); manual travel resumed after a higher task: every case.
- Gaps: only pairs that meet in play; I1 covers the full table. No other players.

**G2. Survival over every task** (2.4 gaps 2 to 4).
- Setup: a death while farming with a competitor standing in the area during `finishing`; a death
  during an event return; a manual Escape during a Hunt turn-in; a respawned member asking for
  event admission during death recovery.
- Measures and thresholds: farm-area moves started while death recovery is live: 0; event return
  walks dispatched while escape or death recovery is live: 0; admissions granted while the member's
  group has a task above 66 live: 0; suspended tasks that resume after survival ends, if not
  expired: all.
- Gaps: escapes in parties without the trio (spec 05 SRV-Q6) run the independent path only.

**G3. Cave and groups** (2.4 gap 1; 1.4 step 1; queue A13; D5, D9).
- Setup: a visit in `active`; the user turns Follow off for one participant, then changes the
  leader; the visit ends to `held`; a member dies outside the cave in `held`.
- Measures and thresholds: solo Hunt or farm-area ticks acting for a visit participant: 0; Follow
  moves applied while the visit is not idle: 0, applied within one tick of the visit's end: all;
  seconds from the held death to the respawn: under 5; walks from Hunt or farming while held: 0
  (pending queue A13, D9).
- Gaps: an offline participant at release is queue A53's own scenario.

**G4. Walk replacement by rank** (2.4 gap 5).
- Setup: a Hunt turn-in becomes due while an escape-recovery convoy runs, then while a
  death-recovery convoy runs, then while an event return walks.
- Measures and thresholds: walks of a task ranked at or above the Hunt task's rank cancelled by
  Hunt: 0; an event return walk taken over by the turn-in: 1, with the return suspended, not
  cancelled.
- Gaps: none known.

**G5. One event fact** (3.1; queue A12).
- Setup: a reload restores a stale `joinedEvent` with no live event; a walk event's staging opens
  at spawn minus 120 s with the spawn 30 s of walking away; a fighter on another realm reports the
  same event live.
- Measures and thresholds: Hunt suspensions with no member `walking` or `attending`: 0; seconds
  between the event walk's start and Hunt's suspension: under 1 coordinator tick; `presence` on the
  wrong realm: 0; members whose `presence` and the old copies disagree, each listed with the case:
  reported.
- Gaps: the route time estimate behind the walk's start is spec 06's (queue A12, B13).

**G6. Status line** (3.2; queue A44, A69, A70, A71).
- Setup: an event pause while one member's intent is cancelled; a rare walk; a farm-recovery walk;
  a Hunt convoy in each phase.
- Measures and thresholds: status phases naming an event while no event task is live or waiting:
  0; the reason set equal to the waiting entries plus user holds: every tick; the top line is a
  `needsAction` reason whenever one exists: every tick; status writes per minute at most the live
  task and label changes per minute.
- Gaps: the card layout is spec 12's.

**G7. Membership moves** (1.4; D5).
- Setup: Follow off for a non-owner member during a Hunt mission walk; Follow on for a solo
  character farming elsewhere; a leader change during farming.
- Measures and thresholds: walks of the remaining members ended by the move: 0; ticks until the
  moved member has an assignment from its new group: at most 1; joiners whose assignment is the
  party's live task: all.
- Gaps: moves during escape and the Cave are in G2 and G3.

**G8. Task ladder** (4.1, 4.2; movement N7).
- Setup: a Hunt target whose every spawn is unreachable; a farm area with no reachable zone; a
  Daisy return whose route is blocked for 10 minutes; the merchant's home realm refusing logins
  for 10 minutes. The run advances 15 minutes of virtual time.
- Measures and thresholds: seconds any group spends with no due step, walk or deadline: never more
  than 60; dead-end hold texts ("No reachable", "select a farming area to retry", "request Retry
  return", "retry a queued job"): 0; ladder steps that do not match the failure count: 0; waits of
  5, 15, 30, 60 and 60 s, each within 1 s; the "stuck for N minutes" line within 1 s after 5
  minutes; the Daisy return completes within 2 minutes after the block lifts.
- Gaps: the merchant case needs spec 09's realm owner on the same ladder.

**G9. UP-1 at the task level** (4.4; with movement's `live-event-death-rejoin.spec.ts`).
- Setup: the party at Mr. Green, then at the Headless Horseman; one member dies; in a second case
  every member dies; the earlier event walk is set to failed.
- Measures and thresholds: heartbeats where a respawned member's assignment is not the live
  occurrence's attendance while it lives: 0; seconds from the last respawn to every member back in
  boss range while the event lives: under 180; walk requests answered with the old failure: 0.
- Gaps: events without a walk path, such as Slenderman's search.

**G10. UP-3 at the task level** (4.4; with movement's `live-event-death-after-end.spec.ts`).
- Setup: a member dies at an event and the event ends before it respawns; one case farms, one runs
  Hunt; a third case leaves the member out of the return's participant list.
- Measures and thresholds: heartbeats after the respawn whose assignment is not the group's live
  task: 0; seconds the character stands at spawn with an empty assignment: 0; seconds from the
  respawn to back at the farm or Hunt: under 180.
- Gaps: none known.

**G11. The merchant group** (2.5; D10).
- Setup: the merchant attends an event with the party; then a merchant job visits a fighter during
  farming, during a Hunt turn-in and during an escape.
- Measures and thresholds: the merchant in a party convoy: 0; the merchant in the party's event
  return: 0 (pending D10); visits started into a member whose live task refuses them: 0; visits
  into farming that complete: all.
- Gaps: the merchant's own job choice is spec 08's scenario set.

**G12. Hooks** (section 5; D6).
- Setup: a fixture add-on asks for rank 90 while a Hunt mission, an event and an escape run; on the
  fork, Achievement Hunt as an add-on during an event and a farm relocation.
- Measures and thresholds: add-on tasks live above 63: 0; clamps in the ring: one per request
  outside the band; tasks with exactly one `task.started` and one `task.ended`: all; Achievement
  Hunt live while a member's `presence` is not null: 0 (queue B4).
- Gaps: add-ons other than the fixture and Achievement Hunt.

**G13. Records and comparison mode** (section 6; 10.2).
- Setup: a fault injector forces 6 live task changes within 60 s; a member dies; a task fails to
  T3; the run then advances 8 days with 25 snapshot triggers. A second run uses the G1 setup with
  `PARTY_TASK_OWNER=compare` beside an `off` run on the same seed.
- Measures and thresholds: snapshots per trigger: 1; ring entries after 200 decisions: 128; saved
  snapshots per group after pruning: at most 20, none older than 7 days; ring fields in the
  heartbeat and dashboard payload: 0; in compare mode, convoy starts and cancels per minute equal
  to the `off` run, and differences with no ring entry: 0.
- Gaps: disk failures while saving.

The efficiency measures and their pass rule are in 8.3; they run on the G1, G2 and G7 setups.

#### Isolated tests, where no E2E can reach the case

Each failure list below comes before the code (AGENTS.md: write down every way the system could
fail, then write the code). Each test loads the TypeScript module it names.

**I1. The rule table** (`runtime/tasks/task-rules.ts`; 2.1, 2.2).
- Why no E2E: 16 rows give 256 ordered pairs, and most of them, such as `lifecycle` against
  `event-return` or an add-on against `cave`, never meet in a run that can be set up. G1 to G4
  cover the pairs that meet in play.
- Expected values: the 2.1 and 2.2 tables as written in this design, typed in by hand, not
  generated from the module under test.
- Failure list:
  1. A lower rank takes the group from a higher one.
  2. An equal rank takes over instead of keeping the live task.
  3. A row that suspends cancels, or a row that cancels suspends.
  4. A suspended entry has no expiry, or survives past it.
  5. A task's walk rank differs from its task rank (movement 2.5).
  6. An add-on rank outside 57 to 63 is not clamped, or the clamp is not recorded.
  7. The merchant visit or admission column answers differently from 2.2.
  8. A group kind requests a row it has no provider for (escape in a solo or merchant group).
  9. The character and the coordinator rank the same pair differently.

`presence` across two realms (3.1) is reached by G5 when the live fixtures run two realms; if spec
15 shows they cannot, it becomes I2 with this failure list: a live occurrence on another realm
counts; a staging entry counts before the walk; a `joinedEvent` with no live occurrence counts; an
ignored instance counts; a dead attending member drops to `null` while the instance lives; a Cave
participant is not `null`.

## 11. Decisions for you

Each item: the recommendation, why it beats the others, and the negatives of every option. Items
from the review queue use its recommendation as the working assumption.

### Decided 2026-10-26

These decisions replace any working assumption or recommendation for the same item elsewhere in this document.

- **D7** (A travel command during an escape or death recovery; decided by your answer): Option 2: a travel command during an escape or death recovery ends it at once, and the console carries on safely from wherever the party ends up.
- **A1** (GRP-Q1: what wins when two jobs want the party; decided by your answer): Hunt and Achievement Hunt become on and off toggles that cannot both be on, Auto picks default or scatter farming, and the fixed order covers only the rest.
- **A13** (GRP-Q5, Cave Q1 and Cave Q3: after the Cave run; decided by your answer): Escape and death handling work after the Cave, and the party resumes once everyone is out and walking, with no fixed wait; Release still ends it sooner.
- **A44** (GRP-Q3 and MH-Q2: the status line when several things hold the party; decided by the plan): The main reason goes first on the status line, with the others after it.
- **A45** (GRP-Q4: solo characters and party tasks; decided by the plan): Each group runs on its own: solo characters and the party never wait on each other's event tasks.
- **A46** (GRP-Q6: following during A/B testing; decided by the plan): A follower on the other A/B team follows your highest-level character on its own team.
- **D2** (Where farming walks and your commands rank; decided by your answer): Farming walks rank with farm spot moves and the older one finishes first; a travel command during a Cave run needs a real two-step warning, such as a checkbox you must tick before the command goes, and then overrides the run (rule R3).
- **D3** (Which interrupted tasks resume; decided by the plan): Trips you started by hand resume after an interruption, and a rare chase or a pending farm spot move is dropped.
- **D4** (Finishing the fight before a new task; decided by your answer): A new task waits for the current fight while the monsters' HP keeps falling, but never past a cutoff set by the task's own deadline (for an event, the spawn time minus the route time, within rule R6's 60 s arrival limit), so the party never misses an event waiting on a fight. Escape tools include Scare from a Jack-o Lantern orb (skill scare, 50 MP, 5 s cooldown): the game server (node/server.js around line 10711) makes every non-immune monster that targets the caster stop pursuit, so a character holding a jacko sheds its attackers before it leaves or teleports.
- **D5** (Changing Follow or the leader mid-task; decided by the plan): A Follow or leader change applies at once, and the console copes with a split escape or Cave visit (rule R3).
- **D6** (Where add-ons rank; decided by the plan): Hunt and Achievement Hunt are mode toggles that do not compete; other add-ons rank above farming and below rares, events, your commands, the Cave and escape (rule R4).
- **D8** (A death during an event; decided by the plan): A death at an event does not start party death recovery; the member respawns and goes back while the event lasts.
- **D9** (After the Cave run; decided by the plan): The party resumes once everyone is out of the Cave and walking, and Release ends the wait sooner (A13).
- **D10** (The merchant at events; decided by the plan): The merchant attends and returns from events on its own.
- **D11** (Hunt travel and a drifting leader; decided by your answer): Infinite drifting is a form of stuck, and stuck is never an answer: when the party stops getting closer, the owner switches strategy (regroup on the leader, then re-plan from where each member stands, then a different route) and keeps the party moving, and the card says what it is doing (A48).
- **D12** (Saved state for task picking; decided by the plan): Trips you start by hand are saved, so they survive a restart (rule R3).
- **D13** (One status line per group; decided by the plan): The card shows the group's task line, plus a member's own line while it is dead, respawning or escaping alone.

### From the review queue

| Item | Working assumption | Why | Negatives |
|---|---|---|---|
| A1 precedence | escape > death recovery > Cave > Hunt turn-in > event return > event attendance > rare > Hunt mission > Achievement Hunt (fork) > farm-area moves | one list replaces the seven in spec 01 table 1.3 and closes the gaps in 2.4 | (a): Achievement Hunt always loses to an active quest; every owner below event attendance stops when an event starts; (b) anniversary above attendance: the party is up to a minute late to a combat event |
| A12 staging and Hunt | Hunt pauses only once a member is `walking` or `attending` (3.1); the walk starts at route time plus a margin | the lead is not lost and stale fields stop pausing Hunt | (c)/(b)/(b): a wrong route estimate makes the party late; one shared predicate to build; (a) Hunt stops for the whole 120 s lead and on stale fields |
| A13 dungeon `held` | the held visit ends on its own 5 minutes after every fresh participant is outside; escape and death recovery run outside the cave (D9) | nothing waits for you, and death handling never waits on a farming choice | a deliberate hold ends after 5 minutes unless you pause the console; a phase check in each gate; escape can move a member you wanted held |
| A25 event versus travel | short-window bosses take the group at once; other events wait for the live walk to arrive or fail | timing matters only for short windows | (c): a per-event window list; (a) wasted outbound Hunt trips; (b) missed short events |
| A31 rare interrupts | one list in the rule table: farming travel and Hunt mission travel, never user-started travel; a per-rare "may interrupt Hunt travel" setting | user trips finish | (b)+(c): a missed rare beside a hand-started trip; a new per-rare field |
| A33 mode change during a rare | finish the rare, then apply the mode | the fight and loot stay | (b): up to 300 s delay; a pending-mode record |
| A41 join failures | `cant_join` and `join_too_late` end the attendance with `event-over`; other replies back off | both replies are final for the occurrence (game `node/server.js:12641-12711`) | (c): depends on reply strings; (a) a retry loop; (b) N tries for a final reply |
| A42 two live events | each member attends its top event; the table sees one attendance task | the party stays together | (a): the lower event is missed; (b) splits the party and its healer |
| A43 anniversary versus combat | keep: the user's event priority list orders them | the user already sets the order | (a): a featured hold can be lost to a higher event; (b) the party is late to combat events |
| A44 status with several holders | the top line plus every other reason | the hidden second reason is bug 13 | (b): longer lines; a reason from each task; (a) keeps bug 13; (c) text follows code order |
| A45 solo characters and party tasks | each group is independent; the anniversary cycle stays shared | removes the cross-group wait | (a): two groups at one event return separately |
| A46 follow during A/B testing | follow the highest-level owned character on the same team | healing and tanking keep working | (b): new code for a short event; followers pile on one character |
| A48 route drift resets | (d): a drift reset counts as a ladder failure; a running native attempt is not cancelled (D11) | bounds the loop without a hold | a drifting leader walks the party back to the saved farm point, then retries every 60 s; (a) holds after N, which the upstream priority rules out |
| A51 geometry mismatch | (d): retry on the T5 backoff with no end | the hold no longer waits for the user | a lasting mismatch costs a failed trip every 60 s |
| A53 offline participant and Release | (d): drop a participant stale for 5 minutes, release the rest, and `adopt` only members that report inside | no stale member keeps the party waiting for you | the online members wait up to 5 minutes; a late exit pauses the party's farming; (c) "drop from visit" alone still needs your action |
| A54 live event during a visit | exit only between encounters, with a time cap | keeps the vote or fight | a later arrival; a cap value |
| A55 Cave repairs used up | (d): no cap; repairs continue on the backoff while the run lasts, and the card names the member and its receipt error | the run stays and travel keeps trying | one repair a minute while a failure lasts; the counter reset fix |
| A90 merchant home return | (b): no cap; the return keeps trying every 60 s through spec 09's realm owner | the merchant gets home without you | one login attempt a minute while the failure lasts |
| A69 status text writer | each task publishes `{phase, label}` through the owner's status line | the writer of a state writes its label | the largest runtime change; the fork's strip label moves onto it |
| A70 two Hunt pause reasons | the reason that needs your action is the top line, others after it | the order no longer follows code order | each holder needs a reason string and a rank |
| A71 convoy progress on the card | through the status line; convoy text leaves the merchant log | every member's card shows its walk | convoy history leaves the log sidebar unless the combat log keeps it |
| B4 Achievement Hunt and events | wait only while a member attends; switches skip no events | it farms while no one attends | two changes that ship together |
| B6 Achievement Hunt as saved mode | one list of modes for every route and loader | removes the drift | the fork's per-character copy becomes reachable from more scopes |
| B7 relocation during Achievement Hunt | relocate only to another spawn of the same target, as the add-on's own step | both goals kept | a one-spawn target never relocates |
| B9 Pause model | Pause is a user hold the owner applies (2.3 rule 4) | removes the revert surprise | owners that relied on the restore need their own check |
| C7 missing members at an event walk | a fighter event walk waits for the healer | the lone death came from replacing a failed leg | a dead or late healer delays the walk |

### New in this design

**D1. Where the task owner lives.**
- Recommendation: one owner per group on the coordinator (party, each solo scope, merchant), with
  one rule module shared with movement.
- Why: every record the owner ranks is on the coordinator (1.1), and groups are the unit the
  principles name (00-overview "Groups, not the party"). It beats one console-wide owner because
  groups never rank against each other except through the two `allows` questions, and it beats an
  owner on each character because a character cannot see the Hunt cycle, the event return or the
  Cave visit.
- Negatives: (recommended) the character learns its task one heartbeat late, up to the heartbeat
  interval; the rule module serves two runtimes. (one owner for all groups) a cross-group table no
  rule needs, and every group's tick waits on one list. (on each character) a round trip for every
  task question, and the party records stay on the coordinator anyway.

Answer in the review queue (D1).

**D2. Ranks outside queue A1.**
- Recommendation: lifecycle 88, Town 85 and manual 75 at their movement ranks; every ordinary
  farming walk at 56 with farm-area moves; idle at 0.
- Why: a task and its walks then never rank differently, so the coordinator and the character
  cannot disagree (I1 failure 9). It beats giving farming its own rank below 56 because movement's
  group walk band starts at 56 and a lower rank would put farming walks under formation (46) and
  approach (44) on the character.
- Negatives: (recommended) a farm-area move and a walk back to the farm have one rank, so neither
  interrupts the other; the older one finishes first. (farming below 56) farming walks would lose
  to formation and approach steps. (manual above Cave) a manual travel would end a Cave run, which
  today answers 409 until Release (`http/party-actions.ts:62`).

Answer in the review queue (D2).

**D3. Which interrupted tasks resume.**
- Recommendation: suspend and resume the tasks that hold an intent that is not recomputed (survival,
  Cave, lifecycle, Town, manual, turn-in, event return, event attendance while its occurrence
  lives, Hunt mission, farming, and add-ons that ask for it); cancel rares and pending farm-area
  moves.
- Why: Hunt, event returns and farming already resume today (`hunt/travel.ts:30-52`;
  `events/observations.ts:357-385`; `scripts/combat-disengagement.cjs:98`), and a rare's chance
  passes with its encounter. It beats suspending everything because a rare resumed after an escape
  chases a monster that moved or died, and beats cancelling everything because Hunt and the event
  return would lose progress they keep today.
- Negatives: (recommended) a user's manual party travel now resumes after an escape, which it did
  not before; the waiting list can hold up to one entry per row. (suspend all) stale rares and
  stale relocation targets resume. (cancel all) a regression from today's Hunt resume and parent
  restore.

Answer in the review queue (D3).

**D4. The finish step's deadline.**
- Recommendation: finish waits while a monster targets a member or an engaged target lives, at most
  30 s.
- Why: every wait needs a deadline (00-overview "Upstream priorities"), and today's `afterCombat`
  has none (`shared.js:14839-14850`), so a monster that keeps attacking holds the task forever.
  30 s covers an ordinary fight's tail; after it, movement's combat steps keep defending on the walk
  (movement 2.4). It beats no deadline because of that endless case, and beats no finish step
  because leaving mid-fight drags attackers into the walk and the Town cast.
- Negatives: (recommended) a long fight is left after 30 s and the walk starts under attack;
  30 s is not measured yet (G1 reports the finish times). (no deadline) today's endless wait. (no
  finish step) more fights on the walk and more interrupted Town casts.

Answer in the review queue (D4).

**D5. Membership moves.**
- Recommendation: a Follow or leader change waits while the member holds a rank 90 or higher task;
  a member that leaves mid-walk leaves the walk, which rebuilds for the rest under a new epoch.
- Why: a move during an escape or a Cave visit splits a task that only works whole (2.4 gap 1), and
  ending the whole convoy for one member (`hunt/membership.ts:16-24`) stops members that did not
  change. It beats refusing the change with 409 because the user's setting is kept and applied as
  soon as it can be, and beats today because the gap closes.
- Negatives: (recommended) a saved Follow setting that is not in effect yet, which the status line
  must show; the rebuilt walk costs one route plan. (refuse with 409) you must retry the change
  yourself after the task. (today) the Cave gap and the ended convoys stay.

Answer in the review queue (D5).

**D6. The add-on task band.**
- Recommendation: add-on tasks rank 57 to 63.
- Why: today's add-on (Achievement Hunt) replaces farming, and no add-on should
  outrank a rare, an event, the user's commands, the Cave or survival (00-overview "Two kinds of
  hook"). The band still allows an add-on above Hunt missions at 63. It beats 1 to 69 because an add-on at 67
  would take the party from an event, and beats a declared position in the list ("after X")
  because that needs bookkeeping the principles rule out.
- Negatives: (recommended) an add-on can never interrupt a rare or a Hunt mission above 63, even
  when the user wants it; two add-ons at the same rank keep whichever is live. (1 to 69) add-ons
  can beat events. (declared position) a merge rule for add-ons, which the principles exclude.

Answer in the review queue (D6).

**D7. Manual travel during escape or death recovery.**
- Recommendation: manual travel (75) waits until the survival task ends; the status line shows it
  queued.
- Why: today a manual travel command releases the escape (`navigation/manual-commands.ts:78`), the
  workaround that unsticks bug 5; with the ladder, survival tasks always finish (UP-2), so the
  workaround is no longer needed and a mistaken click cannot walk a dying party out. It beats
  today because the release can send members back into danger at low HP, and beats a release
  only when everyone is safe because that rule is the death recovery's own `safe` test
  (`scripts/combat-disengagement.cjs:83-89`) under another name.
- Negatives: (recommended) you cannot cut short a slow walk home. (today) a manual command can end
  an escape mid-danger. (release when safe) a second copy of the `safe` test.

Answer in the review queue (D7).

**D8. Deaths during an event.**
- Recommendation: keep today's rule: no party death recovery for a death on an event trip; the dead
  member respawns and goes back while the occurrence lives; the attendance death limit ends it.
- Why: event fights are shared with other players and a party escape would leave the event for one
  death; the death limit (`events/attendance-limits.ts:81-85`) is the user's own stop. It beats
  running party death recovery because that turns one death at a boss into a full escape and a
  walk back, and the escape needs the trio (spec 05 SRV-Q6).
- Negatives: (recommended) the rest keep fighting one member short until it returns. (party death
  recovery at events) an escape and a long walk back for each death, and lost event time.

Answer in the review queue (D8).

**D9. A held Cave visit and the AFK priority.**
- Recommendation: a held visit ends on its own 5 minutes after every fresh participant is outside,
  and the party resumes its waiting task; Release ends it sooner.
- Why: queue A13's earlier recommendation kept the party idle until Release, and the upstream priority
  rates any state that needs manual intervention to get moving as high to critical. 5 minutes
  leaves time to read the run result. It beats A13's manual Release because the party farms again
  without you, and beats releasing at once (Cave Q1 (b)) because the result stays visible first.
- Negatives: (recommended) a hold you wanted longer ends after 5 minutes unless you pause the
  console; an offline participant keeps the visit up to 5 more minutes (queue A53 (d)); 5 minutes is
  not measured.
  (A13 manual Release) idle until you act. (release at once) the run result is gone from the card
  before you read it.
- The design follows queue A13 until you answer; rules that depend on it say "pending your answer
  (queue A13, D9)".
- Queue A13 now recommends this option as Cave Q1 (d), with A53 (d) for an offline participant, so
  D9 and A13 agree.

Answer in the review queue (D9).

**D10. The merchant at events.**
- Recommendation: the merchant's event attendance and return are its own group's tasks; the
  merchant is never in the party's event return or sessions.
- Why: it matches queue A45 (groups are independent) and how the merchant already travels, alone
  and outside convoys (`navigation/convoy.ts:97-131`). It beats today's shared record
  (`merchant/event-control.ts:18-19`) because a merchant still leaving the event holds the party's
  return (`events/returns.ts:224`).
- Negatives: (recommended) two returns for one event, one of them the merchant's Town and walk.
  (today) the party's return waits for the merchant.

Answer in the review queue (D10).

**D11. Hunt route drift resets.**
- Recommendation: count a drift reset as a T0 failure on the task ladder, and stop the reset from
  cancelling a running native attempt.
- Why: queue A48's (a) holds with a message after N resets, which the upstream priority rules out
  ("no fixed retry counts"). The ladder keeps its bound without an end. The second half is A48's
  own.
- Negatives: (recommended) a leader that keeps drifting climbs to T3 and walks the party to the
  saved farm point, then retries every 60 s. (A48 (a)) a hold that waits for you. (A48 (b)) an
  unbounded loop.
- Queue A48 now recommends this as its option (d), so D11 and A48 match.

Answer in the review queue (D11).

**D12. No saved owner state.**
- Recommendation: the owner saves nothing; at load each provider asks again from its saved record
  and the table orders the answers.
- Why: every task already saves its record (Hunt cycle, event return, death recovery, Cave visit,
  farm-area record), and the order follows from the ranks, so a saved copy would be a second
  record to keep in step (00-overview "Function without bloat"). It beats saving the list because
  that copy can disagree with the records after a crash.
- Negatives: (recommended) `since` restarts at load, and a waiting manual travel is lost at a
  restart unless its convoy record survives (`navigation/initial-commands.ts`). (save the list) one
  more saved field set and its field-registry entries (spec 11).

Answer in the review queue (D12).

**D13. Status line per group or per character.**
- Recommendation: one line per group, plus a member line from the movement owner while that member
  is in its own survival state.
- Why: the group's task is the same for every member, so one line per character repeats it; the
  member line covers the one case where a member differs (dead, respawning, escaping alone). It
  beats spec 12 Q1's per-character registration because the owner publishes once per group.
- Negatives: (recommended) a card shows two lines while its member recovers. (per character) the
  same text written once per member, and a dashboard check that they agree.

Answer in the review queue (D13).

## Corrections to the checked specs

Found while designing. Each was rechecked on `refs/review/ryan-1.5` and applied on 2026-10-26 to
the specs it names; item 5's queue items now carry an option with no manual step (A13, A48, A51,
A53, A55, and the new A90). The next verification pass still checks them.

1. **Dungeon gate and solo services (spec 01 GRP-018, table 1.3, 2.7; movement design 2.1 rule 6
   and 5.3).** The solo loops do skip the dungeon check (`application.ts:2088`, 2139-2143), but a
   solo group only holds a visit participant after a Follow or leader change during the visit:
   participants are the leader and followers at entry (`dungeons/service.ts:44-52`, 74-91), and
   the formation route saves Follow and the leader with no dungeon check (`http/formation.ts:79-100`).
   The gap is that route, not the solo services as such.
2. **Farm areas and death recovery (spec 01 table 1.3, farm areas row).** Farm areas stop for any
   convoy (`navigation/farm-areas.ts:186`) and for an escape that is not released (240-245), so
   most death recovery phases are covered by those checks. The open window is `finishing`, where
   death recovery cancels combat travel (`scripts/combat-disengagement.cjs:81`) and no escape runs
   yet. During the farm return's retry waits the failed convoy is still the active convoy, so it
   blocks relocation too (110-117). Inference: relocation in `finishing` also needs no member to
   see a focus monster (`navigation/farm-competition.ts:65-97`), so it is rare.
3. **Hunt message count (spec 07 MH-Q2, the review queue A44).** Both say "55 writers in 12 Hunt
   files". `git grep -nE "hunt\.message *= *[^=]" refs/review/ryan-1.5 -- runtime/coordinator/hunt`
   gives 49 lines in 12 files, the count spec 12 2.1 gives. Any `.message =` write under that
   folder gives 54 lines in 13 files; no command found gives 55.
4. **The merchant and the party's event state (spec 01 "Words used below", GRP-002).** Spec 01
   says the merchant is outside both groups. That holds for the farming scopes
   (`hunt/scopes.ts:57`), but event returns, sessions and deferred returns are root-wide, and the
   merchant can be an `eventReturn` participant and hold a session
   (`merchant/event-control.ts:15-20`). Spec 01 2.5 should list it.
5. **Queue recommendations that conflict with the upstream priorities (00-overview, reported
   2026-10-26).** A13 and A53 keep states that need your action to get moving (manual Release,
   "drop from visit"); A48 (a) holds after N drift resets; A55 keeps the 3-repair cap that ends
   Cave travel (`dungeons/travel.ts:142`). Spec 08 MJB-013 describes the merchant's home return,
   which gives up after 3 attempts and waits for a manual retry
   (`merchant/home-recovery.ts:95-99`), without flagging it. This design answers them with D9, D11
   and the ladder (4.2); A53 and A55 need their own new options.
6. **Event return and escape (spec 01 table 1.3, event return row).** "Does not check escape or
   death recovery" is true of the reads, but the dispatch waits for any convoy
   (`events/returns.ts:231`), so an escape-recovery or death-recovery convoy already holds it. The
   gap is the escape stages and recovery phases that run without a convoy.
7. **Farming walk rank (movement design 2.5).** It ranks farm-area moves at 56 but names no rank
   for the other farming walks (party travel to the farm, empty-spawn recovery, the return after a
   rare, the farm reunion). This design puts them at 56 (D2).
