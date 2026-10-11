# BankBoi staging row only while a BankBoi exists: failure inventory

Written before implementation. Reported live: with no BankBois, the dashboard marks
items1 slots 35–41 RESERVED and the merchant never stores or sorts into them, although
the first-BankBoi dialog says creating one "will reserve 7 slots from bank pane 1".
The row was hardcoded in the character runtime (deposits, merges, stack homes, sort),
the coordinator (cargo adoption, staging priority, stack protection) and the dashboard.

1. **Still reserved.** With no BankBoi, the row is ordinary bank space: deposits,
   stack merges and sorting use slots 35–41, and the dashboard shows no RESERVED.
2. **Orphan cargo.** With no BankBoi, an item in slots 35–41 is not adopted as BankBoi
   cargo; cargo already queued from the row is released, not kept waiting forever.
3. **Lost or duplicated items.** Sorting through the row keeps every item exactly once.
4. **Reserved too late.** Once a BankBoi exists, the row is staging again everywhere:
   RESERVED on the dashboard, excluded from sorting and ordinary deposits, and items
   already in it are adopted as cargo for the BankBoi (they move to its storage).
5. **Stale flag.** Characters learn the current setting from the heartbeat; a
   coordinator without the flag (older version) keeps the row reserved.
6. **Merchant priority.** The staging-handoff priority boost applies only while the
   row is staging.
7. **Free-slot count.** The bank pane's free-slot colour counts the row only while it
   is ordinary space.
8. **Restart.** The behaviour follows the saved BankBois across a coordinator restart.
