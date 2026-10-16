# Native Boo Boo walking checkpoint Town prerequisite

Cancelled run 38299426994, shard 13, artifact 11772715145 retains a failed 180-second walking admission before any fault was injected. The walking policy legitimately allowed Town again while both characters still reported native Town readiness. A walking-only fixture must start with Town unavailable.

Failure boundaries recorded before editing:

- Use the official client cooldown setter once, and verify actual native Town readiness is false before the checkpoint.
- Do not invent a server cooldown field: pinned upstream 90052162 `node/server.js` does not enforce `player.last.town`.
- Do not change native clocks, skill definitions, server cast physics, or refresh the cooldown during the scenario.
- Retain all actual walking, communication-fault, cached-route reuse, recovery and reward assertions and their existing deadlines.

The native `skill_timeout_singular` setter populates `parent.next_skill` with a real-clock Date. The fixture declares a 600-second initial client cooldown through that setter. The `skill_timeout` wrapper skips skills without configured cooldowns, including Town. This models client unavailability, rather than server rejection.
