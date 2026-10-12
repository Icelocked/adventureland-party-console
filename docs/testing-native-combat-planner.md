# Native combat recovery latency

Failure inventory before maintained code changes:
- Run 38228085482, shard 14: warrior acquired target 515 then first native displacement after 4,192ms; mage acquired target 516 then first displacement after 5,670ms. Limits remain 3,500ms; actual native hits and collision assertions passed.
- Formation calls the incremental planner once per second. Checking every distant range-circle endpoint at every lattice node makes a few 4ms slices consume several gameplay ticks.
- Goal graph optimization must preserve legal endpoint selection, direct clear long routes, the 16-to-8 refinement, every live terrain/secondary-attacker edge predicate, and route identity/current-segment validation. It must not authorize movement from a background callback.
- Local endpoints off the lattice need collision-checked connectors; multiple goals cannot be replaced with an unsafe nearest-only choice.

The retained offline replay uses the installed native level1 collision implementation, the captured center (0,395.76), target (-11,115), and warrior/caster range circles. With the same reach deduplication as production, local lattice goal connectors reduce native checks from 766/1,094 to 216/243, and search slices from 3/3 to 1/1 on this machine. Slice counts are diagnostic, not a wall-clock regression assertion. Ordinary segment shortcutting remains live validated.

Final proof remains the native multi-corner E2E with unchanged 3.5s first-movement / 6s waypoint-completion limits, real native damage and terrain checks. Retain native timing and movement ledgers. Do not activate the staged build.

Repeat offline proof with `node tools/game/replay-combat-recovery.cjs`. Its standalone JSON retains installed native version, captured coordinates, goal counts, collision probes, timing, and every verified path edge. Native geometry tests do not substitute for the actual browser E2E latency limits.
