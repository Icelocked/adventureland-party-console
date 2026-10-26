# 03 Turns and cooldowns (TRN)

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
(local checkout)) or "21b8362d" (the death fixes in
(local checkout)). Game rules come from the server source
in (local checkout) (adventureland_mongodb
43b2c8fc), the client file `runner_functions.js` of client 17175 under
`adventureland-party-console/.build/ci-fixture-tests/run-8tAVKt/17175/`, and AL MCP game
data version 18183.

This part owns one question: which action spends each shared game cooldown, and
when. Targeting (what to hit) is spec 04. Survival (heals, potions, escape, death) is
spec 05; this spec maps the potion cooldown's writers because they collide here.

## 1. What it does today

### Game rules this part works under

- **Attack and heal share one cooldown.** `G.skills.heal` has `share: "attack"`
  (MCP v18183). The client's `can_heal(t)` returns `can_attack(t)`, which is true only
  when `new Date() >= parent.next_skill.attack` (runner_functions.js:795-807). The
  client's `attack()` itself sends without a cooldown check (al-server js/game.js
  3958-3971, per review/full/combat.md N1; not re-read in this pass).
- **3shot, 5shot, piercingshot and fanofknives share the attack cooldown** too
  (review/full/combat.md 2.1, citing runner_functions.js:795-807; inference from the
  `share` field, not re-read per skill in this pass).
- **Potions and regeneration share one cooldown.** The server stores one
  `player.last.potion` for item potions (server.js:7807-7811 refuse with `not_ready`,
  7856 sets it) and for `regen_hp`/`regen_mp` (the `use` socket with `item: "hp"|"mp"`,
  server.js:12042-12048, fixed 4000 ms). The client's `is_on_cooldown(skill)` follows
  the skill's `share` field and reads `parent.next_skill[...]` (runner_functions.js:
  789-793), which updates only after a server reply.
- **`G.skills.heal` has no `mp` field** (MCP v18183, `get_game_data skills heal`). A heal
  costs the priest's `mp_cost`, as `eligibility.ts:5` and `escapeCost`
  (shared.js:35-39) assume.

### Loops that can spend a cooldown

| Loop | Period | Started at | Spends |
|---|---|---|---|
| Role loop `tick` -> `supportTick` | 250 ms | runner.ts:332 | potion, regen, heal, partyheal, Absorb, Taunt, Stomp, Curse, Energize, Dash, all engine skills |
| Attack controller | self-timed: `remaining()-2` ms, or 100 ms when idle | attack-controller.ts:51-57, 274, 282 | basic attack; ranger/rogue attack skills; triggers a priest heal |
| Movement tick | 100 ms | runner.ts:339 | wakes the attack controller (runner.ts:235); Franky movement |
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
| A/B feed heal on an enemy | shared.js:13138 | role loop in feed mode |

Arbitration is pairwise: `healingBusy` (shared.js:336) between heal writers,
`basicAttackReserved` between heal and burst, `skillBusy` between attack skill and
burst (attack-controller.ts:225). Nothing owns the cooldown edge.

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

- **TRN-001 Role loop gate.** `tick` (runner.ts:285-304) returns without doing anything
  while `character.rip` or `sharedRoutine.isOccupied()` (runner.ts:291), so no potion,
  regen, heal or skill runs. `isOccupied` (shared.js:17494-17528) is true during
  upgrade previews, a console maintenance lease without draining combat, an event exit,
  a convoy that has not paused for defence, merchant tidy or lucky upgrade, travel
  combat without defence, Hunt departure loot, death recovery (not `finishing`), escape,
  rare patrol/loot, and while reunion, banking, stocking, upgrading, forced travel, Town
  travel, Town, gathering, following the leader or event travel run. In return mode it
  cancels a Town cast under attack and is true only while that cast runs
  (shared.js:17499-17502). It also has side effects: it calls
  `interruptConvoyForDefense` (17504, 17512-17514). The order of the support step is
  potion, else regen (runner.ts:259); class `beforeTarget` (:261); cave revival
  (:263-265); class `beforeAttack` on the current target if grouped and tinyp gates
  allow (:267-270).
- **TRN-002 A/B testing feed.** In feed mode the role loop runs
  `runAbtestingSabotage` instead of support (runner.ts:294-297). `sabotageSkill`
  (shared.js:13115-13156) casts raw Energize above 35% MP, heal on an injured enemy
  below 90%, or Curse on an own-team ally, each with its own `is_on_cooldown` check.

#### Attack controller

- **TRN-003 Basic attack timing.** `createAttackController`
  (attack-controller.ts:32-290) reads `parent.next_skill.attack` (:40-44) and
  schedules its tick 2 ms before it ends (:274, :282, :285). At the tick it drops a
  flight for another target (:255), cancels a flight when the target is no longer
  confirmed, combat is not allowed, or a heal/cave reservation holds (:262), offers the
  slot to a heal (:263), and returns while `remaining() > 2` or during retry backoff
  (:265-268). `attackTarget` (:220-249) skips while a flight or a skill attack is
  pending, offers the slot to a ranger/rogue skill (:227-239), applies the crab block
  (:241), and calls `send` when the cooldown is ready or within 2 ms (:244). `send`
  (:124-218) checks `permitted` (spec 04), then fires up to 5 attempts 1 ms apart from
  the deadline to `deadline+2` (:145-146, :204-216). On the first accepted attempt it
  cancels the rest, subtracts the smallest ping from the cooldown with
  `reduce_cooldown` unless a heal went out after the send (:169-173), and reports the
  attack (:176). A cooldown rejection only counts (:183); other rejections end the
  burst (:184). A flight expires after `max(2000, 2000/frequency)` ms (:136).
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

#### Skill engine

- **TRN-005 Attack skills take the attack slot.** For rangers and rogues only,
  `engine.attack` (engine.ts:115-126) first tries the rogue `invis` opener
  (protection.ts:103-107), then `bestAttack` (offense.ts:17-23): piercingshot, 3shot,
  5shot or fanofknives with up to `max_targets` targets (offense.ts:5-16), chosen only
  when its summed useful damage beats a basic attack. The runner wires it as
  `skillAttack`, and `skillBusy` is `openerPending` or a pending `attack` family
  (engine.ts:127, runner.ts:61-62).
- **TRN-006 Engine execution.** `execute` (engine.ts:59-93) records a pending token per
  cooldown family (`share` or the skill id, :25) for 2500 ms, sends `use_skill`, races a
  2500 ms acknowledgement timeout, settles queue evidence per accepted target (:44-52),
  and on rejection blocks the skill for 1000 ms (:86). `world()` drops pending tokens
  once the cooldown has started and the token aged (:22). `first` casts the first
  affordable choice (:96-99). `support` picks paladin, rogue or the warrior/priest buff
  list and holds paladin aura changes for 10 s (:104-110).
- **TRN-007 MP rules for skills.** `cost` applies `mp_reduction` and uses `mp_cost` for
  heal (eligibility.ts:4-7). `reserve` (:34-42): paladin
  `max(30% max MP, 2 selfheal + oath)`, priest `max(35%, 2 heals + partyheal)`, warrior
  Taunt (leader only) plus `max(stomp, hardshell)`, others 20%. `manaBlock` (:75-80)
  refuses a cast that would go below zero or below the reserve unless its category is
  `survival`. `affordable` (engine.ts:30-43) subtracts every pending cast's cost and,
  outside events, holds damage skills to a credit budget earned from observed MP
  recovery over 30 s (budget.ts:2-25).
- **TRN-008 Skill availability.** `unlocked` (eligibility.ts:26-33) checks class,
  level, weapon type, offhand type, slot charges and stat requirements; `blocked`
  (:64-71) adds the blocked context, leader aggro ownership (spec 04), the cooldown of the
  skill and its share family, MP and target checks.
- **TRN-009 Skill world.** `installSkillRuntime` (runtime.ts:26-122) builds a world per
  decision: actor with the effective damage type, the combat context built lazily from
  `sharedRoutine.combatContext` (shared.js:17714-17736), cooldowns from `next_skill`
  (runtime.ts:51; `invis` also blocked while merchant visibility is active),
  `damage_multiplier` or a fallback armor curve (:20-25), skill range (:123-129), and
  `authorized` (spec 04). It publishes `skillSupport`, `skillOffense`,
  `absorbLeaderAggro`, `combatSkillReady` and `castCombatSkill` on `sharedRoutine`
  (:104-110) and tracks projectiles from the `action`/`hit` sockets (:111-114). The
  context mode is `blocked` while `isOccupied()` or A/B testing, `event`, `scatter` or
  `grouped` (shared.js:17734).
- **TRN-010 Return mode and Franky vetoes on casts.** `castSkill` (runtime.ts:87-92)
  rejects a cast while Franky attendance holds and the skill is in
  `frankyExcluded` or targets anything but Franky (:81-86), or while return mode holds and
  the skill is in `returnExcluded` or targets a non-attacker (:71-79). Both lists include
  `agitate`, which no code casts (review C17).
- **TRN-011 Damage model.** `damage` (damage.ts:29-36) with crits, rogue stacks,
  armor/resistance through the world's multiplier, fortitude and `incdmgamp`;
  `usefulDamage` caps at HP left after projectiles in flight (:48-49). The projectile
  tracker counts ally projectiles toward known targets at 90% of mitigated damage until
  hit or ETA (projectiles.ts:8-33).
- **TRN-012 Damage skills.** From class `beforeAttack` (ranger.ts:3, rogue.ts:4,
  paladin.ts:4) through `engine.offense`: ranger huntersmark and supershot, rogue
  mentalburst, quickstab, quickpunch, paladin purify, shield_slam, smash, scored by
  useful damage per MP (or per cooldown second in events) (offense.ts:43-57).
  huntersmark goes to the alphabetically first ranger in range with MP (:37-42).
- **TRN-013 Maintenance buffs.** From `beforeTarget`: paladin aura by party threat type
  (protection.ts:66-84), rogue rspeed from the first rogue by name (:89-95), warrior
  warcry and priest darkblessing when not active (:96-102). Warrior `beforeTarget` runs
  the emergency Stomp first (warrior.ts:18-21, spec 05).

#### Raw class casts outside the engine

- **TRN-014 Priest Curse.** `beforeAttack` (priest.ts:23-32): not in scatter, MP above
  50%, party at or above 90% heartbeat HP, target is a party target, not tinyp, not
  cursed; then the engine (`castCombatSkill`, category `damage`) or a raw `use_skill`
  when the engine is missing or A/B testing is live (:29-30, :8-11).
- **TRN-015 Mage Energize.** `beforeAttack` (mage.ts:5-7) calls `energizeLowestMana(0.35)`
  (shared.js:13922-13952): keeps 35% MP, gives the lowest-MP ally in range 20% of its
  missing MP (or 1 MP when everyone is at 60% or more) with a raw `use_skill`.
- **TRN-016 Warrior Stomp and Dash.** In scatter mode `scatterAttack`
  (warrior-combat.ts:24-30) casts raw Stomp when two or more monsters of the target's
  type are within Stomp range and `canStomp` holds (basher equipped, Graveyard area
  allowed, MP at least 25%, cooldown ready; :7-13). Otherwise and in normal mode it Dashes
  toward an out-of-range target (`approach`, :21-23 -> `dashToward`,
  shared.js:13954-13975): MP at least 50%, not Franky, not in grouped farming with a
  priest, endpoint 40 units in a cardinal direction, outside desired range and safe.

### Settings that change this part

None of the thresholds above are settings. The farming mode (`scatter` or default)
switches TRN-014 and TRN-016, and the A/B mode switches TRN-002. Events switch the damage
budget off (engine.ts:39).

### Added in triage

catalog/triage-log.json lists each behaviour in this group.

- **TRN-017** Role runner support loop: unless dead, occupied or in A/B pending or feed mode, each tick drinks a potion or regenerates, runs beforeTarget, Cave recovery, then beforeAttack on an allowed target; an epoch fences stale ticks. Code: `runtime/characters/roles/runner.ts`.

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
4. The burst probes from the deadline every 1 ms (:145-146, :205-216), and each attempt
   rechecks the reservation (:149) with the same early `can_heal`. The first accepted
   attack restarts the cooldown and step 1 repeats.
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

### W1: the priest MP checks compare with a value that does not exist

`basicAttackReserved` returns false when `character.mp < G.skills.heal.mp`
(shared.js:17697), and `healPartyBelow` stops when `character.mp < G.skills.heal.mp`
(13893). `G.skills.heal` has no `mp` field (MCP v18183), so both compare with 0 and never
trigger. A priest under `mp_cost` keeps reserving the slot and keeps calling `heal`, which
the server refuses for MP. Inference: the priest then neither attacks nor heals until MP
regenerates. This corrects review/full/combat.md 6.1, which says the reservation "returns
false once the priest's MP is below one heal's cost".

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
   attacks, which cost the attacker's `mp_cost` times the skill multiplier and fail with
   `no_mp` below it (server.js:3388-3397; heal also costs `mp_cost`, 3354-3356), have no
   floor. The only priest guard is W1's
   check, which never fires.

Outcome: a priest farming hard spends MP on basic attacks that the reserve was meant to
keep for heals. Whether the removal was intended is unknown (no later commit restores
it); question TRN-Q2.

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
Hunt again") is Hunt status text: handed to spec 07 (runtime/coordinator/hunt/travel.ts,
recovery.ts per review C38).

### Other patchwork in this part

- **P1. Five MP floors outside the engine.** Stomp 25% (warrior-combat.ts:11), Dash 50%
  (shared.js:13958), Energize 35% (shared.js:13925, mage.ts:6), Curse 50% (priest.ts:25),
  A/B Energize 35% (shared.js:13116). The engine's reserve (eligibility.ts:34-42) applies
  to none of them.
- **P2. Raw casts bypass the pending ledger.** Stomp (warrior-combat.ts:26), Dash
  (shared.js:13973), Energize (13948), partyheal (13885), A/B casts, escape casts and the
  legacy Curse path (priest.ts:30) call `use_skill` directly, so the engine's in-flight MP
  sum (engine.ts:31) does not see them.
- **P3. Cooldown checked by four different tests.** `is_on_cooldown` (client),
  `next_skill` read directly (runtime.ts:51, attack-controller.ts:40-44), `can_use`
  (Stomp, Dash, Energize), and `can_heal`/`can_attack` (shared.js:17701, 13897).
- **P4. `isOccupied` is a 20-condition veto with side effects** (shared.js:17494-17528):
  reading it can interrupt a convoy (17504, 17514) and cancel a Town cast (17500).
- **P5. Agitate is listed in three gates but never cast** (eligibility.ts:73,
  runtime.ts:71, 81; review C17).

## 3. Fork differences

- **648b3be0 (21b8362d)** heal reservation on heal range plus `remaining()+1` tick (bug
  3a). Adds `scripts/tests/priest-heal-reservation.test.cjs`.
- **dab0de01 (21b8362d)** `occupiedPotion` in the role tick: an HP potion below 50% while
  `isOccupied` holds. A sixth potion-group writer, unguarded against regen or escape
  potions (spec 05).
- **8d4bcf10 (fork)** MP potion target = skill reserve plus the next class buff
  (`skills/potion.ts`, `classes/mp-potion.ts`, fork only). Patches the 20% class floor.
- **7bd14d7c, 4075d3f2, ae116693 (fork)** change the warrior reserve and `ownsAggro`
  from leader to designated tank (fork eligibility.ts:40, :81). Spec 04 covers aggro.
- **62ab06e5 and follow-ups (fork)** pull mode fires a raw `attack(target)` from the
  movement tick when `can_attack` is true (fork shared.js:18517), outside the controller,
  the heal reservation and every attack gate.
- **d6f67a97 (fork)** Franky partyheal spam: raw partyheal on cooldown at Franky (fork
  priest.ts:17-19, shared.js:14755-14763).

## 4. Tests today

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| combat-movement::burst sends one immediate and four interval attempts... | 5-slot burst, ping compensation | real cooldown edge vs heal | yes | no |
| combat-movement::healing reserves basic attack without stopping movement... | controller obeys a stubbed `basicAttackReserved` | the predicate itself; the `can_heal` edge (bug 3a) | yes for what it stubs | yes (stub) |
| combat-movement::healing reservation cancels remaining burst slots | slot cancel | predicate | yes | yes |
| class-skills::attack controller sends a skill once and does not race it with a basic attack | `skillBusy` arbitration | heal vs skill | yes | no |
| class-skills::MP cost reductions, pending reservations, and survival exceptions | reserve and pending sum | raw casts (P2) | yes | no |
| class-skills::multiple pending cooldown families cannot spend the same MP | ledger | raw casts | yes | no |
| skill-context-builds (3 tests) | lazy context build | none of the cooldown rules | yes | efficiency only |
| franky-combat::skill runtime restricts offensive and area casts... | Franky veto | return-mode veto | yes | no |
| e2e live specs | none target cooldown ownership | - | - | - |

No test covers TRN-002 (A/B feed casts), TRN-014 (Curse) or TRN-015 (Energize) directly;
combat-movement and passive-healing stub `energizeLowestMana`. No test exercises two
potion-group writers together (bug 13). No test checks W1.

## 5. Needs your review

- **TRN-Q1. Who wins the attack slot when a member is hurt?** (a) heal always wins when
  anyone is under the heal threshold (today's intent); (b) heal wins only under a lower
  threshold (for example 70%), basic attack above it; (c) heal wins for the tank only,
  others wait for the role loop.
- **TRN-Q2. Should basic attacks keep an MP floor for heals?** (a) restore b03f0855's
  rule: skip basic attacks below the class survival reserve; (b) priest only; (c) no
  floor (today).
- **TRN-Q3. Raw casts with their own MP floors (P1).** (a) move Stomp, Dash, Energize,
  Curse, partyheal through the engine and its reserve; (b) keep their floors but count
  them as pending; (c) leave as is.
- **TRN-Q4. Agitate.** (a) drop it from the gates until something casts it; (b) add an
  Agitate caster for the warrior.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, run from the plan root with `LIMIT=100000`),
filtered to this spec: claimed by more than one spec 0, claims naming no known function
0, behaviours with no test 3 (TRN-002, TRN-014, TRN-015). Function count from
`catalog/03-turns-and-cooldowns.json`: 136 functions in 16 behaviours.

- TRN-002, TRN-014, TRN-015 have no test. Reason: each is a raw class cast with no unit
  harness; M1 decides whether they move into the engine (TRN-Q3) before a test is written.
- Functions of this part that were proposed to other specs and are not claimed here:
  the role runner body, `supportTick`, `tick`, `start`, `stop` (proposed 13-lifecycle);
  the escape pulses `escapeSurvivalPulse`, `escapePulse`, `escapeCharge`,
  `escapeWarriorDefense`, `escapeReady`, `escapeUse` (proposed 02-movement); the passive
  regen timer inside `sharedRoutine.start` (triage, `start@17351`). The coordinator should
  decide whether they move here; the behaviour text above covers them.
- Not re-verified in this pass: the client `attack()` cooldown behaviour (game.js
  3958-3971) and the `share` field of 3shot/5shot/piercingshot/fanofknives; both come
  from review/full/combat.md.

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
