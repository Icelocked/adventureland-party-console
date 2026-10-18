# Rogue Fan of Knives on crabs: failure inventory

Written 2026-10-18. Live: FonzeRogue (level 73, Fan farm set: Fiery Throwing Stars +7 in both hands,
Knife Belt, 860 MP) scatter farms crabs alone on a build with every earlier Fan of Knives fix. In 54
seconds it cast Fan of Knives 40 times out of about 86 attack slots (1.6 attacks a second, shared
cooldown), drank 22 `mpot1` (about 11,000 MP against 7,200 MP of casts), and the user saw two or three
basic attacks in a row. `live-rogue-fan-scatter.spec.ts` (Goos) shows no basic attacks. Journey:
`e2e/live-rogue-fan-crab.spec.ts`.

1. **Basic attack with MP for a cast.** While fan farming crabs, an attack slot goes to a basic attack
   although the rogue has the MP for Fan of Knives.
2. **Rejection lockout.** A Fan of Knives rejected by the server for a reason other than the shared
   cooldown (`no_mp` at the reserve edge, a target that already died) locks the skill out for a second
   (`runtime/characters/skills/engine.ts`), about two basic attacks.
3. **Budget or reserve skip.** Fan of Knives skipped by the farming MP budget or the survival reserve
   while potions remain.
4. **Too few casts.** Fewer than 30 Fan of Knives casts in a minute of crab farming.
5. **Dies.** The rogue must survive the minute.

Found 2026-10-18: neither rejections nor budget skips occurred. The attack controller swings when the
shared attack cooldown has at most 2 ms left (`attack-controller.ts`, `remaining() <= 2`), but the skill
world treated `next_skill.attack` and `next_skill.fanofknives` (set to the same time) as cooling down until
the exact millisecond. `blocked()` returned `cooldown`, `attackChoices` dropped Fan of Knives silently, and
the slot fell through to a basic attack (followed by the controller's burst packets). Control: 12–40 basic
attacks a minute, all with MP for a cast; with the shared edge, none.
