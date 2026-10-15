# Native walking endpoint attachment

Before changing production code, run 38299426994 shard 1 made no new required
room progress for 300 seconds. Its Priest repeatedly rejected a gather route's
final connector: `(3368.0333121990607, 385.00000000000006)` to the owned Warrior
anchor `(3379.928997399134, 380.24390341423646)`. The target is safe to stand at,
but that 12.8-unit diagonal crosses a corner. Both actors use native base 8/7/2.

Exact pinned 15555 replay of artifact 11770547465 reproduced the same three-node
plot and blocked last connector (16 BFS slices, 7983 frontier). Native BFS accepts
a point within its 20-unit goal edge, then blindly appends the exact goal. Using
an edge of one is not a solution: its five-unit grid cannot necessarily reach a
fractional goal. Existing native-validated `doorDetour` found one extra point
`(3376.0333121990607, 385.00000000000006)` in 0.91 ms, making both final legs clear.

Failure inventory and observable regressions before implementation:

- Preserve the entire prefix and exact owned destination, including precision
  arrival tolerance one. Execute only native collision-certified segments.
- Repair only a blocked final walking attachment in the current map/instance,
  whose goal exactly equals the owned destination, at distance at most 150.
  Bound all candidate nodes/segments within that same 150-unit neighborhood.
- Reuse the existing bounded 2048-expansion local detour. Never change native
  BFS, the installed client, game clocks, search deadlines or goal tolerance.
- Reject wrong goals, cross-instance/foreign-map points, transitions, distant
  tails, unsafe anchors and cases without a certified connector unchanged.
- Revalidate every repaired segment through the ordinary complete-route native
  validator before execution, retaining ownership/epoch/runtime validation.

The captured geometry is a 29 KB fixture with source/version/fingerprint/base;
isolated movement tests use actual installed native collision functions. The next
real native Cave E2E must gather, fight/vote, finish rooms and change floor.
