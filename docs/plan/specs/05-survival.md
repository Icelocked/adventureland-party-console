# 05 Survival (SRV)

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
(local checkout)) or "21b8362d" (the death fixes in
(local checkout)). Game rules: server source in
(local checkout) (43b2c8fc), client
`runner_functions.js` 17175, AL MCP v18183.

This part owns heals, HP and MP potions and regeneration, survival thresholds per
class, danger checks, the decision to escape, death, respawn and recovery. Which action
spends a shared cooldown (and the potion-group collisions behind ledger 13) is spec 03.
The escape movement itself (Blink, retreat steps, walk to Main) is proposed to spec 02.

## 1. What it does today

### Survival thresholds per class

| Class | HP potion | MP potion | Other survival rules |
|---|---|---|---|
| Priest | below 50% (priority HP) (priest.ts:20-22) | below 20% | heals party below 90%, partyheal when two are at or below 50% (shared.js:13862-13920); escape heals below 95% (199, 272); MP reserve for skills max(35%, 2 heals + partyheal) (eligibility.ts:38) |
| Mage | below 50% (mage.ts:8-10) | below 20% | escape drinks MP up to full MP and never HP (shared.js:67-72) |
| Warrior | none | only the leader, with an attacker near, below Taunt's MP (warrior.ts:44-49) | emergency Stomp when an ally is below 60% (shared.js:16014-16047); escape budget Hardshell + 2 Dash (68) |
| Paladin | none (default.ts:25-27) | none | selfheal below 70% or when missing at least 80% of its output, mana shield below 40% with incoming damage (protection.ts:14-20, 51-59) |
| Ranger, rogue | none | none | - |
| Merchant | below 20% inside regen (shared.js:13772) | below 20% | HP potion when missing more than the potion heals (13776-13782) |
| All | regen: HP below 50% first, then MP below 50%, then any missing HP, then any missing MP (13785-13792) | | passing attacks stop below 35% HP (3474) |

None of these numbers is a setting.

### Behaviours

- **SRV-001 Class potions.** `useRecoveryPotion` (shared.js:13832-13855) returns false
  when `is_on_cooldown("use_hp")`, picks `use_hp` or `use_mp` from the options (`force`,
  `hpBelow`, `mpBelow`, `priority`), sends `use_skill`, and logs failures other than
  cooldown, no item, not found and full. The role loop calls the class `usePotion` first
  in every support tick (runner.ts:259).
- **SRV-002 Free regeneration.** `regenerateHpOrMp` (13761-13808) runs when no potion was
  drunk (runner.ts:259) and from the passive pulse every 500 ms (17369,
  `passiveRegenerationTick` 13823-13830) whenever `passiveRegenerationEligible`
  (13810-13821) holds: merchants always; escape `complete`/`failed-hold`; reunion,
  anniversary, event travel, Town travel, forced travel, convoys, following, departure,
  Town, banking, stocking, upgrading, gathering, or moving without an engaged monster. It
  skips during other escape stages (13762). Regen locks every potion for 4 s
  (server.js:12042-12048). The passive pulse also tops off the party with a priest's
  regular heal (13828).
- **SRV-003 Priest healing.** `healPartyBelow(ratio, options)` (13862-13920): priests only,
  not dead, not `healingBusy`, not during a Town cast (13867). Reads heartbeat HP
  (`partyPositions`, or cave members) for members under the ratio and for members at or
  below 50% (13872-13881). Two or more critical members and partyheal ready -> partyheal
  (13882-13887; not from the passive pulse, not in non-uniform A/B). Otherwise heals the
  first injured member whose live HP is still under the ratio and `can_heal` holds
  (13894-13898), with a 2 s timeout, and records `lastHealAt`. The priest's
  `beforeTarget` runs Absorb, then heal at 90%, then support skills (priest.ts:15-19).
  `isPartyHealthy` (13977-13986) gates Curse.
- **SRV-004 Escape potions.** `escapePotions` (62-75), from the 100 ms escape timer
  (325) in the survival pulse (189-201, stages `recovering`, `recovery-convoy`,
  `complete`, `failed-hold`) and the escape pulse (247): when `use_mp` is off cooldown,
  drink MP below the class budget (warrior Hardshell + 2 Dash, or full MP while shielded;
  priest Curse + partyheal + heal; mage full MP), else HP for non-mages below max.
- **SRV-005 Danger model.** `incomingDps` (damage.ts:50-57) sums attack x frequency x
  mitigation x 1.1 for monsters targeting the ally (Infinity for unknown stats).
  `endangered` (64-67): incoming damage and HP below 60%, or 2 s of that damage leaves
  less than 30%. `safeTransfer` (58-63): taking a monster's damage must leave the caster
  above 30% after 2 s, with observations at most 1.5 s old. `safePull`
  (eligibility.ts:57-63) refuses scatter-mode area pulls that would drop the caster
  under 30% in 2 s.
- **SRV-006 Protective skills.** Paladin selfheal, mana shield on and off (on below 40%
  with damage, off above 65% or at the reserve), aether shield under magical damage,
  cleansing light (urgent for stun, freeze, tangle, poison, burn or an endangered ally),
  Guardian's Oath for an endangered ally, Beacon of Resolve when the leader would fall
  under 30% in 2 s or two allies take damage (protection.ts:14-65).
- **SRV-007 Emergency warrior Stomp.** `emergencyWarriorStomp` (16014-16047), from the
  warrior's `beforeTarget` outside Franky (warrior.ts:19): basher equipped, not scatter,
  not tinyp, Graveyard allows, no locked-out monster in range during an unfinished fight,
  and danger: two monsters target the warrior, it is kiting, or a fresh ally report is
  below 60% or kiting. Needs a party-targeting monster in range. Raw `use_skill`.
- **SRV-008 Own death capture.** `combatDeathListener` (1079-1097): for the own death it
  builds "Killed by <name>" from the last incoming damage within 15 s
  (`deathCombatMessage`, 1049-1058), stamps the Hunt event trip (`captureHuntDeath`,
  616-622), queues a combat event, and marks the event to rejoin.
- **SRV-009 Respawn and rejoin.** Every 250 ms the runner resets targeting while dead and
  calls the death recovery (runner.ts:341-351). `createDeathRecovery`
  (death-recovery.ts:18-74) yields to dungeon or escape ownership (runner.ts:67-69),
  races `respawn()` against 3 s, waits for the alive state, then rejoins an active event
  (`rejoinActiveEventAfterRespawn`, shared.js:13721-13759) or starts the farm reunion,
  retrying every 1 s and publishing phases to `partyCombatState.recovery`.
- **SRV-010 Party death recovery (coordinator).** `combat-disengagement.cjs` (2-170):
  `newDeaths` (24-36) finds fresh deaths outside events. `start` (77-82): if every foe is
  at or below 25% HP and every survivor at or above 50%, the party finishes them
  (`finishing`), else escapes (`escape`, 68-76: reset combat, abandon rare, call the party
  escape for every member). Another death or a failed finish escapes (141-143).
  `recover` (90-102) waits for `safe` (83-89): every member fresh, alive, settled, at or
  above 50% HP, on `main` within 65 of (0,0), with no threats; then resets combat,
  releases the escape, and resumes Hunt or returns to the saved farm with a 5/15/30/60 s
  retry ladder (103-121). While active, nominations and threats are stripped from
  reports (`prepare`, 150-157) and the queue is emptied (`finalize`, 158-168).
  `combatRecoveryActive` (shared.js:14383-14386) tells the character.
- **SRV-011 Cave revival.** `installCaveRecovery` (cave-recovery.ts:32-237) with ports from
  `caveRecovery` (shared.js:2658-2694): the assigned priest heals a grave to full, then
  casts Revive with Essence of Life once authorized, holding the attack slot while
  ready or waiting for MP (`reserved`, 130-135); living teammates are healed first
  (89); in a fight it keeps the priest reserve (92). A local journal stops a second
  Essence use after reload or an unknown outcome (39-49, 152-173).

## 2. What goes wrong

### Bug 3b (ledger 3): the tank dies with potions in the bag

1. The support tick drinks a potion only through the class `usePotion`; warrior,
   paladin, ranger and rogue have no HP potion threshold (warrior.ts:44-49,
   default.ts:25-27).
2. When no potion is drunk the tick casts regen (runner.ts:259), and regen takes
   `regen_hp` at any HP below max (shared.js:13791).
3. Each regen locks every potion for 4 s (server.js:12048); the passive pulse can cast it
   again in travel and idle states (13823-13830).
4. For a priest or mage that then falls below 50%, `useRecoveryPotion` returns false
   while `is_on_cooldown("use_hp")` (13834), so the HP potion waits up to 4 s.
5. Inference: under steady damage a warrior's only HP sources are regen (one
   `regen_hp` output per 4 s) and the priest, whose heals bug 3a starves (spec 03).

Not patched for normal combat. dab0de01 (21b8362d) adds an HP potion below 50% only while
the character is occupied.

### Bug 3 part (ledger 3): the emergency potion drinks MP first

1. `escapePotions` drinks MP whenever MP is below the class budget (shared.js:71); the
   mage budget is full MP (69).
2. HP is drunk only when MP is satisfied, and never by a mage (72).
3. Measured on the fork: "the escaping mage drank an MP potion at 531 of 1873 HP and died
   to the next hit" (dab0de01 message, run 4 of the uhills Targetron probe).

Patch: dab0de01 (21b8362d) drinks HP first below 50% for every class. The order stays a
second potion policy beside SRV-001.

### Bug 5 (ledger 5): Hunt stuck after a death

1. A death starts recovery; `escape` calls `hooks.escape(r.names)` with every member
   (combat-disengagement.cjs:68-76).
2. `party-escape.cjs` `start` (25-44) sets the coordinated Blink rescue only when the
   participants are exactly one warrior, one mage and one priest; `step` (59-97) fails to
   independent recovery when one is dead or disconnected (62-69).
3. When all three are alive at the start (for example after a `finishing` window, when
   the dead member has respawned and its `lastDeath` matches the snapshot at :38), the
   stages run Blink -> warrior -> priest -> `complete` at the Blink landing (91-96).
   `escapeLanding` (shared.js:160-188) picks the safest Town spawn, transporter or door
   offset on the current map, not Main (0,0).
4. At `complete` the character's escape pulse returns at once (shared.js:208); nothing
   walks the party further. `isOccupied` stays true while the escape owns the character
   (17516), so the role loop is idle.
5. `recover` waits for every member on `main` within 65 of (0,0) (cjs:83-89, 90-92).
   It never comes.

Steps 1, 2, 4, 5 are read from code; the condition in step 3 under which all three reach
the landing is inference. Patch: ce6e7c1a (fork) adds `strandedRescue` in party-escape
`step` (fork party-escape.cjs:100-107), which walks a completed escape that is off Main to
Main Town. The two definitions of "safe" stay (party-escape `at`/`settled` at 49-58 vs
disengagement `safe`).

### Death-fix commits on 21b8362d

| Commit | What | Spec |
|---|---|---|
| 648b3be0 | heal reservation on heal range, tick at `remaining()+1` | 03 (bug 3a) |
| dab0de01 | escape HP first below 50%; `occupiedPotion` | 05 (above) |
| d988fcbd | reflection from game data | 04 (bug 16) |
| 3365dd57, c13ff2d1, 4ce3dcdd, 2b8414cc | pull walk route reuse and stall release, arrival-hold release, hold pulls while the healer or tank is dead, spread members 30 units | 04 and 02 (bug 3c, 3d, 3f) |
| daf18964, 86eecb7f, 08c5df43 | E2E death probe (HP changes, decisions, kills by type) | 15 |

Each adds a rule beside the owner it patches: `occupiedPotion` is a sixth potion-group
writer (spec 03 table), and `pullSupported` is another pull hook.

### Patchwork in the current console

- **P1. Thresholds in six places.** Class files (mage.ts:9, priest.ts:21,
  warrior.ts:44-49), regen order (13785-13792), escape budgets (62-75), skills reserve
  (eligibility.ts:34-42), Stomp 60% (16038), disengagement 25%/50% (cjs:61, 65, 86).
- **P2. Three heal writers outside the role loop** (passive pulse 13828, escape 199/272,
  cave 2675-2679), arbitrated only by `healingBusy` (336).
- **P3. Heartbeat HP first, live HP second** (13872-13874 vs 13894-13898), so a stale
  heartbeat skips an injured member or picks a healed one.
- **P4. Two death counters**: disengagement `combatDeathSeen` (cjs:24-36) and Hunt
  `recordDeaths` (hunt-safety.cjs:49-71).
- **P5. Two "safe" definitions**: escape recovery needs alive and settled on Main within
  65 (party-escape.cjs:72-77, 85-87); disengagement also needs 50% HP and no threats
  (cjs:83-89).
- **P6. The escape role trio is hard-coded** (party-escape.cjs:28-41): a party without a
  warrior, mage and priest always falls to independent recovery.
- **P7. Respawn has two owners**: the role runner (runner.ts:341-351) and the escape
  pulse (shared.js:211-216), split by `escapeOwnsRevival` (17947).

## 3. Fork differences

- **ce6e7c1a** `strandedRescue` (bug 5).
- **8d4bcf10** MP potions up to the skill reserve plus the next class buff (fork
  `skills/potion.ts:12-16`, `classes/mp-potion.ts`), and the warrior drinks MP to that
  target (fork warrior.ts:66). Patches the 20% class floor; still no HP potion for the
  warrior.
- **ae116693** off tank handoff at `endangered` or 50% (spec 04).
- **4075d3f2** tank hold releases below 50% and returns at 80% (fork shared.js:18431-
  18433), a second 50/80 pair beside ae116693's.
- **21b8362d** death fixes above.

## 4. Tests today

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| passive-healing (14 tests) | heal ratios, partyheal, passive pulse, merchant potion | potion vs regen collision; W1 MP check | yes | some (Town channel) |
| party-escape (22) | escape stages, potion budgets, warrior defence order | stranded complete (bug 5) on the current console | yes | several |
| combat-disengagement (13) | finish thresholds, escape, safe regroup, farm return | the Blink-landing stall | yes | some |
| respawn-recovery (5) | respawn latch, event and farm rejoin | escape-owned revival | yes | yes (lost reply) |
| cave-priest-recovery (12) | revival journal and reserve | - | yes | no |
| warrior-stomp (6) | Stomp triggers and MP | - | yes | no |
| class-skills (protection tests) | paladin and priest support skills | - | yes | no |
| e2e live-hunt-*recovery specs | recovery on the test server | per-threshold assertions | not reviewed in this pass | - |

Counts: `grep -cE "^\s*test\(" scripts/tests/<file>.test.cjs` on the ref.

No test covers SRV-001 (class potion thresholds) or SRV-008 (death message); the potion
tests stub `useRecoveryPotion`. No test runs two potion-group writers together.

## 5. Needs your review

- **SRV-Q1. HP potions per class.** (a) every fighter drinks HP below 50% (one table);
  (b) per class thresholds you set (tank higher, for example 60%); (c) today's (priest
  and mage only).
- **SRV-Q2. Regen vs potions.** Regen locks potions for 4 s. (a) regen only when no
  potion threshold would trigger within those 4 s; (b) regen only out of combat; (c)
  today (regen at any missing HP).
- **SRV-Q3. Escape potion order.** (a) HP first below 50% then MP budget (21b8362d);
  (b) one table shared with SRV-Q1; (c) MP first (current).
- **SRV-Q4. When does a death end the fight?** (a) finish only when foes are at or below
  25% and survivors at or above 50% (today); (b) always escape; (c) finish while the
  healer lives.
- **SRV-Q5. Where is "safe" after an escape?** (a) Main Town (0,0) within 65 (today);
  (b) the Blink landing if no monster is near; (c) the nearest Town of the current map.
- **SRV-Q6. Parties without the warrior, mage, priest trio.** (a) everyone walks
  independently (today); (b) any class with Blink or a teleport skill leads the rescue.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, `LIMIT=100000`), filtered to this spec:
claimed by more than one spec 0, claims naming no known function 0, behaviours with no
test 2 (SRV-001, SRV-008). `catalog/05-survival.json`: 95 functions in 11 behaviours.

- SRV-001 and SRV-008 have no test. Reason: the class potion thresholds and the death
  message have no unit harness; SRV-Q1 decides the thresholds before a test is written.
- Proposed elsewhere and not claimed: the escape functions in shared.js 34-289 except
  `escapePotions`, `party-escape.cjs` (02-movement); `beginFarmReunion` (02);
  `hunt-safety.cjs` `recordDeaths`, `eventDeath` (07). Their survival rules are in the
  text above.
- Not verified: the step 3 condition of bug 5 (when all three roles reach the landing);
  fork line numbers for the tank hold and potion target come from
  review/full/combat.md, spot-checked for `tankHoldsTarget` only.

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
