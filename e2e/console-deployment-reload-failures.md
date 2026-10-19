# Console deployment CODE reloads: failure inventory

Written before the change (2026-10-19). The user's live update stuck on "activating", then on
"rolling back" until both timed out (120 s each), leaving FonzeRogue on the new CODE and FonzeMerch
on the old. Tests: `e2e/console-build-host.spec.ts` (real `watchGenerations` with a forked worker,
and the real `createRunnerHost` reload path).

1. **A merchant job blocks the reload the hold allows.** During a deployment hold, `shared.js`
   pauses the merchant's job and reports ready: `consoleMaintenanceBusy` leaves the job out for a
   merchant while the lease holds, and `canReload()` agrees. The worker host refused anyway, since
   `occupied()` returned busy whenever `__merchantActiveJob` was set, before asking `canReload()`.
   FonzeMerch, paused mid "auto compound" in the bank, answered every reload with `busy` until the
   activation timed out. Expected: when the CODE provides `canReload()`, the worker host follows it;
   `__merchantActiveJob` only blocks CODE that has no `canReload()`. A merchant whose `canReload()`
   is false (a bank or upgrade transaction in flight, `__partyConsoleAtomic`) still answers busy.
2. **A rollback is never applied.** The host writes the rollback's `activation.json` under the same
   id as the activation it undoes (the deployment's id). The coordinator ignored a record whose id
   it had already accepted, so no worker was told to return to the old CODE and the rollback timed
   out. Expected: a record with the same id but a different manifest generation is applied.
3. **Regressions.** A busy worker is retried and receives the selected generation; an unchanged
   record is not reapplied; a manifest written without an activation record is ignored.
