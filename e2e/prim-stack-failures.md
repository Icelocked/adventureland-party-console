# Prim stacking: failure inventory (#65)

Written before the change. Prim stacking raises an item's hidden `grace` with
upgrade operations that attempt no level change (game `node/server.js`, upgrade
handler): an offering with no scroll adds +0.5 and is consumed; an offering
with a stat scroll adds +1, consumes `[1, 10, 100, 1000][grade]` scrolls and
rewrites `stat_type` to the scroll's stat. `grace` is in `item_p_ignore`, so
inventories never show it; only `upgrade(..., calculate)` responses report it.
Live journey: `e2e/live-prim-stack.spec.ts`, which reads native `item.grace`
on the game server.

1. **No way to ask for it.** A merchant inventory item offers no prim-stack
   action, so the only path is the game's own upgrade window, which shows a
   misleading 99.99% and gives no grace readout.
2. **Wrong offering spent.** Grade does not change the grace gained, so every
   operation must use Primling, never Primordial Essence or X.
3. **Overshooting.** Grace above what the next attempts can use is wasted. The
   job reads the native grace first and stops at the requested target; a
   repeated or resumed job does not stack past it.
4. **Stat changed.** The stat-scroll method must use the scroll for the item's
   current `stat_type`. Items without a stat, or without `stat_type`, are
   refused rather than given a new stat.
5. **Scroll count wrong.** Each stat-scroll operation needs the full grade
   quantity on hand; too few scrolls make the server refuse the operation.
   Purchasable scrolls (str, int, dex, vit) may be bought; others must come
   from the merchant or bank inventory.
6. **Item lost or swapped.** The item must stay in its slot with the same
   name, level and stat after every operation; a changed item stops the job
   without spending more supplies.
7. **Lucky-slot sampling polluted.** Prim-stack operations must not be counted
   as upgrade-scroll rolls for lucky-slot discovery.
8. **Invalid requests accepted.** Items outside the merchant inventory, items
   that cannot be upgraded, targets outside 0.5-15, missing Primlings, and a
   changed item are rejected before any work is queued.
9. **Result invisible.** The upgrade chances panel shows the current grace
   from the server preview, and the job reports grace before and after.
