# 15. Testing

The test infrastructure: unit test harnesses, the simulator, the virtual clock, end-to-end
fixtures, debug instances, benchmarks, profiling, and proof and fault scripts. Spec prefix
`TST`. The tests themselves (`*.test.cjs`, `*.spec.ts`, `*.case.ts`) are not in the
function index; each feature spec maps them to its behaviours in its "Tests today" section.

Checked against the current console `refs/review/ryan-1.5` (`b9b5c91e`) in
(local checkout). Counts come from `catalog/15-testing.json` and
`node tools/check-claims.mjs`, run from (local checkout).

## 1. What it does today

43 behaviours claim 1327 functions in 135 files.

### Unit test harnesses

The unit tests in `scripts/tests/*.test.cjs` load production code through these helpers in `scripts/tests/helpers/`. The current character code is one closure, so TST-001 cuts single functions out of `characters/shared.js` (spec 13, "Test harness patterns"). Most coordinator helpers bind the production services onto one legacy test context, so a test calls the real service through the names it had before the services were split out.

- **TST-001** Extract named production functions from characters/shared.js and pinned game files into a vm context: named function parser, shared context with maintenance gates, passing, journal and merchant guard contexts, game geometry, pinned game sources, travel observation clocks. Code (25 functions): `scripts/tests/helpers/client-dependencies.cjs`, `scripts/tests/helpers/downloaded-game.cjs`, `scripts/tests/helpers/game-geometry.cjs`, `scripts/tests/helpers/named-function.cjs`, `scripts/tests/helpers/shared-context.cjs`, `scripts/tests/helpers/travel-observations.cjs`.
- **TST-002** Coordinator host smoke harness: transpiles runtime/coordinator/application.ts and boots it (plain, bundled or through the caracAL launcher) in a vm with stubbed require, express, account, clock, timers and process signals. Code (36 functions): `scripts/tests/helpers/coordinator-host.cjs`, `scripts/tests/helpers/coordinator-source.cjs`.
- **TST-003** Coordinator HTTP, public state and worker fixtures: fake router that invokes handlers with a recording request and response, public state route over a seeded party, and character manager with fake fork, clock and logs. Code (52 functions): `scripts/tests/helpers/coordinator-http.cjs`, `scripts/tests/helpers/coordinator-public-state.cjs`, `scripts/tests/helpers/coordinator-workers.cjs`.
- **TST-004** Wire production coordinator travel services onto a legacy test context: party convoys, convoy engagement and acknowledgement routes, farm area navigation and farming route authorization. Code (50 functions): `scripts/tests/helpers/coordinator-convoy-routes.cjs`, `scripts/tests/helpers/coordinator-convoys.cjs`, `scripts/tests/helpers/coordinator-farm-areas.cjs`, `scripts/tests/helpers/coordinator-farming-authorization.cjs`.
- **TST-005** Wire production event and anniversary services onto a legacy test context: event returns, event acknowledgement routes, anniversary returns and anniversary navigation routes. Code (69 functions): `scripts/tests/helpers/coordinator-anniversary-navigation.cjs`, `scripts/tests/helpers/coordinator-anniversary.cjs`, `scripts/tests/helpers/coordinator-event-acknowledgements.cjs`, `scripts/tests/helpers/coordinator-events.cjs`.
- **TST-006** Wire production hunt services onto a legacy test context: hunt lifecycle, convoy, quests and tick, the hunt mode route and the monster selection routes, with every port bound to context functions. Code (80 functions): `scripts/tests/helpers/coordinator-hunt-mode.cjs`, `scripts/tests/helpers/coordinator-hunt.cjs`, `scripts/tests/helpers/coordinator-monster-selection.cjs`.
- **TST-007** Merchant coordinator fixtures: dispatcher runtime with a seeded party and recorded effects, sample job, merchant queue adapter, and job completion fixture with recorded ports and timers. Code (98 functions): `scripts/tests/helpers/coordinator-completion.cjs`, `scripts/tests/helpers/coordinator-dispatch.cjs`, `scripts/tests/helpers/coordinator-merchant.cjs`, `scripts/tests/helpers/coordinator-idle.cjs`.
- **TST-008** Character runtime fixtures: bank stack service over a fake bank with swap, store, retrieve and split, and a skill world with a seeded actor, skill table, monsters, allies, cooldowns and recorded casts. Code (47 functions): `scripts/tests/helpers/bank-stacks.cjs`, `scripts/tests/helpers/skill-world.cjs`.
- **TST-009** Native convoy runtime: runs the native runner smart-move code and the shared.js convoy code in a vm with fake character, timers, sockets and movement plan, and drives start, ready, tick and cancel. Code (52 functions): `scripts/tests/helpers/native-convoy-runtime.cjs`.
- **TST-010** Dashboard test harness: esbuild loader for dashboard/features/party modules, legacy declaration source reader, and the character card replay that counts card, inventory, map and status renders per data update. Code (20 functions): `scripts/tests/helpers/dashboard-card-replay.cjs`, `scripts/tests/helpers/dashboard-query-module.cjs`, `scripts/tests/helpers/dashboard-source.cjs`.

### Simulator

`tools/sim` runs the real coordinator and character code against a game server on the ChronAL virtual clock, with caracAL replaced by stand-ins (`tools/sim/README.md`).

- **TST-011** Simulator coordinator host: runs the coordinator bundle in a vm context on the ChronAL virtual clock with a virtual process, captured Express and an in-process route planner worker. Code (27 functions): `tools/sim/host/coordinator.cjs`.
- **TST-012** Simulator caracAL stand-ins: logging, account, game file cache, config and bot web interface replacements, so a run never reads the user caracAL install. Code (25 functions): `tools/sim/host/caracal.cjs`.
- **TST-013** Simulated character: boots a ChronAL game client with caracAL extensions, IPC-backed storage and the real CODE through the runner host. Code (32 functions): `tools/sim/host/character.cjs`.
- **TST-014** Simulator worker hosts: the in-process single-thread character worker and the threaded lockstep client threads that carry caracAL IPC and CODE HTTP. Code (37 functions): `tools/sim/host/character-worker.cjs`, `tools/sim/host/client-thread.cjs`, `tools/sim/host/threaded.cjs`.
- **TST-015** Simulator plumbing: a vm context and require on the virtual clock for repository modules, and CODE XHR and fetch dispatched into the captured Express app with virtual latency. Code (28 functions): `tools/sim/host/clocked-require.cjs`, `tools/sim/host/transport.cjs`.
- **TST-016** Simulation runner: stages CODE, boots server, coordinator and characters, runs scenario farm and Hunt steps, samples the timeline, traces windows and writes the report with deaths and kills. Code (37 functions): `tools/sim/observe.cjs`, `tools/sim/run.cjs`.
- **TST-017** Simulator scenario validation and the interactive Playwright session that serializes state, post, admin, run and bounded clock advance commands. Code (16 functions): `tools/sim/scenario.cjs`, `tools/sim/session.cjs`.
- **TST-018** Simulator setup: pins the ChronAL checkout and game repositories under .build/sim/chronal and adapts the ChronAL installer for Windows. Code (8 functions): `tools/sim/install.cjs`, `tools/sim/setup.mts`.

### Virtual clock

One virtual clock paces the coordinator, the character processes and the browser pages, in the simulator and in the accelerated e2e backend.

- **TST-019** E2E network clock: the broker paces one bounded gameplay timeline, and each Node actor installs the ChronAL clock, joins at the current instant and reports in-flight native party-api I/O. Code (39 functions): `tools/sim/join-clock.cjs`, `tools/sim/native-io.cjs`, `tools/sim/network-clock-broker.mts`, `tools/sim/network-clock.cjs`.
- **TST-020** E2E network clock timers: Node timers with refresh, ref and unref, and window timers and animation frames on the virtual clock. Code (22 functions): `tools/sim/network-timers.cjs`.
- **TST-021** E2E browser clock: a bundled ChronAL clock for game and CODE pages that joins the broker over a WebSocket, keeps native rendering and drains microtasks through a native task queue. Code (17 functions): `tools/sim/browser-clock.cjs`, `tools/sim/browser-task-queue.cjs`, `tools/sim/build-browser-clock.mts`.
- **TST-022** Gameplay clock adapters: gameplay-time polls and waits, a ChronAL-aware expect.poll, the host observation clock and browser script gating until the ChronAL clock has joined. Code (17 functions): `e2e/chronal-browser-startup.ts`, `e2e/gameplay-clock.ts`, `e2e/network-clock.ts`.

### End-to-end fixtures

The Playwright suites in `e2e/*.spec.ts` run on two kinds of fixture. The console fixtures start the dashboard candidate with a fixture coordinator and scripted status heartbeats. The live fixtures start the production coordinator against a disposable upstream game server and log in the unmodified game client.

- **TST-023** Console E2E coordinator process: runs the real coordinator application with a simulated caracAL account, game fetch and fixed-roster adapters, and posts deterministic W/P/M status heartbeats built from pinned game data. Code (39 functions): `e2e/coordinator.cjs`, `e2e/game-fixture.cjs`.
- **TST-024** Console Playwright fixtures: start the dashboard candidate, gateway and fixture coordinator per scenario, seed the journal, deliver status, restart or crash the coordinator, block non-loopback requests and remove the owned workspace. Code (24 functions): `e2e/debug-container-host.mts`, `e2e/fixtures.ts`, `e2e/state-route.ts`, `e2e/workspace.ts`.
- **TST-025** Live coordinator process: runs the production coordinator against the disposable upstream server, caches native assets, stages CODE, records declared observations and holds merchant status on marker files. Code (23 functions): `e2e/live-coordinator.cjs`.
- **TST-026** Live Playwright fixture: resets the disposable game, seeds loadouts and positions, starts the live coordinator, gateway and denial proxy, logs in native clients, exposes state, post, admin, holds and restarts, and attaches final evidence. Code (34 functions): `e2e/live-fixtures.ts`, `e2e/live-restart-readiness.ts`, `e2e/native-network-isolation.ts`.
- **TST-027** Native game client driver: opens the unmodified upstream browser client, runs the production CODE loader, records socket events and outgoing packets, and reads snapshots or runs expressions in the CODE frame. Code (17 functions): `e2e/live-game-client.ts`, `e2e/native-graphics-diagnostic.ts`.
- **TST-028** Disposable upstream game server: Docker compose pools, container boot with Mongo lease cleanup, account bootstrap, per-scenario world reset, admin eval and the global setup that builds the candidate and clock broker. Code (20 functions): `e2e/game/addresses.cjs`, `e2e/game/boot.cjs`, `e2e/game/bootstrap.cjs`, `e2e/game/manage.mjs`, `e2e/game/setup.mjs`.
- **TST-029** Live scenario seed and evidence helpers: gear loadouts, start positions, seeded quests, rare and event spawns, Goobrawl sizing, death faults, ambient monster isolation and kill or token evidence read from the native server. Code (36 functions): `e2e/game/event-scenario.ts`, `e2e/game/event-spawn.ts`, `e2e/game/hunt-events.ts`, `e2e/game/hunt-lifecycle.ts`, `e2e/game/loadouts.ts`, `e2e/hunt-interruption-helpers.ts`, `e2e/native-map-ambient-isolation.ts`.
- **TST-030** Shared gameplay scenarios: solo ranger, Ice Roamer, Boo Boo, follower reward, convoy, unequal quests and goo Hunt, written once against a gameplay world for both clock backends. Code (13 functions): `e2e/gameplay-scenarios.ts`.
- **TST-031** Native passive observers: bounded records of Cave combat, navigation barrier traffic, planner ownership, CODE status ajax and CDP transport timing, plus a progress budget for long native waits. Code (29 functions): `e2e/native-cave-combat-observer.ts`, `e2e/native-navigation-http-observer.ts`, `e2e/native-planner-observation.ts`, `e2e/native-progress-budget.ts`, `e2e/native-status-observer.ts`, `e2e/native-transport-observer.ts`.
- **TST-032** E2E artifact reporter: records run provenance and a reproduction patch, writes each attachment to a file with an outcome ledger and boundary, and writes a hashed report manifest. Code (7 functions): `e2e/artifact-reporter.cjs`.

### Debug instances

A disposable stack for looking at a problem by hand, started from the main console.

- **TST-033** Debug instance: the main console starts a disposable Docker stack (database, local game server, console) with a seeded god party, reachable only through a token-authenticated gateway with a noVNC game viewer, and destroys it on stop. Code (35 functions): `tools/debug/desktop.ts`, `tools/debug/docker-access.ts`, `tools/debug/gateway.ts`, `tools/debug/instance.mts`, `tools/debug/process.ts`, `tools/debug/service.ts`, `tools/debug/viewer.ts`.

### Benchmarks and profiling

These tools measure cost. Two more benchmark behaviours sit in spec 12, because they measure the dashboard and the metrics journal: DSH-018 (`scripts/benchmark-dashboard-*.cjs`) and DSH-066 (`tools/benchmark-metrics-journal.mts`).

- **TST-034** E2E backend benchmarks: native versus accelerated suite comparison, executed CODE parity check, clock rate sweep, test selection audit and simulator benchmark evidence. Code (13 functions): `tools/sim/benchmark.cjs`, `tools/sim/check-selection.mts`, `tools/sim/e2e-benchmark.mts`, `tools/sim/e2e-code-parity.mts`, `tools/sim/e2e-rate-benchmark.mts`.
- **TST-035** Pathfinder benchmark runner: builds the route corpus, downloads and bundles the pinned ALClient planner, and measures native and ALClient queries in isolated workers with sampling plans. Code (33 functions): `tools/game/pathfinder-benchmark/corpus.cjs`, `tools/game/pathfinder-benchmark/run.cjs`, `tools/game/pathfinder-benchmark/sampling.cjs`, `tools/game/pathfinder-benchmark/setup.cjs`, `tools/game/pathfinder-benchmark/worker.cjs`.
- **TST-036** Offline native planner: runs the installed game smart_move planner in a vm with movement and network forbidden, and validates routes step by step for collisions, doors, transporters and Town. Code (22 functions): `tools/game/pathfinder-benchmark/native.cjs`, `tools/game/pathfinder-benchmark/transition-validation.cjs`, `tools/game/pathfinder-benchmark/validate.cjs`, `tools/game/pathfinder-benchmark/verify.cjs`.
- **TST-037** Pathfinder benchmark report: medians, quantiles, paired comparisons, plots and CSV appendices, plus the alpathfinder collision benchmark. Code (18 functions): `tools/game/benchmark-pathfinder.mts`, `tools/game/pathfinder-benchmark/report.cjs`.
- **TST-038** Persistence benchmark: drives the coordinator persistence writer and journal at live event rates under mock timers and reports disk bytes, fsyncs, compactions and call times. Code (11 functions): `tools/benchmark-persistence.mts`.
- **TST-039** Profiling: SIGUSR2 preloads for the coordinator and character threads, cpuprofile and run summary readers, planner and renderer CPU profiles, long tasks and browser rendering CPU accounting. Code (40 functions): `e2e/browser-rendering.ts`, `e2e/native-planner-cpu-profile.ts`, `e2e/native-renderer-observer.ts`, `e2e/profiling/coordinator-profile-preload.cjs`, `e2e/profiling/profile-report.cjs`, `e2e/profiling/run-summary.cjs`, `e2e/profiling/thread-profile-preload.cjs`.

### Proof and fault scripts

Each script or injector shows one failure path or one fix on demand, outside the regular suites.

- **TST-040** Standalone proof, smoke and audit scripts: run e2e fault injectors (anniversary status filter, departure signal fault, network isolation) in headless Chromium against a local fixture server, smoke test the hosting container (setup, pairing, revocation, restart persistence), prove the native renderer observer records a real long task, and audit monster spawn records against trusted game data. Code (17 functions): `scripts/departure-signal-fault-proof.cjs`, `tools/hosting/smoke.mts`, `tools/testing/prove-native-renderer-observer.cjs`, `scripts/anniversary-status-filter-proof.cjs`, `scripts/audit-monster-spawns.cjs`, `scripts/native-network-isolation.cjs`.
- **TST-041** Replay and proof scripts: replay captured Cave forward rejoin, combat recovery and native planner slice fixtures offline, and prove live CODE reload through a telemetry revision swap. Code (31 functions): `tools/game/replay-cave-forward.cjs`, `tools/game/replay-combat-recovery.cjs`, `tools/game/replay-native-planner-slices.cjs`, `tools/game/verify-live-reload.mts`.
- **TST-042** Native fault injectors: declared one-shot faults in the real CODE or browser transport, such as terminal convoy settlement response loss, a gated ajax input, a historical anniversary handoff and delayed departure signals. Code (24 functions): `e2e/anniversary-status-fault.ts`, `e2e/departure-signal-fault.ts`, `e2e/native-ajax-input.ts`, `e2e/native-terminal-settlement-fault.ts`.
- **TST-043** Console dependency update proof: in Docker, shows a legacy dependency cache with links is refused and retained, then a dashboard-only candidate deploys through the build routes without touching the game lifecycle. Code (7 functions): `e2e/fixtures/console-dependency-update.mjs`.

## 2. What goes wrong

M1.

## 3. Fork differences

M1.

## 4. Tests today

M1.

## 5. Needs your review

M1.

## 6. The design

M1.

## 7. What changes for the player

M1.

## 8. Proof

M1.

## 9. Migration

M1.

## 10. Gaps

`LIMIT=100000 node tools/check-claims.mjs` (run 2026-10-26), filtered to 15-testing, with
the per-spec counts from the command in `docs/implementation/02-coverage.md`:

- Functions claimed: 1,327 in 43 behaviours. Unclaimed functions in the whole index: 0.
- Claims naming no known function: 0. Claimed by more than one spec: 0.
- Behaviours with no test: all 43 (TST-001 to TST-043). For test infrastructure the proof is
  the suites that use it; which unit and e2e files use each harness is not yet mapped.

Not yet verified or not covered:

- One pass placed these functions after reading their code; no second pass has checked the
  grouping or the summaries against the code.
- Sections 2 to 9 are M1.
