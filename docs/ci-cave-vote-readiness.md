# Native vote readiness before travel

Before changing the fixture, run 38304682974 shard 2 accepted an initial shop
vote, then submitted its first move 2216 ms later. That move was rejected with
409 "Previous dungeon action needs reconciliation; exit remains available".
The pacing helper waited only for the Warrior's native choice to resolve; the
coordinator correctly requires every participant's vote to settle. Retained final
state subsequently showed both native votes and both action receipts complete.

Failure boundaries before editing:

- Wait for both fresh, living same-run/floor participants to report the exact
  native choice resolved and their own vote equal to the selected option.
- Keep existing 20-second pacing and 30-second assembly acknowledgement limits.
- Never retry the rejected POST, weaken coordinator reconciliation, manufacture
  receipts, accept a different choice, or regard only the leader as ready.
- Keep actual route preparation, physical pacing, Stop and regroup assertions.

The existing native E2E cases retain all observations; this corrects when they
submit the next authorized command, not runtime readiness or game clocks.
