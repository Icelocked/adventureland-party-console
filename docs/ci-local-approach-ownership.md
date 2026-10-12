# Local approach ownership failure inventory

Before changing production behavior, native run 38282332581 shard 14 recorded
Warrior movement 4023 ms after target acquisition and Mage movement 6314 ms after
acquisition, exceeding the existing 3500 ms bound. The Warrior's first retained
state was `farm-local-detour` without a destination or issued movement; its
certified formation approach was already planning. Planner calls themselves cost
10–63 ms. The local recovery loop nevertheless withheld formation for its three
second attempt window when every candidate was blocked.

Failure boundaries:

- A selected target with no collision-safe and monster-safe local candidate must
  relinquish local ownership, allowing the existing certified formation planner
  to advance. It must not start an independent route that bypasses healing cover.
- A real safe candidate must retain the existing local attempt window and emit
  only collision-safe movement.
- Initial legitimate progress retains its 1500 ms stall threshold.
- Empty-area searches retain their existing behavior. Aggro, changed navigation,
  and activity ownership continue to suppress unauthorized recovery.

Add observable isolated coverage before changing this retained regression
exception. The native multi-corner E2E still requires real movement within 3500
ms, real hits, and safe segments; no deadline is increased.
