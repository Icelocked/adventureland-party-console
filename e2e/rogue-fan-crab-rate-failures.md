# Rogue Fan of Knives crab kills per minute: failure inventory

Written before the change (2026-10-19). The user wants the most crab kills per hour in any
situation, alone or sharing the spawn with another farmer. Live (FonzeRogue, 4 min): about 272
kills a minute, 28 MP potions a minute, 151 movement cancellations a minute, while Cyberattack
farmed the same spawn. Journey: `e2e/live-rogue-fan-crab-rate.spec.ts` (4 minutes, solo and
against a declared competitor killing up to five crabs within 150 of (-1160, -230) every 600 ms).

The Mainland crab spawn has 8 crabs in a 301 x 376 box, respawning 640-1540 ms after death. Fan
of Knives reaches 160 (native edge-to-edge distance), hits up to five, and shares the attack
cooldown (about 750 ms for the journey's rogue).

Baseline before the change (control):

| | Solo | Contested |
|---|---|---|
| Kills/min | 282-294 | 246-269 (competitor 140) |
| Casts/min | 69-71 | 62-70 |
| Mean targets per cast | 4.06-4.14 | 3.92-3.98 |
| Attack cooldown ready with crabs in range and MP, no cast | 74 s of 240 | 90 s of 240 |
| ...of which while moving | 64 s | 54 s |
| Moved/min | 1,215-1,398 | 1,189-1,383 |

1. **Slots lost to the primary.** Fan of Knives is offered only when its targets include the
   scatter primary (the nearest crab). With the primary beyond Fan range, no skill is chosen,
   the basic attack is out of range, and the slot passes while the rogue walks toward that one
   crab, with 5-9 others in range. Expected: while fan farming, the knives go to the one-shot
   crabs in range even when the primary is not among them.
2. **Stand anchored on one crab, at a short reach.** The stand only considers spots within 140
   (range - 20, centre to centre) of the primary, while native range is 160 edge to edge.
   Expected: the stand is the spot that keeps the most one-shot crabs within 160 of its centre,
   around any visible crab; the rogue holds while its spot covers as many, even with the primary
   out of reach.
3. **Jitter.** The stand moves with every new primary. Expected: move only to a spot that covers
   more crabs than the current one.
4. **Rim crabs dropped (found while measuring).** Of 113 casts below five targets in one solo run,
   about 67 left one-shot crabs that were in native range and authorized. The skill world's actor
   (`{...character}`) and the combat context's monsters (`Object.assign({}, def, m, {x, y})`) are
   plain copies that skip PIXI's `width`/`height` getters, so `distance()` on them measures centre
   to centre while the server measures edge to edge, and crabs at the rim of Fan of Knives' range
   fall out of the engine's targets (the same class as scatter item 5, which copied `x`/`y`).
   Expected: the copies carry `awidth`/`aheight` from the native helpers, so the engine's range
   matches the server's.
5. **Regressions.** Fan farming elsewhere (Goos, `live-rogue-fan-scatter.spec.ts`), basic-attack
   fallback below the MP reserve, potion use and survival behave as before; non-fan farming is
   unchanged.

Target: more kills per minute than the control in both scenarios, measured with the same journey.
