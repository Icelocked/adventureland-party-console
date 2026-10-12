# Native Hunt interruption observation readiness failure inventory

- During merchant death/reconnect, get_player(name) can be temporarily absent while the actual native client changes sessions. The shared observed() read dereferences p.map immediately and aborts the existing recovery poll.
- Read the real owned players atomically, return null only inside the readiness probe for genuinely absent names, and wait at most 30 seconds for all three actual players. Return only genuine complete snapshots; fail clearly if ownership never returns.
- Do not retry lethal attacks, transfers, seeds or other mutations. Keep native death receipts, rip/alive checks, cargo conservation and current scenario deadlines unchanged.
