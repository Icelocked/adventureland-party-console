# Native required-room completion budget

Before changing the fixture, run 38290203441 recorded a valid 6101-unit native
walking route and actual guard/wolf combat. Its required-room poll timed out at
300 seconds, but the final native cave NPC died 3.3 seconds later. Both native
reports then had every required room done and the stairs unlocked. No production
deadlock or expired native visit occurred. A fixed total five-minute deadline
therefore conflated continued native progress with failure.

Failure inventory before implementation:

- Allow at most 600 seconds total, with at most 300 seconds without authoritative
  new room/choice progress. An unchanged report never extends the budget.
- Seed existing completed rooms/choices on the first validated native snapshot;
  do not count them again. Only new required-room completions confirmed by both
  fresh same-run/floor members, or distinct resolved native choices with both
  members' recorded votes, renew the quiet budget.
- Route IDs, assembled/prepared flags, repeated BFS, timestamps, motion, unrelated
  rooms and duplicate choice replies must never extend it.
- Wrong run/floor or stale data cannot manufacture progress. Retain all native
  combat, voting, room-completion, stairs and fresh living-party checks.
- The production planner, native 30-minute visit, simulation and clocks remain
  unchanged. Retain a bounded evidence snapshot of consumed progress markers.

Write isolated fixture-policy boundary checks before implementation: unchanged
markers expire at 300 seconds; distinct progress permits the observed 303-second
completion; frequent progress still stops at the 600-second absolute cap.
