# Native monster catalog readiness

Failure inventory before changing the scenario:

- Run 38216828516 shard 13 rejected the Phoenix passive-hunting rule before combat with HTTP 400 `Unknown passive hunting monster`.
- Native character readiness does not guarantee that its discovery catalog has reached the coordinator; rules are deliberately validated against that catalog.
- Wait for the real coordinator catalog to contain Phoenix before configuring the rule. Do not fabricate catalog entries, bypass validation, or weaken native movement and damage assertions.

The Phoenix journey keeps its actual monster, normal mage range, collision-safe seed and native hit evidence. Catalog readiness has a separate bounded thirty-second allowance.
