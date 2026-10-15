# Rare interruption: existing native Hunt progress

## Failure inventory before correction

Focused run 38423846145, artifact 11830250286, Cute Bee failed only the newly added requirement that the Warrior enter the mission habitat rectangle. The same Hunt was farming, rare ownership cleared, and no convoy remained. Native post-loot hit/death receipts showed ongoing Goo kills; the native Goo quest counter fell from 500 to 410. The Warrior followed actual native monsters north of the habitat while continuing valid Hunt work. Full shard 11 passed the same scenario. Requiring a habitat visit before acknowledging already completed native kills overconstrains the recovery specification.

Possible failures to retain: no quest decrement; no real party killing hit or matching death; receipts preceding the post-rare baseline; changed Hunt cycle or a paused/non-farming stage; ambient enemy present but unreachable; absent encounter input. The existing 90-second total budget remains unchanged.

## Correction

Observe either actual same-cycle farming plus a post-baseline party native killing hit, matching native death, and native Goo quest decrement, or actual mission arrival. Existing progress is recorded with original native event IDs and timestamps and needs no new fixture monster. Arrival remains required before querying or declaring a fallback encounter. Any living native mission Goo prevents declaration, including blocked ones. The original final native quest decrement assertion still runs.
