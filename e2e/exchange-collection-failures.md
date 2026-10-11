# Party stock for automatic exchange: failure inventory

Written before implementation. Reported live: Rare Candy (`candy1`) with an Auto
exchange rule stayed in the fighters' bags, and marking it Auto merchant deleted
the exchange rule (one automatic action per item, `inventory/automatic-action.ts`).
Automatic upgrade and compound rules already pick up party stock without a merchant
mark (`merchant/collection-pickups.ts` `processing`); exchange did not, so party
stock under an exchange rule was never collected.

1. **Stranded.** A party member's stack under an Auto exchange rule, with no merchant
   or bank mark, must be picked up by party collection and then exchanged.
2. **Collected but not exchanged.** Picked-up stock must reach the merchant's
   exchange plan; it must not sit in the merchant's bag or be banked as unmarked.
3. **Routine disabled.** With "automatic exchange" disabled, party stock under the
   rule stays with its owner (the merchant must not hoard what it won't exchange),
   as auto compound/upgrade pickups already do for their routines.
4. **Locked or bound.** Locked (`l`) or bound (`b`) stacks are never picked up.
5. **Wrong level.** A rule for level 0 does not pick up another level of the item.
6. **Held gear and manual intent.** Gear-set members, swapped-out gear, and items
   with manual upgrade/compound/stat-scroll marks are never picked up for exchange.
7. **Conflicting rules.** An item that also carries an NPC sale, stand sale or
   deconstruction rule (`itemRuleConflicts`) is not picked up, as for compounds.
8. **Unrelated items.** Party items without an exchange rule stay where they are.
9. **Merchant's own stock.** The merchant is not a pickup source for itself.
10. **Dashboard.** A party member's stack under the rule is labelled "Auto exchange",
    not left looking unmarked.
