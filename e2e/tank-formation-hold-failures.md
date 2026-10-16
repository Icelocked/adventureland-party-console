# Designated tank inside a priest formation: failure inventory

Written before merging Icelocked's PR #2 (review on #39). With a priest in the party the
role runner calls `formationMove`, `kiteIfNeeded` and `defensiveFormationMove` before
`approachCombatTarget`, the only place the designated tank was routed to
`tankMovementTick`. Live journey: `e2e/live-tank-formation-hold.spec.ts`.

1. **Tank kites.** A warrior tank in a warrior/priest/mage formation reports formation
   modes (kiting, approaching) and never `tank-holding`.
2. **Priest tank keeps healer positioning.** A priest tank orbits at its healing range
   instead of standing in melee and absorbing (the user's intended priest-tank role).
3. **Ranged ally starved.** While the tank holds, the mage does not land attacks.
4. **Tank holds while dying.** Below half HP, or (warrior tank) outside the priest's heal
   range, the tank keeps holding instead of moving with the formation. Not exercised live;
   the retained `priest-formation` cases cover it.
5. **Other fighters changed.** A non-tank warrior stops moving with the formation.
