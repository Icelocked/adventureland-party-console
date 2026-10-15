# Empty-spawn recovery

Failure inventory: a party kiting away from its farm can lose sight of both queued
successors; those unengaged nominations may be discarded. Priest coverage must
not prevent the idle party from admitting the return convoy that will regroup it.
The return must hand off on sight of an eligible farm monster, without requiring
arrival at the center or allowing attacks before every fighter confirms range.
Cancelled navigation, active fights, event/Hunt ownership and foreign destinations
retain their existing guards.

Run the native cases matching `empty saved hawk spawn|planned Main hawks|native
goldenbat interruption`. The empty-spawn case declares the separated post-kite
positions and a saved farming waypoint, then lets real clients request recovery.
It does not seed a convoy, readiness, visibility, movement completion or damage.
Retain `native-empty-spawn-reacquisition`, the observation timeline and ordinary
native artifacts; verify with `npm run test:e2e:verify`.

The approach cases keep the primary's speed at zero through native recalculation:
instance stats control speed, while the upstream calculator reads charge from the
species even for instance overrides. Successors retain native idle roaming. The
separate recovery case covers displacement instead of assuming the approach
fixture's original successors remain visible throughout an unbounded kite.

Goldenbat's follow-up encounter checks position and chooses/creates the native
encounter in the same server operation. A changed boundary precondition retries
within the original deadline; existing native kill receipts plus actual Hunt
counter reduction also prove resumption. No combat result or position is forced.
