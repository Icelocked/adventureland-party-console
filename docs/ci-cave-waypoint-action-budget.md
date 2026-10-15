# Waypoint editor action budget

Before editing, experiment 38293149099's retained Playwright trace showed the
Add waypoint button was visible, enabled and stable. Resolving, stabilizing,
scrolling and dispatching the ordinary click took 9756 ms; the 10000 ms action
limit expired 269 ms afterward. No frame-navigation events occurred. The final
"waiting for scheduled navigations" log is a general action stage, not proof of
an actual navigation or a failed click handler.

Preserve the existing 60000 ms activation window. Within it, allow at most 30000
ms for an ordinary actionable click, 10000 ms readiness, and 10000 ms observable
placement acknowledgement, each capped by the remaining shared window. Keep
modal, freshness, run/floor, error, and explicit placement-hint checks. Never
force input, disable navigation waiting, retry arbitrary errors, or issue another
successful Add click without the already-supported observed result-modal race.
Repeated native reports must not increase the deadline.

The real native trace demonstrates the former boundary failure; the next default
native Cave E2E must still observe the placement editor and physically walk the
declared safe waypoint, then finish native combat and floor progression.
