# Cave pacing readiness window

Failure inventory before editing the native scenario:

- A generated floor can require more than sixty seconds of native planning while both alive actors correctly stay parked.
- The pacing test currently counts planning time against its walking deadline even though the production planner permits ninety seconds, extending only with real frontier progress up to240 seconds.
- Preparation must acknowledge the actual owned commands, not historical prepared observations.
- Once prepared, retain the existing sixty-second physical displacement requirement,220-unit separation bound, native equal cruise speed and Stop-travel checks.
- Keep native frontier samples when preparation fails; no invented movement, forced paths or successful receipts.

Run38216828516 shard2 failed with both native journeys active/unprepared at69seconds and no failure receipt. Split preparation readiness from the unchanged walking assertions. Capture actual native searching/found/frontier state every five seconds and retain it on failure. The270-second preparation allowance matches production's240-second progressive search plus transport acknowledgement slack; total scenario allowance is540seconds.
