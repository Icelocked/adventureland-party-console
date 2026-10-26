# 13. Lifecycle

Start, stop, deploy, console maintenance, code reload, the character loader and bundles,
socket listener lifetime, HTTP route plumbing, the build, release, hosting and update tools
under tools/, and the test harness patterns that depend on how character code is loaded.
Spec prefix `LIF`.

Checked against the current console `refs/review/ryan-1.5` (`b9b5c91e`) in
(local checkout). Fork lines are labelled "fork" and cite `HEAD`
(`af92de45`). Line numbers are on those refs. "Inference" marks a claim the code supports
but that no test, log or live run here proves. `docs/implementation/09-verification-11-13.md`
records the claim-by-claim check of this page.

Commands used for counts (run from (local checkout), with
`R=(local checkout)): `node tools/shared-guards.cjs $R <ref>`;
`node tools/check-claims.mjs`; test-file counts are `grep -l` runs over
`scripts/tests/*.test.cjs` on the extracted ref, quoted where used.

## 1. What it does today

### Coordinator start

- **LIF-001** `startCoordinatorApplication` (runtime/coordinator/application.ts:32-2497)
  runs one async start in a fixed order: open the journal and migrate old storage, ensure the
  latest game client, read `config.js`, cull unused client versions when `cull_versions` is
  set, log in to the account, and pick the realm (the account's shared home realm, else the
  first configured `SR_` realm, else `SR_USII`) (environment.ts:24-61, called at
  application.ts:98-118); prepare movement geometry (:124-138); build state (:152-162,
  spec 11); compose every service; start web routes (:2249-2410); then start characters and
  install the shutdown signals (:2479-2493, startup.ts:39). A failure anywhere logs "failed
  to start caracAL" and the process keeps running (:2494-2496); a failure before :2249 leaves
  it with no routes. A failure inside the web services is caught separately and logged as "no
  web services will be available" while the start continues (web-services.ts:80-85). Module
  loading goes through `loadCoordinatorDependencies` (infrastructure/dependencies.ts:6-116),
  which requires the built `.build/runtime/*.cjs` bundles, `scripts/*.cjs` helpers and the
  caracAL launcher modules.
- **LIF-002** Game client files: scripts/client-files.cjs downloads the official client
  scripts for a version (adapted from thmsndk/caracAL 30ead440, :1). It discovers them from
  the game's HTML (:10-28). For a version with no saved `client_scripts.json` it uses the
  fallback list (:7-9, :33-40). It stages every file and publishes a new version as one
  directory rename (:47-83), records a SHA-256 revision over the list and files (:84-88), and
  at start falls back to the newest complete cached version when the download fails
  (:95-104). With `cull_versions` set, it keeps the two newest versions plus the current and
  every pinned version (client-files.cjs:105-107, environment.ts:37-41).
- **LIF-003** A game client update (`createClientUpdates`,
  coordinator/characters/client-updates.ts:19-73) runs once at a time. It refreshes, refuses
  an older version (:52), and only when the version or revision changed prepares geometry,
  catalogs, bank vaults and the deconstruction catalog for the candidate
  (application.ts:1170-1176) and activates them (:1177-1192). It then restarts each enabled,
  unpinned worker in turn and waits up to 60 s for a fresh heartbeat on the new version
  (client-updates.ts:28-47); a worker that fails stays pending for the next request (:56-58).
  A `reloaded` event during a run triggers one more check (:61-66).

### Character workers (headless)

- **LIF-004** `createCharacterManager.start` (coordinator/characters/manager.ts:127-147)
  resolves the worker's realm; an unknown realm sets `realm-error`, refreshes the account and
  retries in 3 s without picking another realm (:99-111). It resolves the character (a
  missing one disables the worker, :135-141), builds arguments (session, realm address,
  script, class id, a fresh `clientInstance`, `full_cave_floors` for the leader only,
  :56-79, application.ts:270), forks `./src/CharacterThread.js` and attaches exit and message
  handlers (:113-125; fork port at application.ts:261-264).
- **LIF-005** `stopWorker` asks a connected worker to close (`closing_client`) and sends
  SIGKILL if it has not exited after 500 ms; a worker that is not connected gets SIGKILL at
  once (processes.ts:8-31).
- **LIF-006** `workerExited` logs every exit with `{at, code, signal, reason}` and changes
  nothing else for a replaced worker (processes.ts:63-71). For the current worker it records
  `lastExit` and restarts an enabled worker 1.5 s after any game cache repair finishes
  (:40-53, :72-80). It does not restart a worker that a client update stopped (:79).
- **LIF-007** Worker IPC (ipc.ts:83-129, messages.ts:61-74): `client_update` from an unpinned
  worker requests a client update check (:95); `process_ready` gets the arguments; `connected`
  marks the worker online and sends sibling lists to every connected worker;
  `bootstrap_failed` starts a cache repair; `deploy` and `shutdown` let the game script start
  or stop a character; `cm` routes code messages to local workers directly and remote ones
  through the sender; `stor` is spec 11 SET-014. `receiveWorkerMessage` drops messages from a retired worker
  (ipc.ts:91).
- **LIF-008** At start, `startCoordinatorCharacters` installs the shutdown signals
  (startup.ts:39), then marks every configured worker disconnected, watches it for code
  changes and disables it (startup-slots.ts:24-31). The generation watch (LIF-013) starts at once when `watch_CODE`
  is on or `AL_CONSOLE_ARTIFACT` is set, and the account listener subscribes
  (startup.ts:59-67). Four seconds after start `restore` starts the saved headless slots. It skips
  characters reserved for Steam, clears slots for characters no longer owned or owned by the
  native client, then saves the roster (startup-slots.ts:32-47; timer at startup.ts:58).
- **LIF-009** `ensure` gives a worker block its realm (spec 09 owns the realm choice), its
  verified class script (`classScript`, application.ts:989), its version and a code watcher;
  `assign` saves a headless slot and starts the worker (worker-setup.ts:65-87).

### Stop and shutdown

- **LIF-010** SIGINT, SIGTERM, SIGQUIT or an IPC `coordinator_shutdown` message runs one
  shutdown (runtime-lifecycle.ts:51-68, shutdown.ts:9-20): disable and stop every worker
  (manager.ts:149-156), flush settings in the v1.4.0 layout (spec 11 SET-005), dispose the
  movement planner, close metrics and the journal, exit (application.ts:348-353). A second
  signal does nothing (shutdown.ts:12-13).
- **LIF-011** `createResources` (coordinator/lifecycle/resources.ts:6-31) releases registered
  resources once in reverse order. No production code calls it
  (`git grep createResources refs/review/ryan-1.5` lists resources.ts, the re-export in
  runtime/coordinator/index.ts:61 and one test).

### Code reload

- **LIF-012** Standalone code watch: when `watch_CODE` is on and no managed artifact is set
  (composition.ts:91), an edit to a worker's own legacy (non-generated) script reloads it
  300 ms later (code.ts:68-83, :19-25). `watch` watches only that script file; the generation
  digest also covers `farming-zones.js`, `shared.js`, `profiles.js` and `roles.js`
  (code.ts:16, :58), so an edit to those alone reloads nothing until the script changes. An
  unchanged digest skips the reload (:60). A busy worker retries in 2 s; a failure that needs
  recovery stops the worker, which the exit handler restarts; other failures keep the
  current generation (:27-46).
- **LIF-013** Generation watch (`watchGenerations`, runtime/lifecycle/generations.ts:69-152):
  standalone, it watches the CODE directory for `manifest.json` events with a 150 ms debounce
  (:119-127); managed (`AL_CONSOLE_ARTIFACT` set, runtime-lifecycle.ts:23), it polls
  `activation.json` every 1 s and accepts a record only after verifying its manifest
  (:129-143). For each live worker whose script changed it sends `reload_code` and waits
  15 s (`requestReload`, request-reload.ts:11-62); a timeout, worker exit or send error counts
  as a failure that needs recovery. `ready` records the new script; `busy` retries in 2 s; a
  failure that needs recovery restarts the worker; other failures keep the current runner
  (generations.ts:94-109).
- **LIF-014** `classScript` reads `activation.json`, or `manifest.json` when no record
  exists, and accepts a class bundle only when the manifest has schema 1, the entry file
  matches `generated/<64 hex>/<class>.js` and the file hashes to the entry's `sha256`
  (generations.ts:13-29). `verifiedClass` caches verified files by inode, size, times and
  hash, at most 32 entries, and clears a full cache (:31-51).
- **LIF-015** Headless runner host (`createRunnerHost`, runtime/lifecycle/runner-host.ts:54-191):
  the game context and its socket outlive every code generation (:53). A reload compiles and
  prepares the new generation while the old one runs (:61-158, reload-queue.ts:19-40). It
  refuses while the old routine is occupied (`__merchantActiveJob`, `canReload`,
  `isOccupied`, runner-host.ts:10-14, :166-169) and checks the generated path and checksum
  (:65-67, :171-175). A failure while preparing keeps the old generation. A failure while
  starting the new one comes after the old one was disposed (reload-queue.ts:27-35), so no
  generation runs and the reply asks for a worker restart (runner-host.ts:185).
- **LIF-016** Headless runner scope (`RunnerScope`, runner-scope.ts:20-204): code sees the
  game window through a facade, which also wraps `socket`, `character`, `caracAL`, `parent`,
  `top` and `window` (:147-184). The scope records every `on`/`once`/`addListener`, timer, fetch
  and jQuery ajax call, and `dispose` removes all of them and makes later calls throw
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
  the CODE frame. It captures the game window as `gameHost` (:36), disposes any earlier
  loader (:37), and every 2 s (:172) polls `/party-api/console-deployment` for the
  maintenance lease and the activation id (:143-155), asks for `activation.json` (at most
  every 10 s while the host reports none, :98-105), and loads the class bundle named by the
  record (or by `manifest.json` on the first load when no record answers, :104-111). It
  verifies the bundle's SHA-256 before running it (loader-artifact.ts:13-22). After the first
  load it waits while the routine is occupied (universal-loader.ts:115). In a native frame
  (no `caracAL`) every later generation replaces the whole CODE iframe (`replaceFrame`,
  :66-72, :116-119); in a caracAL frame it stops the old role runner and routine and runs the
  new bundle in place (:73-87). `dispose` aborts its fetches, clears its timer, bumps the
  runtime generation and stops the role runner, and stops `sharedRoutine` only while
  `root.parent === gameHost` (:126-136). A `party-code-stopped:<name>` flag in localStorage
  stops loading; the console-deployment poll continues (:172-176).
- **LIF-048** Without caracAL the loader also installs the Steam bridge in the game window and
  retries on each tick until the bridge reports the expected server (:158-172; spec 09 owns
  the bridge).

### shared.js as one closure

- **LIF-020** characters/shared.js (18,047 lines on the current console, `wc -l`) is one function
  over `root` (:1). Each evaluation bumps `__partyRuntimeGeneration` and fences late callbacks
  with `runtimeCurrent()` (:14-16), and stops the previous `sharedRoutine` (:290-291). On its
  first load in a native runner it replaces the CODE iframe once to drop old convoy closures
  (`__partyFreshConvoyRunnerV3`, :2-13).
- **LIF-021** Socket listeners on the game window's socket:
  - shared.js registers 11 combat listeners with an owner token in
    `parent.__partyCombatSocketSubscriptions` (:1221-1238), and `retirePartyCombatSockets`
    removes them by owner (:295-302; called by `stop`, :17395).
  - 5 listeners added at load (`game_response` for donation rates, `q_data`, `tracker`,
    `player`, `players`, :879-884) and 5 added by `start` (`server_info`, `test`, `connect`,
    two `game_response`, :17361-17378) are outside the registry. Only `stop` removes them,
    and only when `parent.socket.off` exists (:17438-17461).
  - On each load, `migratePartyCombatSockets` first removes every registered subscription,
    then removes older frames' handlers on 9 events by searching each handler's source text
    for Party Console names (:303-322).
  - The native stand `ui` listener is kept on `parent.__nativeStandListener` and replaced on
    each load (:9323-9331, spec 08).
- **LIF-022** `sharedRoutine.start` starts up to 11 timers (tick, roster, events,
  anniversary, event clock, passive regeneration, reunion, map telemetry, dashboard telemetry,
  and two merchant timers) and the 5 listeners above (:17351-17392). `stop` clears them,
  cancels owned routes and convoy movement, lets a hot reload accept the same convoy command
  again, removes listeners, and restores the game's party invite hooks (:17393-17475).
- **LIF-025** The class role runner (runtime/characters/roles/runner.ts:16-377) stops any
  previous runner on install (:22); `start` refuses without `sharedRoutine.isOccupied` and
  then starts 5 timers (:323-353); `stop` clears them (:354-375). Its target and attack logic
  belongs to specs 03 and 04.

### Console maintenance (the deploy lease)

- **LIF-045** The managed host writes the lease `updates/pause.json`
  `{id, mode: 'draining', loadMode, phase, expires}` and renews it every third of its 10 s
  life (tools/console-build/safe-reload.ts:5-23). It refuses to start while another live
  lease with a different id exists (:18-19). It waits until the coordinator reports every
  participant ready for 3 s, twice in Main mode (:25-39), and removes the file only if it
  still carries its own id (:40-43). The update tool writes the same file with only `id` and
  `expires` (tools/update/transaction.ts:15-25, LIF-040).
- **LIF-023** The coordinator reads the lease at most every 250 ms
  (coordinator/lifecycle/console-maintenance.ts:30-42). `status` counts as participants the
  expected names and every character reported in the last 15 s, and lists those without a
  report in the last 5 s, an acknowledgement of this lease id with `ready`, combat off on a
  draining lease, or, in Main mode, a fighter on `main` (:43-60). The merchant keeps working
  in Main mode until `holding` (:27-29, :61). While a lease is current the heartbeat reply
  carries only the lease when it is not draining (application.ts:1090-1091). Merchant
  dispatch, idle and bank dispatch stop under `blocksMerchant` (:1662, :1681, :2244); stalled
  sale recovery and merchant job expiry stop under any lease (:489-493); pulls stop
  (`blocksPulls`, :1825, :2426). Routes: `/party-api/console-maintenance` (:2337-2338),
  `/party-api/console-deployment` (:2345), `/party-api/console-runtime` (:2346-2350),
  `/party-api/build-identity` (:2255-2258).
- **LIF-024** In the character (shared.js): `receiveConsoleMaintenance` ignores a lease older
  than the last one seen by `serverNow` (:2468-2470), and a merchant ignores a Main lease
  before `holding` (:2471). On a new draining lease it records the current fight's targets so
  only that fight finishes (:2472-2483), and adds the targets the coordinator captured from fresh
  reports (:2489-2492; the target gate itself, `consoleDrainAllows`, is spec 04). Movement
  parks once no fight remains and nothing is busy (`consoleMovementPaused`, :2434-2439,
  spec 02). In Main mode a fighter saves a checkpoint under `party-console-return:<name>`
  (:2484-2486), walks to `main`, and walks back after the lease ends (:2440-2463). A merchant
  mid-transaction waits at `consoleAtomicBoundary` (:2464-2467). `canReload` is false while
  anything in `consoleMaintenanceBusy` is running (:2408-2416, :17479).

The lease reaches characters by three paths: the heartbeat reply (application.ts:1090-1098,
read at shared.js:11141 and :14331), the loader's console-deployment poll
(universal-loader.ts:143-155) and the activation record (:107-109). The `serverNow`
comparison in both the loader (:149) and shared.js (:2469) keeps an older copy from
overwriting a newer one.

### Builds and deploys (managed host)

LIF-028 holds the deploy controller and driver in tools/console-build, LIF-044 to LIF-046 the
dashboard, lease and CODE parts of the managed host, and LIF-029 the class bundle build in
tools/game. The candidate builder and store, the runtime bundles, the caracAL install, the
host, update and release tools are LIF-031 to LIF-043 and LIF-047 under "Added in triage".

- **LIF-028** `ConsoleBuildController` (tools/console-build/controller.ts:11-124) admits one
  deploy at a time through a durable journal (:27-48). A deploy verifies target and previous
  candidates, prepares, begins maintenance, waits for a safe point in `safe` or `main` mode
  (no time limit on this wait), activates within 120 s, then records the new active build; a
  failure after activation rolls back to the previous build (:62-105). On host start, `recover`
  handles an unfinished journal: before activation it keeps the running build, after
  activation it restores the previous one (:106-122). The driver restarts the coordinator
  only if its component changed, reloads characters when the characters or coordinator
  component changed, and waits until the coordinator identity, the dashboard hash and each
  captured character's code hash match (driver.ts:30-61; hosting.ts:126-146). `beginMaintenance`
  refuses a `safe` or `main` deploy while any character is in a Cave (hosting.ts:152). The host loads
  its own managed code from the active candidate, and from the checkout only before the first
  candidate exists (bootstrap.ts:9-18).
- **LIF-044** The immutable dashboard (tools/console-build/dashboard.ts:13-181) starts a
  candidate dashboard process beside the active one, waits until it serves, hands traffic
  over, falls back to the previous process when a proxied request fails, and respawns a
  crashed active process after 3 s, doubling up to 60 s (:67-83).
- **LIF-046** Code publication copies the class bundles and legacy files into
  `.build/console/code`, which `.caracal/CODE/adventure_land` links to, and writes
  `activation.json` last; only that record lets running characters adopt new code
  (hosting.ts:39-65). After each coordinator start the host copies its own
  `characters/universal-loader.js` over the published one (:85, :115). The host serves only a
  fixed list of CODE files and the console-deployment reply (:183-195).
- **LIF-029** `buildGame` (tools/game/build.mts:12-133) bundles one IIFE per class from
  `runtime/characters/entries/<class>.ts`, string-patches shared.js through
  `adaptLegacyRuntime` (legacy-boundary.ts:2-8, which refuses to publish if the two anchor
  strings change), refuses a source that changed during the build (:36-37, :78-80), names
  each bundle by its SHA-256, refuses to overwrite an existing artifact with different
  content, and writes `manifest.json` atomically. A pinned rollback stops publication to
  `characters/` (:125-126).
- **LIF-026** characters/party-member.js is the committed bundle of
  runtime/characters/legacy-entry.ts (tools/build-runtime.mts:28), the compatibility entry for
  upstream caracAL: it loads `farming-zones.js`, `shared.js`, `profiles.js` and `roles.js`
  and starts the role runner (legacy-entry.ts:14-21). The function index lists the bundle's
  functions under its sources (the runtime/characters movement, rendering, bank stack and
  upgrade preview modules it imports, legacy-entry.ts:2-5), and the specs for those parts
  claim them.

### HTTP route plumbing

- **LIF-027** `startCoordinatorWebServices` (http/web-services.ts:71-117) reuses the
  monitor's router when the bot web interface or minimap is on, serves `/CODE` with
  `no-store` headers (middleware.ts:8-14) when CODE or the dashboard is exposed, binds
  127.0.0.1 when it creates the server itself (:39-43), installs the dashboard routes, and
  optionally serves TYPECODE. `installCoordinatorDashboard` (http/dashboard.ts:51-101) sets a
  32 MB JSON body limit (:62), answers `/party-api` CORS preflights with 204
  (middleware.ts:17-27), and registers routes in one fixed order: its own routes, four
  installers in http/registration.ts:35-269 and five port hooks (maps, live telemetry,
  roster, combat logs, mail). Each route validates its own request body (`requestObject`,
  contracts.ts:29-41). Each route handler belongs to the spec of its
  feature (handoffs-13.json holds 526 handoffs, 493 of them under runtime/coordinator/http/);
  `createCoordinatorPartyConfiguration` (party-configuration.ts:13-28) only composes the
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
  (helpers/shared-context.cjs:9-22).
- Other tests slice text between two markers or evaluate a hand-picked list of named
  functions in their own context of stubs, for example scripts/tests/passive-hunting.test.cjs:20-31.
- `coordinator-host.cjs` runs the whole application.ts in a vm context with stubbed timers,
  fork and storage (helpers/coordinator-host.cjs:12-71).

Counts on the current console: 118 test files mention `shared.js` and 117 of them evaluate its
code in a vm; 41 use `named-function.cjs`, 10 use `shared-context.cjs`, and 74 use neither
(`grep -l "shared\.js" *.test.cjs`, then `xargs grep -l` or `-L` for the helper names); 72 of
those 74 call `indexOf`, `slice`, `substring` or `match`. shared.js has 159
`typeof X === "function"` guards, 85 of them on 32 functions shared.js declares itself, which
are always true in production (`node tools/shared-guards.cjs $R refs/review/ryan-1.5`).

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **LIF-030** Character CODE calls the coordinator through one request helper: JSON over $.ajax with a 10 s default timeout; it records barrier and status transport timing, applies each status reply and resends a status with full inventory when the coordinator answers 409 `inventory-required`. Code: `characters/shared.js` (:3232).
- **LIF-031** Console candidate builder: it polls a source fingerprint every 1 s and builds 1 s after the last change (watch.ts:5-30); it snapshots the source, links a dependency cache keyed by the package locks, platform, architecture and Node ABI, type-checks, runs the three builds with --publish, installs caracAL hooks, checks the candidate dashboard serves, then hands the candidate to the store (builder.ts:168-192). Code: `tools/console-build/builder.ts`, `tools/console-build/watch.ts`.
- **LIF-032** Console candidate store: immutable hash-verified candidates and dependency caches under .build/console, an operation lock with stale-owner recovery, active, latest and previous references, live pins, and cleanup past the newest 20 (store.ts:308). Code: `tools/build-store.ts`, `tools/console-build/store.ts`.
- **LIF-033** build-runtime and build-shared bundle runtime and dashboard/lib TypeScript with esbuild into .build; only with --publish do they copy the five browser bundles to characters/ and the shared modules to dashboard/lib (farming-zones to characters/), and each rewrites a file only when its content changed. Code: `tools/build-runtime.mts`, `tools/build-shared.mts`.
- **LIF-034** caracAL install: setup clones the pinned caracAL revision and applies the compatibility patch; install transforms CharacterThread.js, ConfigUtil.js, the coordinator launcher and game_files.js, syntax-checks them unless a prepared native tree is supplied, and replaces them atomically; managed processes load code and packages from the active candidate. Code: `tools/caracal/CharacterCoordinator.cjs`, `tools/caracal/coordinator-launcher.mts`, `tools/caracal/install.mts`, `tools/caracal/pinned-native.cjs`, `tools/caracal/setup.mts`, `tools/caracal/upgrade-runner.mts`.
- **LIF-035** Host startup: the native launcher checks ports, dependencies and a running caracAL supervisor; the Docker development launcher seeds its volumes; start.mts writes the account config and launches the managed console or the plain coordinator and dashboard; a service that exits unexpectedly restarts 3 s later; SIGINT or SIGTERM stops everything and the host exits 15 s later (start.mts:112-121). Code: `tools/hosting/docker-dev.mts`, `tools/hosting/health.ts`, `tools/hosting/listen.ts`, `tools/hosting/local.mts`, `tools/hosting/native.mts`, `tools/hosting/services.ts`, `tools/hosting/start.mts`.
- **LIF-036** Host gateway on port 3010: it authorizes browsers by pairing cookie and same origin and the Steam bridge by its token, routes console-build, console-debug, console-update and console-control, proxies party-api and CODE to the coordinator and everything else, including websocket upgrades, to the dashboard. Code: `tools/hosting/authorize.ts`, `tools/hosting/gateway.ts`, `tools/hosting/http.ts`, `tools/hosting/request-origin.ts`, `tools/hosting/websocket.ts`.
- **LIF-037** Setup and pairing: /setup routes, an access file of hashed browser and Steam credentials, one-use invitation links, 8-character access codes that expire after 10 minutes or 5 wrong guesses, account session to config with realm discovery, and the HTTP to HTTPS setup transfer. Code: `tools/hosting/access.ts`, `tools/hosting/account.ts`, `tools/hosting/address.ts`, `tools/hosting/realms.ts`, `tools/hosting/setup-routes.ts`, `tools/hosting/setup-transfer.ts`.
- **LIF-038** Local HTTPS: it installs a checksum-verified Caddy, runs it with an internal CA for the configured LAN hosts, probes certificate handshakes before reporting ready, and serves the root certificate and trust helper scripts. Code: `tools/hosting/install-caddy.mts`, `tools/hosting/tls-config.ts`, `tools/hosting/tls.ts`, `tools/hosting/trust.ts`, `tools/hosting/verify-https.mts`.
- **LIF-039** Update service: it checks the GitHub latest release every 6 h, validates the release manifest, tracks the check, download and restart phases and the automatic preference, holds character startup during a boot check, and labels source checkouts with tag, branch or commit. Code: `tools/update/agent.mts`, `tools/update/boot.ts`, `tools/update/contracts.ts`, `tools/update/github.ts`, `tools/update/hosting.ts`, `tools/update/service.ts`, `tools/update/version-label.ts`.
- **LIF-040** Update install: the Windows adapter downloads and verifies the release zip and the Docker adapter pulls the image by digest; a journaled transaction writes its own `updates/pause.json` lease and waits up to 60 s for acknowledgements, stops the console, backs up state, starts the target, checks health up to 120 times 1 s apart and rolls back on failure (transaction.ts:15-25, :48-90). Code: `tools/update/docker.ts`, `tools/update/files.ts`, `tools/update/process.ts`, `tools/update/transaction.ts`, `tools/update/windows.ts`.
- **LIF-041** Release packaging: payload.mts stages a Windows release with release.json file hashes; the semantic-release prepare step checks the asset checksum and immutable image; startup checks confirm a fresh install reaches setup and the packaged dashboard renders. Code: `tools/release/payload.mts`, `tools/release/verify-assets.cjs`, `tools/release/verify-startup.ts`.
- **LIF-042** Class bundle history: remembers each verified generation, keeps the retained builds and deletes only known bundle files, pins a rollback and resumes the staged build. Code: `tools/game/history.ts`.
- **LIF-043** Character source watch: file events on runtime/characters, dashboard/lib and shared.js, or 1 s polling when `AL_WATCH_POLL=1`, a 250 ms debounce, a typecheck, then a verified build and publish. Code: `tools/game/watch.mts`.
- **LIF-047** build-history command line: lists and cleans console, game and dashboard builds, rolls back or resumes the game stream, and asks the host to deploy, roll back or resume a console candidate. Code: `tools/build-history.mts`.

## 2. What goes wrong

### LIF-W1. Bug 15: Steam orphan runner (current)

The reported symptom: after console restarts the Steam client throws reading `S`/`character`
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
   `connect`, so those handlers stay on the socket (:309-315). Its `game_response` names do
   match the three `game_response` listeners outside the registry.
5. The game window and its socket outlive the CODE frame, so the old handlers keep firing
   into a closure whose frame is gone. A Steam client restart discards the game window and
   with it the handlers, which matches the report.
6. `stop` also clears `eventClockTimer` only inside the same `parent.socket.off` branch
   (:17438-17439).

Patch history: facc4224 (upstream, 2026-10-08, "retire Steam CODE callbacks") added the
`game_response` signatures to the text search; it is an ancestor of `ryan-1.5`
(`git merge-base --is-ancestor facc4224 refs/review/ryan-1.5`). That is a second pass of the
same workaround.

The current console already solves this for headless workers: `RunnerScope` records every
subscription a generation makes and removes them on dispose whatever the frame state
(runner-scope.ts:81-96, :186-203). The native path has no equivalent.

cb8881f6 (an ancestor of `ryan-1.5`) fixes the other two parts of ledger bug 15 in the
current console: it adds process-lock.ts for the writer lock identity (spec 11 SET-009,
SET-W6) and `pruneProductionReceipts` for production receipts (spec 10).

### LIF-W2. Committed browser bundles are older than their sources (current)

characters/universal-loader.js on the current console is older than its source: it has no
activation record, no console-deployment poll and no maintenance hand-off, and polls only
in a non-caracAL frame (compare universal-loader.js:102-157 with universal-loader.ts:91-176).
Its last change is facc4224 (2026-10-08); the source's is 1973bb5d (2026-10-21)
(`git log -1 refs/review/ryan-1.5 -- <file>`). By the same command party-member.js (10-09),
roles.js (10-09) and steam-bridge.js (10-09) are older than the sources they bundle
(runtime/characters/movement.ts 10-18, runtime/characters/roles 10-21, runtime/steam 10-21);
their contents were not compared.

A build with `--publish` rewrites them (tools/build-runtime.mts:25-29, :46-47). The candidate
builder runs it (builder.ts:181) and so does the production image (Dockerfile:14). The managed
host loads its code from the active candidate (bootstrap.ts:13-14), so the loader it copies
over the published one (hosting.ts:85, :115) is the candidate's fresh copy. Before the first
candidate exists the host runs from the checkout, and a checkout that never ran a publish
build copies the stale file (inference). The function index lists universal-loader.ts, the
source, and not the committed file.

### LIF-W3. A refused deploy still publishes a draining lease (current)

1. `beginMaintenance` writes the lease (hosting.ts:150) before it reads the character states
   and refuses for a Cave run (:151-152).
2. The controller's failure path then removes it (`releaseSafeWait`, controller.ts:97;
   safe-reload.ts:40-43).
3. Between the two the lease is live for at least one console-runtime request (up to 3 s,
   hosting.ts:31). Inference: characters that read it in that window start draining.

### LIF-W4. Tests cut functions out of shared.js; production carries guards (current)

1. shared.js has no module boundary, so 117 of the 118 test files that mention it evaluate
   cut-out parts of it (counts above).
2. Each test lists the extracted functions' dependencies by hand (passive-hunting.test.cjs
   builds its own context of stubs and named functions, :20-31).
3. When production code gains a call to another shared.js function, an extracting test that
   lacks it throws. The fork documents one case (LIF-W5); the current console has 85
   `typeof X === "function"` guards on 32 internal functions (`shared-guards.cjs`), but the
   code does not say why each was added (inference that tests are the cause).
4. A guard hides a real missing function in production: a rename turns the check off with no
   error.

shared-context.cjs narrows the gap: it injects the real gate functions (:15-20), but the
tests that use it still extract shared.js text. The role runner shows the same tolerance from the other side: it checks
`typeof sharedRoutine !== 'undefined'` and calls most hooks as `sharedRoutine.x?.()`
(runner.ts:49-52, :67-110).

### LIF-W5. Bug 10: unit regressions from the console Pause check (fork)

1. 9a34a4c1 (2026-10-24) adds `consolePauseHolds()` calls inside the current `returnCombatActive`
   and `isAttackingPartyMember` (fork shared.js:3652, :14847; the function at :3655).
2. passive-hunting.test.cjs (:30) and event-return-turnover-hold.test.cjs (:8) extract those
   functions with `namedFunction` into contexts that do not define it (LIF-W4 step 2), so
   they throw ReferenceError (250c61e1 commit message).
3. 250c61e1 (2026-10-25, "Guard the console Pause check where tests extract the combat
   functions") wraps both calls in `typeof consolePauseHolds === "function"`.
4. Result: the fork has 189 guards, 112 on 45 internal functions
   (`node tools/shared-guards.cjs $R HEAD`; 21b8362d gives the same), 27 more internal guards
   than the current console. Only 2 of the 27 come from 250c61e1; the rest guard fork
   functions such as `bossCombatActive` (8) and `pullModeActive` (4).

The fix at the cause is to add `consolePauseHolds` to the two fixtures, or move them to
`createSharedContext` and add it there, and remove the two guards. Patch applied: symptom
only.

### LIF-W6. Smaller findings (current)

- `serveTypeCode` binds every interface (`app.listen(settings.port)`, web-services.ts:63)
  while `serveCode` binds 127.0.0.1 (:42). `serveTypeCode` creates its own server only when
  TYPECODE is exposed and no earlier step created one (:60-64).
- `stopWorker` gives a worker 500 ms to close before SIGKILL (processes.ts:27). Inference:
  shutdown kills a worker that is mid-way through a game transaction.
- runtime/coordinator/index.ts:61 exports `createResources` and one test covers it, but no
  production code calls it (LIF-011).
- The build string-patches shared.js text (legacy-boundary.ts:2-8), so editing either anchor
  line breaks publishing.
- shared.js:2-13 is a one-time iframe migration with a version flag and no end.
- `scripts/native-network-isolation.cjs` is an e2e helper (imported by e2e/live-fixtures.ts:20)
  indexed as production code (handed to spec 15).
- The safe-point wait of a deploy has no time limit (controller.ts:75-78, safe-reload.ts:25-34);
  only the activation step is bounded at 120 s.

## 3. Fork differences

- **Console Pause, Play and clean shutdown** (b33aee77, 9a34a4c1, 250c61e1;
  fork runtime/coordinator/lifecycle/console-control.ts, 303 lines). Pause writes
  `updates/console-pause.json`; `userPauseLease` turns it into the current draining lease with two
  new flags, `immediate` and `userPause` (console-control.ts:35-42, :72-82). The coordinator's
  lease reader prefers the deploy lease and falls back to the Pause (fork
  console-maintenance.ts:43, `hostLease(directory)||userPause()`), and the managed host reads
  the same file again for its console-deployment reply (fork hosting.ts:200,
  `maintenance.lease||userPause()`). Consequence (inference): during a deploy while paused the
  deploy lease, which has no `immediate` flag, hides the Pause, so held characters fall back
  to finish-the-fight behaviour until the deploy releases its lease (fork shared.js:2580-2587).
  Characters treat the Pause as return-trip defence through `consolePauseHolds` (LIF-W5).
  Play restores 23 captured settings (13 profile keys and 10 global keys,
  console-control.ts:234-238; spec 11 section 3). Other patchwork: a 25 ms busy-wait retry up
  to 20 times around the file rename (console-control.ts:61-67) and a hard-coded
  `stopDirectory` that names one host's local checkout path (:47).
- **Shutdown** (fork shutdown.ts:9-26): after a clean "prepared" shutdown the worker wait is
  bounded at 5 s because the host exits 15 s after SIGTERM (start.mts:118).
- **Deploy hold** (0875e047, bce3a9fb; fork tools/console-build/hold.ts:1-22): refuses a
  coordinator deploy during a Cave run or an event, on top of the Cave rule for safe and Main
  modes. It copies the Cave and event rules (:4-9), a third copy beside
  console-control.ts:96-102 and the 17 copies of the event rule in the current console
  (review/full/core.md:184). It runs inside `beginMaintenance` after the lease is written
  (fork hosting.ts:161-165), so it inherits LIF-W3.
- **Builder changes** (0bea0e19, 4ddff3c9, fed277ae, 738b52d2): two dependency cache fixes
  with stated causes (0bea0e19, 4ddff3c9), `AL_CONSOLE_WATCH=0` to skip the source watcher,
  which cost about a third of a core on a bind-mounted checkout, plus a build command
  (738b52d2), and a move of that choice and of `AL_CONSOLE_SOURCE`, a separate source
  checkout, into `sourceWatcher` (fed277ae; fork hosting.ts:72-77). Not patchwork.

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
| LIF-019, 048 | loader-activation-poll (3), loader-connection (3), e2e/live-console-explicit-activation.spec.ts | Activation and bridge loading | A detached-frame dispose (LIF-W1) |
| LIF-021 | fight-death-packets.test.cjs "native iframe replacement removes stale combat callbacks without touching game listeners" | The registry and text search for combat listeners | The 7 events the search misses (LIF-W1); guards a workaround |
| LIF-022, 025, 026 | party-loader.test.cjs (2) | Legacy entry order, refusal without shared code | stop() completeness |
| LIF-023, 024, 045 | console-updates.test.cjs "maintenance requires fresh acknowledgements...", e2e live-console-safe-reload, live-console-main-reload, live-console-mixed-deployment, console-build-safe-host, console-build-transaction "safe deployment renews its lease..." | Lease acknowledgement, renewal, safe and Main reload on real play | LIF-W3 |
| LIF-028, 044 | e2e console-build.spec.ts (1), console-build-host.spec.ts (4 of 5), console-build-transaction.spec.ts (1 of 2) | Deploy journal, rollback, recovery, pinned restart | Dashboard respawn backoff |
| LIF-029, 042 | game-generation.test.cjs (1), build-retention.test.cjs (2 of 6) | Atomic publish, retention, rollback pin | none noted |
| LIF-032, 036 | console-build-lock.spec.ts (1 of 3), console-build-gateway.spec.ts (1) | Lock recovery, gateway authorization | Cleanup past 20 candidates |
| LIF-027 | coordinator-application-launcher.test.cjs | Routes exist after start | CORS, body limit, TYPECODE binding |

Mapped tests are those in catalog/13-lifecycle.json; the other tests in the console-build e2e
files (artifact-header, browser-recovery, native-input, prepared, the other lock and
retention tests) are not mapped yet.

Tests that only guard a patch: the fight-death-packets case above guards the text-search
workaround and itself slices shared.js text. passive-hunting.test.cjs and
event-return-turnover-hold.test.cjs are the tests the fork's two Pause guards exist for
(LIF-W5). No test covers LIF-018 or LIF-020.

Rules check against the console's AGENTS.md (docs/implementation/00-method.md, "Rules every
change follows"):

- fight-death-packets.test.cjs "native iframe replacement removes stale combat callbacks..."
  cuts shared.js by `indexOf` markers (:20) and runs the slice in a vm. It asserts listener
  counts, not source text, but it is an isolated test of a workaround that depends on source
  markers. It retires with the text search (section 5 item 1); an E2E replaces it.
- passive-hunting.test.cjs and event-return-turnover-hold.test.cjs are isolated extraction
  tests from the current console. The fork does not add to them (section 5 item 5).
- Every new proof this spec proposes is a gameplay E2E on ChronAL virtual time, with its
  failure list written before the code (section 5).

## 5. Needs your review

1. **Listener ownership (bug 15, LIF-W1).**
   - Today: 10 socket listeners sit outside the owner registry; only `stop` removes them,
     and the loader skips `stop` once the frame is detached. A text search cleans 9 events
     and misses 7.
   - Options:
     (a) Register every listener character code puts on the game socket with an owner, as
     headless `RunnerScope` does, so the next load removes them whatever the frame state; drop
     the text search. Negatives: touches shared.js load code and `start`, and the fix lives in
     the current console, so it goes upstream as an issue and waits on review there.
     (b) Add the 7 missing events to the text search. Negatives: a third pass of the same
     workaround; any future listener needs another entry; source-text matching can miss
     minified or renamed handlers.
     (c) Change nothing and restart the Steam client after console restarts. Negatives: the
     errors and stale handlers continue; the cause stays hidden behind a manual step.
   - Recommendation: (a). It removes the cause in one place, reuses a pattern the current
     console already trusts for headless workers, and lets the text search and its test go.
     Its negatives: it is a change to the upstream code, so it needs an issue and agreement
     there. Its proof is a new ChronAL E2E that detaches a native CODE frame, reloads, and
     counts socket listeners per event; no such E2E exists today, and its failure list comes
     first. The fight-death-packets slice test retires with the text search.

2. **Pause model (fork, section 3).**
   - Today: Pause captures 23 settings and the merchant queue, and Play writes back every key
     that differs, so changes made while paused revert (spec 11 section 3).
   - Options:
     (a) Pause becomes a hold that owners respect: no snapshot, no restore on Play.
     Negatives: anything that changed during the pause stays changed, including automatic
     changes the restore used to undo; each owner must check the hold itself.
     (b) Keep snapshot and restore. Negatives: user changes during a pause are silently
     reverted with only "Restored X" lines; cancelled merchant jobs come back.
     (c) Keep the snapshot but restore only keys the user did not change while paused.
     Negatives: needs a record of who changed each key (spec 11 SET-W4), which does not
     exist; more code than either other option.
   - Recommendation: (a). It matches how the deploy lease already works (a hold, no
     snapshot) and removes the revert surprise and the second owner of 23 settings. Its
     negative: owners that relied on the restore to undo automatic drift during a pause need
     their own check. This choice decides spec 11 SET-Q4 too.

3. **Deploy while paused (fork).**
   - Today: the deploy lease takes precedence over the Pause file, so held characters switch
     to finish-the-fight behaviour until the deploy releases its lease (inference from
     console-maintenance.ts:43 and shared.js:2580-2587).
   - Options:
     (a) Characters stay in the Pause's defend-only mode for the whole deploy. Negatives: the
     lease reader must merge two sources into one lease state.
     (b) Characters follow the deploy's finish-the-fight rule, as today. Negatives: a paused
     party starts acting during the deploy, which is not what Pause promises.
     (c) Refuse a deploy while paused. Negatives: the user must press Play, then deploy, then
     Pause again; a deploy cannot fix a problem that made the user pause.
   - Recommendation: (a). It keeps the promise Pause makes and needs only the lease reader to
     merge the two sources (`immediate` wins). Its negative: the deploy's safe-point check
     must accept defend-only characters as ready, which changes LIF-023's acknowledgement rule.
     Its proof is a ChronAL E2E that deploys while paused and measures attacks on
     non-attackers (pass: 0).

4. **Shutdown grace (LIF-005, LIF-W6).**
   - Today: shutdown gives each connected worker 500 ms to close, then SIGKILL; a deploy
     waits for `canReload` before activation, a plain shutdown does not.
   - Options:
     (a) Shutdown first asks for the same safe point a safe reload uses, with a time limit,
     then stops workers. Negatives: shutdown gets slower; the host's 15 s exit timer
     (start.mts:118) caps the wait, so the limit must stay under it.
     (b) Raise the fixed grace (for example 5 s). Negatives: still cuts a long transaction;
     a worker that ignores `closing_client` delays every shutdown by the full grace.
     (c) Keep 500 ms. Negatives: shutdown kills a worker mid-transaction (inference; no test or
     log here shows a lost transaction).
   - Recommendation: (a). It reuses the existing safe-point machinery, so a shutdown waits
     only while something is busy. Its negatives: more shutdown code, the time limit must be
     chosen under the host's 15 s exit, and the risk it guards against is inference until a
     ChronAL E2E that shuts down during a merchant transaction shows a lost transaction.

5. **Test extraction and guards (LIF-W4, LIF-W5).**
   - Today: 117 test files evaluate cut-out parts of shared.js; the current console has 85
     internal guards and the fork 112. 250c61e1 documents 2 fork guards that exist only so
     two extraction tests run.
   - Options:
     (a) Fork only: prove the Pause defence with a ChronAL E2E (a paused party meets a
     passing attacker; measure attacks on non-attackers, pass: 0), then remove the 2 guards.
     The two upstream extraction tests then fail, so the fork adds `consolePauseHolds` to
     their fixtures as the smallest edit to tests it does not own. Send upstream an issue
     about E2E proof in place of shared.js extraction. Negatives: the fork still edits two
     isolated tests it would not write itself; the other 83 current and 25 fork guards stay;
     the issue may not be taken up.
     (b) Add `consolePauseHolds` to the fixtures or move the tests to `createSharedContext`.
     Negatives: invests in source extraction, which AGENTS.md ranks below E2E; it proves the
     guard-free code only inside a vm slice.
     (c) Remove every internal guard and fix each test that breaks. Negatives: a large change
     across many tests and upstream code; the reason for each guard is unknown, so some may
     guard a real production case.
     (d) Leave the guards. Negatives: a renamed function turns its check off with no error.
   - Recommendation: (a). The E2E proves the behaviour the guards hide, the guard removal
     touches only fork code, and the fixture edit keeps the upstream suite green without new
     extraction tests. Its negatives: the E2E needs a passing-attacker setup on ChronAL with
     its failure list written first, and the extraction pattern stays until shared.js gets
     module boundaries.

## 6. The design

M1.

## 7. What changes for the player

M1.

## 8. Proof

M1.

## 9. Migration

M1.

## 10. Gaps

`node tools/check-claims.mjs` (run 2026-10-26, after the verification splits), filtered to
13-lifecycle:

- Functions claimed: 644 in 48 behaviours (`node -e` over catalog/13-lifecycle.json). Unclaimed
  functions in the whole index: 0.
- Claims naming no known function: 0. Claimed by more than one spec: 0.
- Behaviours with no test: LIF-018, LIF-020, LIF-030, LIF-031, LIF-033 to LIF-035, LIF-037 to
  LIF-041, LIF-043, LIF-046, LIF-047.

Not yet verified or not covered:

- The Steam bridge and roster handoff (runtime/steam, runtime/roster, characters/steam-bridge.js)
  are spec 09; LIF-W1 step 3 depends on how they recreate the runner, which was not read.
- Test accuracy review (method step 2) not done; test names and the bodies cited were read.
- The contents of the committed party-member.js, roles.js and steam-bridge.js were not
  compared with a fresh build (LIF-W2).
