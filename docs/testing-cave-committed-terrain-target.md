# Committed Cave target behind terrain

Failure inventory before changes:

- Focused native run 38223054455 progresses through map UI and native farming, then spends five minutes assembling before Lockbreaker. Both live actors remain stopped; the queue retains an engaged broodmother, while class runners report no selected target.
- Full native snapshot reconciliation was requested 34 times. The capped native event ledger does not establish whether that particular broodmother died; no death may be invented or inferred from age.
- getDungeonTarget applies the travel-threat predicate, which requires a directly clear bearing for non-aggro targets. That can discard an already committed, valid enemy before the class combat detour receives it, while nearby threats prevent gathering.
- Relaxing initial travel threats would let an unreachable visible boss interrupt travel too early. Stale groups, dead or invisible actors, different maps/instances, and allies must remain invalid.

First require a behavior regression for a fresh, scoped, explicitly committed enemy behind a blocked direct bearing. Keep the initial travel-threat predicate unchanged. Retain native Cave hit and physical-arrival checks, and capture local target visibility, side, direct bearing and selected-target diagnostics if assembly fails.

Additional UI failure inventory, recorded before its separate UI change: full run 38225026559 passes initial waypoint interactions, then Add waypoint becomes disabled again during actionability after an enabled check. This button only enters local placement mode; Set waypoint performs the guarded request. Require a dashboard regression showing that freshness-only loss still permits local map selection, sends no operation, and keeps Set waypoint disabled. Keep missing/dead/paused/different-floor/run guards unchanged.
