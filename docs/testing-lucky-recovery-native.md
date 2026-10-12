# Native lucky restoration regression

Failure inventory before editing:

- Interrupted completed upgrades can have a displaced item replaced; recovery must clear obsolete layout bookkeeping rather than block later merchant work.
- Ambiguous recovery must not swap, duplicate, delete or upgrade actual inventory.
- The diagnostic must identify why restoration was skipped.
- A still-provable changed potion quantity should restore through native swaps, preserving the actual quantity.
- Replaying the settled journal must not swap again.

CI native shard 16 of run 38210159133 failed because the retained native scenario still expected the pre-#47 blocking error. The current production contract intentionally abandons ambiguous restoration. Preserve native inventory assertions and verify warning/journal retirement, then exercise the valid restore and replay paths.
