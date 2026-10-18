# ALNinja stand price: failure inventory

Written 2026-10-18. Requested: the "mark for stand" pop-up offers ALNinja's price for the item
(`GET /api/v1/prices/:item` on the configured instance). Live journey:
`e2e/live-alninja-stand-price.spec.ts`, against a local stand-in for the ALNinja API. The option was
drafted before the journey; the control run is on the commit before it.

1. **No ALNinja option.** The pop-up has no ALNinja price, median or undercut choice.
2. **Wrong row.** ALNinja returns every level and variant of an item; the option must use the row
   for the listed item's level (and variant), not the first row.
3. **Wrong region.** Prices must come from the merchant's region (US, EU or ASIA, from its server),
   not the all-regions default.
4. **Token required.** Price lookups use ALNinja's public API, so they must work with reporting off
   and no token, and must not send the token.
5. **Silent failure.** With no listing for that level, or the instance unreachable, the options are
   disabled and the reason is shown, instead of offering a wrong or zero price.
6. **No bid suggestion.** Added 2026-10-18: the WTB order dialog offers ALNinja's best current bid
   (to match, or beat by 1) and its cheapest seller, from the row for the order's level.
7. **Level ignored.** Changing the order's selected level must switch to that level's row.
8. **Step ignores the price.** Added 2026-10-18: the bid and undercut options moved the price by 1 gold,
   which does nothing at the 100k+ prices most items trade at (Simple vitearring +2: best bid 7m). They
   step by one unit in the price's third significant digit, at a round number (7,000,000 → 7,010,000;
   1,250,000 → 1,240,000), and by 1 gold below 1,000.
