# 04 Targeting (TGT)

Checked against Ryan's base `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
`F:/CodingProjects/pm-worktrees/review`) or "21b8362d" (the death fixes in
`F:/CodingProjects/pm-worktrees/pta-pull`). Game data: AL MCP v18183.

This part owns one question: what each character attacks or avoids. It covers the
character's own selection (role runner and `sharedRoutine` target finders), the
eligibility gates read at selection and at attack time, threat facts, aggro transfer
skills, passing encounters while walking, and the coordinator's grouped queue that picks
one target per group. Which action spends the attack cooldown is spec 03; movement toward
the target is spec 02.

## 1. What it does today

### Character selection

- **TGT-001 Selection loop.** `selectTarget` (runner.ts:158-195) runs every 1 s
  (runner.ts:334-337), on `wake`, and on `invalidateTarget` (a confirmed death,
  runner.ts:309-316). It clears the selection while `combatAllowed()` is false
  (runner.ts:160-165; `combatAllowed` at :84-93: active, alive, class role fights,
  merchant only in its event, not occupied, not A/B pending/feed). A console drain keeps
  the current target (:167). A closer Hunt target replaces an untouched one (:168-174,
  `getCloserHuntTarget` shared.js:17957-17969). A valid current target stays unless a
  priority event, rare, dungeon or grouped nomination differs (:175-180). Otherwise
  `chooseTarget` (:133-148) asks in order: priority event target (Mr. Green, Mr. Pumpkin,
  Horseman; shared.js:17971-17973) unless combat is exclusive; dungeon target; return
  defence; Franky; merchant role; grouped target when grouped farming; rare target; class
  role. `eligibleSelection` (target-state.ts:11-13) and the 10 s killed list (runner.ts:53,
  335) filter it; `publishSelection` (:152-157) writes `combatTargetId`, publishes the
  leader's selection revision (`publishCombatSelection`, shared.js:14685-14693) and
  follows the leader when nothing is selected outside scatter and grouped combat.
  `currentTarget` (:109-121) re-validates every read with `targetRejection`
  (target-state.ts:3-10) and writes the rejection reason to `partyCombatState`; in return
  mode it bypasses selection and returns `returnDefenseTarget` (:110). `attackTarget`
  (:102-108) swaps in the passing target when its priority is higher. Death sockets
  invalidate targets: `combatDisappearListener` (shared.js:1065-1071),
  `combatEntitiesDeathListener` (1072-1078), the monster branch of `combatDeathListener`
  (1081-1083).
- **TGT-002 Class target choice.** Default role (default.ts:5-18): scatter-break target
  (engaged first), event target, scatter target in scatter mode, else leader target when
  following, else preferred target. Warrior (warrior.ts:22-31): scatter break, scatter
  event/scatter target, else `partyTarget` (:9-14): event target, nearest party attacker,
  nearest party target, then leader or preferred. Merchant: event target only
  (merchant.ts:6).
- **TGT-003 Target finders** (shared.js). `getLeaderTarget` (17786-17803): engaged
  monster while departing or bank-queued, grouped target for a grouped follower, nearest
  party threat in a convoy, else the leader's reported target. `getPreferredTarget`
  (17878-17910): rare, nothing during Town, engaged monster, scatter break, convoy threats
  or focused monster, party threats by priority then distance, nearest focused monster.
  `getNearestFocusedMonster` (17804-17877): visible focused types, not fieldgen0 or tinyp,
  not externally claimed, not failed-approach, inside the farm area
  (`selectFarmCandidates`, 14913-14921), highest priority tier then nearest; in scatter
  each member takes a different rank of an id-sorted list (17830-17845); falls back to
  the game's path-checked `get_nearest_monster`. `getScatterTarget` (17911-17938),
  `getGroupedTarget` (17999-18006: the protocol-4 lock target, kept in range during an
  unfinished fight, else the grouped defensive target), `engagedMonster` (14821-14837),
  `getNearestPartyAttacker` (14015-14028), `getNearestPartyTarget` (14030-14042),
  `visibleFocusedMonsterWithinRadius` (14962-14973).
- **TGT-004 Monster priority.** `monsterPriority` (14776-14784): an enabled passive rule's
  priority, tinyp 101, phoenix/goldenbat/cutebee/hen/rooster 100 when a rare hunt is
  active or they are passive rare candidates, else the saved `monsterPriorities` value,
  default 50. Setting: monster priorities and passive hunting rules.
- **TGT-005 Event, Franky and dungeon targets.** `nearestEventTarget` (12955-13047):
  Franky only during attendance (`frankyTargetAllowed`, 12924-12928); A/B opponent; boss
  events prefer adds (leader's add, retained add, then by id; Horseman adds are
  jackowalkers); Goo Brawl takes the Rainbow Goo as soon as it is visible, else the
  leader's goo, the goo with most party selections, the retained one, the nearest; other
  events by event type order then distance. Dungeon: `dungeonTargetAllowed`
  (2608-2616), `getDungeonTarget` (2617-2625), `dungeonCombatThreat` (2626-2631),
  `dungeonEncounterEnemy` (2632-2638).

### Eligibility and threat

- **TGT-006 `isAllowedTarget`** (14705-14770), in order: excluded Graveyard type; console
  drain (`consoleDrainAllows`, 2426-2428); cave or dungeon runtime -> dungeon rule;
  return mode -> `returnAttacker`; Franky attendance -> Franky only; travel combat owns
  combat unless Hunt travel or a departure target; Hunt loot pending -> attackers only;
  passive max level (unless attacking, unfinished, event or focused); passing encounter
  -> rejected; death recovery owns targets unless `finishing` and listed; known dead;
  Franky -> allowed; fieldgen0; unfinished fight during Hunt travel; leader lock
  (`leaderLockAllows`, 14679-14684); tinyp only as the rare target; rare target ->
  allowed; A/B characters; external claim (`isExternallyClaimedMonster`, 14044-14055);
  Horseman/Gargoyle only in their event unless attacking; failed approach on Hunt
  travel; passive rare candidate -> allowed; attacking the party -> allowed; farming
  engagement inside the area; exact unfinished target; farm area or radius (150 units of
  slack for the last attacked target within 5 s) unless Hunt travel, nearby Hunt, Goo
  Brawl, an event or a party threat; finally the target must be the current target, a
  convoy or party threat, the scatter break, an event type, the scatter type, the
  leader's target when following, or a focused type ("all" included). Settings: monster
  focus, farm area, passive rules, Graveyard monster list, events.
- **TGT-007 Threat facts.** `isAttackingPartyMember` (14001-14013): a monster whose live
  `target` is this character, or a party member on the same map and team. Passing
  encounters are never threats unless return-departure defence or a continuous Hunt
  return holds and the rule is not keep-moving (14003-14005). `isCurrentPartyTarget`
  (13988-13995), `isPartyThreat` (13997-13999), `returnDepartureDefense` (14057-14061).
- **TGT-008 Return-trip defence.** `returnCombatActive` (3434-3438) holds during a
  continuous return convoy, an anniversary staging walk or an event recovery cycle. Then
  only `returnAttacker` monsters (3439-3442) are targets, in range first
  (`returnDefenseTarget`, 3443-3447), a Town cast under attack is cancelled
  (3448-3456), and skills are limited (`returnTargetBlocked`, runtime.ts:72-74).
- **TGT-009 Attack-time gates.** `permitted` (attack-controller.ts:96-123): target still
  eligible (`allowsTarget`, or `allowsPassingTarget` = `consoleDrainAllows` for passing,
  shared.js:17945), no weapon swap, not disabled, grouped readiness
  (`groupedAttackAllowed`, 14459-14474), damage-type block (TGT-010), tinyp policy
  (TGT-013). `groupedAttackAllowed`: console drain, dungeon commitment, return attacker,
  formation recovery blocks, travel combat and loot, then in grouped farming only the
  protocol-4 lock target, engaged or committed with independent readiness
  (`independentPullReady`, 14442-14452, `independentPeersReady` 14453-14458: every member
  ready within 1000 ms), and no other attacker unless the target is pending. Skills use
  `authorized` (runtime.ts:59-67: return and Franky vetoes, damage-type block except
  Taunt, `skillTargetAllowed` shared.js:17737-17747 plus `rareAttackAllowed`, and an
  unsafe scatter pull check) and `targetBlock` (eligibility.ts:43-52).
  `departureTargetEngaged` (14878-14905) decides which attackers keep travel defence.
- **TGT-010 Damage return and reflection.** `monsterAttackBlock`
  (monster-attack-policy.ts:24-35): porcupine refuses physical attacks below range 75;
  `slenderman`, `tiger`, `goblin` (hard list, :3) refuse magical basic attacks. The
  damage type comes from the native field, then the weapon, then the class (:12-21).
- **TGT-011 Porcupine bow swap.** `createPorcupineEquipment` (porcupine-equipment.ts:
  32-138) equips the highest-level usable bow while a blocked melee character targets a
  porcupine, keeps the session on the game host, restores the original hands on
  departure, retries after 2 s. Installed per character (porcupine-equipment-runtime.ts:
  4-43); the movement tick drives it (runner.ts:200-204).
- **TGT-012 Crab range correction.** After a `too_far` rejection on a crab whose drawn
  box is larger than `G.dimensions.crab` (crab-range.ts:12-17), the controller uses a
  corrected distance for 30 s with a 500 ms retry (crab-range.ts:44-50);
  `describeAttackRange` (shared.js:17338-17350) samples the geometry.
- **TGT-013 Tiny Pixie and Fairy policy.** `rareAttackAllowed` (3632-3642): never
  fieldgen0; tinyp only with a projectile protected by a field generator within 300
  units (`tinyProjectileProtected`, 3620-3631) or melee, as a passing target, or as the
  rare target when this character is not the deployer. `rareTarget` (3601-3607),
  `ownedRareTarget` (3591-3600).

### Passing encounters

- **TGT-014 Passing attacks while walking.** `passingTarget` (3457-3490): a keep-moving
  passive target first (`walkingPassiveTarget`, proposed 02), none in return mode, a
  convoy-hold defence target, then only while travel allows (`passingTravelAllowed`) and
  not below 35% HP, not merchant, not during Town, banking, events, escape or recovery
  (3474-3476). Candidates are in range, not fieldgen0, not claimed, and either the Hunt
  target, a defending attacker on a return, or an enabled keep-moving rule within its
  level cap (`passiveLevelAllowed`, 3491-3494). Sorted by party targeting, priority,
  distance. `isPassingEncounter` (3333-3372) remembers an encounter for 60 s per
  realm/map/instance/id (`passingKey`, 3319-3322) unless a death was seen.
  `beginPassingAttack` (3520-3536) reserves it, and for tinyp equips a field generator
  with a rank-based delay. The admission handshake (passing-admission.ts:28-73) lets a
  member fire only after every member installed the same token; the coordinator merges
  reservations (passing.ts:41-47). Settings: passive hunting rules (enabled, keepMoving,
  priority, maxLevel), field generator use.

### Aggro

- **TGT-015 Aggro transfer.** Only the party leader owns aggro skills: `ownsAggro`
  (eligibility.ts:72-74) for absorb, taunt and agitate. Warrior Taunt (`mayTaunt`,
  warrior-combat.ts:31-36): leader, level, target is a monster attacking a party member
  but not this warrior, or an untouched porcupine (:37-44), ready through the engine
  (:45-48); cast from `beforeAttack` (warrior.ts:32-43) through `castCombatSkill`
  (category survival) or raw. Priest Absorb (`absorbDecision`, protection.ts:5-13):
  leader priest, keeps one heal's MP, the lowest-HP ally being hit whose damage the
  priest can take safely (`safeTransfer`, spec 05). `isLeader` (shared.js:17713).

### Coordinator grouped queue

- **TGT-016 Character side.** The leader nominates focused monsters in its farm area
  (`queueCandidates`, 14269-14299; followers nominate only the Hunt target and passive
  rares); nominations are blocked during travel intent, departure loot, convoy defence or
  travel, non-grouped combat, manual navigation and death recovery (14279-14282).
  Each report carries threats (`groupedThreatReports`, 14173-14181), sightings, claims
  (`queueClaims`, 14387-14398), retentions (14303-14322), acknowledgements and queue
  evidence (client.ts:46-66). `acceptQueue` (14248-14268) installs the coordinator's
  group, resets targeting when the head changes, and records timing. A party member hit
  by a monster nominates it as a defensive hit and interrupts travel (`defendPartyHit`,
  970-991). The queue client (client.ts:13-168) reports every 100 ms or on change, long
  polls the coordinator, and requests a full entity snapshot when no basic attack has
  been accepted for 5 s (entity-refresh.ts:22-40).
- **TGT-017 Coordinator side.** `evaluateGroup` (grouped.ts:56-141) picks a priest anchor
  (`healingAnchor`, composition.ts:9-12), marks members participating or recovering,
  waits 500 ms of stable readiness, and calls `reconcileQueue` (queue.ts:12-108):
  tombstones (512), claims (external claims win; a fully healed neutral fight is
  released after 5 s, reset-fight.ts:18-32), evidence to fights, threats to engaged
  fights, lost targets after 8 s of fresh absence (lost-target.ts:6-24), candidates by
  priority then leader distance, retained nominations (nomination-retention.ts:6-24),
  unseen primary release (unseen-primary.ts:22-34), pursuit revocation after 5 s without
  approach progress or for a closer Hunt target (pursuit.ts:103-123), a locked
  current/next pair (locked-pair.ts:10-23). Commitment needs every participant's
  acknowledgement (grouped.ts:114-121). Successor grants let clients promote the next
  target on the predecessor's death without a round trip, within the Hunt kill budget
  (successor-grant.ts:53-91, successor-client.ts:11-67).
- **TGT-018 Hunt travel encounters.** `updateHuntTravel` (hunt-travel.ts:124-133) keeps a
  primary attacker, committed stop targets from passive stop rules, releases and
  retirements while an interruptible Hunt convoy walks.

## 2. What goes wrong

### Bug 16 (ledger 16): Sparkbot reflection is not in the reflector list

1. `reflectors` is a hand-kept set of three names (monster-attack-policy.ts:3).
2. `monsterAttackBlock` blocks magical basic attacks only for those names (:32-33);
   skills use the same function with the skill's damage type (runtime.ts:62).
3. Game data has a numeric `reflection` on eight monsters (MCP v18183): goblin 99.95,
   tiger 100, slenderman 96, target_ar500red 50, xmagen 30, sparkbot 8, iceroamer 8,
   greenjr 4.
4. A mage or priest basic-attacks a Sparkbot and takes 8% of the damage back.

Finding W2 in the same chain: `target_ar500red` reflects 50% and is a Targetron, the
monster family of the ledger 3 farm. Inference, not measured: a mage in that farm took
reflected damage on every hit of that type, which adds to bug 3's deaths.

Patch: d988fcbd (21b8362d) reads `G.monsters[mtype].reflection` and blocks magical basic
attacks for any value above 0. That fixes the list at source; blocking greenjr at 4% is a
policy question (TGT-Q3).

### Bug 10 (ledger 10): the console Pause check broke extracted tests (fork)

1. 9a34a4c1 (fork) makes `returnCombatActive` and `isAttackingPartyMember` call
   `consolePauseHolds` (fork shared.js:3652, 14847).
2. Unit tests load a hand list of named functions into a VM (fork
   scripts/tests/passive-hunting.test.cjs:20-31, `names` at :28), so the new helper was
   missing there and the functions threw.
3. 250c61e1 (fork) adds `typeof consolePauseHolds === "function"` guards at both calls.

Root: the 18,047-line closure (shared.js) can only be tested by slicing functions out of
it, and the fact "this monster attacks the party" carries travel and Pause policy. The
guard keeps both. Ryan's base added the earlier exceptions inside
`isAttackingPartyMember` in five commits (review/full/combat.md section 4: 9fbeadab,
703d13af, 2a7b45e6, 8e4a6cf0, d640fd58).

### Bug 3 (ledger 3), targeting parts (fork)

- **3c. Pull mode leaves the puller exposed.** `choosePuller` takes the longest range of
  at least 100 (fork runtime/combat/pulling.ts:21-24). The puller attacks raw from the
  movement tick when `can_attack` is true (fork shared.js:18517), outside `permitted`,
  the reflection block and the grouped gate. Once the monster targets the party every
  member holds for its arrival (`pullHoldsForArrival`, fork shared.js:17637); a monster
  that stops short holds them (patched by c13ff2d1 on 21b8362d with an 800 ms / 5 s
  release).
- **3f. The mage becomes puller after the healer dies.** With the priest dead only the
  mage has range of 100 or more (fork pulling.ts:21-24; class ranges per review C36).
  4ce3dcdd (21b8362d) holds pulls while the tank or a priest is dead; `choosePuller` is
  unchanged.
- **3e. The tank kites into packs below 50%.** Below 50% HP `tankHoldsTarget` releases
  (fork shared.js:18542-18548), or the off tank takes aggro at `endangered` or below 50%
  (fork tank-handoff.ts:15-22). The kite (`kiteIfNeeded`, spec 02) then steps around the
  attacker, and the step check rejects only monsters targeting this character (review
  C21; fork shared.js:18057-18059). Inference: a step lands inside an idle Targetron's
  aggro range. Patched only in pull mode (754a9179).

### Patchwork in Ryan's base

- **P1. Five eligibility gates.** `isAllowedTarget` (14705-14770), `permitted`
  (attack-controller.ts:96-123), `groupedAttackAllowed` (14459-14474), skills
  `authorized` plus `skillTargetAllowed` (runtime.ts:59-67, shared.js:17737-17747) and
  `rareAttackAllowed` (3632-3642). Passing targets use only `consoleDrainAllows`
  (17945). Each reads a different subset of travel, return, Franky and rare state.
- **P2. Named special cases in `isAllowedTarget`.** Graveyard (14706), Franky (14713,
  14729), fieldgen0 (14730), tinyp (14735), Horseman/Gargoyle (14741-14742), Goo Brawl
  (14758, 14765). Each was a separate commit (review section 4 lists 23 commits on the
  function).
- **P3. Goo Brawl type list repeated** at 12976, 14051, 14765.
- **P4. Facts carry policy.** `isAttackingPartyMember` folds three travel exceptions into
  the threat fact (14003-14005), so callers that want the plain fact (Taunt,
  `groupedThreatReports`, `isAllowedTarget`) all get travel policy.
- **P5. Two threat models.** The skill engine's `incomingDps`/`endangered`
  (damage.ts:50-67) ignore the travel exceptions of P4.
- **P6. Reflector list in code** (bug 16) and a porcupine and crab subsystem each keyed
  on one monster name (porcupine-equipment.ts, crab-range.ts:13).
- **P7. Many time windows.** 60 s passing memory (3366), 10 s killed list (runner.ts:335),
  3 s report freshness (grouped.ts:66), 1000 ms peer readiness (14457), 5 s pursuit idle
  (pursuit.ts:69), 8 s absence (lost-target.ts:19, unseen-primary.ts:41), 5 s neutral
  reset (reset-fight.ts:21), 3 s successor grant (successor-grant.ts:89).

## 3. Fork differences

| Feature | Commits | Changes here | Patches |
|---|---|---|---|
| Designated tank and hold | 7bd14d7c, 4075d3f2, 0f600a8f | `ownsAggro` and `mayTaunt` move from leader to tank (fork eligibility.ts:81, warrior-combat.ts:31-33), `absorbDecision` tank owner (fork protection.ts:6-7); hold hooks in movement | Fonze walk-in (ledger 4) |
| Off tank | ae116693 | `offTankActive` handoff at endangered or 50%, return at 80% with no attackers (fork tank-handoff.ts:15-22); `aggroTank()` 250 ms cache | tank dying alone; no class check on the off tank (review N3) |
| Pull mode | 62ab06e5, 6c80aa4a, 754a9179, 8dec6e68; 21b8362d: 3365dd57, c13ff2d1, 4ce3dcdd, 2b8414cc | `queueCandidates` returns none in pull mode (fork shared.js:15118), raw pull attack (18517) | Targetron packs; eight follow-ups in two days |
| Achievement Hunt boss zones | cf7cba08, b5a7c68c, 45344db5 | `isAllowedTarget` rejects targets in an avoided boss zone (fork 15597, 15610) | walking into boss aggro |
| Console Pause | 9a34a4c1, 250c61e1 | Pause counts as return mode and changes `isAttackingPartyMember` (fork 3652, 14847) | moving while the console reloads; bug 10 |
| Franky routines | d6f67a97 | off tank waits 5 s before attacking Franky (fork 15579) | aggro race at spawn |
| Reflection from data | d988fcbd (21b8362d) | reads `reflection` | bug 16 |

## 4. Tests today

Test counts per file: `grep -cE "^\s*test\(" scripts/tests/<file>.test.cjs` on the ref.

| Test | Proves | Does not cover | Accurate | Guards a patch |
|---|---|---|---|---|
| monster-attack-policy (6 tests) | porcupine and reflection rules, damage type order | monsters outside the list (bug 16) | yes for the list | no |
| combat-claims (6) | external claims, Taunt guard, cooperative bosses | travel exceptions | yes | no |
| unfinished-target-boundary (4) | exact unfinished target outside bounds | other gates | yes | yes (deadlock fix) |
| combat-queue (36) | coordinator queue ranking, claims, pursuit, lost targets | live timing | yes | several guard specific fixes |
| successor-handoff (16) | grant and promotion | live round trips | yes | no |
| nomination-retention (8), unseen-primary (3) | retention and release rules | - | yes | no |
| passing-admission (13), passing-index (4), passive-hunting (22) | passing encounters | grouped targeting while walking | yes | several (handshake fixes) |
| fight-death-packets (3) | death sockets release ids | - | yes | yes (stale listeners) |
| porcupine-equipment (9), crab-range (5) | single-monster subsystems | other monsters | yes | yes |
| priest-formation, combat-movement (selection tests) | runner selection with stubs | real `isAllowedTarget` ordering | yes for stubs | partly |
| e2e live-hunt-* specs | full stack on the test server | no assertion per gate | not reviewed in this pass | - |

No test asserts the full ordering of `isAllowedTarget`. No test covers `nearestEventTarget`
for boss events (only Franky and Goo Brawl paths). No test covers Targetron reflection.

## 5. Needs your review

- **TGT-Q1. Who may pull?** (a) only the tank; (b) the longest-range living member (fork
  today); (c) the longest range among warrior, ranger and paladin, never the healer or
  mage.
- **TGT-Q2. Off tank class.** (a) only a class with an aggro skill (warrior Taunt,
  priest Absorb) can be off tank; (b) any class (today).
- **TGT-Q3. Reflection threshold.** (a) block magical basic attacks on any reflection
  (21b8362d); (b) only above a threshold such as 10% (greenjr 4%, sparkbot 8%,
  iceroamer 8% stay allowed); (c) per-monster setting.
- **TGT-Q4. Threat fact vs travel policy.** Should a passing monster that hits the party
  count as a threat (a) always; (b) only on return trips (today); (c) never.
- **TGT-Q5. Aggro owner.** (a) leader (Ryan); (b) designated tank (fork); (c) tank, then
  leader when no tank is set.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, `LIMIT=100000`), filtered to this spec:
claimed by more than one spec 0, claims naming no known function 0, behaviours with no
test 0. `catalog/04-targeting.json`: 315 functions in 18 behaviours (149 of them from the
combined proposal, 36 from triage).

- Proposed elsewhere and not claimed: `walkingPassiveTarget`, `passingTravelAllowed`,
  travel defence helpers, `kiteIfNeeded`, `safeCombatPoint` (02-movement);
  `passiveRareCandidate`, `rareActive` (07); `frankyCombatActive` (06). The behaviour text
  cites them; the coordinator decides where they live.
- Not verified: class ranges behind 3f (from review C36); fork line numbers in section 2
  and 3 come from review/full/combat.md and were spot-checked for `choosePuller`,
  `tankHoldsTarget`, `offTankActive`, the pull attack and the Pause guards only.
- Not reviewed: e2e live-hunt specs for accuracy.

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
