# Equipment comparison

Run `npm test -- -- --project=console --grep "equipment comparison removes"`.

The Chromium scenario renders the maintained comparison dialog using declared
game item metadata. A wand and book start with a two-piece INT bonus; replacing
them with a two-handed staff loses the book's stats and set bonus and gains a
different set bonus from the staff and an equipped ring. Assertions check the
displayed character stats and gained/lost set labels, then toggle the left
offhand checkbox, reopen the comparison, and compare a one-handed replacement.
It also checks a three-piece set dropping to its two-piece bonus. Native set
entries describe the total bonus for an exact piece count, so earlier tiers
are not added again.

The checkbox defaults on and affects only the equipped preview. The two-handed
proposal always has an empty offhand. Both previews subtract actual equipment
and actual set bonuses from the reported character stats before adding their
own loadout, preserving other reported character contributions.

The report in `.build/e2e-report/` and evidence in `.build/e2e-results/` include
the input metadata, both displayed previews, default and toggled screenshots,
the set-change screenshot, and the browser trace. This tests comparison UI and
projection behavior; it does not equip items or validate native game formulas.
