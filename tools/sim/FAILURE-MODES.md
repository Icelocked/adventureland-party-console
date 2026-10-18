# Simulation harness failure inventory

## Full browser gameplay clock integration

Recorded before implementing the shared clock backend:

- A game realm, coordinator, browser CODE frame, or headless worker uses a different epoch/rate, especially after restart or reconnect.
- Advancing gameplay time starves actual Socket.IO, MongoDB, filesystem or browser work; native receipts and publication must still settle separately.
- Virtualizing Playwright's own watchdog or monotonic clock makes a stalled test pass or reports misleading wall durations.
- Browser network timing remains native wall time. Comparing request startTime against virtual Date acknowledgement timestamps falsely rejects later real HTTP requests; retain native I/O timestamps separately from gameplay observations.
- CPU slicing and native renderer task measurements need native monotonic time. A virtual performance clock cannot advance inside a synchronous search, so it must not govern the fixture's existing 8 ms CPU yield budget.
- Host deployment lease renewal uses native timers with virtual expiry timestamps, allowing an active lease to expire between renewals. Inject the gameplay scheduler into that host operation without replacing Playwright timers.
- Browser timer installation misses companion frames or CODE reloads, changes graphics coverage, or bypasses real HTTP fault injection.
- Native timer refresh/cancellation semantics differ; repeated callbacks or uncancelled work duplicate native actions.
- Node's `timers` imports escape the virtual clock (the pinned Engine.IO uses these and `refresh()`), creating transport heartbeat drift. Cleared timers must stay cleared; completed timers may refresh; ref/unref and callback receivers must remain compatible.
- Replaced headless CODE windows leave virtual timers behind because jsdom only knows its native timer registry. Closing a VM window must cancel only its own timers, preserving its parent game and the next CODE generation.
- A native parity run accidentally inherits acceleration, or one remaining gameplay spec silently runs without ChronAL.
- Selection changes omit scenarios, assertions, browser/deployment journeys or failure artifacts.
- A speed comparison changes CODE, fixture data, selected scenarios or assertions between runs.

Require clock participant receipts, exact scenario selection, real native outcomes, full E2E evidence and externally measured wall durations on both backends.

## Complete-suite fixture isolation and local parallel workers

Recorded before implementing account CODE reset and parallel game pools:

- Each native companion bootstrap allocates a saved CODE slot. A shared disposable account eventually fills all 100 slots unless the scenario boundary restores its declared CODE inventory through native APIs.
- Published loopback addresses collide, or native realm advertisements direct one worker into another worker's game/database.
- A worker resets another scenario's players, CODE, account state, or explicit activation; each worker needs its own disposable upstream stack and each scenario its own served CODE root.
- A worker joins another pool's clock or changes epoch after restart. Pool assignment must follow the stable parallel worker index, with matching participant receipts.
- Multiple dashboard development servers contend for one lock or compile inconsistent sources. Browser fixtures should serve the same verified completed production artifact on isolated test ports.
- Parallel reporting omits, duplicates, or misattributes scenarios. Require the full distinct scenario identities, strict ownership assertions and exact executed CODE hashes on both backends.
- Startup, artifact preparation, or a different worker allocation is mistaken for clock improvement. Record preparation and compare identical full inventories and worker allocations using native wall measurements.
- A failed or interrupted run leaves owned containers, volumes, child processes or clock actors behind. Cleanup must target only the run's verified test resources.
- Resource contention causes a misleading speed claim. Validate the entire local run and retain every failure instead of relaxing assertions or deadlines.

Recorded before integration. Validate with real ChronAL server/client/CODE journeys.

- Setup drifts from exact commits, silently accepts a dirty checkout, or installs outside .build/sim.
- Windows cannot launch npm or create unprivileged symlinks.
- Simulation reads credentials, publishes CODE, opens real coordinator ports, or contacts live game services.
- Coordinator or planner uses wall time; threaded IPC deadlocks or fails recording commands.
- Stale bundles execute instead of current working-tree sources.
- A shared E2E CODE root retains another journey's activation record, so clients execute that prior selection while evidence records the new staged manifest. Serve CODE from the scenario-owned root and require exact native startup hash receipts for every owned client.
- Requests fail or steps return HTTP errors while the run reports success.
- Offline actors, incomplete duration, or missing native kills pass vacuous expectations.
- Invalid durations/sampling/steps loop forever; pending requests lack a bounded virtual deadline.
- A repeated seed or passive tracing changes timeline bytes.
- Timing reports omit setup/build costs or imply the Playwright suite was accelerated.
- Interrupted runs lose diagnostics or leave threads/processes alive.

Keep reports, timeline hashes, exact build/scenario/pin identities and measured wall time.
Compare the same bounded native scenario at paced real time and accelerated time.
The existing console/native Playwright suites retain their independent coverage.

Browser animation callbacks must retain native rendering cadence while their timestamps share the virtual performance.now domain. A raw native RAF timestamp paired with virtual performance.now can break native renderer animation and tween progress. Verify through the actual browser CODE replacement journey before changing the adapter.

## Node window throughput and hidden-frame readiness

Recorded before changing the asynchronous network clock pump:

- Each virtual Node timer yields a native macrotask, so a busy real game world can advance slower than real time despite the requested rate. Compare actual E2E wall times and broker diagnostics.
- ChronAL runSync must execute from a native macrotask; invoking it inside a Promise continuation prevents the complete microtask checkpoint.
- The public synchronous window excludes its exact end boundary while the existing network protocol includes it. The pinned adapter must process exact-boundary callbacks once without advancing ahead, rewinding time, or editing ChronAL's checkout.
- Native socket and persistence callbacks need an event-loop turn before a window is acknowledged. Synchronous advancement must preserve real I/O and all strict native action, storage and telemetry assertions.
- Hidden companion frames may suppress animation frames even after native login and CODE telemetry are ready. Keep the same readiness predicates and 90-second bounds, but poll them independently of rendering visibility; retain a fresh timestamped native snapshot on failure.

- Browser microtask checkpoints scheduled in a hidden child document may be throttled. Dispatch through the same-origin top document when available, retain a full native task checkpoint, and fall back safely across origins.
- Larger bounded windows can reduce barrier overhead but must execute every due callback, retain rate caps and discard catch-up credit. Validate strict action counts, cooldowns, movement ownership and storage/telemetry milestones through unchanged native E2Es.

## Native cosmetic bank-sort confirmation

Recorded before the gameplay fix, after existing E2Es and five real-bank diagnostic repeats:

- A fixed 220 ms pause expires before native bank-swap publication, so cosmetic sorting observes its old inventory and sends another swap or clears a buffer journal prematurely.
- A locked bank item is then carried out of the bank as an unreturned sort buffer. Correct sale receipt counts do not prove protected bank-stock conservation.
- Confirm both exact inventory-buffer and bank-slot identities and quantities from one fresh native snapshot. Native action acknowledgement alone is insufficient.
- Journal expected results before mutation; retain unresolved operations across errors/reloads, do not repeat an unconfirmed swap, and prevent departure until cleanup is confirmed.
- Preserve current runtime, character and bank-floor ownership. Cancellation, changed identities, unavailable bank state, native rejection or missing publication must remain bounded errors rather than silently releasing a buffer.

The retained VM bank fixture must expose the same native bank receipt APIs used by the maintained sorter. Route those APIs through its existing socket mutation seam; preserve every existing isolated assertion. Lifecycle regressions require local bind/symlink permissions and the documented verified game-fixture setup.

## Success-focused native upgrade fixtures

A storage-echo scenario requested a +3 helmet with the normal 90% attempt allowance, but native +2/+3 base chances are 98%/95%. A legitimate failed native roll exhausts that unrelated budget and prevents the journal scenario from reaching its assertions. The initial manual-offering proposal was invalidated by focused native consumption evidence: purchase orders do not use that policy. Declare an initial ten-cycle purchase/scroll allowance before the exact queued job is admitted, matching the existing production-journal echo fixture. Preserve native random draws, definitions, costs, retry purchases, receipts, reconnect and all result/ownership assertions; do not fabricate success or widen completion timeouts.

Arrival acknowledgement clock boundary: a valid current zero-distance route can report arrival just before the coordinator departure clock. Rejecting it as stale parks the current client forever. Invalid ownership must still reject; valid early completion must wait without completing, changing commands, or discarding receipts. Validate existing native Halloween staging/restart/combat journeys on both clocks.

Scenario-local CODE directories must retain the real coordinator planner worker. Resolving its bundle through the new writable scenario directory loses the worker and silently switches every route to native fallback. Pass the maintained built worker explicitly through the application platform, keeping all writable CODE and persistence paths isolated. Native fallback and planner behavioral assertions must remain available.

Departure fault injection must not busy-wait on virtual Date: that freezes the frame and the shared clock barrier. Delay only delivery of the targeted real scheduled status response across its actual departure deadline, using virtual timers. Keep its native payload, exactly three distinct epochs, before/after timestamps, zero route retries, actual arrival and runtime-generation assertions. Restore the transport wrapper in finally; unrelated status/movement responses remain unheld.

Shared-pool world isolation: declared terrain fixtures remove native ambient monsters with nospawn:true and leave live/count accounting unchanged. Later Hunt tests can have zero Goos despite nine native population counters. Journal only original native map-pack actors before such removals, clear entries on genuine ordinary native removal, and restore missing actors only between disconnected scenarios through the original native constructor/last_state. Existing restored live IDs must not duplicate; temporary/owned encounter actors must never be resurrected. Verify registry identity and unchanged population counts, retain reset receipts, and run terrain followed by original ambient Hunt journeys.

The focused storage-echo run reached all original results but proved that purchase-order upgrades do not consume manual-upgrade offerings: all four remained. Remove that ineffective fixture input. Use the existing production-echo scenario's declared initial queued-order allowance: hold dispatch, verify exact unadmitted job identity, declare ten native purchase/scroll cycles before admission, then release. Native failures, retry purchases, costs, RNG, upgrade receipts, storage echoes, reconnect, and exact final +3/+1 counts stay real. Do not change production purchase policy or loosen completion bounds.

Timing provenance must reject maintained source edits during a measured backend run. Matching selections and staged CODE alone cannot certify the coordinator/fixture source actually used. Compare the prepared source fingerprint, each backend candidate fingerprint and the current fingerprint after completion; preserve the archived evidence on rejection.

Delayed departure response release must recheck its coordinator-clock deadline after waking. Full-run evidence captured three genuine epochs, but a real queueClockOffset resynchronization during the second hold moved its estimated coordinator time backward: endedAt was 891.5 ms before departAt. A one-shot timer therefore produced only two genuinely late signals. Reschedule only that epoch's delayed callback until its current estimated coordinator time reaches departAt+2000; retain bounded wake/offset observations, all three strict deadline checks, unchanged120-second admission bound, zero physical retries, and actual arrival. Do not change gameplay clock synchronization or increase the test timeout.

Anniversary restart/Hunt handoff exposed an obsolete deferred checkpoint owner: native and later coordinator snapshots agreed Priest stayed at Main0,0 while Warrior killed66Goos. The completed Anniversary cycle retained Priest deferred phase returning-to-checkpoint, checkpoint:null, and its old event-resume-travel command; status continued publishing the old cycle, so client return-defense blocked reunion. Before command admission short-circuits reconciliation, retire only this empty checkpoint continuation after one fresh alive non-event native Main-town observation. Scope command/walk retirement to the exact old cycle and preserve unrelated/newer owners. End only the matching Hunt event trip, then clear deferred metadata and persist. Do not fabricate a checkpoint arrival, advance Native gameplay, broaden region assertions, or widen the90-second return bound.

The full catalog picker completed its browser click while its real HTTP mutation was still busy, then the gameplay-clock poll expired with no persisted blacklist entry. Browser transport completion and coordinator publication are separate milestones. Observe the exact native POST /hunt-blacklist response for action:add, monsterId:goo, character:E2EWarrior before polling the unchanged exact fresh profile reason. Retain native wall and gameplay timestamps, status, body and request failure observations, including on failure. Preserve real sprite/text clicks, scrolling, all catalog checks and the original gameplay publication bound; do not synthesize the action or add sleeps.

After the stale-owner fix, four concurrent Anniversary restart repeats produced two passes and two strict physical-arrival failures with deferredEventReturns:{}, null commandObservation, returnDefense:false and real native movement. Both failures had Warrior around Main y606-637 fighting ambient Goos while Priest approached at y276-328. The existing test declares its own real Goo encounter only after both fighters reach y702-872; unrelated ambient combat races that precondition. Declare reversible Main ambient isolation for the three visit/return modes before prepareHunt, exempt only the already-declared temporary next encounter, and restore native actors/population accounting in finally. Keep both-fighter physical region, exact same Hunt cycle, real kiss/reward and real subsequent kill/quest assertions unchanged. Repeat all modes and preserve isolation/restoration receipts; other ambient-Hunt scenarios remain intact.

Full paired attempt exposed a verified pinned-upstream Cave publication defect, not slow combat: both native actors reached the Lockbreaker and native floor0 required rooms all completed, while both clients kept its prior done:false/remainingMs payload for372000ms. Disposable server logs repeatedly report cave_option_unavailable -> cave_snapshot -> cave_publish TypeError reading follow. A resolved farewell vote retains its NPC object after native departure clears zone_actor; the upstream optional check guards npc but not zone_actor. Apply only the missing optional guard in e2e/game/configure.cjs before owned server processes start, identically on native and ChronAL. Require exactly one expected upstream occurrence (or verified already-patched form), fail on drift, retain native room/vote/action behavior and all existing assertions/budgets, and do not edit the pinned checkout or installed game. Validate the original full Cave completion/farewell journey repeatedly and include matching setup on both complete benchmark backends.

Native full parity found an absent-spawn fixture coordinate mismatch: prepare() saved the fresh accepted checkpoint (-286.30,739.41), but its return assertion still used the bootstrap seed (-335,685). Both actual native fighters returned within45units of the accepted checkpoint, all event ownership retired, yet remained >100from the seed. Retain and attach the actual prepare() checkpoint receipt; keep the explicit Halloween map, same100-unit radius, both actual players and nojoinedEvent predicate, original expiry/return bounds, and repeated-feed non-reopening assertion. Validate both clocks repeatedly; do not change gameplay or widen distance/time bounds.

Native full parity also found the Boo Boo return-cache fixture awaiting both one-kill quests before a communication fault, while Warrior completed and claimed its real reward and Priest still needed one kill. Native initial snapshot had party:null for both, Warrior144000XP and Priest0; party() only posts coordinator formation, which does not prove native membership. Upstream native quest credit follows the actual server party. Before seeding these one-kill quests, poll one fresh native snapshot for the exact two-member party and both native player.party owners, and retain the accepted snapshot even on failure. Do not add sleeps, seed completions, widen the300-second real-kill bound, or change the subsequent shared return route/cache/fault/reward checks. Preserve first32 and latest32 preparation observations so a future failure retains initial native/coordinator quest transitions. Validate this admission hypothesis in repeated real-game journeys on both clocks before changing gameplay.

Native parity exposed a lucky-restoration fixture restart race: start_runner only creates the replacement frame; immediately stopping its coordinator refused that frame's universal-loader request before runtime admission. A later runtime publication timeout was masked by cross-origin cleanup. Require the replacement runtime to publish before deliberately restarting its CODE host, retain the original post-coordinator-restart runtime assertion, and capture cleanup failures without preventing evidence collection. Keep all native inventory, lucky-roll, storage, ownership and restart assertions and deadlines.

The finite compound collection fixture observed twelve native rings in the owner browser but enabled dispatch without waiting for the coordinator's inventory and derived twelve merchant marks. A native run completed gold service while all twelve rings remained marked and untransferred. Before enabling collection and processing, require one fresh coordinator snapshot with all twelve exact native slots and all twelve matching marks; retain bounded observations and actual handoff request/response receipts. Treat this as an admission hypothesis until repeated native/ChronAL validation. Do not fabricate transfers, alter compound odds, loosen strict ingredient/result counts, increase the collection deadline, or change gameplay without receipt evidence.

Stale-peer event admission fault overlapped the historical-state coordinator restart. The retained native browser stayed connected but its status requests were aborted through restart/download downtime until Steam's unchanged20-second recovery legitimately replaced CODE. The original strict unchanged-runtime and later follower admission assertions then failed. Restore historical deferred owners with event selection initially empty, wait for both original browser runtimes to publish on the restarted coordinator, then begin the target Priest-only status-loss fault, prove actual telemetry staleness, and select the event through the real formation endpoint. Release only after Warrior admission with Priest still deferred. Preserve both original runtime identities, the stale thresholds, original20-second fault lease, exact saved waypoints, all ownership checks, actual native hits by both fighters and existing deadlines. Do not disable Steam recovery, refresh health fields, replay/synthesize acknowledgements, or change gameplay to accommodate fixture transport downtime.

Workspace retention: repeated runs left thousands of completed .build/e2e UUID directories after Playwright had copied their log attachments. Native workspaces also duplicate staged CODE/assets, so retained workspaces consumed hundreds of GiB even though logs were a small fraction. Remove only each fixture's own direct UUID child after owned processes stop and awaited attachment copies complete. Resolve and validate the exact absolute target under .build/e2e before recursive removal; reject links/outside paths. Never delete candidate releases, reports or benchmark evidence. Retain a workspace when attachment copying fails and support explicit E2E_KEEP_WORKSPACES=1 diagnostics. Emit a cleanup receipt into test artifacts, verify removed paths and retained log hashes with real console/gameplay E2Es, and keep an explicit audited/approved plan for historical bulk cleanup.

Stale-peer follow-up supersedes the delayed-selection hypothesis above: enabling no event during restore can start a new shared return-to-town convoy, which the subsequent missing-peer fault stalls before admission. Preserve the original atomic restoration of deferred owners and selected event instead. The fixture launcher currently re-downloads native client assets and recopies all staged CODE on every coordinator restart, unnecessarily consuming the unchanged20-second browser recovery window under virtual time. Cache only the scenario's verified native assets after their first real download, validate every cached file hash and pool/version/headless identity on restart, retain a fresh real account/realm API query each time, and initialize that scenario's writable CODE only once. Preserve activation updates and isolated directories, reject cache corruption, retain native-wall preparation/cache receipts, and validate original stale-peer admission plus browser/headless deployment and rollback on both backends. Do not relax runtime identity, stale thresholds, fault lease, native hits, waypoint checks or deadlines.


Hardware rendering validation plan (before implementation)
- Preserve the running full benchmark's sources, browser flags, worker allocation, reports, pools and processes. Apply maintained changes only after that command ends. Do not start another full suite for this rendering change.
- Headless Chromium can silently fall back to SwiftShader even when a physical NVIDIA adapter is listed. Require the actual GL renderer to name NVIDIA GeForce RTX 5090 for local hardware validation, reject software backends, and retain GPU feature status and driver identities. A separate same-binary --enable-gpu probe already reported RTX5090/D3D11 successfully.
- Keep an explicit software mode for CI hosts without GPUs and focused parity; compare identical existing real-game assertions using one worker, ChronAL on both runs, same repetitions, candidate and recording settings.
- Whole-machine CPU is contaminated by the user's running game/desktop. Measure native-wall CPU deltas for the exact launched browser's processes via CDP SystemInfo.getProcessInfo around the assertion body. Retain PID/type/cumulative CPU snapshots and identify any process turnover rather than silently treating exited processes as zero. Report core-equivalent and machine-normalized CPU, not clock-accelerated timestamps.
- Keep native graphics, canvases, animation frames, video settings, browser/deployment assertions and gameplay behavior intact. Changing time acceleration or removing graphics would invalidate the rendering-only comparison.
- Default local runs to hardware; CI stays software unless explicitly overridden. Validate renderer mode input and document the override. Add optional retained measurement receipts to the existing live fixture; do not create unit tests after implementation.
- After the full benchmark ends and changes are applied, typecheck and run the existing armadillo passing-Goo Hunt focused case repeatedly on software and hardware. Verify evidence hashes, exact case identities, actual RTX5090 renderer, stable process accounting and CPU reduction. Complete and verify a matching immutable console candidate without activating it.


CI bootstrap failure modes and validation plan, before implementation:
- Whole verified candidate manifests exceed Linux's per-environment-entry limit and break every inherited subprocess, not just ChronAL install. Export only directory + immutable manifest path before spawning anything. Do not merely move the oversized assignment later.
- Dashboard serving still requires the verified candidate app directory. Keep its scoped-path validation and preserve global setup verification/source matching.
- Reports and benchmark provenance still require the complete manifest, including all file hashes. Read it from the immutable verified artifact; missing/corrupt files must not silently remove provenance.
- A warm ChronAL cache can conceal the cold setup spawn, and Windows does not reproduce Linux's limit. Validate actual compact metadata inherited by Node24.14 Linux child processes, including a read of the complete real manifest; retain the preceding E2BIG reproduction as negative evidence.
- Nested npm test scripts discard project-selection flags in current CI validate job, duplicating the full gameplay suite instead of console/debug only. Use the direct test:e2e script, and validate actual discovery/invocation without dropping browser or deployment scenarios. Gameplay remains on all16 dedicated shards.
- Run a focused existing console E2E and an existing ChronAL real-game/CODE-restart E2E with one worker, verify complete report metadata/evidence, and finish a matching immutable console candidate without activation. Push to the existing PR branch and inspect CI startup/results.
