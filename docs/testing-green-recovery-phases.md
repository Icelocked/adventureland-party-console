# Green CODE replacement and recovery phase budgets

## Failure inventory before amendment

Run 38440823973 shard 10 was superseded, but Green completed and failed before cancellation. Artifact 11839065041 records the actual native exit and checkpoint journeys. Return cycle started at 1791914342874. The explicitly injected CODE replacement acknowledged the same owner at 1791914361826, 18.952 seconds later. Priest first physically returned to the saved checkpoint at 1791914583646 (240.772 seconds), Warrior at 1791914584426 (241.552 seconds). Both were actual native player receipts in Spooky Town; final return/convoy ownership cleared normally. Recovery after the acknowledged replacement took 222.6 seconds.

The fixed 240-second deadline was started before the separately bounded deliberate fault. The test already grants 90 seconds to find the actual owned exit walk and 30 seconds to acknowledge fresh replacement CODE, but these phases consumed the recovery budget. No failed route/retry or wrong checkpoint was demonstrated. Native Town warps to the current map spawn, so Town eligibility is not a promise of immediate Main arrival.

Possible failures to retain: no owned fault-entry walk within 90 seconds; no fresh different runtime/same owner and waypoint revisions within 30 seconds; actual checkpoint recovery exceeding 240 seconds after that acknowledgement; changed owner or native checkpoint; missing native arrivals. Non-replacement Pumpkin remains bounded to 180 seconds from deselection.

## Amendment

Green has explicit sequential fault-entry (90 seconds), replacement acknowledgement (30 seconds), then actual recovery (240 seconds) budgets. Start its existing 240-second recovery clock only after the real fresh replacement acknowledgement. Record phase timestamps, absolute recovery deadline, and the actual native post-Main checkpoint player receipts. No production clock, geometry, physics, native safety lease, or numeric phase limit changes.
