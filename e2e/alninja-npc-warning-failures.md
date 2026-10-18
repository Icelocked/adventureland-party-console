# ALNinja NPC-sale warning: failure inventory

Written 2026-10-18. Requested: when marking an item for NPC sale or automatic NPC sale, warn if players
actually pay well over the NPC price. Never block or change the sale. Only real sales count, not asks that
sit unsold for days, and the thresholds are configurable: warn when at least X units sold in the last 7
days at that level and variant, at a median price at least Y gold above the NPC price (defaults: 3 units,
1,000,000 gold; "10k more is still cheap junk"). Data: ALNinja `GET /api/v1/sales?item=&hours=168`.
Journey: the third test in `e2e/live-alninja-stand-price.spec.ts`, against the local ALNinja stand-in.

1. **No warning.** The Sell to NPC and Automatically sell to NPC dialogs show nothing when players pay
   millions more.
2. **Cheap junk warns.** An item that sells regularly but less than Y over the NPC price must not warn.
3. **Unsold asks warn.** Only recorded sales in the last 7 days count, at the item's level and variant.
4. **Override.** The warning must not block, change or cancel the sale. The sale button stays enabled.
5. **Unexplained.** The warning shows units sold in the last week and their median against the NPC price
   per unit.
6. **Not configurable.** X and Y are set in Settings → ALNinja, persist across a coordinator restart and
   apply to the next dialog.
