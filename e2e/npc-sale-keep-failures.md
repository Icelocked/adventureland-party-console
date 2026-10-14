# Keep N, NPC-sell the rest: failure inventory

Written before the change (#116, filed from the user's account: "Keep X amount of items in
bank, auto-sell rest", e.g. Pouch of Poof). An automatic NPC-sale rule sells every
matching copy; the user holds 56 stacks of 100 Pouches of Poof and wants to keep a
configurable amount for crafting Pouchers. Live journey: `e2e/live-npc-sale-keep.spec.ts`.

1. **Not configurable.** The dashboard rule dialog has no keep amount, so the rule sells
   everything.
2. **Oversold.** With a keep amount, fewer than that many remain across the merchant's
   bag, bank and BankBois (stock reserved for crafting is not counted as spare).
3. **Undersold.** More than the keep amount remains once the merchant has worked through
   the rule (whole bank stacks are withdrawn while there is excess; carried stacks are
   sold down to exactly the excess).
4. **Sells again.** Once at the keep amount, later passes sell nothing more.
5. **Lost on edit.** Reopening the rule shows the saved amount, and saving a new amount
   updates it; a blank amount sells everything, as before.
