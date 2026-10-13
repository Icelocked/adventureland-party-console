# Owned movement completion failure inventory

Before implementation, native full run 38452758672, Cave shard 1 artifact 11842831137 reports Warrior journey 23 complete 270 units short and Priest journey 25 complete 727 units short, both `code: arrived` without stopStack/action. Their actual native player packets corroborate nonarrival; Cave consumes bounded regroup repairs and remains assembling. The exact cause of plot exhaustion during combat is not proven.

- An exhausted executor plot must not publish success while the actor is displaced from the exact owned destination beyond its existing arrival tolerance. Preserve bounded native recovery.
- A still-moving or transporting actor must wait for settlement without consuming retries.
- Same-map destinations omitting instance retain the journey origin instance; wrong map/instance must reject, not replan across unowned context. Explicit destination instances remain strict.
- Already settled positions within the caller tolerance remain successful; current journey/revision guards remain authoritative.
- Native transition acknowledgement and deliberately authorized successful-stop preparation/Franky handoffs are separate existing contracts and must remain unchanged.

Retained tests exercise observable destination arrival/promise outcomes, retry counts and no foreign-context movement. Existing native Cave case remains acceptance evidence.
