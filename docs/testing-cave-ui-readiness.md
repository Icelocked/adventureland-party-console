# Cave dashboard readiness

Failure inventory before fixture changes, focused run 38220060802:

- Add waypoint's trace spends 7.62 seconds waiting for disabled participant-freshness controls to become enabled. Input dispatch begins at 9.21 seconds of the ten-second action deadline, then times out. No intercepted pointer or reopened choice is recorded.
- The pacing scenario first navigates to the dashboard only after its API/native checks finish. Its initial-query hydration overlaps the 15-second controls assertion; the failure snapshot subsequently shows the expected visible controls and stopped route, without a choice modal.
- Increasing click/visibility deadlines hides whether readiness or interaction fails. Forcing clicks bypasses safety controls. Retrying an unrelated rendered error remains forbidden.

Wait separately for Add waypoint's enabled state inside the existing bounded freshness workflow, retaining its ten-second click deadline. On the pacing scenario's first dashboard navigation, wait for its successful browser daily-dungeons query before retaining the existing 15-second visibility assertion. Keep native movement, route-stop, error and ownership checks unchanged.
