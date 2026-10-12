# Native buy-target restoration timing failure inventory

- The fault injection occurs on the second real lucky restoration, after bank funding, navigation, two purchases and two native upgrades. On cfb8d02 the first upgrade arrived at order +107 seconds and the second at +198 seconds, just after the 180-second assertion deadline.
- Preserve genuine native receipts, exact two-result delta, retained paid state, restart reconciliation and later shoes upgrade. Allow a bounded five-minute pre-fault window and enough total scenario time for the unchanged restart stages.
- This is a timing adjustment based on recorded progress, not an assertion bypass. The real native journey must rerun before claiming success.
