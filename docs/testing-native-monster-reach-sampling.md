# Native #121 sampling throughput failure

Recorded before amending the fixture. Focus 38497519021, artifact 11864533789, produced nine TOTAL samples during its unchanged 60-second observation. Every sample selected a booboo and native is_in_range returned true. Native timestamps were 6.4-7.8 seconds apart because sequential CDP readiness/run calls consumed the sampling interval. The >30 sample assertion therefore failed despite every observed behavior satisfying the intended range rule.

Failure boundaries: retain actual native range/selected entity fields; retain >30 actual samples and majority in range; retain 60-second observation and 300-second scenario; never create synthetic samples or reuse observations; bound the native ledger; remove only the fixture-owned timer in finally, including early failures. A replaced CODE context must not silently manufacture missing samples.
