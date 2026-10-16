# Stat-scroll bank supply: failure inventory

Written before the change. `preloadStatScrolls` (characters/shared.js) prepares the
scrolls a stat-scroll visit needs. It called `retrieveFromBankUntil(names[n], needs[n])`
with a list index instead of the scroll name, so the required count was `undefined`
and nothing was ever withdrawn. Live journey: `e2e/live-stat-scroll-bank.spec.ts`.

1. **Bank stock ignored for purchasable scrolls.** A STR/INT/DEX/VIT scroll held in
   the bank is bought again from the NPC; the bank copy stays and gold is spent.
2. **Bank stock ignored for other scrolls.** Any other stat scroll fails with
   "Missing N × scroll in merchant or bank inventory" even when the bank has enough.
3. **Over-withdrawal.** Only the visit's required count is withdrawn; a fully
   stocked inventory makes no bank trip.
