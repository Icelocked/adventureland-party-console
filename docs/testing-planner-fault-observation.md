# Native planner fault observation

Failure inventory before changes, from native CI run 38632274051:

- A planner request has a two-second transport deadline. Resolving the native
  CODE iframe, reading its movement report and fetching coordinator state while
  intercepting that request can consume the deadline on a slower runner.
- Both entry-recovery cases then exercise communication timeout/hold instead of
  their declared planner rejection. Manual travel can recover and arrive while
  its intended initial-assembly fault never fires.
- Matching only runtime or destination can instead interrupt a superseded event
  request. Preserve exact journey, current convoy/epoch/command/revision/runtime
  and destination ownership checks.
- A status sample can be stale, completed or already in communication recovery.
  Such a sample must not authorize the declared failure. Missing evidence must
  pass through promptly and be retained in the test ledger, not turn into an
  unintended timeout through a long polling loop.

Observe genuine outgoing status packets without pausing them. Match their atomic
movement/convoy report to the pending planner request, then validate the current
coordinator owner. Bound observation to substantially less than the real request
deadline; do not resolve browser frames inside planner interception. Retain
decision timing and request failures. Keep native damage, exactly one/three
declared failures, all-party stopped hold, arrival, restart and occurrence
assertions. Run the affected scenarios repeatedly and retain verified evidence.
