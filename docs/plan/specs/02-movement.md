# 02 Movement: where each character moves, and who may stop it

Milestone M0 (the map). Checked against the current `1.5-feature-branch` at `b9b5c91e`
(`refs/review/ryan-1.5`). Lines marked (fork) are on the user's fork at `af92de45`; lines marked
(df) or (21b8362d) are on the death fixes at `21b8362d`. `shared.js` means `characters/shared.js`. Paths that
start `nav/` are in `runtime/coordinator/navigation/`.

## How to read this spec

Movement is the part of the console that walks a character from where it stands to where some task
wants it, and the part that decides what happens when two tasks want different places. Today the
console has a movement service with one journey per character, but no movement owner: any code may
start a new journey over the old one, and any code may stop it. Section 1 lists every behaviour,
grouped by where the code lives. Section 2 explains what goes wrong and why, and traces ledger bugs
3, 4, 5, 7 and 8 from the first wrong decision to the symptom.

This spec was written as the deep second pass the full review asked for. Every function claimed in `catalog/02-movement.json` was read in
full on the current console, in five slices:

| Slice | Code | Behaviours |
|---|---|---|
| 1.1 | Movement service, route planning and validation, the coordinator planner, the role runner's mover chain and the combat queue client's ticks | MOV-001 to MOV-034 |
| 1.2 | Character movers in `shared.js` outside 15079-17660: escape movement, Cave hooks, travel defense helpers, rare paths, Town, event walking, farm reunion, grouped regroup, follow | MOV-035 to MOV-065 |
| 1.3 | `shared.js` 15079-17660 and `runtime/combat/` movement files: convoy client, farm approach, formation, terrain recovery, independent approach, combat steps and step safety, occupancy | MOV-066 to MOV-105 |
| 1.4 | Coordinator convoys, shared walks, navigation authority, travel defense, returns and escape stages (`nav/*`, `scripts/party-escape.cjs`, `convoy-navigation.cjs`, `farming-navigation.cjs`, `command-ownership.cjs`) | MOV-106 to MOV-147 |
| 1.5 | Rare, Phoenix and farm travel, restart recovery, manual travel commands, coordinator travel wiring in `application.ts` | MOV-148 to MOV-165 |

Counts in this spec come from the spec's working scripts, which are not in the plan (`writers.cjs`
for the writer and stand-in scans, `assemble.cjs` and `claims.cjs` for the catalog), unless a command
is given inline. The catalog counts come from `node tools/check-claims.mjs` (section 10).
`docs/implementation/04-verification-02-movement.md` logs the claim-by-claim check of this spec.

## 1. What it does today

### The short version

- **One journey slot per character.** `smart_move`, `movement.move`, `stop` and `cancel` all act on
  the one active journey (`let journey`, `runtime/characters/movement.ts:61`; rebound in shared.js:18-32).
- **A new request always ends the old journey,** even when it asks for the same place
  (movement.ts:384, 392). See MOV-001.
- **A bare, `move` or `smart` stop ends the journey for any caller** (movement.ts:411). A stop that
  passes `success` ends it as arrived. A failed `stop('move')` on a Cave `retainOnDirectStop` journey
  only pauses it (403-410). A stop with another action, such as `stop('town')`, reaches only the
  native stop (412). See MOV-005.
- **Combat moves the character with native steps under a live journey** (`sendCombatMove`,
  shared.js:17141-17156). The service then repairs or rejoins the route (MOV-011, MOV-012).
- **Three tick sources drive movers:** the role runner's 100 ms chain (runtime/characters/roles/runner.ts:212-256,
  339), target selection calling follow (runner.ts:152-157), and the combat queue client's 100 ms timer
  plus socket events (runtime/combat/client.ts:121-123, 153-154). See MOV-033, MOV-034.
- **The coordinator moves the party only through commands.** It writes `party.commands[name]`; each
  character reads its command from the status response and acts on it in `shared.js` (section 1.4).
  A convoy is one coordinator slot: each convoy start cancels the active one (nav/convoy.ts:202-203),
  and the Hunt also clears it directly (`cancelHuntConvoy`, runtime/coordinator/hunt/controls.ts:55-61).
- **Ownership is proven by stand-ins:** `smart.on_done` identity, the `owner.recoveryStage` label,
  `movement.gate.owner`, navigation revisions, 27 checks in `isOccupied()` (25 of them can return
  true), and report-to-command identity checks in fifteen functions. The full scan finds 272 stand-in lines on the current console
  (`standins-index.json`, section 1.7).

Writers, from a regex scan of `shared.js`, `runtime/**/*.ts` and `scripts/*.cjs` on the current console
(`node writers.cjs`, 25 false positives removed): 249 call sites in 130 named functions plus 2
top-level lines (shared.js:594, 642). `stop(` 102 (64 `stop('smart')`, 3 of them with `success`;
19 `stop('move')`; 19 bare `stop()`), `smart_move(` 85, `gate.owner=` 12, native `move(` 10,
`movement.cancel(` 9, `host.move` or `native.move` 8, `movement.move(` 7, `xmove(` 5, `transport(` 4,
`movement.install(` 3, `combatHandoff(` 3, `host.stop(` 1 (`host.stop('town')`,
movement-executor.ts:24). The scan does not match `native.stop(`. 232 of the 249 are in shared.js.

### 1.1 Movement service, planning and the mover chain

Ref: `refs/review/ryan-1.5` (b9b5c91e) unless a line says "(fork)" (af92de45) or "(21b8362d)".
`shared.js` means `characters/shared.js` on the current console. Every file in this slice was read in full:
`runtime/characters/movement.ts` (445 lines), `movement-executor.ts` (263), `movement-host.ts` (82),
`movement-correction.ts`, `movement-destination.ts`, `movement-diagnostics.ts`, `movement-error.ts`,
`movement-relocation.ts`, `native-planner.ts`, `return-planner.ts`, `planning-schedule-metrics.ts`,
`runtime/navigation/*.ts` (6 files), `runtime/coordinator/navigation/{alclient-adapter,corner-edges,
geometry-repair,movement-barrier,planner-geometry,planner-service,planner-worker,planner-error}.ts`,
`runtime/coordinator/http/movement.ts`, `runtime/characters/roles/runner.ts` (377) and
`runtime/combat/client.ts` (168). Line counts: `git show refs/review/ryan-1.5:<path> | wc -l`.

##### Journey slot and replacement

- **MOV-001** One journey slot per character; `move()` ends any active journey before it reads the new
  request. Rules: shared.js:18-30 installs the service and shared.js:32 rebinds `smart`,
  `smart_move` (to `bankSortMove`) and `stop` to it. `move()` first refuses to run when the
  scheduler was replaced (movement.ts:383), then calls `finish(false, 'Movement replaced by a new
  destination', {code:'destination-replaced', replacement})` on whatever journey is active
  (movement.ts:384). It resolves the destination and tolerance (default 20, movement.ts:23),
  overwrites the shared state (391), sends a stop move if the character is moving (392), and
  creates a journey with id `<name>:<runtime>:<sequence>` (394). Nothing compares the old and new
  destination or owner. Settings: none.
- **MOV-002** Destination names resolve to points. Rules: an object with map/x/y is used as given
  (movement-destination.ts:4-7); `town` means `main` (16); event maps throw "requires the event
  joining workflow" (18); a map name goes to spawn 0 (19); an NPC name goes to the NPC plus 15 in
  y, or plus 50 for `wbartender` (23); `upgrade`, `compound`, `exchange`, `scrolls` and `potions`
  have fixed points (24-32). A target in another instance of the current map is refused
  (movement.ts:388-389). Settings: none.
- **MOV-003** A journey is current only while the runtime, navigation revision and socket match.
  Rules: `current()` compares `ports.context()` runtime and revision with the values captured at
  start, and requires a live character (movement.ts:65-71). shared.js:20-21 sets revision from
  `navigationIntent.revision`, `current` from runtime generation and socket, and `paused` from the
  console pause, `__partyMovementPaused` or the dungeon client. A stale journey finishes as
  "Navigation revision or runtime superseded this journey" (code `superseded`, movement.ts:245,
  376). A paused context pauses the executor and keeps the journey (377). Settings: console pause.
- **MOV-004** A gate owner takes the scheduler. Rules: `scheduler()` runs `gate.owner.tick()` when an
  owner is set, otherwise the default `tick()` (movement.ts:414-418); the game calls
  `smart_move_logic` on its own timer (cadence set by the game client, not in this repo). A gate
  owner gets no other protection: `move()` and `stop()` still end the journey under it. Settings:
  none.

##### Stopping

- **MOV-005** A bare, `move` or `smart` stop ends any journey. Rules: `stop(action, success)` with no
  action, `move` or `smart` finishes the active journey (movement.ts:411), then calls the native stop
  (412). Without `success` the journey fails as "Unattributed movement stop" with code
  `unattributed-stop`, the action and a `stopStack`; with `success` it ends as arrived with no reason.
  A stop with another action, such as `stop('town')`, only calls the native stop. One exception: a
  failed `stop('move')` on a journey started with `retainOnDirectStop` pauses the executor and sends
  a stop move instead (movement.ts:403-410; option documented as Cave-only, movement-host.ts:51-52, and set only by the
  Cave dungeon runtime, shared.js:2770).
  Settings: none.
- **MOV-006** Named ends. Rules: `cancel(reason, cause)` finishes with that reason and stops the native
  smart walker (movement.ts:435); `combatHandoff()` finishes with "Combat handoff", logged as
  "Travel paused for combat" (436, 97); `dispose()` finishes with "Runtime replaced", clears the gate
  and restores native functions (440). Settings: none.
- **MOV-007** `finish` is the single exit. Rules: it clears the slot, stops the planner, resets the
  executor on success or cancels it on failure (movement.ts:83-84), records `last` with
  `failureContext` that spreads `options.owner` (85-87), reports metrics (88), logs a diagnostic
  for a failure or a fallback success (89) and calls `state.on_done` (90). The log phase comes from
  the cause code (`superseded`, `convoy-communication-hold`, `convoy-failure`, 17-21, 94-95). A
  success logs "Native fallback succeeded" (96) and "Combat handoff" logs "Travel paused for
  combat" (97). Any other end takes its phase from a regex on the reason text: `/cancelled|replaced|superseded|stop|regroup|takeover|hold/` gives
  "Movement cancelled", anything else "Movement failed" (98). Settings: none.

##### Planning

- **MOV-008** ALClient planning through the coordinator. Rules: planning waits until the character is
  not moving or transporting and fails after 5 s unsettled (movement.ts:237-251). A `relocation:
  'town'` journey installs a single Town step (257). Otherwise it POSTs `/movement-plan` with a 2 s
  timeout (205); the coordinator worker also retires a plan after 2 s (planner-service.ts:65). A
  response with a different id, version or fingerprint throws, which fails the journey (213, 230). If the character moved more
  than 1 unit while planning, it replans, and fails after the third drift with "Character moved
  while planning" (214-216, 233-236). A verified ALClient "unreachable" fails the journey only for
  callers that set `rejectUnreachableGoal` (191-193). Every other error the planner reports in its
  response falls back to the native planner (194); the coordinator returns planner failures as a
  normal response (http/movement.ts:21). A request that rejects fails the journey when it is a
  retryable transport failure (227) or when its text does not match
  `/geometry|route|path|walk|segment|collision|blocked/` (228-230); a matching text falls back. A
  shadow-mode reply falls back after it is compared (219-222).
  Settings: `PARTY_MOVEMENT_MODE=native` turns ALClient off (planner-service.ts:9, 57).
- **MOV-009** Native fallback planner. Rules: `fallback()` switches the journey to the game's BFS and
  clears the plot (movement.ts:100-108), except after a `post-relocation` retry, which fails (102).
  The native search runs in 30 s by default, allowed 1 to 120 s (27-32); only a shared Cave journey
  may set the 90 s plus 240 s progress budget (33-38). With that budget a search fails once it stops
  advancing for 15 s past its first deadline, or at 240 s; any other search fails at its deadline
  (native-planner.ts:31-33). `awaitSharedRoute` followers do not search and
  fail after their budget plus 30 s (movement.ts:181-184). On runner versions 15555 and 17665 the
  planner forces `is_hidden` false during each BFS slice and restores it (native-planner.ts:41-75).
  Settings: none.
- **MOV-025** Return journeys race two routes. Rules: only a continuous Hunt return sets
  `compareTown` (shared.js:15258). With it and Town allowed, `planReturnCandidates` asks the
  coordinator for a walking and a Town route in parallel, Town first through spawn 0 when the start
  is more than 55 from it (return-planner.ts:33-58). The service passes `townFirst`
  (movement.ts:204), so a valid route that starts with Town always wins and duration only breaks
  ties (return-planner.ts:69). Town counts 7 s, a transition 1 s, walking distance over speed
  (13-25). Settings: Town disabled for the convoy (`disableTown`, shared.js:15258).

##### Route validation

- **MOV-010** Every route is validated before it walks. Rules: `install()` repairs door approaches for
  ALClient plots, adds a final approach within 20 for precision callers, trims an unchecked final
  point across a thin wall, attaches a walking endpoint, then runs `validateRoute` (movement.ts:109-
  122, 39-45, 171-179). `validateRoute` checks each step with the game's `can_move`, door access and
  keys (`bkey`, `ukey`), transporter range under 75, Town only at spawn 0 of the current map when
  allowed, `leave` only from cyberland or jail to main spawn 0, and arrival within the tolerance
  (validation.ts:8-52). Local repairs are bounded: door detours search an 8-unit grid of 28 cells
  each way with 2048 expansions and only within 160 of a target (door-detour.ts:5, 37, 41);
  endpoint repair stays within 150 (walking-endpoint.ts:5); future-map interior repairs stop after
  3 (walking-interior.ts:33). Settings: Town allowed or not per journey.
- **MOV-030** Geometry identity. Rules: the fingerprint hashes collision lines, spawns, doors,
  transporters, instance and event flags for every map except generated Cave floors
  (contracts.ts:37-52); a cache recomputes it only when one of its inputs changes (63-82). Planner
  results and imported routes must match it (movement.ts:213, 422). Settings: none.

##### Route recovery

- **MOV-011** Segment repair. Rules: an ALClient segment rejected for "collisions detected" on the
  current map gets one 3 s native connector (movement.ts:123-133, 148). Shared Cave journeys with
  `repairSharedDrift` may repair 3 distinct endpoints, never the same one twice (139-143). A failed
  repair falls back to the full native search, or fails a shared journey (165-170). Settings: none.
- **MOV-012** Execution recovery. Rules: on an executor error, a shared journey only tries a local
  rejoin and otherwise fails to the coordinator (movement.ts:261-264). A leave failure replans with
  `avoidLeave`, at most twice (265-271). Any other error gets 2 recoveries: a Town error turns Town
  off (274), the character is stopped in place (275), and the journey falls back to native (276).
  The recoveries share `j.retries` with planning drift replans (235), so a journey that replanned
  twice for drift fails on its first execution error (272).
  Shared Cave rejoin picks the nearest native-clear point on the remaining walking prefix, or a
  local join within 150 (278-334). Settings: none.

##### Arrival

- **MOV-013** Arrival. Rules: an exhausted plot completes only when the character is on the target map
  and instance (movement.ts:360-364), not moving or transporting (367) and within the arrival edge
  (368). A changed map or instance fails the journey (363); a character still moving or
  transporting waits (367); one outside the arrival edge enters recovery (369). An owned terminal transition settles with a receipt when the
  same owner, server, unpaused context and a position within 1 match (338-359). Settings: none.
- **MOV-014** Route import. Rules: `movement.install` (importRoute) validates a coordinator plot against
  the live journey and refuses a geometry mismatch (movement.ts:420-432). Callers on the current console:
  shared.js:2763 (Cave convoy), 15448 (shared convoy) and 16744 (direct combat approach), found by
  `writers-index.json` (3 total). Settings: none.

##### Step execution

- **MOV-015** One step at a time. Rules: the executor drops an issued step that is no longer the plot
  head (movement-executor.ts:199), consumes walking points within 1 unit before sending
  (212-221) and dispatches the next step only when the character can start (254). Walk steps use
  `host.move`, transitions emit `leave`, `town` or `transport` (133-145). Settings: none.
- **MOV-016** Stall and re-send. Rules: walking fails after 5 s without 2 units of progress
  (movement-executor.ts:109, 119); once per step, after 250 ms stopped, the executor re-sends the same
  segment (122-129); a transition fails after 12 s (111-114). Town and door arrivals scattered within
  150 rejoin the exact spawn through a checked connector, re-sent every 1 s (67-95). Settings: none.
- **MOV-017** Cancel and pause. Rules: `cancel()` sends a stop move and a Town stop for an issued Town
  step (movement-executor.ts:21-27); `pause()` stops an issued walking step once and keeps the route,
  with the comment "combat owns movement until travel resumes" (28-36). Settings: none.
- **MOV-018** Transition barriers. Rules: with a barrier option, a transition waits for the coordinator
  barrier, polled at most every 250 ms (movement-executor.ts:37-51), before dispatch and again on
  completion (96-99, 150). The coordinator side is MOV-032. Settings: none.
- **MOV-019** Town warps. Rules: a Town step waits while Town is not ready; with a `townAttempt`
  callback it fails after 5 s with "Town unavailable for 5 seconds; use walking route", without one
  it fails at once (movement-executor.ts:237-243). Settings: Town disabled.
- **MOV-020** Loot before transitions. Rules: a transition waits for nearby chests and fails after
  30 s (movement-executor.ts:222-227), unless `skipLootWait` (148). Settings: continuous Hunt return
  sets `skipLootWait` (shared.js:15257).
- **MOV-021** Server corrections. Rules: an accepted `correction` socket event during an owned walking
  step pauses the executor; the next tick validates the rest (movement-correction.ts:2-4, 14-21,
  movement.ts:72-76). Settings: none.

##### Diagnostics and errors

- **MOV-022** Diagnostic folding. Rules: a message with the same key prints once per 10 s and carries a
  count over 60 s (movement-diagnostics.ts:10-16). The key is the `convoyId` of the report context,
  else the journey id, plus phase, detail, issue and destination (10). Only end-of-journey reports
  pass a context, built from the owner and the cause (movement.ts:86, 89), so repair and fallback
  lines key by journey id. Settings: none.
- **MOV-023** Error classes. Rules: a request is retryable on network, timeout, 408, 429 or 5xx
  (movement-error.ts:8-11); an aborted or 409 superseded barrier is `superseded`; other retryable
  failures are `convoy-communication-hold` (13-20). Settings: none.
- **MOV-024** Relocation hint. Rules: a failure report suggests Town when more than 55 from spawn 0, or
  the nearest ordinary door; never in an instance or event map (movement-relocation.ts:8-54). It is
  a report field only (movement.ts:86). Settings: none.

##### Coordinator planner

- **MOV-026** Planner workers. Rules: one worker per game version and fingerprint, at most 3, 3 saved
  geometries, 10 s preparation, a queue of 32, re-preparation after 5 s (planner-service.ts:16-55);
  a plan times out after 2 s and retires the worker (65). A verified unreachable result returns as a
  normal response with `failure: 'unreachable'` (http/movement.ts:9-21). Settings:
  `PARTY_MOVEMENT_MODE`.
- **MOV-027** ALClient adapter. Rules: prepared maps are main, every map reachable by doors from main,
  transporter places, abtesting, goobrawl and jail (alclient-adapter.ts:18-26). An empty path between
  prepared maps throws `UnreachableGoalError('ALClient found no route')`; otherwise "with unprepared
  map or instance geometry" (40-43). Walking routes use speed 1,000,000 to avoid Town and reject any
  Town edge left (16, 31). `avoidLeave` avoids cyberland and jail and exits through an ordinary door
  (56-67). Transport steps farther than 75 from the transporter get an approach at radius 60 (69-100).
  Settings: none.
- **MOV-028** Corner detours. Rules: a planner edge the game's `can_move` rejects gets the shortest single
  detour point from 392 elbow candidates (338 distinct points) and 36 side candidates (corner-edges.ts:36-43); edges without one stay for the client to repair
  (corner-edges.ts:12-52, issue #147). Settings: none.
- **MOV-029** Planner geometry. Rules: the coordinator runs data.js, old_common_functions.js and
  `process_game_data()` in a sandbox with a 10 s timeout and throws when the result has no processed
  maps or geometry
  (planner-geometry.ts:9-16). Settings: none.
- **MOV-031** Mixed builds. Rules: when convoy members report different geometry, the convoy records a
  repair toward the newest version (geometry-repair.ts:11-28), waits for each affected runtime to
  change, and signals a reload with a 60 s deadline once everyone is held (42-49). Settings: none.
- **MOV-032** Coordinator barrier. Rules: a transition releases only when every unfinished member sent
  "ready" within 3 s while stopped at the same position within 1 (movement-barrier.ts:36, 43-49); a
  Town release on a continuous return also waits for a clear defense state (75-78); completion needs
  every member's arrival or a matching terminal receipt (80-83). A stale owner gets `superseded`,
  before-departure or "fresh observations" (60-66). Settings: none.

##### Mover chain

- **MOV-033** Fixed mover order. Rules: `movementTimer` runs every 100 ms (runner.ts:339). Each tick, in
  this order, the first mover that claims it ends the tick (runner.ts:212-256):
  1. in a dungeon without combat allowed, `resetCombatMovement` (213-214);
  2. `equipmentTick`, which never ends the tick (216);
  3. outside a dungeon: return defense `returnMovementTick` (218-222), Franky attendance
     `frankyMovement` (223, 205-211), `pollRareHunting` (224), then `pollFarmingCombatHandoff` and
     `pollFarmingSpawnRecovery`, which run without ending the tick (225-226);
  4. target refresh and `attacks.wake()` (228-235);
  5. outside a dungeon, `groupedMovement` (236);
  6. outside a dungeon, `recoverFarmApproach`, when there is a target or no target for 750 ms (237);
  7. in a dungeon, `caveRecoveryMove` (238);
  8. no target: `resetCombatMovement` in a dungeon, else `idleMovement` (defensive formation move or
     reset, 196-199) (239-242);
  9. `formationMove` (244);
  10. `kiteIfNeeded`, then `approachCombatTarget` when not kiting (247-251).
  `movementTick` has no `isOccupied()` check; only the support `tick` has one (runner.ts:291). Two more
  movers run outside this chain: `publishSelection` calls `followLeaderIfFar(150)` whenever selection
  publishes no target, unless `exclusiveCombat()` holds (a dungeon, return combat or Franky combat,
  150), the mode is scatter, or grouped combat is on (155): on a 1 s timer (334-337), on every `wake()` (317), and when the
  selected target disappears (228) or is invalidated (309-316). Settings:
  farming mode (scatter skips follow), grouped combat (skips follow).
- **MOV-034** Extra tick sources. Rules: while it is enabled (a convoy, grouped combat, a passing
  encounter or queue members, client.ts:23, 121), the combat queue client ticks the independent
  approach client, and the formation recovery client when the approach has no report, every 100 ms
  (client.ts:122-123, 154) and on every native `player` and
  `entities` socket event (149-153); each coordinator response calls `partyRoleRunner.wake()` (99),
  which runs target selection and so `followLeaderIfFar`. Sight recovery sends its steps through
  `shared.queueRecoveryMove` (31). Settings: none.

#### The journey lifecycle, step by step

1. **Start.** A caller runs `smart_move(dest, cb, options)` (through `bankSortMove`) or
   `movement.move`. `move()` ends the active journey (movement.ts:384), resolves the target, writes
   `state` (391), stops the character if it is moving (392), creates the journey (394) and returns a
   promise that `state.on_done` settles (395).
2. **Plan.** Each scheduler call runs the gate owner tick or `tick()` (414-418). While `state.found`
   is false, `planTick` waits for the character to stop (5 s limit, 247-251) and runs one of: Town
   relocation, segment repair (3 s), native BFS (30 s default), or the ALClient request (2 s)
   (256-259).
3. **Install.** A plot is repaired, validated and copied into `state.plot` (109-122). A coordinator
   route arrives through `movement.install` (420-432).
4. **Walk.** `executor.tick` issues one step at a time (movement-executor.ts:197-211), with barriers,
   Town readiness, loot waits, 5 s stall detection, one re-send after 250 ms, and a 12 s transition limit.
5. **Recover.** Executor errors go to `recover` (movement.ts:260-277): 2 retries for unshared
   journeys, local rejoin only for shared journeys.
6. **End.** Exactly one of: arrival (`completeOwnedRoute` 360-372, or `settleTerminal` 351-359);
   replacement by `move()` (384); any `stop()` (411); `cancel()` (435); `combatHandoff()` (436);
   staleness (245, 376); a failure inside planning, recovery or completion (363); `dispose()` (440).

What a new request does to a live journey: always ends it, whoever owns it, even when the new
destination equals the old one. What a stop does: a bare, `move` or `smart` stop ends it,
except the Cave `retainOnDirectStop` case; a stop that passes `success` ends it as arrived; a stop
with another action leaves it. What a gate owner does: replaces the tick only. What `cancel` adds over
`stop`: a named reason and cause code. What `combatHandoff` adds: a log phase that is not a
failure.

##### Every numeric budget and timeout in this slice

| Value | Meaning | file:line |
|---|---|---|
| 20 | default arrival tolerance; final approach range | movement.ts:23, 44 |
| 30 s (1 to 120 s) | native planning timeout | movement.ts:28-31 |
| 90 s + 240 s | Cave progress planning budget | movement.ts:35 |
| +30 s | shared follower wait past its budget | movement.ts:182 |
| 15 s | native BFS stall past the first deadline | native-planner.ts:32 |
| 2 s | ALClient request timeout, client and worker | movement.ts:205; planner-service.ts:65 |
| 1 unit, 2 drifts | planning origin drift limit and replan count | movement.ts:214, 235 |
| 5 s | settle before planning | movement.ts:249 |
| 3 s | segment repair connector | movement.ts:148 |
| 1 / 3 | repair count; 3 distinct endpoints for shared Cave drift | movement.ts:140-142 |
| 2 | execution recoveries; leave replans | movement.ts:266, 272 |
| 150 | rejoin and local join limit | movement.ts:312, 328, 333 |
| 5 s / 2 units | walking stall | movement-executor.ts:109, 119 |
| 250 ms, once | stopped-walk re-send | movement-executor.ts:123-125 |
| 12 s | transition limit | movement-executor.ts:111 |
| 1 s, 150 | arrival connector re-send and range | movement-executor.ts:68, 72 |
| 250 ms | barrier poll interval | movement-executor.ts:41 |
| 5 s | Town unavailable before walking fallback | movement-executor.ts:240 |
| 30 s | loot wait before a transition | movement-executor.ts:225 |
| 10 s / 60 s | diagnostic fold and count windows | movement-diagnostics.ts:12-13 |
| 55 | Town relocation and Town-first return threshold | movement-relocation.ts:16; return-planner.ts:38 |
| 7 s / 1 s | Town and transition cost in route duration | return-planner.ts:18-20 |
| 3, 3, 32, 10 s, 5 s | workers, saved geometries, queue, preparation, re-preparation | planner-service.ts:46, 20, 62, 25, 53 |
| 75 / 60 / 70 | transporter range, approach ring, arrival node | alclient-adapter.ts:75, 87, 95; validation.ts:19 |
| 3 s / 1 unit | barrier readiness window and position match | movement-barrier.ts:44, 48 |
| 60 s | geometry reload deadline | geometry-repair.ts:48 |
| 100 ms | role runner movement tick; queue client tick | runner.ts:339; client.ts:154 |
| 750 ms | no-target wait before farm approach | runner.ts:237 |
| 1 s | target selection timer, which also runs follow | runner.ts:334-337 |
| 8, 28, 2048, 160 | door detour grid step, cells each way, expansions, reach to a target | door-detour.ts:5, 37 |
| 150 | walking endpoint repair radius | walking-endpoint.ts:5 |
| 3 | future-map interior repairs per route | walking-interior.ts:33 |
| 10000 | most steps in a validated route | validation.ts:38 |
| 32, 64 | corner detour elbow and side offset limits | corner-edges.ts:36, 42 |
| 10 s | coordinator geometry sandbox timeout | planner-geometry.ts:15 |
| 3 s | geometry repair status freshness | geometry-repair.ts:40 |

### 1.2 Character movers in shared.js

All line numbers are `characters/shared.js` on `refs/review/ryan-1.5` (read with
`git show refs/review/ryan-1.5:characters/shared.js`) unless marked (fork). Movement
service lines are `runtime/characters/movement.ts` on the same ref.

Two facts from the movement service that every entry below depends on:
- `stop()` with no action, `"move"` or `"smart"` ends whatever journey is active as
  "Unattributed movement stop" (movement.ts:411). A stop that passes `success` ends it
  without that label. A journey started with `retainOnDirectStop` (the Cave) survives only a
  failed `stop("move")`: the executor pauses and a stop move is sent (movement.ts:403-410).
- `smart_move` is `bankSortMove`, which calls `move()` (movement.ts:382-396). `move()` ends
  the active journey as "Movement replaced by a new destination" before it reads the new
  request (movement.ts:384), and sends a native stop move if the character is moving
  (movement.ts:392).

##### Movement service wiring
- **MOV-040** The character installs the movement service and rebinds the game names.
  Rules: `installPartyMovement` gets a context with server, runtime id, navigation
  revision, a "current" flag and a "paused" flag (shared.js:18-21). Paused is true during
  console draining while no drain combat or maintenance work runs (`consoleMovementPaused`,
  2434-2439; never for a non-merchant off Main in Load in Main mode, 2437), when
  `root.__partyMovementPaused`
  is set, or when the Cave runtime says the party may not move (21). Town casts wait for
  `townReady`: no departure combat and no departure chest left (23). Map transitions wait
  for `transitionReady`: no departure chest left (24). `smart_move` is the bank-sort
  wrapper and `stop` is the service's stop (32). For a merchant leaving a bank floor
  during a bank-sort visit, `bankSortMove` awaits bank stack and buffer cleanup before it
  calls `movement.move`; it throws "Bank sort buffer cleanup pending; staying in bank"
  while a buffer slot is occupied (4305-4327). Settings: console maintenance lease (Pause,
  Load in Main), bank sort settings.

##### Escape movement
- **MOV-035** Escape takes movement. Rules: a new escape id, or a stage change into
  `recovering`, `complete` or `failed-hold`, cancels the convoy (and its cruise cap), the
  farm travel token and the reunion, clears follow and force travel, bumps the Town
  generation, then calls `stop("smart")` and `stop("move")` (138-158). Clearing the escape
  also stops both (143). `escapeOwns` is true for any non-merchant while an escape state
  exists (34). The status tick applies the escape after the convoy flags (11198-11204).
  Settings: none (the dashboard Escape button starts it).
- **MOV-036** Escape pulse every 100 ms (325). Rules: in the `blink` stage the mage Blinks to
  the landing with the lowest risk score, where risk sums `max(0, range + 120 - distance)`
  over visible monsters (range 80 when missing), Town spawn wins ties, then distance
  (160-188, 253-257). A rejected
  landing point is not tried again (179, 257). In role stages the mage Magiports the named
  role once that member reports `readyForPort`, at most every 3 s (259-266). `escapePulse`
  moves nothing in the `complete`, `failed-hold` and `recovery-convoy` stages (208). The
  separate survival pulse (189-201, spec 05) still runs warrior defense in those stages and
  in `recovering`, and its Dash moves a warrior that is already moving (190, 197-198,
  134-137). Settings: none.
- **MOV-037** Rescue wait step. Rules: a non-mage that is not moving and not within 65 of
  its escape destination (244-246) steps 40 units in the cardinal direction that is
  farthest from the nearest visible monster, checked only with `can_move_to` (277-285).
  The warrior tries its mobility skills first (285). The code sits inside `escapePulse`,
  which MOV-036 claims. Settings: none.
- **MOV-038** Warrior escape mobility. Rules: Hardshell when hit, with a 500 ms retry gap
  (108-121); after the shield ends, Stomp if a basher is equipped and a monster is in
  range (93-107); then Charge once per shield cycle (76-84, reset at 97) and Dash toward
  the step point. The step point is the rescue step (285) or, for a moving warrior, 40
  units ahead in its facing direction (`escapeForwardPoint`, 134-137). An unattacked
  warrior Dashes only if one Hardshell plus two Dashes of MP remain after it; an attacked
  warrior Dashes regardless (126-131). Dash and Charge never run while shielded (122-125).
  Settings: none.
- **MOV-039** Recovery walk to Main. Rules: in `recovering`, a dead member respawns at most
  once per second (211-216); a survivor already within 65 of Main (0,0) moves nothing
  (218); a mage Blinks once to a landing (220-228); off Main the character leaves Goobrawl
  through its exit routine or calls `eventReturnRouteToMain` with a 180 s deadline
  (229-235). `eventReturnRouteToMain` makes up to four `smart_move` legs (11748). A replaced
  `on_done` throws "Exit route superseded" and ends the whole route (11756). A leg with less
  than 10 units of progress in 15 s ends and the next leg starts (11760). Each leg's
  `finally` stops smart and move only while its `on_done` is still installed
  (11764-11767), and four legs that leave the character off Main throw "Exit to Main
  stalled or exhausted" (11771). A failed route marks the recovery failed, and the pulse
  then moves nothing (233, 210). On Main the walk to (0,0) has a 20 s timeout (236-239).
  Settings: none.

##### Cave movement
- **MOV-041** Cave journeys. Rules: every Cave move is a native-planner journey with
  `retainOnDirectStop: true` and `town: false` (2770). Arrival tolerance is 1 for `gather`
  and 20 otherwise (2770). Native planning gets 90 s for convoys and gathers, 30 s
  otherwise, and 240 s of planning progress for convoys (2771-2772). Convoy followers wait
  for the leader's plot (`awaitSharedRoute`) and import it through `movement.install`
  (2761-2765). A convoy journey takes `movement.gate.owner` with a gate that only plans
  while the character is stopped and not transporting (2779-2786). The barrier inside a
  Cave asks `dungeonClient.canMove()`; outside it loots and waits for no departure
  combat (2774-2777). Changing the dungeon command cancels the convoy, farm travel token,
  reunion and follow, then `movement.cancel('Dungeon command changed')` (2791-2808).
  Settings: Cave settings in the coordinator (owned by 07).
- **MOV-042** Gravestone approach. Rules: the priest steps toward a point at the lower of
  its own range and the revive range (240 when the skill has none), minus 10, one quarter
  second of speed per step, only
  when `safeCombatPoint` accepts the point, through `sendCombatMove` (2681-2689).
  Settings: none.

##### Convoy client lease
- **MOV-043** Convoy heartbeat. Rules: each status sample carries position, movement report,
  geometry identity and the convoy report (3139-3150, 2815-2834). A fast response renews
  the convoy signal only when it matches the local convoy id, epoch, command id, runtime
  id, route version and navigation revision (3179-3182). The lease deadline charges all
  network time against `validUntil` (3184-3186), and a reply sent before the last accepted
  signal is ignored (3178). A full status that says "no convoy" keeps the convoy only when
  it is older than the last fast signal and that signal is unexpired and matches the convoy
  (3151-3162). Settings: none.

##### Travel and combat
- **MOV-044** Passing attacks while walking. Rules: a moving non-merchant attacks an in-range
  monster whose passive rule has `keepMoving` and whose level is within the rule's cap,
  without stopping its route (3496-3519). Travel during a Town cast or map transition
  never allows it (3374). Protocol 4 or Hunt convoys, and any travel while Hunt loot is
  pending, allow it only while the convoy signal is live and matches (3376-3385). Settings: passive hunting rules (keepMoving,
  maxLevel).
- **MOV-045** Which travel may stop. Rules: a convoy may stop for a passive "stop" monster
  only if it is not forced, exempt, non-preemptible or a continuous return, and its
  purpose is not one of `escape-recovery, franky-exit, event-return, rare-hunt,
  phoenix-patrol, shared-walk-return`, and it is not a Hunt convoy without a Hunt target
  (3390-3395). Outbound Hunt travel with more than
  one attacker identity, or any passive stop monster attacking, counts as extra aggro and
  pauses the convoy (3414-3424, 3466-3467). A held convoy defends the party member that is
  attacked, preferring its own attacker (3425-3433). Settings: passive hunting rules.
- **MOV-046** Convoy defense pause. Rules: `interruptConvoyForDefense` (14089-14126) refuses
  for held or communication-hold convoys, a changed or cancelled navigation revision,
  exempt convoys other than `anniversary-return` and the five protected purposes (14094),
  continuous returns and return walks (14096), and a local call on outbound Hunt travel
  without extra aggro (14097). For protocol 4 or non-preemptible Hunt
  convoys it records the attackers, freezes and detaches the route, interrupts a Town
  cast, marks the convoy `defending` and calls `stop()` (14099-14118). Other convoys are
  cancelled outright and stopped (14120-14123). A coordinator `defending` command can
  create the local convoy first ("cold" defense, 14062-14088). Settings: none.
- **MOV-047** Finish combat before travel. Rules: travel, bank, upgrade and similar commands
  run through `afterCombat`, which sets `departurePending` and waits in 250 ms steps. While
  travel combat is active (a local travel command or a current `__partyTravelCombat`
  control, 14164-14167) it waits until no party attacker remains, otherwise until no
  engaged monster remains. A cancelled farm travel token ends the wait (14839-14857).
  Settings: none.
- **MOV-048** Travel hands off to combat on sight. Rules: a farm convoy with
  `combatHandoffAllowed` picks the highest-priority focus monster inside the farm area
  and inside the search radius (14975-15005). A Hunt convoy picks the nearest Hunt
  monster that is in range or has a reachable approach point (15029-15058). Rare and
  Phoenix convoys never hand off (14979). Settings: monster focus, search radius,
  priorities, farming mode.

##### Rare paths
- **MOV-049** Rare path cancel. Rules: `cancelRarePath` stops smart movement only when the
  rare path's captured `on_done` is still installed (3643-3648). The rare path itself
  starts in `pollRareHunting` (3689-3698, proposed to 07). Settings: rare hunt toggles.

##### Navigation revision
- **MOV-050** A navigation revision or cancel change stops owned movement. Rules: when the
  revision or the cancelled flag changes, `applyNavigationIntent` cancels the farm travel
  token and the convoy, clears follow and force travel, and calls `stop("smart")` and
  `stop("move")` only if one of those four owned movement (10278-10299). Every journey
  also records the revision in its context and stops counting as current when it changes
  (movement.ts:65-70, shared.js:20). Settings: monster selection, Find monster, manual
  waypoints (they bump the revision).

##### Town
- **MOV-051** Town hard override. Rules: while `partyTownActive` is set for a non-merchant,
  the status tick starts a 100 ms guard and one override pass (11256-11261). Each guard
  pass stops a moving smart route and a native move unless the Town command is already
  running (`townTraveling`), a Town cycle id is retained or an override pass is in flight
  (11078-11101). `enforcePartyTownOverride` cancels the convoy, stops smart, move and all,
  respawns if dead, and casts Town at most every 4 s until the character is within 90 of
  Main (0,0) (11032-11075). The `town-party` command itself stops all three, walks off
  other maps through the shared party walk, and casts Town every 4 s on Main until within
  90 (10692-10753). Settings: dashboard Town button.
- **MOV-052** Return exit. Rules: before a Town or event return walk, a character off Main
  posts `exiting-map` progress and casts a local Town to the map spawn once, unless it is
  already within 90 of the spawn (11005-11023). Saved progress survives reloads
  (10998-11003). Settings: none.

##### Event walking
- **MOV-053** Event walk ports. Rules: October interactions walk through `sharedPartyWalk`
  with the event name (475). Event travel walks only while the event is live, selected,
  the navigation revision is unchanged and no event exit owns movement
  (13391-13398, 13416-13417). An event exit owns movement while a return is pending, an
  event-return shared walk runs, or a recovery cycle id is set (13451-13455). A follower
  inside the active event map never follows its leader out (12852-12856, 17753). Settings:
  event selections.
- **MOV-054** Event travel permission and anniversary preemption. Rules: every fighter's
  event move asks the coordinator (`/hunt-event-permission`) and is denied in a Cave,
  during Hunt turn-in priority, under a non-preemptible convoy, or when the coordinator is
  unreachable (11913-11926). A merchant outside a Cave only checks that its runtime is
  current (11915). An allowed anniversary preemption cancels the convoy, clears
  follow and stops smart and move, rechecking permission between the two stops
  (11928-11950). Settings: anniversary selection.
- **MOV-055** Anniversary approach. Rules: `smart_move` or `xmove` to the kiss point; it
  arrives within 20 of the point or 70 of the featured entity; it fails after 60 s or the
  event end, or after 10 s with less than 2 units of progress (11774-11800). Its cleanup
  stops smart and move only while its own operation is current and no convoy, Town or
  force travel owns movement (11796-11798). Settings: anniversary selection.

##### Farm reunion
- **MOV-056** Reunion start, cancel and blockers. Rules: `beginFarmReunion` creates a token,
  cancels the farm travel token, clears follow and kite target, and stops smart
  (13492-13512). Without a command it does nothing while a convoy or shared walk is
  active (13503). `reunionBlocked` returns true for Cave, event exit, escape, any party
  attacker, Hunt turn-in, an active rare, death, merchant, cancelled navigation, Town
  (two flags), convoy (two flags), anniversary (two flags), event travel or a live combat
  event, banking or a queued bank visit, stocking, upgrading or force travel: 22 checks
  (13456-13472). Survivors count when they are fresh within 10 s, on the realm and within
  800 of the saved farm point (13473-13485). Settings: desired party members.
- **MOV-057** Reunion travel tick every 500 ms. Rules: a blocked reunion stops its own smart
  route and waits (13608-13612). Arrival is within 150 of the survivor (55 for an
  individual return) and `can_move_to` that point (13648-13662). A survivor more than 300
  away triggers one Magiport request (13667-13675). A mage Blinks to a map entrance or
  to the survivor when it keeps 30% MP (13681-13705). With no survivor, a leader, grouped
  mode and a reunion that is not an individual return, the walk is a `sharedPartyWalk`
  with `farm-recovery`; otherwise a `smart_move` with a 90 s timeout (13707-13709). A failure waits 10 s (13712). The `finally` stops
  smart whenever the reunion is still current and unblocked (13716). Settings: none.
- **MOV-058** Magiport reunion handshake. Rules: request, offer, ready and cast messages
  through `send_cm`, each checked against the reunion id, realm and both navigation
  revisions (13531-13558). The mage casts only with 10% MP left after the cost
  (13529). The recipient stops smart movement, then accepts (13574-13581). Escape uses the
  same handler for its rescue ports (13564-13572). Settings: none.

##### Grouped movement
- **MOV-059** Regroup to the healing anchor. Rules: inside the inner radius (`range - 10`,
  at least 10) a moving character gets `stop("move")` (14630-14634). Outside it, while it
  made progress in the last 3 s, it sends a native `move` toward a cached waypoint of up
  to 0.6 x speed, trying seven headings, each accepted by `can_move_to` and
  `safeCombatPoint` (14643-14659). After 3 s without 8 units of progress it starts a
  `smart_move` to the anchor, up to three attempts with 5, 15 and 30 s waits, then holds
  new pulls (14661-14677). A route is abandoned when its `on_done` is replaced or after
  30 s (14638-14641). Settings: none.
- **MOV-060** Group approach convoy. Rules: the leader, when covered and not already waiting,
  posts `/grouped-approach` with the destination, at most every 3 s (14484-14499). The
  coordinator accepts it only from the leader of a ready group whose key, selection and
  navigation revision match, with no active convoy and no Hunt owning travel
  (http/convoy-engagement.ts:92-106). The destination must be inside the farm area plus
  150, or the leader's search radius (400 by default) (107-122), and no member may be
  fighting (123-134). It then starts a `grouped-approach` convoy (145). Settings: none.
- **MOV-061** Lost-sight fight movement. Rules: a fight in another instance holds and waits
  for the coordinator (14518-14521). A visible target uses the ordinary approach (14522).
  An unseen target uses the formation when fresh allies exist, otherwise local sight
  recovery (14526-14532). Settings: none.
- **MOV-062** Encounter catch-up. Rules: during a travel defense, a member on a different map
  `smart_move`s to the defended monster; the walk fails after 30 s or on an instance
  target (14540-14564). Settings: none.
- **MOV-063** Approach report. Rules: each fighter reports target identity, displacement
  since the last report, approach or hold intent, coverage deficit and blocker
  (14400-14418). Settings: none.

##### Follow
- **MOV-064** Follow the leader. Rules: a follower in non-scatter mode with `followLeader`
  set, more than 150 from the leader location (or on another map), and not moving, joins
  the leader's event destination and `smart_move`s there (17748-17785). Follow never runs
  during a farm approach, Town, a convoy, departure, bank queue or a kite (17749-17755).
  In protocol 4 grouped farming, follow means "not the target leader" (17707). Turning the
  setting off stops the follow route (11299-11305). Settings: Follow leader.

##### Combat steps
- **MOV-065** Warrior Dash toward a target. Rules: the warrior Dashes 40 units in the
  cardinal direction of the target only at 50% MP or more, when the endpoint stays outside
  desired range and `safeCombatPoint` accepts it (13954-13975). It never Dashes during
  Franky combat or in grouped farming with a priest (13955-13956). Settings: none.

### 1.3 Convoy client, farm approach, formation and combat steps

Scope: `characters/shared.js` 15079-17660 and the movement files in `runtime/combat/`
on `refs/review/ryan-1.5` (b9b5c91e). Every `file:line` is on that ref unless marked
(fork) = `HEAD` af92de45, or (df) = `21b8362d` in pm-worktrees/pta-pull. `shared.js`
means `characters/shared.js`. Read in full: shared.js 15079-17660; formation-recovery-client.ts,
formation-recovery.ts, formation-recovery-progress.ts, independent-approach-client.ts,
independent-approach.ts, recovery-route.ts, sight-recovery.ts, interception.ts, hunt-travel.ts,
passive-travel.ts, passing.ts, passing-admission.ts, pursuit.ts, locked-pair.ts.

##### Shared party walks

- **MOV-066** Event and return walks run through the coordinator. Rules: a non-leader that
  does not follow the leader walks alone with `smart_move` (shared.js:15080-15081). For the
  event keys `slenderman`, `trickortreat` and `witchcipher` that lone walk watches the
  caller's `current()` every 100 ms and fails as "Event destination superseded" when it turns
  false (15085-15088). However the lone walk ends, it then stops `smart` while the runtime and
  revision still match and no event exit, event return or escape owns movement (15089-15095). Everyone else posts
  `/shared-travel` every 500 ms with the navigation revision and a token until the coordinator
  answers `complete` or `failed` (15098-15124). An event walk yields as soon as combat can reach
  the boss (15114). The walk gives up after 180 s (15103, 15116) or three failed requests in a
  row (15119), and posts a cancel when it ends without `complete` (15128). Settings: none.

##### Convoy travel on the character

- **MOV-067** Convoy plumbing. Rules: a coordinator lease (`convoySignal`) is expired when its
  local deadline or `validUntil` has passed (15131-15135). Distance across maps or instances
  is Infinity (15243-15246). Network, timeout, 408, 429 and 5xx errors count as retryable
  (15139-15143); a retryable error puts the convoy in a communication hold and sets the status
  text (15144-15150). Retry sleeps run in 100 ms slices and stop when ownership ends
  (15151-15158). `sharedConvoyGate` returns the one movement gate (15305). Settings: none.
- **MOV-068** Arrival acknowledgement. Rules: the arrived member posts `/convoy-complete`,
  repeats every 250 ms while the coordinator says `waiting`, and backs off 1, 2, 5, 10 s with
  20 percent jitter on retryable errors (15159-15183). A reply matching `/stale convoy
  completion/` parks the convoy until release (15172-15175). Settings: none.
- **MOV-069** Failure evidence. Rules: on the first failure the convoy captures phase, position,
  destination, signal state (missing, identity mismatch, expired, matching), lease overrun, last
  status response age and transport state (15184-15205), and logs them in two lines
  (15206-15220). `convoyMovementEvidence` attaches the movement report whose owner command id
  matches (15700-15705). Settings: none.
- **MOV-070** Geometry repair. Rules: a held convoy whose signal carries a `geometryReload` for this
  runtime reloads the runtime once per repair id; an old browser build reloads the whole page
  (15221-15242). Settings: none.
- **MOV-071** Convoy journey options. Rules: every convoy journey carries an owner record (convoy
  id, epoch, command id, navigation revision, route version, recovery stage) (15252). Town is
  allowed unless `disableTown`, for continuous returns, Town relocation, non-Hunt purposes, or
  a Town-allowed return plan (15259). Each plot step asks `/movement-barrier` with the
  convoy identity and a `ready` flag that needs no pending departure combat or chests and a usable
  Town skill for Town steps (15283-15284). The barrier retries retryable errors with 250 ms
  doubling up to 1 s, for 10 s in total, and treats 409 `before-departure` as "poll again"
  (15280-15301). Settings: per-command `disableTown`, `avoidLeave`, `nativeFallback`,
  `slowestSpeed`.
- **MOV-072** Rendezvous. Rules: a Hunt convoy first offers combat handoff (15321-15325). The
  leader must stand within 1 unit of the planning origin or the convoy fails with "Leader moved
  from planning origin" (15327-15328). A follower more than 12 units away walks there with
  `xmove` when the rally is in straight sight, or with `smart_move` under the gate owner
  (15329-15332, 15306-15318), both capped at 120 s. Everyone then waits, at most 120 s, until it
  stands still at cruise speed (15334-15338), and a follower more than 55 units off fails with
  "Follower cannot connect to leader origin" (15340-15341). Settings: none.
- **MOV-073** Route reuse. Rules: the leader reuses the saved remainder of the same convoy,
  revision, destination, runtime, map, server and geometry when its first point is walkable and
  Town and leave rules still fit (15343-15359), or a Hunt return itinerary segment that starts
  within 55 units (15360-15371). Settings: none.
- **MOV-074** Travel-to-combat handoff. Rules: empty-spawn recovery hands off on sight (15375-15376);
  ordinary farm travel purposes hand off only when this character can attack now (`is_in_range`,
  15379-15380);
  every other purpose uses `eventCombatReachable` (15381). A `monster-hunt` convoy, a convoy with `combatHandoffAllowed` false, and a grouped follower
  without a Hunt target never hand off this way (15384-15385). On an accepted `/convoy-engage` the convoy releases cruise, detaches its gate
  owner, calls `movement.combatHandoff`, stops `smart`, clears `convoyTraveling` and publishes
  the target (15388-15403, 15596-15621). A request that throws waits 1 s before the next try (15405, 15623); a reply without `ok` sets
  no wait (15393, 15605).
  Settings: none.
- **MOV-075** Shared prepared route. Rules: after rendezvous the leader plans through
  `movement.planTick` under the gate owner (15481-15491), which asks the coordinator's ALClient
  planner unless the journey is native (movement.ts:242-258), and publishes the plot to `/convoy-route`
  (15456-15464); followers fetch and install it, adding the origin point when more than 1 unit
  away (15438-15455, 15465-15480). The route must keep its version, a rally within 1 unit and
  its map (15440-15441). While waiting, the gate owner fails the convoy when the lease is stale
  after a 3 s grace (15515-15524), the coordinator asks for a hold (15525), `smart.on_done` or
  `smart.plot` changed (15527), the character moved more than 1 unit or its speed changed
  (15529-15530), installation passed 60 s (15531) or the plot changed (15532). Departure
  happens at the coordinator's `departAt`, with a 1500 ms late tolerance (15535-15548).
  Leaving Mainland on a `franky-exit` stops the route at once (15493-15495). Settings: none.
- **MOV-076** Legacy prepared route. Rules: each member plans its own route to the farm entry point
  under the gate owner (15563-15698), fails on drift over 1 unit, speed change, lost
  `on_done`/plot identity, stale lease or a 30 s / 60 s planning timeout (15633-15649), and
  departs on schedule with the same 1500 ms tolerance (15674-15686). `plan-return` keeps the
  found plot and stops (15660-15664). Settings: none.
- **MOV-077** Hunt return planning. Rules: plans a walking-only route and, unless Town is disabled, a
  Town-allowed route (15725-15745); scores Town 7000, transports and leaves 1000, walking by
  distance over speed (15731-15736); picks the cheaper and splits it into walk and Town legs plus
  saved segments for reuse (15748-15772). Settings: `disableTown`.
- **MOV-078** Cruise cap. Rules: a convoy sets `cruise(slowestSpeed)` once per convoy and speed
  (15707-15713) and restores `cruise(500)` once when it ends, only if it still owns the cap
  (15714-15721). Settings: none.
- **MOV-079** Convoy command runner. Rules: `createLocalConvoy` makes the convoy the one
  `convoyTraveling`, sets `partyLocation` for most purposes and clears `followingLeader`
  (15775-15792). `coordinatedMonsterTravel` owns the convoy while the runtime, revision and
  convoy identity hold (15795-15798); it cancels any journey ("Convoy taking movement
  ownership", 15847), waits up to 10 s for a physical stop (15815-15832, 15851), then runs the
  command phase: `hold` and `shared-hold` park (15858-15875), `plan-return` plans (15876-15883),
  `assemble` walks to the rally when more than 12 units away and sets cruise (15884-15903),
  `town` casts Town within 5 s and checks arrival within 150 of the spawn in 12 s
  (15904-15931), `prepare`/`shared-prepare` runs MOV-075 or MOV-076 (15932-15937). Arrival posts
  completion (15946-15951). Failure cancels the journey, sends a stop and posts `/convoy-failed`
  with diagnostics (15969-15988). A barrier `aborted` or 409 `superseded` ends quietly
  (15954-15959). Settings: none.
- **MOV-080** Convoy state queries: `isConvoyTraveling` (17529) and `convoyActive` (17608) report
  the local or coordinator convoy to the role runner and queue client. Settings: none.

##### Farm approach recovery

- **MOV-081** Farm zone search and blocked-target routing. Rules: eleven checks take precedence
  (16059-16089): anniversary staging, party defense, event exit, rare encounter, unfinished
  fight, planned group target, merchant, convoy, `isOccupied`, events and cancelled navigation.
  Nine of them cancel the live recovery route; the planned group target (16079-16082) and the
  merchant check (16083) return without cancelling it. After a failed zone travel
  (`farmTravelPaused`) it holds until the target is in range or something attacks (16112-16115). Inside the farm area with no target it waits for respawns
  (16091-16096). A live route ends when another journey replaced it, the revision changed, the
  target became attackable, something attacks the character, it arrived within 15, or 30 s
  passed (which bans the target for 10 s) (16097-16108). With a target, recovery starts only
  after 1.5 s without 8 units of progress, no attacker and no attack in 3 s (16119-16129), tries
  a formation corner detour first (16131-16135), then a straight native move when the line is
  clear and `safeCombatPoint` allows (16154-16159), then 3 s of 30-90 degree local detours
  (16169-16185), then `smart_move` (16186-16196). With no target it walks the zone's search
  points in order and waits 10 s when they run out (16139-16152). Settings: the selected farm
  area (`partyLocation`).

##### Priest formation movement

- **MOV-082** Formation geometry. Rules: members are party fighters on the same map and instance,
  live or seen within 3 s on this realm (16205-16220); bodies carry hitbox width and height
  (16222-16228); a melee class is warrior, paladin or rogue with range under 100 (16202-16204).
  Settings: none.
- **MOV-083** Monster clearance. Rules: the selected target keeps `min(range, max(6, own range -
  24)) + 8` (16243); a monster whose range exceeds ours and that does not target this character, idle
  monsters included, keeps 38 (16246); any other monster keeps its attack range plus 8, default range 20 (16241, 16247).
  `priestSecondaryClearance` sweeps both bodies over 0.6 s and sums how far each monster's
  clearance is broken (16250-16291); a segment is safe when no sub-step raises that sum
  (16292-16305). `formationStepSafe` adds `safeCombatPoint` and healing coverage to the risk
  check (16652-16664), and `formationRecoverySafePoint` uses it, or `safeCombatPoint` plus the
  segment check when no priest is present (16628-16640). Settings: none.
- **MOV-084** Corner recovery. Rules: when the goal is out of straight sight, or the approach makes no 8-unit
  progress for 1.5 s (16339-16343), the character searches two-leg detours on rings of 80-640 units, keeps the chosen side while it
  stays safe, and asks the queue client's multi-goal route when no two-leg detour exists
  (16308-16426). A mage more than 90 percent of heal range from the priest regroups into
  healing coverage instead (16311-16332). It returns a step, `false`, or `{blocked}` with
  "monster-blocked" or "terrain-blocked" (16427-16440). Settings: none.
- **MOV-085** Formation solver. Rules: the solver runs for grouped farming, Cave, or a mage escort
  (mage with a leader, not in scatter, not `eventTraveling`) (16781-16782); it needs a living
  priest with a heal range (16788-16795). Safe range is heal range minus 8 to 20 (16796).
  Independent approach and the formation recovery client run first (16756, 16758); Franky
  combat skips the solver (16757). A blocked corner holds with "no safe local detour; waiting
  for an opening" unless chased (16921-16926). A settled member holds (16949-16962). Otherwise
  it scores up to 68 candidate steps (2 arc points, 64 ring points, the exact range point, one mage point; 16963-16994) by danger, coverage, facing, range error, clearance and
  turn, takes the best collision-safe one and sends it with `sendCombatMove` (16963-17093).
  `holdFormation` yields to an independent approach and stops only the combat step it sent
  (16665-16675). Settings: farming mode (`scatter` excluded), leader, follow-leader.

##### Coordinator-led terrain recovery

- **MOV-086** Recovery goals. Rules: terrain recovery is allowed only for a planned grouped target on
  this map and realm with fresh group data, outside Cave, convoys, travel combat, events,
  occupancy, combat recovery, an unfinished fight, travel attackers and pending loot (16442-16451). Goals sit on 16 directions at
  `min(range - 1, max(desired, monster safety + 12))` from the target's hitbox and must be
  walkable and clear of every visible monster's safety radius (16469-16506). The priest proposes
  them when the party is stalled 1.5 s and the melee needs range (16822-16824), on a terrain-blocked approach that needs separation (16911-16918), or on a
  blocked corner (16925). Settings: none.
- **MOV-087** Recovery followers. Rules: a non-mover holds when within 40 units of the mover and
  inside coverage (16574), otherwise follows the follower route point in 0.25-speed steps that
  keep healing coverage, except a peaceful priest or a follower of a priest may detour round a
  wall (16575-16598). Settings: none.
- **MOV-088** Recovery ports bridge the client to `smart_move` with Town off (16611), the gate
  (16603), safety checks (16604-16606), stop (16612), hold (16613) and status (16614-16616).
- **MOV-089** Coordinator recovery state machine. Rules: a recovery starts only when every member is
  fresh, alive, on the target's map, not in an event, travel or loot, and peaceful
  (formation-recovery.ts:35-38, 98-99). The mover is the first member with fresh proposed goals, priests first, then by name (58).
  Phases: pausing until every member acknowledges (90-93), routing (73-79), retry after 5 s then
  15 s up to three attempts (52-56), regrouping until covered for 500 ms (80-86), failed. Each
  phase times out after 30 s. A ready approach for 500 ms ends recovery
  (formation-recovery-progress.ts:3-9). Settings: none.
- **MOV-090** Recovery client. Rules: the mover takes the movement gate if no one holds it, else fails
  "another route owns the native walker" (formation-recovery-client.ts:95-99); it walks the
  planned plot one segment at a time, shortening each to the step size (50-56), fails when a
  route leaves the map (77), the next segment is unsafe while it moves (69), ownership changes
  (89) or 30 s pass (90). An unsafe segment while it stands still replans instead, because the
  shared.js ports supply `segmentClear` (65-67; shared.js:16606). A segment that would break healing coverage waits (60-62). `cancel` stops `smart`
  only when `on_done` still matches (32-38). Followers plan their own route to the goal set
  (189-199). Settings: debug overlay `partyFormationRecoveryDebug`.
- **MOV-091** Recovery route search. Rules: incremental A* over a 16-unit grid, then 8 units,
  within 4 ms and 512 expansions per tick, 16384 expansions and 768 units past the farthest goal
  in total (recovery-route.ts:4-36). The retained combat approach route reuses its path while the
  key holds and returns the farthest live-clear point (39-56). Settings: none.

##### Independent combat approach

- **MOV-092** Independent approach ports. Rules: allowed when no other owner's journey is live, no
  convoy (except an accepted farming handoff), not occupied, not paused, not in Cave or event
  travel, no attacker and no monster on a teammate (shared.js:16700-16719). The goal is a point on
  16 directions at the approach radius around the predicted intercept (16720, 16731-16739,
  16688-16699, interception.ts:9-23). `start` cancels group, fight and farm routes, resets combat
  movement and starts `movement.move` with owner `recoveryStage: "combat-approach:N"`, Town off,
  arrival 3, and installs a direct plot when the line is clear (16740-16747). Settings: none.
- **MOV-093** Independent approach client. Rules: a changed context key or target retires the
  approach (independent-approach-client.ts:20, 66) and a new one launches (67). A pending direct
  journey, or one past its last radius level, is re-issued when the predicted point moves more
  than 12 units and 250 ms passed since the last issue (22-28). A journey that ends out of range
  is re-issued with half the radius, up to 8 levels (29-34). In range it cancels its journey and
  reports ready (36-45); while still outside the 10-unit buffer it keeps the journey (38-40;
  shared.js:16727-16729).
  Settings: none.
- **MOV-094** Coordinator capability and confirmation. Rules: independent approach applies when every
  member is fresh, on the same map, protocol 4 and reports the capability, and no member is in an event
  (independent-approach.ts:3-17). A confirmation round lasts 3 s and every member must echo it within 1 s (46-54).
  Settings: none.

##### Combat steps and step safety

- **MOV-095** Combat range geometry. Rules: desired range is own range minus 5 percent, clamped to 2
  to 12 units (17096-17099). Distance uses the crab correction when present (17100-17105). The
  approach point sits on the line from the intercept centre, 10 units inside range when out of
  range (17106-17122). Settings: none.
- **MOV-096** Combat step writer. Rules: `sendCombatMove` issues one native `move` per step unless
  the same destination is still being walked (17141-17156); it yields to an independent approach
  journey and to return combat (17142-17143). `resetCombatMovement` stops only the step it sent,
  matched by `going_x/y` within 2 units (17123-17140). Settings: none.
- **MOV-097** Step safety. Rules: a step must pass `can_move_to` (17159). For each monster already
  targeting this character, other than the selected target, the step must not end closer than
  `min(current distance, range or 30) - 1` (17162-17173). Monsters that do not target this
  character are not checked. Settings: none.
- **MOV-098** Kiting. Rules: the nearest attacker is kited on an arc at desired range, turning at
  most 0.65 radians, trying the current direction first (17202-17226); then one outward
  "escaping" step (17227-17228); then, for event bosses, a 16-direction corner search that stays
  in boss range (17184-17201, 17229). An out-of-range own target is approached first (17210).
  With no target, `defensiveFormationMove` kites an attacker within range + speed x 0.6 + 20
  (17637-17651). `isCurrentlyKiting` reports a kite step in the last 1.5 s for Stomp
  (16008-16012). Settings: none.
- **MOV-099** Approach. Rules: steps toward the approach point at five angles within 0.8 radians,
  each checked by `safeCombatPoint` (17311-17326); in a joined event a two-leg detour on rings of
  80-640 units is tried, with both legs clear of attackers sampled every 20 units (17265-17310,
  17321, 17327). Franky combat goes to MOV-100 (17312). Settings: none.
- **MOV-100** Franky approach: steps toward Franky at five angles with terrain the only check, holds
  in range (17237-17262). Settings: Franky attendance.
- **MOV-101** Sight recovery: retraces up to 8 footsteps, then a teammate who sees the target, then
  the last sighting, with fan detours, bounded to 8 s and 6 steps (sight-recovery.ts:5-58); each
  step passes `formationRecoverySafePoint` and goes out as a combat move (shared.js:17609-17613,
  16628-16640). Settings: none.
- **MOV-102** Spread: a character within 16 units of a party member on its map steps
  `16 + 10 + 4 x position` away on a name-hashed angle, at most every 1.5 s; the member first by
  name stays put (17539-17555). It skips while banking, queued to bank, stocking, departing, in a
  convoy, following or moving (17537-17538). No safety check. Settings: none.
- **MOV-103** Cave priest recovery move exposed to the runner (17489). Settings: none.

##### Who may move: the occupancy gate

- **MOV-104** `isOccupied` answers one question for the role tick, farm approach, terrain recovery
  and independent approach (17494-17528). Rules: true in Cave pause, upgrade preview, console
  maintenance, return combat with Town, event exit, Hunt-target or continuous-return convoy, merchant
  tidy, travel combat, Hunt loot, combat recovery, escape, rare patrol/loot/path, reunion,
  banking, stocking, upgrading, forced or Town travel, party Town, convoy, gathering, following,
  event travel, anniversary; departure or bank queue unless engaged. Side effects: it cancels a
  return Town under attack (17500), interrupts convoys for defense (17504, 17512-17514) and
  writes the `root.__partyCombatOwner` label (17506, 17524).
  Settings: none.

##### Hunt travel stops

- **MOV-105** Travel interruption. Rules: a convoy may be interrupted unless forced, exempt,
  non-preemptible, continuous return, or one of six purposes (hunt-travel.ts:18-22). The
  coordinator commits a stop for a monster whose passive rule says stop (passive-travel.ts:4-7,
  hunt-travel.ts:105-109), retires dead or lost targets (78-104), and picks a primary defense target
  (117-133). 04-targeting TGT-018 claims most of these helpers; this behaviour claims the
  interruption rule and `updateHuntTravel`. Settings: passive hunting rules (`passiveHunting`).

#### Step safety

| check | file:line | radius | monsters considered |
|---|---|---|---|
| terrain | `can_move_to` / `can_move` everywhere | n/a | n/a |
| safeCombatPoint | shared.js:17157-17173 | must not end closer than `min(now, range or 30) - 1` | only monsters targeting this character, except the selected target |
| formationMonsterSafety | shared.js:16239-16248 | target `min(range, max(6, own - 24)) + 8`; outranging and not targeting this character 38; else range + 8 (default 20) | every visible monster |
| priestSecondaryClearance | shared.js:16250-16291 | the safety radius above, swept over 0.6 s | caller's list |
| formationSegmentSafe | shared.js:16292-16305 | risk may not rise along sub-steps of 0.6 x speed | obstacles (all enemies, target excluded for melee) |
| formationStepSafe | shared.js:16652-16664 | safeCombatPoint + healing coverage + risk not above current | all visible enemies (16662) |
| solver secondary filter | shared.js:16842-16851 | within `max(160, safety + step + speed x 0.6 + 40)` | priest and mage only; every other class gets none |
| terrainRecoverySafe | shared.js:16453-16467 | endpoint clearance > safety; segment clearance >= min(before, safety) | every visible monster |
| formationRecoverySafePoint | shared.js:16628-16640 | formationStepSafe, or safeCombatPoint + segment check with no priest | every visible monster |
| eventApproachLegSafe | shared.js:17299-17310 | samples every 20 units, `min(now, range or 30) - 1` | attackers only |
| defensive trigger | shared.js:17646-17647 | range + speed x 0.6 + 20 | nearest attacker |

| mover | checks used |
|---|---|
| kiteIfNeeded arc and outward step | safeCombatPoint, eventKitePoint (17223, 17228) |
| eventCornerStep | safeCombatPoint (17196) |
| approachCombatTarget | safeCombatPoint (17325) |
| eventApproachDetour | safeCombatPoint, can_move, eventApproachLegSafe (17288-17297) |
| recoverFarmApproach direct and detour | can_move_to, safeCombatPoint (16154, 16177, 16181) |
| recoverFormationCorner final step | formationSegmentSafe, priestSecondaryClearance, safeCombatPoint (16376-16432) |
| solveFormationMove | formationStepSafe (16905, 16934, 16998) |
| followTerrainRecovery | terrainCoverageStep, terrainRecoverySafe (16593) |
| recovery client segments | terrainRecoverySafe via ports (formation-recovery-client.ts:64) |
| sight recovery | formationRecoverySafePoint (17611) |
| frankyMovementTick | can_move_to only (17255) |
| separateFromParty | none (17555) |

Game rule comparison: the game server files each untargeted aggressive monster in a 32-unit grid
cell every tick (`set_ghash(aggressives, monster, 32)`, node/server.js:14394-14405 at
kaansoral/adventureland_mongodb 16881a2) and checks each player against the 3x3 cells around its
own cell (server.js:15263; `get_nearby_ghash`, node/server_functions.js:1203-1216). The reach is
under 64 units on each axis and under 90.5 in a straight line, and it always covers 32 on each
axis. A filed monster attacks only when it faces the player within 45 degrees (`is_in_front`,
server.js:15265; js/old_common_functions.js:1251-1257), and `monster.aggro` is a chance per tick
unless it is above 0.99 (server.js:14403). The fork's figures match this: `AGGRO_REACH = 96`
rounds 90.5 up (pulling.ts:6-11 (fork)) and `BOSS_AGGRO_REACH = 64 x sqrt(2)` (shared.js:3774-3781
(fork)). The current console has no aggro-grid model (`git grep -n -i -E "ghash|aggro.?reach"
refs/review/ryan-1.5` returns nothing).

### 1.4 Coordinator convoys, shared walks and escape stages

Scope: `runtime/coordinator/navigation/*` (except the planner, adapter and barrier files of slice 1.1 and the rare, Phoenix, farm, focus, selection, initial, manual and passive-settings files of slice 1.5), `scripts/party-escape.cjs`, `scripts/convoy-navigation.cjs`, `scripts/farming-navigation.cjs`, `scripts/command-ownership.cjs`. `scripts/combat-disengagement.cjs` was read in full for bug 5 and is left to 05-survival.

All lines are on `refs/review/ryan-1.5` (b9b5c91e) unless marked (fork). Paths without a folder are in `runtime/coordinator/navigation/`.

Counts: the slice 1.4 files hold 445 functions. 411 are claimed here and 34 by other specs (01: 5, 04: 25, 06: 3, 07: 1). The behaviours below also claim 18 functions from `http/convoy-engagement.ts`, `http/convoy-acknowledgements.ts`, `http/shared-convoy-route.ts` and `application.ts`, so 43 behaviours (MOV-106 to MOV-147 plus MOV-136b) claim 429 functions (count from `catalog/functions-ryan-1.5.json` against `catalog/*.json`). 184 test references, all present on the current console (node check against `git show refs/review/ryan-1.5:<file>`).

The coordinator moves the party by writing commands into `party.commands[name]`; each character picks its command up from the status response and acts on it in `characters/shared.js`. The coordinator never moves a character directly. Every movement decision on this side is therefore "which command does each member hold now", and every hand-back is a command being deleted or replaced.

##### Convoy slot and creation

- **MOV-106** The party has one convoy slot, `state.activeConvoy`. Rules: `assemble` cancels whatever convoy is active with the reason "replaced by a new convoy" before it builds the new one (convoy.ts:202-203); `cancel` deletes only `party-monster-travel` commands that carry the old convoy id (convoy.ts:137-141); `start` refuses only while an escape is active and the new convoy is not `escape-recovery` (convoy.ts:241-242) or the leader report is older than 10 s (convoy.ts:247), or the leader is not among the selected members (convoy.ts:251). Each convoy gets a new party-wide `navigationEpoch` (convoy.ts:204). `createCoordinatorPartyConvoys` resolves the destination area from the Hunt target or the farming focus (convoy-composition.ts:36-43). Settings: farming policy and monster focus pick the area.
- **MOV-107** Membership, leader and pace. Rules: members are active, not the merchant, the leader or a follower, on the leader realm, with an uncancelled navigation intent (convoy.ts:97-131); Franky exits, return walks and escape recovery skip the intent check (convoy.ts:127, 244); workflow purposes (`shared-walk`, `shared-walk-return`, `franky-exit`, `event-return`) take the names they are given (convoy.ts:94-99); the leader is the party leader, the first named member for escape and shared walks, or the first member off Main for a Franky exit (convoy.ts:101-112); the cruise speed is the slowest positive member speed (convoy.ts:145-157). Settings: party leader and followers.
- **MOV-108** Town first. Rules: a convoy to Main goes through Town when the leader is off Main or is more than 200 farther from the destination than Town spawn is (convoy.ts:78-87); shared walks never go Town first (convoy.ts:221). Settings: none.
- **MOV-109** Early combat allowance. Rules: only purposes `""`, `party-travel`, `farm-relocation`, `manual-monster-override` and `empty-spawn-recovery`, with no `cause`, may hand off to combat during travel (convoy.ts:89-91). Settings: none.
- **MOV-110** History log. Rules: every lifecycle change appends one entry to the leader combat log with destination, revisions and Hunt stage, capped at 500 (convoy-history.ts:11-23). Settings: none.

##### Legacy convoy barrier (`scripts/convoy-navigation.cjs`)

The legacy barrier still runs the assemble, Town and return-itinerary phases; protocol 4 code calls it for those phases (shared-navigation.ts:399, 340).

- **MOV-111** Assembly. Rules: each member must be fresh (3 s, line 4), alive, holding the matching command (`identity`, lines 31-40), reporting `assembled`, stopped, within 55 of the rally and at cruise speed (lines 113-119); the barrier then waits 500 ms (line 122); 30 s without progress (a member 5 units closer or a new acknowledgement, lines 93-95) or 120 s total holds the convoy as `assembly-timeout` (line 109). Prepare requires every member to stay within 1 of its recorded origin at cruise speed until departure (lines 195-198) and to report route-ready within 60 s (line 224); departure is 4 s after all are ready (line 225). Death recovery convoys reissue lost commands (lines 52-58). Settings: none.
- **MOV-112** Return itinerary. Rules: the leader plans a list of walk and Town legs within 65 s (line 149); the list must have 1 to 100 legs and end within 1 of the destination (lines 152-157); each leg runs as a fresh assemble cycle from the leader position (lines 229-242); a Town phase must finish in 20 s (line 162); a return leg with no member moving 5 units in 60 s fails (lines 211-221); a leg arrival more than 100 from its point fails (lines 205-208). Settings: none.
- **MOV-113** Hold on failure. Rules: `hold` marks the convoy failed and gives every member whose command is absent or belongs to this convoy a `hold` command (lines 21-30); a failed convoy keeps reissuing holds to members with no command (lines 60-68). Settings: none.
- **MOV-114** Signal. Rules: each heartbeat response carries the convoy id, epoch, command id, phase, runtime id, departure time and a 3 s `validUntil` (convoy-navigation.cjs:243-250); protocol 4 adds revision, geometry reload, Town and route availability flags (shared-navigation.ts:532-537). Settings: none.

##### Combat handoff during travel

- **MOV-115** Combat handoff. Rules: a report from a member is accepted only with a matching command, an allowed convoy, phase `scheduled` or `travel` after departure, the current revision, and a target inside the farm area and in focus (convoy-navigation.cjs:253-260); the reporter's command is deleted and every other member gets an `event-resume-travel` command to the convoy location (lines 266-272); the convoy slot clears (line 286). Protocol 4 farming purposes go through `engageFarming` instead (shared-navigation.ts:538-541): only the leader may report (farming-engagement.ts:28), and if every member is within the area the convoy ends (lines 16-19), otherwise the convoy switches to `defending` (lines 21-22). Settings: monster focus and search radius.
- **MOV-131** Travel defense classification. Rules: an attacker counts when it targets a convoy member on the same map, instance and realm (travel-defense.ts:37-41); live event bosses fighting a member a map away from the leader do not count (lines 46-49); passing monsters marked keep-moving do not count unless the passive setting requires a stop (lines 69-73); confirmed deaths do not count (lines 61-64, 85); a member with a report older than 3 s, or no attacker list, makes the result `waiting-for-observations` (lines 25-32, 99-100). Hunt travel defends against more than one encounter, or any encounter once Hunt defense is on (lines 109-121). Settings: passive hunting.
- **MOV-132** Travel ownership for combat. Rules: `travelCombatFor` names one travel operation per member, in this order: a released event walk (none), the active convoy for normal purposes, a travel command, a client travel command, a Hunt travel stage, a pending farm relocation (travel-defense.ts:177-196, 151-159); no operation while an escape is active or the intent is cancelled (line 208). Grouped combat treats a member with an operation as travelling and pauses pulls (grouped-snapshot.ts:151, 162). Settings: none.
- **MOV-133** Convoy defense. Rules: only normal, non-forced convoys with no member in an event defend (convoy-defense.ts:35-42, 121-124); a classified attack switches the convoy to `defending` (lines 115-120); after the attack ends the leader must report loot complete within 180 of the stop point (lines 50-62) before the convoy reassembles from the leader position under a new epoch (lines 63-73, 109-114); stale observations put the convoy in `observing` and hold everyone (lines 74-81) until 5 s of stopped held reports (lines 97-102); a stop caused only by passing monsters resumes without loot (lines 171-187); a farming engagement holds defense until the target dies, leaves the area or 15 s pass without it being the target (lines 227-261). Settings: passive hunting.

##### Shared route protocol (protocol 4)

- **MOV-116** Command building. Rules: `sharedCommand` copies the convoy identity, the member's navigation revision, route version, planner flags and purpose into a `party-monster-travel` command and records the expected command, revision, phase and runtime in `c.expected` (shared-navigation.ts:22-34); `issue` gives every uncompleted member a new command (lines 35-39); a terminal command is `event-walk-release` for an event entry walk, else `hold` (lines 190-198). Settings: none.
- **MOV-117** Route preparation start. Rules: `begin` needs every member fresh (3 s), protocol 4, with a runtime, on the leader realm, and the leader stopped and not transporting (shared-navigation.ts:66-76); a Town rally that a member is more than 55 from reassembles first (lines 79-82); the rally becomes the leader point, the route version increments and every member gets `shared-prepare` (lines 83-97). Walking assemblies wait 30 s for protocol 4 runtimes (lines 403-413), Phoenix patrol waits for matching stopped `assembled` reports (lines 107-115). Settings: none.
- **MOV-118** Rendezvous progress and timeouts. Rules: progress is a member 5 units closer to the rally (shared-navigation.ts:146-147) or 5 units of movement under the current command (lines 159-171); 30 s without progress or 120 s total regroups (lines 172-174, 316); once nobody is assembling, route preparation gets 60 s (lines 175-179, 317); the blocker text names the missing acknowledgement (lines 126-140). Settings: none.
- **MOV-119** Departure. Rules: all ready for 500 ms (shared-navigation.ts:320-321), then a 4 s departure, or 0 s for a continuous return or a route whose first transition is Town (lines 566-568, 578-584); readiness means matching report, current route version, `route-ready`, stopped, within 55 of the rally and at cruise speed (shared-departure.ts:12-21); before departure a member more than 1 unit from its origin re-prepares (shared-departure.ts:45-54, shared-navigation.ts:327-330); repeated re-preparation is bounded at 60 s from the first (shared-navigation.ts:345-347, shared-departure.ts:23-25). Settings: none.
- **MOV-120** Ownership health. Rules: each active tick fails the convoy when a member's command is gone or belongs to another convoy, its intent is cancelled (unless exempt), its revision changed (`owner-lost`), it is stale (`unavailable`), on another realm (`realm-lost`) or on a new runtime (`runtime-lost`) (shared-navigation.ts:101-106, 291-299, 354-357). Settings: none.
- **MOV-126** Tick order. Rules: `step` runs communication recovery, Town refresh, merchant defense, merchant pause, Hunt arrival, then route advance (shared-navigation.ts:433-466); route advance runs geometry repair, failed step, Hunt route budget, travel defense, then the active step or bootstrap (lines 471-479). Settings: none.
- **MOV-128** Shared route publication. Rules: only the leader, during `shared-prepare`, with the current identity, may publish (shared-route-store.ts:96-98); the route must be well formed (lines 14-58), its origin within 1 of both the leader and the rally, its destination inside the convoy area within 1 (lines 90-95); a second, different route for the same version is refused (lines 103-104); routes live in a WeakMap and are never persisted (lines 5-11). Settings: none.

##### Route recovery and retry budgets

- **MOV-121** Regroup recovery. Rules: a route failure moves the convoy to `shared-hold` under a new epoch and holds everyone (shared-navigation.ts:248-252); after every member reports `held` and stopped the route is rebuilt (lines 300-307), or the convoy fails after 30 s (line 301); 2 regroups are allowed (1 for continuous return) before `retryExhausted` (lines 590-595); a Hunt-owned route fails at once (line 237); readiness drift re-prepares instead (line 236); planner choice follows the failure text (shared-departure.ts:36-43). Settings: none.
- **MOV-122** Terminal failure. Rules: `terminal` marks the convoy failed, clears its route and gives every still-owned member a terminal command (shared-navigation.ts:220-230); a failed event entry walk gives `event-walk-release`, which hands movement back to event combat (lines 491-498, 503); a failed convoy keeps reissuing holds to owned members with no command (lines 505-509). Settings: none.
- **MOV-123** Return rebuild. Rules: a failed `shared-walk-return` with `runtime-lost` rebuilds up to 3 times after 5, 15 and 30 s (shared-navigation.ts:522-531); an unprepared Hunt return that lost its realm rebuilds once (lines 514-521); a regroup of an unprepared Hunt return reassembles from scratch (lines 278-284, 48-56). Settings: none.
- **MOV-124** Geometry repair. Rules: a game geometry mismatch holds everyone and reloads only the mismatched runtimes (shared-navigation.ts:254-262, 358-361); it resumes when fresh compatible geometry arrives, fails after 60 s, and fails at once if any member's navigation moved on (lines 263-277). Settings: none.
- **MOV-125** Missing route watchdog. Rules: a member whose fresh reports carry no convoy handle for 3 s triggers a regroup (shared-navigation.ts:552-564, 337-338). Settings: none.
- **MOV-137** Restart rebuild. Rules: a failed ordinary party travel convoy marked `restartRecovery` is rebuilt up to 3 times after 5, 15 and 30 s (restart-recovery.ts:58-61, 71-94); a changed leader, follower set or revision discards it (lines 20-34, 65-69); it waits while any member is stale, dead, on another realm or an escape runs (lines 35-57). Settings: none.

##### Communication loss

- **MOV-130** Communication hold. Rules: a member with no report for 3 s, a stale attacker list, or a client report in phase `communication-hold` for any request except `/convoy-complete` puts the convoy in `communication-hold` and holds everyone (communication-recovery.ts:36-58, 132-153); a failed convoy whose saved failure is a network or timeout error on `/movement-barrier` or `/movement-plan`, or an expired signal, moves into the same hold (communication-failure.ts:2-16, communication-recovery.ts:47-57); it resumes only after every member reports `held`, stopped, fresh, protocol 4 and on the route realm for 5 s, at most once per 30 s (communication-recovery.ts:69-97); route retry counters are kept (line 92), except that moving a saved transport failure into the hold resets them (line 56); any member whose navigation moved on fails the convoy (lines 101-104). Settings: none.

##### Merchant pause

- **MOV-134** Merchant interruption. Rules: a merchant collection for a convoy member is admitted only on a protocol 4 convoy that is not non-preemptible, defending, observing or in a communication hold (merchant-interruption.ts:17-28); the convoy holds everyone, waits for stopped held reports, lets the recipient collect, then resumes its saved phase (lines 87-116); the pause ends after 60 s or when the merchant job changes (lines 24, 117-119); a changed intent or a newer command fails the convoy (lines 95-98). Settings: none.

##### Arrival

- **MOV-129** Arrival verification. Rules: an arrived member must be fresh, stopped, alive, on the route realm and runtime with the expected revision (shared-route-store.ts:158-165), report `arrived` with the current route version (lines 116-117), and stand within 100 of the destination area, within 50 of a Hunt endpoint, or on Main for a Franky exit (lines 166-174); 3 s of verified arrival completes a Hunt convoy in `travel` whose completion request was lost (return-arrival.ts:7-22, 41-46); a failed continuous Hunt return completes from stopped hold reports at Daisy (shared-route-store.ts:124-132); native terminal receipts must match the last transition and stand within 1 of it (terminal-settlement.ts:5-47). Settings: none.
- **MOV-135** Hunt arrival handoff. Rules: when every Hunt member of a Hunt convoy stands inside the mission area within its search radius (default 400) (hunt-arrival.ts:28-38), the convoy enters `hunt-arrival` and holds everyone (lines 78-88); once all report held and stopped it deletes the commands, clears the slot and sets the Hunt stage to farming (lines 62-70); members in an event or with a cancelled intent block it (lines 25-27). Settings: Hunt search radius.

##### Continuous return

- **MOV-136** Continuous return. Rules: a Hunt return or anniversary staging upgrades to one continuous route at a stopped assembly when every member reports Hunt return protocol 2 (continuous-return.ts:58-70); the Hunt keeps a 1 s checkpoint of the return (continuous-return.ts:19-55). Settings: none.
- **MOV-136b** Return Town policy. Rules: an interrupted or unavailable Town cast switches the continuous return to walking (return-town.ts:24-34); live aggro keeps it walking (lines 64-65); Town is allowed again only after the map changes, aggro clears or Town readiness changes, and only while every member is Town-ready (lines 66-78, 99-105); a Town refresh reassembles the return from the Town rally (shared-navigation.ts:569-576). Settings: none.

##### Event walking

- **MOV-127** Moving boss pursuit. Rules: during `travel` of an owned event walk to `mrgreen`, `mrpumpkin` or `slenderman` (event-pursuit.ts:22-25), at most every 20 s (line 19), a fresh sighting of the same boss 250 or more from the destination (line 9) moves the destination, but only after every member is on the boss map and instance (line 15); the convoy then re-prepares under a new epoch (shared-navigation.ts:371-376, 381-388). Settings: none.
- **MOV-138** Shared walk admission and coalescing. Rules: a walk request must come from an owned member with the current revision, a fresh protocol 4 status, an allowed activity and the event enabled (shared-walk.ts:70-92); requests with the same activity and key on the same map and instance join one walk, at the leader's point for 8 named moving bosses or within 1 otherwise (lines 55-62); requests live 10 s between polls (line 160); a leader already within 100 of the destination anchors the walk without walking (lines 162-167, 474-476); members already fighting the boss at the destination are left out (lines 130-157); an event walk starts without missing members after 20 s (lines 43-45, 241-250); a member within 55 of the destination is not waited for (lines 236-238). Settings: event toggles.
- **MOV-139** Shared walk start and replacement. Rules: with no convoy a walk starts at once; a failed entry walk is replaced only after runtime turnover (shared-walk.ts:186-189); a walk restored after a restart can be replaced by any allowed activity (line 190); an event walk replaces any active convoy that is not itself a walk session, not exempt and not non-preemptible (line 191); the walk saves each member's current command as its parent and restores it when the member completes (lines 168-182, 198-210, 11-16); return walks are exempt and Halloween exits and staging use continuous return (lines 291-311); turnover keeps the failed walk's retry counters (lines 278-290). Settings: none.
- **MOV-140** Walk progress, cancel and failure retention. Rules: each client poll (every 500 ms, shared.js:15123) returns `waiting`, `travelling`, `complete` or `failed` (shared-walk.ts:312-329, 478-482); a cancel from the session fails the whole session and cancels the convoy (lines 333-342); a failed event walk answers every event walk request from one of its members with its failure, whatever the event, until runtime turnover (lines 343-349). Settings: none.
- **MOV-141** Failed walk turnover. Rules: a failed `runtime-lost` restart walk can be replaced once every member reports again after the failure, on the route realm and joined to the same event, and at least one member has a new runtime (shared-walk.ts:350-356, 382-399), when a member died after preparation started and rejoined the same event (lines 400-431), or for a `runtime-lost` restart walk when a member joins a different enabled event (lines 357-381). Settings: event toggles.
- **MOV-143** Return dispatch and retry. Rules: an event return gives each member its saved waypoint at the current revision (farming-navigation.cjs:29-36, 151-166); members already within 180 (100 for Halloween bosses, halloween-return-arrival.ts:4-6) need nothing (lines 169-170); the leader group with the same point goes by convoy, but only while the convoy slot is free (line 179), and everyone else by individual `event-resume-travel` commands (lines 171-192); after 2 s a member whose command or convoy is gone, or whose reunion waits at the farm for 10 s, is retried, with waits of 5, 15, 30 and 60 s (lines 202-273); offline members are deferred (lines 159-163, 233-238). Settings: none.

##### Escape movement

- **MOV-144** Escape stages. Rules: a fighter escape needs exactly one warrior, mage and priest (party-escape.cjs:27-42); the mage Blinks, then the warrior and priest are Magiported to the landing, each confirmed within 65 (lines 49-53, 91-96); the whole sequence has 30 s (line 37); death, disconnect or timeout moves it to `recovering` (lines 19-24, 62-71); `recovering` waits until everyone is settled within 65 of Main, starts an escape-recovery convoy, and ends in `failed-hold` once they are settled on Main again (lines 72-90); a coordinator restart during an escape forces `recovering` (lines 98-109). Settings: none.
- **MOV-145** Recovery hooks. Rules: escape cancel cancels the convoy and deletes every escape member's command (recovery-hooks.ts:48-51); escape recovery convoys to Main (0, 0) (lines 52-53); death recovery returns to the saved farm by a `death-recovery` convoy (lines 63-64). Settings: none.

##### Navigation authority

- **MOV-142** Navigation intent revisions. Rules: each character has `{revision, cancelled}` (farming-navigation.cjs:6-15); `invalidate` bumps the revision, marks it cancelled, deletes the member's travel commands and saved waypoint, clears it from event return routes, and cancels a convoy that includes the member, then restarts the convoy for the rest if the leader remains (lines 82-126); `authorize` invalidates, then sets the new destination uncancelled and releases the manual Town barrier for those members (lines 127-150); `authorizeCoordinatorFarmingRoute` releases an escape first and resets farm relocation state (runtime.ts:16-34). A legacy cancellation reason "monster focus cleared" is ignored during Hunt (farming-navigation.cjs:9-13). Settings: farming focus, Hunt policy.
- **MOV-146** Travel clock. Rules: one 250 ms timer runs convoy step, escape step, death recovery and rare tick in that order (runtime.ts:77-84); a 1 s timer runs event return and anniversary (lines 85-90). Settings: none.
- **MOV-147** Command ownership log. Rules: a Proxy on `party.commands` logs every set or delete that involves a convoy id, with before, after and three stack frames, capped at 200 per character (command-ownership.cjs:2-14). Settings: none.

#### How a convoy takes and gives back each member's movement

| Step | Coordinator side | Character side (shared.js) |
|---|---|---|
| Take | a `party-monster-travel` command (convoy.ts:159-191, shared-navigation.ts:35-39) | `handleOwnedCommand` drops a command whose revision does not match (10407-10408) and defers every command while an escape owns the character (10397-10398); `handleCommand` cancels the running convoy journey on any command that is not the same convoy command (10500-10514); `coordinatedMonsterTravel` runs it (10867-10909, 15793) |
| Phase change | a new command id for the same convoy (every `issue`) | the same takeover block cancels the journey with code `convoy-phase-change` (10510-10513) unless it is the same command id |
| Defend | phase `defending` command (convoy-defense.ts:223) | `acceptConvoyDefenseCommand` (10440-10443, 14062) |
| Hold | `shared-hold` or `hold` command | handled inside the convoy client (slice 1.3) |
| Event walk | client POSTs `/shared-travel` every 500 ms for up to 180 s (15103-15123) | non-leaders that do not follow walk alone with `smart_move` (15080-15081); for `slenderman`, `trickortreat` and `witchcipher` they also `stop('smart')` when the event is superseded (15081-15096) |
| Give back | delete the command (convoy.ts:139-140, hunt-arrival.ts:66, convoy-navigation.cjs:268, return-arrival.ts:30, farming-engagement.ts:17) or `event-walk-release` (shared-navigation.ts:195) or `event-resume-travel` (convoy-navigation.cjs:269) | `event-walk-release` stops `smart` and wakes the role runner (10420-10438); `event-resume-travel` starts a farm reunion (10911-10915, 13492) |

#### Convoy and shared walk state machines

##### Legacy phases (convoy-navigation.cjs)

| Phase | Exit | Timeout or budget |
|---|---|---|
| assemble | all assembled for 500 ms: `plan-return` (returnRouting), `town` (townFirst), else `prepare` (123-145) | 30 s no progress or 120 s total (109) |
| plan-return | valid itinerary: first leg (147-160) | 65 s (149) |
| town | all `towned`: next leg or reassemble at the leader (161-178) | 20 s (162) |
| prepare | all route-ready: `scheduled`, depart in 4 s (223-225) | 60 s (224) |
| scheduled | `travel` at `departAt` (226) | origin drift over 1 holds (196-198) |
| travel | leg arrivals: next leg; else completion (205-210) | return leg 60 s without 5 units of motion (221) |
| failed | holds reissued (60-68) | none |
| defending, observing | convoy-defense.ts (MOV-133) | observing needs 5 s stopped (convoy-defense.ts:101) |

##### Protocol 4 phases (shared-navigation.ts)

| Phase | Entered by | Exit | Timeout or budget |
|---|---|---|---|
| assemble | convoy start (convoy.ts:214) | `begin` to shared-prepare (73-100) | 30 s compatibility wait (407); 30 s / 120 s rendezvous (418) |
| shared-prepare | `begin` | ready 500 ms: `scheduled` (320-324) | 30 s / 120 s rendezvous, 60 s preparation (316-317), 60 s readiness (309) |
| scheduled | prepare | `travel` at `departAt` (332) | departure issue re-prepares (328-329) |
| travel | scheduled | verified arrival (336) or completion | missing handle 3 s (337-338) |
| shared-hold | recover, prepareAgain, moving event, merchant resume, observation resume | all held: `begin` (300-307) | 30 s (301) |
| communication-hold | communication-recovery.ts:41 | 5 s stable held reports, 30 s rate limit (88) | none: hours of loss do not spend budgets (test "hours without reports...") |
| hunt-arrival | hunt-arrival.ts:81 | all held: slot cleared (62-70) | none |
| failed | `terminal` | arrival recovery, return rebuild, Town refresh, restart rebuild | regroup budget 2 (1 for continuous return) (592); return rebuild 3 tries 5/15/30 s (525-526); restart rebuild 3 tries 5/15/30 s (restart-recovery.ts:72, 86) |

Shared walk sessions (shared-walk.ts) sit on top: request (10 s life, 160) to session start (`tryStart` 251-269), then the convoy phases above, then `complete` per member (11-16) or failure retained per event (343-349). Grace for missing event members is 20 s (45). The client gives up after 180 s (shared.js:15103) or 3 request failures in a row (15119).

### 1.5 Rare, Phoenix and farm travel, manual commands, coordinator wiring

Ref: refs/review/ryan-1.5 (b9b5c91e) unless labelled (fork) = HEAD af92de45.
Paths: `nav/` = `runtime/coordinator/navigation/`, `app` = `runtime/coordinator/application.ts`.
The catalog claims 148 functions for MOV-148 to MOV-165 (57 of them in `application.ts`) and 4 for
MOV-166, counted from catalog/02-movement.json.

##### Rare encounter travel

- **MOV-148** A rare encounter travels by party convoy, keeps an interruptible Hunt convoy, and
  cancels only its own convoys. Rules: grouped combat or a leader that sees the rare cancels the
  convoy (nav/rare-hunting.ts:512-517). Under grouped combat the stage is combat only once the
  rare is locked, otherwise approach (514); a leader that sees it sets combat (517). Otherwise the coordinator starts a
  `rare-hunt` convoy when no convoy is active and 3 s have passed since the last start (520-523).
  `cancelTravel` cancels only convoys with purpose `rare-hunt` or `phoenix-patrol` (181-182). At
  encounter start, an active convoy that `interruptibleTravel` accepts or that carries a Hunt
  travel reason stays. `interruptibleTravel` is a deny list: six purposes, a `monster-hunt` with
  no target, and force, exempt, non-preemptible or continuous-return convoys
  (runtime/combat/hunt-travel.ts:18-22). The rare is committed into the kept convoy's
  `huntTravel.committed` list (376-388);
  any other convoy is cancelled (378). A member command blocks rare pursuit unless it is a
  `party-monster-travel` or `event-resume-travel` with no purpose or one of six listed purposes
  (118-133). Settings: passive rare-hunting rules (`/rare-hunting`), keep-moving per rule (753).
- **MOV-149** The coordinator hands each fighter a rare control that its client walks to with its
  own rare path. Rules: `control` returns nothing while protected activity runs, except for a
  locked encounter (894-899). An encounter control carries the target as destination and the
  member's navigation revision (881-893). A patrol control carries the current scan point, only
  after `retryAt` (900-910). The client side (characters/shared.js:3643-3703) is described in
  "Rare paths" below. Settings: none.

##### Phoenix patrol legs

- **MOV-150** Each Phoenix scan leg is one party convoy. Rules: `stepPatrol` starts a
  `phoenix-patrol` convoy to the current point only when no convoy is active (nav/phoenix-patrol.ts:208-209;
  convoy call at nav/rare-hunting.ts:651-653). Arrival is within 40 units (phoenix-patrol.ts:203).
  While the patrol convoy is still active at arrival, the patrol does nothing, so the convoy can
  collect every member's acknowledgement (172, code comment). Once it is gone the patrol calls
  `cancelTravel` (173) and dwells 1 s before the point counts (179-180).
  Before the respawn deadline an arrival does not count (175-178). Settings: Phoenix region order.
- **MOV-151** A stalled or failed scan leg has a fixed retry budget. Rules: no leader movement of
  10 units for 30 s, outside 40 units of the point, is a stall (134-147). A failed patrol convoy is
  a failure (224-228). The first failure on a point retries the same point (152-155). Later
  failures add a fallback point 200 units left, right, up or down of the next uncovered sample,
  clamped to the region (160-169). The 4 fallbacks are counted per region and reset only on region
  entry (88, 156). An arrival that runs out of points spends the same counter to add the next
  uncovered sample (187). After 4 the region is marked incomplete and the patrol moves on (156-158).
  When all 5 regions are incomplete the patrol pauses (100-104). A `runtime-lost` or
  `unavailable` convoy failure waits 5 s and retries the same point without spending a fallback
  (214-223). Settings: none.

##### Route planning

- **MOV-152** Planner route length ranks Phoenix waiting regions. Rules: a plan at speed 60 with
  Town disabled (nav/rare-route-distance.ts:9-16) sums walking distance plus 400 per map change
  (19-23); a plan that ends more than 40 units from the goal throws (24-25), and `waitingRegion` drops a
  region whose plan threw (nav/phoenix-patrol.ts:243-249). The region the leader stands in wins
  without planning (236-237). Settings: none.

##### Farm relocation travel

- **MOV-153** Farm relocation dispatch. Rules: a pending relocation is dropped when any member's
  navigation revision changed (nav/farm-areas.ts:129-136), waits until its `at` time (138) and
  until travel defense is clear (139-140). It then starts a Hunt mission convoy
  (`mission-travel`) when Hunt has a target (89-93), or authorizes navigation and starts a
  `farm-relocation` convoy (95-102). Nothing dispatches while a convoy is active or farm travel is
  paused (186), while Hunt or an event owns the workflow (184, 196-198), while Hunt travel owns
  the route (254-256, 266), while rare hunting owns the party (258), while escape is not
  released, an event return runs, or any member is stale for 10 s, dead, cancelled or in an
  event (42-52, 240-245). A travel failure clears once every member reports inside the zone
  with margin 150 (54-78). The tick runs at most once per second (260). Settings: farming
  policy, monster focus, Hunt "relocate if competing" (farm-competition.ts:74).
- **MOV-154** Farm convoy failure recovery. Rules: a fallback convoy whose members or revisions
  changed is cancelled (nav/farm-area-recovery.ts:26-31, 95). A failure is transient when its
  text matches `/geometry|restarted|interrupted|runtime|owner|unavailable|dead|formation|cruise|command lost|prepared route lost|movement lock/i`
  (71-73); other failures count against the zone (75). `geometry-mismatch` pauses farm travel
  (97-99). Otherwise the convoy is cancelled and the same zone is retried after 10 s (transient)
  or 2 s (real) (104-111); after more than 1 real failure on a zone another zone is chosen (103).
  With no zone left, a Hunt in `mission-travel` skips the mission (32-40); otherwise farm travel
  pauses with a message (42-43). A Hunt with no target gets no alternative zone (54). Purposes handled: none, `monster-hunt`, `farm-relocation`, `empty-spawn-recovery`
  (farm-areas.ts:209-215). Settings: none.

##### Restart recovery

- **MOV-155** On coordinator start the saved convoy is restored for recovery. Rules: it comes back
  with phase `communication-hold` when a hold applies, `shared-hold` when a geometry repair was
  waiting, otherwise `failed` (nav/initial-commands.ts:55-58). Its failure becomes "Coordinator
  restarted; waiting to recover interrupted travel" with code `runtime-lost` (73-75) unless it is
  a retained failure: a Hunt route failure, a geometry mismatch or a failed event walking leg
  (26-34). `restartRecovery` is set except for retained Hunt
  failures and geometry mismatches (76); the expected revisions are kept (19-24, 77). The route
  protocol is forced to 4 (68) and a merchant interruption resumes (65-67). Three hold sources
  exist: a saved hold (37), two legacy failure shapes (38-45), and an ordinary protocol 4 or Hunt
  convoy that is not failed (46-49, 104-109); convoys with no purpose, `party-travel` and
  `party-force-travel` are excluded (106). Settings: none.

##### Manual travel commands

- **MOV-156** Dashboard travel commands. Rules: character travel releases escape for a fighter
  (nav/manual-commands.ts:78), authorizes the one character, and queues a `character-travel`
  command to the saved character location (75-89). Party travel needs an online leader seen in
  the last 10 s (91-94), authorizes the route for all members (97), and is deferred until the
  event ends when `resumeAfterEvent` is set and a member attends (98-99); otherwise it starts a
  party convoy (100). Town invalidates the shared intent for the leader, or one intent for a
  member (108-110), and queues `character-travel` to main (-174, 121) with
  `navigationExempt` (111-117). Return to leader authorizes the member to the leader's position
  and queues `return-leader` (140-147). Each command skips manual event occurrences for the
  affected members (79, 109, 144); party travel skips them only without `resumeAfterEvent`
  (95-96). Go home sends the configured merchant a `character-travel` to main (0, 0) and restarts
  its runtime 150 ms later when the realm changes or it is offline (120-139). A travel, force
  travel or return-leader command for a fighter first releases the dungeon hold (app:941-945). The composition binds these to the live navigation
  service and `authorizeCoordinatorFarmingRoute` (nav/manual-composition.ts:25-50). Settings: none.
- **MOV-156b** Dashboard party action routes. Rules: party travel checks the map name and point
  (runtime/coordinator/http/party-actions.ts:45-55), releases a dungeon hold and escape, authorizes
  every member, and starts a `party-travel` or `party-force-travel` convoy for the online members;
  it refuses without an online leader (58-71). Checkpoint authorizes every member to the leader's
  position when the leader was seen in the last 10 s (72-83). Party Town releases escape,
  invalidates every member's intent, and opens a Town cycle with a revision snapshot and one
  `town-party` command per online member (104-119). If a dungeon owns the party and cannot
  release, Town and escape exit the dungeon and return without starting their own work (145-152).
  The heartbeat keeps the Town cycle in step (MOV-166). Settings: none.

##### Coordinator travel wiring

- **MOV-157** ALClient geometry is prepared per game version; preparation failure leaves native
  movement as the fallback with a warning (app:124-138). `canStand` is replaced with the loaded
  geometry (130). If preparation fails at startup, `canStand` stays `() => false` (123), so the
  merchant stand-location route refuses every point (runtime/coordinator/merchant/stand-location.ts:38-39).
  A candidate client version prepares through the same function before it activates (1171).
  Settings: none.
- **MOV-158** The travel clock steps the main party convoy and every solo fighter's convoy, each
  after its own restart recovery (app:2012-2020, 1736-1752). Anniversary return scheduling goes
  through the same clock (2174-2176). Settings: none.
- **MOV-159** One start port (`startPartyMonsterConvoy`, app:2060-2068) and one cancel port
  (`cancelActiveConvoy`, 2078-2080) reach the main convoy service; solo services bind their own
  (1795-1796, 1809-1810). Hunt has a second start port, `startHuntConvoy` (2099-2106, through
  `huntConvoy.start`), and a second cancel path: `cancelHuntConvoy` (2074-2076; solo at 1791)
  clears a `monster-hunt` slot and its commands directly, without the convoy service
  (runtime/coordinator/hunt/controls.ts:55-61). A realm switch cancels the main or solo convoy whose participants left
  (1711-1719). Hunt turn-in priority decides whether Hunt owns travel (2112-2114) and gates solo
  walks other than Town and event returns (2002). Settings: none.
- **MOV-160** Convoy HTTP routes reach the convoy that owns the calling character. `scopedRouter`
  sends a request to the solo service when the character farms alone, otherwise to the main
  handler (app:2031-2049; used for the shared convoy route at 2364). The engage, approach,
  acknowledgement and farming-return routes go through `scopedRoute` instead (2021-2030, wired
  at 2297-2299). Navigation action ports
  bind engage, hold, validity and arrival to the convoy navigation (760-780, 1977-1997).
  Settings: none.
- **MOV-161** Escape start, step and release reach one escape controller, created once for the
  main party (app:1781) and called at 710, 714, 920, 1741, 1758 and 1770-1771. Solo services
  create none: their heartbeat asks the same controller (1906, beside the main one at 551), and
  their rare control is a stub that never owns (1787). The dashboard escape and resume routes reach
  it through party actions (runtime/coordinator/http/party-actions.ts:133-144). Settings: none.

##### Heartbeat travel fields

- **MOV-162** Each heartbeat carries travel fields: the convoy signal (app:553;
  runtime/coordinator/status/response-composition.ts:31), the party location, `farmTravelPaused`
  when farm travel or the Phoenix patrol is paused, the navigation intent, `partyTownActive`,
  `partyConvoyActive` and `huntTurnInPriority` (runtime/coordinator/status/response.ts:182-195,
  178-181). The same block also carries `partyTownCycleId`, `returnProgress`,
  `eventReturnCycleId` (172-176) and `mapTelemetry` (193). The merchant always gets false for
  `farmTravelPaused` and `partyTownActive` (186, 189). Settings: none.
- **MOV-163** Travel reports are ordered. Rules: a report with the same runtime id and a sequence
  not newer than the last keeps the old movement fields and freshness
  (runtime/coordinator/status/travel-report.ts:16-22). A newer report stamps receipt time and
  counts current attackers only while connected (23-26). Settings: none.

##### Character movers

- **MOV-164** A warrior approaches an out-of-range target with Dash
  (runtime/characters/classes/warrior-combat.ts:21-23). Settings: none.
- **MOV-165** While the dungeon workflow owns the character (`owned`, from the coordinator's
  control or a live Cave, runtime/characters/dungeons.ts:332), `canMove` pauses the movement
  service unless the coordinator's control is under 3 s old, movement-ready (or a resumable gather outside a Cave), the client is ready and
  the Cave is not paused (runtime/characters/dungeons.ts:349-351; read as `paused` by the
  movement context at characters/shared.js:21). Settings: none.

##### Rare paths (client side, claimed in slices 1.2 and 1.3)

The client reads the rare control in `pollRareHunting` (characters/shared.js:3649-3703, proposed
07) and owns a private `rarePath`:
- Take: with no path, it calls `smart_move` to the destination (3689-3693) and captures
  `smart.on_done` right after the call as the path's identity (3698).
- Re-aim: the path is cancelled when the control id changes, when the destination moves more
  than 100 units, when a convoy is active, or when this member is no longer the deployer
  (3657-3658).
- Yield: while `convoyTraveling`, `partyConvoyActive`, banking, stocking, upgrading,
  force travel or Town travel run, it returns true without moving (3659). A patrol control
  cancels the path at once (3652): patrol legs move only by convoy.
- Release: `cancelRarePath` stops the journey with `stop("smart")` only when `smart.on_done`
  still equals the captured value (3643-3648); a newer owner keeps its journey.
- Arrive: within 30 units it cancels its path (3683-3687).
- Fail: a rejected `smart_move` or a 30 s timeout marks `rareNavigation.failed` (3694-3701).

### 1.6 Movement writers

The full index of 249 call sites is `writers-index.json` in the spec scratch folder (`node writers.cjs`). These tables list the writers each slice found, with how each one gets control and gives it back.

#### Slice 1.1

The full index is `writers-index.json` (249 call sites in 130 enclosing functions plus 2 top-level lines, shared.js:594 and 642, on the
current console,
after removing 25 false positives such as type declarations and timer `stop()` methods). Command:
`node writers.cjs <scratch>` (a regex scan of every `characters/shared.js`, `runtime/**/*.ts` and
`scripts/*.cjs` file on the ref, excluding tests; `scratchpad/mov/writers.cjs`). Counts by call:
`stop(` 102 (64 `stop('smart')`, 19 `stop('move')`, 19 bare `stop()`), `smart_move(` 85,
`gate.owner=` 12, `move(` native 10, `movement.cancel(` 9, `host.move/native.move` 8,
`movement.move(` 7, `xmove(` 5, `transport(` 4, `movement.install(` 3, `combatHandoff(` 3, `host.stop(` 1. 232 of the
249 are in shared.js. The 64 `stop('smart')` include 3 that pass `success`. The scan does not match
`native.stop(` (movement.ts:412, 435; native-planner.ts:10). This table lists the writers inside this slice.

| writer | file:line | kind | how it gets control | how it gives it back |
|---|---|---|---|---|
| `move()` | movement.ts:384, 392 | replace + native stop | any caller, no check | the new journey owns the slot |
| `stop()` | movement.ts:411-412 | stop | any caller, no check | none |
| `stop()` retain branch | movement.ts:407-409 | native stop, journey kept | `retainOnDirectStop` journey | executor resumes next tick |
| `cancel()` | movement.ts:435 | stop | any caller | none |
| `combatHandoff()` | movement.ts:436 | stop | any caller | none |
| `dispose()` | movement.ts:440 | stop + gate clear | runtime replacement | restores native functions |
| `recover()` stop move | movement.ts:275 | native stop | executor error | same journey continues natively |
| executor `cancel` | movement-executor.ts:23-24 | native stop, Town stop | `finish(false)` | none |
| executor `pause` | movement-executor.ts:35 | native stop | context paused, correction, retained Cave stop (movement.ts:76, 377, 408) | re-dispatch next tick |
| executor `sendConnector` | movement-executor.ts:92 | native move | scattered arrival | step completes |
| executor `send` | movement-executor.ts:136-144 | native move or transition | plot head | step completes |
| executor `retryStoppedWalk` | movement-executor.ts:122-129 | native move (re-send) | step stopped 250 ms | once per step |
| native planner `begin`/`cancel` | native-planner.ts:10, 15 | native smart_move search | `fallback` | `cancel` |
| `scheduler` | movement.ts:414-418 | gate dispatch | `gate.owner` set by a caller | caller clears `gate.owner` |
| `movementTick` chain | runner.ts:212-256 | dispatches movers | 100 ms timer | first claim ends the tick |
| `idleMovement` | runner.ts:196-199 | defensive move or reset | no target | none |
| `publishSelection` | runner.ts:155-156 | follow `smart_move` | selection with no target | await ends |
| queue client tick | client.ts:122-123, 149-154 | approach and formation movers | 100 ms and socket events | client `stop()` |

#### Slice 1.2

`writers-index.json` has 185 writer lines in shared.js outside 15079-17660. This table lists
all 49 in functions this spec claims, the two reload stops at the top level of the routine
(594, 642) and 35 in functions claimed by specs 06, 07, 08, 10, 12 and 13 that take movement
from farming. The other 99 are merchant, bank, gathering, anniversary and event job movers
claimed by specs 03, 05, 06, 07, 08, 09 and 10.

| writer | file:line | kind | how it gets control | how it gives it back |
|---|---|---|---|---|
| routine load, reunion carry-over | 594 | stop smart | a reloaded routine finds a reunion token | the token is copied with `moving: false` |
| routine load, gathering attempt | 642 | stop all | a reloaded routine finds a gathering attempt | none |
| applyEscape | 143, 156-157 | stop smart + move | escape state change from status | none; escape pulse owns movement while `escapeOwns` |
| escapePulse recovering | 239 | journey start | 100 ms timer, `escapePulseBusy` | 20 s timeout; journey keeps running after the timeout |
| eventReturnRouteToMain | 11750, 11765-11766 | journey start, stop smart + move | called by escape and event exits | stops only while its leg's `on_done` is still installed |
| escapePulse retreat | 285 | native move | 100 ms timer, `!character.moving` | none |
| escapeWarriorDefense | 130 | Dash (skill move) | escape pulses | none |
| on_magiport (escape and reunion) | 13568, 13579 | stop smart | game magiport offer | accept_magiport teleports |
| dungeonRuntime.move | 2770, 2784 | journey start, gate take | Cave command | gate released on settle (2786) |
| dungeonRuntime.stop | 2808 | cancel | Cave command change | none |
| dungeonRuntime.sharedRoute | 2763-2764 | plot install or cancel | leader plot arrives | none |
| caveRecovery.approach | 2688 | combat step | Cave recovery client | none |
| consoleMainTick | 2445, 2455 | journey start | console Load in Main or checkpoint return | promise settle clears its slot |
| status tick maintenance park | 11153 | native move to own position | console maintenance lease | lease clears |
| status tick convoy end | 11252 | stop smart | coordinator says no convoy | none |
| status tick event disable | 11281, 11291 | stop smart + stop all | event deselected | none |
| status tick follow off | 11303 | stop smart | Follow leader turned off | none |
| status tick rare handoff | 11219-11220 | stop smart | new rare control | rare path starts on the next role tick |
| applyNavigationIntent | 10297-10298 | stop smart + move | revision change while farm, convoy, follow or force owned movement | none |
| applyEventReturnOwner | 10322 | stop smart + move | an old event exit owner retired and no convoy, follow, force or Town owns movement | none |
| handleCommand event-walk-release | 10431 | stop smart | coordinator release command | none |
| handleCommand command takeover | 10510-10513 | cancel | any new command that is not the same convoy command | none; the new command owns movement |
| handleCommand town-party | 10707-10709, 10727, 10735 | stop smart, move, all; shared walk; Town | Town command | `townTraveling` cleared in `finally` (10749) |
| handleCommand event-return-town | 10788-10789, 10815, 10823 | stop smart + move; shared walk; Town | event return command | exit owner cleared in `finally` (10857) |
| handleCommand travel, force-travel, character-travel, return-leader, monster-hunt-interact, realm-set-home | 10676, 10685, 10863, 10921, 10649, 10974 | journey start | coordinator command | journey settles |
| handleCommand party-monster-travel | 10905, 10908, 10909 | convoy start | coordinator convoy command | convoy release |
| merchantSendMail | 10341 | journey start | merchant mail job | journey settles |
| enforcePartyTownOverride | 11050-11054, 11067 | stop smart, move, all; Town | `partyTownActive` | `ownsTown` generation check |
| maintainTownOverrideGuard | 11095, 11098 | stop smart, stop move every 100 ms | `partyTownActive` | timer cleared when Town ends (11082-11085) |
| prepareReturnExit | 11019 | Town | return walk start | waits up to 12 s for the cast |
| anniversaryApproach | 11776, 11797 | journey start or xmove; stop smart + move | kiss operation | stop guarded by operation identity |
| anniversaryReturnToTown | 11842, 11856 | stop all; shared walk | anniversary staging | operation slot cleared (11859-11862) |
| preemptConvoyForAnniversary | 11945, 11947 | stop smart + move | coordinator preempt permission | none |
| pollEvents event travel | 13417 | shared walk | event live and permitted | `eventTraveling` cleared (13423) |
| goobrawl exit | 11717, 11721 | journey start, stop smart | event exit | stop while current |
| beginFarmReunion | 13511 | stop smart | reunion start | none |
| cancelFarmReunion | 13521 | stop smart | reunion cancel while moving | none |
| farmReunionTick | 13610, 13615, 13627, 13650, 13698, 13708-13709, 13716 | stop smart; shared walk; journey start; Blink | 500 ms timer (shared.js routine) | reunion token cleared on arrival |
| interruptConvoyForDefense | 14113, 14122 | stop all | party attacked during travel | coordinator resumes the convoy |
| acceptRareCombatControl | 3578 | stop smart | rare encounter replaces a Phoenix patrol convoy | none |
| cancelRarePath | 3647 | stop smart | rare control ends | only if its `on_done` is still installed |
| pollRareHunting | 3693 | journey start | rare control | path cleared on settle; 30 s timeout |
| cancelGroupRoute, cancelFightRoute | 14504, 14511 | stop smart | regroup or fight route change | only if its `on_done` is still installed |
| groupedMovement inner radius | 14633 | stop move | anchor within inner radius while moving | none |
| groupedMovement step | 14658 | native move | role runner movement tick | none |
| groupedMovement route | 14670 | journey start | after 3 s without progress | 30 s timeout or replaced `on_done` |
| encounterCatchup | 14559, 14552 | journey start, stop smart | travel defense on another map | 30 s timeout, own `on_done` only |
| cancelEncounterCatchup | 14538 | stop smart | catch-up no longer allowed or same map | own `on_done` only |
| followLeaderIfFar | 17776 | journey start | runner selection, follower far | `followingLeader` cleared in `finally` |
| dashToward | 13973 | Dash | combat approach | none |
| bankStackService.move (handed to 10) | 4040 | journey start (direct `movement.move`) | bank stack job | settle |
| bankSortMove | 4323 | journey start | every `smart_move` | settle |
| previewTravel (handed to 10) | 2501 | journey start | upgrade preview | settle |
| commerceMove (handed to 08) | 7750 | journey start | commerce job | settle |
| marketplaceMove (handed to 08) | 8778, 8794-8795 | journey start; stop smart + move on timeout | ALData job | own timeout |

#### Slice 1.3

| writer | file:line | kind | how it gets control | how it gives it back |
|---|---|---|---|---|
| sharedPartyWalk lone walk | shared.js:15081, 15083 | journey start | `smart_move` replaces any journey | journey end; `stop("smart")` 15093 |
| sharedRendezvousSearch | shared.js:15315-15316 | gate take + journey start | sets `gate.owner`, `smart_move` | clears gate in `finally` 15317 |
| sharedConvoyRendezvous | shared.js:15331 | native xmove | `xmove` | arrival or 120 s |
| prepareSharedConvoyRoute | shared.js:15552, 15555, 15448 | gate take, journey start, plot install | `gate.owner`, `smart_move`, `movement.install` | `detachRoute` 15553; failure via convoy.fail |
| prepareSharedConvoyRoute walk | shared.js:15494 | stop | `stop("smart", true)` on franky-exit in Mainland | none |
| prepareConvoyRoute | shared.js:15691, 15694 | gate take, journey start | `gate.owner`, `smart_move` | `detachRoute` 15692 |
| prepareConvoyRoute | shared.js:15584, 15662 | stop | `stop("smart", true)` | none |
| sharedConvoyEngagement / handoff | shared.js:15399-15401, 15613-15616 | gate release, combatHandoff, stop | accepted `/convoy-engage` | combat owns |
| coordinatedMonsterTravel takeover | shared.js:15847 | cancel any journey | `movement.cancel` on every convoy command | the convoy owns |
| stopForConvoy | shared.js:15826 | stop all | `stop()` | none |
| navigate | shared.js:15835-15842 | journey start, `on_done` wrap | `smart_move` | journey end |
| convoy town | shared.js:15914, 15927 | Town skill, stop | `town()` | `stop()` |
| convoy.fail / catch | shared.js:15811, 15813, 15965, 15973-15974 | cancel, stop | failure | none |
| setConvoyCruise / release | shared.js:15712, 15720 | speed cap | `cruise()` | `cruise(500)` |
| recoverFarmApproach | shared.js:16156, 16182, 16191 | native move, journey start | direct `move`, `smart_move` | `cancelFarmApproach` stops smart only if `on_done` matches 16053-16054 |
| terrainRecoveryPorts.start / stop | shared.js:16611, 16612 | journey start, stop | `smart_move` with gate owner from the client | `stop("smart")` |
| formation recovery client | formation-recovery-client.ts:99, 84, 37 | gate take, native step, stop | gate empty | `cancel` clears gate, stops if `on_done` matches |
| independentApproachPorts | shared.js:16743-16746, 16749 | journey start, install, tick, cancel | `movement.move` owner `combat-approach:N` | `cancel` only if owner label matches |
| sendCombatMove | shared.js:17152 | native move | none; runs under any journey | `resetCombatMovement` |
| holdFormation | shared.js:16669 | stop move | combat step still walking | none |
| solveFormationMove | shared.js:16955, 17010 | stop move | warrior segment | none |
| resetCombatMovement | shared.js:17131 | stop move | combat step still walking | none |
| separateFromParty | shared.js:17555 | native move | none | none |
| sight recovery | shared.js:17611 | native move (via sendCombatMove) | queue client | none |

`stop("move")` and `stop("smart")` both end the live journey as "Unattributed movement stop"
(runtime/characters/movement.ts:411). A failed `stop("move")` on a `retainOnDirectStop` journey
only pauses it (403-410), and `stop("smart", true)` (15494, 15584, 15662) ends it as a success.
So every combat `stop("move")` above also ends a travel journey that happens to be live.

#### Slice 1.4

| Writer | file:line | Kind | How it gets control | How it gives it back |
|---|---|---|---|---|
| Convoy start | convoy.ts:202-231 | replace (slot) | cancels any active convoy | cancel deletes its commands (133-143) |
| Legacy barrier | convoy-navigation.cjs:27, 56, 64, 126, 134, 143, 175, 240 | command issue | owns the slot | beginLeg deletes commands and clears the slot (232-233) |
| Convoy engage | convoy-navigation.cjs:266-272, 286 | replace and stop | valid report | slot cleared; members get `event-resume-travel` |
| Shared navigation | shared-navigation.ts:37 (from 55, 97, 214, 250, 259, 269, 350, 385, 396), 228, 449, 458, 495, 507 | command issue | owns the slot | terminal hold or completion |
| Communication hold | shared-navigation.ts:203-208 | stop (hold) | communication-recovery.ts:41-43 | resume (209-219) |
| Convoy defense | convoy-defense.ts:79, 94, 185, 223 | stop (hold, defending) | classification | reassemble under a new epoch |
| Merchant pause | merchant-interruption.ts:75-84 | stop (hold) | admission | resume to saved phase (111) |
| Hunt arrival | hunt-arrival.ts:84, 66-68 | stop, then release | inside the area | deletes commands, clears slot |
| Farming engagement | farming-engagement.ts:17-18, 22 | release or defending | leader sighting | slot cleared |
| Arrival recovery | return-arrival.ts:15-20 | release | 3 s verified arrival | deletes commands, clears slot |
| Navigation intents | farming-navigation.cjs:93-94, 114-118 | stop and restart | any new destination or cancellation | restarts convoy for the rest |
| Event return | farming-navigation.cjs:50, 55, 179, 190, 220, 248, 254, 262, 277-279 | start, replace, cancel | return owner | finish releases (61-77) |
| Restart rebuild | restart-recovery.ts:66, 89 | cancel, start | eligible failed convoy | new convoy |
| Escape | party-escape.cjs:39, 23, 47, 76, 81, 87 via recovery-hooks.ts:48-53 | cancel, start | escape start | release (45-48) |
| Death recovery | recovery-hooks.ts:62-64 (called from combat-disengagement.cjs:117-118) | cancel, start | recovery phase | convoy completion |
| Shared walks | shared-walk.ts:193, 204-205, 266, 338, 441-445 | replace, restore, cancel | `canReplace` (186-192) | restores parent commands |
| Command takeover (client) | shared.js:10500-10514 | journey cancel | any new command | none |
| Event walk release (client) | shared.js:10420-10438 | journey stop | terminal event command | role runner wakes |
| Independent walker (client) | shared.js:15081-15096 | journey start and stop | non-leader event walk | `stop('smart')` |

#### Slice 1.5

| writer | file:line | kind | how it gets control | how it gives it back |
|---|---|---|---|---|
| encounterMovement | nav/rare-hunting.ts:522 | convoy start (`rare-hunt`) | no active convoy, 3 s since last | cancelTravel (182) on combat, finish, stop, protected activity |
| cancelTravel | nav/rare-hunting.ts:180-183 | convoy cancel | any purpose `rare-hunt`/`phoenix-patrol` | n/a |
| retainTravelConvoy | nav/rare-hunting.ts:378 | convoy cancel | any non-interruptible convoy at rare start | n/a |
| tickPatrol travel | nav/rare-hunting.ts:651-653 | convoy start (`phoenix-patrol`) | stepPatrol with no active convoy (phoenix-patrol.ts:209) | patrol cancel on arrival (173), failure (149), next region (96), reload (217) |
| farm startPending | nav/farm-areas.ts:93, 95-102 | convoy start (`mission-travel` or `farm-relocation`) | pending relocation after delay, revisions, defense clear | convoy completion or recovery |
| farm recovery | nav/farm-area-recovery.ts:95, 100 | convoy cancel | failed or stale farm convoy | pending retry (105-111) |
| monster-selection select | nav/monster-selection.ts:66-67 | authorize + convoy start (`manual-monster-override`) | dashboard spawn selection | none (handed off to 07) |
| manual travel/town/leader | nav/manual-commands.ts:81, 111, 146 | character command | dashboard command | the character's command handler |
| manual partyTravel | nav/manual-commands.ts:100 | convoy start | online leader | convoy completion |
| retireConvoysForRealmSwitch | app:1714, 1717 | convoy cancel | members left for another realm | n/a |
| cancelHuntConvoy | app:2074-2076, 1791; runtime/coordinator/hunt/controls.ts:55-61 | slot cleared directly (`activeConvoy = null`) | `monster-hunt` convoy | n/a |
| party actions travel | runtime/coordinator/http/party-actions.ts:66 | convoy start (`party-travel` or `party-force-travel`) | dashboard party travel, online leader | convoy completion |
| party actions town | runtime/coordinator/http/party-actions.ts:111-116 | Town cycle and `town-party` commands | dashboard party Town | heartbeat upkeep (MOV-166) |
| pollRareHunting | characters/shared.js:3693 | journey start (`smart_move`) | no rarePath, no convoy flags | cancelRarePath, 30 s timeout |
| cancelRarePath | characters/shared.js:3647 | journey stop (`stop("smart")`) | `smart.on_done` unchanged | n/a |
| bank-stacks travel | runtime/characters/bank-stacks.ts:62 | movement port `p.move(floor)` | bank stacking step | throws if the floor was not reached (63) |
| cave-recovery move | runtime/characters/cave-recovery.ts:206 | approach a dead member | not fighting, not busy, out of skill range (196-205) | next tick |
| warrior approach | runtime/characters/classes/warrior-combat.ts:22 | Dash toward target | target out of range | n/a |
| dungeon canMove | runtime/characters/dungeons.ts:349-351 | journey pause gate | coordinator control in a Cave | fresh control within 3 s |

### 1.7 Ownership stand-ins

Every flag, label, identity check and revision used today in place of a movement owner. The regex scan in `standins-index.json` finds 272 lines on the current console: navigation revision 190, `movementOwner` 26, `smart.on_done` identity checks 14, `isOccupied()` 13, gate owner reads 10, `recoveryStage` 9, `smart.on_done` captures 7, `smart.plot` identity 3. It misses checks written through ports, such as the formation recovery client's (runtime/combat/formation-recovery-client.ts:37).

#### Slice 1.1

Full list: `standins-index.json` (272 lines; command as above, kinds: navigation revision 190,
`movementOwner` 26, `smart.on_done` identity 14, `isOccupied()` 13, gate owner read 10,
`recoveryStage` 9, `smart.on_done` capture 7, `smart.plot` identity 3). The regex misses identity
checks written through ports, such as the formation recovery client's (formation-recovery-client.ts:37).

| stand-in | file:line | what it guards | who sets it | who reads it |
|---|---|---|---|---|
| `journey === j` | movement.ts:66 | late callbacks of a replaced journey | `move()` | `current()` |
| context runtime, revision, current, paused | movement.ts:68-69; shared.js:20-21 | stale runtimes and old navigation intents | shared.js status apply | every tick |
| `options.owner` (convoyId, epoch, commandId, recoveryStage) | movement-host.ts:59 | terminal receipts, approach ownership, diagnostic folding | callers of `move` | movement.ts:338-342, 102, 125; movement-diagnostics.ts:10; shared.js:16679, 16748-16749 |
| `gate.owner` | movement.ts:63, 416-417 | who ticks the journey | Cave dungeon runtime (shared.js:2784), shared rendezvous search (15315), convoy routes (15552, 15691), formation recovery client (formation-recovery-client.ts:99) | `scheduler` |
| `retainOnDirectStop` | movement.ts:403-405 | Cave journeys against combat stops | dungeon runtime | `stop()` |
| `smart.on_done` identity | shared.js:3645, 14503, 14510, 14538, 14639, 15422, 15527, 15637, 16053, 16101 and others | "is the live journey still mine" | the caller after `smart_move` | the same caller |
| `smart.plot` identity | shared.js:15518, 15527, 15637 | convoy route still installed | `move()` writes a new array (movement.ts:391) | convoy ticks |
| `movement.report().owner` absent | shared.js:16708 | approach may replace a journey | journeys started without `owner` | independent approach context |
| `isOccupied()` | runner.ts:90, 131, 291 | combat and support pause | about 25 flags (shared.js:17494-17528) | runner, approach, farm approach |
| `root.partyCombatPosition.movementOwner` | 26 lines in shared.js (14520 to 17618): 24 writes and 2 reads | dashboard label | each mover | approach (16742) and the heartbeat position report (17618) |

#### Slice 1.2

| stand-in | file:line | what it guards | who sets it | who reads it |
|---|---|---|---|---|
| `smart.on_done` identity | 3645, 3698, 11752, 11756, 11764, 14503, 14510, 14538, 14552, 14559, 14639, 14670 | "is this journey still mine" before a stop | captured right after each `smart_move` | the same function's cancel and timeout paths |
| `escapeState` / `escapeOwns()` | 34, 138-158 | escape owns all movement for fighters | status `state.escape` (11204) | handleOwnedCommand (10397), reunionBlocked (13459), isOccupied (17516), many guards |
| `navigationIntent.revision` and `.cancelled` | 10278-10299, shared.js:20 | journeys and tokens from an older selection | status (11207) | movement context (movement.ts:68), reunion, follow, rare, convoy, event checks |
| `farmingTravelToken` | 10409-10413 | a farming travel command is running | handleOwnedCommand | afterCombat (14840, 14848), applyNavigationIntent, localTravelCommand (14169) |
| `convoyTraveling` / `partyConvoyActive` | 383, 11198, 11238, 11248-11255 | a convoy owns movement | createLocalConvoy and status | 153 lines in shared.js (`grep -c convoyTraveling` on the current file) |
| `convoyTraveling.defensePaused` | 14112 | convoy paused for defense | interruptConvoyForDefense | groupedMovement (14567), isOccupied (17505, 17523) |
| convoy purpose lists | 3393, 14087, 14094, 14979 | which convoys may stop or hand off | constants | interruption and hand-off rules |
| `followingLeader` | 17765, 17783 | a follow route runs | followLeaderIfFar | isOccupied (17525), status tick (11299) |
| `forceTraveling` | 10682, 10688, 2454 | force travel or console return runs | handleCommand, consoleMainTick | isOccupied, reunionBlocked, rare, preempt |
| `townTraveling`, `partyTownActive`, `root.__partyTownCycleId`, `root.__partyTownGeneration` | 10701, 11200, 11201, 10702 | Town owns movement | handleCommand, status | Town guard (11090-11091), enforcePartyTownOverride (11034, 11041, 11043) |
| `townOverrideInFlight` | 11044, 11070 | one override pass at a time | enforcePartyTownOverride | Town guard (11094, 11097) |
| `departurePending` | 10700, 11045, 11073, 14841 | departure, Town and afterCombat waits | handleCommand, Town override, afterCombat | isOccupied (17526), follow (17750), the status tick's stock check (11435) |
| `root.__partyEventExitOwner`, `eventReturnPending`, `root.__partyEventRecoveryCycleId` | 10758, 10771, 10311 | event exit owns movement | handleCommand, applyEventReturnOwner | eventExitOwnsMovement (13451-13455) |
| `eventTraveling`, `travellingEventName`, `joinedEvent` | 13387-13388, 13409 | event travel or event combat | pollEvents | reunionBlocked, isOccupied, groupedFarming (14131) |
| `reunion` token, `token.moving`, `reunionWorking` | 13505, 13677, 13717 | reunion owns movement | beginFarmReunion, farmReunionTick | isOccupied (17525), handleOwnedCommand (10403) |
| `rarePath`, `rareControlState` | 3690, 3568 | rare walk owns movement | pollRareHunting, status | isOccupied (17517), groupedMovement (14580) |
| `movement.gate.owner` | 2784, 2786, 2792 | Cave convoy planning gate | dungeonRuntime.move | movement scheduler |
| `root.partyCombatPosition.movementOwner` | 14520, 14619 | label only | groupedMovement | dashboard and approach (slice 1.3) |
| `kiteState.targetId` | 13510, 17755 | kite owns movement | kiting (slice 1.3), beginFarmReunion clears it | followLeaderIfFar |
| `root.__partyCombatOwner` | 17506, 17524 | label only | isOccupied | dashboard |

###### What isOccupied reads (17494-17528, slice 1.3 owns the function)

Counted by reading 17494-17528: 27 checks, counting each flag on 17525 once and
`departurePending` or `bankQueued` as one. 25 of them can return true; two (17504,
17512-17514) only start a convoy defense. The table groups them into 24 rows. Setters found with
`grep -n -E "(^|[^.A-Za-z_])<name> *= *[^=]"` on the current file.

| condition | line | set at | what it suppresses (the role runner tick and grouped movers) |
|---|---|---|---|
| Cave runtime owns | 17495-17496 | dungeon runtime | everything except Cave rules |
| `root.__partyUpgradePreviewInFlight` | 17497 | 2567, 2569 | all combat and movers |
| console maintenance lease | 17498 | 2488, 2493 | all except drain combat |
| `returnCombatActive()` | 17499-17502 | continuous return, anniversary staging, event recovery | only during a Town cast; side effect `cancelReturnTownUnderAttack` (3448-3456) |
| event exit owner and `eventReturnPending` | 17503 | 10758, 10771 | all |
| outbound Hunt extra aggro | 17504 | n/a | side effect `interruptConvoyForDefense` |
| convoy continuous return or Hunt target | 17505-17508 | 15402, 15618, 15785, 15998 (declared at 383) | all; writes `__partyCombatOwner` |
| merchant tidy or lucky slot | 17509 | 9576, 11431 | merchant |
| `travelCombatActive()` | 17510 | farmingTravelToken, `__partyTravelCombat` | all unless departure combat |
| loot client Hunt pending | 17511 | loot client | all unless departure combat |
| convoy and a party attacker | 17512-17514 | n/a | side effect `interruptConvoyForDefense` |
| combat recovery active | 17515 | 14381 | all except phase `finishing` |
| `escapeOwns()` | 17516 | 140 | all |
| rare patrol, loot, path or solo deployer | 17517-17518 | 3568, 3690 | all |
| reunion and not blocked | 17525 | 13505 | all |
| `banking`, `stocking`, `upgrading` | 17525 | 4470.., 3797.., 2561.. | all |
| `forceTraveling` | 17525 | 10682, 2454 | all |
| `townTraveling`, `partyTownActive` | 17525 | 10701, 11200 | all |
| convoy not paused | 17525 | 383 | all |
| `gatheringActive` | 17525 | 10045, 10186 | all |
| `followingLeader` | 17525 | 17765 | all |
| `eventTraveling` | 17525 | 13387 | all |
| `anniversaryBusy` or `anniversaryStaging` without convoy defense | 17525 | 17 and 24 setter lines | all |
| `departurePending` or `bankQueued` | 17526 | 10700.., 11231 | all unless a monster is engaged |

#### Slice 1.3

| stand-in | file:line | what it guards | who sets it | who reads it |
|---|---|---|---|---|
| `smart.on_done` identity | shared.js:15422, 15518, 15527, 15637, 16053, 16101; formation-recovery-client.ts:37, 89 | "the journey is still mine" | `smart_move` (movement.ts:395) | convoy owner ticks, farm approach, recovery client |
| `smart.plot` identity | shared.js:15518, 15527, 15637 | prepared plot not replaced | convoy install | convoy owner ticks |
| `movement.gate.owner` | shared.js:15315-15317, 15552-15553, 15691-15692; formation-recovery-client.ts:36, 96, 99 | who drives the native scheduler | convoy, rendezvous, recovery client | movement.ts:417 scheduler |
| `owner.recoveryStage` label `combat-approach:N` | shared.js:16679, 16743, 16748-16749 | independent approach journey | ports.start | `independentApproachOwnsJourney` read by sendCombatMove 17142, resetCombatMovement 17124, holdFormation 16666, context 16708 |
| convoy lease match (id, epoch, command, runtime, route version) | shared.js:15268-15274, 15513-15515, 15640-15644 | coordinator still authorizes this convoy | coordinator `/status` | barrier, owner ticks |
| `ownsConvoy()` | shared.js:15795-15798 | runtime, revision, `convoyTraveling === convoy`, not defense-paused | createLocalConvoy | every convoy await |
| `navigationIntent.revision` | shared.js:15091, 15106, 16102, 16160 | navigation not superseded | applyNavigationIntent | walks, farm approach |
| `kiteState.destination` vs `going_x/y` within 2 | shared.js:16667-16669, 17128-17131, 17147-17148 | "this native move is combat's" | sendCombatMove | hold, reset |
| `root.partyCombatPosition.movementOwner` | 22 writes in shared.js 16056-17613, for example 16056, 16109, 16672, 17151 | status label only | many | 16742 (re-adopt approach status) and the trace snapshot 17618 |
| `isOccupied()` | shared.js:17494-17528 | about 25 flags | every subsystem | 16087, 16449, 16714; runner tick |
| `terrainRecoveryContext().allowed` | shared.js:16446-16450 | 21 conditions, 14 of them negated flags | n/a | 16509, 16592, 16822, 16912 |
| independent approach `allowed` | shared.js:16714-16719 | 21 conditions incl. `foreignOwned` | n/a | approach client |
| `convoy.handoffPending`, `handoffRetryAt` | shared.js:15384, 15388, 15405-15407, 15587 | one engage request at a time | engagement | engagement |
| `frankyCombatActive()` | shared.js:16757, 17203, 17312 | Franky owns combat movement | event code | formation, kite, approach |
| `returnCombatActive()` | shared.js:17143, 17204 | return defense owns movement | return code | step writer, kite |
| `root.__partyConvoyDefense` | shared.js:16084 | convoy paused for defense | convoy defense | farm approach |
| `formationState.approachIdentity` | shared.js:16333-16336 | corner recovery identity incl. `joinedEvent`, `eventTraveling` | solver | solver |
| `eventCombatDetour.identity` | shared.js:17273-17276 | event detour identity incl. revision | approach | approach |

#### Slice 1.4

| Stand-in | file:line | What it guards | Who sets it | Who reads it |
|---|---|---|---|---|
| `navigationIntents[name].revision` and `cancelled` | farming-navigation.cjs:90, 132 | which destination is current | invalidate, authorize | every command build (shared-navigation.ts:25, convoy-navigation.cjs:7), lostOwner (shared-navigation.ts:101-106), client 10407 |
| Identity tuple: convoy id, epoch, command id, revision, runtime | convoy-navigation.cjs:31-47; shared-route-types.ts:124-131; shared-navigation.ts:107-115, 151-158; shared-route-store.ts:68-74, 147-156; return-town.ts:80-85; convoy-defense.ts:142-143, 152-161; communication-recovery.ts:167-179; terminal-settlement.ts:25-29; shared-walk.ts:414-419 | whether a report belongs to the current command | each writer | 15 functions, each with its own field set: `identity`, `validReport`, `reportMatches`, `scanAssemblyReady`, `rendezvousOwner`, `routeIdentity`, `heldReportMatches`, `returnReportMatches`, `localDefense`, `stoppedReports`, `reportOwned`, `initialAssemblyRuntime`, `initialAssemblyCommand`, `currentReport`, `eventReentryOwner` |
| `c.expected[name]` | shared-navigation.ts:31-32; convoy-navigation.cjs:17-18; convoy.ts:184-189 | expected acknowledgement | command builders | holdRevision (shared-navigation.ts:186-188), heldArrivalOwned, initialAssemblyRuntime |
| `c.runtimes` | shared-navigation.ts:95, 206; hunt-arrival.ts:83 | which runtime owns a member | begin, holds | health (296), reportMatches |
| `navigationExempt` | convoy.ts:223; shared-walk.ts:297 | cancelled intents may keep travelling | exit purposes, return walks | lostOwner 104, authorizedHold 183, intentMatches (shared-route-store.ts:88), sameIntent (merchant-interruption.ts:67) |
| `nonPreemptible`, `force`, `combatHandoffAllowed` | `runtime/coordinator/hunt/convoy.ts`:78 (`nonPreemptible`); convoy.ts:211, 224 | refuse pauses, defense, handoff | convoy creation, shared-walk.ts:299 | merchant-interruption.ts:21, shared-walk.ts:191, shared-navigation.ts:469, 475, convoy-navigation.cjs:255 |
| Purpose strings | convoy.ts:90, 95, 229, 256; travel-defense.ts:139; shared-navigation.ts:539; restart-recovery.ts:60; farming-engagement.ts:40 | what kind of travel this is | callers | eight different purpose lists |
| `party.escape.stage` | party-escape.cjs | escape owns the party | escape | convoy.ts:241, restart-recovery.ts:56, hunt-arrival.ts:14, shared-route-store.ts:126, travel-defense.ts:208, convoy-defense.ts:44, client 10397 |
| Event membership (`activeEvent`, `joinedEvent`, `mapEvent`) | statuses | event owns the member | client | hunt-arrival.ts:26, convoy-defense.ts:38-41, travel-defense.ts:147-150, combat-disengagement.cjs:134 |
| `walkingParents`, walk `sessions` WeakMap | shared-walk.ts:10, 209 | parent command to restore | attach | participantOwned (432-436), restoreParents |
| Phase flags `communicationHold`, `merchantInterruption`, `geometryRepair.phase`, `restartRecovery`, `retryExhausted`, `loot` | convoy object | which recovery owns the convoy | each recovery | each other recovery checks the others (for example merchant-interruption.ts:20-21, hunt-arrival.ts:13-14, shared-route-store.ts:125) |
| `townCycle.pending` | farming-navigation.cjs:145-148 | manual Town barrier | Town command | authorize |
| `arrivalHandoff.releasedCommands` | hunt-arrival.ts:64-65 | late reports after Hunt arrival | stepHuntArrival | travel-defense.ts:230-234 |
| Travel control WeakMap | travel-defense.ts:137, 197-206 | when a member's travel combat started | travelCombatFor | grouped-snapshot.ts:151 |

#### Slice 1.5

| stand-in | file:line | what it guards | who sets it | who reads it |
|---|---|---|---|---|
| `smart.on_done` identity | characters/shared.js:3645, 3698 | rare path stops only its own journey | pollRareHunting after smart_move | cancelRarePath |
| rarePath.id vs control.id | characters/shared.js:3657 | path belongs to the current control | pollRareHunting | pollRareHunting |
| `rareNavigation.failed` | characters/shared.js:3688, 3695, 3700 | stops retrying a failed path for the same control id | pollRareHunting catch and timeout | pollRareHunting |
| convoy purpose `rare-hunt`/`phoenix-patrol` | nav/rare-hunting.ts:181 | which convoy the rare may cancel | convoy start callers | cancelTravel |
| purpose list (6 values) | nav/rare-hunting.ts:124-131 | which member commands a rare may override | command senders | commandProtected |
| purpose list (4 values) | nav/rare-hunting.ts:841 | which travel a passive rare may interrupt | convoy start callers | acquirePassive |
| `interruptibleTravel` deny list (6 purposes plus flags) | runtime/combat/hunt-travel.ts:18-22 | which convoy a new encounter keeps | convoy start callers | retainTravelConvoy (nav/rare-hunting.ts:377) |
| purpose list (null, monster-hunt, farm-relocation, empty-spawn-recovery) | nav/farm-areas.ts:211 | which failed convoys farm recovery owns | convoy start callers | recoverFailed |
| purpose `phoenix-patrol` and phase | nav/phoenix-patrol.ts:172, 216, 225 | patrol owns its convoy | patrol travel | arrived, reconnecting, movementFailure |
| navigation revisions | nav/rare-hunting.ts:166-168; nav/farm-areas.ts:129-131; nav/farm-area-recovery.ts:30 | travel still matches the saved intent | farming navigation | validIntent, processPending, staleFallback |
| rare control `revision` | nav/rare-hunting.ts:891, 907 | client follows only the current intent | coordinator | client rareControlCurrent (fork shared.js:3965) |
| `rareOwns`, `huntOwns`, `eventOwns`, escape stage, member event flags | nav/farm-areas.ts:184, 243, 258, 49-50 | farm relocation does not move a party another owner holds | rare, Hunt, events, escape | farm-areas tick |
| `huntTurnInOwnsTravel` | app:2112-2114, 2002 | Hunt turn-in priority over walks | Hunt policy | solo walks, heartbeat (response.ts:178-181) |
| `controlAt` age 3 s, `movementReady` | runtime/characters/dungeons.ts:349-351 | Cave movement only on fresh coordinator control | dungeon `receive` (331-336) | movement context paused (shared.js:21) |
| `restartRevisions` | nav/initial-commands.ts:19-24, 77 | restored convoy belongs to the pre-restart intents | restoredConvoy | restart recovery (slice 1.4) |

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **MOV-166** Party Town cycle upkeep: the heartbeat drops a pending member whose navigation revision moved on, deletes orphaned town-party commands, and restores a missing command for a member still pending. Code: `runtime/coordinator/status/response.ts` (94-102, 103-109, 110-117 and 118-122, called at 124-126). An escape-owned character gets no command while escape is outside its recovery convoy (125).

## 2. What goes wrong

### 2.0 Root causes

Most findings in 2.1 to 2.5 come back to eight causes. Each line names the findings it explains.

1. **No movement owner (current).** The service keeps one journey (movement.ts:61). `move()` ends it
   before it reads the new request (384) and stops a moving character (392). A bare, `move` or
   `smart` stop ends it for any caller (411), so each of the 102 stop calls can end a journey it did
   not start. Ownership is then
   proven after the fact by `smart.on_done` identity, labels, gate owners, revisions and flags (1.7).
   Explains 2.1 items 1 to 4, 2.2 W2-1 and W2-2, 2.3 W2 and W5, and ledger bugs 7 and 8.
2. **A repeat request is a restart (current).** Asking again for the place the character already walks
   to costs a stop packet, a wait for the character to settle (failing after 5 s) and a new plan
   (movement.ts:237-251, 384, 392). Every
   caller that re-asks on a tick needs its own guard. Explains 2.3 W3 (independent approach re-aims up
   to 4 times a second), ledger bug 3a (pull walk stall) and bug 8, and the fork's move budget and log
   folding (7af248cf, 7ea350fb).
3. **Movers sit in a fixed chain with no owner check (current).** The role runner asks movers in a fixed
   order every 100 ms and takes the first that claims the tick (runner.ts:212-256). The chain has no
   `isOccupied()` check (only the support tick has one, runner.ts:291). Follow and the queue client
   run from two more tick sources (runner.ts:152-157; client.ts:153-154). Modes add movers by
   inserting branches (fork: boss retreat first at runner.ts:239 (fork), pull mode in
   `recoverFarmApproach` and `formationMove`, tank hold in three movers). Explains ledger bug 7 step 6
   and the fork chains in section 3.
4. **One safety check per mode (current, extended by the fork).** `safeCombatPoint` looks only at
   monsters already targeting the character (shared.js:17167-17169). The formation solver and the
   corner, terrain and sight recovery steps check every visible monster, at attack range plus 8 or a
   flat 38 for a monster that outranges the character (16246-16247). The game server's aggro check
   reaches under 64 units on each axis and under 90.5 in a straight line (2.3 W1 item 4). The current
   console has no model of it (`git grep -n -i -E "ghash|aggro.?reach" refs/review/ryan-1.5` returns
   nothing). The
   fork adds a boss zone and a pull-mode idle check as special cases (shared.js:18046, 18048 (fork)).
   Explains 2.3 W1 and W11, 2.2 W2-10, ledger bugs 3d and 4.
5. **One convoy slot with no replacement rule (current).** Each convoy start cancels the active one
   (nav/convoy.ts:202-203); only shared walks write a rule. It lets an event walk replace any convoy
   that is not a shared walk, navigation exempt or non-preemptible (nav/shared-walk.ts:191). On the character, any new command cancels the running
   convoy journey as "Command takeover" (shared.js:10500-10514). Explains 2.4 G1 and G2 and the fork's
   event walk chain (section 3).
6. **Goals copied across state machines (current).** "Safe at Main" is decided by six copies of "within
   65 of Main" (shared.js:197, 218, 238; scripts/combat-disengagement.cjs:87;
   scripts/party-escape.cjs:74, 86) and by other radii in other loops: 90 for Town and event return
   (shared.js:10720, 10801, 10829, 11037), 100 for anniversary staging (11837, 11853, 12207, 12222,
   12233). Escape and death
   recovery each hold their own goal. Explains ledger bug 5 and 2.2 W2-5.
7. **Text and name lists used as interfaces (current).** Regexes on reason text pick the log phase, the
   native fallback and Town disabling (movement.ts:98, 229, 274; nav/shared-navigation.ts:46, which
   skips continuous returns), retry
   classes (nav/farm-area-recovery.ts:71-73; nav/shared-departure.ts:38-42, 57-59) and recovery
   migrations (nav/communication-failure.ts:2-16). Purpose lists disagree (shared.js:3393 vs 14087 and
   14094; nav/rare-hunting.ts:124-131, 181, 841; nav/farm-areas.ts:211; runtime/combat/hunt-travel.ts:19-21).
   The shared.js lists differ (6, 5 and 5 entries), but every shared-walk return is navigation
   exempt, so that gap has no effect today (2.2 W2-6).
   Boss lists disagree (nav/shared-walk.ts:60 names 8, nav/event-pursuit.ts:24 and
   nav/halloween-return-arrival.ts:5 name 3, shared.js:15081 names a different 3). Explains 2.1 item 5,
   2.3 W7, 2.4 G3 to G5, 2.5 items 1 and 2.
8. **Budgets chosen per symptom (current).** The coordinator side has 31 separate timers and retry
   values (2.4 G6) and the client side as many windows (2.3 W8). The list [5000, 15000, 30000, 60000]
   is copied between scripts/farming-navigation.cjs:268 and scripts/combat-disengagement.cjs:113.
   Nothing caps the total time a party may stand still; each recovery restarts its own budget.

### Ledger bugs in this area

| Bug | First wrong decision | Patched? | Chain |
|---|---|---|---|
| 3 Targetron deaths (movement parts) | 3a: `pullWalk` re-issues `movement.move` when its `going_x/y` test fails on every segment but the last (shared.js:18490-18497 (fork)), and `move()` restarts the journey (movement.ts:384, 392). 3b/3c: `choosePuller` picks the longest range, the priest, then the mage (runtime/combat/pulling.ts:21-24 (fork)). 3d: the tank hold releases below 0.5 HP (shared.js:18545 (fork)) and the kite arc is checked against attackers only (current 17167-17169, 17223, 17228). | 3a, 3b, 3c partly by 21b8362d (pull only); 3d none | 2.3, "Bug 3" |
| 4 Fonze tank walk-in | `tankStep` stepped the tank to `min(desiredCombatRange(), 30)` with only `safeCombatPoint` (7bd14d7c, removed in 4075d3f2) | Removed by 4075d3f2; the same terrain-only pattern remains in the current `frankyMovementTick` (17237-17262) and the fork's Franky movers | 2.3, "Bug 4" |
| 5 Hunt stuck after death | The escape stage becomes `complete` at the Blink landing (scripts/party-escape.cjs:91-96) while death recovery waits for Main within 65 (scripts/combat-disengagement.cjs:83-92) | Symptom fixed by ce6e7c1a (fork); adds a seventh copy of the goal (party-escape.cjs:105 (fork)) | 2.4, "Ledger bug 5" |
| 7 Icelocked parked at Mr. Pumpkin | An unattributed `stop` ended the event walk (movement.ts:411; caller unknown without `stopStack`); the mage escort then runs the formation solver in a joined event (shared.js:16781), holds "no safe local detour" (16921-16926) with terrain recovery off in events (16448), and the runner stops at `formationMove` before the event detour (runner.ts:244) | None in any ref | 2.3, "Bug 7" |
| 8 "Movement replaced" every ~100 ms toward winterland | A writer re-issues a non-convoy journey faster than one plan cycle (movement.ts:384; the fold key proves no `convoyId`, movement-diagnostics.ts:10, 13). Four candidates, A to D; the code cannot pick one because `move()` records no replacing caller | 21b8362d removes candidate C for pull walks only | 2.1, "Ledger bug 8" |

Bug 3's priest-heal starvation belongs to 03-turns-and-cooldowns, and its MP-first emergency potion
to 05-survival (shared.js:70-72); both are handoffs, not chained here.

### 2.1 Movement service, planning and the mover chain

1. **A re-issue is a restart (current).** `move()` ends the active journey at movement.ts:384 and stops a
   moving character at 392 before it knows whether the request is the same. Planning then waits for
   the character to settle (237-251) and for an async ALClient reply (196-232). A caller that
   re-issues the same destination faster than one plan cycle keeps the character standing. No
   guard exists in the service; each caller adds its own (`smart.on_done` captures, retry timers
   such as shared.js:14640, 16106, 16193). History of `move` (`git log -L 382,396:runtime/characters/movement.ts
   refs/review/ryan-1.5`): 9fbeadab 09-20, d5279eab 09-25 (reason text and code), 3133e684 09-28,
   a3986593 10-08; none adds a same-destination case.
2. **Any stop ends any journey (current).** movement.ts:411 ends the active journey for every bare,
   `move` or `smart` `stop()`; 102 such calls exist (`writers-index.json`). 27d7dbeb (10-01,
   `git log -L 403,413`) added the Cave exemption `retainOnDirectStop` and the `stopStack`
   diagnostic. Inference: both treat the symptom, which is that callers that stop "their" walk end
   other owners' journeys.
3. **Ownerless journeys look free (current).** `independentApproachPorts.context` treats a journey as
   foreign only when `movement.report().owner` exists (shared.js:16708). `smart_move` callers that pass
   no options (follow shared.js:17776, farm approach 16191, regroup 14670, rare path 3693, legacy
   convoy `navigate` 15835 when not a continuous return) start journeys with no owner, so the
   independent approach may replace them. Inference: the replaced caller then sees its
   `smart.on_done` capture fail and restarts after its own delay.
4. **Two writers inside the executor (current).** `retryStoppedWalk` re-sends the travel segment 250 ms
   after the character stops (movement-executor.ts:122-129, e421d54e 09-22). Combat steps
   (`sendCombatMove`, shared.js:17152) are native moves outside the journey. Inference: a combat stop
   and the executor's re-send can race. `pause()` exists for that hand-off (28-36), but combat movers
   do not call it; it runs only on a paused context, a server correction or a retained Cave stop
   (movement.ts:76, 377, 408).
5. **Text as an interface (current).** The log phase (movement.ts:98), the native fallback decision (229)
   and Town disabling (274) use regex on error text; executor Town rejection uses another regex
   (movement-executor.ts:177). A new error wording changes behaviour.
6. **Replacement logs the wrong destination (current).** The "Movement replaced" line prints `state`
   before `move()` overwrites it (movement.ts:384 runs before 391), so it shows the replaced journey's
   destination; the new one is only in `failureContext.replacement`.
7. **Mover chain with no owner check (current).** `movementTick` (runner.ts:212-256) has no
   `isOccupied()` gate, `followLeaderIfFar` runs from target selection outside the chain
   (runner.ts:152-157), and the queue client ticks two more state machines from a timer and socket
   events (client.ts:149-154). Three tick sources drive movers for one character.
8. **Wrong value check: Cave-only budget pair (current).** `nativePlanningProgress` throws unless the
   values are exactly 240000 and 90000 for a shared journey (movement.ts:35); the option is a
   Cave special case encoded as a magic pair, not a rule.
9. **Repair chain history (current).** movement.ts and the executor took 20 commits from 2026-10-08
   to 10-18. The repair and rejoin ones are 5 on 10-08 (a3986593, 60f5f367, 79a1d9f5, 8638cd78, and
   0dc887ec in the executor), then 7f73aca3 and b3062d58 10-12, 5dc12b4b 10-13, 3839c760 10-14 (`git log --format='%h %ad %s' --date=short refs/review/ryan-1.5 --
   runtime/characters/movement.ts runtime/characters/movement-executor.ts`). Comments at
   movement.ts:293-295 and 365-366 name the cause: combat moves the character under a live journey.

#### Ledger bug 8

Symptom (2026-10-26 10:47-10:50 UTC): "Movement cancelled; Movement replaced by a new destination"
about every 100 ms for two fighters, destination winterland, plus "ALClient found no route", during
Monster Hunt routing. No log was available to this review; the chain below is what the code proves
and what it allows.

What the code proves (the current console; the fork does not change these lines, `git diff refs/review/ryan-1.5
HEAD -- runtime/characters/movement.ts` touches only fork lines 15, 50-54, 443 and 446, which replace ref lines 437 and 440):
1. The text comes only from `move()` (movement.ts:384). The phase "Movement cancelled" comes from the
   regex `/replaced/` (98). Every line therefore marks one call of `smart_move` or `movement.move`.
2. The printed destination belongs to the journey being replaced (384 runs before 391). Lines that
   all show winterland mean every replaced journey was heading to winterland.
3. Diagnostics fold a repeated key for 10 s (movement-diagnostics.ts:13). The key uses `convoyId`
   when the replaced journey had an owner with one, otherwise the journey id (10), and every journey
   has a new id (movement.ts:394). Convoy journeys carry `convoyId` (`sharedMovementOptions`,
   shared.js:15252), so a stream of convoy replacements prints once per 10 s with "Similar messages".
   A line every 100 ms therefore means the replaced journeys had no `convoyId`: plain `smart_move`
   calls or `recoveryStage` journeys.
4. "ALClient found no route" is `UnreachableGoalError` when both points are on prepared maps
   (alclient-adapter.ts:41); winterland is a transporter place, so it is prepared (22). The worker
   returns it as `failure: 'unreachable'` (planner-worker.ts:21, http/movement.ts:10). With
   `rejectUnreachableGoal` the journey fails with that text (movement.ts:193); without it the journey
   falls back to native search and logs "Trying native pathfinding" with that reason (103, 194).
   On the current console only the independent approach sets `rejectUnreachableGoal` (shared.js:16743); the
   fork adds `pullWalk` (shared.js:18496 (fork)).

What follows: one writer, or two alternating writers, issued non-convoy journeys toward winterland at
the tick rate, and no journey lived long enough to plan.

Candidates, each with what it needs to fit:
- **A. Two plain writers alternating (current).** Writer X replaces writer Y's journey; Y's
  `smart.on_done` capture fails, Y restarts and replaces X. A 100 ms rhythm needs both to restart
  without a delay. The role-tick writers on the current console all delay: regroup 5/15/30 s
  (shared.js:14640, 14674), farm approach 1 s (16106, 16193), rare path only when `rarePath` is null
  (3689), follow serialized by `selecting` (runner.ts:159, 182, 193). Follow re-runs on every
  `wake()`, and `wake()` fires on each coordinator combat response (client.ts:99); responses arrive
  about every 100 ms while position changes (client.ts:134-135 includes x and y in the report
  signature). Inference: follow (leader in winterland) restarting on each wake after its await
  rejects, against any second writer, fits the cadence. Check: `failureContext.replacement` equals
  the leader position; journeys have no `owner`.
- **B. Independent approach against an ownerless journey (current).** The approach re-aims at most every
  250 ms (independent-approach-client.ts:22) and cancels its own journey first (21), which logs
  "Individual combat approach cancelled", not "replaced". It replaces another journey only when that
  journey has no owner (shared.js:16708). It needs a same-map target, so the character must already
  be in winterland. Check: lines alternate with "Individual combat approach cancelled"; replacement
  is near the target; `recoveryStage: combat-approach:N` on the new journey.
- **C. Pull walk (fork, af92de45).** `pullWalk` calls `movement.move` every tick when its
  `going_x/going_y` test fails (shared.js:18490-18497 (fork)), which it does after `move()` stops the
  character. It passes `rejectUnreachableGoal: true`, so an unreachable spot logs "ALClient found no
  route" as a failure. It needs the party inside winterland (same-map only). 21b8362d keeps a pull
  route already heading to the point and adds a stall release (shared.js:18513-18524 (21b8362d)).
  Check: `recoveryStage: "pull"` in the replaced journey's `failureContext`; replacement on the
  character's own map.
- **D. Coordinator command churn (current).** Each new convoy command cancels the running journey as
  "Command takeover" (shared.js:10500-10514) with code `command-takeover` or `convoy-phase-change`,
  not "replaced". Hunt route recovery cancels the convoy before it issues a new one
  (runtime/coordinator/hunt/route-recovery.ts:169, 238, 249, 262; owned by 07). Convoy journeys fold by `convoyId` (point 3).
  So D alone does not produce 100 ms "replaced" lines; it can start the chain by ending the convoy and
  leaving a plain writer (A) in charge. Check: a `command-takeover` line just before the stream.

Log fields that separate them: `failureContext.replacement` (new destination and map),
`failureContext.recoveryStage` and `convoyId` of the replaced journey, `elapsedMs` (about 100 ms),
the journey id sequence (`<name>:<runtime>:N`), the code (`destination-replaced` vs
`command-takeover` vs `combat-approach-cancelled`), and `planner`/`searches` (0 searches means
replaced before planning). The service does not record the replacing caller, unlike stops
(`stopStack`, movement.ts:411); that missing field is why this bug cannot be closed from code alone.

Patch status: none on the current console. 21b8362d fixes candidate C for pull walks only. No caller
attribution on replacement exists in any ref.

### 2.2 Character movers in shared.js

##### W2-1 Town guard: a 100 ms stop loop stands in for a Town owner
Chain:
1. The status tick runs every second and, while `partyTownActive` is set, starts the guard
   and one override pass (11256-11261).
2. The guard stops any moving smart route and native move every 100 ms (11094-11099).
   Its comment says why: "A stale smart_move closure can restart itself between dashboard
   polls" (11092-11093). The service has no owner check, so any mover that wakes during
   the Town cast can start a journey (movement.ts:382-396).
3. The guard itself broke Town once, recorded in its own comment: "The old watchdog
   stopped it every 100ms, causing repeated 'Path found' messages and tiny two-step
   movements" (11087-11089). The fix adds two skip flags: `townTraveling` (11090) and
   `root.__partyTownCycleId` (11091).
4. `enforcePartyTownOverride` refuses to create a fallback route because "it can survive a
   cancelled channel and reclaim movement from this hard override" (11062-11064), and
   keeps `departurePending` asserted "preventing combat/follow logic from reclaiming
   movement" (11071-11073).
Root cause: Town has no claim on the movement slot, so three flags and a polling stop
loop keep other movers out. History: both functions appear only in 9fbeadab
(2026-09-20) (`git log -L 11078,11102:characters/shared.js refs/review/ryan-1.5`), so
the failures in the comments predate the public history.

##### W2-2 Every stop ends any journey, and most stop callers here do not check whose it is
`stop()` ends the active journey whatever started it (movement.ts:411). In the slice 1.2
writer table, 21 writers stop or cancel with no identity check: applyEscape (143,
156-157), applyNavigationIntent (10297-10298, guarded only by "one of four flags was
set"), applyEventReturnOwner (10322), event-walk-release (10431), command takeover cancel
(10510), town-party (10707-10709), event-return-town (10788-10789), status rare handoff
(11219-11220), status convoy end (11252), event disable (11281, 11291), follow off
(11303), enforcePartyTownOverride (11050-11054), Town guard (11095, 11098),
anniversaryReturnToTown (11842), preemptConvoyForAnniversary (11945, 11947),
acceptRareCombatControl (3578), dungeonRuntime.stop (2808), beginFarmReunion (13511),
on_magiport (13568, 13579), interruptConvoyForDefense (14113, 14122) and groupedMovement
inner radius (14633). Four more check their own token or operation, not the journey:
anniversaryApproach (11796), the Goobrawl exit (11721), cancelFarmReunion (13521) and
farmReunionTick (13610-13716). Six functions check `smart.on_done` first: cancelRarePath
3645, eventReturnRouteToMain 11764, cancelGroupRoute 14503, cancelFightRoute 14510,
cancelEncounterCatchup 14538 and encounterCatchup 14552. The reunion
`finally` stops smart on every exit while the reunion is current and unblocked (13716); a
journey another mover started during the reunion's await ends with it (inference: the
blockers in 13456-13472 cover the common owners, not combat or formation steps).

##### W2-3 Timeouts that let the old journey keep running
`anniversaryWithTimeout` rejects after its deadline but leaves the movement promise alive
(11802-11822). Escape's walk to Main (239) uses it with no stop after it, so after the 20 s
timeout the journey keeps moving until something else replaces it. The reunion walk
(13709) uses it too, but its `finally` stops smart while the reunion is current and
unblocked (13716), so only a blocked or superseded reunion leaves that walk running. `marketplaceMove`
documents the same problem and adds its own double stop: "smart_move's underlying
promise can remain alive after our deadline" (8790-8796).

##### W2-4 Callers patch movement service arrival
`commerceMove` treats being within 35 of the NPC as arrival because "smart_move can remain
pending when asked to path to an NPC whose destination point we already occupy"
(7741-7749). `previewTravel` adds the same 35-unit check (2500). The service resolves NPC
names (movement-destination.ts, slice 1.1); the arrival gap is fixed in two callers instead.

##### W2-5 Four copies of "safe at Main" with three radii
Within 65 of (0,0): escape (197, 218, 238). Within 90: town-party (10720), event return
(10801, 10829) and Town override (11037). Within 100: anniversary staging (11837, 11853,
12207, 12222, 12233). Found with `grep -n -E "hypot\(\s*(Number\()?character\.x|townPoint\.x"`
on the current shared.js. Each loop decides arrival on its own radius, so a character at
80 from (0,0) is home for Town and not home for escape. The 90 check at 11017 is the
current map's spawn, not Main, and the 65 check at 245 is the escape destination.

##### W2-6 Purpose lists disagree
`passiveTravelInterruptible` protects six purposes including `shared-walk-return`
(3393). `coldConvoyDefenseAllowed` (14087) and `interruptConvoyForDefense` (14094) protect
five and omit it, and the combat hand-off (14979) protects two. The difference has no
effect for shared-walk returns: the coordinator creates them navigation exempt
(nav/convoy.ts:223, 244; nav/shared-walk.ts:297), and all three checks refuse exempt
convoys (3392, 14086, 14094). Each check still keeps its own list and its own exempt rule,
so a new purpose has to be added in four places.

##### W2-7 Regroup re-sends the same native step every tick
While the regroup made progress in the last 3 s, each movement tick sends `move()` toward
the same cached waypoint (14643-14659). The runner movement tick runs every 100 ms
(runner.ts:339), so the same step is re-sent about ten times a second until the
character is within 8 of the waypoint. After three failed smart routes the regroup holds
for the rest of the grouped key (14662-14663): "regroup route failed after three
attempts; holding new pulls". Only a new `groupedCombat.key` or revision resets it
(14592-14595).

##### W2-8 Rare navigation failure has no retry
When a rare `smart_move` fails, `rareNavigation.failed` stays set for that control id and
`pollRareHunting` returns true on every poll (3688), which keeps rare movement owning the
character without moving it. The 30 s route timeout sets the same flag (3699-3700).
History: the fork rewrites this branch with a 5 s retry (fork, shared.js:4127-4137 at
HEAD, comment "a walk stopped mid-fight would ..."). The current console has no retry.

##### W2-9 Command dispatch can overlap (inference)
The status tick calls `handle(state.command)` without awaiting it (11419). A command does
not run twice: every await between the guard at 10419 and the `lastCommand` write at
10498 is merchant-only, and the guard is checked again after them (10483). The overlap is
earlier. For fighters `handleOwnedCommand` awaits `cancelFarmReunion` (10403) before it
sets `farmingTravelToken` (10411). If a second tick arrives during that await, the later
of the two calls replaces the token of the call that is already travelling, returns at
10419, and clears the token in its `finally` (10413). The running travel then has no
token, so `afterCombat` and `localTravelCommand` stop seeing it (14840, 14169).
Inference: no log in this review shows it.

##### W2-10 Escape retreat step ignores idle monsters
The rescue wait step picks the cardinal step farthest from the nearest monster, checked
only by `can_move_to` (281-285). It does not use `safeCombatPoint` or any aggro range. The
game server attacks a player from every untargeted aggressive monster in the 3x3 block of
32-unit cells around it that faces the player within 45 degrees (adventureland_mongodb
16881a2: node/server.js:14394-14405, 15263-15265; node/server_functions.js:1203-1216). A
40-unit step can move that block onto an idle pack (inference from geometry; ledger bug 5
context).

##### Ledger bugs touching this slice
- Bug 5 (Hunt stuck after death): the recovering stage here walks to Main within 65
  (218, 236-239). The stuck part is in party-escape.cjs and combat-disengagement.cjs
  (slice 1.4). This slice adds W2-3: the 20 s timeout at 239 leaves the walk running.
- Bug 7 (Icelocked parked at Mr. Pumpkin after an "Unattributed movement stop"): stop
  callers in this slice that can run during an event walk are the event disable stops
  (11281, 11291, when an event selection changes), applyEventReturnOwner (10322),
  applyNavigationIntent (10297, only if farm, convoy, follow or force owned movement),
  the reunion's blocked stop (13610, which fires when event travel starts under a moving
  reunion) and the follow-off stop (11303). The reunion `finally` stop (13716) cannot fire
  then, because `eventTraveling` blocks the reunion (13470). groupedMovement does
  not run in events: `groupedFarming` is false while `eventTraveling`, `joinedEvent` or on
  an event map (14131-14132). The `stopStack` in the logged failure names the caller
  (movement.ts:411); this review has no log to match.
- Bug 8 (Movement replaced every 100 ms toward winterland): no writer in this slice
  re-issues `smart_move` on a 100 ms cadence. Escape (239) is awaited behind
  `escapePulseBusy`, reunion behind `reunionWorking`, regroup behind `groupRegroup.route`,
  follow behind the runner's `selecting` guard and `character.moving` (17757), encounter
  catch-up behind `c.encounterCatchup`. The command takeover cancel (10510-10513) fires
  once per new command id.

### 2.3 Convoy client, farm approach, formation and combat steps

##### W1. Step safety ignores monsters that are not attacking yet (current)
1. `safeCombatPoint` skips every monster whose `target` is not this character
   (shared.js:17167-17169) and limits the rest to their attack range (17172).
2. Kiting (17223, 17228), event corner steps (17196), approach (17325), event detours (17278,
   17288, 17297) and farm local approach and detours (16154, 16177, 16181) check no other
   monster. The event detour legs add `eventApproachLegSafe`, which reads attackers only
   (17299-17310).
3. Only the formation movers see idle monsters: the solver through `formationStepSafe`
   (16662-16663), corner recovery through `formationSegmentSafe` and the risk sum (16313,
   16376-16432), terrain recovery (16458-16467) and sight recovery through
   `formationRecoverySafePoint` (16630-16638). They keep attack range plus 8 (16247), or a flat
   38 from a monster that outranges the character and does not target it (16246).
4. The game's aggro check reaches under 64 units on each axis and under 90.5 in a straight line,
   and always covers 32 on each axis (32-unit grid, 3x3 cells: node/server.js:14404, 15263;
   node/server_functions.js:1203-1216 at kaansoral/adventureland_mongodb 16881a2; see the game
   rule comparison in section 1.3). The monster must also face the player within 45 degrees
   (server.js:15265).
5. Inference: a `safeCombatPoint` step can end inside an idle monster's aggro cells, because it
   checks no idle monster. A formation step can too whenever its clearance (range + 8, or 38) is
   under the grid reach, which holds for every monster with range under 82.
History: `safeCombatPoint` is unchanged since 9fbeadab (2026-09-20) (`git log -L 17157,17174:characters/shared.js refs/review/ryan-1.5`).

##### W2. A combat "stop move" ends whatever journey is live (current)
1. Combat sends native moves while a journey stays installed (`sendCombatMove` 17152, no journey
   check other than the independent label at 17142).
2. `holdFormation` (16668-16669) and `resetCombatMovement` (17129-17131) call `stop("move")`
   when the character still walks to combat's last step. The warrior branches (16954-16955,
   17009-17010) call it whenever the character moves and a warrior segment is recorded, with no
   destination check.
3. `stop("move")` finishes the live journey as "Unattributed movement stop" (movement.ts:411).
   A journey started with `retainOnDirectStop` only pauses (movement.ts:403-410).
4. Result: a travel journey that was live under combat steps ends with no owner named. The
   `going_x` guard protects only against stopping a journey that replaced the combat step
   (test "holding preserves a destination owned by newer navigation").

##### W3. Independent approach restarts its journey to re-aim (current)
1. The client re-issues a pending direct journey when the predicted point moves more than 12
   units and 250 ms passed (independent-approach-client.ts:22-28).
2. `issue` cancels the old journey as "Individual combat approach cancelled" (21;
   shared.js:16749), and `start` calls `movement.move` again (shared.js:16743).
3. `move` sends a stop packet if the character is moving (movement.ts:392).
4. Result: a direct chase against a moving target is stopped and restarted up to 4 times a
   second.
Added in 218f57a8 and patched eight more times within seven days: 218f57a8, 873b3129, 7b12777f, 1e8f90de, ca6f9af7, d1e6ff46
(10-13), d009eb22 (10-14), ebd90011 (10-18), adaa5ce3 (10-19)
(`git log -L 16700,16753:characters/shared.js refs/review/ryan-1.5`).

##### W4. The convoy leader must not move 1 unit while combat runs (current)
`sharedConvoyRendezvous` fails the leader on any drift over 1 unit (15328), and the route
install rejects a rally over 1 unit from the route origin (15440). Combat steps during
rendezvous move the leader (W2). The fork's a85b9509 adds a 10 s `xmove` back within 55 units
(shared.js:16192-16197 (fork)). e2e/live-hunt-town-recovery.spec.ts checks that recovery does
not repeat "Leader moved from planning origin".

##### W5. Preparation fails when anything else touches the journey (current)
The shared and legacy preparation ticks fail with "Shared route ownership lost" or "Prepared
route ownership was lost" when `smart.on_done` or `smart.plot` changed (15527, 15637). Any other
`smart_move` (follow, rare, regroup) during the up to 60 s preparation fails the convoy instead
of being refused. 11 commits each on `prepareSharedConvoyRoute` (shared.js:15409-15561)
and `coordinatedMonsterTravel` (15793-16003), the first commit 9fbeadab included (`git log -L` on
each line range, the current console).

##### W6. The mage escort holds forever in a blocked event (current, bug 7 core)
See ledger bug 7. The solver runs for the mage in a joined event (16781 excludes only
`eventTraveling`), terrain recovery is disallowed in events (16448), and the blocked hold
(16921-16926) returns before the event-only detour in `approachCombatTarget` (17321, 17327) can
run, because the role runner stops at `formationMove` (runtime/characters/roles/runner.ts:244).

##### W7. Purpose lists and text as interfaces (current)
- Two lists of interruptible travel: hunt-travel.ts:19-21 and rare-hunting.ts:841, with
  different members.
- Farm handoff purposes (shared.js:15379), the `shared-walk` regex (15788), the event-walk key
  list (15081), and `franky-exit` special cases in two places (15493-15495, 15579-15586).
- `/stale convoy completion/` regex on an error text (15172).

##### W8. Fixed windows chosen per symptom (current)
Shared walk 180 s (15103); rendezvous 120 s (15316, 15326, 15331); first-lease grace 3 s (15520);
route install 60 s (15531); departure tolerance 1500 ms (15545, 15681; comment 15542-15544 says it
covers coalesced browser timers); movement lock 10 s (15829); Town 5 s and 12 s (15906, 15916);
ack backoff 1/2/5/10 s (15178); barrier 10 s (15281); farm approach 1.5 s, 3 s, 10 s, 30 s
(16125, 16129, 16169, 16145, 16103); corner progress 1.5 s (16343); recovery client 30 s
(formation-recovery-client.ts:90); recovery retries 5 s then 15 s, 3 attempts
(formation-recovery.ts:53-55); sight recovery 8 s and 6 steps (sight-recovery.ts:25).

##### W9. isOccupied is a query with side effects (current)
`isOccupied` cancels a return Town (17500) and interrupts convoys for defense (17504, 17514) each
time any caller asks. Its comment records a past fault: releasing the role loop during a convoy
"caused QwenTina's one-step search/restart loop" (17519-17522). 12 commits touched it, the first commit
9fbeadab and one merge included (`git log -L 17494,17528:characters/shared.js`).

##### W10. Duplicated constants and defaults
- The healing coverage formula `range - min(20, max(8, range * 0.1))` appears 8 times
  (`grep -c "Math.min(20, *Math.max(8" shared.js` on the current file: 16318, 16412, 16517, 16541,
  16556, 16637, 16645, 16796).
- A missing monster range defaults to 20 in clearance (16241) and the defensive trigger (17646)
  but to 30 in step safety (17172) and event legs (17307).

##### W11. Movers with no safety check (current)
Franky approach checks terrain only by design (17253-17255). `separateFromParty` sends a raw
`move` with no terrain or monster check (17555).

#### Ledger causal chains: bugs 3, 4 and 7

##### Bug 3: party deaths in Targetron farm (fork pull mode and tank hold on the current movers)

3a. Pull walk stalls on competing moves.
1. Each 100 ms movement tick reaches `recoverFarmApproach` (runner.ts:237), which runs
   `pullMovementTick` after only the anniversary and defense checks when there is no target
   (shared.js:16936-16947 (fork)), or `formationMove`,
   which runs `pullHoldsForArrival` first (17637 (fork)).
2. Both call `pullWalk` (18514, 18521, 18529 (fork)).
3. `pullWalk` treats the walk as live only when `going_x/y` is within 12 of the final point
   (18490 (fork)). A planned route walks segment by segment, so that test fails on every segment but
   the last.
4. It calls `movement.move` again (18495-18497 (fork)).
5. `move` finishes the live journey as replaced and sends a stop packet if moving (movement.ts:384,
   392). Planning waits while the character is moving (movement.ts:237-241).
6. The next tick replaces the journey before a plot installs, so the puller stands still. The
   death-fix comment records 400 s (18520-18521 (df)).
Patches: 754a9179 moved clear lines to native `move` (18492-18493 (fork)); 21b8362d keeps a live
`pull` journey and adds a stall release (18513-18524 (df)). Step 5 still applies to every other
`movement.move` caller (W3).

3b. Puller alone.
1. `choosePuller` picks the longest range of at least 100 (pulling.ts:21-24 (fork)); in a priest
   party that is the priest (inference from class ranges; the full review says the same).
2. The puller walks to range - 10 from the target, away from the spot (pulling.ts:88-90 (fork)).
3. Everyone else holds at the spot (18514 (fork)) and keeps holding until the pulled monster is
   within max(120, range) of the spot (18528 (fork)).
4. The healer fights alone outside its party until the monster arrives; any add it meets on the
   way finds no help.
Patch: 21b8362d holds pulls while the tank or a priest is dead and releases the hold when the
monster stops short (18540, 18565-18567 (df)). The priest is still the default puller.

3c. Mage becomes puller after the healer dies.
1. `choosePuller` drops dead members (pulling.ts:22 (fork)), so the mage is next.
2. At HEAD nothing requires a living healer before a pull (18510 (fork)).
Patch: 21b8362d `pullSupported` with `pullRequiredMembers` (18447-18454, 18540 (df)).

3d. Tank kites into packs below 50 percent HP.
1. `tankHoldsTarget` releases below 0.5 HP (18545 (fork)); with an off tank active it returns
   false at once because `aggroTank()` names the off tank (18543 (fork), tank-handoff.ts:15-22
   (fork)).
2. With the hold released, `formationMove` no longer bypasses the solver (17644 (fork)) and
   `kiteIfNeeded` kites the tank's target (18099-18100 (fork)).
3. The kite arc and outward step are checked by `safeCombatPoint` (current 17223, 17228), which looks
   only at attackers (17167-17169). The idle-reach check applies only in pull mode (18048 (fork)).
4. The arc can enter an idle neighbour's aggro reach (W1, inference from geometry). More attackers
   keep HP under 0.8, so the hold stays released (18546 (fork)).
Patch: none at HEAD or 21b8362d.

Handoffs inside bug 3: the priest's basic attacks starving heals belongs to 03-turns-and-cooldowns
(attack-controller.ts, `basicAttackReserved`); the emergency potion drinking MP first belongs to
05-survival (shared.js:70-72).

##### Bug 4: Fonze tank walk-in (fork)
1. 7bd14d7c (2026-10-20, port of Fonze e5a48112) added `designatedTankHolds`, `tankStep` and
   `tankMovementTick` (`git show 4075d3f2 -- characters/shared.js`, removed lines).
2. `formationMove` returned false for a holding tank whenever `tankStep` returned a step or a
   hold, or there was no target, so the
   priest formation stopped placing the tank (removed line in 4075d3f2 at formationMove).
3. `approachCombatTarget` called `tankMovementTick`, which stepped toward `min(desiredCombatRange(),
   30)` from the target, a near-melee "stack range" even for a ranged tank (removed `tankStep`).
4. Each step passed only `safeCombatPoint` (removed line `if (safeCombatPoint(point, target))`),
   which ignores idle monsters (current 17167-17169).
5. The tank walked into the pack and pulled it onto the party.
Patch: 4075d3f2 (2026-10-24) replaced it with `tankHoldsTarget`, so the tank approaches to its own
range; 0f600a8f the same day keeps the formation bypass only while the line is clear. The same
pattern remains in the current `frankyMovementTick` (17237-17262) and the fork's
`frankyTankMovementTick` (18222-18244 (fork)): terrain-only steps.

##### Bug 7: Icelocked parked out of range at Mr. Pumpkin
Assumption: Icelocked is a mage in a party with a priest (inference; the full review says mage
escort). The logged `stopStack` was not available.
1. A stop ended the live event walk journey: any `stop("move")`, `stop("smart")` or `stop()`
   finishes it as "Unattributed movement stop" (movement.ts:411). A failed `stop("move")` on a
   `retainOnDirectStop` journey only pauses it (403-410).
2. The joined mage then runs the formation solver: `mageEscort` excludes only `eventTraveling`
   (shared.js:16781), and the runner reaches `formationMove` after farm recovery
   (runner.ts:236-244). `recoverFarmApproach` returns false in events (16087), so it does not
   claim the tick. `groupedMovement` runs first (runner.ts:236) but does not claim the tick in events: grouped farming is off while `eventTraveling`, `joinedEvent` or on an event map (shared.js:14131-14132, slice 1.2).
3. With adds near Mr. Pumpkin, `recoverFormationCorner` finds no detour whose segments keep every
   add's clearance (range + 8, 16247) and returns `{blocked}` (16440).
4. Not chased, the solver holds "no safe local detour; waiting for an opening" (16921-16926).
5. `proposeTerrainRecovery` does nothing because terrain recovery is disallowed while
   `joinedEvent` (16448, 16509).
6. `formationMove` returns true, so the runner never reaches `kiteIfNeeded` or
   `approachCombatTarget` (runner.ts:244-251), where the event-only detour lives (17265-17298,
   17321, 17327).
7. Nothing else moves the mage while the adds stay, so it stays out of range.
Patch: none in the current console, the fork or 21b8362d.

`stop()` callers in the current shared.js that can run during a joined event walk
(`grep -n -E "(^|[^a-zA-Z_.])stop\("` mapped to enclosing functions with the function index: 102 matches, 3 of them comments, so 99 call lines, one of them `stop("invis")`; the table covers
67 of them):

| caller | line | fires for a joined mage at Mr. Pumpkin? |
|---|---|---|
| holdFormation | 16669 | yes, when the mage still walks to its last combat step (step 2-4 above) |
| resetCombatMovement | 17131 | yes, same guard; called by solver target change (16804) and many movers |
| solveFormationMove warrior branches | 16955, 17010 | no, warriors only |
| applyNavigationIntent | 10297-10298 | yes, on any navigation revision change |
| applyEventReturnOwner | 10322 | yes, when an event exit owner retires |
| handleCommand town-party, event return | 10707-10709, 10788-10789 | yes, on those commands |
| enforcePartyTownOverride / maintainTownOverrideGuard | 11050-11054, 11095-11098 | only under a party Town override |
| status tick: rare handoff, cancelled convoy, event disable | 11220, 11252, 11281, 11291, 11303 | event disable (11281, 11291) yes, when the event is deselected or ends |
| eventReturnRouteToMain, pollEvents | 11765-11766, 13296, 13324 | yes, at event return or anniversary preemption |
| farm reunion | 13511, 13521, 13610-13716 | no, reunion is blocked in events (reunionBlocked, slice 1.2) - not verified here |
| applyEscape | 143, 156-157 | yes, on escape |
| rejoinActiveEventAfterRespawn | 13738 | yes, at event re-entry after a respawn |
| sharedPartyWalk lone walk | 15093 | no, `mrpumpkin` is not in the key list (15081) |
| convoy fail, takeover, stopForConvoy, town | 15813, 15826, 15927, 15965, 15974 | yes, when an event shared walk runs as a convoy that fails or is replaced |
| cancelFarmApproach, cancelGroupRoute, cancelFightRoute | 16054, 14504, 14511 | only when their `on_done` capture still matches |
| terrainRecoveryPorts.stop | 16612 | no, terrain recovery is disallowed in events |
| merchant callers (5317-10208) | n/a | no, merchant only |

Not assessed for this bug (32 call lines): 594, 642, 837, 840, 3578, 3647, 10431, 11111, 11721,
11797, 11842, 11945, 11947, 11974, 12012, 12151, 12152, 12297, 12550, 13568, 13579, 14113,
14122, 14538, 14552, 14633, 15401, 15494, 15584, 15616, 15662, 17661.

Which one fired needs the `stopStack` field of that log entry (movement.ts:411).

### 2.4 Coordinator convoys, shared walks and escape stages

##### G1. One convoy slot, replaced without a rule
Every convoy start cancels the active one (convoy.ts:202-203). `start` checks only the escape (241-242) and the leader's report (247, 251). The callers decide on their own: navigation changes restart convoys (farming-navigation.cjs:114-118), event returns start one only when the slot is free (179) and retry only when it is free (231), restart rebuild starts one (restart-recovery.ts:89), death recovery cancels travel and starts its own (combat-disengagement.cjs:117-118). Shared walks are the only caller with a written rule, and that rule lets any event walk replace any ordinary convoy, including an outbound Hunt convoy (shared-walk.ts:191); only a Hunt return is non-preemptible (`runtime/coordinator/hunt/convoy.ts`:78). On the character side any new command cancels the running convoy journey (shared.js:10500-10514). Patched by: none at source; each caller adds a "slot is free" or "is mine" check. History: shared-walk.ts has 17 console commits (`git log --oneline refs/review/ryan-1.5 -- runtime/coordinator/navigation/shared-walk.ts | wc -l`), six on 2026-10-09 alone (ea49a71a, aef9643d, b159f3f6, 9acb1e6f, e0e5e3d2, 3bb52c1f; `git log --format='%h %ad' --date=short refs/review/ryan-1.5 -- runtime/coordinator/navigation/shared-walk.ts | grep -c 2026-10-09`), three of them (aef9643d, 9acb1e6f, e0e5e3d2) about which walk owns the party after a runtime turnover or restart.

##### G2. Ownership is a tuple compared in fifteen functions
The same question, "does this report belong to the command I issued", is answered by fifteen separate functions listed in the stand-ins table, each with a different field set. Examples: `localDefense` and `reportOwned` compare the runtime against `combatSelection.runtimeId` only (convoy-defense.ts:143, 159), while `characterRuntime` falls back to `convoyNavigation.runtimeId` (shared-route-types.ts:133-135); `identity` in the legacy barrier accepts a convoy with no `c.expected` (convoy-navigation.cjs:34), `heldArrivalOwned` requires one (shared-route-store.ts:137), and `reportMatches` never reads it (shared-route-types.ts:124-128). Inference: a client that publishes the runtime only in `convoyNavigation` passes the protocol 4 checks and fails the defense checks. Not confirmed by a test.

##### G3. Reason text used as an interface
- `disableFailedTown` (shared-navigation.ts:44-47): the comment on line 45 says "Interrupted casts use the map-local round counter, never a text match", and line 46 disables Town on `/town/i` in the failure reason for every convoy that is not a continuous return. On those convoys any route failure whose text contains "town", for example a client failure "Town transition did not complete", turns Town off for the rest of the convoy. hunt-return-regression.test.cjs:53-69 covers only the continuous-return exemption.
- `recover` picks geometry repair by `/game geometry mismatch/i` (line 234); `routeFailureCode` by a prefix (586-588); `recoveryPlanner` switches planner on three regexes (shared-departure.ts:38-42); `preparationChanged` lists seven message prefixes (shared-departure.ts:57-59).
- `communicationReason` and `capturedCommunicationFailure` parse failure text, including the composed "Return route held after two planning cycles" message (communication-failure.ts:2-16); `legacyCompletionFailure` matches `POST /convoy-complete · network` (communication-recovery.ts:11).
- `intent` ignores a saved cancellation with reason "monster focus cleared" during Hunt (farming-navigation.cjs:11-13).
- `reconcile` reads the client reunion phase name `waiting-for-party-near-farm` (farming-navigation.cjs:225-227).
A message wording change in any producer silently changes recovery behaviour.

##### G4. Compatibility branches with no end
- `communicationReport` accepts a `route-ready` report from "older clients" (communication-recovery.ts:143-148).
- `step` maps an "older interruption" resume phase `communication-hold` (shared-navigation.ts:452-454).
- `legacyCompletionFailure` and `capturedCommunicationFailure` migrate saved failures (communication-recovery.ts:7-16, communication-failure.ts:7-16).
- `location` keeps a branch for "legacy cycles" with no waypoints (farming-navigation.cjs:32-34).
- `recoveryVersion = 2` marker (runtime.ts:32).
- `step` rewrites `continuousReturn` and `navigationExempt` for anniversary staging on every tick (shared-navigation.ts:436).

##### G5. Boss lists disagree
`sameWalk` treats 8 bosses as moving (shared-walk.ts:60: mrgreen, mrpumpkin, horseman, franky, icegolem, snowman, slenderman, crabxx). `eventTravel` pursues 3 (event-pursuit.ts:24), `halloweenExit` uses 3 (shared-walk.ts:309), `returnArrivalRadius` uses 3 (halloween-return-arrival.ts:5), and the client's independent walk list is a different 3 (`slenderman, trickortreat, witchcipher`, shared.js:15081). A walk to Franky or the Ice Golem coalesces at the leader's frozen point but never follows the boss (inference from the lists; whether those bosses move far enough to matter is not checked here).

##### G6. Thirty-one separate timers and budgets
Each phase and each recovery has its own number (31 values below, one of them a copy): legacy 30 s / 120 s / 20 s / 65 s / 60 s / 60 s / 4 s (convoy-navigation.cjs:109, 162, 149, 224, 221, 225); protocol 4 30 s / 120 s / 60 s / 60 s / 30 s / 30 s / 60 s / 3 s / 500 ms (shared-navigation.ts:172-178, 301, 347, 407, 274, 561, 321); regroups 2 or 1 (592); return rebuild [5000, 15000, 30000] (526); restart rebuild [5000, 15000, 30000] (restart-recovery.ts:86); event return retry [5000, 15000, 30000, 60000] (farming-navigation.cjs:268) copied into death recovery (combat-disengagement.cjs:113); communication 5 s / 30 s (communication-recovery.ts:88); merchant pause 60 s (merchant-interruption.ts:24); observation 5 s (convoy-defense.ts:101); engagement 15 s (240); event retarget 20 s (event-pursuit.ts:19); walk grace 20 s, request window 10 s (shared-walk.ts:45, 160); client walk 180 s (shared.js:15103); arrival settle 3 s (return-arrival.ts:14). No owner decides how long a party may stand still in total; each budget restarts in the next recovery.

##### G7. The 1 unit origin rule fights combat drift
The route origin must be within 1 of the leader and the rally (shared-route-store.ts:93), and any member more than 1 from its recorded origin before departure re-prepares (shared-departure.ts:51; legacy convoy-navigation.cjs:196). Combat steps, kiting and server corrections all move a character during preparation (slice 1.3 area). Each re-preparation costs a stop, a new epoch and new commands (shared-navigation.ts:349-350). Patched by: fork a85b9509 on the client (leader walks back, below).

##### G8. Continuous return can wait without a deadline
`prepareContinuousReturn` returns true while any member lacks Hunt return protocol 2 (continuous-return.ts:60-63), and `bootstrap` then returns at once (shared-navigation.ts:391) before the legacy barrier, which holds the assembly timeout (convoy-navigation.cjs:109), ever runs. Inference: a member stuck on an older client holds the Hunt return in `assemble` with "Waiting for Hunt return protocol 2" indefinitely. No test covers it: `git grep -n "protocol 2" refs/review/ryan-1.5 -- scripts/tests` finds one assertion on the wait message (hunt-return-regression.test.cjs:76) and none on a timeout. Every current client reports protocol 2 (shared.js:2904), so the wait needs a member on an older script.

##### G9. A heartbeat gap stops a moving convoy
A member report older than 3 s, or a missing attacker list, makes classification `waiting-for-observations` (travel-defense.ts:25-32, 99-100), which holds the whole convoy in `observing` (convoy-defense.ts:212, 74-81) until 5 s of stopped held reports (97-102). The test "missing and stale observations explicitly stop a moving route and resume without inventing a fight" confirms the stop is intended. On protocol 4 convoys the communication check runs first in the tick (shared-navigation.ts:437) and takes the same gap: a stale report or a stale attacker list (communication-recovery.ts:136-137) holds everyone in `communication-hold`, which resumes after 5 s of stable held reports and at most once per 30 s (communication-recovery.ts:88). The `observing` hold is left for a member that reports no attacker observation at all (communication-recovery.ts:151-153). Inference: on a slow link every gap over 3 s costs a full stop plus at least 5 s, and a second gap within 30 s of a resume waits out the rest of that 30 s.

##### G10. Escape success is named `failed-hold`
A successful recovery convoy ends in stage `failed-hold` (party-escape.cjs:85-87). The recovering stage starts a convoy to Main (0, 0) when everyone already stands within 65 of it (lines 73-76, recovery-hooks.ts:52-53), so the party assembles and plans a route to where it is.

##### G11. Events freeze other owners
Convoy defense is off while any member is in an event (convoy-defense.ts:38-41); Hunt arrival is blocked (hunt-arrival.ts:26); death recovery stops ticking (combat-disengagement.cjs:134). Each owner reads event membership itself, and none of them knows when the event releases the member.

##### Ledger bug 5: Hunt stuck after a death escape (causal chain)

1. A party death starts death recovery; if the encounter cannot be finished it calls escape (combat-disengagement.cjs:77-81, 68-76; hook recovery-hooks.ts:59). Current console.
2. The mage Blinks to the best landing on its current map, sorted by monster risk, then the map's Town spawn first, then distance from the mage (shared.js:160-188, 250-257). The landing can be any door exit or transporter point on that map. Current console.
3. The coordinator accepts the landing as the escape destination (party-escape.cjs:91-94) and advances warrior and priest by arrival within 65 of that landing (95-96). On the priest's arrival the stage becomes `complete` (96). This is the first wrong decision: "complete" means "at the landing", while the owner that waits for it means "at Main".
4. `step` returns immediately for `complete` (party-escape.cjs:61), so the coordinator never moves the escape on.
5. On each character, `escapePulse` returns for `complete` (shared.js:208), so nothing walks; `handleOwnedCommand` defers every command while the escape owns the character (shared.js:10397-10398), so no other owner can move it either. Survival pulses still run (shared.js:190).
6. Death recovery sits in `recovering` and waits for `safe`: every member fresh, alive, stopped with a settled movement report, at 50% HP, on Main within 65 and with no threats (combat-disengagement.cjs:83-89, checked by `recover` at 90-92).
7. Only `recover` releases the escape, and only after `safe` passes (combat-disengagement.cjs:94-97). No other automatic path releases it: a navigation change that fails `current` releases it (131-133), and so do player actions such as a manual travel command (manual-commands.ts:78) or a Hunt mode change (`runtime/coordinator/hunt/mode.ts`:59, 75). The Hunt retreat restart needs stage `recovering` (`runtime/coordinator/hunt/retreat-restart.ts`:56-58), so it does not apply. The party stands at the landing at full HP with the message "Waiting for respawn and safe regroup at 50% HP" (line 91) indefinitely.

Fork fix ce6e7c1a (2026-10-25, party-escape.cjs:96-107 (fork)): when the death recovery owns the escape and the landing is not on Main within 65, the priest's arrival moves the escape to `recovering` instead of `complete`; `recovering` already walks every member to Main (shared.js:209-241) and ends through the recovery convoy. It fixes the symptom for death recoveries and leaves manual escapes completing at their landing. It does not fix the cause: two owners (escape and death recovery) each hold their own goal, and the fix adds a seventh copy of the Main within 65 check (party-escape.cjs:105 (fork)). 21b8362d does not touch these files (`git -C pm-worktrees/pta-pull diff af92de45 21b8362d --stat`).

Every copy of the "Main within 65" goal on the current console (`git grep -n -E "<= ?65|> ?65\b" refs/review/ryan-1.5 -- characters/shared.js scripts/*.cjs runtime/`):
- characters/shared.js:197 (warrior defense outside Main within 65)
- characters/shared.js:218 (recovering: already safe)
- characters/shared.js:238 (recovering: walk to Main when farther than 65)
- scripts/combat-disengagement.cjs:87 (`safe`)
- scripts/party-escape.cjs:74 (`recovering` ready)
- scripts/party-escape.cjs:86 (`recovery-convoy` arrived)
Not the same goal: shared.js:245 and party-escape.cjs:52 measure 65 to the escape landing, not to Main. The fork adds party-escape.cjs:105 (fork).

Two more dead ends on the same path (the design pass names them UP-2 and UP-3; both are on the current console):
- **The walk to Main gives up and nothing restarts it (UP-2, second path).** In `recovering`, a character off Main walks home through `eventReturnRouteToMain` with a 180 s deadline (shared.js:232). That walk tries at most 4 legs (11748), ends a leg after 15 s without 10 units of progress (11760), and then throws "Exit to Main stalled or exhausted; request Escape again" (11771). The catch sets `local.recoveryFailed` (233), and every later pulse returns at once while it is set (210). The coordinator's `recovering` and `recovery-convoy` stages are exempt from the escape deadline (party-escape.cjs:65, 70) and `recovering` only waits for every member on Main within 65 (72-77). So the party waits until a player acts. The fork's ce6e7c1a sends more death recoveries into `recovering`, so it reaches this wait more often.
- **A respawn after the event ended does not return to the farm (UP-3).** `rejoinActiveEventAfterRespawn` returns `cancelled` when an event rejoin is still required (`__partyEventRejoinRequired`) but no combat event is active any more (shared.js:13724-13726). Death recovery calls `rejoinFarm` only for `not-applicable` (runtime/characters/roles/death-recovery.ts:48), so a `cancelled` result ends recovery as "recovery-cancelled" (49-50) with no farm return.

### 2.5 Rare, Phoenix and farm travel, manual commands, coordinator wiring

1. **Purpose strings stand in for ownership, and the lists disagree.** Four lists decide which
   travel a rare may take: commandProtected (nav/rare-hunting.ts:124-131) accepts
   `empty-spawn-recovery`, `rare-hunt` and `phoenix-patrol` but not `party-travel`; acquirePassive
   (841) accepts `party-travel` but not `empty-spawn-recovery`; cancelTravel (181) cancels only
   `rare-hunt` and `phoenix-patrol`; retainTravelConvoy (377) keeps what the `interruptibleTravel`
   deny list allows (runtime/combat/hunt-travel.ts:18-22). Farm recovery has a fifth list
   (farm-areas.ts:211). A new
   convoy purpose has to be added to each list by hand. Inference: the disagreement on
   `party-travel` and `empty-spawn-recovery` is not documented as intended; question 1 below.
2. **Failure text decides retries.** Farm recovery classifies transient failures by a regex over
   the convoy failure text (nav/farm-area-recovery.ts:71-73). A failure message reworded in the
   convoy code changes the retry budget and whether a zone is abandoned. Rare hunting decides
   retry evidence by a regex over its own finish reasons (rare-hunting.ts:268). History:
   farm-area-recovery.ts has 2 commits, 9fbeadab and 829b85ba 2026-09-22 "complete Hunt recovery"
   (`git log --oneline refs/review/ryan-1.5 -- runtime/coordinator/navigation/farm-area-recovery.ts`).
3. **A failed rare path never retries (the current console).** Chain: pollRareHunting marks
   `rareNavigation.failed` on a rejected `smart_move` or after 30 s (characters/shared.js:3694-3701)
  , then for the same control id it returns true without moving (3688), then an encounter or loot
   control keeps one id for its life (nav/rare-hunting.ts:883), then the fighter stands still, and
   because the function returns true the role runner treats it as handled (inference from the
   runner chain, slice 1.1), then the coordinator ends the encounter only after 30 s without a sighting or progress,
   or 5 min (497-503). The 30 s timeout also ends legitimate cross-map walks. The fork's own
   comment records the effect: a walk stopped mid-fight "would keep the leader from ever
   reaching its loot" (fork shared.js:4127-4129). Patched only in the fork (3849a095).
4. **Phoenix fallback budget is per region, not per point.** `fallbacks` resets only on region
   entry (nav/phoenix-patrol.ts:88) and the 4-fallback cap (156) covers every point in the
   region. Arrivals that run out of points spend the same counter (187). A region with several blocked
   points is marked incomplete after the fourth fallback even when other points were never tried
   (inference from the code; no test covers two blocked points in one region).
5. **Restart compatibility branches.** restoredCommunication keeps two legacy failure shapes
   (`capturedCommunicationFailure`, `legacyCompletionFailure`, nav/initial-commands.ts:38-45) that
   convert old saved failures into communication holds, and forces route protocol 4 on every
   restored convoy (68). These branches stay as long as old saved state might exist. History:
   4 commits incl. 51eb5324 2026-09-23 "recover disconnected hunt convoys" and d5279eab
   2026-09-25 (`git log --oneline refs/review/ryan-1.5 -- runtime/coordinator/navigation/initial-commands.ts`).
6. **Fixed Town and home points.** Manual Town walks to main (-174, 121) (nav/manual-commands.ts:114)
   and merchant home to main (0, 0) (132). The "within 65 of Main" predicates measure from (0, 0)
   (scripts/combat-disengagement.cjs:87; scripts/party-escape.cjs:74, 86). (-174, 121) is 211.9
   units from (0, 0), so the manual Town destination lies outside every 65 radius, and the
   merchant home point is inside it.
7. **Farm relocation asks owners through flags.** Before dispatch, farm-areas checks rareOwns,
   huntOwns, eventOwns, the escape stage, event return and per-member event flags
   (nav/farm-areas.ts:184, 243-245, 258, 42-52), and relies on navigation revisions for event
   attendance (comment 287-289). Each new owner of party movement needs another check here.
   History: b782a64e 2026-10-18 "relocate incompatible farming focus after event return".

## 3. Fork differences

What the fork (af92de45) and the death fixes (21b8362d) add or change in movement, and what each addition patches. The fork's functions are not in the current function index, so they are described here and not claimed.

### 3.1 Movement service, planning and the mover chain

`git diff --stat refs/review/ryan-1.5 HEAD -- <slice files>`: move-budget.ts +71 (new),
movement-diagnostics.ts +12/-3, movement-host.ts +5/-1, movement.ts +8/-2, roles/runner.ts +13/-9 (`git diff --numstat`).
- **Move budget** (7af248cf, 10-15): `host.move` goes through a budget of 40 moves per 4 s and waits
  250 ms while the server call cost is at 150 or more; a newer move supersedes a waiting one, which
  resolves as `interrupted` (move-budget.ts:5, 20-26, 28-31, 51-63 (fork); movement.ts:50-54 (fork)).
  It guards the server disconnect at 200 call cost (move-budget.ts:1-3 (fork)). The fork comment's
  cost of 2.5 per move matches the game server (kaansoral/adventureland_mongodb 43b2c8fc): every call
  adds 1 (node/server.js:4980, stored as 1 at node/server_functions.js:5446), and `CC.move` adds 1.5
  to the same entry (server.js:249, charged at 5018-5019). So 40 moves cost 100, half the limit of 200
  (server.js:262). Inference: it
  patches the symptom of re-issue loops (What goes wrong 1), not their cause.
- **Diagnostic folding** (7ea350fb, 10-15): code `combat-approach-cancelled` folds per character for
  60 s (movement-diagnostics.ts:4-7, 25-28 (fork)). It hides the independent approach's
  cancel-and-restart churn.
- **Runner** (45344db5 10-19, d6f67a97 10-20, 62ab06e5 10-24): `frankyMovement` becomes
  `bossMovement` keyed on `bossCombatActive`; `bossRetreatTick` runs before `groupedMovement`
  (runner.ts:238-239 (fork)); passing targets are off during boss attendance; `root.partyPulling` is
  installed for pull mode. Only `bossRetreatTick` adds a mover to the fixed chain (What goes wrong 7);
  `bossMovement` keeps the place of `frankyMovement`, and runner.ts never calls `root.partyPulling`.
- **21b8362d** changes only runner.ts in this slice: an occupied character still drinks an HP potion
  below 50% (runner.ts:289-302 (21b8362d)).

### 3.2 Character movers in shared.js

From `git diff refs/review/ryan-1.5 HEAD -- characters/shared.js`, hunks inside this
slice's functions:
- Phoenix split search: `startRarePath`, `pollRareSearch` (fork 4049-4088), `rareSearchKind`,
  `rareUnderAttack` (fork 3970-3977), `rareActive` converge exception (fork 3978-3990),
  `pollRareHunting` dispatches search, converge and engage kinds to `pollRareSearch` and
  retries failed encounter routes after 5 s (fork 4089-4139). Commit 3849a095. It patches
  W2-8 for its own kinds and adds hold radii 30, 100 and 200 (fork 4074).
- `isOccupied` holds for search kinds unless attacked (fork 18738).
- `passingTarget` excludes `search` instead of `patrol` (fork 3696).
- `returnCombatActive` also holds during console Pause (`consolePauseHolds`, fork
  3652-3658); `isAttackingPartyMember` treats passing encounters as threats while paused
  (fork 14846).
- Status tick reads `designatedTank`, `offTank`, `pullMode` (fork 11953-11955) and
  `avoidMonsters` (fork 12111-12112). The tank and pull fields feed slice 1.3 movers.
- `dashToward` and `skillTargetAllowed` use `bossCombatActive` in place of
  `frankyCombatActive` (fork 14798, 18970).
- `defensiveFormationMove` skips the tank while `tankHoldsTarget` (fork 18863) and the
  routine exports `bossRetreatTick` and `pullModeActive` (fork 18797, 18860).
- Nomination returns nothing in pull mode (fork 15117-15118).
- handleCommand: cosmetics commands never take movement (fork 11163-11169); Ron buy and
  prim stack merchant jobs (fork 11266-11269, 11280-11281).
21b8362d changes no function this spec claims in this slice
(`git -C pm-worktrees/pta-pull diff -U0 af92de45 21b8362d -- characters/shared.js`). Its hunks
change `escapePotions` (fork 69-75: below half HP any class drinks HP first; spec 05) and
the tank hold and pull code (fork 18438-18565, slice 1.3).

### 3.3 Convoy client, farm approach, formation and combat steps

Hunks from `git diff -U1 refs/review/ryan-1.5 HEAD -- characters/shared.js` inside this range:

| fork change | lines (fork) | hooks into (current) | commit | what it patches |
|---|---|---|---|---|
| Leader origin return `xmove` up to 55 units, 10 s | shared.js:16188-16199 | sharedConvoyRendezvous 15327-15328 | a85b9509 | W4 drift fail |
| Pull mode hands farm travel off on sight | shared.js:16246-16251 | convoyHandoffReachable 15376-15380 | 8dec6e68 | convoy walking into the first monster's range |
| Pull mode tick before convoy and occupancy checks | shared.js:16943-16946 | recoverFarmApproach 16066-16089 | 62ab06e5 | farm search moving the party |
| `pullHoldsForArrival` first, boss combat check, tank line-clear bypass | shared.js:17637-17644 | formationMove 16755-16758 | 62ab06e5, 0f600a8f | formation pulling the tank off its target |
| Boss zone and pull idle-reach checks | shared.js:18046-18048 | safeCombatPoint 17159 | b5a7c68c, 754a9179 | W1, only for avoided bosses and pull mode |
| Tank does not kite its own target | shared.js:18099-18100 | kiteIfNeeded 17209 | 4075d3f2 | tank kiting off target |
| Franky door flee, tank and off-tank routines, `bossMovementTick` | shared.js:18128-18353 | frankyMovementTick 17237-17262 | d6f67a97 (Fonze port) | The current single Franky approach |
| `approachCombatTarget` body moved to `engageMovementTick` | shared.js:18402-18426, 18550-18553 | approachCombatTarget 17311-17334 | d6f67a97 | shared by Franky tank |
| Tank hold, pull mode, `aggroTank` | shared.js:18428-18548 | the above | 4075d3f2, 0f600a8f, ae116693, 62ab06e5, 754a9179 | bug 3, bug 4 |
| Tank skips defensive kiting | shared.js:18862-18863 | defensiveFormationMove 17638 | 4075d3f2 | tank evading |
| Rare search kinds in isOccupied | shared.js:18738 | isOccupied 17517 | 3849a095 | Phoenix split search |
| `bossRetreatTick` inserted first in the movement chain | runner.ts:239 (fork); shared.js:3759-3913 (fork) | runner.ts:236, before `groupedMovement`; the Franky slot at runner.ts:223 becomes `bossMovement` (runner.ts:225 (fork)) | 45344db5, b5a7c68c | avoided bosses |

Fork movers (assignment b):
- **Tank hold** (shared.js:18428-18548 (fork)). `tankHoldsTarget` holds while the tank is the
  aggro tank and its HP stays above 0.5, re-holding at 0.8 (18433, 18542-18548). While it holds,
  `formationMove` returns false when the line to the target is clear (17644), so the tank uses
  the ordinary kite/approach, `kiteIfNeeded` does not kite the tank's own target (18099-18100) and
  defensive kiting is skipped (18863). `aggroTank` reads the skill runtime's off-tank answer
  (18538-18541); `offTankActive` takes over when the main tank is endangered or under 0.5 HP and
  hands back at 0.8 with nothing on it (tank-handoff.ts:5, 7, 15-22 (fork)).
- **Pull mode** (shared.js:18434-18530 (fork), pulling.ts (fork), aggro-pull.ts (fork)). The
  party waits at a staging spot 160 units from the nearest idle focused monster, outside every
  idle monster's 96 + 24 reach (pulling.ts:11-13, 51-62, 36-48; shared.js:18474-18483). The
  longest-range living member with range at least 100 pulls (pulling.ts:15, 21-24); it walks to a
  point at range - 10 from the target along a path clear of the others (pulling.ts:82-95) and
  attacks while the monster has no target (shared.js:18506, 18516-18519). The others hold at the spot until the pulled monster is
  within max(120, range) of the spot (18524-18530). `pullWalk` uses a native move on a clear line
  and `movement.move` owner `pull` otherwise (18484-18501). Hooks: recoverFarmApproach,
  formationMove, safeCombatPoint, convoyHandoffReachable. `areaPullAllowed` limits Agitate to
  monsters that come anyway, unless a member other than the tank is attacked or the off tank
  takes over (aggro-pull.ts:22-27).
- **21b8362d** changes only the pull section in this range (`diff` of shared.js 16100-18100 (fork)
  vs 16102-18102 (df) is empty): `pullModeActive` yields to escape (18441-18444 (df)); pulls wait
  for the tank and every priest alive (`pullRequiredMembers`, `pullSupported`, 18447-18454,
  18540, 18545 (df)); members stand at their own place round the spot (`pullPlace`, 18497-18504
  (df)); `pullWalk` keeps its own live `pull` journey (18515, 18522-18524 (df)) and cancels it and
  returns false when `trackPullWalk` sees no progress (18513-18518 (df)); the arrival hold
  releases when `trackPullHold` sees the monster stop short (18565-18567 (df)).
- **Franky movers** (shared.js:18128-18353 (fork), d6f67a97, a Fonze port). Tank routine: terrain-only
  approach and hold in range (18222-18244). Off-tank: chase last known position for 30 s, wait at the
  "eastmost door of the most common destination" corner (18128-18146), flee through that door with
  `transport` and come back after 3 s (18165-18218), stack at min(desired, 30) with 25 units of
  spacing (18318-18348). All steps check terrain only. Hooks: approachCombatTarget, formationMove,
  kiteIfNeeded, runner `bossMovement` (runner.ts (fork) diff).
- **Boss retreat** (shared.js:3759-3913 (fork)). Zones of radius 64 x sqrt(2) (about 90.5) + 1.5 s of boss walk (+40 for
  aggro above 0.99) (3781-3811); the tick walks to the cheapest point on 8 rings of 40 units that
  no zone reaches within 2 s, preferring healing coverage, the farm area and open space
  (3862-3884); it yields while `smart.moving` or a non-paused convoy runs (3894-3895). It is the
  first mover in the chain (runner.ts:239 (fork)) and sends `sendCombatMove` (3910).

### 3.4 Coordinator convoys, shared walks and escape stages

`git diff --stat refs/review/ryan-1.5 HEAD` over the slice 1.4 files shows changes only in shared-walk.ts (38 lines added, 2 removed) and party-escape.cjs (11 added, 1 removed); the other fork changes in the folder are in slice 1.5 files.

- **ce6e7c1a** party-escape.cjs: `strandedRescue` (fork 100-107), see bug 5. Patches the current stage choice at 96.
- **Event walk replacement chain** in shared-walk.ts, each patching the one before:
  - b0c4d1ef (2026-10-20, port of Thefonze c6569ced): a failed event walk no longer answers or resists walks to a different event (`otherEventAfterFailure`). Patches the current `canReplace` line 189 and `retainedFailure` line 347, which answered every event walk with the old failure after a member left Mr. Green while Mr. Pumpkin was live.
  - 029f590b (2026-10-20): moves the rule into `failedLegReplaceable` (fork 194-195) to keep lint complexity at 12. No behaviour change.
  - 5c504443 (2026-10-23): `retireRecoveredRealmLoss`, `realmLostEntry`, `realmRecovered` (fork 385-399), called from `submit` (fork 494). The current `health` fails a walk as `realm-lost` with no regroup (shared-navigation.ts:295) and `retainedFailure` then answers every resubmit; the fork retires the failed walk once everyone is back on the route realm.
  - 653238e1 (2026-10-24): `otherEventAfterFailure` also waits until no fresh member is still joined to the failed event, after b0c4d1ef let the leader walk to Mr. Pumpkin alone and die (commit message, US II 2026-10-24 23:20 UTC). Fix on b0c4d1ef.
  - c5eacf1b (2026-10-24): the hold covers only members whose live selection moved to another event (`stillJoined` fork 364, `requested` set fork 360). Fix on 653238e1, which broke the current Cipher-interrupts-Green spec.
  Root cause the chain works around: the current walk keeps one failure per event on the single convoy slot (G1) and `eligible` silently drops members joined to another event (shared-walk.ts:118). Two of the five fix an earlier commit in the chain (653238e1, c5eacf1b) and one is a lint refactor (029f590b).
- **a85b9509** (2026-10-24, characters/shared.js `sharedConvoyRendezvous`, fork lines 16188-16198): a leader that drifted more than 1 but at most 55 from the planned origin walks back with `xmove` (10 s limit) before the origin check, instead of throwing "Leader moved from planning origin". Patches the current 1 unit rule (G7) on the client; the coordinator rule at shared-route-store.ts:93 and shared-departure.ts:51 is unchanged. The client edit belongs to slice 1.3's area; listed here because the rule it patches is coordinator-side.
- 21b8362d: no changes to slice 1.4 files.

### 3.5 Rare, Phoenix and farm travel, manual commands, coordinator wiring

- **Phoenix split search (3849a095, 2026-10-20, ported from Fonze).** The current console moves every scan leg as
  one party convoy (nav/phoenix-patrol.ts:208-209; client cancels its path for patrol controls,
  characters/shared.js:3652). The fork gives each fighter its own region and walks it alone:
  `stepSearch` and `assign` pick the nearest unchecked region by planned route per free fighter
  (fork nav/phoenix-patrol.ts:56-69, 162-196), a fighter absent over 10 s loses its leg (71-79),
  a 30 s stall or a reported route failure skips the point (111-112, 134-141), assignment retries
  after 5 s with no route (193) and a planner call over 20 s is abandoned (67). On the client,
  `pollRareSearch` walks with `startRarePath` (fork shared.js:4049-4059, 4062-4088); it stops when
  a monster targets the fighter (4063), holds at 30 units for search, 200 from a seen Phoenix,
  100 otherwise (4074), waits for the coordinator on a failed search point and retries converge
  routes after 5 s (4081-4085). The coordinator adds a converge stage that holds fire until every fresh
  member is within 300 units of the Phoenix, or until a deadline of at least 300 s that grows to
  twice the slowest planned trip (fork nav/rare-hunting.ts:49, 53, 486-531).
  What it patches: the current single-convoy patrol. It runs beside the current design rather than through
  it: the fork deletes the current convoy-leg tests, including "short scan legs use a convoy and
  obsolete local failures cannot cancel it" and "Steam runtime reload retries the same waypoint
  without consuming geometry fallback attempts" (`git diff --stat refs/review/ryan-1.5 HEAD --
  scripts/tests/phoenix-patrol-regression.test.cjs`: 164 lines changed, mostly removed).
- **Encounter and loot path retry (3849a095).** `pollRareHunting` retries a failed encounter or
  loot path after 5 s (fork shared.js:4127-4133), which fixes finding 3. Its timeout branch
  sets `failed` without `at` (4136), so `Number(undefined || 0)` makes the 5 s wait at 4131 pass
  at once and the next tick starts a new path immediately: a 30 s walk that times out restarts
  with no pause.
- **rareActive exceptions** for converge and engage fights (fork shared.js:3978-3990) and the
  `rareSearchKind` flag (3970-3972) feed isOccupied (slice 1.2).
- 21b8362d does not change rare or Phoenix movement (`git diff af92de45 21b8362d --
  characters/shared.js | grep -i -E 'rare|phoenix'` is empty).

## 4. Tests today

Each test is labelled with what it proves, what it does not cover, whether it reads as accurate, and whether it only guards a patch. The test lists per behaviour are in `catalog/02-movement.json`.

### 4.1 Movement service, planning and the mover chain

All in `scripts/tests/` on the current console; names verified present (`node` check over part1.json, 0
missing).
- `movement-service.test.cjs` (80 tests, `git show refs/review/ryan-1.5:scripts/tests/movement-service.test.cjs | grep -c -E "^test\("`): unit fixture with a fake
  host and manual `smart_move_logic` ticks. It covers planning, fallback, repair, Cave drift, Town,
  leave, barriers, terminal receipts, corrections. Accurate for the service contract. It does not
  cover two callers competing as a fault. The one test that starts a second owner's journey (line
  872) expects it to replace the first, and the stop tests (lines 261, 275, 365) expect every stop to
  end the journey; line 365 expects "Unattributed movement stop". No test checks what a foreign
  `stop()` does to an owned journey. Several tests guard Cave patches (drift repair, retained
  endpoints, `retainOnDirectStop` at 550-646).
- `native-planner-progress`, `native-planner-slice-budget`: budgets and the hidden-tab hook. Accurate;
  unit only.
- `return-planner`, `planner-geometry`, `cgoo-planner`, `daisy-door-routes`, `native-interior-edge`,
  `movement-endpoint-attachment`, `geometry-identity-cache`: route validation. planner-geometry,
  cgoo-planner and daisy-door-routes use processed game fixtures (17083, 17175, 17665); the others
  name no game version. Accurate against those versions; they do not cover newer geometry.
- `movement-barrier`, `transition-barrier-latency`, `barrier-communication`: coordinator barrier rules.
  Accurate.
- `shared-convoy.test.cjs` geometry repair tests: mixed-build reload.
- `combat-movement.test.cjs` Franky attendance (per class): proves the Franky mover claims the tick and
  suppresses farming movement. The runner chain order as a whole has no test.
- `combat-handoff.test.cjs` native position events: proves socket events trigger a report; not that
  movers stay stable under the extra ticks.
- e2e: `live-cave`, `live-hunt-town-recovery` and the native observers exercise the service end to end
  but were only located by grep, not mapped test by test (gap).

### 4.2 Character movers in shared.js

All `scripts/tests/*.test.cjs` on the current console, read not run.
- party-escape (MOV-035 to MOV-039): 22 tests cover landing choice, rescue order, warrior skill
  order, potion pulses and recovery travel. They prove the escape state machine with
  stubbed skills. They do not cover monsters near the retreat step (W2-10) or the 20 s
  timeout leaving a journey alive (W2-3). Accurate for what they claim.
- cave-return-progress (MOV-039, MOV-052): "late escape cleanup does not stop replacement
  navigation" guards the `on_done` check in `eventReturnRouteToMain`; it guards a patch
  for W2-2 in one caller.
- bank-sort-request (MOV-040): proves the bank-sort wrapper keeps the visit identity across
  floors. Does not cover the stale `on_done` capture for merchants (callers capture after
  an awaited cleanup; inference).
- convoy-timing (MOV-043): ten tests prove lease ordering against reordered and delayed
  replies. Accurate; they guard the fast/full channel race, which is a real protocol rule,
  not a patch.
- hunt-travel-defense, convoy-defense, passive-hunting (MOV-044 to MOV-046): prove the passing,
  stop and defense rules with fixture entities. W2-6 has no gap to test: shared-walk
  returns are navigation exempt, and the shared-convoy tests set that flag
  (shared-convoy.test.cjs:205, 224).
- travel-defense-client, farming-navigation-client (MOV-047, MOV-050): prove cancel-before-start
  and revision stops. "cancellation leaves non-farming event exits and merchant movement
  alone" guards the four-flag condition of `applyNavigationIntent`.
- convoy-combat-handoff (MOV-048): six tests in the file; the catalog maps the three on
  hand-off target choice. Accurate.
- rare-hunting-client (MOV-049): "new movement owner is not stopped by cancellation of the
  old rare path" guards the `on_done` check (W2-2 patch). No test covers W2-8.
- farm-zone-recovery (MOV-051): "superseded Town guard cannot stop a new convoy or cast Town
  after an awaited stop" guards the generation check added for W2-1; e2e live-game "Town
  executes a real cast after travel and returns both party members" proves Town end to end
  on the real game.
- event-return-turnover-hold, hunt-event-priority, anniversary-kiss (MOV-053 to MOV-055): prove
  event exit ownership, permission denial and arrival without a settled promise. The last
  one guards the W2-3 class (arrival without the movement promise).
- farm-reunion (MOV-056 to MOV-058): 22 tests (27 cases, one runs for six outcomes) cover
  blockers, Magiport handshake, Blink rules,
  retries and arrival. "reaching the live teammate releases reunion before an old smart
  route finishes" guards a stale journey (W2-3 class).
- grouped-cohesion (MOV-059, MOV-061): covers regroup backoff, three-attempt stop and convoy
  precedence. Does not measure the per-tick native re-send (W2-7).
- encounter-recovery (MOV-062), combat-movement "Dash cannot overshoot the weapon range
  boundary" (MOV-065), e2e live-cave assembly regroup (MOV-041). The e2e live-game test "a
  lost native follower reconnects and finishes the current convoy" was mapped to MOV-064,
  but it tests a convoy member, not Follow leader, so the catalog no longer maps it there.
- independent-approach-client "blocked sightline inside weapon range reports active
  approach for existing pursuit recovery" runs `groupedApproachReport` (MOV-063), and its
  "capable split casters enter actor route instead of old healing-anchor regroup" runs
  `groupedMovement` (MOV-059, mapped to MOV-040 before).
- MOV-042 has only cave-priest-recovery "only peaceful recovery approaches the grave and
  votes, ...", which stubs the approach port: it proves when the step is asked for, not
  the step itself.

### 4.3 Convoy client, farm approach, formation and combat steps

Mapping method: `node w3/tests.cjs <files>` lists each `test(...)` whose body names a slice
function (the catalog lists 165 test entries for MOV-066 to MOV-105). A test that reaches a function through a shared harness without naming
it is missed (gap).

- `scripts/tests/priest-formation.test.cjs` (47 of its 55 tests name a slice function; the counts
  below are the same kind): proves the solver, corner recovery,
  clearance and terrain followers on synthetic and captured geometry. Accurate for geometry; it
  does not test idle-monster aggro at game reach, and no test covers a joined event where the
  corner is blocked by adds (bug 7). "holding preserves a destination owned by newer navigation"
  guards the W2 patch.
- `scripts/tests/farm-zone-recovery.test.cjs` (17): proves farm search, local detours, owner
  precedence and the 30 s ban. "aggro suppresses path search; a replacement navigation owner is
  never stopped" guards the `on_done` identity patch.
- `scripts/tests/combat-movement.test.cjs` (13): kite arcs, approach, event corner search and
  attacker clearance. Accurate for attackers; does not cover idle monsters (W1).
- `scripts/tests/formation-path-recovery.test.cjs` (12): coordinator recovery phases, retries and
  stale-report rejection. Accurate.
- `scripts/tests/independent-approach-client.test.cjs` (10) and `independent-approach-group.test.cjs`
  (6): approach readiness, interception and capability. They do not measure re-issue churn (W3).
- `scripts/tests/recovery-route.test.cjs` (7): A* on captured maps. Accurate.
- `scripts/tests/convoy.test.cjs` (7): cruise cap and Hunt return legs. Accurate; no test covers
  the 1-unit leader origin rule (W4) or preparation ownership loss (W5).
- `scripts/tests/combat-queue.test.cjs` (4), `bee-recovery.test.cjs` (1): sight recovery bounds.
- `scripts/tests/combat-interception.test.cjs` (3): intercept maths.
- `scripts/tests/franky-recovery.test.cjs` (5), `event-return.test.cjs` (3),
  `hunt-event-priority.test.cjs` (2): event walks through `sharedPartyWalk`.
- `scripts/tests/hunt-travel-defense.test.cjs` (2), `convoy-communication.test.cjs` (2),
  `encounter-recovery.test.cjs` (1): travel stop targets and arrival ack.
- E2E: `live-event-rendezvous.spec.ts` (rendezvous faults), `live-hunt-town-recovery.spec.ts`
  (no repeated "Leader moved from planning origin"; guards W4), `live-hunt-cold-defense.spec.ts`
  (lost preparation response), `live-hunt-planned-terrain.spec.ts`,
  `live-hunt-hawk-approach.spec.ts`, `live-hunt-targetron-terrain.spec.ts`,
  `live-hunt-engaged-terrain.spec.ts` (terrain recovery on real maps).
- No test: MOV-067 plumbing, MOV-073 route reuse, MOV-074 travel-to-combat handoff, MOV-080 state queries,
  MOV-102 spread, MOV-103 Cave move exposure. Fork movers have their own fork tests, not on the current console.
- Mapping fixes in the verification pass: the MOV-084 test stubbed `recoverFormationCorner` and the
  MOV-097 test stubbed `safeCombatPoint`, so both now name tests that run the real function
  (priest-formation "stalled corner approach ..." and "unreachable corner holds ...";
  combat-movement "blocked kite fallback cannot approach through another attacker or a wall").
- Accuracy not run: no test was executed in this pass.

### 4.4 Coordinator convoys, shared walks and escape stages

All are unit tests in `scripts/tests/` that drive the coordinator modules with fixture statuses; none run the game. Live end-to-end coverage for this area is limited to `e2e/live-hunt-recovery.spec.ts`, `e2e/live-hunt-failed-collection.spec.ts`, `e2e/live-halloween.spec.ts` and the fault script `e2e/native-terminal-settlement-fault.ts` (`git grep -l` on module names under e2e/); these were found by name and not read test by test.

- **convoy-coordinator.test.cjs** (12 tests): proves the legacy barrier phases, timeouts and identity checks (MOV-111 to MOV-113). Does not cover protocol 4. Accurate: the names match the asserted phases. "assembly repair cannot overwrite a newer manual command" guards a patch (the death recovery reissue at convoy-navigation.cjs:52-58).
- **shared-convoy.test.cjs** (52 tests, `grep -c -E "^\s*test\("`): the main proof of the protocol 4 machine (MOV-116 to MOV-129). Covers regroup budgets, geometry repair, missing handles, publication, arrival recovery. Does not cover G3 (text-triggered Town disable) or G8. Several names describe a guard between owners rather than a behaviour ("new manual navigation is not overwritten by regroup recovery", "geometry repair never replaces a newer character command", "return runtime recovery cannot overwrite a newer command or navigation revision"); they guard against G1 and G2, not a player-visible feature.
- **shared-walk.test.cjs** (23 tests): coalescing, parents, retention and turnover (MOV-138 to MOV-141). Many tests exist only because walks and other owners share one slot ("ordinary farming recovery cannot displace active Phoenix patrol during a reload gap", "exhausted event recovery cannot steal newer commands..."): patch guards. No test covers an event walk replacing an active Hunt convoy (shared-walk.ts:191).
- **convoy-defense.test.cjs** and **travel-defense.test.cjs** (9 and 13): attack classification, loot barrier, observation hold (MOV-131 to MOV-133). Accurate for the classification. "missing and stale observations explicitly stop a moving route" proves G9 is intended.
- **convoy-communication.test.cjs**, **barrier-communication.test.cjs**, **convoy-timing.test.cjs**: communication hold and legacy migration (MOV-130). Half the names are migration or "cannot" guards (G4).
- **merchant-convoy-interruption.test.cjs** (12): merchant pause (MOV-134). One test covers the legacy `communication-hold` resume phase (line 34, G4).
- **hunt-area-arrival.test.cjs**, **hunt-return-town.test.cjs**, **unified-return.test.cjs**, **continuous-hunt-return.test.cjs**, **completed-return-cleanup.test.cjs**: Hunt arrival, continuous return and the return Town policy (MOV-129, MOV-135, MOV-136, MOV-136b). No test for G8.
- **convoy-restart-recovery.test.cjs** (5): restart rebuild (MOV-137). Accurate.
- **farming-navigation.test.cjs** (31 tests): intents and event return dispatch (MOV-142, MOV-143). The last test name records the legacy "empty-backup cancellation" branch (G3, G4).
- **party-escape.test.cjs** (22): escape stages (MOV-144). Most tests cover skill sequencing in shared.js (survival, 05). No current test covers a death escape that lands off Main (bug 5); the fork adds `scripts/tests/hunt-death-escape-regroup.test.cjs` and `e2e/live-hunt-death-escape.spec.ts` (ce6e7c1a).
- **coordinator-recovery-hooks.test.cjs**, **coordinator-travel-runtime.test.cjs**, **coordinator-command-ownership.test.cjs**: wiring (MOV-145 to MOV-147). Accurate, small.
- **combat-disengagement.test.cjs**: proves death recovery; "failed return convoy retries with delay, survives reload and completes only at the farm" is the only test of the return convoy hook (MOV-145).

### 4.5 Rare, Phoenix and farm travel, manual commands, coordinator wiring

| test | proves | does not cover | accurate | guards a patch |
|---|---|---|---|---|
| rare-hunting.test.cjs::grouped rare waits for queue selection and never owns a competing convoy | grouped rare cancels its convoy (MOV-148) | live movement | yes | no |
| rare-hunting.test.cjs::rare acquisition keeps an uncommitted Hunt convoy and commits the encounter atomically | retainTravelConvoy and commit (MOV-148) | non-Hunt convoys | yes | no |
| rare-hunting.test.cjs::committed passive sighting interrupts eligible grouped travel; passing sighting preserves route | interruptible purpose list (MOV-148) | `empty-spawn-recovery` vs `party-travel` disagreement | partly: tests one side of finding 1 | no |
| rare-hunting.test.cjs::higher custom priority, Daisy rewards and event combat prevent rare interruption | protected activity blocks rare travel | command purpose list | yes | no |
| e2e/live-hunt-combat.spec.ts::stop-required passive Goo combat resumes the original armadillo Hunt after the actual kill | rare interrupts Hunt travel and returns, on the real game | Phoenix, cross-map rares | yes (live) | no |
| rare-hunting-client.test.cjs::patrol control never starts independent smart movement, including short approaches | client yields patrol legs to the convoy (MOV-149) | encounter paths | yes; deleted in the fork | no |
| rare-hunting-client.test.cjs::fast encounter handoff releases only the patrol convoy and ignores older controls | control id ownership | path failure retry | yes | no |
| rare-hunting-client.test.cjs::stale instructions, wrong instance and changed navigation cannot attack Fairy | revision gate | movement | partly: attack gate more than movement | no |
| phoenix-patrol-regression.test.cjs (9 listed in MOV-150, MOV-151, MOV-152) | convoy legs, acknowledgement wait, dwell, reload retry, fallback clamp, stationary completion loop, planner distance | two blocked points in one region (finding 4) | yes | "stationary successful-but-wrong convoy completions cannot loop forever" reads as a guard for a convoy completion patch (inference from the name; the test came with the first commit 9fbeadab) |
| rare-hunting.test.cjs::failed points have bounded retries and all unreachable regions pause the patrol | MOV-151 budget | per-point vs per-region budget | yes | no |
| farm-zone-recovery.test.cjs (10 listed in MOV-153, MOV-154, MOV-161) | dispatch gates, retry budget, geometry hold, escape release order | the failure-text regex for each word | yes | "superseded Town guard..." and "Escape release installs convoy ownership before its first asynchronous stop" read as guards for ordering between owners (inference from the names; both came with 9fbeadab) |
| convoy-restart-recovery.test.cjs (3 in MOV-155, 1 in MOV-158) and barrier-communication.test.cjs::restart recovers a captured communication-only shared-walk failure... | MOV-155 restore and the 3-attempt budget; MOV-158 restart authority | live restart | yes | the legacy test guards a compatibility branch |
| coordinator-navigation-commands.test.cjs (4) | MOV-156 command shapes | the walk itself | yes | no |
| convoy-timing.test.cjs (2) | MOV-163 ordering | network loss | yes | no |
| combat-movement.test.cjs::Dash cannot overshoot the weapon range boundary | dashToward used by MOV-164 | the warrior wrapper | partly: tests the callee | no |
| daily-dungeons.test.cjs::cave route pauses immediately for local combat and resumes only with fresh party readiness | MOV-165 | live Cave | yes | no |
| farming-navigation.test.cjs::Town preserves monster selections and requires explicit new navigation | MOV-156b party Town keeps focus and clears the waypoint | party travel and checkpoint routes | yes | no |
| e2e/live-navigation-supersession.spec.ts::superseded native Town progress ends quietly and stale pending membership retires | MOV-166 retirement of a stale pending member, on the real game | orphaned command deletion, command restore | yes (live) | no |

No test found for MOV-157, MOV-159, MOV-160, MOV-162 (`git grep -n -E 'prepareMovement|retireConvoysForRealmSwitch|travelResponse|scopedRouter' refs/review/ryan-1.5 -- e2e scripts/tests` returns nothing).

## 5. Needs your review

Questions only you can answer: how the party should behave. Each states **Today** (the current console, and
the fork where it differs), **Options** with trade-offs, and **Recommendation**. The coordinator copies
these into `REVIEW-QUEUE.md`.

### Journeys

**Q1. Same destination asked again.**
- **Today:** a new request always ends the live journey, stops the character and plans again, even
  for the same place (movement.ts:384, 392). Each caller adds its own guard against re-asking. The
  fork caps native moves at 40 per 4 s (move-budget.ts:5 (fork)) and folds the log lines (7ea350fb).
- **Options:** (a) keep the live journey when owner and destination match: no stop, no replan;
  callers that want a fresh route ask for one by name. (b) keep it when only the destination
  matches, whoever asks: also stops two owners fighting over one place, but a new owner inherits a
  journey it did not start. (c) always restart (today): simple, but causes the pull stall (bug 3a),
  the approach churn and likely bug 8.
- **Recommendation:** (a). It removes the restart loops at their source, and the journey keeps one
  named owner.

**Q2. Who may stop a journey it did not start?**
- **Today:** anyone. A bare, `move` or `smart` stop ends any journey as "Unattributed movement stop"
  (movement.ts:411). A stop that passes `success` ends it as arrived instead, and a failed
  `stop('move')` on a Cave `retainOnDirectStop` journey only pauses it (403-410). 102 stop calls
  exist (1.6).
- **Options:** (a) only its owner, plus survival (escape, death recovery). (b) owner, survival and
  the Town guard. (c) anyone (today): any part of the code can end travel, as in bug 7.
- **Recommendation:** (a). Town becomes an owner that requests movement (Q16) instead of a guard
  that stops everyone, so it needs no exception.

**Q3. Combat during travel.**
- **Today:** combat sends native steps under the live journey (`sendCombatMove`, shared.js:17141-17156);
  the service repairs or rejoins the route afterwards (movement.ts:123-170, 278-334). `pause()` exists
  for this hand-off but no combat mover calls it (movement-executor.ts:28-36).
- **Options:** (a) every combat step pauses the journey and resumes it after: one clear owner at a
  time, at the cost of a resume step after each fight. (b) only convoys and Cave pause: less change,
  ordinary walks keep today's repair. (c) no change: keeps the repair path that took nine commits
  from 2026-10-08 to 10-14 as the mechanism (2.1 item 9).
- **Recommendation:** (a). Drift repair then becomes a rare fallback instead of the normal path.

**Q4. Timed-out walks.**
- **Today:** `anniversaryWithTimeout` rejects at its deadline but leaves the journey walking
  (shared.js:11802-11822). Escape's walk to Main (239) uses it with no stop after it, so that journey
  keeps walking. The reunion walk (13709) uses it too, but its `finally` stops smart (13716).
- **Options:** (a) stop the journey at the deadline: the character stands still where it was. (b) let
  it run until another owner takes over (today): it may still arrive, but nobody owns it.
- **Recommendation:** (a), with the caller deciding what happens next. A walk with no owner is the
  pattern this spec removes.

### Step safety

**Q5. Idle monsters.**
- **Today:** `safeCombatPoint` checks only monsters already targeting the character
  (shared.js:17167-17169). Kiting, approach, farm search and event detours use only that check. The
  formation solver and the corner, terrain and sight recovery steps check every visible monster, at
  attack range plus 8, or a flat 38 for a monster that outranges the character (16246-16247). The
  escape retreat step checks only distance from the nearest monster (281-285). The fork adds a
  96-unit idle check in pull mode only (shared.js:18048 (fork)). The game server's reach is now read
  from its source: an untargeted aggressive monster sits in a 32-unit grid cell, each player checks
  the 3x3 cells around its own, and the monster must face the player within 45 degrees (2.3 W1
  item 4). That reach is under 64 on each axis and under 90.5 in a straight line.
- **Options:** (a) every step stays out of idle monsters' aggro reach: safest, but steps get blocked
  more often in dense packs. (b) the tank and the healer avoid aggro reach, others keep attack range:
  protects the two members whose deaths end a fight. (c) keep today's rule.
- **Recommendation:** (a), with the step check modelled on the game's 32-unit grid cells rather than
  a radius. Bugs 3d and 4 both came from steps that ignored idle monsters.

**Q6. Franky and boss approaches.**
- **Today:** The current `frankyMovementTick` checks terrain only, by design (shared.js:17253-17255); the
  fork's Franky movers do the same (shared.js:18128-18353 (fork)).
- **Options:** (a) keep: the boss is the only threat, and safety checks could stop the approach.
  (b) use the same step safety as other movers: safer when adds are present.
- **Recommendation:** (b), with the boss itself excluded, the way the selected target is excluded
  today (17167).

### Events

**Q7. Blocked mage escort in an event (bug 7).**
- **Today:** in a joined event the mage escort runs the formation solver (shared.js:16781), holds "no
  safe local detour; waiting for an opening" (16921-16926), terrain recovery is off in events (16448),
  and the event detour is never reached (runner.ts:244). The fork does not change this.
- **Options:** (a) hold and wait (today): the mage can stand out of range for the whole event.
  (b) fall back to the event approach detour (17265-17298). (c) allow coordinator terrain recovery in
  events. (d) leave formation and fight from its own range.
- **Recommendation:** (b). It reuses an event-specific mover that already exists and keeps the
  coordinator out of event timing.

**Q8. Event walk versus active travel.**
- **Today:** an event walk replaces at once any convoy that is not a shared walk, navigation exempt
  (manual walks) or non-preemptible (Hunt returns), so an outbound Hunt convoy halfway there is
  thrown away (nav/shared-walk.ts:191; nav/manual-commands.ts:116; runtime/coordinator/hunt/convoy.ts:78). The fork does
  not change this rule.
- **Options:** (a) events always win (today): never miss a boss, but a Hunt trip can be thrown away.
  (b) the event waits until the current convoy arrives or fails: no wasted trips, may miss short
  windows. (c) per event: short-window bosses win, others wait.
- **Recommendation:** (c). It keeps today's behaviour where timing matters and stops wasting trips
  where it does not.

**Q9. Moving bosses.**
- **Today:** walks follow Mr. Green, Mr. Pumpkin and Slenderman when they move 250 or more
  (nav/event-pursuit.ts:24); Franky, Ice Golem, Snowman, Horseman and the giant crab only share the
  leader's frozen point (nav/shared-walk.ts:60).
- **Options:** (a) keep. (b) follow every boss in the moving list. (c) follow none and let combat close
  the gap on arrival.
- **Recommendation:** (b), from one list. Two lists that disagree are the bug; whether the extra
  bosses move far enough to matter is unverified (2.4 G5).

**Q10. Missing members at an event walk.**
- **Today:** the console starts an event walk after 20 s without members who have not asked
  (nav/shared-walk.ts:43-45). The fork also lets a walk to another event replace a failed event leg
  at once (b0c4d1ef). Its later fix holds that replacement while a fresh, living member is still
  joined to the failed leg's event (653238e1; `otherEventAfterFailure` and `stillJoined`,
  shared-walk.ts:358-366 (fork)). The 653238e1 message records why: after b0c4d1ef the leader walked
  alone to Mr. Pumpkin and died before the other two arrived.
- **Options:** (a) start after 20 s (current): fast, but members who have not asked are left behind.
  (b) the fork's hold. (c) never start a fighter walk without the healer.
- **Recommendation:** (c). It states the rule the fork's event walk patches were reaching for, in one
  line.

### Convoys and regroup

**Q11. Leader drift before departure.**
- **Today:** the console re-plans when any member is more than 1 unit off its planned origin
  (nav/shared-route-store.ts:93; nav/shared-departure.ts:51; shared.js:15328). The fork walks the
  leader back with `xmove` if within 55 (a85b9509).
- **Options:** (a) the current re-plan: correct, but combat steps make it fire often. (b) the fork's walk
  back. (c) allow drift within the rally range and plan from where the leader stands at departure.
- **Recommendation:** (c). Combat drift is normal (Q3), so the plan should start where the leader is.

**Q12. Report gaps during travel.**
- **Today:** a member report older than 3 s, or a stale attacker list, stops the whole convoy. On
  protocol 4 convoys the communication check runs first and holds everyone in `communication-hold`,
  which resumes after 5 s of stable held reports and at most once per 30 s
  (nav/shared-navigation.ts:437; nav/communication-recovery.ts:88, 136-137). Other convoys, and a
  member with no attacker observation at all, hold in `observing` until 5 s of stopped reports
  (nav/travel-defense.ts:25-32; nav/convoy-defense.ts:74-102). A test confirms the stop is intended.
- **Options:** (a) keep stopping: safe, but slow links stop often. (b) keep walking through gaps under
  a set time unless an attacker is known. (c) stop only the member whose report is stale.
- **Recommendation:** (b), for both holds. An unknown state with no known attacker is not a reason
  to stop four characters.

**Q13. Regroup after three failed routes.**
- **Today:** after three failed regroup routes the party holds new pulls until the group state
  changes (shared.js:14662-14663).
- **Options:** (a) keep holding: safe, but the party can idle for a long time. (b) retry after a
  longer wait. (c) send the separated member to the saved farm point.
- **Recommendation:** (c). It ends the separation instead of waiting for it to end itself.

### Safe places

**Q14. Where a death escape ends (bug 5).**
- **Today:** the console ends a rescue at the Blink landing (scripts/party-escape.cjs:91-96) while death
  recovery waits for Main within 65 (scripts/combat-disengagement.cjs:83-92), so the party waits until
  a player acts (a manual travel command or a Hunt mode change releases it). The fork walks a death
  recovery on to Main (ce6e7c1a), but that walk gives up after 4 legs or 180 s and nothing restarts
  it, and the coordinator's `recovering` stage has no deadline (2.4, after ledger bug 5).
- **Options:** (a) always Main Town (the fork). (b) regroup at the landing when it is safe and the
  dead have respawned nearby. (c) straight back to the farm once everyone is above 50% HP.
- **Recommendation:** (a), with one goal shared by escape and death recovery. The respawn point is in
  Main, so dead members end there anyway.

**Q15. What counts as home.**
- **Today:** escape uses 65 from Main (0, 0); Town and event return 90; anniversary staging 100
  (2.2 W2-5). The manual Town walk parks at (-174, 121) (nav/manual-commands.ts:114), 212 units from
  (0, 0) (`node -e "console.log(Math.hypot(174,121))"`), so it ends outside every 65 radius.
- **Options:** (a) one radius for all. (b) separate radii per workflow, written in one table.
- **Recommendation:** (b), one table owned by movement. The workflows want different things (a
  respawn point, a Town warp landing), but each value should be written once.

**Q16. Is Town exclusive?**
- **Today:** while Town casts, a 100 ms watchdog stops every move, and `departurePending` suppresses
  combat and follow (shared.js:11062-11099). Its own comments record that it once broke Town.
- **Options:** (a) nothing else moves until Town lands. (b) defensive steps only, then Town resumes.
  (c) today.
- **Recommendation:** (a), as a movement request Town holds for the cast, not a watchdog. A defensive
  step would cancel the cast anyway.

### Fork modes

**Q17. Tank under 50% HP.**
- **Today (fork):** the tank hold releases below 0.5 HP and re-holds at 0.8
  (shared.js:18433, 18542-18548 (fork)); the tank then kites with the attackers-only check. The current
  base has no tank hold.
- **Options:** (a) kite (today). (b) step toward the healer. (c) keep holding and let the off tank
  take over.
- **Recommendation:** (b). It moves the tank into heal range instead of into the next pack (bug 3d).

**Q18. Who pulls in pull mode.**
- **Today (fork):** the longest-range living member with range 100 or more, usually the priest
  (runtime/combat/pulling.ts:21-24 (fork)); 21b8362d waits for the tank and every priest to be alive.
- **Options:** (a) longest range (today). (b) never the healer. (c) a pull role set in the party
  settings.
- **Recommendation:** (b) as the default, with (c) as an override. The healer walking away alone is
  bug 3b.

### Rares

**Q19. Which travel may a rare interrupt?**
- **Today:** four lists disagree (nav/rare-hunting.ts:124-131, 181, 841, and the
  `interruptibleTravel` deny list in runtime/combat/hunt-travel.ts:18-22, read at rare-hunting.ts:377):
  `party-travel` and `empty-spawn-recovery` are interruptible in one list and not another. Farm
  recovery keeps a fifth (nav/farm-areas.ts:211).
- **Options:** (a) any farming travel (Hunt, relocation, manual monster, empty-spawn recovery, party
  travel), never event or Town travel. (b) as (a), but party travel stays uninterruptible because the
  user chose it by hand. (c) only Hunt and relocation travel.
- **Recommendation:** (b), in one list. A trip the user started by hand should finish.

**Q20. Phoenix patrol.**
- **Today:** the console walks the party as one convoy per scan leg (nav/phoenix-patrol.ts:208-209). The fork
  sends each fighter to its own region and gathers on a sighting (3849a095). The party engages as
  soon as everyone is within 300 units; 300 s is the minimum gathering deadline, not a wait.
- **Options:** (a) the fork's split search as an add-on that requests per-character walks: faster
  search, fighters alone. (b) the current convoy legs: slower, always together. (c) both, as a setting.
- **Recommendation:** (c), with the split search built as an add-on on the movement owner rather
  than beside it.

**Q21. Failed rare walk.**
- **Today:** the console never retries a failed encounter or loot walk for the same encounter, and the
  fighter stands still (shared.js:3688). The fork retries after 5 s, but its timeout branch skips the
  wait (shared.js:4136 (fork)).
- **Options:** (a) retry after 5 s. (b) end the encounter at once. (c) retry once, then end.
- **Recommendation:** (c). One retry covers a walk stopped by a fight; a second failure means the
  route is wrong.

## 6. The design

M1.

## 7. What changes for the player

M1.

## 8. Proof

M1.

## 9. Migration

M1.

## 10. Gaps

M0 is not done for this spec until this list is empty.

### Claim check

`node tools/check-claims.mjs` covers every spec; the counts below are for 02 only, computed from
`catalog/02-movement.json`, `catalog/handoffs-02.json` and `catalog/proposed-sections.json`. Catalogs
present at the run: 01 to 13 and 15. Tool totals at the run: functions 9421, claimed 9421, unclaimed 0,
claimed by more than one spec 0, claims naming no known function 0.

| Check (02-movement only) | Count |
|---|---|
| Functions proposed to 02 | 1214 |
| Proposed to 02 and claimed by 02 | 964 |
| Proposed to 02 and handed off (`handoffs-02.json`, `"from": "02-movement"`) | 244 |
| Proposed to 02 and claimed by another spec with no handoff entry | 6 |
| Handed off and not yet claimed by the receiving spec | 0 |
| Proposed to 02, claimed by no spec | 0 |
| Functions 02 claims in total, including triage and other proposals | 1146 |
| Claimed by 02 and another spec | 0 |
| Claims naming no known function | 0 |
| Behaviours | 168 (MOV-001 to MOV-166, plus MOV-136b and MOV-156b) |
| Behaviours with no test | 11 |

The 6 claimed elsewhere with no handoff entry: `characters/shared.js#merchantCommerce>commerceMove@7738`
(10), and `runtime/coordinator/navigation/grouped-snapshot.ts#inEvent@105`,
`runtime/coordinator/navigation/rare-hunting.ts#createRareHunting>memberProtected@134`,
`recoveryProtected@141`, `eventProtected@148` and `protectedActivity@153` (01).

### Claims that may collide with other specs

These functions were proposed to another spec or to a three-way split, and this spec claims them
because they move a character. `check-claims.mjs` reports no double claim for any of them today:

- Proposed to `05-survival` (31): `runtime/characters/native-planner.ts#createNativePlanner>checkDeadline@34`, `characters/shared.js#terrainRecoveryContext@16442`, `characters/shared.js#terrainRecoverySafe@16453`, `characters/shared.js#terrainRecoveryPoint@16469`, `characters/shared.js#terrainRecoveryPoint>gap@16475`, `characters/shared.js#terrainRecoveryGoals@16491`, `characters/shared.js#proposeTerrainRecovery@16507`, `characters/shared.js#terrainRecoveryPorts@16600`, `characters/shared.js#terrainRecoveryPorts>now@16602`, `characters/shared.js#terrainRecoveryPorts>self@16602`, `characters/shared.js#terrainRecoveryPorts>smart@16603`, `characters/shared.js#terrainRecoveryPorts>endpointSafe@16604`, `characters/shared.js#terrainRecoveryPorts>segmentClear@16606`, `characters/shared.js#terrainRecoveryPorts>release@16608`, `characters/shared.js#terrainRecoveryPorts>goals@16609`, `characters/shared.js#terrainRecoveryPorts>plan@16610`, `characters/shared.js#terrainRecoveryPorts>start@16611`, `characters/shared.js#terrainRecoveryPorts>stop@16612`, `characters/shared.js#terrainRecoveryPorts>hold@16613`, `characters/shared.js#terrainRecoveryPorts>log@16617`, `characters/shared.js#terrainRecoveryPorts>debug@16618`, `characters/shared.js#terrainRecoveryPorts>draw@16619`, `runtime/combat/formation-recovery.ts#continueRecovery@104`, `runtime/combat/sight-recovery.ts#createSightRecovery@5`, `runtime/combat/sight-recovery.ts#createSightRecovery>cell@9`, `runtime/combat/sight-recovery.ts#createSightRecovery>reset@10`, `runtime/combat/sight-recovery.ts#createSightRecovery>observe@11`, `runtime/combat/sight-recovery.ts#createSightRecovery>tick@19`, `runtime/combat/sight-recovery.ts#createSightRecovery>tick>allowed@40`, `runtime/combat/sight-recovery.ts#createSightRecovery>tick>send@41`, `characters/shared.js#queueRecoveryReason@17613`
- Proposed to `13-lifecycle` (39): `runtime/coordinator/http/movement.ts#validOptions@5`, `runtime/coordinator/http/movement.ts#planErrorResponse@9`, `runtime/coordinator/http/movement.ts#installMovementRoutes@13`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>groupReady@92`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>insideArea@107`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>fighting@123`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>approach@135`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes@10`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>focus@14`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>recordEngagement@19`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>arrivalDetails@40`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>accept@45`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>handoffResponse@72`, `runtime/coordinator/http/convoy-engagement.ts#createConvoyEngagementRoutes>engage@78`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes>failed@120`, `runtime/coordinator/http/shared-convoy-route.ts#installSharedConvoyRoute@8`, `runtime/coordinator/http/shared-convoy-route.ts#installSharedConvoyRoute>publish@16`, `runtime/coordinator/http/shared-convoy-route.ts#installSharedConvoyRoute>read@22`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes@52`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes>superseded@56`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes>arrived@68`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes>recordHuntArrival@94`, `runtime/coordinator/http/convoy-acknowledgements.ts#createConvoyAcknowledgementRoutes>complete@99`, `runtime/coordinator/http/convoy-acknowledgements.ts#townFailure@12`, `runtime/coordinator/http/party-actions.ts#travelLocation@45`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes@57`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>travel@58`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>checkpoint@72`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>town@104`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions@28`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>nextCommand@29`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>huntOwns@33`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>engage@34`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>acceptArrival@35`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>valid@42`, `runtime/coordinator/http/navigation-actions.ts#createCoordinatorNavigationActions>hold@43`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>escapeState@133`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>escape@136`, `runtime/coordinator/http/party-actions.ts#createPartyActionRoutes>resume@140`
- Proposed to `04-targeting` (2): `characters/shared.js#encounterCatchup@14540`, `characters/shared.js#cancelEncounterCatchup@14534`
- Proposed to `07-hunts-and-farming` (5): `characters/shared.js#planHuntReturn@15723`, `characters/shared.js#planHuntReturn>point@15750`, `characters/shared.js#planHuntReturn>saveSegment@15751`, `runtime/combat/hunt-travel.ts#outboundHunt@15`, `runtime/combat/hunt-travel.ts#huntDefense@32`
- Proposed to `03-turns-and-cooldowns|04-targeting|05-survival` (26): `runtime/combat/formation-recovery.ts#fresh@22`, `runtime/combat/formation-recovery.ts#samePlace@23`, `runtime/combat/formation-recovery.ts#unoccupied@26`, `runtime/combat/formation-recovery.ts#peaceful@30`, `runtime/combat/formation-recovery.ts#safeMember@35`, `runtime/combat/formation-recovery.ts#proposal@43`, `runtime/combat/formation-recovery.ts#validGoals@48`, `runtime/combat/formation-recovery.ts#retry@52`, `runtime/combat/formation-recovery.ts#begin@57`, `runtime/combat/formation-recovery.ts#unreachableCoverage@63`, `runtime/combat/formation-recovery.ts#routing@73`, `runtime/combat/formation-recovery.ts#advance@87`, `runtime/combat/formation-recovery-progress.ts#retryDestination@11`, `runtime/combat/formation-recovery-progress.ts#retryDestination>valid@13`, `runtime/combat/recovery-route.ts#distance@57`, `runtime/combat/interception.ts#copyPrediction@6`, `runtime/combat/interception.ts#interceptionTime@9`, `runtime/combat/interception.ts#predictCombatIntercept@18`, `runtime/combat/independent-approach.ts#available@3`, `runtime/combat/independent-approach.ts#samePlace@7`, `runtime/combat/independent-approach.ts#currentCapability@10`, `runtime/combat/independent-approach.ts#independentReadiness@22`, `runtime/combat/independent-approach.ts#allIndependentReady@26`, `runtime/combat/independent-approach.ts#currentRound@32`, `runtime/combat/independent-approach.ts#staleEcho@36`, `runtime/combat/independent-approach.ts#confirmed@40`
- Proposed to `12-dashboard-and-status` (1): `runtime/combat/formation-recovery.ts#report@39`
- Proposed to `09-merchant-realm-and-gear` (1): `runtime/coordinator/application.ts#startCoordinatorApplication>resolveRealm@924`
- Triage functions claimed: 77 (listed in the catalog; no other spec was proposed them).

### Functions yielded to another spec's claim

On the first claim check, these functions were claimed both here and by another spec. The other
spec's claim fits its part (task precedence for 01, travel stop targets for 04, cooldown use for
03), so this spec drops its claim, keeps describing the behaviour, and lists each in
`handoffs-02.json`. `isOccupied` (MOV-104) and the warrior Dash (MOV-065) move a character, so the
coordinator may want to settle them with 03 instead:

- Yielded to `01-groups-and-tasks` (27): `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>now@1802`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>intent@1804`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>resolveArea@1805`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>now@1978`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>intent@1980`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>contains@1985`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>engage@1987`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>acceptArrival@1988`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>waypoint@1989`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>members@1992`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>valid@1993`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>hold@1995`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>error@1996`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>members@2000`, `characters/shared.js#shouldFollowLeader@17704`, `runtime/coordinator/application.ts#startCoordinatorApplication>huntTurnInOwnsTravel@2112`, `runtime/coordinator/application.ts#startCoordinatorApplication>createSoloServices>allowed@2002`, `runtime/coordinator/navigation/farm-areas.ts#createFarmAreaNavigation>workflowOwns@196`, `runtime/coordinator/navigation/farm-areas.ts#createFarmAreaNavigation>huntTravelOwns@254`, `runtime/coordinator/navigation/convoy-defense.ts#eligible@35`, `runtime/coordinator/navigation/hunt-arrival.ts#memberBlocked@25`, `runtime/coordinator/navigation/travel-defense.ts#eventOwnsParticipant@147`, `runtime/coordinator/navigation/farm-areas.ts#createFarmAreaNavigation>memberBlocked@42`, `runtime/coordinator/navigation/rare-hunting.ts#createRareHunting>commandProtected@118`, `runtime/coordinator/application.ts#startCoordinatorApplication>escapeStep@1741`, `characters/shared.js#reunionBlocked@13456`, `characters/shared.js#eventExitOwnsMovement@13451`
- Yielded to `03-turns-and-cooldowns` (2): `characters/shared.js#dashToward@13954`, `characters/shared.js#isOccupied@17494`
- Yielded to `04-targeting` (23): `characters/shared.js#passiveStopRequired@3387`, `characters/shared.js#returnDepartureDefense@14057`, `characters/shared.js#departureCombatPending@14906`, `characters/shared.js#groupedAnchorVisible@14429`, `runtime/combat/hunt-travel.ts#stopCandidates@23`, `runtime/combat/hunt-travel.ts#observations@35`, `runtime/combat/hunt-travel.ts#sampled@39`, `runtime/combat/hunt-travel.ts#observedAttackers@43`, `runtime/combat/hunt-travel.ts#unique@49`, `runtime/combat/hunt-travel.ts#deaths@52`, `runtime/combat/hunt-travel.ts#huntAttackers@55`, `runtime/combat/hunt-travel.ts#freshAttackerObservations@61`, `runtime/combat/hunt-travel.ts#liveAfterRelease@65`, `runtime/combat/hunt-travel.ts#retainedEncounters@75`, `runtime/combat/hunt-travel.ts#reconcileRetirements@78`, `runtime/combat/hunt-travel.ts#releaseIncidental@90`, `runtime/combat/hunt-travel.ts#reconcileEncounters@97`, `runtime/combat/hunt-travel.ts#reconcileEncounters>keep@99`, `runtime/combat/hunt-travel.ts#commitStop@105`, `runtime/combat/hunt-travel.ts#passingProposal@110`, `runtime/combat/hunt-travel.ts#selectPrimary@117`, `runtime/combat/hunt-travel.ts#reconcileStops@135`, `runtime/combat/passive-travel.ts#passiveStopRequired@4`

### Functions left for other specs

`catalog/handoffs-02.json` lists every function this spec does not keep: 244
functions proposed to 02 and handed to another spec with a reason, and 245 triage or
split functions read for this spec and suggested to another spec (164 with `"from": "triage"`,
81 from the split and single-spec proposals). Every receiving spec now claims its handoffs. Notable ones:
- `handleCommand`, `handle` and `handleOwnedCommand` (shared.js:10416-10991 and nearby): the command
  router, suggested 01-groups-and-tasks. Its movement writes (Command takeover cancel at
  10500-10514, town-party stops at 10707-10709, event return stops at 10788-10789) are listed in
  1.6.
- The status `tick` in shared.js, suggested 13-lifecycle. Its movement stops (rare handoff, convoy
  end, event disable, follow off at 11220, 11252, 11281, 11291, 11303) are listed in 1.6.
- `scripts/combat-disengagement.cjs`, read in full for bug 5, suggested 05-survival.
- `characters/party-member.js` held a generated copy of the movement service (party-member.js:675,
  950) and is proposed to 13-lifecycle; its functions duplicate slice 1.1.
- 275 triage functions in `runtime/coordinator/application.ts` are not movement (likely 01, 11, 12,
  13); they are counted, not listed.

### Rebuilt function index

The index was rebuilt during this pass (9,426 entries, 9,421 distinct ids by `check-claims.mjs`; generated bundles such as
`characters/party-member.js` dropped and listed under their `runtime/` sources). Every id in
`02-movement.json` and `handoffs-02.json` exists in the rebuilt index (`assemble.cjs` reports 0
unknown). `catalog/proposed-sections.json` still lists the old 7,857 ids, so 1,815 ids in the index
have no proposal. All of them are in `e2e/`, `scripts/tests/` and `tools/` (330, 529 and 956;
`node tools/propose-sections.mjs` on the new index, compared with the old proposals). The name
heuristic would send 163 of them to 02, but they are test helpers and tools, not movement code, so
this spec claims none of them. Spec 15 and spec 13 claim them (docs/implementation/02-coverage.md).

### Behaviours with no test

- MOV-004: A gate owner replaces the default journey tick on every scheduler call (its former test never sets a gate owner)
- MOV-067: Convoy plumbing: lease expiry, convoy identity, position, distance, retryable request errors, communication-hold status and retry sleeps.
- MOV-073: Route reuse: the leader reuses a saved remainder or a Hunt return itinerary segment instead of planning again.
- MOV-074: Travel-to-combat handoff: on a reachable target the convoy asks /convoy-engage, then stops smart and hands movement to combat.
- MOV-080: Convoy state queries used by the role runner and queue client.
- MOV-102: Spread: a character overlapping a party member steps away on a name-hashed angle.
- MOV-103: Cave priest recovery move exposed to the role runner.
- MOV-157: The coordinator prepares ALClient geometry per game version and falls back to native movement when preparation fails
- MOV-159: Party convoys start and cancel through the convoy service, but Hunt has its own start port and a cancel that clears the slot directly; a realm switch cancels convoys whose members left
- MOV-160: Convoy HTTP routes (engage, approach, acknowledgements, farming return) reach the convoy that owns the calling character, main party or solo fighter
- MOV-162: Each heartbeat carries the convoy signal, party location, farm-travel pause, navigation intent, Town and convoy flags, and the Hunt turn-in travel priority

### Not yet verified

- **Bug 7 caller.** The log entry's `stopStack` (movement.ts:411) names the stop that ended the event
  walk; this pass had no log. The chain also assumes Icelocked is a mage with a priest in the party.
- **Bug 8 candidate.** Needs the 10:47-10:50 UTC log lines with `failureContext.replacement`,
  `recoveryStage`, `convoyId`, `elapsedMs` and the code field (2.1, "Ledger bug 8").
- **Game client cadence.** How often the game calls `smart_move_logic` is not in this repo.
- **Inference to confirm with a test:** the runtime field mismatch between convoy checks (2.4 G2), the
  moving-boss gap (2.4 G5), continuous return with no deadline (2.4 G8), report gaps stopping a convoy
  on slow links (2.4 G9), the farming token loss during an overlapping command dispatch
  (2.2 W2-9), the Phoenix fallback budget per region (2.5 item 4), and ownerless
  journeys being replaced by the independent approach (2.1 item 3).
- **End-to-end tests** that touch the service and the coordinator convoys (`e2e/live-cave`,
  `live-event-entry-failure`, `live-hunt-manual-event-override`, `live-hunt-town-recovery`,
  `live-hunt-recovery`, `live-hunt-failed-collection`, `live-halloween`, the native observers and
  `native-terminal-settlement-fault.ts`) were found by name and not mapped test by test.
- **Test mapping method.** Unit tests were matched to behaviours by function name in the test body;
  a test that reaches a function through a shared harness without naming it is missed. No test was
  run in this pass, so "accurate" means read as accurate, not run.
- **History** for the coordinator navigation files was taken per file, not per function
  (`nav/shared-navigation.ts` has 21 commits not split by function).
- **HTTP handlers** for `/convoy-route`, `/shared-travel`, `/convoy-engage`, `/convoy-complete` and
  `/movement-barrier` were not traced end to end; slice 1.5 claims the `application.ts` wiring it
  found, but no pass followed each request from the character to the coordinator module.

### Resolved while assembling

- **Aggro reach** (resolved in the verification pass). The game server source
  (kaansoral/adventureland_mongodb 43b2c8fc and 16881a2) puts each untargeted aggressive monster in a
  32-unit grid cell (node/server.js:14394-14405, `set_ghash` at 14404), and each player checks the 3x3
  cells around its own (server.js:15263; node/server_functions.js:1188-1216). A monster attacks only
  when it faces the player within 45 degrees (`is_in_front`, server.js:15265), and one with `aggro` at
  or below 0.99 joins only by chance each tick (server.js:14403). So the reach is under 64 on each
  axis and under 90.5 in a straight line, and always covers 32 on each axis. The fork's
  `AGGRO_REACH = 96` and `BOSS_AGGRO_REACH = 64 x sqrt(2)` match it.
- **Move cost** (resolved in the verification pass). A move costs 2.5 call cost: 1 per call
  (server.js:4980) plus `CC.move` 1.5 (server.js:249, 5018-5019), against a limit of 200 per 4 s
  (server.js:262).

- Slice 1.5 asked whether the role runner treats a stuck rare walk as handled: yes. `pollRareHunting`
  is step 3 of the mover chain and a true result ends the tick (runner.ts:224, MOV-033).
- Slice 1.5 asked whether the manual Town point (-174, 121) is within 65 of Main (0, 0): no, it is
  212 units away, so a character parked there does not count as safe for escape or death recovery.
