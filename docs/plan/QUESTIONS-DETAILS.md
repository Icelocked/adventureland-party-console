# Open questions: details

Context for each question in [QUESTIONS.md](QUESTIONS.md), under the same
number. Line numbers are on b9b5c91e (1.5-feature-branch). A yes, no or
"here's why" is plenty.

## 1. Is a caller planned for `pause()`?

**Today:** combat sends its own steps while a journey is live, and the
movement service repairs or rejoins the route afterwards. `pause()` exists for
this hand-off, but no combat mover calls it
(runtime/characters/movement-executor.ts:28-36).

**Why we ask:** the fork's movement design pauses a walk for a fight and
resumes it after. If you have a caller planned, the fork builds on yours.

**Your answer:**

## 2. Is a caster planned for Agitate?

**Today:** Agitate is listed in three gates
(runtime/characters/skills/eligibility.ts:73), and no code casts it.

**Why we ask:** the fork leaves Agitate uncast. If no caster is planned, the
gate entries can go; if one is, they stay.

**Your answer:**

## 3. Was `mp_cost` meant in the priest MP checks?

**Today:** `basicAttackReserved` (characters/shared.js:17697) and
`healPartyBelow` (13893) compare with `G.skills.heal.mp`, which game data does
not have, so both compare with 0 and never trigger. The A/B feed heal needs
`character.mp >= G.skills.heal.mp` (13134), which is always false, so that heal
never fires. The game server does not check MP for heal.

**Why we ask:** with `mp_cost`, the feed heal starts firing, and the two `<`
checks start holding heals below `mp_cost`. Only you know which of those you
meant.

**Your answer:**

## 4. Do the unused Hunt cycle records have a writer in unpushed work?

**Today:** temporary encounters, exit mode (`exitMode`), stage `failed-return`
with `endReason`, and the `resume` branch of `begin` have no production writer
or caller. Their tests build the state by hand
(hunt-temporary-encounter.test.cjs:41, coordinator-hunt-composition.test.cjs:37),
and the tick still reads them (runtime/coordinator/hunt/tick.ts:83).

**Why we ask:** the fork plans one release that converts old saved cycles,
then removes these paths and their tests. If any has a writer in work you have
not pushed, the fork keeps it.

**Your answer:**

## 5. How long does v1.4.0 stay a rollback target?

**Today:** 19 scoped fields are saved at top level and in the leader's profile
from the same object (scopes.ts:35-55). The top-level copy lets v1.4.0 read
them after a rollback, and it is the only copy while there is no leader.

**Why we ask:** the fork drops the top-level copies once nobody can roll back
to v1.4.0. The release that ends that is your call.

**Your answer:**
