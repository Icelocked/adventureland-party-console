# Three-fighter native hit selection failure inventory

Focused run 38346119339 retained real Mage damage 925 ms before the Warrior's first hit, followed by 13 more Mage hits. Priest also physically advanced and dealt 20 real hits. All issued native movement rays were clear. The predicate selected the earliest hit forever, so the Mage could never satisfy the required post-commit hit chronology despite later qualifying hits.

Correction must select a positive native hit on the exact seeded victim, from the same named caster, at or after the Warrior commit time and no later than the current observation time. Preserve the 60-second budget, physical displacement, native collision, actual damage, owned target and combat epoch checks. No production movement change is justified by this failure.
