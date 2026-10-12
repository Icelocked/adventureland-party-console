# Native combat recovery latency

Failure inventory before maintained code changes:
- Run 38228085482, shard 14: warrior acquired target 515 then first native displacement after 4,192ms; mage acquired target 516 then first displacement after 5,670ms. Limits remain 3,500ms; actual native hits and collision assertions passed.
- Formation calls the incremental planner once per second. Checking every distant range-circle endpoint at every lattice node makes a few 4ms slices consume several gameplay ticks.
- Goal graph optimization must preserve legal endpoint selection, direct clear long routes, the 16-to-8 refinement, every live terrain/secondary-attacker edge predicate, and route identity/current-segment validation. It must not authorize movement from a background callback.
- Local endpoints off the lattice need collision-checked connectors; multiple goals cannot be replaced with an unsafe nearest-only choice.

The retained offline replay uses the installed native level1 collision implementation, the captured center (0,395.76), target (-11,115), and warrior/caster range circles. With the same reach deduplication as production, local lattice goal connectors reduce native checks from 766/1,094 to 216/243, and search slices from 3/3 to 1/1 on this machine. Slice counts are diagnostic, not a wall-clock regression assertion. Ordinary segment shortcutting remains live validated.

Final proof remains the native multi-corner E2E with unchanged 3.5s first-movement / 6s waypoint-completion limits, real native damage and terrain checks. Retain native timing and movement ledgers. Do not activate the staged build.

Repeat offline proof with `node tools/game/replay-combat-recovery.cjs`. Its standalone JSON retains installed native version, captured coordinates, goal counts, collision probes, timing, and every verified path edge. Native geometry tests do not substitute for the actual browser E2E latency limits.

## Explicit Prat wire overrides and initial Cave entry rejection

Before these fixture edits, focused run38263945739 on228ad41 (artifact11754667430)
failed Warrior multi-corner actual damage after45s and Priest/Mage first motion
at3,929ms against3,500ms. Its Prat declaration replaces global catalog speed,
charge and HP just like the previously diagnosed Phoenix fixture. Pinned native
monster_to_client omits those overrides because they equal the mutated server
catalog; already-connected clients retain their original catalog. This creates
phantom target movement and repeated range-circle goal changes. Retain original
catalog defaults, declare stationary:true, publish absolute per-monster overrides,
and observe the actual native stationary10mHP target. All existing3.5s/6s/45s
limits, native damage and collision checks remain unchanged.

The same run's Cave entry stayed idle after one click: the actual UI reported
`E2EPriest: fresh dungeon-compatible runtime required`. Final observations prove
both living native members remained eligible at Dorr. Freshness changed between
readiness and the mutation; backend begin validates before changing state. Retry
only the actual409 response with this exact participant freshness error, after
re-reading both fresh supported protocol1 members, visit availability, original
party identity, idle state and absence of an existing native run. A200 response
must acknowledge both participants exactly and is never submitted again. Other
errors fail immediately. The original90s active-entry bound is unchanged; retain
an entry-response ledger for each real UI click.

## Negative native seed coordinates

Failure inventory before the fixture correction: focused run 38270026932
rejected the stationary-Prat observer expression before evaluating either actor.
The native seed x=-11 produced `x--11` when interpolated directly after a minus
operator, which JavaScript parses as an invalid postfix operation. This prevented
all subsequent native movement assertions from running. Parenthesize both numeric
seed expressions so negative and positive coordinates remain valid subtraction.
Parse and evaluate the resulting expression with x=-11/y=115 and x=11/y=-115;
retain the original native target identity, stationary wire checks, and strict
3.5/6-second motion and real-hit assertions.
