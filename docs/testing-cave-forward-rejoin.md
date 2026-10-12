# Cave forward route rejoin

Failure inventory before implementation:

- Combat moves an actor beyond a retained route corner; resuming the old first endpoint collides and needlessly regroups/replans the entire generated floor.
- Rejoining must prove both a local connector and the retained forward segment are collision-free using native base geometry.
- A nearby later route after a door, Town, transport, map or instance transition must never be adopted by skipping that transition.
- A distant endpoint or unsafe connector must retain the existing bounded local repair/failure behavior.
- Rejoin must preserve destination ownership, current instance, repair limits and native barrier acknowledgements.

CI run 38210157313 recorded fresh alive Cave participants failing resume connectors at (1085,720) toward (974,426), then (2174,775) toward (2060,580). The earlier corner can be more than 150 units away although combat moved the actor near a later walking segment. Use only a native-clear direct join onto the retained walking prefix. Direct walking has no artificial distance limit; retain the existing 150-unit/three-second bound for fallback native BFS and never replan the destination independently. Captured geometry proves the first 260-unit projection connector is clear although its stale endpoint is blocked.

Before code, extend retained movement-service regressions with actual issued movement outcomes for a forward local rejoin, an unsafe connector, and a transition boundary. Also rerun native Cave entry/map/travel, retaining native geometry/planning ledgers and physical arrival evidence.

Repeatable offline geometry replay:

```
node tools/game/replay-cave-forward.cjs
node --test scripts/tests/movement-service.test.cjs
```

The replay uses collision geometry/base captured from the failed native Cave, both observed combat-displaced actor positions, and native BFS reconstructed retained walking paths. The second case stages an unconsumed corner from a point 20 units before it; no game attacks, deaths or successful commands are fabricated. This isolates connector behavior, not the entire live combat sequence. Its JSON records every simulated movement leg, destination identity and zero destination searches; each movement leg is checked by the pinned game's actual can_move implementation. Native Cave E2E remains the real-client completion check.

Validation: all 89 retained movement tests pass; both captured-geometry replay cases reach their owned destinations with zero new searches; runtime TypeScript passes. The prior first captured case fails with the former 150-unit direct-join exclusion.
