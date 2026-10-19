# Self-hosted run 39199505087 recovery

Initial run: 309 passed, 29 failed, eight workers, all 338 selected scenarios.
Failure inventory before implementation:
- Optional timing collection assumes original browser frames survive managed
  headless migration/logout; it can fail after successful gameplay assertions.
  Record current runtime ownership and keep broker-level headless observations.
- Offline fallback fixtures read some files from an installed native cache and
  others from scenario fixtures, making derived-stat availability machine-dependent.
- A bank view can contain a partial bank report even when item count matches;
  compare native stock, slots, reservations, client persistence and later telemetry.
- Virtual time advances in fixed windows: a timed communication fault must retain
  the peer as stale until an exact observed admission, not expire during polling.
- Event return can resume an old encounter/convoy before new farm admission;
  inspect native targets, damage, ownership and command receipts before changing code.
- Realm reloads must register fresh browser/CODE clock participants without
  inheriting retired frame registrations or dropping connections under parallel load.

Preserve all original behavioral assertions and all 338 scenarios. Test focused
failures first with eight workers and hardware rendering, then dispatch complete
self-hosted validation until green. Keep immutable candidates staged; do not activate
the user's live console. Preserve reports; remove owned completed workspaces.

Focused reproduction confirmed a real gameplay issue: both fighters had
`context.allowed=false`, `occupied=false`, a live selected Bee and a convoy in
`defending`. The already-authorized farming handoff was allowed through the
coordinator convoy flag but still rejected by the local paused convoy object.
Allow only that same target's handoff while local convoy defense is paused; retain
all foreign movement, manual navigation, runtime, range, map and realm fences.

Classification of the 29 original failures: 22 retired-browser instrumentation,
two environment-dependent offline profiles, one bank snapshot/job-completion race,
one timed stale-peer fault, two initial clock handshake failures, and one genuine
paused-convoy farming handoff deadlock. Failed native startup and realm-switch
traces both contain an initial local clock WebSocket failure; permanent failures
remain fatal after three bounded connection attempts. The new browser regression
rejects the first actual handshake through an owned local TCP proxy and verifies
that the second connects and virtual time advances, retaining attempt timestamps.

Focused evidence:
- `focused-before-convoy`: 10/11 passed; farming deadlock reproduced with matching
  live Bee target, `allowed=false`, `occupied=false`, convoy phase `defending`.
- `focused-after-gameplay`: both natural farming-return repeats passed (54.6/55.2s),
  both bank triplets passed, both rejected-handshake regressions passed, one of two
  realm cases caught another teardown publication race: new game clock connecting,
  CODE clock not yet installed. The body had already passed its gameplay checks.
- Final clock collection now polls for two current, advancing browser/CODE clocks
  for browser-owned actors and retains strict backend/error assertions. Managed
  headless/offline actors use the broker's participant observations.

The full suite retains all original 338 scenarios and adds one ChronAL transport
regression, for 339 total. That transport-only case explicitly skips native parity,
which uses no virtual browser clock. All existing gameplay assertions remain.
Full self-hosted rerun results will be recorded after completion.
## Additional failures exposed by the first complete rerun

Before further implementation: the debug lifecycle can pass every assertion but
fail while Playwright merges recording evidence; preserve and inspect temporary
trace archives. Receipt fault injection can publish its held flag before parsing
the actual authoritative receipt. The estimator's 1,831 zero-delay timer yields
can consume almost the entire gateway deadline on Windows despite little CPU
work; keep the deterministic roll budget and outputs while measuring native I/O
yields. Mixed deployment must distinguish journal completion, maintenance-release
publication, native planner initialization, and actual physical movement; record
these milestones before changing gameplay behavior or timeout policies.
The debug reproduction passed its entire body and captured 8,438 trace JPEGs:
454.5 MB compressed browser recording, in addition to three retained videos and
named screenshots. Trace merge alone took 31.2 seconds in the focused run and
exceeded the separate 120-second merge deadline in the full run. Disable only
the redundant trace screencast for the debug project; retain DOM snapshots,
network trace, sources, videos, screenshots and every lifecycle assertion.
The estimator's native I/O yield reduced the +12 case from 26.95s to 2.42s;
all four target levels retained byte-equivalent deterministic result objects.
The Town-unavailable fault did not reach the game: its first intercepted planner
request spent 1.25 virtual seconds acquiring status plus coordinator ownership,
then the native request aborted before the 409 arrived. Both fighters eventually
hit the boss, but the retry still permitted Town, correctly failing the strict
fallback assertion. Cache fresh read-only coordinator observations outside the
held request, retain exact convoy/epoch/command/runtime/revision guards and the
existing deadline, and record snapshot age and delivery failures. Do not relax
the required Town-disabled retry or native damage checks.
Several later failures are observation-clock stalls rather than exhausted
behavior windows: return tests fail with less than 140 virtual seconds elapsed
in the whole body despite a 240-second return window, while their game/CODE
clocks keep advancing. Runner stdout records read-only /observe timeouts and
ECONNRESET. The observer pump currently stops forever on a single transport
error. Before implementation: retry only this idempotent read, bound consecutive
failures below the existing stall watchdog, record native timestamps and every
recovered failure, keep permanent/protocol failures fatal, never advance locally
without a real broker response, and verify through an actual reset HTTP socket
in the browser-clock E2E. Do not retry gameplay mutations or E2E scenarios.
The Cave failure contains a real negative native transport receipt after the
fixture moved Warrior away from already-admitted stairs. Its injector was armed
by the UI click promise returning, which can lag native farewell resolution and
coordinator stair admission. Arm with the verified exact native farewell choice
ID before voting, and trigger on that native choice's resolved status packet.
Retain actual post-farewell displacement, lost completion packet, independent
repair command, both-floor arrival, native votes and all existing assertions.
The cold-defense fault publishes deliveredDefense before route.fulfill completes;
the observing test can retire routes while that response is still being handed
to the native browser. Publish only after actual fulfillment and stop proxying
unrelated later status requests once that targeted fault is complete. Keep the
same-convoy, no-local-convoy proof and actual combat/loot/quest assertions.
The account-home browser failure shows the real settings dialog with UNKNOWN
realm and an empty closed picker after its first click, despite fresh server
participants. Wait for the actual requested option and reopen the idempotent
picker if asynchronous settings publication remounts it; retain the existing
20-second UI budget, full account confirmation and native/DB/slot assertions.
The disabled-Anniversary failure occurs before gameplay at declared encounter
seeding: four 35-unit cardinal offsets from a moving actor can all fall outside
the current mission or collide. Search nearest collision-clear points across the
same native mission boundary, preserving the mission/cycle, native geometry,
real spawned monster, kill, quest progress and absence of anniversary rewards.
Read the current mission from one snapshot rather than mixing two observations.
The map case now passes (60.0s), but serializes millions of RGBA numbers through
CDP and repeats them in trace arguments for three views. Before optimization:
retain the click-time reference as a lossless PNG, decode that reference in the
real screenshot popup, compare every RGBA byte there, and retain identical
width/height/footer/color/PNG assertions. No sampled pixels or relaxed equality.
The manual-travel fault's first native request has the correct new movement ID,
but its combat trace still has null convoy fields and __partyLastCommand still
names the prior command. Those are separate publications, not current movement
ownership. Read convoyNavigationReport() in the same native snapshot and retain
all exact expected convoy/epoch/command/runtime/revision/rally guards and the
1.5-second injection budget. Do not alter actor positions or relax the fault.
The Phoenix terrain failure is a mismatched fixture encounter: its real context
selects native monster 104 while every assertion expects seeded monster 762.
Use the existing reversible native-map ambient isolation before this declared
single-encounter geometry case, exempt only its real seeded monster, and restore
all retained native objects/counts in an outer finally. Keep exact selected-ID,
hitbox goals, geometry, range and real Warrior damage assertions unchanged.
Focused follow-up validation: full TypeScript checks and selection audit pass;
339 total / 228 gameplay cases remain. Browser debug and merchant-estimate pair:
2/2, 34 evidence hashes verified. Actual clock transport regression: 2/2,
including recovered reset and permanently failing read, 14 evidence hashes.
Map case with trace-only change: 60.0s, 20 evidence hashes; lossless whole-image
comparison: 4.0s and 4.3s, all original byte equality/footer/PNG checks retained.

A simultaneous focused gameplay run exceeded Docker's 31.19-GiB VM memory and
an owned game container was OOM-killed. Its results are diagnostic only. Its
normal teardown completed; further gameplay runs are sequential. The complete
self-hosted run remains eight workers. Final full-run results remain pending.
