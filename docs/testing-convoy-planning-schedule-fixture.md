# Convoy scheduling diagnostics comparison failure inventory

Validate 38336127242 failed one existing diagnostics-equivalence case: 3451
passed, one failed, zero skipped. The new movement.planningSchedule scheduler
and plan records contain monotonic elapsed/interval measurements from separate
runs. Their calls and all failure/request/owner semantics match; elapsed values
legitimately differ.

Validate the exact declared scheduler/plan timing record shape, integral
nonnegative calls, finite nonnegative elapsed/interval values, and interval
ordering. Normalize only elapsedMs and the three declared interval measurements
for independent-run equivalence. Preserve calls, ownership/blocked counters,
all other fields, original failure, diagnostic freeze, and request sequence.
