# Deferred checkpoint and retired exit ownership

Before changes, full38459335381 shard8 artifact11847712170 shows same-event fresh live admission stalled: old deferred checkpoint remains and heartbeat publishes its old cycle, so native async exit owner never retires and new event cannot request authorization. Native checkpoints must survive until actual permission; they must not perpetuate an obsolete exit continuation.

Test before code: eligible live admission sets a distinct persisted awaiting-event-admission phase; heartbeat suppresses only that deferred exit owner, while active return takes precedence. Stale peer keeps its own cycle. Ordinary fallback after live event disappears restores a normal return phase/cycle. Authorization adopts exact original checkpoint, disabled/stale/manual guards remain. Existing native retired-owner scenarios and12/15s budgets stay unchanged.
