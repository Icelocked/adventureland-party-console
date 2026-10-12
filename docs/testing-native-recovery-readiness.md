# Native recovery readiness regressions

Failure inventory before code:

- Escape recovery can observe moving survivors transiently inside the 65-unit Town radius, enter final hold and cancel their still-running route. The captured duplicate-metadata restart leaves the warrior at (120,-50).
- Final hold must require fresh alive survivors with no active native movement. A later casualty still reopens recovery.
- Terrain recovery receives multiple certified combat positions but searches only its first (possibly unreachable) goal. The captured level1 warrior/priest case keeps the priest at a blocked goal and its fighter waiting.
- Select only another coordinator-provided goal, preserve native terrain/monster checks and movement ownership, and verify arrival against that actual selected goal.
- Rejected endpoints and stale/superseding runtime controls must not be accepted as arrival.

Retained isolated regressions are written before implementation. Native verification: e2e/live-hunt-round2-recovery.spec.ts requested membership and e2e/live-hunt-multi-corner.spec.ts. Keep server arrival, attack events and native segment safety checks.
