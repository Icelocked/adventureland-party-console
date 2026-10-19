# Configurable elixirs per character and gear set: failure inventory

Written before the change (2026-10-19). Follows #138 (`elixir-restock-failures.md`). The user:
"luck potions seem to be hardcoded, but different characters or gearsets want different elixirs, so
the behavior should be extensible & configurable in dashboard". Decided with the user: a gear set
names its elixir in a dashboard dropdown (character default, none, or any elixir), and switching
sets never replaces an active elixir; the set's elixir is drunk when the active one expires.
Journey: `e2e/live-elixir-choice.spec.ts`.

Today the restock policy holds one `elixir` supply, the dashboard fixes its item to Liquid Luck, and
the fighter drinks that item whenever none is active. Only Liquid Luck (Winter Inn bartender) and
the short tavern drinks are sold by NPCs; the stat elixirs (dexterity, strength, vitality,
intelligence, tiers 0-2) and the resistance elixirs come from crafting, drops and exchanges.

1. **One fixed elixir.** The restock form offers only "Luck elixir min/max". Expected: any number of
   elixir supplies, each any `elixir`-type item with its own min/max, and a character default to
   keep active (or none), all saved from the form.
2. **No per-set elixir.** Expected: each saved gear set has an Elixir dropdown (character default,
   none, or an elixir). The worn set is the saved set whose items match what the character wears in
   every slot but the elixir; with no match, the character default applies. Re-saving a set keeps
   its elixir choice.
3. **Waste on a switch.** Expected: with an elixir active, nothing is drunk, even if the worn set
   wants another; once it expires, the worn set's elixir is drunk. An elixir the fighter does not
   carry is never equipped.
4. **Elixirs nobody sells.** The merchant restock only buys from NPCs, so a stat elixir supply is
   never filled. Expected: a supply with no NPC seller is withdrawn from the bank and delivered;
   with neither seller nor bank stock, the merchant reports it and the other supplies continue.
5. **Saved policies.** A policy saved before this change (one `elixir` supply) keeps working: its
   item becomes the one supply and the character default, and the form shows it.
6. **Regressions.** HP/MP restocks and the Liquid Luck journey (`live-elixir-restock.spec.ts`)
   behave as before; gear set save, equip and the kill-time luck swap never touch the elixir slot.
