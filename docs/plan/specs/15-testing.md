# 15. Testing

The test infrastructure: unit test harnesses, the simulator, the virtual clock, end-to-end
fixtures, debug instances, benchmarks, profiling, and proof and fault scripts. Spec prefix
`TST`. `tools/function-index.mjs` skips the tests themselves (`*.test.cjs`, `*.spec.ts`,
`*.case.ts`, its `SKIP` pattern), so no spec claims them as functions; each catalog maps
tests to behaviours in its `tests` field instead.

Checked against the current console `refs/review/ryan-1.5` (`b9b5c91e`) in
(local checkout). `docs/implementation/11-verification-15.md` records
the claim-by-claim check of this page.

Commands used for counts. `R` is `git -C (local checkout) archive
refs/review/ryan-1.5` extracted to a scratch folder; `C` is
(local checkout), a clean worktree at `b9b5c91e` with its
dependencies installed. Plan commands run from (local checkout).

- Playwright inventory: `npx playwright test --list` in `C` (no game setup runs for a
  listing), plus `-c playwright.profile.config.ts` and `-c
  playwright.coordinator-profile.config.ts`.
- Test declarations: a TypeScript-parser count of `test(` calls whose first argument is a
  string or template (`count-tests.cjs`, quoted in the verification log), over
  `R/scripts/tests/*.test.cjs`, `R/e2e/*.spec.ts` and `R/e2e/*.case.ts`.
- File counts: `grep -l` over `R/scripts/tests/*.test.cjs`, quoted where used.
- Claims: `node tools/check-claims.mjs`.

## 1. What it does today

53 behaviours claim 1,327 functions in 135 files.

The current suites, recounted on `b9b5c91e`:

| Kind | Files | Tests | Command |
|---|---|---|---|
| E2E, default config | 102 spec files and 22 case files | 400: console 141, live 256, debug 2, speed 1 | `npx playwright test --list` ("Total: 400 tests in 124 files") |
| E2E, separate configs | 2 spec files | 2 profiling runs | the two `-c` listings above |
| E2E, opt-in | 1 spec file | 1, only with `RUN_DOCKER_DEPENDENCY_UPDATE=1` | console-build-docker-dependencies.spec.ts:8 |
| Unit (node:test) | 453 files | 3,184 `test(` declarations; 200 of them sit inside loops in 103 files, so the executed count is higher and only a run gives it | parser count |

105 spec files and 22 case files exist (`find e2e -name '*.spec.ts'`, `'*.case.ts'`). Case
files hold their own `test(` calls (43 declarations, all listed; two skip themselves on the
native backend) and run through the spec that imports them: 21 through console.spec.ts and
one through live-game.spec.ts. Playwright lists case tests under the case file. The 105 spec
files hold 276 declarations; 45 of them sit inside loops, which expand to the 357 listed
spec-file tests plus the 3 tests outside the default listing. The earlier
figures of 350 E2E tests and 3,024 unit tests came from line counts:
`grep -cE '^\s*test\('` over the concatenated unit files gives 3,024; no line-count variant
over the E2E files gives 350 (255 to 366, depending on the pattern).

### Unit test harnesses

The unit tests in `scripts/tests/*.test.cjs` run under `node --test` (package.json
`test:unit`, concurrency 2; `test:unit:ci`, concurrency 4 with TAP). 133 of the 453 files
use a helper from `scripts/tests/helpers/` (`grep -l "helpers/"`); 350 require at least one
TypeScript source directly (`grep -lE "require\([^)]*(runtime|tools|dashboard)/[^)]*\.(ts|tsx|mts)['\"]"`).
The current character code is one closure, so TST-001 and TST-009 cut single functions out of
`characters/shared.js` text; spec 13, "Test harness patterns", gives the counts and the
guards this causes. The coordinator helpers in TST-004 to TST-007 bind the production
services onto one legacy test context, so a test calls the real service through the names it
had before the services were split out of application.ts.

- **TST-001** Cut named production functions out of characters/shared.js into a vm context:
  `namedFunction` returns one function declaration's text found with the TypeScript parser
  (named-function.cjs:4-14); `createSharedContext` also loads 10 real shared.js functions,
  the console drain gates among them (shared-context.cjs:9-22); `passingContext`,
  `productionJournalContext` and `merchantGuards` evaluate hand-picked shared.js functions
  over stubbed state (client-dependencies.cjs:11-61). Code (20 functions):
  `scripts/tests/helpers/client-dependencies.cjs`, `scripts/tests/helpers/named-function.cjs`,
  `scripts/tests/helpers/shared-context.cjs`.
- **TST-044** Pinned game file loaders: `downloadedGameSource` reads a game file from the
  versions listed in `scripts/tests/fixtures/game/manifest.json` under `.caracal/game_files`
  (downloaded-game.cjs:8-16); `installGameGeometry` installs the game collision code by
  slicing `old_common_functions.js` between function-name markers (game-geometry.cjs:15-17).
  Code (3 functions): `scripts/tests/helpers/downloaded-game.cjs`,
  `scripts/tests/helpers/game-geometry.cjs`.
- **TST-002** Coordinator host smoke harness: `run` boots the transpiled application.ts, the
  built `.build/runtime/coordinator-application.cjs`, or that bundle behind the caracAL
  launcher template, in a vm with stubbed require, express, account, clock, timers and
  process signals, and asserts that startup reached the account listener with no "failed to
  start caracAL" error (coordinator-host.cjs:12-71). A worker fork throws, so it covers an
  empty roster only (:41). Code (35 functions): `scripts/tests/helpers/coordinator-host.cjs`.
- **TST-045** Coordinator source transpiler: `coordinatorSource` transpiles
  runtime/coordinator/application.ts to CommonJS text (coordinator-source.cjs:7-19). TST-002
  runs that text; 20 test files cut single functions out of it by `indexOf` markers, for
  example bankboi-scheduler.test.cjs:117 (`grep -l "coordinator-source"`). Code (1 function):
  `scripts/tests/helpers/coordinator-source.cjs`.
- **TST-003** Coordinator HTTP, public state and worker fixtures: a fake router that invokes
  handlers with a recording request and response (coordinator-http.cjs:1-14), the real
  public state route over a seeded party (coordinator-public-state.cjs:1-26), and the real
  character manager with a fake fork, clock and logs (coordinator-workers.cjs:3-14). Code (52
  functions): `scripts/tests/helpers/coordinator-http.cjs`,
  `scripts/tests/helpers/coordinator-public-state.cjs`,
  `scripts/tests/helpers/coordinator-workers.cjs`.
- **TST-004** Wire production coordinator travel services onto a legacy test context: party
  convoys, the convoy engagement, convoy acknowledgement and farming return routes
  (coordinator-convoy-routes.cjs:1-3), farm area navigation and farming route authorization;
  `observeTravel` makes each status's `currentAttackersAt` follow its `seenAt`
  (travel-observations.cjs:2-8). Code (52 functions):
  `scripts/tests/helpers/coordinator-convoy-routes.cjs`,
  `scripts/tests/helpers/coordinator-convoys.cjs`,
  `scripts/tests/helpers/coordinator-farm-areas.cjs`,
  `scripts/tests/helpers/coordinator-farming-authorization.cjs`,
  `scripts/tests/helpers/travel-observations.cjs`.
- **TST-005** Wire production event and anniversary services onto a legacy test context:
  event returns, event acknowledgement routes, anniversary returns and anniversary navigation
  routes. Code (69 functions): `scripts/tests/helpers/coordinator-anniversary-navigation.cjs`,
  `scripts/tests/helpers/coordinator-anniversary.cjs`,
  `scripts/tests/helpers/coordinator-event-acknowledgements.cjs`,
  `scripts/tests/helpers/coordinator-events.cjs`.
- **TST-006** Wire production hunt services onto a legacy test context: hunt lifecycle,
  convoy, quests and tick, the hunt mode route and the monster selection routes, with every
  port bound to context functions. Code (80 functions):
  `scripts/tests/helpers/coordinator-hunt-mode.cjs`, `scripts/tests/helpers/coordinator-hunt.cjs`,
  `scripts/tests/helpers/coordinator-monster-selection.cjs`.
- **TST-007** Merchant coordinator fixtures: the dispatcher runtime with a seeded party and
  recorded effects, a sample job (coordinator-dispatch.cjs:3-58), the merchant queue and
  merchant idle adapters over the legacy context (coordinator-merchant.cjs,
  coordinator-idle.cjs), and a job completion fixture with recorded ports and timers
  (coordinator-completion.cjs:2-34). Code (98 functions):
  `scripts/tests/helpers/coordinator-completion.cjs`,
  `scripts/tests/helpers/coordinator-dispatch.cjs`,
  `scripts/tests/helpers/coordinator-merchant.cjs`, `scripts/tests/helpers/coordinator-idle.cjs`.
- **TST-008** Character runtime fixtures: a bank stack service over a fake bank with swap,
  store, retrieve and split (bank-stacks.cjs:3-47), and a skill world with a seeded actor, a
  hand-written skill table, monsters, allies, cooldowns and recorded casts
  (skill-world.cjs:2-41). Code (47 functions): `scripts/tests/helpers/bank-stacks.cjs`,
  `scripts/tests/helpers/skill-world.cjs`.
- **TST-009** Native convoy runtime: runs the game `smart` object sliced from the newest
  installed `runner_functions.js` and the convoy section sliced from shared.js between
  `function convoySignalExpired(` and `var kiteState =` (native-convoy-runtime.cjs:7-12) in a
  vm with a fake character, timers, sockets and movement plan, and drives start, ready, tick
  and cancel. Code (52 functions): `scripts/tests/helpers/native-convoy-runtime.cjs`.
- **TST-010** Dashboard unit test loaders: an esbuild loader that compiles
  `dashboard/features/party` modules for node:test (dashboard-query-module.cjs:5-12), and a
  reader that reassembles the declarations listed in
  `scripts/tests/fixtures/dashboard-modules.json` for source-slicing assertions; its own
  header calls it a temporary adapter (dashboard-source.cjs:1-2). Code (3 functions):
  `scripts/tests/helpers/dashboard-query-module.cjs`, `scripts/tests/helpers/dashboard-source.cjs`.

`scripts/tests/helpers/installed-game.cjs` picks the newest version under
`.caracal/game_files`; it has no named function, so no behaviour claims it. Seven unit files
and the TST-041 replays use it (`grep -l installed-game`).

What the unit harnesses prove, and their weaknesses:

- A test that uses TST-001, TST-009, TST-044 or TST-045 proves that a piece of source text,
  cut out at test time and run against stubs, returns what the test asserts. It does not
  prove the production wiring around that text. 122 unit files run shared.js text this way
  (`grep -lE "shared\.js|helpers/(shared-context|client-dependencies|named-function|native-convoy-runtime)"`),
  and 20 run text cut out of application.ts. A renamed or moved marker breaks the test for a
  reason unrelated to behaviour, and a stub can disagree with the dependency it replaces.
  AGENTS.md:40-41 forbids source-text assertions in place of observable behaviour; spec 13
  LIF-W4 lists the production guards this practice leaves behind.
- TST-004 to TST-007 run the real services, but with ports the helpers wire. A wiring error
  in application.ts does not show in these tests.
- TST-009, the TST-041 replays and the seven installed-game unit files read the newest game
  version in the local `.caracal/game_files`, not the pinned manifest that TST-044 uses, so
  their result depends on the local cache.
- TST-008's skill table is hand-written (skill-world.cjs:8-31), not read from game data.
- Wall-clock assertions make a few results depend on machine speed, for example
  coordinator-persistence-writer.test.cjs:84 (exit before `HISTORY_SAVE_MS`),
  coordinator-crash-recovery.test.cjs:119 (reopen under 15 s) and
  live-restart-readiness.test.cjs:20 (under 1 s). docs/testing.md:110-115 lists
  CPU-sensitive deadlines among the risks of higher unit concurrency. These three come from
  a grep for `Date.now()` differences inside asserts; no full audit exists.
- scripts/tests/steam-bridge.test.cjs reports all 11 results (8 pass, 3 fail: tests 5, 6
  and 9) and then never exits: `timeout 180 node --test --test-reporter=tap
  scripts/tests/steam-bridge.test.cjs` in `C` ended with exit 124 after 180 s. A whole-suite
  run waits on that file until something kills it. Test 6 asserts a pixel position
  (`'597px'`, steam-bridge.test.cjs:82), a layout check in place of observable behaviour.

### Simulator

`tools/sim` runs the real coordinator and character code against the game's own `server.js`
on the ChronAL virtual clock, with caracAL replaced by stand-ins (`tools/sim/README.md`). It is
a standalone soak tool (`npm run sim`), not part of `npm test`.

- **TST-011** Simulator coordinator host: runs the coordinator bundle in a vm context on the
  ChronAL virtual clock with a virtual process, captured Express and an in-process route
  planner worker. Code (27 functions): `tools/sim/host/coordinator.cjs`.
- **TST-012** Simulator caracAL stand-ins: logging, account, game file cache, config and bot
  web interface replacements, so a run never reads the user caracAL install. Code (25
  functions): `tools/sim/host/caracal.cjs`.
- **TST-013** Simulated character: boots a ChronAL game client with caracAL extensions,
  IPC-backed storage and the real CODE through the runner host. Code (32 functions):
  `tools/sim/host/character.cjs`.
- **TST-014** Simulator worker hosts: the in-process single-thread character worker and the
  threaded lockstep client threads that carry caracAL IPC and CODE HTTP. Code (37 functions):
  `tools/sim/host/character-worker.cjs`, `tools/sim/host/client-thread.cjs`,
  `tools/sim/host/threaded.cjs`.
- **TST-015** Simulator plumbing: a vm context and require on the virtual clock for repository
  modules, and CODE XHR and fetch dispatched into the captured Express app with virtual
  latency. Code (28 functions): `tools/sim/host/clocked-require.cjs`,
  `tools/sim/host/transport.cjs`.
- **TST-016** Simulation runner: stages CODE, boots server, coordinator and characters, runs
  the scenario's `farm` and `hunt` steps (run.cjs:228-229), samples the timeline, traces
  windows and writes the report with deaths and kills. Code (37 functions):
  `tools/sim/observe.cjs`, `tools/sim/run.cjs`.
- **TST-017** Simulator scenario validation and the interactive Playwright session, whose
  `state`, `post`, `admin`, `run` and bounded `advance` commands run one at a time; only
  `advance` moves virtual time (session.cjs:2, 19-45). Code (16 functions):
  `tools/sim/scenario.cjs`, `tools/sim/session.cjs`.
- **TST-018** Simulator setup: pins the ChronAL checkout and game repositories under
  `.build/sim/chronal` and adapts the ChronAL 0.10.0 installer for Windows
  (install.cjs:2, 25-53). Code (8 functions): `tools/sim/install.cjs`, `tools/sim/setup.mts`.

`tools/sim/verify.cjs` (`npm run sim:verify`) checks a run's hashed manifest; it has no named
function, so no behaviour claims it.

What it proves: a long run of the real coordinator and CODE against the real game server is
deterministic for a build, scenario and seed (README.md "How it works"). Weaknesses: no
browser and no caracAL, Express is captured instead of listening, the route planner runs
in-process and takes no virtual time, and four scenarios exist (`tools/sim/scenarios/`:
boot, farm-goo, phoenix-farm, benchmark-goo). No test runs the simulator.

### Virtual clock

One virtual clock paces the coordinator, the character processes and the browser pages in the
simulator and in the ChronAL E2E backend. `e2e/game/setup.mjs:29-40` selects ChronAL for the
live project unless `E2E_GAMEPLAY_BACKEND=native`, at rate 4 by default; the broker accepts a
rate above 1 and up to 1024 (network-clock-broker.mts:26) with a 250 ms window (:27). The
console project does not use the clock.

- **TST-019** E2E network clock: the broker paces one bounded gameplay timeline, and each Node
  actor installs the ChronAL clock, joins at the current instant and reports in-flight native
  party-api I/O. Code (39 functions): `tools/sim/join-clock.cjs`, `tools/sim/native-io.cjs`,
  `tools/sim/network-clock-broker.mts`, `tools/sim/network-clock.cjs`.
- **TST-020** E2E network clock timers: Node timers with refresh, ref and unref, and window
  timers and animation frames on the virtual clock. Code (22 functions):
  `tools/sim/network-timers.cjs`.
- **TST-021** E2E browser clock: a bundled ChronAL clock for game and CODE pages that joins
  the broker over a WebSocket, keeps native rendering and drains microtasks through a native
  task queue. Code (17 functions): `tools/sim/browser-clock.cjs`,
  `tools/sim/browser-task-queue.cjs`, `tools/sim/build-browser-clock.mts`.
- **TST-022** Gameplay clock adapters: gameplay-time polls and waits, a ChronAL-aware poll,
  the host observation clock and browser script gating until the ChronAL clock has joined.
  Code (17 functions): `e2e/chronal-browser-startup.ts`, `e2e/gameplay-clock.ts`,
  `e2e/network-clock.ts`.

What it proves: the live scenarios run gameplay waits faster than real time with real
sockets, MongoDB and browsers. Weaknesses: real XHR keeps native time
(network-clock-broker.mts:159-160), so a bug that depends on real-time spacing needs the
native backend, which runs only on demand (docs/testing.md:771-781, the manual "Native game
E2E" workflow). Two tests cover the clock itself (chronal-clock-reconnect.case.ts).

### End-to-end fixtures

The Playwright suites in `e2e/*.spec.ts` run on two kinds of fixture. The console fixtures
start the dashboard candidate with a fixture coordinator and scripted status heartbeats. The
live fixtures start the production coordinator against a disposable upstream game server and
log in the unmodified game client.

- **TST-023** Console E2E coordinator process: runs the real coordinator application with a
  simulated caracAL account, game fetch and fixed-roster adapters, and posts deterministic
  W/P/M status heartbeats built from pinned game data. The game fixture states that it
  executes no game clients, movement, trades or upgrades (game-fixture.cjs:1-2). Code (39
  functions): `e2e/coordinator.cjs`, `e2e/game-fixture.cjs`.
- **TST-024** Console Playwright fixtures: start the dashboard candidate, gateway and fixture
  coordinator per scenario, seed the journal, deliver status, restart or crash the
  coordinator, block non-loopback requests (fixtures.ts:207-210) and remove the owned
  workspace. Code (23 functions): `e2e/fixtures.ts`, `e2e/state-route.ts`, `e2e/workspace.ts`.
- **TST-025** Live coordinator process: runs the production coordinator against the
  disposable upstream server, caches native assets, stages CODE, records declared
  observations and holds merchant status while the marker files `hold-merchant-status` or
  `hold-merchant-inventory` exist (live-coordinator.cjs:89-91). Code (23 functions):
  `e2e/live-coordinator.cjs`.
- **TST-026** Live Playwright fixture: resets the disposable game, seeds loadouts and
  positions, starts the live coordinator, gateway and denial proxy, logs in native browser
  clients, exposes state, post, admin, holds and restarts, waits for a valid gateway state
  after a restart, and attaches final evidence. Code (34 functions): `e2e/live-fixtures.ts`,
  `e2e/live-restart-readiness.ts`, `e2e/native-network-isolation.ts`.
- **TST-027** Native game client driver: opens the unmodified upstream browser client, runs
  the production CODE loader, records socket events and outgoing packets, and reads snapshots
  or runs expressions in the CODE frame. Code (16 functions): `e2e/live-game-client.ts`.
- **TST-028** Disposable upstream game server: Docker compose pools, container boot with Mongo
  lease cleanup, account bootstrap, per-scenario world reset, admin eval and the global setup
  that builds the candidate and starts the clock broker. Code (20 functions):
  `e2e/game/addresses.cjs`, `e2e/game/boot.cjs`, `e2e/game/bootstrap.cjs`,
  `e2e/game/manage.mjs`, `e2e/game/setup.mjs`.
- **TST-029** Live scenario seed and evidence helpers: gear loadouts, start positions, seeded
  quests, rare and event spawns, Goobrawl sizing, death faults, ambient monster isolation and
  kill or token evidence read from the native server. Code (36 functions):
  `e2e/game/event-scenario.ts`, `e2e/game/event-spawn.ts`, `e2e/game/hunt-events.ts`,
  `e2e/game/hunt-lifecycle.ts`, `e2e/game/loadouts.ts`, `e2e/hunt-interruption-helpers.ts`,
  `e2e/native-map-ambient-isolation.ts`.
- **TST-030** Shared gameplay scenarios: solo ranger, Ice Roamer, Boo Boo, follower reward,
  convoy, unequal quests and goo Hunt, written once against a gameplay world so the same
  assertions run on the ChronAL and native backends (gameplay-clock.ts:6-15). Four live
  specs import them. Code (13 functions): `e2e/gameplay-scenarios.ts`.
- **TST-031** Native passive observers: bounded records of Cave combat, navigation barrier
  traffic, planner ownership, CODE status ajax and CDP transport timing, plus a progress
  budget for long native waits. Code (29 functions): `e2e/native-cave-combat-observer.ts`,
  `e2e/native-navigation-http-observer.ts`, `e2e/native-planner-observation.ts`,
  `e2e/native-progress-budget.ts`, `e2e/native-status-observer.ts`,
  `e2e/native-transport-observer.ts`.
- **TST-032** E2E artifact reporter: records run provenance and a reproduction patch, writes
  each attachment to a file with an outcome ledger and boundary, and writes a hashed report
  manifest. Code (7 functions): `e2e/artifact-reporter.cjs`.

`e2e/verify-artifacts.cjs` (`npm run test:e2e:verify`) checks that manifest: every selected
scenario has an outcome, every evidence hash matches, and nothing failed or skipped
(verify-artifacts.cjs:5-20). It has no named function, so no behaviour claims it.

What the E2E fixtures prove, and their weaknesses:

- Console project (TST-023, TST-024): the real coordinator, dashboard and gateway answer real
  HTTP from a real browser. The game side is scripted status, so these tests prove no
  combat or movement (docs/testing.md:604-606).
- Live project (TST-025 to TST-031): the production coordinator and CODE act in the
  unmodified browser client against the upstream server, and the reporter keeps hashed
  evidence. Weaknesses: the characters run as browser clients, while the live party runs
  most characters as caracAL headless workers; only live-cave-headless.spec.ts uses headless
  workers (docs/testing.md:51-62). The server is local, so public realms and Steam stay
  outside (docs/testing.md:590-591). Admin calls set up encounters. A full run needs the
  Docker game pools. 24 `waitForTimeout` sleeps sit in 7 E2E files (`grep -o
  "waitForTimeout(" e2e/*.ts`); AGENTS.md:35 forbids sleeps for asynchronous state, and
  these are not reviewed one by one here.
- docs/testing.md:402 still says the inventory holds 286 scenarios (78 console, 2 debug, 206
  gameplay); the listing on `b9b5c91e` holds 400.

### Debug instances

A disposable stack for looking at a problem by hand, started from the main console.

- **TST-033** Debug instance: the main console starts a disposable Docker stack (database,
  local game server, console) with a seeded god party, reachable only through a
  token-authenticated gateway with a noVNC game viewer, and destroys it on stop. The debug
  E2E runs that gateway in a container as the unprivileged Docker user
  (debug-container-host.mts:1-14). Code (36 functions): `tools/debug/desktop.ts`,
  `tools/debug/docker-access.ts`, `tools/debug/gateway.ts`, `tools/debug/instance.mts`,
  `tools/debug/process.ts`, `tools/debug/service.ts`, `tools/debug/viewer.ts`,
  `e2e/debug-container-host.mts`.

### Benchmarks and profiling

These tools measure cost. Two more benchmark behaviours sit in spec 12, because they measure
the dashboard and the metrics journal: DSH-018 (`scripts/benchmark-dashboard-*.cjs`) and
DSH-066 (`tools/benchmark-metrics-journal.mts`). `scripts/benchmark-formation.cjs` slices the
fixture header out of priest-formation.test.cjs (:3-5) and has no named function.

- **TST-034** E2E backend benchmarks: native versus ChronAL suite comparison
  (`npm run test:e2e:benchmark`), an executed CODE parity check across both archives, and a
  clock rate sweep that doubles the requested rate until speed stops improving. Code (9
  functions): `tools/sim/e2e-benchmark.mts`, `tools/sim/e2e-code-parity.mts`,
  `tools/sim/e2e-rate-benchmark.mts`.
- **TST-052** E2E selection audit (`npm run test:e2e:selection`): lists the suite with
  Playwright for both backends and fails unless every scenario identity is selected exactly
  once (check-selection.mts:1, 13-40). Code (3 functions): `tools/sim/check-selection.mts`.
- **TST-053** Simulator benchmark (`npm run sim:benchmark`): runs one simulator scenario as a
  paced baseline, a fast replay and a traced replay, and writes a hashed manifest over the
  three run directories (benchmark.cjs:2, 79). Code (1 function): `tools/sim/benchmark.cjs`.
- **TST-035** Pathfinder benchmark runner: builds the route corpus, downloads and bundles the
  pinned ALClient planner in a separate setup step, and measures native and ALClient queries
  in isolated workers with sampling plans. Code (33 functions):
  `tools/game/pathfinder-benchmark/corpus.cjs`, `tools/game/pathfinder-benchmark/run.cjs`,
  `tools/game/pathfinder-benchmark/sampling.cjs`, `tools/game/pathfinder-benchmark/setup.cjs`,
  `tools/game/pathfinder-benchmark/worker.cjs`.
- **TST-036** Offline native planner: runs the installed game smart_move planner in a vm with
  movement and network forbidden, and validates routes step by step for collisions, doors,
  transporters and Town. Code (22 functions): `tools/game/pathfinder-benchmark/native.cjs`,
  `tools/game/pathfinder-benchmark/transition-validation.cjs`,
  `tools/game/pathfinder-benchmark/validate.cjs`, `tools/game/pathfinder-benchmark/verify.cjs`.
- **TST-037** Pathfinder benchmark report: medians, nearest-rank quantiles, paired
  comparisons, plots and CSV appendices for the ALClient and native planner runs. Code (15
  functions): `tools/game/pathfinder-benchmark/report.cjs`.
- **TST-048** alpathfinder collision benchmark (`npm run benchmark:movement`): compares
  alpathfinder 0.6.0 collision answers and timing with the installed game's collision check
  on 1,000 seeded samples per map, and writes `.build/benchmarks/pathfinder.json`
  (benchmark-pathfinder.mts:44-108). Code (3 functions): `tools/game/benchmark-pathfinder.mts`.
- **TST-038** Persistence benchmark: drives the coordinator persistence writer and journal at
  live event rates under node:test mock timers and reports disk bytes, fsyncs, compactions
  and call times. Code (11 functions): `tools/benchmark-persistence.mts`.
- **TST-039** Node process profiling: SIGUSR2 preloads for the live coordinator and the
  CharacterThread processes, a cpuprofile reader and a per-process run summary (CPU share,
  RSS, event-loop delay). Code (26 functions): `e2e/profiling/coordinator-profile-preload.cjs`,
  `e2e/profiling/profile-report.cjs`, `e2e/profiling/run-summary.cjs`,
  `e2e/profiling/thread-profile-preload.cjs`.
- **TST-047** In-browser diagnostics for live scenarios: native-wall CPU accounting for a
  rendering comparison, a passive native planner CPU profile, bounded renderer long-task
  observations, and an opt-in companion graphics experiment that rewrites only opted-in bot
  requests. Code (15 functions): `e2e/native-graphics-diagnostic.ts`, `e2e/browser-rendering.ts`,
  `e2e/native-planner-cpu-profile.ts`, `e2e/native-renderer-observer.ts`.
- **TST-046** Character card replay: renders the connected character card components with
  react-test-renderer and stubbed leaf controls, and counts card, inventory, map and status
  renders per data update (dashboard-card-replay.cjs:1-2). Only
  `scripts/benchmark-dashboard-optimizations.cjs:5` (DSH-018) uses it; no test does. Code (17
  functions): `scripts/tests/helpers/dashboard-card-replay.cjs`.

What they prove: each reports measured cost for one workload. Weaknesses: most set no pass
threshold; tools/benchmark-persistence.mts has no assert or throw (`grep -c
"assert\|throw"` gives 0), so a regression shows only when someone compares two reports.
TST-048 states that it does not prove path correctness (benchmark-pathfinder.mts:103).

### Proof and fault scripts

Each script or injector shows one failure path or one fix on demand, outside the regular
suites.

- **TST-040** Standalone fault proofs: each script runs one e2e fault injector (anniversary
  status filter, departure signal fault, native network isolation) or the native renderer
  observer in headless Chromium against a local fixture server and asserts the injected
  effect. Code (11 functions): `scripts/departure-signal-fault-proof.cjs`,
  `tools/testing/prove-native-renderer-observer.cjs`,
  `scripts/anniversary-status-filter-proof.cjs`, `scripts/native-network-isolation.cjs`.
- **TST-049** Hosting container smoke test: starts a container from an image, then checks
  setup, pairing, cookie revocation and that the paired state survives `docker restart`
  (smoke.mts:26-63). Code (3 functions): `tools/hosting/smoke.mts`.
- **TST-050** Monster spawn audit: a read-only check of the spawn records against the locally
  installed game data that scans every map (audit-monster-spawns.cjs:1-3). Code (3
  functions): `scripts/audit-monster-spawns.cjs`.
- **TST-041** Offline replay scripts: replay captured Cave forward rejoin, combat recovery and
  native planner slice fixtures against the newest installed game files (installed-game.cjs).
  Code (27 functions): `tools/game/replay-cave-forward.cjs`,
  `tools/game/replay-combat-recovery.cjs`, `tools/game/replay-native-planner-slices.cjs`.
- **TST-051** Live CODE reload proof: against the console answering on 127.0.0.1:924, it
  publishes a copy of one class artifact with only its telemetry revision changed, waits up
  to 30 s for that character to report the new revision, then republishes the original
  manifest (verify-live-reload.mts:11-65). It acts on whichever console runs on that port,
  including a live party. Code (4 functions): `tools/game/verify-live-reload.mts`.
- **TST-042** Native fault injectors: declared one-shot faults in the real CODE or browser
  transport, such as terminal convoy settlement response loss, a gated ajax input, a
  historical anniversary handoff and delayed departure signals. Code (24 functions):
  `e2e/anniversary-status-fault.ts`, `e2e/departure-signal-fault.ts`, `e2e/native-ajax-input.ts`,
  `e2e/native-terminal-settlement-fault.ts`.
- **TST-043** Console dependency update proof: in Docker, shows a legacy dependency cache with
  links is refused and retained, then a dashboard-only candidate deploys through the build
  routes without touching the game lifecycle. Its spec runs only with
  `RUN_DOCKER_DEPENDENCY_UPDATE=1` (console-build-docker-dependencies.spec.ts:7-8). Code (7
  functions): `e2e/fixtures/console-dependency-update.mjs`.

`scripts/ci/check-regression.cjs` (the strict TAP checker: every test must pass, none
skipped, :3-20) and `scripts/ci/restore-game-fixtures.cjs` hold named functions, but
`tools/function-index.mjs` does not index `scripts/ci/` (its `SCOPE` pattern covers
`scripts/*` and `scripts/tests/**` only).

## 2. What goes wrong

M1.

## 3. Fork differences

M1.

## 4. Tests today

This section lists the current suites by kind, with what each kind exercises. The counts are
from section 1. Each label names what the kind proves and what it leaves out, in the form
`00-method.md` asks for.

### Tests of the infrastructure itself

The catalog maps these 26 tests to TST behaviours; the other 42 behaviours have no direct
test, and the suites that use them are their only proof.

| Test | Behaviour |
|---|---|
| chronal-clock-reconnect.case.ts, 2 tests | TST-019, TST-021 |
| live-restart-readiness.test.cjs, 3 tests | TST-026 |
| native-e2e-progress-budget.test.cjs, 5 tests | TST-031 |
| debug-instance.spec.ts, debug-container.spec.ts | TST-033 |
| pathfinder-benchmark.test.cjs, 7 tests | TST-035, TST-036, TST-037 |
| profile-coordinator.spec.ts, profile-character-threads.spec.ts | TST-039 |
| console-build-docker-dependencies.spec.ts (opt-in) | TST-043 |
| native-graphics-diagnostic.spec.ts | TST-047 |

### Inventory by kind

| Kind | Size on b9b5c91e | Label: proves | Label: leaves out |
|---|---|---|---|
| E2E console (Playwright project `console`) | 141 tests: 100 in 26 spec files, 41 in 21 case files imported by console.spec.ts | Dashboard, gateway and the real coordinator over real HTTP in Chromium; persistence and restarts of the fixture coordinator; console builds | Game clients, movement, combat, trades (scripted status only, game-fixture.cjs:1-2); no virtual clock |
| E2E live on ChronAL (project `live`) | 256 tests: 254 in 73 spec files, 2 in chronal-clock-reconnect.case.ts | Production coordinator and CODE in the unmodified browser client against the upstream server and MongoDB, at virtual rate 4; restarts, network faults, deployment | Headless caracAL workers (except live-cave-headless.spec.ts), public realms, Steam, real-time spacing (native backend only on demand) |
| E2E other projects | debug 2, speed 1 (field-registry-speed.spec.ts, on demand), profiling 2 (separate configs), Docker dependency 1 (opt-in) | Debug stack lifecycle; field registry latency; CPU profiles; dependency cache recovery | Pass thresholds for speed and profiling |
| Unit (node:test, `npm run test:unit`) | 453 files, 3,184 declarations | One module or one sliced function against stubs or fakes; 350 files import TypeScript sources directly | Production wiring for sliced code (122 files run shared.js text, 20 run application.ts text, 3 use the dashboard legacy reader); some depend on the local game cache; steam-bridge.test.cjs never exits |
| Simulator soak (`npm run sim`) | 4 scenarios, no test runs it | Long deterministic runs of the real coordinator and CODE against server.js | Browser, caracAL, real HTTP |
| Benchmarks | TST-034 to 038, 046, 048, 052, 053; DSH-018 and DSH-066 in spec 12; scripts/benchmark-formation.cjs | Cost of one workload (time, bytes, renders, collisions) | Pass thresholds; most report numbers only |
| Proof and fault scripts | TST-040, 041, 049, 050, 051; injectors TST-042 used inside live specs | One failure path or one fix, on demand | Regular runs; TST-051 acts on the console on port 924 |

### Mapping status across the catalogs

A `node -e` count over `catalog/[0-9][0-9]-*.json` (each `tests` entry is a `file::title`
string) gives 1,048 behaviours, 840 with at least one test, and 3,776 test references naming
2,821 distinct tests. 2,641 of those are unit tests in 416 files; 180 are E2E tests (142 from
62 spec files, 38 from 20 case files). Every referenced file exists, and 3,775 of the 3,776
titles match the file text on their first 40 characters. No tool checks the references.

## 5. Needs your review

1. **How the baseline run is recorded.**
   - Today: no recorded full run exists on `b9b5c91e`. docs/testing.md gives older figures
     (286 scenarios at :402, a 3,166-test unit run at :713) and says such figures aggregate
     separate runs and source snapshots. The E2E reporter writes `manifest.json` with the
     revision, a dirty flag, every outcome and evidence hashes (TST-032), and
     `test:e2e:verify` rejects any failed or skipped test. The unit run writes TAP, and
     scripts/ci/check-regression.cjs rejects anything short of all passing.
     steam-bridge.test.cjs never exits.
   - Options:
     (a) Run `npm test` and `npm run test:unit:ci` as they are and keep the manifest and TAP.
     Negatives: both checkers reject a run with known failures, so a baseline that records
     failures cannot pass them; the TAP names no revision; the unit run waits on the hanging
     file until it is killed.
     (b) A baseline ledger: one row per test (`file::title`, project, backend, result,
     duration, failure reason class, evidence path), built from the Playwright manifest and
     from unit files run one per process with a fixed timeout, plus the revision, Node
     version, lock hashes and commands. Negatives: a new tool to write and keep; one process
     per unit file costs time; a person classifies each failure reason by hand.
     (c) Record only the failing and hanging tests and treat the rest as passing.
     Negatives: a later owner cannot show a test still passes if its first pass was never
     recorded; no durations to compare.
   - Recommendation: (b). It records failures and hangs with a reason and the exact
     revision, which (a) cannot, and it records passes, which (c) does not. Its rows use the
     same `file::title` keys as the catalogs, so questions 2 and 3 and the rerun on each
     owner compare row by row. A per-file timeout turns the steam-bridge hang into a HUNG
     row that keeps its 11 results. Its negatives: the tool itself, and the first full run
     needs the Docker game pools for the live project.

2. **How tests are mapped to behaviours.**
   - Today: the catalogs hold 3,776 free-form `file::title` references (section 4). Nothing
     checks them; `check-claims.mjs` only lists behaviours with an empty `tests` field. 245
     test declarations sit inside loops (200 unit, 45 E2E), so their titles are built at run
     time. 180 of the 2,821 mapped tests are E2E.
   - Options:
     (a) Keep the references in the catalogs and add a check that resolves each one against
     the baseline ledger's test identities, with a pattern form for loop titles. The check
     also lists behaviours whose only proof is an isolated test. Negatives: upstream title
     changes break references; loop titles need a pattern syntax.
     (b) Put behaviour ids into the tests as tags or annotations. Negatives: edits hundreds of
     test files in the current console for plan bookkeeping; the plan does not own those
     files.
     (c) Derive the mapping from code coverage: run each test with V8 coverage and map the
     functions it executes to catalog behaviours. Negatives: running a function does not
     prove its behaviour; shared.js runs on every character test; sliced text has no file
     identity in coverage.
   - Recommendation: (a). It keeps the mapping in one place the plan owns, and the ledger
     from question 1 makes a stale reference fail, which neither (b) nor (c) gives without
     upstream edits or coverage noise. Listing isolated-only behaviours shows where an E2E is
     missing, as AGENTS.md:31 asks. Its negatives: a pattern syntax for loop titles, and a
     first pass to repair references that the 40-character check matched loosely.

3. **How redundant tests are retired.**
   - Today: `00-method.md` step 5 prunes last, keeps at least one proof per behaviour
     (preferably E2E) and lists each retirement with the test that still covers it. The
     current console keeps its own record: docs/testing-replacement-matrix.md (removals by
     observable failure) and docs/testing.md:726-729 (36 unit files and 176 declarations
     removed relative to the PR #21 base). The plan has no retirement table yet.
   - Options:
     (a) Retire per behaviour after its owner lands. A test retires when the ledger shows
     another test proving the same behaviour passed on the new owner, or when it guarded a
     patch the owner removed. A retirement table records the test, reason, covering test and
     run. Negatives: retirement waits for each owner; slicing tests whose text moves break
     during the owner change and need their replacement in that same change.
     (b) Retire up front by static review (slicing, source-text and callback-order tests)
     before any owner exists. Negatives: removes current proof before a replacement exists,
     against `00-method.md` step 5; for some behaviours a slicing test is the only proof.
     (c) Retire nothing and mark redundant tests. Negatives: slicing tests fail for reasons
     unrelated to behaviour once owners move code; run time keeps growing.
   - Recommendation: (a). It is the only option that never leaves a behaviour without a
     passing proof, and it uses the same record shape as the current console's replacement
     matrix. Its negatives: the slower pace, the larger owner changes, and that retiring a
     test in the current console is upstream's decision, so the table is a proposal there.

4. **How isolated tests are allowed under AGENTS.md.**
   - Today: AGENTS.md:30-31 says never write unit tests after the code and prefer E2E as the
     only mechanism; :34 says to write down every way an isolated system could fail before
     the code; docs/testing.md:763-766 adds why the E2E boundary cannot reach those failures.
     The current console keeps 21 failure inventories under e2e/ and tools/sim/ and 289
     docs/testing-*.md files. 122 unit files still run sliced shared.js text, and
     `00-method.md` says isolated tests stop slicing.
   - Options:
     (a) Allow an isolated test only for an owner module that a test can import, with a
     failure list committed before the code that names each failure and why a ChronAL E2E
     with a TST-042 fault injector cannot reach it. Negatives: a squash merge hides the
     commit order, so a reviewer checks it; owners must be importable modules.
     (b) E2E only, no isolated tests. Negatives: some cases (a packet lost in a narrow
     window, hours of drift) are slow or unreachable in E2E even with fault injection.
     (c) Keep the current practice, including shared.js slicing for new tests. Negatives:
     conflicts with `00-method.md`; the tests prove text, not behaviour, and break when code
     moves.
   - Recommendation: (a). It follows AGENTS.md:30-34 and docs/testing.md:763-766 as written,
     keeps E2E with fault injectors as the first choice, and ends slicing because an owner
     module is imported, not cut out. Its negatives: the review step for commit order, and
     the module shape it imposes on owners.

## 6. The design

M1.

## 7. What changes for the player

M1.

## 8. Proof

M1.

## 9. Migration

M1.

## 10. Gaps

`LIMIT=100000 node tools/check-claims.mjs` (run 2026-10-26), filtered to 15-testing:

- Functions claimed: 1,327 in 53 behaviours. Unclaimed functions in the whole index: 0.
- Claims naming no known function: 0. Claimed by more than one spec: 0.
- Behaviours with no test: 42. The 11 with tests are TST-019, 021, 026, 031, 033, 035, 036,
  037, 039, 043 and 047. For the other 42 the proof is the suites that use them; which unit
  and E2E files use each harness is not mapped test by test.

Not yet verified or not covered:

- No full suite run on `b9b5c91e` was made for this page; only steam-bridge.test.cjs ran.
- TST-046 serves only a spec 12 benchmark (DSH-018) and could move there; it stays here while
  spec 12 has uncommitted edits in progress.
- `scripts/ci/` is outside the function index, so the TAP checker and the fixture restore
  script have no claim.
- The wall-clock assertions and the E2E sleeps come from grep; neither list is a full audit.
- Sections 2, 3 and 6 to 9 are M1.
