# 13. Lifecycle

Start, stop, deploy, console maintenance, code reload, the character loader and bundles,
socket listener lifetime, HTTP route plumbing, and the test harness patterns that depend on
how character code is loaded. Spec prefix `LIF`.

Checked against the current console `refs/review/ryan-1.5` (`b9b5c91e`) in
(local checkout). Fork lines are labelled "fork" and cite `HEAD`
(`af92de45`). Line numbers are on those refs. "Inference" marks a claim the code supports
but that no test, log or live run here proves.

Commands used for counts (run from (local checkout), with
`R=(local checkout)): `node tools/shared-guards.cjs $R <ref>`;
`node tools/check-claims.mjs`; test-file counts are `grep -l` runs over
`scripts/tests/*.test.cjs` on the extracted ref, quoted where used.

## 1. What it does today

### Coordinator start

- **LIF-001** `startCoordinatorApplication` (runtime/coordinator/application.ts:32-2497)
  runs one async start in a fixed order: open the journal and migrate old storage, ensure the
  latest game client, read `config.js`, cull unused client versions, log in to the account,
  and pick the configured realm (environment.ts:24-60, called at application.ts:98-118);
  prepare movement geometry (:124-138); build state (:152-162, spec 11); compose every
  service; start web routes (:2249-2410); then start characters (:2479-2493). A failure
  anywhere logs "failed to start caracAL" and the process keeps running with no routes
  (:2494-2496). Module loading goes through `loadCoordinatorDependencies`
  (infrastructure/dependencies.ts:6-116), which requires the built `.build/runtime/*.cjs`
  bundles and the caracAL launcher modules.
- **LIF-002** Game client files: scripts/client-files.cjs downloads the official client
  scripts for a version (adapted from thmsndk/caracAL, :1), discovers them from the game's
  HTML with a fallback list (:7-28), records a revision, and culls versions that no
  character pins (environment.ts:37-41).
- **LIF-003** A game client update (`createClientUpdates`,
  coordinator/characters/client-updates.ts:19-73) runs once at a time. It refreshes, refuses
  an older version (:52), prepares geometry, catalogs and bank vaults for the candidate
  (application.ts:1170-1176), activates them (:1177-1192), then restarts each enabled,
  unpinned worker in turn and waits up to 60 s for a fresh heartbeat on the new version
  (client-updates.ts:28-47). A `reloaded` event during a run triggers one more check (:61-66).

### Character workers (headless)

- **LIF-004** `createCharacterManager.start` (coordinator/characters/manager.ts:127-147)
  resolves the worker's realm; an unknown realm sets `realm-error`, refreshes the account and
  retries in 3 s without picking another realm (:99-111). It resolves the character (a
  missing one disables the worker, :136-141), builds arguments (session, realm address,
  script, class id, a fresh `clientInstance`, `full_cave_floors` for the leader only,
  :56-79), forks `./src/CharacterThread.js` and attaches exit and message handlers
  (:113-125; fork port at application.ts:261-264).
- **LIF-005** `stopWorker` asks a connected worker to close (`closing_client`), waits 500 ms,
  then sends SIGKILL (processes.ts:8-31).
- **LIF-006** A worker exit records `{at, code, signal, reason}`; an exit from a replaced
  worker changes nothing (processes.ts:70-71). An enabled worker restarts 1.5 s after any
  game cache repair finishes (:40-53, :80).
- **LIF-007** Worker IPC (ipc.ts:83-129, messages.ts:61-74): `process_ready` gets the
  arguments; `connected` marks the worker online and sends sibling lists; `bootstrap_failed`
  starts a cache repair; `deploy` and `shutdown` let the game script start or stop a
  character; `cm` routes code messages to local workers directly and remote ones through the
  sender; `stor` is spec 11 SET-014. Messages from a retired worker are dropped (ipc.ts:91).
- **LIF-008** At start, every configured worker is marked disconnected, watched for code
  changes and disabled (startup-slots.ts:24-31). Four seconds later the saved headless slots
  start, skipping characters reserved for Steam and clearing slots for characters no longer
  owned or owned by the native client (:32-47; timer at startup.ts:58). Then the generation
  watch starts (LIF-013) and the account listener subscribes (startup.ts:59-67).
- **LIF-009** `ensure` gives a worker block its realm (spec 09 owns the realm choice), its
  verified class script, its version and a code watcher; `assign` saves a headless slot and
  starts the worker (worker-setup.ts:65-87).

### Stop and shutdown

- **LIF-010** SIGINT, SIGTERM, SIGQUIT or an IPC `coordinator_shutdown` message runs one
  shutdown (runtime-lifecycle.ts:51-68, shutdown.ts:9-20): disable and stop every worker
  (manager.ts:149-156), flush settings in the v1.4.0 layout (spec 11 SET-005), dispose the
  movement planner, close metrics and the journal, exit (application.ts:348-353). A second
  signal does nothing (shutdown.ts:12-13).
- **LIF-011** `createResources` (coordinator/lifecycle/resources.ts:6-31) releases registered
  resources once in reverse order. No production code calls it
  (`git grep createResources refs/review/ryan-1.5` lists resources.ts and one test).

### Code reload

- **LIF-012** Standalone code watch: when `watch_CODE` is on and no managed artifact is set
  (composition.ts:91), an edited legacy (non-generated) script reloads its worker 300 ms later
  (code.ts:68-83, :19-25). The generation digest covers the script plus `farming-zones.js`,
  `shared.js`, `profiles.js` and `roles.js` (code.ts:16, :58). A busy worker retries in
  2 s; a failure that needs recovery restarts the worker (:27-46).
- **LIF-013** Generation watch (`watchGenerations`, runtime/lifecycle/generations.ts:69-152):
  standalone, it watches `manifest.json`; managed (`AL_CONSOLE_ARTIFACT` set), it polls
  `activation.json` every 1 s and accepts a record only after verifying its manifest
  (:129-143). For each live worker whose script changed it sends `reload_code` and waits
  15 s (`requestReload`, request-reload.ts:11-62). `ready` records the new script; `busy`
  retries in 2 s; a failure that needs recovery restarts the worker; other failures keep the
  current runner (generations.ts:94-109).
- **LIF-014** `classScript` accepts a class bundle only when its manifest entry matches
  `generated/<sha256>/<class>.js` and the file hashes to that SHA-256 (generations.ts:13-29).
  Verified files are cached by inode, size and times, at most 32 entries (:31-51).
- **LIF-015** Headless runner host (`createRunnerHost`, runtime/lifecycle/runner-host.ts:54-191):
  the game context and its socket outlive every code generation (:53). A reload compiles and
  prepares the new generation while the old one runs (:61-158, reload-queue.ts:19-40). It
  refuses while the old routine is occupied (`__merchantActiveJob`, `canReload`,
  `isOccupied`, runner-host.ts:10-14, :166-169), checks the generated path and checksum
  (:65-67, :172-175), and keeps the old generation on any failure.
- **LIF-016** Headless runner scope (`RunnerScope`, runner-scope.ts:20-204): code sees the
  game window through a facade. Every `on`/`once`/`addListener`, timer, fetch and jQuery ajax
  call is recorded, and `dispose` removes all of them and makes later calls throw
  `RetiredRunnerError` (:186-203, :57-59). `anySignal` combines abort signals for jsdom
  (abort-signals.ts:1-31).
- **LIF-017** Headless code sends asynchronous loopback HTTP through Node's client with one
  keep-alive agent, retrying once on the keep-alive reset race, and presets jQuery's
  `crossDomain` for absolute URLs (native-ajax.ts:25-135).
- **LIF-018** The leader worker connects with `no_graphics=0` so the server sends full Cave
  floors; the flag holds until that worker reconnects (cave-floor-handshake.ts:1-34,
  manager.ts:51-54).

### The native (Steam) loader

- **LIF-019** `universal-loader` (source runtime/characters/universal-loader.ts:1-176) runs in
  the browser CODE frame. It captures the game window as `gameHost` (:36), disposes any
  earlier loader (:37), and every 2 s (:172) polls `/party-api/console-deployment` for the
  maintenance lease and the activation id (:143-155), asks for `activation.json` (at most every
  10 s while the host reports none, :98-105), and loads the class bundle named by the record
  (or by `manifest.json` on first standalone start, :111). It verifies the bundle's SHA-256
  before running it (loader-artifact.ts:13-22). If the routine is occupied it waits
  (universal-loader.ts:115). In a frame whose `caracAL` is gone it replaces the whole CODE
  iframe (`replaceFrame`, :66-72, :116-119); otherwise it stops the old role runner and
  routine and runs the new bundle in place (:73-87). `dispose` aborts its fetches, bumps the
  runtime generation and stops the role runner, and stops `sharedRoutine` only while
  `root.parent === gameHost` (:126-136). A `party-code-stopped:<name>` flag in localStorage
  stops loading (:173-176). It also installs the Steam bridge in the game window (:158-171;
  spec 09 owns the bridge).

### shared.js as one closure

- **LIF-020** characters/shared.js (18,047 lines on the current console, `wc -l`) is one function
  over `root` (:1). Each evaluation bumps `__partyRuntimeGeneration` and fences late callbacks
  with `runtimeCurrent()` (:15-17), and stops the previous `sharedRoutine` (:290-291). On its
  first load in a browser runner it replaces the CODE iframe once to drop old convoy closures
  (`__partyFreshConvoyRunnerV3`, :2-13).
- **LIF-021** Socket listeners on the game window's socket:
  - 11 combat listeners are registered with an owner token in
    `parent.__partyCombatSocketSubscriptions` (:1221-1238) and removed by owner
    (`retirePartyCombatSockets`, :295-302; called by `stop`, :17395).
  - 5 listeners added at load (`game_response` for donation rates, `q_data`, `tracker`,
    `player`, `players`, :879-884) and 5 added by `start` (`server_info`, `test`, `connect`,
    two `game_response`, :17361-17378) are outside the registry. Only `stop` removes them,
    and only when `parent.socket.off` exists (:17438-17461).
  - On each load, `migratePartyCombatSockets` removes older frames' handlers on 9 events by
    searching each handler's source text for Party Console names (:303-322).
  - The native stand `ui` listener is kept on `parent.__nativeStandListener` and replaced on
    each load (:9323-9331, spec 08).
- **LIF-022** `sharedRoutine.start` starts up to 11 timers (tick, roster, events,
  anniversary, event clock, passive regeneration, reunion, map telemetry, dashboard telemetry,
  and two merchant timers) and the 5 listeners above (:17351-17392). `stop` clears them,
  cancels owned routes and convoy movement, lets a hot reload accept the same convoy command
  again, removes listeners, and restores the game's party invite hooks (:17393-17475).
- **LIF-025** The class role runner (runtime/characters/roles/runner.ts:16-377) stops any
  previous runner on install (:22); `start` refuses without `sharedRoutine` and then starts 5
  timers (:323-353); `stop` clears them (:354-375). Its target and attack logic belongs to
  specs 03 and 04.

### Console maintenance (the deploy lease)

- **LIF-023** The managed host writes the lease `updates/pause.json`
  `{id, mode: 'draining', loadMode, phase, expires}` and renews it every `leaseMs/3`
  (tools/console-build/safe-reload.ts:5-23). The coordinator reads it at most every 250 ms
  (coordinator/lifecycle/console-maintenance.ts:30-42). `status` lists participants that have
  not acknowledged this lease id with `ready`, combat off, a fresh report, and in Main mode a
  fighter on `main` (:43-60). The merchant keeps working in Main mode until `holding`
  (:27-29, :61). While a lease is current the heartbeat reply carries only the lease when not
  draining (application.ts:1090-1091), merchant dispatch, idle and bank wait
  (:1662, :1681, :2244, :490), and pulls stop (`blocksPulls`, :1825, :2426).
  Routes: `/party-api/console-maintenance` (:2337-2338), `/party-api/console-deployment`
  (:2345), `/party-api/console-runtime` (:2346-2350), `/party-api/build-identity`
  (:2255-2258).
- **LIF-024** In the character (shared.js): `receiveConsoleMaintenance` ignores a lease older
  than the last one seen by `serverNow` (:2468-2470). On a new draining lease it records the
  current fight's targets so only that fight finishes (:2472-2483; the target gate itself,
  `consoleDrainAllows`, is spec 04). Movement parks once no fight remains and nothing is busy
  (`consoleMovementPaused`, :2434-2439, spec 02). In Main mode a fighter saves a checkpoint
  under `party-console-return:<name>`, walks to `main`, and walks back after the lease ends
  (:2440-2463, :2484-2486). A merchant mid-transaction waits at `consoleAtomicBoundary`
  (:2464-2467). `canReload` is false while anything in `consoleMaintenanceBusy` is running
  (:2408-2416, :17479).

The lease reaches characters by three paths: the heartbeat reply (application.ts:1090-1098),
the loader's console-deployment poll (universal-loader.ts:143-155) and the activation record
(:107-109). The `serverNow` comparison in both the loader (:149) and shared.js (:2469) keeps
an older copy from overwriting a newer one.

### Builds and deploys (managed host)

LIF-028 holds the deploy side of tools/console-build and LIF-029 the class bundle build in
tools/game. The candidate builder and store, the runtime bundles, the caracAL install, the
host, update and release tools are LIF-031 to LIF-043 under "Added in triage".

- **LIF-028** `ConsoleBuildController` (tools/console-build/controller.ts:11-124) admits one
  deploy at a time through a durable journal (:27-48). A deploy verifies target and previous
  candidates, prepares, begins maintenance, waits for a safe point in `safe` or `main` mode,
  activates within 120 s, then records the new active build; a failure after activation
  rolls back to the previous build (:62-105). On host start, an unfinished journal is
  recovered: before activation it keeps the running build, after activation it restores the
  previous one (:106-122). The driver restarts the coordinator only if its component
  changed, then reloads characters and waits until each fresh character reports the new code
  hash (driver.ts:30-61; hosting.ts:126-146). Code publication copies the class bundles and
  legacy files into `.build/console/code` and writes `activation.json`; only that record lets
  running characters adopt new code (hosting.ts:52-65). A `safe` or `main` deploy is refused
  while any character is in a Cave (hosting.ts:152). The builder polls the source tree every
  second and builds a candidate 1 s after the last change (watch.ts:5-30).
- **LIF-029** `buildGame` (tools/game/build.mts:12-133) bundles one IIFE per class from
  `runtime/characters/entries/<class>.ts`, string-patches shared.js through
  `adaptLegacyRuntime` (legacy-boundary.ts:2-8, which refuses to publish if the two anchor
  strings change), names each bundle by its SHA-256, refuses to overwrite an existing
  artifact with different content, and writes `manifest.json` atomically.
- **LIF-026** characters/party-member.js is the committed bundle of
  runtime/characters/legacy-entry.ts (tools/build-runtime.mts:28), the compatibility entry for
  upstream caracAL: it loads `farming-zones.js`, `shared.js`, `profiles.js` and `roles.js`
  and starts the role runner (legacy-entry.ts:14-21). The function index lists the bundle's
  functions under those sources (runtime/characters movement, rendering, bank stack and
  upgrade preview modules), and the specs for those parts claim them.

### HTTP route plumbing

- **LIF-027** `startCoordinatorWebServices` (http/web-services.ts:71-117) reuses the
  monitor's router when the bot web interface or minimap is on, serves `/CODE` with
  `no-store` headers (middleware.ts:8-14) and binds 127.0.0.1 (:42), installs the dashboard
  routes, and optionally serves TYPECODE. `installCoordinatorDashboard`
  (http/dashboard.ts:51-101) sets a 32 MB JSON body limit (:62), answers `/party-api` CORS
  preflights with 204 (middleware.ts:17-27), and registers routes in one fixed order through
  four installers in http/registration.ts:35-269. Request bodies are untrusted until a route
  validates them (`requestObject`, contracts.ts:29-41). Each route handler belongs to the
  spec of its feature (handoffs-13.json hands 515 route functions to their feature specs);
  `createCoordinatorPartyConfiguration` (party-configuration.ts:125-140) only composes the
  focus, formation and party action routes.

### Test harness patterns

The current character code is one closure, so tests that need one function cut it out of the
source text. Spec 15 claims these helpers (TST-001 for the shared.js extraction helpers, TST-002 for the
coordinator host):

- `namedFunction` parses shared.js with the TypeScript compiler and returns one function
  declaration's text (scripts/tests/helpers/named-function.cjs:4-14).
- `createSharedContext` builds a vm context and injects 10 real shared.js functions, among
  them the maintenance gates `consoleDraining`, `consoleDrainKey`, `consoleDrainAllows` and
  `consoleAtomicBoundary`, so an incidental new dependency runs real code
  (helpers/shared-context.cjs:6-22).
- Other tests slice text between two function names or evaluate a hand-picked list of named
  functions in their own context, for example scripts/tests/passive-hunting.test.cjs:29-30.
- `coordinator-host.cjs` runs the whole application.ts in a vm context with stubbed timers,
  fork and storage (helpers/coordinator-host.cjs:12-71).

Counts on the current console: 118 test files mention `shared.js`; 41 use `named-function.cjs`, 10 use
`shared-context.cjs`, and 74 use neither (`grep -l "shared\.js" *.test.cjs`, then
`xargs grep -l` or `-L` for the helper names). shared.js has 159 `typeof X === "function"`
guards, 85 of them on 32 functions shared.js declares itself, which are always true in
production (`node tools/shared-guards.cjs $R refs/review/ryan-1.5`).

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **LIF-030** Character CODE calls the coordinator through one request helper: JSON over $.ajax with a 10 s default timeout, recording barrier and status transport timing. Code: `characters/shared.js`.
- **LIF-031** Console candidate builder: it polls a source fingerprint every 1 s, snapshots the source, links a dependency cache keyed by the package locks, type-checks, bundles, installs caracAL hooks, checks the candidate dashboard serves, then hands the candidate to the store. Code: `tools/console-build/builder.ts`, `tools/console-build/watch.ts`.
- **LIF-032** Console candidate store: immutable hash-verified candidates and dependency caches under .build/console, an operation lock with stale-owner recovery, active, latest and previous references, live pins, and cleanup past the newest 20; build-history lists, cleans, deploys or rolls back from the command line. Code: `tools/build-history.mts`, `tools/build-store.ts`, `tools/console-build/store.ts`.
- **LIF-033** build-runtime and build-shared bundle runtime and dashboard/lib TypeScript with esbuild into .build, copy them to characters and dashboard/lib only with --publish, and rewrite a file only when its content changed. Code: `tools/build-runtime.mts`, `tools/build-shared.mts`.
- **LIF-034** caracAL install: setup clones the pinned caracAL revision and applies the compatibility patch; install transforms CharacterThread.js, writes the maintained coordinator launcher, syntax-checks every file and replaces them atomically; managed processes load code and packages from the active candidate. Code: `tools/caracal/CharacterCoordinator.cjs`, `tools/caracal/coordinator-launcher.mts`, `tools/caracal/install.mts`, `tools/caracal/pinned-native.cjs`, `tools/caracal/setup.mts`, `tools/caracal/upgrade-runner.mts`.
- **LIF-035** Host startup: native and Docker development launchers check ports, dependencies and a running caracAL supervisor; start.mts writes the account config and launches the managed console or the plain coordinator and dashboard; a service that exits unexpectedly restarts 3 s later; SIGINT or SIGTERM stops everything. Code: `tools/hosting/docker-dev.mts`, `tools/hosting/health.ts`, `tools/hosting/listen.ts`, `tools/hosting/local.mts`, `tools/hosting/native.mts`, `tools/hosting/services.ts`, `tools/hosting/start.mts`.
- **LIF-036** Host gateway on port 3010: it authorizes browsers by pairing cookie and same origin and the Steam bridge by its token, routes console-build, console-debug and console-update, proxies party-api and CODE to the coordinator and everything else, including websocket upgrades, to the dashboard. Code: `tools/hosting/authorize.ts`, `tools/hosting/gateway.ts`, `tools/hosting/http.ts`, `tools/hosting/request-origin.ts`, `tools/hosting/websocket.ts`.
- **LIF-037** Setup and pairing: /setup routes, an access file of hashed browser and Steam credentials, one-use invitation links, 8-character access codes that expire after 10 minutes or 5 wrong guesses, account session to config with realm discovery, and the HTTP to HTTPS setup transfer. Code: `tools/hosting/access.ts`, `tools/hosting/account.ts`, `tools/hosting/address.ts`, `tools/hosting/realms.ts`, `tools/hosting/setup-routes.ts`, `tools/hosting/setup-transfer.ts`.
- **LIF-038** Local HTTPS: it installs a checksum-verified Caddy, runs it with an internal CA for the configured LAN hosts, probes certificate handshakes before reporting ready, and serves the root certificate and trust helper scripts. Code: `tools/hosting/install-caddy.mts`, `tools/hosting/tls-config.ts`, `tools/hosting/tls.ts`, `tools/hosting/trust.ts`, `tools/hosting/verify-https.mts`.
- **LIF-039** Update service: it checks the GitHub latest release every 6 h, validates the release manifest, tracks the check, download and restart phases and the automatic preference, holds character startup during a boot check, and labels source checkouts with tag, branch or commit. Code: `tools/update/agent.mts`, `tools/update/boot.ts`, `tools/update/contracts.ts`, `tools/update/github.ts`, `tools/update/hosting.ts`, `tools/update/service.ts`, `tools/update/version-label.ts`.
- **LIF-040** Update install: the Windows adapter downloads and verifies the release zip and the Docker adapter pulls the image by digest; a journaled transaction pauses characters, stops the console, backs up state, starts the target, waits up to 120 s for health and rolls back on failure. Code: `tools/update/docker.ts`, `tools/update/files.ts`, `tools/update/process.ts`, `tools/update/transaction.ts`, `tools/update/windows.ts`.
- **LIF-041** Release packaging: payload.mts stages a Windows release with release.json file hashes; the semantic-release prepare step checks the asset checksum and immutable image; startup checks confirm a fresh install reaches setup and the packaged dashboard renders. Code: `tools/release/payload.mts`, `tools/release/verify-assets.cjs`, `tools/release/verify-startup.ts`.
- **LIF-042** Class bundle history: remembers each verified generation, keeps the retained builds and deletes only known bundle files, pins a rollback and resumes the staged build. Code: `tools/game/history.ts`.
- **LIF-043** Character source watch: file events or 1 s polling on runtime/characters, dashboard/lib and shared.js, a 250 ms debounce, a typecheck, then a verified build and publish. Code: `tools/game/watch.mts`.

## 2. What goes wrong

### LIF-W1. Bug 15: Steam orphan runner (current)

The memory note: after console restarts the Steam client throws reading `S`/`character`
every few seconds until the Steam client restarts. Causal chain (code confirmed; the link
to the observed errors is inference):

1. shared.js adds 10 socket listeners outside the owner registry (:879-884, :17361-17378).
2. Only `sharedRoutine.stop` removes them, and only when `parent.socket.off` exists
   (:17438-17461).
3. The loader's `dispose` calls `stop` only while `root.parent === gameHost`
   (universal-loader.ts:135; universal-loader.js:130). A deliberate `replaceFrame` disposes
   while still attached (:67-72), so that path cleans up. A frame detached any other way
   (inference: the game or the Steam bridge recreating the runner during a coordinator
   restart) reaches `dispose` through `pagehide` with `root.parent` already changed, and
   `stop` never runs.
4. The next generation's text search (`migratePartyCombatSockets`, :303-322) knows 9 events.
   It has no entry for `q_data`, `tracker`, `player`, `players`, `server_info`, `test` or
   `connect`, so those handlers stay on the socket (:309-315).
5. The game window and its socket outlive the CODE frame, so the old handlers keep firing
   into a closure whose frame is gone. A Steam client restart discards the game window and
   with it the handlers, which matches the note.
6. `stop` also clears `eventClockTimer` only inside the same `parent.socket.off` branch
   (:17438-17439).

Patch history: facc4224 (Breene26, 2026-10-08, "retire Steam CODE callbacks") added the
`game_response` signatures to the text search; it is an ancestor of `ryan-1.5`
(`git merge-base --is-ancestor facc4224 refs/review/ryan-1.5`). That is a second pass of the
same workaround.

The current console already solves this for headless workers: `RunnerScope` records every subscription a
generation makes and removes them on dispose whatever the frame state
(runner-scope.ts:81-96, :186-203). The native path has no equivalent.

The other two parts of ledger bug 15 are fixed in the current console by cb8881f6 (an ancestor of
`ryan-1.5`): the writer lock identity (spec 11 SET-009, SET-W6) and production receipt
pruning (spec 10).

### LIF-W2. The committed universal-loader.js is stale (current)

characters/universal-loader.js on the current console is older than its source: it has no
activation record, no console-deployment poll and no maintenance hand-off, and polls only
in a non-caracAL frame (compare universal-loader.js:102-157 with universal-loader.ts:91-176).
Its last change is facc4224 (2026-10-08); the source's is 1973bb5d (2026-10-21)
(`git log -1 refs/review/ryan-1.5 -- <file>`). A build with `--publish` rewrites it
(tools/build-runtime.mts:26, :46-47), and the managed host copies the built candidate's copy
(hosting.ts:85, :115), so production uses the fresh one (inference). The function index lists
universal-loader.ts, the source, and not the stale file.
party-member.js may have the same gap (not checked).

### LIF-W3. A refused deploy still publishes a draining lease (current)

1. `beginMaintenance` writes the lease (hosting.ts:150) before it checks for a Cave run and
   refuses (:152).
2. The controller's failure path then removes it (`releaseSafeWait`, controller.ts:97).
3. Between the two, characters can read a draining lease and start parking (inference: one
   poll of 250 ms to 2 s).

### LIF-W4. Tests cut functions out of shared.js; production carries guards for them (current)

1. shared.js has no module boundary, so 74 of 118 test files that mention it cut functions
   out by text or a hand list (counts above).
2. Each test lists the extracted function's dependencies by hand (passive-hunting.test.cjs
   builds its own context of stubs and named functions, :19-30).
3. When production code gains a call to another shared.js function, the extracting tests
   throw. The fix pattern is a `typeof X === "function"` guard: 85 guards on internal
   functions in the current console (`shared-guards.cjs`).
4. A guard hides a real missing function in production: a rename turns the check off with no
   error.

The current own better answer exists: shared-context.cjs injects the real gate functions
(:15-20). The role runner shows the same tolerance from the other side: it checks
`typeof sharedRoutine !== 'undefined'` and calls most hooks as `sharedRoutine.x?.()`
(runner.ts:49-52, :67-110).

### LIF-W5. Bug 10: unit regressions from the console Pause check (fork)

1. 9a34a4c1 (2026-10-24) adds `consolePauseHolds()` calls inside the current `returnCombatActive`
   and `isAttackingPartyMember` (fork shared.js:3652, :14847; the function at :3655).
2. passive-hunting.test.cjs and event-return-turnover-hold.test.cjs evaluate those functions
   in contexts that do not define it (LIF-W4 step 2), so they throw ReferenceError.
3. 250c61e1 (2026-10-25, "Guard the console Pause check where tests extract the combat
   functions") wraps both calls in `typeof consolePauseHolds === "function"`.
4. Result: the fork has 189 guards, 112 on internal functions
   (`node tools/shared-guards.cjs $R HEAD`), 27 more than the current console.

The fix at the cause is to add `consolePauseHolds` to shared-context.cjs or the two fixtures
and remove the guards. Patch applied: symptom only.

### LIF-W6. Smaller findings (current)

- `serveTypeCode` binds every interface (`app.listen(settings.port)`, web-services.ts:63)
  while `serveCode` binds 127.0.0.1 (:42). It applies only when TYPECODE is exposed and no
  other server was created first.
- Workers get 500 ms to close before SIGKILL (processes.ts:27). Inference: a worker mid-way
  through a game transaction at shutdown is killed before it finishes.
- `createResources` is exported and tested but unused (LIF-011).
- The build string-patches shared.js text (legacy-boundary.ts:2-8), so editing either anchor
  line breaks publishing.
- shared.js:2-13 is a one-time iframe migration with a version flag and no end.
- `scripts/native-network-isolation.cjs` is an e2e proof script indexed as production code
  (handed to spec 15).

## 3. Fork differences

- **Console Pause, Play and clean shutdown** (b33aee77, 9a34a4c1, 250c61e1;
  fork runtime/coordinator/lifecycle/console-control.ts, 303 lines). Pause writes
  `updates/console-pause.json`; `userPauseLease` turns it into the current draining lease with two
  new flags, `immediate` and `userPause` (console-control.ts:35-42, :72-82). The coordinator's
  lease reader prefers the deploy lease and falls back to the Pause (fork
  console-maintenance.ts: `hostLease(directory)||userPause()`), and the managed host reads the
  same file again for its console-deployment reply (fork hosting.ts, `maintenance.lease||userPause()`).
  Consequence (inference): during a deploy while paused the deploy lease, which has no
  `immediate` flag, hides the Pause, so held characters fall back to finish-the-fight
  behaviour until the deploy releases its lease. Characters treat the Pause as return-trip
  defence through `consolePauseHolds` (LIF-W5). Play restores 23 captured settings (spec 11
  section 3). Other patchwork: a 25 ms busy-wait retry up to 20 times around the file
  rename (console-control.ts:61-67) and a hard-coded `stopDirectory =
  '(local checkout) (:47).
- **Shutdown** (fork shutdown.ts): after a clean "prepared" shutdown the worker wait is
  bounded at 5 s because the host force-exits 15 s after SIGTERM.
- **Deploy hold** (0875e047, bce3a9fb; fork tools/console-build/hold.ts:1-22): refuses a
  coordinator deploy during a Cave run or an event. It copies the Cave and event rules
  (:4-9), a third copy beside console-control.ts:96-102 and the current 17 copies of the event
  rule (review/full/core.md:184). It runs inside `beginMaintenance` after the lease is
  written, so it inherits LIF-W3.
- **Builder fixes** (0bea0e19, 4ddff3c9, fed277ae, 738b52d2): packaging fixes with stated
  causes; not patchwork. The fork also adds a separate source checkout and
  `AL_CONSOLE_WATCH=0` (fork hosting.ts `sourceWatcher`).

## 4. Tests today

| Behaviours | Tests | Proves | Does not cover |
|---|---|---|---|
| LIF-001 | coordinator-application-launcher.test.cjs (3) | The real bundle starts and serves a heartbeat | Start with characters configured |
| LIF-002 | caracal-game-files.test.cjs (2), client-cache-updates.test.cjs (1) | Load order of game scripts, cache staging | Version culling |
| LIF-003 | client-updates.test.cjs (6) | Rollout order, failure retention | none noted |
| LIF-004 to 007 | coordinator-workers.test.cjs (9), worker-lifecycle.test.cjs (2) | Realm retry, wire format, stop grace, exit fencing, IPC | A real forked worker |
| LIF-008, 009 | coordinator-character-startup.test.cjs (3), coordinator-startup-slots.test.cjs (3), coordinator-worker-setup.test.cjs (1) | Start order, Steam reservations | none noted |
| LIF-010, 011 | coordinator-realm-switch.test.cjs "shutdown waits for workers...", coordinator-runtime-lifecycle.test.cjs, coordinator-policies.test.cjs | Shutdown order and single run | The 500 ms SIGKILL at shutdown |
| LIF-012 to 017 | coordinator-code, coordinator-runtime-lifecycle, game-generation, runner-host, runner-lifecycle, runner-engine, runner-native-ajax, runner-ajax-origin | Reload, retirement, transport | none noted |
| LIF-019 | loader-activation-poll (3), loader-connection (3), e2e/live-console-explicit-activation.spec.ts | Activation and bridge loading | A detached-frame dispose (LIF-W1) |
| LIF-021 | fight-death-packets.test.cjs "native iframe replacement removes stale combat callbacks without touching game listeners" | The registry and text search for combat listeners | The 7 events the search misses (LIF-W1); guards a workaround |
| LIF-022, 025, 026 | party-loader.test.cjs (2) | Legacy entry order, refusal without shared code | stop() completeness |
| LIF-023, 024 | console-updates.test.cjs "maintenance requires fresh acknowledgements...", e2e live-console-safe-reload, live-console-main-reload, live-console-mixed-deployment, console-build-safe-host | Lease acknowledgement, safe and Main reload on real play | LIF-W3 |
| LIF-028, 029 | e2e/console-build*.spec.ts (12 listed), build-retention.test.cjs, game-generation.test.cjs | Deploy journal, rollback, retention, atomic publish | none noted |
| LIF-027 | coordinator-application-launcher.test.cjs | Routes exist after start | CORS, body limit, TYPECODE binding |

Tests that only guard a patch: the fight-death-packets case above guards the text-search
workaround. passive-hunting.test.cjs and event-return-turnover-hold.test.cjs are the tests
the fork's guards exist for (LIF-W5). No test covers LIF-018 or LIF-020.

## 5. Needs your review

1. **Listener ownership (bug 15).** Should every listener character code puts on the game
   socket be owned the way headless `RunnerScope` owns them, so the loader removes them
   whatever the frame state? Options: (a) yes, and drop the text search; (b) only extend the
   text search to the 7 missing events; (c) leave it and keep restarting the Steam client.
   (a) is the fix at the cause; it is the current code, so it would go upstream as an issue.
2. **Pause model (fork).** Should Pause become a hold that owners respect (no snapshot, no
   restore on Play), or stay a snapshot and restore? This decides spec 11 review item 4 too.
3. **Deploy while paused (fork).** If a deploy starts while paused, should characters
   (a) stay in Pause's defend-only mode, (b) follow the deploy's finish-the-fight rule, or
   (c) refuse the deploy until Play?
4. **Shutdown grace.** Is 500 ms before SIGKILL enough for a worker mid-transaction, or should
   shutdown wait for `canReload` like a safe reload does?
5. **Test extraction.** Fix the 27 fork guards by adding the functions to
   shared-context.cjs (small, fork-only), and offer an upstream issue about loading shared.js
   whole in tests? (Yes or no for each.)

## 6. The design

M1.

## 7. What changes for the player

M1.

## 8. Proof

M1.

## 9. Migration

M1.

## 10. Gaps

`LIMIT=100000 node tools/check-claims.mjs` (run 2026-10-26, after the M0 coverage triage),
filtered to 13-lifecycle:

- Functions claimed: 644 in 43 behaviours (count command in docs/implementation/02-coverage.md). Unclaimed functions in the whole index: 0.
- Claims naming no known function: 0. Claimed by more than one spec: 0.
- Behaviours with no test: LIF-018, LIF-020, and LIF-030 to LIF-043 (added in triage, tests
  not yet mapped).

Not yet verified or not covered:

- The Steam bridge and roster handoff (runtime/steam, runtime/roster, characters/steam-bridge.js)
  are spec 09; LIF-W1 step 3 depends on how they recreate the runner, which was not read.
- Test accuracy review (method step 2) not done; test names and the bodies cited were read.
