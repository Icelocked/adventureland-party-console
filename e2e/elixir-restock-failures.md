# Elixir resupply: failure inventory

Written before the change (2026-10-17). Requested: the merchant buys a fighter's elixir
(Liquid Luck for a rogue farming crabs; one lasts 12 hours) and keeps it supplied, and the
fighter drinks it. Restock policies only cover HP and MP potions today. Live journey:
`e2e/live-elixir-restock.spec.ts`.

1. **No elixir supply.** `/restock` ignores an elixir supply, so nothing is saved, and the
   dashboard has no field for one.
2. **Never bought.** A fighter below its elixir minimum never queues a merchant restock, or
   the restock skips the elixir.
3. **Wrong counter.** Liquid Luck is sold only by the Winter Inn bartender, who stands
   behind a closed counter. Walking to his raw position (as potion restocks do) can't reach
   him; the walk must use the named destination, which approaches from the customer aisle.
4. **Never drunk.** A delivered elixir sits in the bag while no elixir is active.
5. **Wasted elixir.** A fighter drinks a carried elixir while one is still active (equipping
   replaces it), or drinks an elixir other than the one its policy names.
6. **Not resupplied.** Once the carried spare is drunk, the merchant does not bring another.
7. **Potions changed.** HP/MP restocks behave as before when no elixir is configured.
8. **No gold carried.** Restocks bought only with the merchant's carried gold. At 240k a
   Liquid Luck, a spare failed with "Insufficient gold to restock" and the job was dispatched
   again every couple of seconds. The restock now withdraws the shortfall from the bank first.
