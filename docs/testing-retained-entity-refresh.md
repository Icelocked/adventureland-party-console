# Retained encounter reconciliation when role selection is empty

Failure inventory before code:

- A coordinator retains an engaged target but native role selection rejects the cached entity. Selected role target becomes null, disabling full entity snapshot refresh and leaving the queue permanently blocked.
- A retained coordinator target is a reconciliation hint only. It must not authorize attacks, fabricate death, bypass activity pauses or renew a stalled grace period on target churn.
- Real successful attacks still reset the refresh grace period and native requests remain rate limited.

Native Cave run38216828516 shard1 reached the farm and Lockbreaker, then stalled on injected duel. Target580 remained engaged/retained, rival614 was queued, both role selectedTarget values were null, and no entity-refresh request was made. Use the existing shared target ID solely for native snapshot reconciliation when attack selection is empty. The server snapshot/absence ledger remains authoritative for queue retirement.

Write retained entity-refresh regressions before implementation. Verify the existing native Cave duel and preserve native ally survival/rival death assertions, plus the final snapshot/request diagnostic.
