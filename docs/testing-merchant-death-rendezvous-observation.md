# Native merchant death rendezvous failure inventory

Run 38304682974, shard 14, artifact 11773899695 retained seven cargo items after the existing 180-second collection deadline. Actual death and respawn preserved the cargo. Two recovered visits timed out with unattributed movement stops; a later retry was still active in the final snapshot.

Possible causes recorded before editing include target visibility or instance mismatch, stale rendezvous ownership, native route cancellation and delayed service after retry. The existing artifact does not establish a production cause.

Add passive native-client observations to the existing collection poll, at most once per second: merchant and target context, distance, direct terrain clearance, command and job identity, and route state. Retain the first 64 and last 32 samples, and attach them on failure as well as success. Keep the 180-second deadline and all actual death, cargo conservation, reward and restart assertions. Do not add timers, mutate movement or clocks, retry mutations, or manufacture completion when a diagnostic observation fails.
