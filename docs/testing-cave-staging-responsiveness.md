# Native Cave staging responsiveness

Failure inventory, recorded before changing the fixture:

- Exhaustive synchronous connected-floor and clearance searches can starve the
  disposable native server's event loop. Run 38537449485, shard 3, retained a
  16.179-second server sleep followed by all client disconnects. The next staging
  request then found no player. This happens before assembly behavior is tested.
- Yielding during selection can invalidate player identity, floor/instance, or
  native enemy positions. Never stage a replacement/disconnected player or trust
  stale enemy clearance after yielding.
- Optimizing selection must preserve connected terrain, both native player
  collision bases, and the existing combat/encounter clearance for both required
  displacements. A shorter setup must not weaken the actual assembly assertions.
- Search diagnostics must distinguish actual work from time yielded to the native
  server. Keep real client connectivity and native staging evidence, rather than
  treating a timer measurement alone as a successful gameplay test.

Run the exact native scenario with one worker:

```
npm run test:e2e:live -- --workers=1 --grep "Cave assembly regroups displaced completed participants before departure"
npm run test:e2e:verify
```

Retain the declared native staging geometry, connected path, work/yield timing,
unchanged native context after initial staging, and actual assembly displacement
and regroup evidence. No production server, generated floor, combat outcome,
command completion, or player heartbeat is replaced by this test fixture.

The exact captured failing floor was replayed with the pinned native collision
function: the old search took 10.280 seconds and 1,645,048 collision calls; the
corrected search took 0.852 seconds and 269,301 calls, with 105 actual event-loop
yields. Both found the same point (2808, 440), with the same 13,566 reachable
cells. Both replay timings exclude dungeon generation by using the captured
native floor; they are comparative diagnostics, not a native gameplay pass.

The exact native assembly scenario then passed locally in 1.9 minutes, retaining
63 verified evidence files in `.build/cave-staging-responsive-passing/`. Its
different generated floor required 14,031 reachable cells and 45 yields over
428ms, with a maximum measured work slice of 54ms. The 8ms check is a cooperative
yield budget, not a hard CPU scheduling guarantee. Both real clients remained
connected, received native staging without changed Cave context, then completed
the original walking displacement and regroup assertions.
