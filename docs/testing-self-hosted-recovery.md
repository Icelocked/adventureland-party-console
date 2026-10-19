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
## Late-join initialization investigation

Mixed deployment still fails with a healthy observer (no errors or retries) and
a headless participant holding one unacknowledged window. Its replacement
coordinator also logs a premature planner-preparation timeout. New Node actors
install a clock at the pool's original epoch and start application initialization
before joining its current timeline. Startup deadlines/date values may therefore
already be expired at first join. Browser scripts can similarly register timers
before their first handshake.

Before implementation: prove that late joining actors retain full relative
one-shot/interval delays, do not replay startup deadlines immediately, preserve
all callbacks and exact counts, and start Node application code only after its
real authenticated broker acknowledgement. Preserve the common epoch, native
I/O, permanent failures, and the existing watchdogs; do not enlarge deadlines.

Second-run failure inventory before implementation: the coordinator executes
inside a caracAL realm without global setImmediate, so the estimator's Node
fast yield falls back to virtual setTimeout(0). Inject a native I/O yield from
the coordinator module, preserving deterministic results, 60M rolls, cancellation
checks and the 32768-roll cooperation cadence. Browser estimation stays intact.
Delivery report withholding must begin before historical-intent restart and at
the coordinator ingress, otherwise an already-dispatched report can legitimately
reconcile the retained stock. Preserve the unreconciled-before-release assertions.
Entry fault injection must sample current CODE movement/ownership directly in
one round trip: initial planning may precede its first full status report. Keep
every operation identity and the native request's original deadline intact.

Cold-defense fault inventory: a genuine held command can install the local
convoy between the dropped preparation and defense. Withhold every same-owner
pre-defense command (including held), retaining the strict null-local-convoy
assertion and genuine forwarded defending response. Realm picker failure image
shows its selected US I row aligned behind the trigger while US II is visible;
position this account-settings popup below its trigger so both remain actionable.

The terminal-settlement fault misses the peer's earlier completion receipt:
it starts matching only after Warrior establishes the final barrier, and listens
on one Page. By the assertion, both actors have a fresh successor convoy and
the old completion is no longer present in current state. Retain bounded actual
peer barrier responses from the BrowserContext before arming; accept only the
same convoy/epoch/route/step/exact destination with genuine ready=true. Preserve
the one-leave/one-ack counts and all terminal ownership checks.

Actual sandbox comparison, same real ChronAL broker and exact 60M-roll input:
original 79.271s / native-yield-only 79.186s, identical unavailable/completed/rolls.
Native yields alone do not fix the 30s request failure. Repeated global Math
lookups cross the sandbox global proxy in the hottest loop. Capture the same
intrinsic functions once at module load, without changing arithmetic, policy,
RNG, roll counts or yields; compare exact result JSON before accepting the change.
Intrinsic capture reduces this to 53.216s with identical results, still too slow.
The remaining hot path awaits a new Promise for every failed base item. Keep
ordinary attempts synchronous and return/await a Promise only at the original
32768-roll I/O boundary; preserve the exact current level across that yield,
budget exhaustion, RNG stream, grace, scroll consumption and cancellation check.

Manual/entry fault direct reads used an optional global function that is private
inside sharedRoutine's closure, so they could never certify the current owner.
Expose that existing read-only report on sharedRoutine beside its combat trace;
read it there and keep all exact ownership checks. Hawk geometry setup must hold
from native login so a newly configured focus cannot first start farm relocation;
maintenance intentionally parks existing journeys rather than deleting ownership.

CPU profiling attributes 26s of the remaining 50s sandbox time to rollChance.
Its only varying input is integer grace[level]; the expression saturates at
grace>=14. Precompute the exact existing arithmetic for each level and grace
0..14 once per policy, then index with the same saturated integer during rolls.
Do not normalize RNG seeds or approximate probabilities. Verify identical
available and unavailable estimates, all completion/roll/scroll/spending values.

Targetron failure is a second genuine gameplay defect: its first native packet
has unintentional=true and stacked=[Warrior,Priest,outsider merchant], without
splash=true. Later splash packets are ignored correctly, but that first packet
already stole the convoy for defense. Apply the existing outside-party-target
guard to explicitly unintentional stacked victims too. Direct, unknown-target
and actual party-target attacks must retain defense; validate both native cases.

Focused eight-worker result: 13/17 pass, including both Targetron ownership
variants, capped commerce, retained cargo, mixed deployment, both home changes,
walking-return reuse/reward and final-exit loss. Four fixture boundaries remain:
holding all merchant status starves unrelated heartbeat/Steam restoration;
initial maintenance intentionally prevents focus updates; CDP ownership reads
consume 1.5s of a 2s virtual planner deadline. Before changing these: withhold only
full inventory at ingress, declare and acknowledge the manual geometry waypoint
before selecting focus, and observe real current ownership synchronously at the
native ajax call via a Playwright binding. Do not change the native wire body,
request deadline, exact owner guards, focus/geometry or replay assertions.

Repeat the retained sandbox performance comparison from the repository root with
`node docs/compare-estimator-sandbox.mts` after installing the pinned ChronAL
fixture (`node tools/sim/setup.mts`). It uses real authenticated clock sockets,
a fresh Node sandbox for each revision, no gameplay containers, and requires
exact result JSON equality. The original cfc61bd calculation takes 79.271s;
the exact precomputed calculation takes 15.677s (5.06x). Results are retained in
`testing-estimator-sandbox-results.json`; ordinary targets 1/5/8/12 also retain
their exact attempts, gold, scrolls, completions and roll counts.

The next focused run passes the original four fixture fixes but finds two more
setup assumptions: movement retries use a new job ID with the same durable
commerceOrderId, and an unnamed focus mutation does not set a character's search
radius. Require exactly one matching owned commerce continuation and explicitly
set the leader's existing 600-unit search radius; retain every budget, geometry
and native damage assertion. Gate later durable checkpoint progress after the
first accepted paid checkpoint until restart, keeping unrelated probes/status free.
This run also overlapped a deep artifact verification with gameplay. Its native
heartbeat receipts show a 3.75s virtual gap and repeated return recovery; future
expensive build/hash/archive operations finish before gameplay starts. Keep the
Halloween return's original deadline and physical-arrival assertions.

With unrelated verification removed, 17/18 focused cases pass. The remaining
entry test attempts four refusals because its full dashboard state read consumes
1.25s of a native two-second request deadline before response delivery. Use the
existing public fast state projection for current convoy ownership in both fault
handlers; it carries the identical activeConvoy without inventory/combat history.
Keep all exact owner guards, native request deadline and strict three-refusal count.

Fast ownership fixes the strict three-refusal case. The remaining exit fault
pins an expired pre-barrier: its proxy fetch returns ready=true, but the real
client is still in Cyberland, never issued leave, and already retired that request.
Before implementation: forward the actual pre-barrier normally, arm only after
the real browser receives its matching successful ready response, and permit an
unreleased candidate to be replaced by a genuine retry. Preserve current native
journey/plot/geometry ownership and the exact one-leave/one-ack assertions.
