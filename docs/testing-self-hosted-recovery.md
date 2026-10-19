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
