# Bank sort swap journal: failure inventory

Written 2026-10-18. Live: FonzeMerch stood in the bank and every merchant job (auto upgrade,
compounds, NPC sales, exchanges) failed within a second with `Bank sort swap not confirmed; recovery
pending`, about every 6 s. Its persisted journal (`party-bank-sort-buffer:FonzeMerch`) held one pending
swap: Talking Skull +0 into inventory slot 11, leaving bank `items3` slot 34 empty. The skull was in
slot 11, so the swap had happened, but slot 34 now held a Candy deposited afterwards.
`settleBankSortSwap` (`characters/shared.js`) requires both sides to match exactly, so it could never
confirm. Journey: `e2e/live-bank-sort-journal.spec.ts`.

1. **Permanent block.** A completed swap whose freed bank cell was refilled before confirmation is
   never settled, and every merchant job fails behind it.
2. **Replayed or reversed swap.** Settling must not swap again or take the item that now occupies the
   bank cell.
3. **Lost buffer item.** The item moved into the inventory buffer slot must go back to the bank, as for
   a confirmed swap.
4. **Unrelated item disturbed.** The Candy in the refilled cell stays where it is.
5. **Unconfirmed swap accepted.** If the swap did not happen (the item is still in the bank cell and
   the buffer slot does not hold it), the journal must not count it as confirmed. Unchanged code path,
   not exercised by the journey.
