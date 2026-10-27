# 03 Turns and cooldowns (TRN)

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
(local checkout)) or "21b8362d" (the death fixes in
(local checkout)). Game rules come from the server source
in (local checkout) (adventureland_mongodb
43b2c8fc; `server.js` and `server_functions.js` under `node/`, the browser client under
`js/`), the client file `runner_functions.js` of client 17175 under
`adventureland-party-console/.build/ci-fixture-tests/run-8tAVKt/17175/`, and AL MCP game
data version 18183. This spec reads the server rules from that local copy; no live-game
test has confirmed them. Claim-by-claim verification: `docs/implementation/05-verification-03-05.md`.

This part owns one question: which action spends each shared game cooldown, and
when. Targeting (what to hit) is spec 04. Survival (heals, potions, escape, death) is
spec 05; this spec maps the potion cooldown's writers because they collide here.

## 1. What it does today

### Game rules this part works under

- **Attack and heal share one cooldown.** `G.skills.heal` has `share: "attack"`
  (MCP v18183). The client's `can_heal(t)` is false for monsters and otherwise returns
  `can_attack(t)`, which needs the character not disabled, the target in range and
  `new Date() >= parent.next_skill.attack` (runner_functions.js:795-807). The client's
  `attack()` (runner_functions.js:821-829) calls `monster_attack` (js/game.js:3958-3971),
  which checks only range plus 10 and sends with no cooldown check.
- **3shot, 5shot, piercingshot, fanofknives and arcane_needle share the attack
  cooldown** (`share: "attack"` on each, MCP v18183). quickstab shares quickpunch's
  cooldown.
- **Potions and regeneration share one cooldown.** The server stores one
  `player.last.potion` for item potions (server.js:7807-7811 refuse with `not_ready`,
  7856 sets it, 2000 ms unless the item sets a cooldown) and for `regen_hp`/`regen_mp`
  (the `use` socket with `item: "hp"|"mp"`, server.js:12042-12048, fixed 4000 ms). Game
  data: `use_hp` has `cooldown_group: "potion"` and no `share`; `regen_hp` shares
  `use_hp` and `regen_mp` shares `use_mp`. The server answers both kinds with
  `pot_timeout` (server.js:7860, 12071), and the client's `pot_timeout` sets both
  `use_hp` and `use_mp` (js/functions.js:5414-5419). The client's `is_on_cooldown(skill)`
  follows the skill's `share` field and reads `parent.next_skill[...]`
  (runner_functions.js:789-793), so it changes only after a server reply.
- **`G.skills.heal` has no `mp` field** (MCP v18183, `get_game_data skills heal`). A heal
  costs the priest's `mp_cost` (server.js:3354-3356), as `eligibility.ts:5` and
  `escapeCost` (shared.js:35-39) assume. The server source has no MP check for heal: the
  only basic-attack MP check covers attack, 3shot, 5shot, fanofknives, cleave and
  shadowstrike (server.js:3357-3397, check at 3393-3396), the generic skill check needs a
  skill `mp` field (server.js:9846-9852), and `consume_mp` floors MP at 0
  (server_functions.js:3451-3453). A basic attack costs `mp_cost` and fails with
  `no_mp` below it (server.js:3393-3397).

### Loops that can spend a cooldown

| Loop | Period | Started at | Spends |
|---|---|---|---|
| Role loop `tick` -> `supportTick` | 250 ms | runner.ts:332 | potion, regen, heal, partyheal, Absorb, Taunt, Stomp, Curse, Energize, Dash, all engine skills |
| Attack controller | self-timed: `remaining()-2` ms; 100 ms once the cooldown is ready; the flight expiry while a burst is out | attack-controller.ts:51-57, 274, 282, 285 | basic attack; ranger/rogue attack skills; triggers a priest heal |
| Movement tick | 100 ms | runner.ts:339 | wakes the attack controller (runner.ts:209, 220, 235); Franky movement |
| Target timer | 1000 ms | runner.ts:334-337 | none directly; wakes the controller (runner.ts:189) |
| Loot timer | 250 ms | runner.ts:333 | none (chests) |
| Respawn timer | 250 ms | runner.ts:341-351 | `respawn()` (spec 05) |
| Passive regen pulse | 500 ms | shared.js:17368-17369 | regen, merchant potion, priest heal |
| Escape timer | 100 ms | shared.js:324-325 | potions, heal, Curse, Hardshell, Stomp, Charge, Dash, Blink, Magiport |
| Cave revival tick | inside `supportTick` | runner.ts:263-265 | heal, Revive |

### Who spends the attack cooldown

| Writer | Where | How it gets the slot |
|---|---|---|
| Basic attack burst | attack-controller.ts:162 | controller tick at `remaining()-2` (:274) or `wake` |
| Ranger/rogue attack skill | engine.ts:115-126 via attack-controller.ts:228 | inside `attackTarget`, before the burst |
| Priest heal from the controller | attack-controller.ts:70-79 -> `healPartyBelow(0.9)` | only when `basicAttackReserved()` is true |
| Priest heal from the role loop | priest.ts:17 -> shared.js:13862 | 250 ms `supportTick` |
| Priest heal from the passive pulse | shared.js:13828 | 500 ms pulse in travel and idle states |
| Priest heal from escape | shared.js:199, 272 | 100 ms escape timer |
| Priest heal for a cave grave | shared.js:2675-2679 | cave revival tick |
| A/B feed heal on an enemy | shared.js:13138 | role loop in feed mode; never reached (W1) |

Arbitration is pairwise: `healingBusy` (shared.js:336; set at 13870 and 2676) between heal
writers, `basicAttackReserved` between heal and burst, `skillBusy` between attack skill and
burst (attack-controller.ts:225). No single function decides who takes the slot at the
cooldown edge (from reading the writers above).

### Who spends the potion cooldown

| Writer | Where | Guard |
|---|---|---|
| Class `usePotion` -> `useRecoveryPotion` | runner.ts:259, shared.js:13832-13855 | client `is_on_cooldown("use_hp")` only |
| `regenerateHpOrMp` from the role loop | runner.ts:259 | `regenerationBusy` |
| `regenerateHpOrMp` from the passive pulse | shared.js:13829 | `regenerationBusy` |
| Merchant potion inside regen | shared.js:13772 | `regenerationBusy` |
| `escapePotions` | shared.js:62-75 | `local.potionBusy` |

### Behaviours

#### Role loop

- **TRN-001 Owner veto.** `tick` (runner.ts:285-304) returns without doing anything
  while `character.rip` or `sharedRoutine.isOccupied()` (runner.ts:291), so no potion,
  regen, heal or skill runs. `combatAllowed` (runner.ts:84-93) also needs
  `!isOccupied()`, so targeting and basic attacks stop too. `isOccupied`
  (shared.js:17494-17528) has its own rule inside the Cave or a dungeon run
  (17495-17496). Elsewhere it is true during upgrade previews, a console maintenance
  lease without draining combat, an event exit, a return or Hunt convoy that has not paused
  for defence, merchant tidy or lucky upgrade, travel combat without defence, Hunt
  departure loot, death recovery (not `finishing`), escape, rare patrol, loot, path or
  solo deploy, and while reunion, banking, stocking, upgrading, forced travel, Town travel,
  party Town, any undefended convoy, gathering, following the leader, event travel or
  anniversary work run (17525). A pending departure or bank queue counts only without an
  engaged monster (17526). In return mode it cancels a Town cast under attack and is true
  only while that cast runs (shared.js:17499-17502). It also has side effects: it calls
  `interruptConvoyForDefense` (17504, 17512-17514).
- **TRN-017 Support step.** `supportTick` (runner.ts:257-271) runs only while
  `supportAllowed` holds (current epoch, alive, not occupied; :130-132), rechecked after
  each await. The order is potion, else regen (runner.ts:259); class `beforeTarget`, which
  ends the tick when it acts (:261); cave revival (:263-265); class `beforeAttack` on the
  current target if the grouped and tinyp gates allow (:267-270). `tick` skips in A/B
  `pending` mode (:293), and a `working` flag stops overlapping ticks (:286-287, 302).
- **TRN-002 A/B testing feed.** In feed mode the role loop runs
  `runAbtestingSabotage` instead of support (runner.ts:294-297; shared.js:13158-13186).
  `sabotageSkill` (shared.js:13115-13156) casts raw Energize on the lowest-MP enemy while
  above 35% MP, heal on an injured enemy below 90%, or Curse on the own-team ally with the
  highest attack, each with its own `is_on_cooldown` check. Otherwise the character walks
  toward the strongest enemy or the enemy spawn (13175-13185). The heal branch needs
  `character.mp >= G.skills.heal.mp` (13134), which compares with `undefined` and is
  always false, so the feed heal never fires (W1).

#### Attack controller

- **TRN-003 Basic attack timing.** `createAttackController`
  (attack-controller.ts:32-290) reads `parent.next_skill.attack` (:40-44) and
  schedules its tick 2 ms before it ends (:274, :282, :285). At the tick it drops a
  flight for another target (:255), cancels the remaining burst slots when the target is
  no longer confirmed, combat is not allowed, or a heal or cave reservation holds (:262),
  offers the slot to a heal (:263), and returns while `remaining() > 2` or during retry
  backoff (:265-268). `attackTarget` (:220-249) skips while a flight or a skill attack is
  pending (:224-225), offers the slot to a heal again (:226), offers it to a ranger/rogue
  skill (:227-239), applies the crab block (:241), and calls `send` when the cooldown is
  ready or within 2 ms with the target in range (:244). `send` (:124-218) checks
  `permitted` (spec 04), then fires up to 5 attempts 1 ms apart, starting at once (up to
  2 ms before the deadline) and stopping at `deadline+2` (:145-146, :204-216). On the
  first accepted attempt it cancels the rest, subtracts the smallest ping from the
  cooldown with `reduce_cooldown` unless a heal went out after the send (:169-173), and
  reports the attack (:176). A cooldown rejection only counts (:183); other rejections end
  the burst (:184). A flight expires after `max(2000, 2000/frequency)` ms (:136).
  Settings: none. Magic numbers: 2 ms lead, 5 slots, 1 ms spacing, 100 ms idle tick,
  100 ms retry after a failed burst (:201).
- **TRN-004 Priest heal reservation.** `reserveHealing` (:70-79) asks
  `basicAttackReserved` (shared.js:17694-17703). For a priest it is true while
  `healingBusy`, or while any same-team living member on the map is under 90% live HP and
  `can_heal(live)` is true (:17701). The MP test at :17697 compares with
  `G.skills.heal.mp`, which does not exist, so it is always `mp < 0` and never blocks
  (finding W1 below). When true, the controller records "priest healing priority" and
  calls `healPartyBelow(0.9)` (spec 05) without awaiting it (:76-77). A cave revival
  reservation (`caveRecoveryReserved`, shared.js:17487) also holds the slot (:72-74).
- **TRN-018 Attack flight state for other owners.** `pending`, `hasStarted` and
  `engagedTargetId` (attack-controller.ts:278-280) report the flight and the last
  accepted target. Selection keeps a target with an attack started instead of switching
  to a closer Hunt target (runner.ts:168), and Cave recovery waits for an outstanding
  attack (runner.ts:263).
- **TRN-019 Passing-target attacks.** The runner lets the controller run when combat is
  allowed or a passing target exists (runner.ts:57), marks a target as passing when it is
  the passing target and not the selection (:58), and asks the queue client for the
  passing admission before the send and each attempt (:59; attack-controller.ts:126-129,
  155-157). A passing flight stays confirmed only while its target is still the passing
  target (`passingConfirmed`, :91-95). Passing selection itself is spec 04.
- **TRN-022 Rejection reasons.** `errorReason` (roles/types.ts:147-153) returns the
  rejection's `reason`, else its `message`, else the value as text. The controller counts
  `cooldown` rejections without ending the burst (attack-controller.ts:183), and the runner
  does not record them as errors (runner.ts:122-128).

#### Skill engine

- **TRN-005 Attack skills take the attack slot.** For rangers and rogues only, and not
  while the context mode is `blocked`, `engine.attack` (engine.ts:115-126) first tries the
  rogue `invis` opener (protection.ts:103-107), then `bestAttack` (offense.ts:17-23):
  piercingshot, 3shot or 5shot for a ranger, fanofknives for a rogue, with up to
  `max_targets` targets (offense.ts:5-16), chosen only when its summed useful damage
  beats a basic attack. The runner wires it as `skillAttack`, and `skillBusy` is
  `openerPending` or a pending `attack` family (engine.ts:127, runner.ts:61-62).
- **TRN-006 Engine execution.** `execute` (engine.ts:59-93) records a pending token per
  cooldown family (`share` or the skill id, :25) for 2500 ms, sends `use_skill`, races a
  2500 ms acknowledgement timeout, and on rejection or timeout blocks the skill for
  1000 ms (:86). The engine removes the token when the cast settles (:91); `world()` also drops a
  token once it has aged and its cooldown is not running (:22). `first` casts the first
  affordable choice (:96-99).
- **TRN-007 MP rules for skills.** `cost` applies `mp_reduction` and uses `mp_cost` for
  heal (eligibility.ts:4-7). `reserve` (:34-42): paladin
  `max(30% max MP, 2 selfheal + oath)`, priest `max(35%, 2 heals + partyheal)`, warrior
  Taunt (leader only) plus `max(stomp, hardshell)`, others 20%. `manaBlock` (:75-80)
  refuses a cast that would go below zero or below the reserve unless its category is
  `survival`. `affordable` (engine.ts:30-43) subtracts every pending cast's cost.
- **TRN-028 Sustained farming MP budget.** Outside events, `affordable` holds damage skills
  to a credit (engine.ts:35-41). `createManaBudget` (budget.ts:2-25) starts the credit at
  the cap (the largest affordable skill cost), then adds observed MP recovery over the
  last 30 s divided by 30 plus a thirtieth of the MP above the reserve, per second; each
  damage cast debits its cost (engine.ts:65).
- **TRN-008 Skill availability.** `unlocked` (eligibility.ts:26-33) refuses passive and
  consumable skills and checks class, level, weapon type, offhand type, slot charges and
  stat requirements; `blocked` (:64-71) adds the blocked context, leader aggro ownership
  (spec 04), the cooldown of the skill and its share family, MP and target checks.
- **TRN-009 Skill world.** `installSkillRuntime` (runtime.ts:26-122) builds a world per
  decision: actor with the effective damage type, the combat context built lazily from
  `sharedRoutine.combatContext` (shared.js:17714-17736), cooldowns from `next_skill`
  (runtime.ts:51; `invis` also blocked while merchant visibility is active),
  `damage_multiplier` or a fallback armor curve (:20-25, :52), skill range (:123-129), and
  `allowed` (TRN-020). It publishes `combatSkillReady` and `castCombatSkill` for class code
  (:107-110). The context mode is `blocked` while `isOccupied()`, live A/B testing or a
  disabled actor (shared.js:17734, runtime.ts:43), else `event`, `scatter` or `grouped`.
- **TRN-020 Skill target authorization.** `authorized` (runtime.ts:59-67) refuses a target
  under the return and Franky vetoes (TRN-010), a damage-type block except for Taunt
  (:62, spec 04), a target that `skillTargetAllowed` or `rareAttackAllowed` refuses
  (:68-70), and in scatter mode an untargeted monster whose pull would leave the caster
  under 30% HP in 2 s (:64-66).
- **TRN-010 Return mode and Franky vetoes on casts.** `castSkill` (runtime.ts:87-92)
  rejects a cast while Franky attendance holds and the skill is in `frankyExcluded`, or is
  hostile and targets anything but Franky (:81-86), or while return mode holds and the
  skill is in `returnExcluded`, or is hostile and targets a non-attacker (:71-79). Both
  lists include `agitate`, which no code casts (`git grep -n -i agitate $R` finds only
  these lists and their copies in the characters/roles.js bundle).
- **TRN-021 Queue evidence from casts.** Hostile casts report each target to the grouped
  queue as pending (engine.ts:67, 74), then engaged or rejected after the reply (`settle`
  :44-52, `rejectActions` :53-55). The report goes after the send when every target is in
  an independent pull (runtime.ts:96-101).
- **TRN-023 Skill diagnostics.** Every decision publishes skill, targets, category,
  reserve, reason and status (`selected`, `skipped`, `accepted`, `rejected`) through
  `report` (engine.ts:26-29) to `partyCombatState.skill` (runtime.ts:102).
- **TRN-011 Damage model.** `damage` (damage.ts:29-36) with crits, rogue stacks,
  armor/resistance through the world's multiplier, fortitude and `incdmgamp`;
  `usefulDamage` caps at HP left after projectiles in flight (:48-49). Without the client's
  `damage_multiplier` the world uses `mitigation` (runtime.ts:20-25).
- **TRN-027 Projectile tracker.** The runtime feeds the `action` and `hit` sockets
  (runtime.ts:111-114) to the tracker, which counts ally projectiles toward known targets
  at 90% of mitigated damage until hit or ETA (projectiles.ts:8-33).
- **TRN-012 Damage skills.** From class `beforeAttack` (ranger.ts:3, rogue.ts:4,
  paladin.ts:4) through `skillOffense` (runtime.ts:105) and `engine.offense`
  (engine.ts:111-114): ranger huntersmark and supershot, rogue mentalburst, quickstab,
  quickpunch, paladin purify, shield_slam, smash, scored by useful damage per MP (or per
  cooldown second in events) (offense.ts:43-57). huntersmark always ranks first and
  mentalburst ranks first when it kills (:51-52). huntersmark goes to the alphabetically
  first ranger in range with MP (:37-42).
- **TRN-024 Support skill choice.** `support` (engine.ts:104-110) picks `paladinSupport`,
  `rogueSupport` or `combatBuffSupport`, holds a paladin aura change for 10 s
  (`recordAura` :56-58), and casts the first affordable choice. The runtime publishes it as
  `skillSupport` (runtime.ts:104).
- **TRN-013 Maintenance buffs.** The paladin and rogue `beforeTarget` call `skillSupport`
  (paladin.ts:3, rogue.ts:3), and so do the warrior and priest after their own steps
  (warrior.ts:20, priest.ts:18). Paladin: the list puts selfheal, shields, cleanse, oath
  and beacon (spec 05 SRV-006) ahead of the aura, chosen by party threat type
  (protection.ts:66-88). Rogue: rspeed from the alphabetically first rogue of level 40 or
  more (:89-95). Warrior warcry and priest darkblessing when not active (:96-102). The
  warrior `beforeTarget` runs the emergency Stomp first unless Franky holds
  (warrior.ts:18-21, spec 05).
- **TRN-025 Absorb entry.** The priest `beforeTarget` calls `absorbSinsBelow`
  (priest.ts:16; shared.js:13857-13860), which runs `absorbLeaderAggro` (runtime.ts:106)
  and `engine.absorb` (engine.ts:103) on `absorbDecision` (spec 04 TGT-015).

#### Raw class casts outside the engine

- **TRN-014 Priest Curse.** `beforeAttack` (priest.ts:23-32): not in scatter, MP above
  50%, party at or above 90% heartbeat HP (`isPartyHealthy`, shared.js:13977-13986),
  target is a party target, not tinyp, not cursed. The code means to use the engine
  (`combatSkillReady`, `castCombatSkill`, category `damage`) unless A/B testing is live
  (:5, :29), but it tests `!sharedRoutine.getAbtestingMode()`, and `abtestingMode`
  returns `"none"` outside A/B (shared.js:13109-13113, 17566). The test is always false,
  so production always takes the raw path: `legacyCurseReady` (:8-11) and a raw
  `use_skill` (:30). Finding W3.
- **TRN-015 Mage Energize.** `beforeAttack` (mage.ts:5-7) calls `energizeLowestMana(0.35)`
  (shared.js:13922-13952): keeps 35% MP, gives the lowest-MP party member in range 20% of
  its missing MP (or 1 MP when every candidate is at 60% or more) with a raw `use_skill`.
- **TRN-016 Warrior Stomp.** In scatter mode `scatterAttack` (warrior-combat.ts:24-30)
  casts raw Stomp when two or more monsters of the target's type, the target included,
  are within Stomp range and `canStomp` holds (basher equipped, Graveyard area allowed,
  MP at least 25% and at least Stomp's cost, cooldown ready; :7-13). Otherwise it calls
  `approach` (TRN-026).
- **TRN-026 Warrior Dash.** In scatter mode after TRN-016, and in normal mode after an
  optional Taunt, `approach` (warrior-combat.ts:21-23) Dashes toward an out-of-range target
  (`dashToward`, shared.js:13954-13975): warrior, MP at least 50% and at least Dash's cost,
  not Franky, not in grouped farming with a priest in the formation, endpoint 40 units in a
  cardinal direction, outside desired range and safe. Raw `use_skill` (:13973).

### Settings that change this part

None of the thresholds above are settings. The farming mode (`scatter` or default)
switches TRN-014, TRN-016 and TRN-026, and the A/B mode switches TRN-002. Events switch
the damage budget off (engine.ts:39) and change damage scoring to per cooldown second
(offense.ts:53).

### Added in triage

catalog/triage-log.json lists each behaviour in this group. TRN-017 came from triage and
is now described under "Role loop" above.

## 2. What goes wrong

### Bug 3a (ledger 3): priest basic attacks starve its heals

Causal chain on b9b5c91e:

1. The controller schedules its next tick 2 ms before the attack cooldown ends
   (attack-controller.ts:274; after a burst `finish` does the same, :202).
2. At that tick `reserveHealing` (:263) asks `basicAttackReserved`, which needs
   `can_heal(live)` (shared.js:17701). `can_heal` is `can_attack`, true only once
   `now >= next_skill.attack` (runner_functions.js:795-807). It is 2 ms early, so the
   reservation is false.
3. `remaining()` is at most 2 (:265), so `attackTarget` runs; `reserveHealing` is false
   again (:226); `send` fires because `remaining() <= 2` counts as ready (:244).
4. The burst sends its first attempt at once and then every 1 ms until 2 ms past the
   deadline (:145-146, :205-216), and each attempt rechecks the reservation (:149) with
   the same early `can_heal`. The first accepted attack restarts the cooldown and step 1
   repeats.
5. The role loop's heal (priest.ts:17, every 250 ms) only lands when it happens to read
   `can_heal(member)` true (shared.js:13897) in a gap the controller left.

Result: under steady attack the priest spends the shared slot on basic attacks while
members are below 90%. Measured on the fork: "127 of 127 priest attacks under 90% HP went
out 1 ms early with the reservation false" (commit message of 648b3be0 on 21b8362d; the
probe data is not in this repo).

Patch: 648b3be0 (21b8362d) replaces `can_heal` with `is_in_range(live, "heal")` and
reschedules the tick to `remaining()+1` when a heal is due. This removes steps 2 to 4 for
the controller path. Left in place: the heal decision is still a predicate the attack
owner reads, and `healPartyBelow` filters by heartbeat HP first (shared.js:13872-13874)
while the reservation reads live HP, so a reserved slot can end with no heal
(inference: neither attack nor heal on that cycle).

### W1: three priest MP checks compare with a value that does not exist

`basicAttackReserved` returns false when `character.mp < G.skills.heal.mp`
(shared.js:17697), and `healPartyBelow` stops when `character.mp < G.skills.heal.mp`
(13893). `G.skills.heal` has no `mp` field (MCP v18183), so both compare with 0 and never
trigger. The A/B feed heal needs `character.mp >= G.skills.heal.mp` (13134), which is
`mp >= undefined` and always false, so that heal never fires. The local server source
does not check MP for heal and floors MP at 0 (see Game rules), so a priest under
`mp_cost` still heals there. The two `<` checks are dead code, not a cause of refused
heals.

### W3: the priest Curse never uses the engine

`priest.ts:5` and `:29` choose the engine only when `!sharedRoutine.getAbtestingMode()`.
`getAbtestingMode` is `abtestingMode` (shared.js:17566), which returns `"none"`,
`"pending"`, `"feed"` or the strategy mode (13109-13113), never an empty value. So Curse
always takes `legacyCurseReady` and a raw `use_skill` (priest.ts:8-11, 30), outside the
engine's reserve, pending ledger and damage budget. The unit tests hide this: their
stubs return `null` or `''` from `getAbtestingMode` (combat-movement.test.cjs:15,
priest-formation.test.cjs:512, 665, merchant-events.test.cjs:74).

### Reverted MP reserve for basic attacks (b03f0855 removed by b989128a)

1. b03f0855 (2026-09-22, "fix: preserve passive hunt movement and mana reserves") added
   a `reserveMana` port to `attemptOnce`: an attack that would cut into the class
   survival MP floor was skipped with `skippedAttack = "survival MP reserved"`, settled
   on ack or timeout (`git show b03f0855 -- runtime/characters/roles/attack-controller.ts`),
   with `skills/spending.ts` and `recipient-service.ts`.
2. b989128a (2026-09-25, "Resolve PR integration in favor of latest workspace code")
   deleted `spending.ts`, `recipient-service.ts`, the port and the CHANGELOG line
   (`git show b989128a --stat`).
3. At the ref only skills honour the reserve (`manaBlock`, eligibility.ts:75-80). Basic
   attacks cost the attacker's `mp_cost` and fail with `no_mp` below it
   (server.js:3393-3397) and have no floor. The only priest guard is W1's check, which
   never fires.

Outcome: a priest farming hard spends MP on basic attacks that the reserve was meant to
keep for its skills. Heal itself does not need the MP on the local server source (W1);
partyheal (400 MP in game data) and Curse (400 MP) do, through the generic skill check
(server.js:9846-9852). Neither commit says whether the removal was intended (`git log -S
reserveMana $R` shows only these two commits); question TRN-Q2.

### Bug 13 (ledger 13): "Recovery failed: not_ready"

1. Two potion-group writers can send inside one round trip: the role loop's
   `useRecoveryPotion` (runner.ts:259) and the passive pulse's regen
   (shared.js:13829), which runs when `passiveRegenerationEligible` holds, including
   `character.moving && !engagedMonster()` (13820) while the role loop is also running.
   During escape stages `complete` and `failed-hold`, `escapePotions` (shared.js:195) and
   the passive regen (13813, 13762) both run.
2. Each checks only the client cooldown (`is_on_cooldown`, shared.js:13794, 13834, 70),
   which follows `next_skill.use_hp` and updates after the server reply
   (runner_functions.js:789-793). `regenerationBusy` covers only the regen calls;
   `potionBusy` only escape potions.
3. The server refuses the second with `not_ready` (server.js:12045 for regen,
   7810 for item potions).
4. `regenerateHpOrMp` logs every reason except `cooldown` and `no_mp` as
   "Recovery failed: <reason>" (13802-13803); `useRecoveryPotion` logs "Potion failed:
   not_ready" (13851-13852).

Not patched. The second half of ledger 13 ("Paused for combat event" instead of "select
Hunt again") is Hunt status text, and this spec hands it to spec 07 (runtime/coordinator/hunt/travel.ts:24
writes "Paused for combat event"; convoy.ts:33 and recovery.ts:175 write "select Hunt
again to resume").

### Other patchwork in this part

- **P1. Five MP floors outside the engine.** Stomp 25% (warrior-combat.ts:11), Dash 50%
  (shared.js:13958), Energize 35% (shared.js:13925, mage.ts:6), Curse 50% (priest.ts:25),
  A/B Energize 35% (shared.js:13116). The engine's reserve (eligibility.ts:34-42) applies
  to none of them.
- **P2. Raw casts bypass the pending ledger.** Stomp (warrior-combat.ts:26), Dash
  (shared.js:13973), Energize (13948), partyheal (13885), A/B casts, escape casts, the
  Curse path (priest.ts:30, every Curse because of W3) and the Taunt fallback without an
  engine (warrior.ts:6) call `use_skill` directly, so the engine's in-flight MP sum
  (engine.ts:31) does not see them.
- **P3. Cooldown checked by four different tests.** `is_on_cooldown` (client),
  `next_skill` read directly (runtime.ts:51, attack-controller.ts:40-44), `can_use`
  (Stomp warrior-combat.ts:12, Dash shared.js:13959, Energize 13927), and
  `can_heal`/`can_attack` (shared.js:17701, 13897; attack-controller.ts:223, 244).
- **P4. `isOccupied` is a veto of 13 early returns plus a 12-term check, with side
  effects** (shared.js:17494-17528, counted by reading the function): reading it can
  interrupt a convoy (17504, 17514) and cancel a Town cast (17500).
- **P5. Agitate is listed in three gates but never cast** (eligibility.ts:73,
  runtime.ts:71, 81).

## 3. Fork differences

- **648b3be0 (21b8362d)** heal reservation on heal range plus `remaining()+1` tick (bug
  3a). Adds `scripts/tests/priest-heal-reservation.test.cjs` and a combat-movement test.
- **dab0de01 (21b8362d)** `occupiedPotion` in the role tick (21b8362d runner.ts:291-294,
  302): an HP potion below 50% while `isOccupied` holds. A sixth potion-group writer,
  guarded only by the client cooldown, so it can collide with regen or escape potions
  (spec 05). Adds `scripts/tests/emergency-potions.test.cjs`.
- **8d4bcf10 (fork)** MP potion target = skill reserve plus the next class buff
  (`skills/potion.ts:12-16`, `classes/mp-potion.ts`, fork only; mage, priest and warrior
  use it). Patches the 20% class floor.
- **7bd14d7c (fork)** moves the warrior Taunt reserve and `ownsAggro` from the leader to
  the designated tank (fork eligibility.ts:40, :81). **ae116693 (fork)** swaps the
  context's tank to the off tank during a handoff (fork runtime.ts, `offTankActive`).
  **4075d3f2 (fork)** adds an area-pull block to the aggro gate (fork eligibility.ts
  `aggroBlock`, `skills/aggro-pull.ts`). Spec 04 covers aggro.
- **62ab06e5 and follow-ups (fork)** pull mode fires a raw `attack(target)` from the
  movement tick when `can_attack` is true (fork shared.js:18517, inside
  `pullMovementTick`, called from `recoverFarmApproach` at fork shared.js:16944), outside
  the controller, the heal reservation and `permitted`.
- **d6f67a97 (fork)** Franky partyheal spam: raw partyheal on cooldown at Franky (fork
  priest.ts:17-19, shared.js:14754-14763).

## 4. Tests today

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| combat-movement::burst sends one immediate and four interval attempts... | 5-slot burst, ping compensation | real cooldown edge vs heal | yes | no |
| combat-movement::healing reserves basic attack without stopping movement... | controller obeys a stubbed `basicAttackReserved` | the predicate itself; the `can_heal` edge (bug 3a) | yes for what it stubs | yes (stub) |
| combat-movement::healing reservation cancels remaining burst slots | slot cancel | predicate | yes | yes |
| class-skills::attack controller sends a skill once and does not race it with a basic attack | `skillBusy` arbitration | heal vs skill | yes | no |
| class-skills::MP cost reductions, pending reservations, and survival exceptions | reserve and pending sum | raw casts (P2) | yes | no |
| class-skills::multiple pending cooldown families cannot spend the same MP | ledger | raw casts | yes | no |
| skill-context-builds (5 tests) | lazy context build | none of the cooldown rules | yes | efficiency only |
| franky-combat::skill runtime restricts offensive and area casts... | Franky veto | return-mode veto | yes | no |
| combat-movement::Dash cannot overshoot the weapon range boundary | Dash endpoint vs weapon range | MP floor, grouped-priest rule | yes | no |
| passive-healing::no heal when dead, out of mana, on cooldown, stale-full, or an ordinary combat pulse | heal skips when MP is under a fixture `heal.mp` of 10 (passive-healing.test.cjs:20) | real game data, where heal has no `mp` (W1) | no for the MP case | no |
| e2e live specs | none target cooldown ownership | - | - | - |

Counts: `grep -cE "^\s*test\(" scripts/tests/<file>.test.cjs` on the ref (skill-context-builds
5, class-skills 25, combat-movement 36, franky-combat 5).

No test covers TRN-002 (A/B feed casts), TRN-014 (Curse), TRN-015 (Energize), TRN-016
(Stomp in scatter mode) or TRN-023 (skill diagnostics) directly. combat-movement stubs
`energizeLowestMana` (combat-movement.test.cjs:499, 567); passive-healing loads the code
from `regenerateHpOrMp` up to `energizeLowestMana` and so leaves it out
(passive-healing.test.cjs:6). No test exercises two potion-group writers together (bug 13).
The test stubs of `getAbtestingMode` return `null` or `''`, which hides W3. No test
checks the return-mode skill veto.

## 5. Needs your review

### Decided 2026-10-26

These decisions replace any working assumption or recommendation for the same item elsewhere in this document.

- **A7** (TRN-Q1: priest heal or attack when someone is hurt; decided by your answer): The priest heals first when anyone is below a per-character setting, default 80% HP.
- **A8** (TRN-Q2: a priest MP floor for basic attacks; decided by your answer): The priest keeps basic attacking while its MP still covers the heals the party needs, worked out from heal costs in game data.
- **A36** (TRN-Q3: Stomp, Dash, Energize, Curse and partyheal MP rules; decided by the plan): These skills move into the main skill system and share its MP reserve; the test checks that each class still casts them and keeps its reserve, with no cast-rate pass mark (B13).
- **A37** (TRN-Q4: Agitate; decided by the plan): Nothing casts Agitate, as today.


- **TRN-Q1. Who wins the attack slot when a member is hurt?**
  **Today:** The current console means to give the slot to a heal when any member is under
  90% live HP (`basicAttackReserved`, shared.js:17694-17703), but the check runs 2 ms
  before `can_heal` can be true, so the basic attack wins (bug 3a). On 21b8362d the heal
  wins whenever an injured member is in heal range (648b3be0).
  **Options:**
  (a) The heal wins whenever anyone is under 90% (21b8362d). Negatives: the priest deals
  no damage while anyone is slightly hurt; a heal at 89% overheals.
  (b) The heal wins only under a lower threshold, for example 70%; above it the role loop
  heals in the gaps. Negatives: bug 3a shows the gaps rarely come under steady attack, so
  members between 70% and 90% get few heals; it adds a second threshold beside the 90%
  role-loop rule.
  (c) The heal wins for the tank only; others wait for the role loop. Negatives: a mage or
  ranger under attack gets heals only in the gaps; needs a tank setting the current
  console does not have.
  **Recommendation:** (a). It matches the current console's intent and the 21b8362d
  patch. Heal and attack share one cooldown, so every heal costs one attack under any
  option. (b) and (c) depend on role-loop gaps that the 127 of 127 measurement shows do
  not come. Negatives: lower priest damage while members are slightly hurt, and the
  heartbeat-first filter in `healPartyBelow` (bug 3a "left in place") can still waste a
  reserved slot. Proof: a ChronAL E2E scenario with a priest under steady attack and an
  injured member in heal range; measure: priest basic attacks while a party member is
  under 90% HP and in heal range; threshold: 0. The fork's
  `priest-heal-reservation.test.cjs` is a unit test added with the patch, so it is not
  this proof (AGENTS.md: no unit tests written after the code).
- **TRN-Q2. Should basic attacks keep an MP floor?**
  **Today:** no floor; b989128a removed b03f0855's rule (bug section above). Skills keep
  the class reserve (eligibility.ts:34-42, 75-80). On the local server source heal works
  at any MP, while partyheal and Curse need 400 MP (server.js:9846-9852).
  **Options:**
  (a) Restore b03f0855 for every class: skip a basic attack that would cut into the class
  reserve. Negatives: classes on the 20% default reserve stop attacking earlier; one more
  rule in the attack path.
  (b) Priest only, using the priest reserve `max(35%, 2 heals + partyheal)`. Negatives: the
  priest deals less damage on long fights; other classes keep spending MP that their
  skills could use.
  (c) No floor (today). Negatives: a priest can reach the fight's end with no MP for
  partyheal or Curse, and with too little for the escape budget (shared.js:69).
  **Recommendation:** (b). The priest is the class whose reserved skills (partyheal,
  Absorb, Curse) protect the whole party, and its basic attacks are its least useful
  spend. It costs less than (a), which slows every class for a reserve most of them only
  spend on their own damage skills, and it fixes what (c) leaves open. Negatives: priest
  damage drops on long fights, and the value of the floor rests on the server rule that
  heal needs no MP, read from the local source and not tested live. A ChronAL E2E scenario
  in which a priest below `mp_cost` casts heal confirms that rule before the floor ships.
- **TRN-Q3. Raw casts with their own MP floors (P1, P2).**
  **Today:** Stomp, Dash, Energize, partyheal, the A/B casts, the escape casts and every
  Curse (W3) call `use_skill` directly, each with its own floor or none, outside the
  engine's pending ledger (engine.ts:31) and reserve.
  **Options:**
  (a) Move Stomp, Dash, Energize, Curse and partyheal through the engine and its reserve.
  Negatives: cast rates change (for example Energize would follow the 20% default reserve
  instead of 35%), and each skill needs a category (`survival`, `damage`, `maintenance`)
  that decides whether the reserve and the damage budget apply; tests that stub these casts
  need rewriting.
  (b) Keep their floors but register them as pending in the engine ledger. Negatives: two
  sets of MP rules stay; every raw cast needs a ledger hook, and W3 shows a second path can
  break without any test noticing.
  (c) Leave as is. Negatives: in-flight MP is double-counted, P1 and P2 stay, and Curse
  stays on its legacy path.
  **Recommendation:** (a) for the combat casts, keeping the escape casts on their own
  budget until spec 05 decides escape. One ledger and one reserve remove P1 and P2, and
  W3 shows the dual path already failed silently, which (b) keeps. Negatives: changed
  cast rates need a ChronAL E2E scenario per class that measures casts per minute before
  and after on the same fixed setup, and the category choice per skill is a new decision.
- **TRN-Q4. Agitate.**
  **Today:** `agitate` sits in the aggro, return and Franky gates (eligibility.ts:73,
  runtime.ts:71, 81); no code casts it.
  **Options:**
  (a) Drop it from the gates. Negatives: a later Agitate caster needs the gates back;
  without them it bypasses the leader rule and the return and Franky vetoes.
  (b) Add an Agitate caster for the warrior. Negatives: Agitate taunts every nearby monster
  (game data), so it needs pull-safety rules (the fork's area-pull block in 4075d3f2 is one
  attempt); new behaviour to design and test.
  (c) Keep the entries and add no caster (today). Negatives: dead entries mislead readers.
  **Recommendation:** (c). The entries cost nothing at run time and are already the right
  guards if (b) is ever chosen, while (a) removes them for no gain. Negatives: the lists
  name a skill nothing casts, so they need a comment saying they are guards.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, run from the plan root with `LIMIT=100000`),
filtered to this spec: claimed by more than one spec 0, claims naming no known function
0, behaviours with no test 5 (TRN-002, TRN-014, TRN-015, TRN-016, TRN-023). All specs
together: 9421 functions, 0 unclaimed. Function count from
`catalog/03-turns-and-cooldowns.json`: 149 functions in 28 behaviours (TRN-001 to
TRN-017 plus the splits TRN-018 to TRN-028).

- TRN-002, TRN-014, TRN-015 and TRN-016 have no test. Reason: each is a raw class cast with
  no unit harness. M1 decides whether they move into the engine (TRN-Q3). Their proof is a
  ChronAL E2E scenario per class that counts each cast against its MP floor on a fixed
  setup, not a new unit harness (AGENTS.md: E2E first). TRN-023 (skill diagnostics) has no
  test.
- Functions of this part claimed by other specs: the role runner body, `start` and `stop`
  (13-lifecycle LIF-025); the escape pulses `escapePulse`, `escapeReady`, `escapeUse`
  (02-movement MOV-036), `escapeCharge`, `escapeWarriorDefense` (MOV-038) and
  `escapeSurvivalPulse` (05-survival); the passive regen timer inside `sharedRoutine.start`
  (`start@17351`, 13-lifecycle LIF-022). `supportTick` and `tick` are claimed here
  (TRN-017). The behaviour text above covers them.
- Not tested in the live game: the server rules above come from the local server source
  (43b2c8fc), in particular that heal has no MP check.
