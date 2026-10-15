# Event convoy status ordering and native Town observation

Failure inventory before code:

- A delayed full status response says no convoy while a newer matching fast-channel lease owns an active journey. Clearing activity stops the current journey and permits ordinary farm reunion to take over.
- An expired signal, different command/runtime/route/navigation revision, or a newer authoritative full response must still permit cancellation. Do not retain arbitrary stale convoy state.
- Full status can yield during Escape/navigation handoff; use the latest fast-channel timestamp at each activity application.
- Native player packets repeat a remaining Town cast. A late 169ms status echo after server arrival must not count as a newly issued Town warp.

Captured native shard10 logs show stop callers in the full status tick and later farm reunion; the latest convoy report remains owned. Shard15 Anniversary has a single Town cast, with native remaining-time packets 3000,2160,1775,169ms (CIDs84–87), rather than a new warp. Detect fresh cast starts rather than any residual cast condition.

Before implementation, extend retained convoy timing behavior tests for older full cancellation, fresh cancellation, expired signals and identity changes. Native verification: event return/Halloween and Anniversary staging journeys, keeping physical arrival, combat and return assertions unchanged.
