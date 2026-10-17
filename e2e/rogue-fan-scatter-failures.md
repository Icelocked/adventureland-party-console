# Rogue Fan of Knives while scatter farming: failure inventory

Written before the change (2026-10-17). A Knife Belt rogue scatter farming mobs that
Fan of Knives kills outright stops casting it soon after its opening MP is spent, and
keeps basic-attacking with a bag full of MP potions. Fan of Knives costs 180 MP and
replaces a swing (it shares the attack cooldown). Live journey:
`e2e/live-rogue-fan-scatter.spec.ts`.

1. **No MP potions.** The rogue role has no `usePotion`, so in combat it only casts
   `regen_mp` (100 MP per 4 s). That also puts potions on cooldown for 4 s. Its MP potions
   are never used while farming.
2. **Budget throttle.** The sustained farming MP budget allows a damage skill only after
   MP has been regained over the previous 30 s. Fan of Knives is skipped with
   `sustained farming MP budget` even though the rogue has MP above its reserve and
   potions to refill it.
3. **Single-target skills spend Fan of Knives MP.** Quick Stab (320 MP, 0.36×), Quick
   Punch (240 MP, 0.25×) and Mental Burst (180 MP, 0.6×) each hit one mob, on their own
   cooldowns. They drain the MP Fan of Knives needs to hit up to five mobs. Mental Burst
   refunds only the damage it deals on a kill, capped at the target's remaining HP. On a
   mob that Fan of Knives one-shots, it gains back less MP than it costs unless that mob
   has at least 180 HP left.
4. **Wasted potions.** The rogue drinks a potion that would overflow its MP, or drinks MP
   potions when Fan of Knives does not kill (grouped farming, tanky mobs, no Knife Belt).
   Those cases keep the old behavior: potions below 50% HP or 20% MP.
5. **Extra targets never authorized.** Found during the control run: the combat context
   copies each monster with `Object.assign`, which skips the native entity's PIXI `x`/`y`
   accessors. Farm-area authorization then rejects every copy, so Fan of Knives (and ranger
   3-shot/5-shot) only ever see their primary target and never beat a basic attack.
6. **Survival.** Spending for Fan of Knives eats the 20% survival MP reserve, or HP
   potions stop working below 50% HP.
7. **Invisible opener.** Before an unengaged pull the rogue casts Assassin's Smoke for its
   1.25× sneak-attack bonus, which is overkill on mobs that die in one hit, then swings in
   melee. Reported by the user after the first fix (2026-10-17).
8. **Melee positioning.** Combat movement walks to basic attack range of the primary
   target, and Fan of Knives is chosen only when it beats a basic attack. A rogue with a
   short melee range keeps walking up to single Goos and swinging, instead of standing within
   Fan of Knives' 160 range of the target and toward the nearby cluster of killable mobs.
   The E2E uses the level-zero weapon loadout, since a +100 claw reaches past 160. The
   dense native Goo spawn hides this (walking up to one Goo still leaves others in reach),
   so a second journey declares waves of Goos placed more than 160 apart.
9. **Basic attacks within reach.** With throwing stars (basic range ~120) a lone one-shot mob
   inside basic range is killed by a basic attack, because Fan of Knives only ties it. While
   fan-farming with MP above the reserve, Fan of Knives is used anyway. Reported by the user on
   2026-10-17: about 17 basic attacks a minute alongside Fan of Knives.
10. **Stand reaches too few.** The stand aims at the middle of every one-shot mob near the
    target, which can reach only the target (a group on each side, both out of reach), and
    the independent approach walks to basic attack range before the stand takes over. The
    rogue should stand where Fan of Knives reaches the most one-shot mobs with the target, up
    to five, holding while its spot already reaches as many; the approach should end at Fan
    of Knives reach. Requested by the user on 2026-10-17 ("positions itself such that it gets
    5 targets in range"). Retained isolated test: `scripts/tests/fan-stand.test.cjs`.
