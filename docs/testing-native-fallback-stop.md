# Native Hunt fallback interruption

Pre-code failure inventory: run38336172428 shard14 artifact11786537265,
scenario5a1d4ff658b0ee5b9bdb-0d5d22b5e93595b1dee6 failed to activate fallback.
The actual interruption receipt was Main(-32,719) at1791859083834. The real route
had completed at1791859080411 and Hunt farming handoff at1791859083559,275ms
before the stop. The two separate coordinator/native read and subsequent CDP
mutation raced successful arrival; ordinary farming movement satisfied the
character-moving condition. No active route was interrupted.

The global native `smart` object is also distinct from the managed smart state
used by shared.js; observe the actual installed movement service state/report.
Install one local callback before Hunt starts. In that callback require actual
native physical motion, managed smart motion, exact current convoy ID/epoch and
travelling phase, owned journey runtime/command/revision, and no Town or transport.
Then issue one real managed `stop('smart')`. Do not reschedule a successful or
failed issuance. Cleanup only this case's interval. Keep90s trigger,30s actual
fallback admission, native kills and continued farming/retained retry budget.
