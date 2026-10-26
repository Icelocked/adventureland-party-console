# 05 Survival (SRV)

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
(local checkout)) or "21b8362d" (the death fixes in
(local checkout)). Game rules: server source in
(local checkout) (43b2c8fc), client
`runner_functions.js` 17175, AL MCP v18183. The claim-by-claim check is in
`docs/implementation/05-verification-03-05.md`.

This part owns heals, HP and MP potions and regeneration, survival thresholds per
class, danger checks, the decision to escape, death, respawn and recovery. Which action
spends a shared cooldown (and the potion-group collisions behind ledger 13) is spec 03.
The escape movement itself (Blink, Magiport, retreat steps, walk to Main) is in spec 02
(MOV-035, MOV-036, MOV-144).

## 1. What it does today

### Game data this part uses

From AL MCP v18183 (`get_game_data skills <name>`):

- `regen_hp` restores 50 HP and `regen_mp` 100 MP. Either one makes both potions and both
  regens unavailable for 4 s. The server stores one `player.last.potion` for all four
  (server.js:12042-12048 for regen, 7807-7811 and 7856 for item potions).
- `heal` has no `mp` field. A heal costs the priest's `mp_cost`, as `escapeCost`
  (shared.js:35-39) and `cost` (eligibility.ts:5) assume.
- MP costs used in the escape budgets and recovery: partyheal 400 (cooldown 200 ms),
  curse 400, hardshell 480, dash 120, stomp 120 (range 400), revive 500 (range 240),
  blink 1600, magiport 900. Blink and Magiport are mage skills only.

### Survival thresholds per class

| Class | HP potion | MP potion | Other survival rules |
|---|---|---|---|
| Priest | below 50%, HP first when both are low (priest.ts:20-22) | below 20% | heals the party below 90% (priest.ts:17), partyheal when two members are at or below 50% (shared.js:13878-13887); escape heals below 95% (199, 272); skill MP reserve max(35% max MP, 2 heals + partyheal) (eligibility.ts:38) |
| Mage | below 50%, HP first (mage.ts:8-10) | below 20% | escape drinks MP up to full MP and never HP (shared.js:67-72) |
| Warrior | none | only the leader, while a monster attacks the party, below the Taunt cost (warrior.ts:44-49) | emergency Stomp when an ally is below 60% (shared.js:16038); escape MP budget Hardshell + 2 Dash (68) |
| Paladin | none (paladin.ts:2-5 has no `usePotion`, so default.ts:25-27 applies) | none | selfheal below 70% or when missing at least 80% of its output; mana shield below 40% with incoming damage and MP above the reserve (protection.ts:14-20, 51-59) |
| Ranger, rogue | none (default.ts:25-27) | none | - |
| Merchant | below 20%, inside regen (shared.js:13772) | below 20% | an HP potion when missing more than that potion heals (13776-13782) |
| All | | | regen: HP below 50% first, then MP below 50%, then any missing HP, then any missing MP (13785-13792); passing attacks stop below 35% HP (3474) |

None of these numbers is a setting.

### Behaviours

#### Potions and regeneration

- **SRV-001 Class potions.** `useRecoveryPotion` (shared.js:13832-13855) returns false
  when `is_on_cooldown("use_hp")`, picks `use_hp` or `use_mp` from the options (`force`,
  `hpBelow`, `mpBelow`, `priority`), sends `use_skill`, and logs "Potion failed" for every
  reason except cooldown, no item, not found and full. The role loop calls the class
  `usePotion` first in every support tick (runner.ts:259). The class thresholds are in the
  table above.
- **SRV-002 Free regeneration.** `regenerateHpOrMp` (13761-13808) runs from the role loop
  when no potion was drunk (runner.ts:259) and from the passive pulse every 500 ms
  (17368-17369, `passiveRegenerationTick` 13823-13830). The pulse runs whenever
  `passiveRegenerationEligible` (13810-13821) holds: merchants always; escape stages
  `complete` and `failed-hold`; reunion, anniversary, event travel, Town travel, forced
  travel, convoys, following, departure, Town, banking, stocking, upgrading, gathering, or
  moving without an engaged monster. Regen skips during the other escape stages (13762)
  and logs "Recovery failed" for every reason except cooldown and no MP (13802-13803).
  Each regen locks every potion for 4 s (server.js:12048). For a priest the passive pulse
  also tops off the party with regular heals at ratio 1 (13828).

#### Healing and protection

- **SRV-003 Priest healing.** `healPartyBelow(ratio, options)` (13862-13920) runs for
  priests only, not dead, not `healingBusy`, and not during a Town cast (13867). It reads
  heartbeat HP (`partyPositions`, or cave members) of non-merchant, same-team, living
  members on the map, for members under the ratio and members at or below 50%
  (13872-13881). Two or more members at or below 50%, MP for partyheal and partyheal ready
  give a partyheal (13882-13887); the passive pulse (`regularOnly`) and non-uniform A/B
  never cast it. Otherwise it walks the injured list from lowest heartbeat HP and heals
  the first member whose live HP is still under the ratio and `can_heal` holds
  (13894-13898), with a 2 s timeout, and records `lastHealAt` (13900-13911). The MP check
  before the heal (13893) compares with `G.skills.heal.mp`, which the game data does not
  have, so it compares with 0 and never stops a heal (spec 03 W1). The priest's
  `beforeTarget` runs Absorb, then heal at 90%, then support skills (priest.ts:15-19).
  `isPartyHealthy` (13977-13986) gates Curse at 90% (priest.ts:26).
- **SRV-005 Danger model.** `incomingDps` (damage.ts:50-57) sums attack x frequency x
  mitigation x 1.1 for monsters targeting the ally, and returns Infinity when a monster's
  attack or frequency is unknown. `endangered` (64-67): incoming damage, and HP below 60%
  or 2 s of that damage leaving less than 30%. `safeTransfer` (58-63): taking a monster's
  damage must leave the caster above 30% after 2 s, with observations at most 1.5 s old.
  `safePull` (eligibility.ts:57-63) refuses a hostile skill in scatter mode whose
  untargeted monsters, once pulled, would leave the caster at 30% or less after 2 s.
- **SRV-006 Protective skills.** Paladin selfheal below 70% or when missing at least 80% of
  its output; mana shield on below 40% with incoming damage and MP above the reserve, off
  above 65% or at the reserve; aether shield under magical damage when 2 s of damage leaves
  more than 30% and MP is not full; cleansing light for a cleansable condition, urgent for
  stunned, frozen, deepfreezed, tangled, poisoned, burned or an endangered ally; Guardian's
  Oath for an endangered ally when the transfer is safe; Beacon of Resolve when the leader
  would fall under 30% in 2 s or two nearby allies take damage (protection.ts:14-65).
- **SRV-007 Emergency warrior Stomp.** `emergencyWarriorStomp` (16014-16047) runs from the
  warrior's `beforeTarget` outside Franky (warrior.ts:19). It needs Graveyard to allow an
  area attack (16015), no tinyp rare target, not scatter, a basher, no locked-out monster
  in range during an unfinished fight, MP for Stomp and Stomp ready. Danger is two
  monsters targeting the warrior, the warrior kiting, or an ally report under 5 s old whose
  HP (live when visible) is below 60% or which is kiting (16031-16039). A monster that
  targets the party must be in range (16041-16044). The cast is a raw `use_skill`.

#### Escape

- **SRV-004 Escape potions.** `escapePotions` (62-75): when `use_mp` is off cooldown, drink
  MP below the class budget (warrior Hardshell + 2 Dash, or full MP while shielded; priest
  Curse + partyheal + heal; every other class full MP), else HP for non-mages below max
  HP. `local.potionBusy` keeps one request at a time. It runs from the survival pulse
  (SRV-018) and from the escape pulse (247) in the other stages.
- **SRV-018 Escape survival pulse.** `escapeSurvivalPulse` (189-201) runs every 100 ms
  (325) in the stages `recovering`, `recovery-convoy`, `complete` and `failed-hold`. It
  drinks escape potions, then runs the warrior's shield and Dash defence while the warrior
  is off Main within 65 of (0, 0), or the priest's heals below 95%.

#### Death and respawn

- **SRV-008 Own death capture.** `combatDeathListener` (1079-1097): for another entity's
  death it reports the fight death and invalidates the target (1081-1083, spec 04). For
  the own death it builds "Killed by <name>" from the last incoming damage within 15 s
  (`deathCombatMessage`, 1049-1058), stamps the Hunt event trip (`captureHuntDeath`,
  616-622), queues a combat event, and, when events are enabled, marks the live event to
  rejoin (1090-1094).
- **SRV-009 Respawn.** Every 250 ms the runner resets targeting while dead and calls the
  death recovery (runner.ts:341-351). `createDeathRecovery` (death-recovery.ts:18-74) yields
  while the dungeon runtime or the escape owns revival (runner.ts:67-69,
  `escapeOwnsRevival` shared.js:17947), races `respawn()` against 3 s, and treats the alive
  state, not the reply, as the end of the respawn phase (:17, :36). Once alive it releases
  combat, tries the event rejoin (SRV-012), and starts the farm reunion when no event
  applies (:48). A retryable rejoin or an error retries after 1 s (:45, :71). Phases go to
  `partyCombatState.recovery`.
- **SRV-012 Event rejoin after respawn.** `rejoinActiveEventAfterRespawn`
  (shared.js:13721-13759) returns cancelled while the escape owns the character, when the
  marked event is gone, or when navigation is cancelled, and not-applicable with events off
  or no live event. It waits for event travel permission (retryable), joins events that
  need a join, searches for Slenderman, or walks the party to an event that needs no join
  (`sharedPartyWalk`).

#### Party death recovery (coordinator)

- **SRV-010 Finish or escape.** `combat-disengagement.cjs` (2-170). `newDeaths` (24-36)
  finds fresh deaths outside events (`huntSafety.eventDeath`). `start` (77-82) finishes
  (`finishing`) when every foe's fresh observations are at or below 25% HP and every living
  survivor is fresh and at or above 50% (`health` 55-62, `canFinish` 63-67), and cancels
  combat travel while it does. Otherwise it escapes (`escape` 68-76: reset combat, abandon
  rare, call the party escape for every member). Another death or a failed finish escapes
  (141-143), and so does a death during the farm return (137). `tick` (122-149) cancels the
  recovery when the leader, focus, policy or a navigation revision changes (131-133) and
  pauses while a member is at an event (134).
- **SRV-013 Regroup and resume.** `recover` (90-102) waits for `safe` (83-89): every member
  fresh, alive, not moving with a finished movement receipt, at or above 50% HP, on `main`
  within 65 of (0, 0), with no threats. Then it resets combat, releases the escape, and
  resumes Hunt or, with a saved location, returns to the farm (`returnToFarm` 103-121). The
  first return starts at once; after a failed return convoy it waits 5, 15, 30, then 60 s
  (113). It completes when every member is within 400 of the saved farm or the return
  convoy handed off there (104-107).
- **SRV-014 Grouped targeting during recovery.** While recovery is active, `prepare`
  (150-157) strips nominations from every report and pauses retention, and outside
  `finishing` and `returning-to-farm` also strips evidence, threats and state. `finalize`
  (158-168) commits the current target during `finishing` and empties the queue outside
  those two phases. `combatRecoveryActive` (shared.js:14383-14386) tells the character,
  outside events and the `complete`, `cancelled` and `returning-to-farm` phases.

#### Cave revival

- **SRV-011 Revival decision.** `installCaveRecovery` (cave-recovery.ts:32-237) with ports
  from `caveRecovery` (shared.js:2658-2694). The assigned priest heals a grave to full, then
  casts Revive with Essence of Life once the coordinator authorizes it (124, 187). Living
  teammates under 90% are healed first (89, shared.js:2667-2669). The priest needs maximum
  MP for Revive (91) and, in a fight, the priest reserve on top of the cost (92). It holds
  the attack slot while an action is ready, while waiting for MP, or while a Revive is
  dispatched or uncertain (`reserved`, 130-135). Acknowledgements time out after 2.5 s
  (136-148).
- **SRV-015 Revival journal.** A per-character localStorage ledger (shared.js:2660,
  2690-2691) keeps receipts for the current run only (cave-recovery.ts:39-49). The receipt
  is written before Revive goes out (176). A definite rejection fails, any other rejection
  stays uncertain (152-173), and the observed grave or revival channel settles it
  (66-80). A revival that has not completed 12 s after acceptance fails (64). A fallen
  priest or missing Essence fails an authorized preparation (81-86). Failures tell the
  player to use Nera.
- **SRV-016 Grave approach gate.** `move` (199-208) walks the priest toward an unrevived,
  unjournaled grave out of range, only when `movementBlocked` (196-198) is false: no fight,
  no action in flight, no heal pending, no living teammate to heal, and Essence in the bag.
  The step itself is spec 02 (MOV-042).
- **SRV-017 Assignment and report.** `receive` (210-213) stores the coordinator assignment;
  it is used only while under 3 s old and naming this priest (58). `report` (217-235) sends
  the priest's HP, MP, Essence, phase and reason back.

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
5. Inference: under steady damage a warrior's only HP sources are regen (50 HP per 4 s,
   game data `regen_hp.output`) and the priest, whose heals bug 3a starves (spec 03).

Not patched for normal combat. dab0de01 (21b8362d) adds an HP potion below 50% while the
character is occupied (21b8362d runner.ts:289-294, 302), through the same
`useRecoveryPotion` and its client cooldown check.

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
   participants are exactly one warrior, one mage and one priest (40-42); `step` (59-97)
   fails to independent recovery when one is dead or disconnected (62-69) or after the
   30 s deadline (37, 70-71).
3. When all three are alive at the start (for example after a `finishing` window, when
   the dead member has respawned and its `lastDeath` matches the snapshot at :38), the
   stages run Blink, warrior, priest, `complete` at the Blink landing (91-96).
   `escapeLanding` (shared.js:160-188) picks the lowest-risk Town spawn, transporter or
   door offset on the current map, not Main (0, 0).
4. At `complete` the character's escape pulse returns at once (shared.js:208); nothing
   walks the party further. `isOccupied` stays true while the escape owns the character
   (17516), so the role loop is idle.
5. `recover` waits for every member on `main` within 65 of (0, 0) (cjs:83-89, 90-92).
   It never comes.

Steps 1, 2, 4, 5 are read from code; the condition in step 3 under which all three reach
the landing is inference. Patch: ce6e7c1a (fork) adds `strandedRescue` (fork
party-escape.cjs:100-107). When the priest reaches a landing off Main within 65 of
(0, 0) and the death recovery still owns the escape, the stage becomes `recovering`
instead of `complete` (fork :96-97), and the recovering stage walks each member to Main
(shared.js:229-240). The two definitions of "safe" stay (P5).

### Death-fix commits on 21b8362d

None of these is in af92de45 (`git merge-base --is-ancestor`).

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

- **P1. Survival thresholds in eight places.** Class files (mage.ts:9, priest.ts:21,
  warrior.ts:44-49), regen order (13785-13792), priest heal ratios (priest.ts:17,
  shared.js:13880), escape budgets (62-75) and the 95% escape heal (199, 272), skills
  reserve (eligibility.ts:34-42), paladin protection (protection.ts:17, 54, 56), Stomp
  60% (16038), passing attacks 35% (3474), disengagement 25%/50% (cjs:61, 65, 86).
- **P2. Four heal writers outside the role loop**: the attack controller
  (attack-controller.ts:77), the passive pulse (13828), escape (199, 272) and the cave
  revival (2675-2679). `healingBusy` (336) arbitrates them. The A/B feed heal on an enemy
  (13138) does not set it.
- **P3. Heartbeat HP first, live HP second** (13872-13874 vs 13894-13898), so a stale
  heartbeat skips an injured member or picks a healed one.
- **P4. Two death counters**: disengagement `combatDeathSeen` (cjs:24-36) and Hunt
  `recordDeaths` (hunt-safety.cjs:49-74). Both use `eventDeath` (42-48).
- **P5. Two "safe" definitions**: escape recovery needs every member alive and settled on
  Main within 65 (party-escape.cjs:73-75, 85-86); disengagement also needs 50% HP and no
  threats (cjs:83-89).
- **P6. The escape role trio is hard-coded** (party-escape.cjs:28-42): any party that is
  not exactly one warrior, one mage and one priest falls to independent recovery.
- **P7. Respawn has three owners**: the role runner (runner.ts:341-351), the escape pulse
  (shared.js:211-216) and the dungeon runtime, split by `escapeOwnsRevival` (17947) and
  `dungeonOwned` (runner.ts:67-68).

## 3. Fork differences

- **ce6e7c1a** `strandedRescue` (bug 5).
- **8d4bcf10** MP potions up to the skill reserve plus the cost of the next maintenance
  buff (fork `skills/potion.ts:12-16`, `classes/mp-potion.ts:5-8`). The warrior drinks MP
  to that target (fork warrior.ts:66) and keeps the leader Taunt rule (fork :64-65).
  Patches the 20% class floor; the warrior still has no HP potion.
- **ae116693** off tank takes over when the tank is endangered or below 50%, and hands back
  at 80% with no attackers on the tank (fork tank-handoff.ts:15-22, spec 04).
- **4075d3f2** tank hold releases below 50% and holds again at 80% (fork shared.js:18433,
  18542-18547), a second 50/80 pair beside ae116693's.
- **21b8362d** death fixes above.

## 4. Tests today

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| passive-healing (14 tests) | heal ratios, partyheal, passive pulse, merchant potion through the real `useRecoveryPotion` | potion vs regen collision; class potion thresholds | partly: the out-of-mana case stubs `G.skills.heal.mp` as 10 (passive-healing.test.cjs:20), a field the game data lacks, so W1 cannot show | some (Town channel) |
| party-escape (22) | escape stages, potion budgets, warrior defence order | stranded complete (bug 5) | yes | several |
| combat-disengagement (13) | finish thresholds, escape, safe regroup, farm return, report filtering | the Blink-landing stall | yes | some |
| respawn-recovery (5) | respawn latch, event and farm rejoin with stubbed ports | escape-owned revival (`blocked`) | yes | yes (lost reply) |
| franky-recovery, merchant-events (event rejoin tests) | the real `rejoinActiveEventAfterRespawn` | Slenderman search | yes | some |
| cave-priest-recovery (12) | revival decision, journal, approach gate and reserve | - | yes | no |
| warrior-stomp (6) | Stomp triggers and MP (stub cost 120 matches game data) | - | yes | no |
| class-skills (25; protection tests) | paladin and priest support skills | - | yes | no |
| e2e live-hunt-recovery, live-hunt-round2-recovery, live-hunt-town-recovery | recovery on the test server | per-threshold assertions | not reviewed in this pass | - |

Counts: `grep -cE "^\s*test\(" scripts/tests/<file>.test.cjs` on the ref.

No test calls a class `usePotion` (SRV-001 thresholds); combat-movement stubs
`useRecoveryPotion` (combat-movement.test.cjs:22, 496). No test checks the death message
(SRV-008): `git grep "Killed by\|deathCombatMessage\|captureHuntDeath"` on scripts/tests and
e2e finds only fight-death-packets.test.cjs:19, which tests listener retirement. No test
runs two potion-group writers together.

## 5. Needs your review

- **SRV-Q1. Which classes drink HP potions, and when?**
  - **Today:** the priest and mage drink HP below 50% (priest.ts:21, mage.ts:9). The
    warrior drinks only MP, and only as leader (warrior.ts:44-49). Paladin, ranger and
    rogue never drink (default.ts:25-27). The fork raises MP targets (8d4bcf10) and
    21b8362d adds an HP potion below 50% only while occupied (dab0de01).
  - **Options:** (a) every fighter drinks HP below 50%. Negatives: more potions bought;
    50% may still be late for a tank under burst damage. (b) per-class thresholds you set.
    Negatives: new saved fields (spec 11 lists), and a wrong value per class goes
    unnoticed. (c) keep today. Negatives: the tank has no HP potion at all (bug 3b).
  - **Recommendation:** (a). It gives the tank a potion and removes three class special
    cases with one rule. It beats (b) because nothing yet shows a class needs a different
    number, and it beats (c) because (c) is bug 3b. Negatives: potion use goes up, and the
    regen lock (SRV-Q2) still delays it unless that changes too.
- **SRV-Q2. When may free regen run?**
  - **Today:** regen runs at any missing HP or MP (shared.js:13787-13792) from the role
    loop (runner.ts:259) and the passive pulse (13829), and locks every potion for 4 s
    (server.js:12048).
  - **Options:** (a) skip regen when a potion threshold could trigger within 4 s.
    Negatives: needs a damage forecast, and `incomingDps` returns Infinity for unknown
    monsters (damage.ts:53), so regen would often stop in combat anyway. (b) regen only
    while no monster targets a party member. Negatives: loses 50 HP or 100 MP per 4 s in
    long fights, so MP-hungry classes drink more potions. (c) keep today. Negatives: a
    regen can hold an HP potion back for up to 4 s (bug 3b step 4).
  - **Recommendation:** (b). It reads one fact the code already has
    (`isAttackingPartyMember`, shared.js:14001) and keeps the potion slot free exactly
    when potions matter. It beats (a) because it needs no forecast, and (c) because (c)
    keeps the 4 s lock in combat. Negatives: more potions in combat, and regen out of
    combat stays as it is.
- **SRV-Q3. In an escape, HP or MP first?**
  - **Today:** MP first up to the class budget, then HP, and never HP for a mage
    (shared.js:67-72). 21b8362d drinks HP first below 50% for every class (dab0de01).
  - **Options:** (a) HP first below 50%, then the MP budget (21b8362d). Negatives: a
    warrior below 50% may lack the 720 MP base cost of Hardshell + 2 Dash; it stays a
    second potion policy beside SRV-001. (b) one potion table for combat and escape, with
    (a)'s HP-first rule and the escape MP budgets as entries. Negatives: a larger change;
    the budgets are MP amounts, not percentages, so the table needs both kinds. (c) keep
    today. Negatives: the mage died drinking MP at 531 of 1873 HP (dab0de01 message).
  - **Recommendation:** (b). One owner for the potion slot removes the gap that let the
    two policies disagree. It beats (a) because (a) keeps two policies, and (c) because of
    the measured mage death. Negatives: more work than (a), and the budgets must move into
    the table.
- **SRV-Q4. When does a death end the fight?**
  - **Today:** the party finishes when every foe's fresh observations are at or below 25%
    HP and every survivor is at or above 50%; otherwise it escapes, and another death ends
    the finish (combat-disengagement.cjs:61, 63-67, 77-82, 143).
  - **Options:** (a) keep today. Negatives: a foe with no fresh sighting blocks finishing
    (61 needs observations), and a foe at 26% costs a full escape. (b) always escape.
    Negatives: gives up nearly dead monsters and their loot, and every death becomes an
    escape, which needs the trio (SRV-Q6). (c) finish while the healer lives. Negatives:
    ignores foe HP, so a lone priest can keep fighting a full-HP monster.
  - **Recommendation:** (a). It keeps the weak kills and escapes from everything else. It
    beats (b) because it saves near-finished fights, and (c) because it checks the foe.
    Negatives: the 25% and 50% are fixed numbers, and finishing needs a fresh sighting from
    a living member.
- **SRV-Q5. Where is "safe" after an escape?**
  - **Today:** disengagement waits for Main within 65 of (0, 0) (cjs:83-89), but the trio
    escape completes at the Blink landing on the current map (party-escape.cjs:91-96,
    shared.js:160-188), so the party can wait forever (bug 5). The fork sends an off-Main
    landing on to Main (ce6e7c1a).
  - **Options:** (a) Main within 65 of (0, 0) for both. Negatives: long walks back from far
    maps before the farm resumes. (b) the Blink landing when no monster is near. Negatives:
    disengagement must accept a position per member, and members who died do not respawn
    there (inference from the fork comment at fork party-escape.cjs:101-103). (c) the
    nearest Town of the current map. Negatives: the same split from respawned members, and
    a Town spawn can still have monsters near.
  - **Recommendation:** (a). It is one definition, and it matches where dead members come
    back. It beats (b) and (c) because both leave respawned members apart from the rest.
    Negatives: extra travel time on every escape from another map.
- **SRV-Q6. Parties without the warrior, mage, priest trio.**
  - **Today:** any party that is not exactly one warrior, one mage and one priest fails at
    once to independent recovery (party-escape.cjs:28-42), where each member walks to Main
    and a mage Blinks alone (shared.js:209-241).
  - **Options:** (a) keep today. Negatives: no coordinated rescue, and members walk out
    under attack. (b) a mage leads whenever one is present: it Blinks out and Magiports
    every other member in turn. Negatives: Blink and Magiport are mage skills only (game
    data), and a rescue of three others costs 1600 + 3 x 900 MP before reductions. (c)
    keep the trio rule but allow extra members, who walk independently. Negatives: two
    escape modes run at once in one party.
  - **Recommendation:** (b). It keeps the rescue for any party with a mage and removes a
    hard-coded class list. It beats (a) because it keeps the coordinated escape, and (c)
    because the party moves as one. Negatives: MP limits how many members one mage can
    pull, and a party without a mage still walks.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, `LIMIT=100000`), filtered to this spec:
claimed by more than one spec 0, claims naming no known function 0, behaviours with no
test 1 (SRV-008). `catalog/05-survival.json`: 106 functions in 18 behaviours (counted with
`node -e` over the catalog; this section said 95 in 11 before the split).

- SRV-008 has no test. Reason: the death message has no unit harness.
- SRV-001's only test is the merchant path; the class thresholds wait for SRV-Q1.
- Claimed by other specs: `applyEscape`, `escapeLanding`, `escapePulse`, `escapeCost`,
  `escapeReady`, `escapeUse` (02-movement MOV-035, MOV-036); `party-escape.cjs` (MOV-144);
  `beginFarmReunion` (MOV-056); the grave approach step and `caveRecoveryMove` (MOV-042,
  MOV-103); `hunt-safety.cjs` `recordDeaths`, `eventDeath` (07 HNT-059). Their survival
  rules are in the text above.
- Not verified: the step 3 condition of bug 5 (when all three roles reach the landing).

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
