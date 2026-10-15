# Merchant inventory reconciliation

Failure inventory before implementation:
- Removing the final BankBoi can leave reserved-row requests persisted until a
  later bank report. Startup and account mutations must reconcile without a visit;
  unrelated bank requests and physical inventory must remain untouched.
- A displaced +5 manual upgrade to +8 can be mistaken as ambiguous because
  finished +8 copies are counted alongside its unique unfinished survivor.
- Several unfinished candidates really are ambiguous. Production/lucky journals
  must reconcile before retrying; unresolved identity must not spend scrolls or
  create a heartbeat-speed failure loop. Potion consumption must not unblock it.
- A matching journal continuation must keep its original target, while changed
  upgrade intent or relevant inventory must permit recovery again.

Validate the unchanged native bank-staging scenario and a native displaced manual
upgrade with finished duplicates. Preserve native upgrade receipts, final marks,
bank queue state and screenshots in the standard verified E2E evidence.

Both focused native scenarios passed locally in 2.6 minutes including setup and
teardown. The upgrade test moves the marked item with the real native `swap` API,
then requires a native upgrade receipt, cleared intent and preservation of the
finished copies. The unchanged bank-staging test verifies the queue and seven
reserved cells clear after the final worker is removed and the host restarts.
The 34 focused retained checks and typechecking passed; changed merchant policy
files pass lint. Evidence is in `.build/e2e-report/` and `.build/e2e-results/`.

Production journal and lucky-slot recovery already run before merchant commands.
The survivor resolver now excludes finished duplicates from displaced unfinished
work; genuine remaining ambiguity blocks rescheduling until relevant gear or
intent changes, rather than repeatedly invoking the same already completed
recovery preflight. No additional gold or scroll spending is authorized by a
failed recovery.
