# Native combat recovery timing

Failure inventory recorded before the fixture change:

- Run 38216828516, shard 14, completed both multi-corner scenarios with native attacks and clear movement segments, but failed the 3.5-second movement assertion at 3506ms (warrior scenario's priest) and 4057ms (mage).
- Serial browser evaluations sample the two clients roughly 1–2 seconds apart. The first observed moved positions were already approximately 106 and 73 units from their origins, so assigning the evaluation timestamp to movement onset overstates its latency.
- Increasing the latency limit would conceal actual delayed recovery. Replacing the native hit or collision checks would weaken the scenario.
- A fixture observer can leak across tests, lose target identity, confuse unrelated movement with recovery, or omit evidence on failure.

Observe acquisition and the first native displacement greater than eight units inside each client's own browser on a 25ms timer. Preserve target identity, retain the existing 3.5-second acquisition-to-motion and six-second total limits, and keep serial samples as diagnostics. Always retain the observer attachment and clear the timer, including failing scenarios. Actual native attacks and collision-safe segments remain required.
