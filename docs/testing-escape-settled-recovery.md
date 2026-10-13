# Escape recovery arrival fence

Before implementation, native run 38282332581 shard 14 artifact 11763634012
shows Warrior leaving its escape approach for the farm before Priest reaches
Town. Recovery is complete and Escape released; Priest subsequently arrives at
0,0 while Warrior remains at the farm. The recovery safety predicate accepts
moving approach observations within its 65-pixel radius, unlike Escape's own
settled-arrival predicate.

Failure modes: release during an active walk, release between route nodes while
temporarily stationary, stale/dead/low-health arrival, or never release after
acknowledged terminal arrival. The retained regression is written first and
requires stationary terminal movement before resetting recovery. Native arrival
and the existing 60-second E2E bound remain unchanged.
