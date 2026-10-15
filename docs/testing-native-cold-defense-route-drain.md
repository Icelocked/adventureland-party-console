# Cold-defense response fault cleanup

Pre-code failure inventory: run38336172428 shard11 artifact11786684650 has
`cold-defense-native-combat-loot-and-hunt-reward` evidence. The test reached all
native damage, death, gem inventory/chest and exact Hunt reward assertions before
cleanup. Its only reported failure was `route.fulfill: Route is already handled!`
at the still-running status interception callback. The other12 scenarios passed.

This test installs the only route handler in its fresh native browser context;
the default native isolation uses an owned loopback proxy, and graphics experiment
interception is disabled. Default `context.unroute` removes the route without
draining pending fetch/fulfill callbacks. Use the public `unrouteAll({behavior:
'wait'})` to remove future interception and await all current callbacks before
fixture teardown. Do not ignore errors, replay requests or alter the intentional
preparation-response abort or any genuine native assertions/evidence.
