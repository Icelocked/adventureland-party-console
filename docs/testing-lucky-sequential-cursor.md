# Durable sequential lucky-slot discovery

Failure inventory recorded before implementation:

- Least-sampled selection can jump several inventory squares after uneven historic observations.
- Unlocked upgrades must use the inferred square at 99.9% confidence with at least 100 observations, while continuing to record evidence and advance the durable cursor.
- If inference lapses, sequential discovery must resume at the durable cursor, skipping ruled-out squares in order and wrapping from 41 to 0.
- Ruled-out status must be recomputed from evidence; selection must remain bounded even if every square is ruled out.
- Restarting native CODE or moving between native/headless clients can lose an in-memory next square or replay older stream metadata.
- A repeated completed native roll must neither count twice nor advance twice. A failed upgrade still supplies a completed roll and advances once.
- Locking a square must retain its outline and observation counts; unlocking must continue at the following square, including 41 wrapping to 0.
- Statistical elimination and confidence must guide placement without becoming sticky flags. Explicit verified/configured positions remain supported overrides.
- Malformed cursor metadata must not select an invalid inventory position or erase valid statistics.

The maintained tracker stores the next square, receipt timestamp, and cumulative stream roll count together with the native receipt and statistics. Same-stream merges reject older cursor counts; merged discovery uses the latest timestamp across durable streams. Legacy streams without cursor metadata begin discovery at square 0. Inference selects the leading square; otherwise discovery scans forward from the cursor to the first remaining candidate without rewriting the cursor. Placement overrides continue to take precedence outside the tracker.

Native E2E coverage must observe actual rolls across successive squares, preserve the next square through CODE replacement, retain a locked outline through rolls, and verify unlocking resumes at the following square. Native receipts and persisted tracker/status artifacts establish progression; confidence alone is not placement evidence.

Retained regression fixture failures: two existing expectations still selected the least-sampled square 0 after recording square 7, while the declared sequential policy requires square 8. The existing statistical convergence simulation directly mutates statistics without a native receipt and therefore must also model the receipt's persisted cursor; otherwise it repeatedly schedules square 0. Maintain its original inference, confidence, and serialized-result assertions while updating those existing inputs and expectations.

Native diagnosis: the first changed-layout upgrade succeeded but coordinator roll count remained zero. The general native event recorder does not subscribe to `q_data`, so its absent packets cannot establish whether the native server sent a roll. The existing journey now records bounded, unmodified native `q_data` packets and the actual ID-keyed local tracker storage in its final artifact, including failures, before changing packet decoding.

The pinned native server assigns a +1 upgrade a 500ms queue, reduced to 50ms by Mass Production++. Digit revelation checks the queue's previous remaining time against fractional thresholds before emitting `q_data`; an operation finishing in a single native tick can therefore reveal no complete roll. These two roll-observation journeys declare a starting merchant level below both actual native mass-production skill requirements, leaving the ordinary queue and all native outcomes unchanged. Native mass-skill behavior remains covered by its separate high-level journey.
