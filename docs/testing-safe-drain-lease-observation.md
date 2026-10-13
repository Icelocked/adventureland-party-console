# Native safe-drain lease observation failure inventory

Run 38327635916, job 115071311085, failed the existing five-second native
maintenance acknowledgement at 29.8 seconds before cancellation. Lease admission
was at 1791852678849; actual Warrior/Priest hits on monster 489 continued through
1791852683657 with no death. A fast response completed at 1791852683117, but the
final native report still had no maintenance acknowledgement.

The existing evidence cannot distinguish an unread host file, a response missing
the lease, rejected response ordering, or runner replacement. Retain the actual
written lease, passive combat response control fields, and native/root-parent
maintenance timestamps during the unchanged acknowledgement poll. Observe existing
traffic only, retain a bounded ledger, and do not retry mutations or relax any
combat, acquisition, safety, or five-second acknowledgement assertions.
