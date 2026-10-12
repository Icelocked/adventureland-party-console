# Transition barrier latency failure inventory

Recorded before controller replay or production edits:

- Native run 38216828516, Slenderman return: both clients stop at Halloween's door (1212,101). Their current return owner remains intact, but communication hold/restart repeats.
- Retained successful fast/barrier requests take about 1.25 seconds round trip; full requests also reach 2.9 seconds. Native owner observations remain fresh.
- The controller permits a transition only when all ready acknowledgements are at most one second old. Alternating acknowledgements arriving 1.25 seconds apart never overlap, even if each stopped owner keeps reporting and the independent walking leases remain current.
- Increasing a client request deadline or accepting an expired walking lease would hide a different failure and is out of scope.
- A wider ready window must not authorize a warp if any member's owner, command, epoch, route version, runtime, navigation revision, map/instance, stopped position, or observation freshness has changed.
- Readiness revocation must still remove an acknowledgement. Once legitimately released, a native transition remains latched while slower members finish; duplicate completion acknowledgements remain idempotent.

The replay calls the actual maintained movementBarrier controller with alternating arrival timestamps. It separately identifies acknowledgement starvation and preserves existing walking-lease expiry tests. Production changes require the replay to demonstrate the failure and retain all owner/transition guards.
