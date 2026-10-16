# Native companion rendering experiment

Before changing the fixture, run 38287905531 captured a verified native 15555
40 ms BFS: 52 calls, 2131 ms total CPU, but mean callback gaps of 854 ms (maximum
2511 ms). The same native geometry in isolated Chromium completed in seconds.
The official engine renders all companion game frames from the primary draw
loop, even though companion frames have `no_html=true`. This experiment checks
whether their rendering workload causes control/planning starvation.

Boundaries to verify before implementation:

- Opt-in only; normal full CI and primary rendered game are unchanged.
- Rewrite only GET native character URLs on the exact fixture origin, account
  character path and configured realm, with `no_html=true` and `is_bot=1`.
- Do not rewrite CODE frames, catalog/assets, alternate realm/host, or ordinary
  character requests. Preserve all existing query values.
- Use the game's supported `no_graphics=true` startup flag. Do not edit the
  installed game, movement clocks, rendering callbacks, native physics, collision,
  monsters, target acquisition or assertion deadlines.
- An isolated workflow group runs only Cave entry alongside other diagnostics;
  artifacts retain actual native planner metrics, hits, arrivals, and choices.

An HTTP/browser scope test records the requests the server actually receives,
including disabled mode, primary, companion, wrong realm/path, and CODE URLs.
Then compare native Cave outcomes and measured BFS callback gaps; this remains a
diagnostic, not evidence that an unrendered fixture alone fixes production.
