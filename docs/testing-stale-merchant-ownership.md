# Stale merchant ownership failure inventory

Latest native shard 16 reports a stale assigned manual bank job still rejecting Steam login as an active inventory operation. The persisted job guard was broadened to every merchant job to protect realm reconnects.

Failure modes: stale ordinary work indefinitely blocks login; an actual realm reconnect loses heartbeat and permits a second owner; the realm exception persists after its sixty-second recovery deadline; fresh banking, stocking, upgrading, and BankBoi transactions lose their existing fence. The retained ownership regression is updated before production code to exercise these boundaries; the existing native stale-login E2E retains its assignment-conflict and timeout assertions.
