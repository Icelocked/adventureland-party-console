# Initial Cave waypoint Stop modal obstruction

Failure inventory before amendment: f1 native Cave1 artifact11863767823 completed
both exact initial waypoint moves, then Stop travel timed out20s. The retained
accessibility snapshot shows Stop travel still present under aria-hidden main,
blocked by the completed entry-shop Encounter result dialog. This is not proof
that travel had already stopped.

Dismiss only a visible real dialog carrying exact Encounter result text using
its Close action, verify it closes, then perform the original real Stop click.
All these UI operations share the original20s click budget. Do not dismiss an
unresolved native vote, force a click, skip Stop, or extend its timeout. Preserve
the separate original20s assertion that travel/progress and move/gather ownership
are actually released before staging.
