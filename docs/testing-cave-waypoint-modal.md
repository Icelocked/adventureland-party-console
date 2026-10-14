# Cave manual waypoint result-modal obstruction

Failure inventory before amendment: c1f4159 Cave1 job115636806507,
artifact11864970607, failed at selectWaypoint's View full map click after
initial Stop completed. The retained accessibility snapshot has aria-hidden
main beneath a resolved Shop with One Item dialog, Encounter result and Close.
The existing activateWaypoint modal handler runs only after this blocked click.
This demonstrates a fixture UI obstruction, not a native travel failure.

Reuse a narrow resolved-result dismissal helper for initial Stop and the later
View full map click. Each action's Close, disappearance check and control click
share that action's original 20-second click budget. Unresolved choices remain
untouched; no force, retry loop, skipped action or deadline increase. Preserve
all actual waypoint selection, native collision, party movement, explicit Stop
and arrival assertions. Existing failing native scenario is the before-code
reproduction; no additional isolated test is introduced.
