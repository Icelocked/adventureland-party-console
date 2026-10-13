# Independent approach scheduling

Before changing scheduling, native run 38423920859 shard 13 failed the unchanged
Mage multi-corner movement limit: 4,301 ms from acquisition to displacement,
against 3,500 ms. Two native searches reported no route. They consumed 129 ms
and 135 ms of CPU but took 2,067 ms and 1,117 ms elapsed, with 352–668 ms gaps
between native scheduler callbacks. The third, smaller-radius search succeeded.

Failure inventory: starting a managed route must not wait for an unrelated native
timer; a completed or rejected owned search must promptly re-evaluate actual
range and its current target. A late superseded callback must not advance a new
route, a cancelled ready hold must not relaunch, and manual/deployment/foreign
ownership guards must still win. Preserve the existing replan throttle, native
search slice budget, collision validation, radius reductions and attack barrier.

Retained controller and actual shared-adapter regressions precede the amendment.
The native Warrior/Mage multi-corner scenarios retain their 3,500 ms movement
and 6,000 ms acquisition limits, both actual damage receipts and clear segments.
