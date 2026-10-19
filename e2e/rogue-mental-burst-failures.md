# Rogue Mental Burst while fan farming: failure inventory

Written before the change (2026-10-19). The user: Mental Burst "should be used as much as possible,
as long as it oneshots crabs". Journey: the Mental Burst case of
`e2e/live-rogue-fan-crab-rate.spec.ts` (4 minutes, solo, the rogue given 64 int with two Rings of
Intelligence).

Mental Burst (rogue, 64 int): 0.6x attack as magical damage, 900 ms cooldown of its own (not the
attack cooldown Fan of Knives shares), 180 MP, reach `range * 1.2 + 32`. On a kill the server
returns the HP it removed as MP (`attacker.mp += net`, `net = original - max(0, target.hp)`), so a
burst that kills a crab with at least 180 HP left gains MP. Crabs: 400 HP, 0 resistance.

Live on 10-19, FonzeRogue has 32 int, so the game refuses Mental Burst and none of this applies
until its gear reaches 64 int (attack 764, so a burst would one-shot a full crab).

1. **Primary only.** `offense(target)` considers only the scatter primary. While fan farming the
   stand is placed for Fan of Knives (160 edge to edge) and the primary is just the nearest crab,
   so a burst is skipped whenever that one crab is out of reach, already dying, or too weak, while
   other crabs within reach would die to it. Expected: every crab within Mental Burst's reach that
   it kills is a candidate, the one with the most HP left first (the largest refund, and the one
   Fan of Knives is least likely to be killing already).
2. **Held back by the MP reserve and budget.** A burst must leave the 20% survival reserve and pass
   the sustained-farming MP budget, although a killing burst on a crab with at least its cost left
   ends with more MP than it started. Expected: such bursts skip both; a burst that kills but
   refunds less than its cost keeps both.
3. **Only MP-positive kills.** A burst is offered only when the crab has at least its cost left.
   Expected (the user): any crab it kills; the reserve and budget still guard the ones that cost MP.
4. **Regressions.** Fan of Knives casts and targets per cast, potion use and survival are no worse;
   a rogue without 64 int behaves as before; outside fan farming Mental Burst keeps today's rules.

Measured per run: bursts per minute (at most 66 from the cooldown), burst kills, and the time
Mental Burst was ready (cooldown over, MP for it) with a crab in its reach that it would kill but
no burst followed.

## Results (2026-10-19)

| | Control | Change |
|---|---|---|
| Bursts per minute | 3.75 | 47-49.75 |
| Burst kills | 15 of 15 | all but one or two |
| Median wait, cooldown end to burst | (support tick) 348 ms | 99 ms |
| MP potions in 4 minutes | 100 | 12-27 |
| Crab kills per minute | 324.75 | 325-346 |

5. **Waiting on the support tick (found while measuring).** With items 1-3 fixed, bursts still
   waited a median 348 ms after the cooldown ended: Mental Burst was only tried on the 250 ms
   support tick, after potions and buffs. Now the next burst is tried as its cooldown ends, and a
   burst whose crab died first (`not_there`, `no_target`) no longer locks the skill out for a
   second.

Kill rate barely moves: with bursts, Fan of Knives casts less, so the 8-crab spawn's respawns cap
the total near 340 a minute and bursts mostly take kills the knives would have had. The gain is
MP: each burst on a full crab returns 400 for its 180, so the rogue drinks a fraction of the potions.

The first draft measured "ready with a crab it kills in reach, not cast" and expected at most 5% of
the run. That sampler also counted crabs that knives in flight were about to kill and bursts
awaiting the server, so it can't reach 5% (32 s of 240 with the change, 225 s in the control). The
journey now asserts the direct measures: at least 40 bursts a minute, a median wait of at most
250 ms (ChronAL's 250 ms clock steps put the ceiling near 60 a minute), and every burst kills.
`live-rogue-fan-scatter.spec.ts` "isolated one-shot Goos ... not melee" fails on HEAD too.
