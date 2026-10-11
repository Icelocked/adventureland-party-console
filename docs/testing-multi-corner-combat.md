# Multi-corner combat approach

Failure inventory (before implementation): visible targets behind three or more
terrain bends; an already engaged target; a newly selected target; melee and mage
attack ranges; stale routes after target movement; blocked segments after monster
movement; unreachable goals; bounded planning work; healing coverage during detours;
manual movement and event ownership; no waypoint progress and repeated route rebuilds.

Use native level1 geometry near (0, 395.76) and a parked vampire rat near (-11, 115).
Retain real collision, attack range, damage receipts, sampled positions and screenshots.
Exercise warrior/priest and mage/priest parties, including an engaged target. Verify
prompt combat routing and actual attacks with a bounded deadline; every issued
combat segment must pass native terrain collision checks. Also retain the existing
engaged Phoenix and Targetron terrain regressions.

Native caster diagnosis: starting geometry is valid, but a monster near terrain
need not have enough clearance for the character's body at the monster's center.
Validate candidate attack positions themselves, then route from the character;
do not require walking from the monster center. Preserve existing selected-target
clearance, secondary attackers and healing coverage on every issued step.

A preferred range circle can also miss the walkable corridor entirely. Search
nearer legal attack positions within the same weapon range and existing selected
monster safety clearance; do not require staying exactly at preferred range.

Live route segments must also obey the existing healing envelope, rather than
selecting a detour the next-step gate continually rejects. Future route nodes
must allow the healer to advance; freezing today's coverage for the entire
route can deadlock a caster/priest party before either starts moving.
The Targetron terrain fixture removes randomized ambient spawns before creating
its declared encounter; retain sampled visible monsters for diagnosing failures.
