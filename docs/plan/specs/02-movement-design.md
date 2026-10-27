# 02 Movement: M1 design draft

Draft of the M1 design for spec 02 (movement). It goes into
02-movement.md sections 6 to 9 later. It builds on sections 1 to 5 of that spec as checked claim by
claim (docs/implementation/04-verification-02-movement.md), and on the checked specs 01, 03, 04, 05
and 06 (logs 05- and 06-verification in docs/implementation/). "Changes after the spec check" at the
end lists every design statement that changed with those checks.

Refs. Line numbers are on the current console at `b9b5c91e` (`refs/review/ryan-1.5` in
(local checkout)) unless marked (fork) for `af92de45` or (df) for the death
fixes at `21b8362d` ((local checkout)). `shared.js` means
`characters/shared.js`; `nav/` means `runtime/coordinator/navigation/`. Game rules cite
kaansoral/adventureland_mongodb at `43b2c8fc` (a clone at
(local checkout), an ancestor of its origin HEAD
`16881a27`).

The design marks decisions that wait on the user "pending your answer (queue A#)" and uses the
the review queue recommendation as their working assumption. Section 12 lists every decision.

## 0. The design in one page

- Each character gets one **movement owner**. It wraps the existing movement service
  (`runtime/characters/movement.ts`), which already keeps one journey per character
  (movement.ts:61). The owner adds what the service lacks: who holds the journey, at what
  priority, and what happens to everyone else.
- Every mover **requests** movement with a kind and an identity. One rule table decides: grant,
  keep the live journey, wait, or refuse. Nobody calls `smart_move` or `stop` directly.
- **Only the holder, escape and death recovery may stop a journey** (queue A2). A higher-ranked
  request still takes over by rule, and the table says whether the loser waits or is cancelled.
- **The same request asked again keeps the live journey** (queue A3): no stop packet, no settle
  wait, no new plan.
- **Combat steps pause travel and travel resumes after** (queue A4). Steps are not journeys; they
  borrow the character for a moment under one shared safety check.
- **Standing still is always owned and timed.** A wait, a hold or a pause carries a deadline, and
  every deadline leads to a next step. Failures climb an escalation ladder that ends in "go to the
  safe point and restart the task", never in a dead end (upstream priority, 00-overview
  "Upstream priorities").
- A **group's walk** (convoy or shared walk) is one request per member, carrying the group task's
  rank from spec 01. A group of one and the merchant use the same path.
- **Hooks:** one request hook for add-on movers (rank capped below manual travel) and three
  notices (journey started, paused, ended with a reason code), declared in the one hook registry.
- **Records:** a 128-entry decision ring per character, saved to disk only on a death, a repeated
  failure, an escalation to the safe point, or churn.

## 1. The movement owner

### 1.1 Where it lives

One owner per character, in the character runtime, installed by `installPartyMovement` next to
the service (shared.js:18-32 today installs the service and rebinds `smart_move` and `stop`). The
coordinator does not get a second owner. Its convoys and shared walks stay group planners owned by
the group's task (spec 01); what they hand each member is a request into that member's owner
(section 5). The rule table is one module, `runtime/navigation/movement-rules.ts`, imported by the
character owner and by the coordinator's walk replacement rule, so both sides rank requests the
same way.

### 1.2 What it holds

Only what it decides from:

| Field | What | Bound |
|---|---|---|
| `live` | the request that holds the journey: `{id, kind, owner, rank, destination, tolerance, options, deadline, journeyId}` | 1 |
| `pause` | who paused the live journey and until when: `{by, reason, until}` | 1 |
| `waiting` | interrupted requests that resume later, newest first | one entry per kind; at most one per row of the rule table (14) |
| `ladder` | the escalation step of the live request: `{step, failures, nextAt, progressAt}` | 1 |
| `ring` | the decision ring (section 7) | 128 entries |

It holds no flags about other parts of the console. "Is a convoy running", "is Town casting", "is
follow active" become `live.kind`, so the movement flags among the 27 checks in `isOccupied`
(25 of them can return true, shared.js:17494-17528) and the per-mover blocker lists (follow at
shared.js:17750, 17770-17775; rare path at 3659; reunion at 13456-13472) read one field instead.

### 1.3 API

Every call carries the caller's **owner identity**: a string the caller picks and keeps, such as
`walk:<group>:<convoyId>:<epoch>`, `rare:<controlId>`, `follow`, `town:<cycleId>`. Coordinator
requests include the member's navigation revision in the identity, so a revision change ends them
the way `current()` already ends stale journeys (movement.ts:65-71).

- **`request({kind, owner, destination, options, deadline})`** returns a handle `{id, status,
  done}`. `status` is one of:
  - `granted`: the owner started a journey (movement.ts:382-396 runs inside it);
  - `kept`: the same owner asked for the same place; the live journey and its `done` promise are
    returned unchanged (rule 2.2);
  - `retargeted`: the same owner asked for a new point on the same map with a clear straight line;
    the live journey's plot is replaced in place (rule 2.3);
  - `waiting`: a higher-ranked request holds the journey; this one starts when it ends;
  - `refused`: a higher-ranked request holds the journey and this kind does not wait; the caller
    tries again on its own tick.
- **`release(handle, reason)`**: the holder ends its own request. A handle that is no longer live
  is a no-op, so no caller needs to check `smart.on_done` first.
- **`pause(owner, reason, until)`** and **`resume(owner)`**: pause keeps the journey and stops the
  character once, the way `executor.pause()` already does (movement-executor.ts:28-36); the
  service's tick then skips the journey while paused, the same branch the context pause uses
  today (movement.ts:377). Allowed for the holder, for combat steps (2.4) and for survival.
- **`stop(owner, reason)`**: ends the live journey without taking it over. Allowed for the holder,
  escape and death recovery (queue A2). The owner refuses any other caller and records the refusal
  in the ring with the caller's kind; this replaces the `stopStack` capture (movement.ts:411). Today only a
  bare, `move` or `smart` stop ends a journey (movement.ts:411): a stop that passes `success` ends
  it as arrived, a failed `stop('move')` on a Cave `retainOnDirectStop` journey only pauses it
  (403-410), and `stop('town')` or any other action reaches only the native stop (412). The owner
  keeps the `success` case as `release(handle, 'arrived')` by the holder.
- **`step(owner, point, mode)`**: one native combat step (2.4). It replaces `sendCombatMove`
  (shared.js:17141-17156) as the only native `move` writer outside the executor.
- **`live()`**: `{kind, owner, rank, paused}` for readers that only need "who holds movement".

`smart_move` and `stop` stay bound for code typed in the game client and for callers not yet
converted during migration; they map to kind `unattributed` (lowest rank, section 2.1).

### 1.4 One journey, many requesters

A character has one journey at a time. The owner shares it in three ways:

1. **Same request, same journey.** Repeats are `kept` (2.2). A group walk and its per-phase
   commands share one owner identity per walk, so a phase change in the same convoy no longer
   cancels the journey; today any new command id cancels it with `convoy-phase-change`
   (shared.js:10500-10513).
2. **Higher rank takes over, and the loser waits or is cancelled** by its row (2.1). A waiting
   request resumes from where the character stands when the taker ends; it is not replayed from its
   old origin.
3. **Steps borrow without taking.** A combat step pauses the journey; the journey resumes when
   combat lets go (2.4).

## 2. The rule table

### 2.1 Rows

Rank: higher wins. "Interrupted" says what happens to the lower request when this row takes over.
"Steps" says whether combat steps may pause this row's journey. "Stop" is who may end it without
taking over; the default for every row is: its holder, escape, death recovery, and runtime
disposal (movement.ts:440). Rows only list additions.

| Rank | Kind | Requesters today (02 writer map, 1.6) | Interrupted lower request | Steps | Stop (besides default) |
|---|---|---|---|---|---|
| 100 | `escape` | applyEscape stops and escape pulse moves (shared.js:138-158, 160-286); coordinator escape stages (scripts/party-escape.cjs:59-97) | cancel (today it cancels convoy, farm token, reunion, follow: shared.js:150-157) | no: escape sends its own retreat steps and Blink | escape release (party-escape.cjs:45-48) |
| 95 | `death-recovery` | respawn and rejoin (runtime/characters/roles/death-recovery.ts:18-74); escape `recovering` walk to Main (shared.js:209-240); `death-recovery` convoy (nav/recovery-hooks.ts:62-64) | cancel | yes | none |
| 90 | `cave` | dungeon journeys (shared.js:2761-2808) | cancel | yes: generalizes `retainOnDirectStop` (movement.ts:403-410) | Cave runtime |
| 88 | `lifecycle` | Load in Main and checkpoint return (consoleMainTick, shared.js:2445, 2455); maintenance park (11153) | cancel | no | lifecycle owner (spec 13) |
| 85 | `town` | `town-party` (shared.js:10692-10753), `enforcePartyTownOverride` (11032-11075), `event-return-town` exit (10754-10860), return exit cast (11005-11023), manual Town (nav/manual-commands.ts:107-118) | cancel | no while casting, pending your answer (queue A30) | none |
| 75 | `manual` | dashboard character travel, party travel, return to leader, force travel (nav/manual-commands.ts:75-147; shared.js:10676-10685, 10863, 10921) | cancel (today `invalidate` cancels them: scripts/farming-navigation.cjs:82-126) | yes | none |
| 56-70 | `group-walk` | every convoy and shared walk command (`party-monster-travel`, shared.js:10867-10909, 15793-15988; `sharedPartyWalk`, 15079-15130): Hunt turn-in, event return, event walk, rare convoy, Hunt mission, farm relocation, Phoenix legs. Rank = the group task's rank from spec 01 (2.5) | lower `group-walk` or `errand`: wait and resume (today's parent command restore, nav/shared-walk.ts:168-182, 198-210); anything lower: cancel | only while the walk is defense-paused (today shared.js:17523; convoy-defense.ts:115-120) | the walk's coordinator, through its command |
| 65 | `errand` | fighter upgrade preview travel and bank stack floors (shared.js:2501, 4040); merchant jobs on the merchant (7750, 8778, 10341), ranked by spec 08 on the merchant | lower: cancel | no (today `afterCombat` waits for combat first, shared.js:14839-14857) | none |
| task rank | `task-walk` | walks a task sends without a group: rare path (shared.js:3689-3698, rare rank 64), event lone walk (15081), encounter catch-up (14540-14564), reunion walk (13707-13709) | cancel | yes | none |
| 46 | `formation` | regroup route (shared.js:14670), terrain recovery (16611), formation recovery client (formation-recovery-client.ts:93-100) | cancel | yes | none |
| 44 | `approach` | independent approach (shared.js:16740-16747), farm approach recovery (16154-16196), pull walk (shared.js:18484-18501 (fork)) | cancel | yes | none |
| 40 | `follow` | follow the leader (shared.js:17748-17785; runner.ts:152-157) | cancel | yes | none |
| 1-74 | `addon:<name>` | add-on movers through the request hook (section 6) | by its declared row: cancel or wait | yes | none |
| 10 | `unattributed` | unconverted `smart_move` calls and code typed in the game client | never interrupts a live request | yes | none |

Rules that apply to every row:

1. **A request ranks against the live one.** Higher rank takes over. Equal or lower rank waits if
   its row says "wait and resume", otherwise it is refused.
2. **Two group walks** compare task ranks. An event walk against an active Hunt convoy follows
   queue A25: short-window bosses win at once, other events wait for the convoy to arrive or fail,
   pending your answer (queue A25). Today an event walk replaces at once any active convoy that is
   not a shared walk, not navigation exempt (manual walks, nav/manual-commands.ts:116) and not
   non-preemptible (Hunt returns, runtime/coordinator/hunt/convoy.ts:78), so an outbound Hunt
   convoy is the one thrown away (nav/shared-walk.ts:191).
3. **A waiting request expires** at its own deadline or when its identity goes stale (a revision
   change); it then ends with code `expired`, and its requester takes its next step (section 3).
4. **Pause sources outside the table.** Console Pause, `__partyMovementPaused` and the dungeon
   `canMove` gate pause the live journey without taking it, as today (shared.js:21;
   runtime/characters/dungeons.ts:349-351). The `canMove` gate reads `owned`, so it also pauses a
   dungeon-owned gather outside a Cave. `pause.by` names each pause source.
5. **Escape and death recovery precede the Cave** in the table, as queue A1 orders them. Whether
   escape and death recovery run at all after a Cave is a task decision, pending your answer
   (queue A1, A13); today the coordinator skips escape, death recovery, rare control, event
   returns and anniversary returns while a dungeon owns the party
   (runtime/coordinator/application.ts:1741-1745).
6. **Precedence is read by rank on each character, not by each owner's own list.** Spec 01 table
   1.3 found these gaps in today's owner checks; the rows above cover each one:
   - The dungeon gate covers only the main party, and the formation route saves a Follow or
     leader change during a visit with no dungeon check (runtime/coordinator/http/formation.ts:79-100).
     A participant that becomes solo that way has its farm areas and Hunt run by the solo loops,
     which skip the gate (application.ts:2088, 2139-2143). Their walks reach the member as
     `group-walk` requests (rank 56 to 70), and a member whose live request is `cave` (90)
     refuses them.
   - Farm areas never read death recovery (nav/farm-areas.ts has no `combatRecovery` read). Their
     convoy and escape checks cover most recovery phases; the open window is `finishing`, where
     death recovery cancels combat travel and no escape runs yet
     (scripts/combat-disengagement.cjs:81). A farm-area walk (56) cannot take over a
     `death-recovery` request (95).
   - The event return reads neither escape nor death recovery (none of events/returns.ts,
     return-guards.ts, return-policy.ts or repair-return-walk.ts reads them). Its dispatch waits
     for any convoy (events/returns.ts:231), so the gap is the escape stages and recovery phases
     that run without a convoy. An event return walk (68) waits behind `escape` (100) and
     `death-recovery` (95) instead of replacing them.
   - Event admission reads neither escape nor death recovery (spec 01 2.8). An event walk (66)
     waits behind both the same way.
   - The Hunt roster cancels every non-Hunt convoy whenever the leader is fresh, during a turn-in
     too (runtime/coordinator/hunt/participants.ts:84-92). That cancel becomes a coordinator
     replacement under section 5.1: the Hunt task replaces only walks whose task ranks lower, so
     it never cancels an event return (68) behind a mission (62), or a death-recovery or
     escape-recovery convoy.

### 2.2 Same request asked again

A request is the same as the live one when the owner identity matches, the map and instance match,
and the new destination lies within the live journey's arrival tolerance of the old one
(tolerance defaults to 20, movement.ts:23). The owner returns `kept` and does nothing else.
Today every repeat runs `finish` (movement.ts:384), a stop packet when moving (392), a wait until
the character settles that fails after 5 s (237-251) and a new plan. This rule removes the pull
walk stall at its source (ledger bug 3a, shared.js:18490-18497 (fork)) and makes bug 8's pattern
impossible for any single writer. Pending your answer (queue A3).

A different owner asking for the same place does not inherit the journey; it ranks against the
holder like any request (section 12 rejects queue A3 option (b)).

### 2.3 Same owner, new point: retarget in place

The independent approach re-aims when its point moves more than 12 units, at most every 250 ms,
while its journey is a pending direct one or past its last search level
(runtime/combat/independent-approach-client.ts:22-28). Each re-aim cancels the old journey (21;
shared.js:16749) and starts a new one, whose `move` sends a stop packet (movement.ts:392) (W3 in
02 section 2.3). When the same owner asks for a new point on the same map and instance and
the straight line is clear (`can_move`, as the approach already checks at shared.js:16730), the
owner installs a one-step plot on the live journey through the existing import path
(movement.ts:420-432; the approach does this today right after starting a journey, 16744) instead
of starting a new one. No stop packet, no settle wait. Any other change of point starts a new
journey for the same owner, as today.

### 2.4 Combat steps

One rule for every combat step: approach and kite steps (shared.js:17184-17334), formation steps
(16963-17093), regroup steps (14643-14659), sight recovery (17609-17613), gravestone approach
(2681-2689), spread (17535-17557), Franky approach (17237-17262), warrior Dash (13954-13975),
and the fork's boss retreat (shared.js:3759-3913 (fork)), Franky movers (18128-18353 (fork)) and
pull walk (18484-18501 (fork)).

1. A step is allowed when no journey is live, or the live row says "Steps: yes", or the live
   group walk is defense-paused.
2. The step must pass step safety (section 3.1).
3. The first step pauses the live journey with `pause.by = 'combat'`. Later steps leave the pause
   as it is.
4. One native `move` per destination. A step to a point within 2 units of the step still being
   walked is not sent again; `sendCombatMove` already does this (shared.js:17147-17148), and the
   rule now covers the regroup step too, which re-sends every 100 ms today (W2-7,
   shared.js:14657-14658).
5. Travel resumes when combat lets go: `resetCombatMovement` (shared.js:17123-17140) is the role
   runner's "no valid target or immediate threat" branch (runner.ts:196-199, 239-242) and becomes
   `resume('combat')`. If no step arrives for 1.5 s the pause also ends; 1.5 s is the window
   `isCurrentlyKiting` already uses for "kiting now" (shared.js:16008-16012).
6. A step never ends a journey. `holdFormation` and `resetCombatMovement` today call
   `stop("move")` when the character still walks their own step (shared.js:16668-16669,
   17129-17131). That stop ends the live journey (movement.ts:411), except on a Cave
   `retainOnDirectStop` journey, where it only pauses it (403-410). They now stop only the step.

Pending your answer (queue A4).

### 2.5 Where group walks get their rank

The movement table does not decide task precedence; spec 01 does. A group walk carries the rank of
the task that issued it, mapped from queue A1's order: Hunt turn-in 70, event return 68, event
attendance 66, rare 64, Hunt mission 62, Achievement Hunt (fork) 60, farm-area moves 56. Every other ordinary farming walk also ranks 56: party travel to the farm, empty-spawn
recovery, the return after a rare and the farm reunion (`01-groups-and-tasks-design.md` D2). Escape-recovery convoys use the `escape` row and death-recovery convoys the
`death-recovery` row. Pending your answer (queue A1).

## 3. Step safety and failure escalation

### 3.1 One step safety check

`stepSafe(from, to, target)` is the only check combat steps use. It is true when:

1. terrain: `can_move` accepts the segment from `from` to `to`;
2. attackers: for each visible monster targeting this character, other than the selected target,
   `to` is no closer than `min(distance now, its range) - 1`, which keeps today's
   `safeCombatPoint` rule (shared.js:17167-17172);
3. idle monsters: the segment does not enter the aggro block of any visible monster that has no
   target and has an `aggro` value. The check leaves out the selected target and a boss the step
   approaches on purpose, as today's check leaves out the selected target (17167). It skips a
   block that already contains `from`, so a character inside one can still step out.

The aggro block is the game's own check, modelled on grid cells, not a radius. The server files
every aggressive monster without a target into a 32-unit grid (`set_ghash(aggressives, monster,
32)`, node/server.js:14394-14405) and checks each player against the 3x3 cells around the player's
own cell (`get_nearby_ghash`, node/server.js:15263; node/server_functions.js:1188-1216). A monster
whose cell is `(floor(x / 32), floor(y / 32)) = (cx, cy)` can therefore start aggro only on a player
standing in the square from `((cx - 1) x 32, (cy - 1) x 32)` to `((cx + 2) x 32, (cy + 2) x 32)`,
96 units on a side and aligned to the grid. `stepSafe` tests the segment against that square with
one segment and box test per monster. The game adds two conditions the check leaves out on
purpose, so it refuses some steps the game would allow and never allows one the game would check:
the monster must face the player within 45 degrees (`is_in_front`,
js/old_common_functions.js:1251-1257, used at node/server.js:15265), and a monster with `aggro` at
or below 0.99 joins the grid only by chance each tick (14403). A radius cannot match the square:
the reach from the monster is anything from 32 to 64 units on each axis, depending on where the
monster stands in its cell, so a 91 radius (`64 x sqrt(2) = 90.51`, the farthest corner) refuses
points straight along an axis that the server never checks, and the fork's 96
(runtime/combat/pulling.ts:11 (fork)) refuses more. The cell size, 32, is one constant in
`runtime/navigation/movement-rules.ts`. Missing ranges default to 20 in every check (today 20 at
shared.js:16241, 17646 and 30 at 17172, 17307; W10 in 02).

Four movers already check every visible monster today and keep their own scoring on top: the
formation solver (shared.js:16239-16305) and the corner, terrain and sight recovery steps
(16313-16432, 16458-16467, 16630-16638). Their clearance is the monster's range plus 8, or a flat 38
for a monster that outranges the character and does not target it, idle or not (16246-16247). A
clearance of 38, or of range plus 8 for any range under 82, can leave a step inside an aggro block
(02 section 2.3 W1, inference), so a step they pick must still pass `stepSafe`. The fork's boss
zones (shared.js:18046 (fork)) and avoided monsters (`avoidMonsters`, shared.js:12111-12112
(fork)) feed `stepSafe` as extra entries in the monster list, each with its own
radius. Franky and boss approaches use `stepSafe` with the boss excluded
(queue A23). Pending your answer (queue A5, A23).

Escape's retreat step (shared.js:277-285) uses `stepSafe` too; today it checks terrain only
(W2-10).

### 3.2 Escalation instead of retry counts

The upstream priority rules out "fail N times, then stand still". The owner gives every live
request one ladder. A failure moves the request one step up; progress (10 units of movement or a
map change, the progress test eventReturnRouteToMain already uses at shared.js:11757) moves it back
to step 0. Counts only choose the step; no count ends the ladder.

| Step | What the owner does | Today's nearest equivalent |
|---|---|---|
| 0 replan | a fresh journey to the same goal from where the character stands | service recovery, 2 tries shared with the drift replans (movement.ts:235, 266, 272-276) |
| 1 other route | the other planner (native after ALClient, ALClient after native), Town toggled, `avoidLeave` | `fallback` (movement.ts:100-108), leave replans (265-271) |
| 2 relocate | walk or Town to the relocation point the service already computes (map spawn when more than 55 from it, else the nearest door; movement-relocation.ts:8-54), then retry the goal | the relocation hint is a report field only today (movement.ts:86) |
| 3 regroup | for a group member: ask the group walk to regroup (`shared-hold`, nav/shared-navigation.ts:248-252); for a solo character, step 2 again from the new point | regroup budget 2 (shared-navigation.ts:590-595) |
| 4 safe point | walk to the safe point of the current task (section 4), end the request with code `returned-to-safe`, and tell the requester to start its task again from there | none: today a request ends with a failure and no rule makes the requester ask again |
| 5 wait and restart | from the safe point, the requester asks again after a capped backoff of 5, 15, 30, then 60 s, and the 60 s wait repeats; the dashboard shows "stuck for N minutes" after 5 minutes | ladders of 5/15/30/60 s that end (scripts/farming-navigation.cjs:268; scripts/combat-disengagement.cjs:113) |

Three invariants the owner checks every 100 ms tick of the role runner (runner.ts:339):

1. **A live request always has a journey, a pause with a deadline, or a ladder step with a due
   time.** A request with none of these is a bug; the owner logs it to the ring and starts the next
   ladder step.
2. **A requester that holds no journey but owns the character** (escape, death recovery, a task
   holding with no movement) must hold a `hold` request with a deadline. When the deadline passes,
   the holder's next step runs. This turns "returns without moving" (escape at shared.js:208, 210;
   rare at 3688) into a timed state.
3. **Every `journey.ended` reaches its requester**, and a group task answers every end with a next
   request or a `hold` (spec 01 owns that answer).

#### Every fixed retry count in movement code today, and what replaces it

| Count | file:line | Replacement |
|---|---|---|
| 2 service recoveries, then fail | movement.ts:272-276 | ladder steps 0 and 1 |
| 2 leave replans | movement.ts:265-271 | ladder step 1 |
| 1 segment repair; 3 shared Cave endpoints | movement.ts:139-143 | kept inside one journey (a repair is not a retry of the request); exhausting it moves the ladder |
| 2 planning drifts | movement.ts:233-236 | ladder step 0; combat drift pauses instead (2.4) |
| 1 stopped-walk re-send | movement-executor.ts:122-129 | kept inside the step; a stall moves the ladder |
| 3 regroup routes, then "holding new pulls" for the rest of the key | shared.js:14662-14663 | ladder steps 0 to 5; queue A28 picks step 4's target (saved farm point), pending your answer (queue A28) |
| 3 shared walk request failures in a row | shared.js:15119 | the walk's own ladder (section 5) |
| 4 exit legs, then "request Escape again" | shared.js:11748, 11771 | ladder steps 0 to 5 (UP-2, section 3.3) |
| 3 event exit instance attempts | shared.js:11642 | ladder steps 1 to 4 |
| 1 rare walk, never retried | shared.js:3688, 3694-3701 | ladder; queue A32's "retry once, then end the encounter" becomes "step 0, then the rare task ends the encounter and its group gets its next task", pending your answer (queue A32) |
| 8 approach radius halvings | independent-approach-client.ts:31-33 | kept as the approach's own search; the last level hands the target back to targeting (spec 04) instead of reporting `unreachable` and stopping |
| 3 formation recovery attempts | runtime/combat/formation-recovery.ts:52-56 | ladder steps 0 to 3; step 4 ends terrain recovery and the group regroups |
| 6 sight recovery steps or 8 s | runtime/combat/sight-recovery.ts:25 | kept as a bounded search; on exhaustion targeting retires the target (spec 04), not a pause with no end |
| 2 regroups (1 for continuous return) | nav/shared-navigation.ts:590-595 | the group walk's ladder |
| 3 return runtime rebuilds, then "request Party Town again" | nav/shared-navigation.ts:522-531 | the group walk's ladder; the last step is the safe point, not a message |
| 1 unprepared Hunt return rebuild | nav/shared-navigation.ts:514-521 | the group walk's ladder |
| 3 restart rebuilds (5, 15, 30 s) | nav/restart-recovery.ts:84-88 | the group walk's ladder |
| event return retry waits 5, 15, 30, 60 s | scripts/farming-navigation.cjs:264-268 | ladder step 5 (the 60 s wait repeats; it already does here) |
| death recovery farm return 5, 15, 30, 60 s | scripts/combat-disengagement.cjs:112-119 | ladder step 5 |
| 4 Phoenix fallbacks per region | nav/phoenix-patrol.ts:150-158 | spec 07 owns the patrol; each leg's request uses the ladder, and a region with every point failed moves the patrol on (today) |
| more than 1 real failure per zone | nav/farm-area-recovery.ts:100-111 | spec 07 owns zone choice; each relocation leg uses the ladder |
| 3 Cave travel, assembly and destination repairs | runtime/coordinator/dungeons/travel.ts:98-147 (spec 07 HNT-096) | the Cave leg's ladder; step 4 in a Cave waits on the backoff (N7) and tries again, because a Cave has no safe point to walk to, and the run's own expiry ends the visit (pending your answer (queue A13, A55)) |
| 30 s legacy rendezvous, 120 s total | scripts/convoy-navigation.cjs:109 | the group walk's ladder |

The coordinator keeps 31 timer and budget values in all (02 section 2.4 G6). The rows above are the
ones that end a request. The rest are phase windows and per-try bounds; they stay, and each phase
window carries the deadline that invariant 1 asks for.

Bounded searches inside one attempt (planner budgets, A* expansion caps, the 5 s walking stall) stay:
they limit work per try, they do not end the request.

### 3.3 Upstream cases traced

#### UP-1: party death during an event, then no way back to the event

Today:
1. Party death recovery ignores deaths during an event trip: `newDeaths` skips a member when
   `huntSafety.eventDeath` holds (scripts/combat-disengagement.cjs:24-36, line 31), and the tick
   returns while any member is in an event (134). So no party recovery runs.
2. The dead character respawns on its own: `createDeathRecovery` races `respawn()` and then calls
   `rejoinEvent` (runtime/characters/roles/death-recovery.ts:28-47), which is
   `rejoinActiveEventAfterRespawn` (shared.js:13721-13759).
3. For Mr. Green or the Horseman (walk events, no `join()`), rejoin calls
   `sharedPartyWalk(destination, "event", ...)` (shared.js:13747-13749).
4. A non-leader that does not follow walks alone with `smart_move` (15081). Any other member posts
   `/shared-travel` (15118). If the party's earlier walk to that event failed, the coordinator
   answers every event walk request from that member with that failure (`retainedFailure`,
   nav/shared-walk.ts:343-349). It checks only the member's revision, not the event, and it stops
   only when `runtimeTurnoverReady` holds: a `runtime-lost` restart walk, every member fresh after
   the failure on the route realm and joined to the same event, and at least one changed runtime
   (350-356, 382-399). The client throws on `failed` (15122).
5. Rejoin returns `retryable` (shared.js:13757) and death recovery retries every 1 s
   (death-recovery.ts:43-46), getting the same failure each time, for as long as the event lives.
   A permission denial loops the same way (13732, 13743).
6. For a join event, a rejected `join()` throws (shared.js:13191) and the catch returns
   `retryable` for every reason except `event_not_live` (13754-13757), so a `cant_join` reply is
   retried every 1 s too. In the game's server source `cant_join` means that the event flag for
   that name is off, or that the name has no join branch (node/server.js:12641-12711).
   `join_too_late` exists only for A/B testing (12683-12687). Both replies stay final for the occurrence (spec 06
   2.2).
7. When the event ends, rejoin returns `cancelled` and the character stops (UP-3).

With the owner:
- The rejoin is a `death-recovery` request (rank 95) whose goal is "the activity the group task
  names", asked from spec 01's group task, not chosen by the respawn code.
- A retained walk failure counts as a ladder failure for that request: step 1
  plans the walk without the shared session (the lone walk path at 15081 already exists), step 2
  relocates to the event map's spawn, step 4 sends the character to its safe point and asks the
  group task again.
- A walk that fails because the coordinator holds an old failure climbs the group walk's ladder, so
  the walk itself regroups or rebuilds (section 5.2).
- A `cant_join` or `join_too_late` reply is not a ladder failure. It ends the request with code
  `failed:event-over`, and the respawn goes to the group task for its next activity (UP-3). The
  other join replies (`cant_when_sick`, `cant_in_bank`) can clear, so they stay ladder failures.
  This follows spec 06 question 3, pending your answer (queue A41).
- Proof: ChronAL E2E scenario UP-1 (section 11.3).

#### UP-2: death while farming, then the escape does not finish

Today, two paths:
- **Escape completes at the landing (bug 5).** The coordinator marks the escape `complete` when
  the priest reaches the Blink landing (scripts/party-escape.cjs:91-96), then `step` returns for
  `complete` (61); the character pulse returns too (shared.js:208), and only a warrior's defense
  Dash in `escapeSurvivalPulse` can still move it (190, 197-198); `handleOwnedCommand` defers
  every command while escape owns the character (shared.js:10397-10398); death recovery waits for
  every member settled at Main within 65, at 50% HP and with no threats
  (scripts/combat-disengagement.cjs:83-92). Nothing moves until a player acts: a manual travel
  command releases the escape (nav/manual-commands.ts:78), and so does a Hunt mode change
  (runtime/coordinator/hunt/mode.ts:59, 75).
- **The walk home gives up.** In `recovering`, a survivor off Main walks with
  `eventReturnRouteToMain` (shared.js:232): at most 4 legs (11748), each ended after 15 s without
  10 units of progress (11760), inside a 180 s deadline (232); a superseded leg ends the whole route
  (11756). Then it throws "Exit to Main stalled or exhausted; request Escape again" (11771), the
  pulse sets `local.recoveryFailed` (233), and every later pulse returns at once (210). The
  coordinator's `recovering` and `recovery-convoy` stages have no deadline (party-escape.cjs:65 and
  70 exempt both from the disconnect, death and deadline checks; 72-77 wait for everyone within 65
  of Main). The character waits for a player action.

With the owner:
- Escape and death recovery share one goal, the `death` row of the safe table (section 4): Main
  within 65 of (0, 0) (queue A6). `complete` at a landing off Main is no longer an end state; the
  landing is ladder input, and the escape request continues to Main.
- The walk home is an `escape` request on the ladder: replan, other route, relocate (Town on the
  current map's spawn when Town is ready), then the 60 s wait-and-retry that repeats. No flag stops
  it for good.
- The `recovering` and `recovery-convoy` stages get a deadline per ladder step, so the
  coordinator sees a stuck member and can switch it to a solo recovery walk.
- Proof: ChronAL E2E scenario UP-2 (section 11.3).

#### UP-3: after a respawn, the character does not go back to its activity

Today:
1. The death listener marks the event to rejoin (`__partyEventRejoinRequired`, shared.js:1092),
   only while `eventsEnabled` is set (1090-1094).
2. If the event ended before rejoin runs, `rejoinActiveEventAfterRespawn` returns `cancelled`
   (shared.js:13724-13726).
3. Death recovery calls `rejoinFarm` only for `not-applicable` (death-recovery.ts:48). For
   `cancelled` it clears `pendingReturn` and publishes `recovery-cancelled` (49-50). Nothing asks
   for movement again.
4. The coordinator's event return is the only other mover. It reaches this member only when the
   member is in the return's participant list (runtime/coordinator/events/returns.ts:137-146,
   202-209); a second return for the same event within 60 s does not start (201; spec 06 EVT-027).
   Inference: a member left out of that list stays at spawn. Scenario UP-3 (section 11.3) confirms
   which case fires.

With the owner:
- Respawn ends in one question to the group task (spec 01): "what is this member doing now?". The
  answer is the task's request (event, Hunt, farm, rare). "The event ended" is not a separate
  outcome; the group task names the next activity.
- If the group task has no answer within 10 s (the reunion's freshness window, shared.js:13473-13485),
  the death-recovery request takes ladder step 4: go to the saved farm point of the member's group.
  The character's death recovery calls its farm return only for `not-applicable`
  (death-recovery.ts:48); the coordinator's party death recovery returns a group to its saved farm
  when the policy is not Hunt and a location was saved (scripts/combat-disengagement.cjs:98,
  103-121), and resumes the Hunt otherwise (99-100). Step 4 follows the same split: a Hunt group's
  member gets the Hunt task's next request instead of the farm point.
- Proof: ChronAL E2E scenario UP-3 (section 11.3).

## 4. "Safe at Main": one goal, one radius table

The movement owner owns `isSafeAt(goal, status)` and one table. Every caller asks it; no caller
writes a radius.

| Goal | Point | Radius | Used by today | Copies replaced |
|---|---|---|---|---|
| `death` | main (0, 0) | 65 | escape recovering and recovery convoy, death recovery `safe`, warrior defense outside Main | shared.js:197, 218, 238; scripts/combat-disengagement.cjs:87; scripts/party-escape.cjs:74, 86; the fork's seventh copy, scripts/party-escape.cjs:105 (fork) |
| `town` | main (0, 0) | 90 | party Town, event return Town, Town override | shared.js:10720, 10801, 10829, 11037 |
| `map-exit` | spawn 0 of the current map, not Main | 90 | return exit cast | shared.js:11017 |
| `anniversary` | main (0, 0) | 100 | anniversary staging | shared.js:11837, 11853, 12207, 12222, 12233 |
| `manual-town` | main (-174, 121) | 20 (default tolerance) | manual Town walk | nav/manual-commands.ts:114 |

Rules:
- Escape and death recovery use the same `death` goal, so the party never waits at a place one of
  them accepts and the other does not (bug 5). Pending your answer (queue A6).
- Separate radii per workflow, written once here. Pending your answer (queue A29).
- The manual Town point is 212 units from (0, 0) (`node -e "console.log(Math.hypot(174,121))"`),
  so a character parked there is not `death`-safe. That is correct for a manual Town; escape never
  ends there.
- Ladder step 4 (3.2) uses the requester's goal from this table: `death` for survival, `town` for
  Town and event returns, the group's saved farm point for farming tasks.
- In a Cave there is no safe point to walk to; step 4 waits on the backoff and tries again until the
  run ends (pending your answer (queue A13, A55)).

## 5. Groups

### 5.1 One group walk, one request per member

A group walk is what the coordinator plans today: a convoy (nav/convoy.ts:194-231) or a shared walk
on top of one (nav/shared-walk.ts). The coordinator keeps one walk per group. Each member's
command becomes one `group-walk` request in that member's owner:

- **Identity:** `walk:<group>:<convoyId>:<epoch>:<revision>`. Every phase command of the same walk
  and epoch shares it, so assemble, prepare, depart and travel are one request whose destination
  changes by phase. Today any new command id cancels the journey (shared.js:10500-10513), and
  coordinatedMonsterTravel cancels again on start (15847).
- **Rank:** the task rank (2.5).
- **Phases map to requests:** `assemble` and rendezvous are the request's first destination (the
  rally); `hold`, `shared-hold`, `communication-hold`, `hunt-arrival` and the merchant pause are a
  `pause` by the walk's own identity with the phase's deadline; `travel` installs the shared plot
  on the same journey (movement.ts:420-432); `defending` is a pause that allows combat steps
  (2.4 rule 1); release (command deleted, `event-walk-release`, `event-resume-travel`) is
  `release` by the walk.
- **Replacement on the coordinator** uses the same table: a new walk for a group replaces the
  active one only when its task ranks higher, and the replaced walk's members get their old
  requests back as waiting entries, the parent restore the shared walk already does
  (nav/shared-walk.ts:168-182). Today every start cancels the active walk
  (nav/convoy.ts:202-203), and `cancelCoordinatorHuntConvoy` also clears a Hunt convoy directly
  (runtime/coordinator/hunt/controls.ts:55-61). Both become replacements under this rule, and so
  does the Hunt roster's cancel of non-Hunt convoys (rule 6 in 2.1).
- **The leader's 1-unit origin rule** (nav/shared-route-store.ts:93; nav/shared-departure.ts:51;
  shared.js:15328) becomes "plan from where the leader stands at departure, within the rally
  range of 55", pending your answer (queue A27).
- **Report gaps:** today a gap holds the walk in one of two places. On protocol 4 convoys the
  communication check runs first (nav/shared-navigation.ts:437) and holds everyone in
  `communication-hold` for a report older than 3 s or a stale attacker list
  (nav/communication-recovery.ts:136-137); it resumes after 5 s of stable held reports and at most
  once per 30 s (88). Other convoys, and a member with no attacker observation at all, hold in
  `observing` until 5 s of stopped reports (nav/travel-defense.ts:25-32;
  nav/convoy-defense.ts:74-102). In both holds the walk keeps moving through a gap under 5 s
  unless an attacker is known, pending your answer (queue A20).
- **Ownership checks:** the fifteen functions that compare report and command tuples (02 section
  2.4 G2, listed in the 1.7 stand-ins table) become one `sameWalk(identity, report)` on the
  coordinator. That function lives with the walk, not the
  movement owner; this section lists it because it uses the same identity string.

### 5.2 The walk's own ladder

A group walk climbs the same ladder (3.2), one level up: replan the shared route, rebuild under a
new epoch, regroup at the leader, then send every member to the group's safe point and ask the
group task to start again. A failed event walk does not keep answering later requests with its
failure (nav/shared-walk.ts:343-349); its failure is a ladder step, and the next request for the
same event starts the next step. A failed leg is never replaced at once: the walk's ladder
decides its next step. The design does not port the fork's event walk chain (b0c4d1ef, 029f590b,
5c504443, 653238e1, c5eacf1b; 029f590b is a lint refactor).

An event walk for fighters starts only when the group's healer is in it or the group has no
healer, pending your answer (queue C7). Today waiting members start without the members who have
not asked after 20 s (nav/shared-walk.ts:43-45). The fork's hold (`otherEventAfterFailure` and
`stillJoined`, shared-walk.ts:358-366 (fork)) and the Mr. Pumpkin death behind it came from
b0c4d1ef, which let a walk to another event replace a failed event leg at once, not from the 20 s
start (the 653238e1 message; 02 Q10).

### 5.3 Solo characters

A character farming alone is a group of one with its own coordinator walk service, as today
(`createSoloServices`, runtime/coordinator/application.ts:1784-2007; the travel clock steps each
solo service's convoys at 2015-2018). The solo services have no escape controller (one controller
serves the main party, application.ts:1781) and skip the dungeon gate (2088, 2139-2143). A solo
service holds a visit participant only after a Follow or leader change during the visit, because
the participants are the leader and followers at entry (runtime/coordinator/dungeons/service.ts:44-52,
74-91) and the formation route saves that change with no dungeon check (http/formation.ts:79-100).
The gap is that route; the rank rule (2.1 rule 6) covers it on the character. Its walk is the same
request with the same identity shape. Rendezvous with one member completes on its first stopped
report (scripts/convoy-navigation.cjs:113-119 needs every member assembled; a group of one meets
that at once). A solo character's event trip does not hold the party's task, pending your answer
(queue A45).

### 5.4 The merchant

The merchant is its own group. Convoys never include it (nav/convoy.ts:97-131). Its journeys are
`errand` requests ranked by spec 08's job owner, plus `town`, `manual`, `escape` (never: escape
does not own merchants, shared.js:34) and `unattributed`. The bank-sort wrapper
(`bankSortMove`, shared.js:4305-4327) is the `smart_move` binding for every caller (shared.js:32);
its merchant branch, where a merchant leaving the bank first finishes bank stacks and buffers
(4308-4322), moves into the bank errand's `release`, and the binding itself goes with the other
unconverted callers (N6). The merchant
pausing a fighter convoy for a collection (nav/merchant-interruption.ts:17-119) stays a coordinator
phase of the fighters' walk: a `pause` by the walk's own identity, so it needs no new rule.

## 6. Hooks

Declared in the one hook registry, `runtime/hooks/registry.ts`, the same pattern as the state
field registry (`runtime/coordinator/telemetry/character-fields.ts:56-238` with its section
whitelists at 263-293). Each entry names the hook, the owning part, what it receives and what it
may return. With nothing registered, each hook point is one check of an empty list.

| Hook | Kind | Receives | May return | Decision point |
|---|---|---|---|---|
| `movement.request` | request | `{character, live, tick}` once per role runner movement tick (runner.ts:212) | one request `{kind: 'addon:<name>', owner, destination or step, options, deadline, interrupted: 'cancel' or 'wait'}` | ranked by the rule table |
| `journey.started` | notice | `{character, requestId, kind, owner, destination, status}` | nothing | after `granted`, `kept`, `retargeted` |
| `journey.paused` | notice | `{character, requestId, by, reason, until, state: 'paused' or 'resumed'}` | nothing | pause and resume |
| `journey.ended` | notice | `{character, requestId, kind, owner, code, by}` | nothing | every end |

- **Rank cap:** an add-on request ranks from 1 to 74, below manual travel (75), so no add-on
  outranks the user's own command, Town, the Cave, escape or death recovery. The owner clamps a
  higher value to 74 and records the clamp in the ring.
- **Steps from add-ons** (the fork's boss retreat, runner.ts:239 (fork)) come through the same
  request hook as `step` requests and obey 2.4 and 3.1. An add-on no longer inserts itself into
  the mover chain.
- **End codes are a fixed list,** not text: `arrived`, `released`, `kept`, `replaced:<kind>`,
  `stopped:<kind>`, `expired`, `failed:<code>`, `returned-to-safe`, `superseded`,
  `runtime-replaced`. The text regexes that pick behaviour today (movement.ts:98, 229, 274;
  nav/shared-navigation.ts:46; nav/farm-area-recovery.ts:71-73) read the code instead.
- **Fork features as add-ons:** Phoenix split search (queue C8), pull mode and tank hold
  (queue B1, B2), Franky door flee. Each registers `movement.request`; the fork built each beside
  the current movers (02 section 3.3).

## 7. Bounded records

- **Decision ring:** 128 entries per character, in memory. An entry is `{at, decision, kind,
  owner, rank, destination, code, by, ladderStep}`, about 150 bytes, so about 19 KB per character.
  Decisions are requests, keeps, refusals, waits, pauses, resumes, refused stops, ends and ladder
  steps. The ring records a combat step's pause and resume, not each step. At today's rates
  (one journey every few seconds at most for a fighting character) 128 entries cover at least the
  last minute; under churn they cover the last seconds, which is what the churn snapshot needs.
- **Not in the heartbeat.** The ring is read on demand through a diagnostics lease, pending your
  answer (queue A73).
- **Saved to disk only when:**
  1. the character dies (`combatDeathListener`, shared.js:1079-1097);
  2. a request reaches ladder step 4 (return to the safe point);
  3. a group walk fails (the client attaches the ring to the `/convoy-failed` report it already
     posts, shared.js:15969-15988);
  4. churn: 10 replacements, refusals or refused stops inside 10 s. Bug 8 is this case; the ring
     names each replacing kind, the field the service never recorded (02 section 2.1, ledger bug 8).
- **Pruning:** at most 20 saved snapshots per character and none older than 7 days, pruned when a
  new one is written.
- The comparison log used during migration (11.2) is a separate ring of the same size and goes
  with the comparison code.

## 8. What it replaces and deletes

### 8.1 On the current console

| Stand-in | file:line | Why it goes |
|---|---|---|
| `retainOnDirectStop` option and branch | movement-host.ts:51-52; movement.ts:403-410; shared.js:2770 | steps pause any journey whose row allows them (2.4) |
| `stopStack` capture | movement.ts:411 | refused stops and ends are in the ring with the caller's kind |
| replace-before-read in `move()` | movement.ts:384, 392 | the owner decides before the service runs (2.1, 2.2) |
| `gate.owner` as a public slot, and its writers | movement.ts:63, 414-418; shared.js:2779-2786, 15315-15317, 15552-15553, 15691-15692; formation-recovery-client.ts:36, 95-99 | a request option ("plan only while stopped") the owner applies to its own journey |
| `smart.on_done` identity checks | shared.js:3645, 3698, 11752, 11756, 11764, 14503, 14510, 14538, 14552, 14559, 14639, 14670, 15422, 15527, 15637, 16053, 16101; formation-recovery-client.ts:37, 89 | `release(handle)` is a no-op for a handle that is not live |
| `smart.plot` identity checks | shared.js:15518, 15527, 15637 | the walk's request holds its own journey; nothing else can replace it below its rank |
| `recoveryStage` label checks | shared.js:16678-16680, read at 16666, 16708, 16748-16749, 17124, 17142 | the approach holds a handle; steps check `live().kind` |
| "ownerless journeys look free" | shared.js:16708 | every journey has a kind and rank |
| Town guard loop and its flags | `maintainTownOverrideGuard` shared.js:11078-11101; `townOverrideInFlight` 11044, 11070; `departurePending` as a Town guard 11071-11073 | Town is a rank 85 request; lower requests are refused (`departurePending` stays for `afterCombat`, 14841) |
| escape's clear-and-stop block | shared.js:143, 150-157 | the escape request cancels lower requests by rule, and each requester clears its own state on `journey.ended` |
| command takeover cancel | shared.js:10500-10514 (the cruise release at 10504-10505 stays) | same walk identity keeps; other commands rank by the table |
| convoy takeover cancel and stop | shared.js:15826, 15847 | same |
| revision-change stops | shared.js:10297-10298 | requests carry the revision in their identity |
| status tick and handler stops | shared.js:10322, 10431, 11220, 11252, 11281, 11291, 11303 | each becomes `release` by the request's own holder |
| anniversary and preemption stops | shared.js:11797, 11945, 11947 | ranked requests |
| lone event walk supersede watcher | shared.js:15081-15095 | a `task-walk` request; its holder releases it |
| `anniversaryWithTimeout` around journeys | shared.js:239 (the escape walk keeps walking after its timeout), 13709 (the reunion walk, stopped by its `finally` at 13716); marketplace double stop 8790-8796 | `deadline` on the request; the owner ends the journey at the deadline (queue A22) |
| movement half of `isOccupied` | shared.js:17505-17508, 17523-17525 (movement flags) | `live().kind`; the rest of `isOccupied` stays with spec 03 |
| follow, rare and reunion blocker lists | shared.js:17749-17755, 17770-17775; 3659; 13456-13472 (movement entries) | refusal by rank |
| purpose lists for "which travel may stop or be interrupted" | shared.js:3390-3395, 14087, 14094; runtime/combat/hunt-travel.ts:18-22; nav/rare-hunting.ts:124-131, 181, 841; nav/farm-areas.ts:209-215 | one column per question in the rule table, keyed by task (queue A31) |
| "safe at Main" copies | section 4 table | `isSafeAt` |
| `local.recoveryFailed` dead end | shared.js:210, 233 | the escape request's ladder (UP-2) |
| `rareNavigation.failed` dead end | shared.js:3688 | the rare request's ladder (queue A32) |
| `cancelled` without a next step after respawn | runtime/characters/roles/death-recovery.ts:48-50 | the group task names the next activity (UP-3) |
| fixed retry counts | section 3.2 table | the ladder |
| "Movement replaced" logs the old destination | movement.ts:384 before 391 | the ring records both requests |

### 8.2 On the fork (af92de45, and 21b8362d where marked)

| Stand-in | file:line | Why it goes |
|---|---|---|
| move budget | runtime/characters/move-budget.ts (fork, whole file); movement.ts:50-54 (fork) | decision N4: the 40-move counter goes once the benchmark shows native moves stay under 40 per 4 s (100 of the 200 call cost, move-budget.ts:5 (fork)) without it; the call-cost check moves to the call-budget owner |
| `combat-approach-cancelled` log folding | runtime/characters/movement-diagnostics.ts:4-7, 24-27 (fork) | retargeting in place (2.3) removes the cancel-and-restart it hides; the current 10 s fold (movement-diagnostics.ts:10-13) stays as a log bound |
| pull walk heading test and re-issue | shared.js:18490-18497 (fork) | same request kept (2.2) |
| pull walk stall release | shared.js:18513-18524 (df) | the ladder |
| pull idle-reach check inside `safeCombatPoint` | shared.js:18047-18048 (fork) | `stepSafe` idle rule for every step (3.1) |
| boss zone check inside `safeCombatPoint` | shared.js:18046 (fork) | `stepSafe` monster list entry |
| boss retreat inserted first in the mover chain | runner.ts:238-239 (fork) | add-on step request (section 6) |
| leader origin walk-back | shared.js:16188-16198 (fork, a85b9509) | plan from where the leader stands (queue A27) |
| stranded rescue, the seventh "safe at Main" copy: a rescue that lands off Main while death recovery owns the escape goes to `recovering` instead of `complete`, and the recovering walk does the walking | scripts/party-escape.cjs:96-97, 100-107 (fork, ce6e7c1a); shared.js:229-240 | the `death` goal (section 4) |
| event walk replacement chain | nav/shared-walk.ts (fork; b0c4d1ef, 029f590b, 5c504443, 653238e1, c5eacf1b) | the walk's ladder (5.2) and queue C7 |
| Phoenix split search beside the convoy legs | nav/phoenix-patrol.ts:56-196 (fork); shared.js:4049-4088 (fork) | add-on on `movement.request` (queue C8) |

## 9. Efficiency

### 9.1 What goes away

| Cost | Where today | After |
|---|---|---|
| stop packet, a settle wait that fails after 5 s and a new plan on every repeat of the same request | movement.ts:384, 392, 237-251 | none (2.2) |
| a cancel, a new journey and a stop packet per approach re-aim, up to 4 per second | independent-approach-client.ts:21-28; shared.js:16743 | one plot install per re-aim when the line is clear (2.3) |
| regroup native step re-sent every 100 ms | shared.js:14643-14659; runner.ts:339 | one move per destination (2.4 rule 4) |
| Town guard: up to 2 stops every 100 ms while party Town is active and no Town walk, Town cycle or override pass owns it | shared.js:11078-11101 (stops at 11094-11099) | none |
| travel journeys ended by unrelated stops, then replanned | 102 stop calls: 64 `smart`, 19 `move`, 19 bare; 3 of the `smart` ones pass `success` (02 section 1.6) | stops by non-holders are refused |
| replanning after combat drift | movement.ts:123-170, 278-334 (repair and rejoin) | a paused journey resumes from where it stands; repair becomes the rare case |
| convoy re-preparation for 1-unit drift | nav/shared-departure.ts:45-54; shared.js:15328 | pending queue A27 |

### 9.2 What the owner adds

- Per request: one rank comparison over 14 rows, one identity and distance compare.
- Per step: one `live()` read and one `stepSafe` call. The idle-monster rule adds one cell
  computation and one segment and box test per visible idle monster, whatever the step's length;
  the formation solver already runs a per-monster check on each of its candidates
  (shared.js:16963-16994), so it adds no new loop there.
- Per role runner tick: the three invariants (3.2), a few field reads.
- Memory: about 19 KB per character for the ring.

### 9.3 How both are measured

Before and after, on the same farm and party, with the method's benchmark set
(docs/implementation/00-method.md "Proof of efficiency"):

- **Plans per minute and journeys per minute:** count `ports.metrics` records per journey end
  (movement.ts:85-88; each carries `searches`, `plannerMs`, `requestMs`).
- **Stops per minute by cause:** count end codes (`unattributed-stop`, `destination-replaced`,
  `command-takeover`, `convoy-phase-change` today; `stopped:<kind>`, `replaced:<kind>` after).
- **Native moves per 4 s:** a counting wrapper around `host.move` in comparison mode, the window the
  fork's budget uses (move-budget.ts:5 (fork)). A move costs 2.5 call cost: 1 for the call
  (node/server.js:4980) plus `CC.move` 1.5 (249, charged at 5018-5019), against a limit of 200 per
  4 s (262), so 40 moves are 100. The same wrapper records `character.cc`, the server's total for
  the socket, because moves share the 200 with every other call.
- **Step safety cost:** `formationPerformance.collisionChecks` and `totalMs` (shared.js:16677,
  17158) per minute.
- **Play results:** kills per hour, seconds lost to stalls and regroups, deaths with causes;
  e2e runs through `tools/sim/e2e-benchmark.mts` and `tools/sim/e2e-rate-benchmark.mts`.
- **Pass rule:** no row gets worse on console cost or game cost; the owner does not ship until it
  holds (00-overview "No efficiency regressions").

## 10. Player-visible changes

Every change on purpose. Anything not listed stays the same.

1. **A character no longer stops and stands to re-plan when it is asked to go where it is already
   going.** Fixes the pull stall (bug 3a) and removes the cause class of bug 8. (queue A3)
2. **Travel survives other parts of the console.** Only the journey's owner, escape and death
   recovery can end it, so an event walk is not ended by an unrelated stop (bug 7's first step).
   (queue A2)
3. **Fighting during a walk pauses the walk and the walk continues after,** instead of the
   service repairing the route. Characters resume from where the fight left them. (queue A4)
4. **A chase toward a moving target is smoother**: re-aims on a clear line do not stop the
   character.
5. **Combat steps keep out of idle monsters' aggro check** on every mover: no step enters the 3x3
   block of 32-unit grid cells around an idle aggressive monster's cell, the cells the game server
   checks. Today only the formation solver, the corner, terrain and sight recovery steps (at range
   plus 8, or 38) and the fork's pull mode (a 96 radius) look at idle monsters. In dense packs some
   steps are refused and the character holds or picks another step. (queue A5)
6. **Franky and boss approaches check adds**, with the boss itself excluded. (queue A23)
7. **Escape and death recovery end at the same place**, Main within 65 of (0, 0): no more waiting
   at a Blink landing (bug 5). (queue A6)
8. **Nothing gives up for good.** A character that cannot reach its goal walks to its safe point
   and starts its task again, then retries every 60 s; the dashboard shows how long it has been
   stuck. Manual "request Escape again" and "request Party Town again" messages go
   (shared.js:11771; nav/shared-navigation.ts:525). (upstream priority)
9. **After a respawn the character goes back to its group's current activity**, including its farm
   when the event it died at has ended (UP-3).
10. **Town is exclusive while casting**; no watchdog stop loop. (queue A30)
11. **A timed-out walk stops at its deadline** instead of walking on with no owner. (queue A22)
12. **Event walks wait for the healer** (queue C7); event walks against Hunt travel follow queue A25.
13. **Regroup after failed routes sends the member to the saved farm point** instead of holding new
    pulls for the rest of the key (shared.js:14662-14663). (queue A28)
14. **A failed rare walk is retried once and then the encounter ends**, and the group moves on.
    (queue A32)
15. **Leader drift before departure no longer forces a new plan** within the rally range.
    (queue A27)
16. **Convoys keep walking through report gaps under 5 s** when no attacker is known, in both
    `communication-hold` and `observing`. (queue A20)
17. **A respawn whose event join gets `cant_join` or `join_too_late` stops retrying the join** and
    goes to the group's next activity. (queue A41)

## 11. Migration

### 11.1 Steps

Each step is one shippable change with its own rollback. A setting
`PARTY_MOVEMENT_OWNER=off|compare|on` selects the path, the same way `PARTY_MOVEMENT_MODE=native`
turns the ALClient planner off today (nav/planner-service.ts:9, 57).

1. **Records first, no behaviour change.** Add the ring, end codes and the replacing caller's kind
   to the current service (movement.ts:384, 411). This alone answers bug 7 and bug 8 the next time
   they happen.
2. **Owner in comparison mode** (section 11.2).
3. **Survival and safe goals:** the safe table (section 4), escape and death recovery as requests,
   the escape ladder. Closes UP-2 and bug 5.
4. **Owner on for journeys:** rule table, same-request keep, stop rule. Callers convert by group:
   Town; manual commands; group walks (client side); task walks; formation, approach and follow.
   Unconverted calls run as `unattributed`.
5. **Steps:** `step()` with pause and resume; delete the combat `stop("move")` calls.
6. **Step safety:** `stepSafe` with the idle rule.
7. **Respawn to activity:** death recovery asks the group task (UP-1, UP-3).
8. **Coordinator walk rule:** ranked replacement, the walk's ladder, `sameWalk`.
9. **Fork modes as add-ons**, then delete the fork stand-ins (8.2).
10. **Delete the current stand-ins (8.1) and the comparison code.**

**Rollback:** each step is one commit or a short series, reverted on its own; steps 4 to 8 also
fall back to `PARTY_MOVEMENT_OWNER=compare` without a deploy of old code.

**Every step** (00-method "Rules every change follows", from the console's `AGENTS.md`):
- Its E2E scenarios from 11.3 are written, with their measures and thresholds, before its code,
  and pass on ChronAL virtual time before the next step starts.
- It ends with `npm run typecheck` and a completed console artifact. The artifact stays staged;
  the user decides when to load it.
- A step that touches the coordinator (3, 8 and the coordinator half of 2) starts from
  `runtime/coordinator/README.md` and edits maintained sources: the TypeScript under
  `runtime/coordinator/` and the legacy services it loads (`scripts/party-escape.cjs`,
  `scripts/combat-disengagement.cjs`), never the generated `.build/runtime/coordinator-*.cjs`
  bundles.
- The owner's game-object types (character, monster, map position) come from
  `typed-adventureland` through `Pick` or indexed access; the request, handle, notice and ring
  types are the console's own protocol and stay local.

### 11.2 Comparison mode

With `compare`, every `smart_move`, `movement.move`, `stop`, `cancel` and native combat `move`
still runs as today. Beside each call the owner computes what it would decide (grant, keep,
retarget, wait, refuse, pause, refused stop) and writes a ring entry whenever it differs from what
happened. A separate check resolves each difference as a bug in the owner, a bug in the old
code, or an intended change in section 10. The owner takes over when the list is empty on real
play (00-method "Proof on real play"). The comparison costs one table lookup per call, and 9.3
measures it separately.

### 11.3 Tests

Current tests that prove each rule (all in `scripts/tests/` or `e2e/` on the current console; 02
section 4 maps them). Counts are `test(` declarations at the start of a line
(`grep -cE "^\s*test\(" <file>`), not the tests 02 maps to one slice:

| Rule | Current tests |
|---|---|
| journey lifecycle, planning, repair, barriers | `movement-service.test.cjs` (80 tests) |
| Cave journeys keep through combat stops (2.4 generalizes) | `movement-service.test.cjs` `retainOnDirectStop` tests (lines 550-646); `daily-dungeons.test.cjs` "cave route pauses immediately for local combat and resumes only with fresh party readiness" |
| escape stages and goals | `party-escape.test.cjs` (22); `combat-disengagement.test.cjs` |
| Town | `farm-zone-recovery.test.cjs` "superseded Town guard cannot stop a new convoy or cast Town after an awaited stop"; e2e live-game "Town executes a real cast after travel and returns both party members" |
| group walks and replacement | `shared-convoy.test.cjs` (52), `shared-walk.test.cjs` (23), `convoy-coordinator.test.cjs` (12) |
| combat steps and attacker safety | `combat-movement.test.cjs` (36), `priest-formation.test.cjs` (55) |
| approach | `independent-approach-client.test.cjs` (30), `independent-approach-group.test.cjs` (18) |
| owner guards that become rules | `rare-hunting-client.test.cjs` "new movement owner is not stopped by cancellation of the old rare path"; `farm-zone-recovery.test.cjs` "aggro suppresses path search; a replacement navigation owner is never stopped"; `priest-formation.test.cjs` "holding preserves a destination owned by newer navigation"; `cave-return-progress` "late escape cleanup does not stop replacement navigation" |
| regroup | `grouped-cohesion` |
| reunion | `farm-reunion` (21, plus two looped tests at lines 99 and 190) |

The current tests above are the baseline (00-method "Proof of function", step 1). Most of them are
unit tests, so the owner does not add to them. Four of them change on purpose, and each changed
expectation is shown old and new side by side (method step 4):
- `movement-service.test.cjs` stop tests at lines 261, 275 and 365 expect a foreign `stop('smart')`
  or bare stop to end the journey (365 checks "Unattributed movement stop"); through the owner
  they expect a refused stop and a live journey. The test at line 872 replaces one owner's
  journey with another's; it stays as a service test, and scenario E1 covers the ranked case.
- `grouped-cohesion` three-attempt hold becomes the ladder (queue A28).
- `shared-walk.test.cjs` failure retention tests become the walk's ladder.
- `travel-defense.test.cjs` "missing and stale observations explicitly stop a moving route" changes
  with queue A20.

Each changed unit test changes only its expected value. Its proof moves to the E2E scenario of the
same rule below, and it retires once that scenario passes (method step 5).

#### The owner's proof: ChronAL E2E scenarios by rule

Every scenario is a gameplay E2E under `e2e/` on ChronAL virtual time, run through `npm test` with
the live fixtures (spec 15 TST-026 to TST-029): a disposable game server, the production
coordinator and native game clients, with browser, persistence and telemetry coverage. Each run
writes the e2e report artifact and removes its own workspace. Each scenario follows 00-method
"Every test is defined, measurable and labelled":
- **Label:** the rules it proves and the gaps it leaves.
- **Setup:** map, monsters, gear, settings and positions, fixed in the scenario file.
- **Measures:** counted from the decision ring (section 7), the end codes (section 6), the
  journey metrics (`ports.metrics`, movement.ts:85-88) and the outgoing packets the native client
  driver records (TST-027).
- **Invariants:** the three invariants of 3.2, checked on every role runner tick; the run fails at
  the first break and saves the ring with it.
- **Checks:** asynchronous state is read with a bounded poll for exact values from one fresh
  snapshot, with no sleeps and no widened timeouts. No assertion reads source text, callback order
  or CSS classes.

**E1. Ranked takeover, waiting and expiry** (2.1 rules 1 to 3; N2).
- Setup: a fighter and a priest farm one fixed spot. During a farm-area walk (56) the dashboard
  sends manual travel (75). During a Hunt mission walk (62) an event return (68) takes the party.
  A waiting walk is then given a 30 s deadline it cannot meet, and a second one sees a navigation
  revision change.
- Measures and thresholds: requests whose live kind after the decision differs from the 2.1 table:
  0; stop packets sent for a request that was refused or set waiting: 0; distance between a resumed
  journey's first point and the character's position at resume: under 20; seconds between a
  waiting request's deadline or revision change and its `expired` end: under 1.
- Gaps: only pairs that meet in play; I1 covers the full table. No other players.

**E2. Same request kept, retarget in place** (2.2, 2.3; N3).
- Setup: a party convoy runs assemble, prepare, depart and travel to one farm. A ranger chases a
  moving monster on a clear line, then behind a wall.
- Measures and thresholds: journeys per member per walk across its phases: 1; stop packets from
  repeats of the same request: 0; settle waits from repeats: 0; journeys started per chase on a
  clear line: 1, with stop packets 0; a second owner asking for the held place ends the live
  journey only when it outranks it, with `replaced:<kind>` in the ring: every case.
- Gaps: a chase behind the wall starts a new journey (today's path), so the scenario records it
  and sets no threshold for it.

**E3. Stop rule** (1.3 `stop`; A2).
- Setup: a member walks to an event. The scenario sends a bare `stop()` and a `stop('smart')`
  through the CODE frame, then an event selection change (the status tick stop at shared.js:11281),
  then an escape, then a death.
- Measures and thresholds: journeys ended by a stop from a non-holder: 0; refused stops in the
  ring with the caller's kind: equal to the refused stops sent; stops by the holder, escape and
  death recovery that end the journey: all of them.
- Gaps: callers converted later run as `unattributed` (N6) until their step lands.

**E4. Combat steps pause travel** (2.4 rules 1 to 6; N5; A4, A30).
- Setup: a Hunt mission walk crosses a spawn of aggressive monsters that attack the party. A
  second run casts Town with a monster attacking.
- Measures and thresholds: journeys ended by a combat step: 0; seconds from the last combat step
  to travel resuming: under 1.6; native moves sent for a step point within 2 units of the step
  being walked: 0; regroup step re-sends: 0; planner searches after a fight whose paused route is
  still valid: 0; combat steps sent while Town casts: 0.
- Gaps: kites with gaps over 1.5 s resume and pause again by design (N5); the scenario reports
  their count.

**E5. Step safety** (3.1; A5, A23).
- Setup: a party farms beside a pack of idle aggressive monsters (the Targetron farm of ledger 3,
  fixed spawn), with kiting on. A second run approaches Franky with adds near it.
- Measures and thresholds: steps whose segment enters the 3x3 cell block around an idle monster's
  cell, computed from the monster positions in the same snapshot: 0; steps ending closer than
  `min(distance now, range) - 1` to an attacker other than the target: 0; idle monsters that start
  targeting a member that did not attack them: reported one by one with a cause (gear or stats,
  monster ability, code behaviour), threshold 0 for code behaviour.
- Gaps: facing and the aggro chance are left out of the model on purpose (3.1); the exact cell
  boundaries are I2.

**E6. Escalation ladder** (3.2; N7).
- Setup: a farm walk to a point the server cannot reach, and an event return whose first route
  fails and whose second succeeds. The run advances 15 minutes of virtual time.
- Measures and thresholds: invariant 1 breaks: 0; ladder steps that do not match the failure count
  (one step per failure, back to 0 after 10 units of progress or a map change): 0; waits between
  restarts of 5, 15, 30, 60 and 60 s, each within 1 s; the "stuck for N minutes" notice in the
  dashboard state within 1 s after 5 minutes; requests that end with no `journey.ended` at their
  requester: 0.
- Gaps: the Cave backoff at step 4 (queue A13, A55) runs in the Cave scenarios of spec 07.

**E7. Safe goals** (section 4; A6, A29).
- Setup: positions seeded at 64 and 66 from (0, 0) on Main for `death`, 89 and 91 for `town`, 99
  and 101 for `anniversary`, 89 and 91 from spawn 0 of a non-Main map for `map-exit`, and the
  manual Town point (-174, 121).
- Measures and thresholds: goals whose owner accepts a member outside the radius or waits for a
  member inside it: 0; death recovery resumes with every member at 64 and waits while one is at 66:
  both.
- Gaps: one non-Main map for `map-exit`.

**E8. Group walks** (5.1, 5.2; A20, A27, C7).
- Setup: a party convoy where combat moves the leader 40 units off its planned origin before
  departure; a report fault injector (TST-042) delays one member's reports by 3 s and then by 6 s;
  an event walk whose healer asks 25 s late; an event walk replaced by a higher-ranked walk; an
  event walk that fails once and is then asked for again.
- Measures and thresholds: re-plans for leader drift within 55: 0; convoy holds for a gap under
  5 s with no known attacker: 0; holds for the 6 s gap: 1; fighter event walks that start before
  the healer joins: 0; members of a replaced walk that get their old request back as waiting
  entries: all; later requests answered with the old failure: 0.
- Gaps: solo groups (5.3) run in E1's setup with one fighter; the merchant pause (5.4) is spec 08.

**E9. Hooks** (section 6).
- Setup: a fixture add-on registered through `movement.request` asks for rank 90 while a manual
  walk, a Town cast and an escape run; on the fork, pull mode as an add-on.
- Measures and thresholds: add-on requests that take over manual travel, Town, the Cave, escape or
  death recovery: 0; clamps to 74 in the ring: one per request over 74; journeys with exactly one
  `journey.started` and one `journey.ended` notice: all.
- Gaps: add-ons other than the fixture and pull mode.

**E10. Records** (section 7; A73).
- Setup: a fault injector sends 10 replacements inside 10 s; a member dies; a group walk fails;
  the run then advances 8 days of virtual time with 25 snapshot triggers.
- Measures and thresholds: snapshots saved per trigger: 1; ring entries after 200 decisions: 128;
  saved snapshots per character after pruning: at most 20, none older than 7 days; ring fields in
  the heartbeat payload: 0; `/convoy-failed` reports that carry the ring: all.
- Gaps: disk failures while saving.

**E11. Comparison mode** (11.2).
- Setup: the E1, E4 and E8 setups with `PARTY_MOVEMENT_OWNER=compare`, beside an `off` run on the
  same seed.
- Measures and thresholds: native moves and stops per minute: equal to the `off` run; decisions
  that differ from what happened with no ring entry: 0; the cost per call, reported in 9.3.
- Gaps: real play differences come from the live comparison (11.2), not from this scenario.

The efficiency measures and their pass rule are in 9.3; they run on the E1 to E8 setups.

**UP-1** `live-event-death-rejoin.spec.ts` (3.3 UP-1; queue A41).
- Setup: the party at Mr. Green and, in a second case, the Headless Horseman; one fighter dies;
  the earlier event walk is set to failed. A third case answers a join with `cant_join`.
- Measures and thresholds: seconds from respawn to back in boss range while the event lives: under
  120; seconds without a journey, a pause or a due ladder step: never more than 60; join retries
  after `cant_join`: 0.
- Gaps: events without a walk path, such as Slenderman's search.

**UP-2** `live-farm-death-escape.spec.ts` (3.3 UP-2; queue A6).
- Setup: a death while farming; case A with the trio (landing off Main), case B with the walk home
  blocked so the first route fails.
- Measures and thresholds: seconds until every member is within 65 of (0, 0) and death recovery
  resumes the farm: under 240; manual actions: 0.
- Gaps: parties without the trio (spec 05 SRV-Q6).

**UP-3** `live-event-death-after-end.spec.ts` (3.3 UP-3).
- Setup: a fighter dies at an event and the event ends before it respawns; one case farms, one
  runs Hunt.
- Measures and thresholds: seconds from respawn to back at the group's farm or Hunt: under 180;
  seconds the character stands at spawn with no request: never more than 15.
- Gaps: a member left out of the event return's participant list is the inference in 3.3; the
  scenario records which case fires.

**Bug 7 regression.** A mage escort in a joined event with the corner blocked by adds; measure:
seconds out of range; threshold: under 10 (pending your answer (queue A24)).

**Bug 3a regression.** Pull walk on the fork's add-on; measure: journeys started per pull;
threshold: 1.

#### Isolated tests, where no E2E can reach the case

Each failure list below comes before the code (AGENTS.md: write down every way the system could
fail, then write the code). Each test loads the TypeScript module it names, not a slice of
`characters/shared.js`.

**I1. The rule table** (`runtime/navigation/movement-rules.ts`; 2.1).
- Why no E2E: 14 rows give 196 ordered pairs, and most of them, such as `cave` against
  `lifecycle` or an add-on against `death-recovery`, never meet in a run that can be set up. E1
  covers the pairs that meet in play.
- Expected values: the 2.1 table as written in this design, typed in by hand, not generated from
  the module under test.
- Failure list:
  1. A lower rank takes over a higher one.
  2. An equal rank takes over instead of waiting or being refused.
  3. A row whose lower requests wait cancels them, or a row that cancels lets them wait.
  4. A group walk ranks by its row range instead of its task rank (2.5).
  5. An add-on rank above 74 is not clamped to 74, or the clamp is not recorded.
  6. An `unattributed` request interrupts a live request.
  7. A stop by a kind outside the row's Stop column succeeds, or a default stopper (holder,
     escape, death recovery, runtime disposal) is refused.
  8. A step is allowed under a row whose Steps column says no, or refused under one that says yes.
  9. The character owner and the coordinator's walk replacement rank the same pair differently.

**I2. Idle-monster grid in `stepSafe`** (3.1 rules 2 and 3).
- Why no E2E: idle monsters wander and the server picks their spawn points, so a run cannot hold a
  monster at a fixed offset inside its 32-unit cell for each boundary case. E5 covers the rule in
  play.
- Failure list:
  1. A step ending in one of the 9 cells around an idle monster's cell, a diagonal corner
     included, is allowed.
  2. A step ending two cells away on either axis is refused: 33 units from a monster at the edge
     of its cell, and 70 units straight along an axis, where a 91 radius would refuse it.
  3. A segment that clips only a corner of the block is allowed.
  4. A step that starts inside a block and ends outside it is refused.
  5. A monster with a target, or with no `aggro` value, blocks a step.
  6. The selected target or a boss the step approaches on purpose blocks a step.
  7. The attacker rule differs from today's `safeCombatPoint` (`min(distance now, range) - 1`,
     shared.js:17167-17172).
  8. A missing range defaults to a value other than 20.
  9. A fork boss zone or avoided monster is not applied with its own radius.

The earlier draft's 13 rule-table unit tests map onto these: tests 1 and 8 to I1, E1 and E9; 2 to
4 to E2; 5 to E3; 6 to E4; 7 to E1; 9 to E6; 10 to I2 and E5; 11 to E7; 12 to E10. Test 13 ("no
behaviour reads reason text") was a source-text check, and the end codes each scenario reads from
the ring replace it.

## 12. Decisions for you

Each item: the recommendation, why it beats the others, and the negatives of every option. Items
from the review queue use its recommendation as the working assumption.

### Decided 2026-10-26

These decisions replace any working assumption or recommendation for the same item elsewhere in this document.

- **B2** (MOV-Q18 and TGT-Q1: who pulls in pull mode; decided by your answer): The priest never pulls unless it is the designated tank; a party setting picks the puller, and in your trio the mage pulls.
- **B1** (MOV-Q17: what the tank does under 50% HP (fork); decided by your answer): Kiting becomes part of the new avoidance and pathing design (queue item AV): the tank keeps kiting, prefers steps toward the priest, and picks steps that keep the following party from pulling more.
- **C8** (MOV-Q20 and RARE-Q4: how the party searches for the Phoenix; decided by your answer): The plan settles the search by working out find time plus regroup time for each option from the Phoenix region distances and walk speed, and keeps the faster one.
- **B13** (Pass marks in the movement tests that have no stated reason; decided by your answer): Pass marks become reaches its goal without anyone stepping in, with any time limit worked out from route length at walk speed; the cast rate and potion count marks go.
- **A2** (MOV-Q2: who may stop a walk; decided by your answer): The owner just does this: only whatever started a walk, an escape or death recovery can stop it.
- **A3** (MOV-Q1: the same destination asked again; decided by your answer): The owner ignores a repeated destination and watches for a party that is not actually moving, then fixes it.
- **A4** (MOV-Q3: fighting during a walk; decided by your answer): Fighting during a walk becomes part of the avoidance and pathing design (queue item AV), driven by the defender and passive monster settings.
- **A5** (MOV-Q5: steps near idle monsters; decided by your answer): Step safety becomes part of the avoidance and pathing design (queue item AV), which weighs the risk of an extra monster against slower farming.
- **A6** (MOV-Q14 and SRV-Q5: where the party regroups after an escape or a death; decided by your answer): The party regroups in Main near the spawn point for now, and a safer regroup spot is part of the avoidance and pathing design (queue item AV).
- **A20** (MOV-Q12: a late status report during a group walk; decided by the plan): A group walk keeps going through a late report while no attacker is known, for up to two of the console's own report intervals, so the limit follows the report rate instead of a fixed 5 s (rule R2).
- **A25** (MOV-Q8: an event walk versus a trip in progress; decided by the plan): Short-window bosses take over at once and other events wait for a trip to arrive or fail; each event's duration in game data marks it short-window.
- **A26** (MOV-Q9: bosses that move; decided by the plan): Walks follow every boss that moves.
- **A27** (MOV-Q11: the leader drifting before a group walk; decided by the plan): The group walk starts from where the leader stands once everyone is within the group's own regroup distance, so no separate drift number exists (rule R2).
- **A29** (MOV-Q15: what counts as home; decided by the plan): Home is where the game itself puts a character, the Main spawn point after a respawn and the Town landing point after Town, read from game data, and every feature checks those same points (rule R2).
- **A31** (MOV-Q19 and RARE-Q1: which trips a rare monster may interrupt; decided by the plan): One list: a rare can interrupt farming and Hunt travel, trips you start by hand finish, and each rare has a may interrupt Hunt travel switch.
- **A32** (MOV-Q21: a failed walk to a rare; decided by the plan): A failed walk to a rare keeps trying while the party gets closer and stops when the rare is gone; when it stops getting closer the owner changes strategy, and the card shows what it is trying (rule R2).
- **C7** (MOV-Q10: an event walk without the priest; decided by the plan): The event walk waits for the priest only while waiting still lands the party within 60 s of the spawn, then goes without it (rules R3 and R6).
- **N4** (Your fork's move limit; decided by the plan): The fork's move cap goes once a test run shows moves stay under it, and the call limit check moves into the one call limit guard.
- **N7** (Movement that keeps failing; decided by the plan): Stuck walks never give up. When a walk stops making progress, the owner changes strategy at once instead of after 5 minutes, and the card shows what it is trying (rule R2).
- **N8** (A fighter's errands versus walks to a rare; decided by the plan): A fighter's bank or restock trip goes ahead of a walk to a rare, as today.
- **AV** (avoidance and pathing, the plan's restatement of B1, A4, A5 and A6; decided by your answer): The restatement under AV in the review details stands with these changes. Standing still is the right step when moving would pull more monsters, and stuck is never an answer. When the console confirms the rest of the team is fighting and one fighter is not, that fighter fights the event boss or monsters on its own as best it can. Escape and death settings still apply, but the whole team does not Town out of an event. The console checks whether the party is alone at the event, with no other players sharing damage, and weighs the risk accordingly. No careful, normal or bold setting exists: the console accomplishes the task unless it cannot.
- **A23** (MOV-Q6: Franky and boss approaches; decided by your answer under AV): Boss approaches pick a path that keeps the whole following party clear of idle monsters' aggro, using the game server's own check, and standing still is the right step when moving would pull more (AV).
- **A24** (MOV-Q7: blocked mage escort in an event; decided by your answer under AV): A mage blocked from its event spot takes the event's own approach path, and when the rest of the team is fighting it fights the event boss or monsters on its own as best it can (AV).
- **A28** (MOV-Q13: regroup after three failed routes; decided by your answer under AV): A member cut off from the group keeps trying to rejoin while it makes progress, walking via the saved farm spot when the direct way fails; when progress stops the owner changes strategy, and the card shows what it is trying (AV, rule R2).
- **N2** (Which interrupted requests wait; decided by your answer under AV): Group walks and errands resume where they stopped, and following and approaching start fresh (AV).
- **N5** (How combat lets go; decided by your answer under AV): A walk paused for a fight resumes when the fight lets go, and standing still is the right step when moving would pull more (AV).

### From the review queue

| Item | Working assumption | Why | Negatives |
|---|---|---|---|
| A1 precedence | escape > death recovery > Cave > Town > manual > group walks by task rank | written once, matches today's order outside the gaps spec 01 found in the owners' own lists, and closes those gaps (2.1 rule 6) | (a): the fork's mode sits at the bottom and waits; (b) anniversary above attendance: a featured hold can cost a combat event |
| A2 who may stop | holder, escape, death recovery | Town becomes a request, so no other exception is needed | (a): a mover that relied on stopping others must now request; (b) adds the Town guard back as an exception; (c) today: bug 7 class stays |
| A3 same request | keep when owner and place match | removes restart loops at the source | (a): a caller that wanted a fresh route must ask by name (`options.replan`); (b) a new owner inherits a journey it did not start; (c) today's stalls |
| A4 combat during travel | every step pauses and travel resumes | one owner at a time, repair becomes rare | (a): a resume after every fight costs one plan when the paused route is no longer valid; (b) ordinary walks keep repair churn; (c) keeps the repair path, nine commits from 2026-10-08 to 10-14, as the mechanism |
| A5 idle monsters | every step stays out of the 3x3 block of 32-unit grid cells around each idle aggressive monster's cell, the server's own check (3.1) | bugs 3d and 4; the check is now read from the server source, and a grid model refuses only the places the server checks, where a radius cannot (Q5's corrected recommendation) | (a) with the grid: more refused steps in dense packs, so more holds; it ignores facing and the aggro chance, so it also refuses some steps the game would allow; (a) with a 91 radius: refuses places along an axis between 64 and 91 that the server never checks, and holds more; (b) protects tank and healer only, others still pull packs; (c) today's deaths |
| A6 safe after death | Main within 65, one goal for both | respawn is in Main; ends bug 5 | (a): a long walk home from far maps; (b) landing regroup can stand next to the monsters that killed them; (c) back to farm at 50% HP can die again; (d) nearest Town may not be where respawned members are |
| A13 Cave and survival | escape and death recovery run outside the Cave; a held visit ends on its own after 5 minutes; in a Cave the ladder's step 4 waits on the backoff | a Cave has no safe point; outside it AFK needs survival, and nothing waits for the user | (d) with Cave Q3 (b): a deliberate hold ends after 5 minutes; a Cave exit walk may race Cave release; (a) today: death handling off after a Cave |
| A20 report gaps | keep walking under 5 s with no known attacker, in both `communication-hold` (protocol 4) and `observing` | one slow report no longer stops four characters | (b): a real attack in the gap is seen up to 5 s late; (a) slow links stop often, and a second gap within 30 s of a `communication-hold` resume waits out the rest of that 30 s; (c) the stale member drifts from its group |
| A22 timed-out walks | stop at the deadline | no unowned walks | (a): a walk that would have arrived a second later stops; (b) unowned walks |
| A23 boss approaches | `stepSafe` with the boss excluded | adds near bosses kill tanks | (b): some approaches are refused while adds stand in the way; (a) terrain-only walk-ins (bug 4) |
| A24 blocked mage escort | event detour fallback | reuses an event mover | (b): the detour can still find no path; (c) puts the coordinator in event timing; (d) breaks formation cover |
| A25 event vs travel | short-window bosses win, others wait | timing matters only for short windows | (c): needs a per-event window list to maintain; (a) today: wasted outbound Hunt trips (shared walks, manual walks and Hunt returns are already spared, 2.1 rule 2); (b) missed short events |
| A26 moving bosses | one list, follow all | two lists that disagree are the bug | (b): more re-preparations for bosses that barely move (unverified); (a) frozen points; (c) late arrivals |
| A27 leader drift | plan from where the leader stands, within 55 | combat drift is normal | (c): the shared route's first leg differs per member by up to 55; (a) frequent re-plans; (b) walk-back delays departure |
| A28 failed regroup | send the member to the saved farm point | ends the separation | (c): the member walks away from the fight; (a) idles; (b) still a count that can end |
| A29 home radii | one table, a radius per workflow | different goals, written once | (b): five values to keep; (a) one radius is wrong for at least one workflow |
| A30 Town exclusive | nothing moves while casting | a step would cancel the cast | (a): a character under attack at the cast point does not dodge; (b) cast restarts; (c) the watchdog |
| A31 rare interrupts | one list; hand-started party travel stays | user intent wins | (b): a rare next to a hand-started trip is missed; (a) user trips interrupted; (c) misses rares on relocation types not listed |
| A32 failed rare walk | retry once, then end the encounter | a second failure means the route is wrong | (c): a rare reachable only by a long detour is dropped; (a) can loop; (b) gives up on a fight-interrupted walk |
| A41 join failures | end the join at once for `cant_join` and `join_too_late`, back off for the other replies (spec 06 question 3; UP-1) | in the server source `cant_join` means the event flag is off and `join_too_late` exists only for A/B testing (node/server.js:12641-12711), so both stay final for the occurrence | (c): depends on the game's reply strings, and an unknown string falls back to (b); (a) today: a retry every 1 s after a respawn and every 10 s from the event poll, each asking permission; (b) waits N tries for a reply that is already final |
| A45 solo characters | never hold the party | groups are independent | (a): a solo character at the same event walks alone |
| A73 rings in the heartbeat | read on demand with a lease | cuts payload | (a): no ring history unless someone opened the view or a snapshot was saved |
| B1 tank under 50% | step toward the healer | into heal range, not into a pack | (b): the tank's target may follow it into the healer; (a) bug 3d; (c) needs a live off tank |
| B2 who pulls | never the healer by default, a pull role as override | bug 3b | (d)+(e): a party with only a long-range healer cannot pull without a setting; others as listed in the queue |
| C7 missing members | never start a fighter event walk without the healer | one rule for what the fork's event walk patches reached for; the lone death they answered came from replacing a failed leg at once (b0c4d1ef), which the walk's ladder (5.2) removes, so this rule only has to cover the 20 s start | (c): a dead or late healer delays the event walk; (a) members who have not asked within 20 s are left behind; (b) the fork's hold covers only a walk that replaces a failed leg, and keeps a chain of five commits |
| C8 Phoenix | both, split search as an add-on | the add-on uses the owner instead of running beside it | (c): two modes to test; (a) fighters alone; (b) slower search |

### New in this design

**N1. Where the owner lives.**
- Recommendation: one owner per character, with group walks as requests into it.
- Why: movement belongs to each character whatever group it is in (00-overview "Groups, not the
  party"); the character sees its own journey, steps and pauses without a round trip.
- Negatives: (recommended) the coordinator still needs its own walk replacement rule, so the rule
  module serves two runtimes; (other) a coordinator-side owner adds a round trip to every
  combat step and cannot see native moves.

Answer in the review queue (N1).
**N2. Which interrupted requests wait.**
- Recommendation: only group walks and errands wait and resume; character-local movers are
  cancelled.
- Why: local movers recompute from the situation on their own tick; replaying an old follow or
  approach point is wrong after a fight. Group walks and errands hold intent that is not
  recomputed (today's parent restore, nav/shared-walk.ts:168-182).
- Negatives: (recommended) a follow interrupted by Town must start again on its next tick (up to
  1 s); (all wait) the waiting list grows and stale points resume; (none wait) a Hunt trip
  interrupted by an event walk is lost, a regression from today's parent restore.

Answer in the review queue (N2).
**N3. Retarget in place.**
- Recommendation: same owner, same map, clear line: replace the plot on the live journey (2.3).
- Why: removes the approach's stop-and-replan churn (W3, eight patches from 2026-10-13 to 10-19)
  with an existing service call.
- Negatives: (recommended) a second way a journey's destination can change, which the ring must
  record; (new journey each time) today's churn.

Answer in the review queue (N3).
**N4. The fork's move budget.**
- Recommendation: split it. Delete the 40-move counter after the benchmark (9.3) shows native moves
  stay under 40 per 4 s without it. Move its call-cost check (wait 250 ms while the server's call
  cost for the socket is 150 or more, move-budget.ts:5, 24-25 (fork)) to the call-budget owner
  (00-overview finding 5) instead of deleting it.
- Why: the move cost is now confirmed: 1 per call (node/server.js:4980) plus `CC.move` 1.5 (249,
  5018-5019) is 2.5, against a limit of 200 per 4 s (262), so the counter's 40 moves are 100, half
  the limit, and moves share the rest with every other call. The owner removes the re-issue loops
  the counter guarded (02 section 3.1), and the benchmark checks that nothing is left for it to
  catch. The call-cost
  check guards the socket's total, which no movement rule can see, so it belongs with the owner of
  the whole budget. It beats deleting both because the total still needs a guard, and beats keeping
  both in movement because movement does not own the other calls.
- Negatives: (recommended) the call-cost check waits for the call-budget owner to exist, and until
  then it stays where the fork has it; with the counter gone, a new move loop shows only as call
  cost, not as a move count. (delete both) one unexpected burst source can reach the disconnect at
  200 before it is measured: 80 moves alone are enough. (keep both in movement) a second limiter
  that hides the cause of new loops and delays combat steps by 250 ms under load (move-budget.ts:5,
  25 (fork)), inside a part that does not own the budget it limits.

Answer in the review queue (N4).
**N5. How combat lets go.**
- Recommendation: `resetCombatMovement` resumes travel, and 1.5 s without a step resumes it too.
- Why: the first is the runner's existing "no target or threat" branch; the second covers a mover
  that stops sending steps without reaching that branch.
- Negatives: (recommended) a kite with gaps over 1.5 s resumes travel mid-fight, then pauses again
  on the next step; (explicit only) a mover that forgets to let go holds travel until the request's
  deadline; (timeout only) travel resumes late after every fight.

Answer in the review queue (N5).
**N6. Unconverted callers during migration.**
- Recommendation: kind `unattributed`, rank 10, never interrupts a live request.
- Why: code typed in the game client and late conversions keep working; comparison mode lists
  every one.
- Negatives: (recommended) a missed conversion of an important mover becomes a low-priority mover
  until fixed; (refuse unattributed) breaks hand-typed client code.

Answer in the review queue (N6).
**N7. Escalation backoff.**
- Recommendation: 5, 15, 30, then 60 s repeating, with a stuck notice after 5 minutes.
- Why: the same waits the console already uses (scripts/farming-navigation.cjs:268), without the
  end.
- Negatives: (recommended) a character that can never reach its goal tries every 60 s for as long
  as it runs, about 60 plans an hour; (longer cap) slower recovery after a transient block;
  (shorter cap) more plans and calls.

Answer in the review queue (N7).
**N8. Errand rank for fighters.**
- Recommendation: 65, above the rare task's walks and below Hunt turn-in.
- Why: the rare path yields to banking and stocking today (shared.js:3659); inference: no other
  code orders errands against group walks on the character.
- Negatives: (recommended) a bank trip delays a rare walk, as today; (below rare) a rare can strand
  a character with a full bag.

Answer in the review queue (N8).

## Corrections to 02-movement.md

Found while designing. The verification pass applied all six to 02 (04-verification-02-movement.md
rows C1 to C6), and its findings changed this design as listed under "Changes after the spec check".

1. **MOV-001 neighbour line, slice 1.2 preamble.** "sends a native stop move if the character is
   moving (movement.ts:390)" (02 line 357): the stop move is at movement.ts:392; line 390 is
   `delete state.in`.
2. **Aggro reach is verifiable now.** 02 1.3 "Step safety" and section 10 "Not yet verified" say the
   about 90 unit reach is unverified against the game source. The game source confirms it:
   node/server.js:14394-14405 and 15263, node/server_functions.js:1188-1216 at
   kaansoral/adventureland_mongodb 43b2c8fc; the bound is `64 x sqrt(2) = 90.51`. It also needs the
   monster to face the player (`is_in_front`, node/server.js:15265), and a monster with aggro below
   0.99 joins the grid only by chance each tick (14403), which 02 does not mention.
3. **Move call cost.** The fork comment (move-budget.ts:1-3 (fork)) says one move costs 2.5; the
   game table says `CC.move: 1.5` (node/server.js:249), and every socket call also goes through
   `add_call_cost(-1)` (4980). Resolved by the verification pass (row C3): each call adds 1
   (stored as 1 at node/server_functions.js:5446) and `CC.move` adds 1.5 to the same entry
   (5018-5019), so a move costs 2.5. N4 now uses it.
4. **MOV-033 follow condition.** `publishSelection` also skips follow under `exclusiveCombat()`
   and `usesGroupedCombat()` (runner.ts:150, 155), not only in scatter mode.
5. **UP-3 dead end is not in 02.** `rejoinActiveEventAfterRespawn` returns `cancelled` when the
   event it died at has ended (shared.js:13724-13726), and death recovery then skips `rejoinFarm`
   (runtime/characters/roles/death-recovery.ts:48-50). 02 section 2 has no entry for it; it belongs
   in 2.2 next to W2-3, or in spec 05.
6. **UP-2's second path is not in 02.** `local.recoveryFailed` (shared.js:210, 233) stops the escape
   walk for good after `eventReturnRouteToMain` gives up (11748, 11771), and the coordinator's
   `recovering` and `recovery-convoy` stages have no deadline (scripts/party-escape.cjs:65, 70,
   72-77). 02 ledger bug 5 covered only the landing path.

## Changes after the task owner design

These statements changed with `01-groups-and-tasks-design.md` "Corrections to the checked specs"
(items 1, 2, 6 and 7) and the queue updates of 2026-10-26; each was rechecked on
`refs/review/ryan-1.5`.
- **Dungeon gate gap (2.1 rule 6, 5.3).** The gap is the formation route, which saves a Follow or
  leader change during a visit with no dungeon check (http/formation.ts:79-100); a solo service
  holds a visit participant only after such a change (dungeons/service.ts:44-52, 74-91).
- **Farm areas and death recovery (2.1 rule 6).** The open window is `finishing`
  (scripts/combat-disengagement.cjs:81); the convoy and escape checks cover the other phases.
- **Event return (2.1 rule 6).** Its dispatch already waits for any convoy (events/returns.ts:231);
  the gap is the escape stages and recovery phases without a convoy.
- **Farming walk rank (2.5).** Party travel to the farm, empty-spawn recovery, the return after a
  rare and the farm reunion now rank 56 with farm-area moves.
- **Cave step 4 (3.2, 5.2, 11.3, 12).** It waits on the backoff instead of holding, because queue
  A13 and A55 now recommend options with no manual step.

## Changes after the spec check

This draft predates the claim-by-claim check of 02. These are the design statements that
changed with the checked 02 (04-verification-02-movement.md), the checked 01 and 06
(06-verification-01-06.md) and the checked 03 to 05 (05-verification-03-05.md). The check reopened
every remaining citation on `refs/review/ryan-1.5` (b9b5c91e), and the fork citations on af92de45.

Decisions whose recommendation changed:
- **A5 idle monsters (section 3.1, 10 item 5, 11.3 I2 and E5, 12).** The step check now models the
  server's 32-unit grid and its 3x3 cells instead of a 91 radius, as 02 Q5's corrected
  recommendation says (log rows C2, SS-6, Q5c). The `AGGRO_REACH = 91` constant is gone; the cell
  size, 32, replaces it. One segment and box test per monster replaces the 20-unit segment
  sampling, so 9.2's cost line changed too.
- **N4 move budget (8.2, 9.3, 12).** The move cost is confirmed at 2.5 (row C3). The
  recommendation is now a split: delete the 40-move counter after the benchmark, and move the
  fork's call-cost check (150 of 200) to the call-budget owner in either case. The earlier draft
  deleted the whole budget after the benchmark and moved it only if moves stayed over 40.
- **A41 join failures (new row in 12; UP-1; 10 item 17).** Added because UP-1 now depends on it:
  `cant_join` means the server's event flag is off and `join_too_late` exists only for A/B testing
  (06 2.2, node/server.js:12641-12711), so the working assumption is spec 06 question 3's (c).

Decisions whose reasons or negatives changed, recommendation kept:
- **A1 precedence (2.1 rule 6).** New rule 6 makes the rank table cover the gaps spec 01 found:
  the dungeon gate does not cover the solo services (application.ts:2088, 2139-2143); farm areas
  never read death recovery; the event return reads neither escape nor death recovery; admission
  reads neither; the Hunt roster cancels every non-Hunt convoy, during a turn-in too
  (hunt/participants.ts:84-92).
- **A4 (12).** Option (c) now names nine repair commits from 2026-10-08 to 10-14 (row Q3b).
- **A20 report gaps (5.1, 10 item 16, 12).** Protocol 4 convoys hold in `communication-hold`
  first (resume after 5 s, at most once per 30 s); the assumption covers both holds (row Q12).
- **A25 event vs travel (2.1 rule 2, 12).** Today an event walk replaces only convoys that are not
  shared walks, not navigation exempt and not non-preemptible, so outbound Hunt convoys are the
  ones lost (rows RC5b, Q8, G1c).
- **C7 missing members (5.2, 12).** The fork's hold and the Mr. Pumpkin death came from b0c4d1ef
  replacing a failed event leg at once, not from the 20 s start (rows Q10b, Q10c); the fork's
  chain has five commits (Q10d). The walk's ladder now says a failed leg is never replaced at once.
- **N3 (12).** "Nine patches in seven days" is now eight patches from 2026-10-13 to 10-19 (W3-5).

Other statements corrected:
- Stop rule (1.3, 2.4 rule 6, 9.1): only a bare, `move` or `smart` stop ends a journey
  (movement.ts:411); `success` ends it as arrived; a failed `stop('move')` on a Cave journey
  pauses (403-410); `stop('town')` reaches only the native stop (412) (rows SV-3, MOV-005a). The
  combat stops in `holdFormation` and `resetCombatMovement` fire only while the character walks
  their own step.
- Step safety (3.1, 10 item 5): corner, terrain and sight recovery also check every visible
  monster, and an outranging monster that does not target the character gets a flat 38
  (16246-16247), idle or not (rows RC4b, W1-3, MOV-083b).
- Approach re-aim (2.3, 9.1): only for a pending direct journey or one past its last level, lines
  22-28; the re-aim cancels before it restarts (rows MOV-093b, W3-1, W3-3).
- Settle wait (2.2, 9.1): it waits until the character settles and fails after 5 s (row RC2).
- Counts: `isOccupied` has 27 checks, 25 of which can return true (1.2; row SV-8); fifteen
  functions compare report tuples, not twelve (5.1; rows SV-9, SI-tuple); the coordinator keeps 31
  timer and budget values (3.2; rows RC8a, G6a); anniversary staging has five 100-unit checks
  (section 4; row RC6c); the map spawn check at 11017 is not Main (section 4; row RC6b); 102 stop
  calls, 3 of them with `success` (9.1; row SV-13). The 130 named functions plus 2 top-level lines
  (row SV-12) did not appear in this design.
- UP-1: `retainedFailure` answers every event walk request from the member, not only the same
  event, and `runtimeTurnoverReady` needs more than a new runtime (rows MOV-140b, MOV-141a); a
  rejected `join()` retries every 1 s (new step 6).
- UP-2: the walk home gives up after 4 legs, a 15 s stall or 180 s, and a superseded leg ends the
  whole route (row MOV-039e); `recovering` and `recovery-convoy` are both exempt from the deadline
  (row C6); a manual travel command or a Hunt mode change releases the party (rows Q14, B5-7); a
  warrior's defense Dash still runs in `complete` (row MOV-036e); death recovery's `safe` also
  needs settled reports, 50% HP and no threats (row B5-6).
- UP-3: the rejoin mark needs `eventsEnabled` (05 row SRV-008-2); character death recovery calls
  the farm return only for `not-applicable`, and the coordinator's farm return applies only
  outside Hunt (combat-disengagement.cjs:98-100), so ladder step 4 follows the same split.
- Fork stranded rescue (section 4, 8.2): the seventh "safe at Main" copy, not the third; it sets
  `recovering` instead of `complete` and the recovering walk does the walking (05 row
  SRV-bug5-7; row B5-third).
- Escape and Hunt convoy writes (5.1): `cancelCoordinatorHuntConvoy` clears a Hunt convoy directly
  (row SV-7).
- Pause sources (2.1 rule 4): the dungeon `canMove` gate also covers a dungeon-owned gather
  outside a Cave (row MOV-165a). Rule 5 now names every tick the dungeon gate skips.
- Solo services (5.3): `createSoloServices` is application.ts:1784-2007, not 1787-1810; the solo
  services have no escape controller (row MOV-161a).
- Errand row (2.1) and merchant (5.4): shared.js:4323 is `bankSortMove`, the `smart_move` binding
  for every caller, not a fighter errand; the errand row now cites upgrade preview (2501) and bank
  stack floors (4040).
- Fork step list (2.4): 18128-18353 (fork) are the Franky movers; the fork's tank hold is a hold,
  not a step (row F3.1-6).
- `anniversaryWithTimeout` (8.1): the reunion walk's `finally` stops it (13716); only the escape
  walk keeps walking (rows Q4, W2-3c).
- Town guard (9.1): it runs whenever party Town is active, skipped while a Town walk, a Town cycle
  or an override pass owns movement (rows MOV-051a, MOV-051b).
- Paths and lines: the field registry is runtime/coordinator/telemetry/character-fields.ts;
  `nav/planner-service.ts`; `idleMovement` (runner.ts:196-199) also calls `resetCombatMovement`;
  fork diagnostic folding is movement-diagnostics.ts:24-27 (fork); service recoveries share their
  counter with drift replans (row MOV-012d).
- Tests (11.3): file counts are `test(` declarations (combat-movement 36, priest-formation 55,
  independent-approach-client 30, independent-approach-group 18; rows T4.3-2, TGT-test-2); the
  stop tests that change are at movement-service.test.cjs lines 261, 275 and 365, and the
  two-owner test at 872 stays a service test (row T4.1-2).
- Corrections to 02 (above): the verification pass applied all six and resolved item 3.

## Correction: move cost

The game server resets `current_socket` to `false_socket` after every handler
(node/server.js:5054), so the base charge of 1 never reaches a player socket.
A move costs 1.5, not 2.5, and the fork's 40 moves per 4 s are 60 of the 200
limit, not 100. Decision N4 keeps its recommendation (benchmark, then delete
the move counter; the call-cost wait moves to the call budget owner); only
its numbers change.
