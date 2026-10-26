# 04 Targeting (TGT)

Checked against the current console `refs/review/ryan-1.5` (b9b5c91e). Line numbers are on
that ref unless a line says "fork" (af92de45, `HEAD` in
(local checkout)) or "21b8362d" (the death fixes in
(local checkout)). Bare `x.ts:N` paths are files named in the
behaviour; bare line numbers are characters/shared.js. Game data: AL MCP v18183. Game
server rules: (local checkout) (43b2c8fc).
The claim-by-claim check of this page is docs/implementation/05-verification-03-05.md.

This part owns one question: what each character attacks or avoids. It covers the
character's own selection (role runner and `sharedRoutine` target finders), the
eligibility gates read at selection and at attack time, threat facts, aggro transfer
skills, passing encounters while walking, and the coordinator's grouped queue that picks
one target per group. Which action spends the attack cooldown is spec 03; movement toward
the target is spec 02.

## 1. What it does today

### Character selection

- **TGT-001 Selection loop.** `selectTarget` (runner.ts:158-195) runs every 1 s
  (runner.ts:334-337), on `wake` (:317), and on `invalidateTarget` (:309-316), which also
  adds a given id to the killed list. It clears the selection while `combatAllowed()` is
  false (:160-165; `combatAllowed` at :84-93: active, alive, the class role fights, a
  merchant only in its event, not occupied, not A/B pending or feed). A console drain
  keeps the current target (:167). Outside exclusive combat (dungeon, return defence,
  Franky; `exclusiveCombat` :149-151), a closer Hunt target replaces a target with no
  attack started (:168-174, `getCloserHuntTarget` 17957-17969). A valid current target
  stays unless a priority event, rare, dungeon or grouped nomination differs (:175-180).
  Otherwise `chooseTarget` (:133-135) takes the priority event target (Mr. Green,
  Mr. Pumpkin, Horseman; 17971-17973) unless combat is exclusive (:136-138), then
  `fallbackTarget` (:139-148) in order: dungeon target, return defence, Franky event
  target, merchant role, grouped target when grouped farming (`usesLeaderTarget`, 17997),
  rare target, class role. `eligibleSelection` (target-state.ts:11-13) and the 10 s killed
  list (runner.ts:53, 335) filter it. `publishSelection` (:152-157) stores the id (or the
  shared queue id when nothing is selected outside exclusive combat), calls
  `setCombatTarget` (TGT-020), and follows the leader within 150 when nothing is selected
  outside exclusive combat, scatter and grouped combat. `currentTarget` (:109-121)
  re-validates every read with `targetRejection` (target-state.ts:3-10, reason text from
  `targetRejectionReason` 17576-17581) and writes the reason to `partyCombatState`; in
  return mode it returns `returnDefenseTarget` (:110). `attackTarget` (:102-108) swaps in
  the passing target when its priority is higher. `advanceTarget` and `resetTargeting`
  (:318-319) bump the epoch and clear the selection.
- **TGT-002 Class target choice.** Default role (default.ts:5-18): scatter-break target
  (engaged first), event target, scatter target in scatter mode, else the leader target
  (or the engaged monster) when following, else the preferred target. Its `beforeTarget`
  and `beforeAttack` do nothing (:19-24). Warrior (warrior.ts:22-31): scatter break, then
  in scatter mode the event or scatter target, else `partyTarget` (:9-14): event target,
  nearest party attacker, nearest party target, then leader or preferred. Merchant: event
  target only (merchant.ts:6).
- **TGT-003 Target finders** (shared.js). `getLeaderTarget` (17786-17803): engaged monster
  while departing or bank-queued, grouped target for a grouped follower, nearest party
  threat in a convoy, else the leader's reported target. `getPreferredTarget`
  (17878-17910): rare target, nothing during Town, an allowed engaged monster, nothing
  while departing or bank-queued, scatter break, convoy threats or the nearest focused
  monster, party threats by priority then distance, else the nearest focused monster.
  `getNearestFocusedMonster` (17804-17877): visible focused types, not known dead, not
  fieldgen0 or tinyp, not externally claimed, not failed-approach, inside the farm area
  (`selectFarmCandidates`, 14913-14921: the Hunt type within the search radius, the farm
  zone candidates, or the bounded area with a radius fallback), highest priority tier
  then nearest. With `excludePartyTargets` each member takes its rank in a name-sorted
  member list from an id-sorted target list (17830-17845). With no candidate it falls back
  to the game's path-checked `get_nearest_monster` inside the farm area or radius.
  `getScatterTarget` (17911-17938): nothing during Town, an allowed engaged monster, a
  higher-priority focused monster than the scatter type, then a monster attacking this
  character, then the nearest scatter-type monster not taken by another member.
  `getGroupedTarget` (17999-18006): the rare target outside grouped farming; else the
  protocol-4 lock target (or the leader selection), kept only in range during an
  unfinished fight; else the grouped defensive target; else the lock target out of range.
  `engagedMonster` (14821-14837), `getNearestPartyAttacker` (14015-14028),
  `getNearestPartyTarget` (14030-14042), `visibleFocusedMonsterWithinRadius`
  (14962-14973), and the accessors `getMonsterFocus` (17951), `hasScatterBreakTarget` and
  `getScatterBreakTarget` (18013-18020).
- **TGT-004 Monster priority.** `monsterPriority` (14776-14784): an enabled passive rule's
  priority, tinyp 101, phoenix, goldenbat, cutebee, hen and rooster 100 when they are
  passive rare candidates or a rare hunt is active, else the saved `monsterPriorities`
  value, default 50. Settings: monster priorities and passive hunting rules.
- **TGT-005 Event, Franky and dungeon targets.** `nearestEventTarget` (12955-13047)
  returns nothing for an unselected event (12956). Franky during attendance: the retained
  Franky, else the nearest (`frankyTargetAllowed`, 12924-12928). A/B opponent. Mr. Green,
  Mr. Pumpkin and Horseman prefer adds: the leader's add (with a leader report under 3 s
  old), the retained add, then by id; Horseman adds are jackowalkers. Goo Brawl takes the
  nearest Rainbow Goo as soon as one is visible, else the leader's goo, the goo with most
  party selections, the retained one, the nearest. Other events by event type order then
  distance. Dungeon: `dungeonTargetAllowed` (2608-2616), `getDungeonTarget` (2617-2625),
  `dungeonCombatThreat` (2626-2631), `dungeonEncounterEnemy` (2632-2638).
- **TGT-019 Death packets.** `combatDisappearListener` (1065-1071) acts only on a
  disappear marked as a death; `combatEntitiesDeathListener` (1072-1078) acts on an
  entities packet for this instance with a dead or 0 HP monster. Both call
  `reportFightDeath` (TGT-031) and `invalidateTarget`. `combatDeathListener` does the same
  for any id other than the character (1081-1083; the rest is spec 05).
- **TGT-020 Published selection state.** `setCombatTarget` (18026-18037) calls
  `publishCombatSelection`, stores `combatTargetId`, changes the game target for a
  porcupine, and records the last farmed type. `publishCombatSelection` (14685-14693) runs
  only for the target leader, never during an unfinished fight, and bumps the selection
  revision when the id or map changes; `clearCombatSelection` (17998) clears it.
  `combatTargetRevision` (18007-18012) gives the dungeon, protocol-4 or leader revision
  that the attack controller compares (spec 03). `sharedTargetId` (17633) is the grouped
  queue target id. `noteAttack` (18038-18044) records the last attack and drops the target
  id when another player claims the monster.

### Eligibility and threat

- **TGT-006 `isAllowedTarget`** (14705-14770), 28 checks in order: excluded Graveyard type
  (TGT-022); console drain (TGT-021); cave or dungeon runtime -> dungeon rule; return mode
  -> `returnAttacker`; Franky attendance -> Franky only; travel combat owns combat unless
  Hunt travel or a departure target (TGT-024); Hunt loot pending -> attackers only; missing
  target; passive max level (unless attacking, unfinished, event or focused); passing
  encounter -> rejected; death recovery owns targets unless `finishing` and listed; known
  dead; Franky -> allowed; fieldgen0; unfinished fight during Hunt travel; leader lock
  outside Hunt travel (`leaderLockAllows`, 14679-14684); tinyp only as the rare target;
  rare target -> allowed; a character only as an A/B opponent; external claim or not a
  monster (`isExternallyClaimedMonster`, 14044-14055); Horseman and Gargoyle only in their
  event unless attacking; failed approach on Hunt travel; passive rare candidate ->
  allowed; attacking the party -> allowed; farming engagement inside the area; exact
  unfinished target; farm area or radius (150 units of slack for the last attacked target
  within 5 s, or an eligible retained queue nomination) unless Hunt travel, a nearby Hunt
  type, the Goo Brawl map, an active or joined event, or a party threat; finally the target
  must be a Hunt travel target, the current target, a convoy or party threat, the scatter
  break, an event type (Goo Brawl types on its map), the scatter type, the leader's target
  when following, or a focused type ("all" included). Settings: monster focus, farm area,
  passive rules, Graveyard monster list, events.
- **TGT-021 Console drain gate.** While a safe console reload drains, `consoleDrainAllows`
  (2426-2428) allows only a target listed in `__partyConsoleDrainTargets` under
  `consoleDrainKey` (2423-2425) or a monster attacking the party.
  `consoleDrainCombatActive` (2429-2432) says whether such a monster is still visible.
- **TGT-022 Graveyard exclusion.** `excludedGraveyardTarget` (14695-14698): with the
  Graveyard event selected, a zombie, ghoul or gargoyle that is not in the event's monster
  list and not attacking the party is not a target. `graveyardAreaAttackAllowed`
  (14699-14704) refuses an area attack while such a monster is within its range.
- **TGT-007 Threat facts.** `isAttackingPartyMember` (14001-14013): a monster whose live
  `target` is this character, or a party member (Cave members inside a Cave) on the same
  map and A/B team. A passing encounter counts only while return-departure defence or a
  continuous Hunt return holds and its passive rule is not keep-moving (14003-14005).
  `isCurrentPartyTarget` (13988-13995), `isPartyThreat` (13997-13999, never a passing
  encounter), `returnDepartureDefense` (14057-14061).
- **TGT-023 Party threat and target lists.** The heartbeat response builds `partyThreats`
  from the threats of every member except the leader and `partyTargets` from every
  member's target, each id once (`uniqueReferences`,
  runtime/coordinator/status/response-party.ts:36-43, used at :82-90).
- **TGT-008 Return-trip defence.** `returnCombatActive` (3434-3438) holds during a
  continuous return convoy, an anniversary staging operation or an event recovery cycle,
  unless dead, cancelled, escaping or in death recovery. Then only `returnAttacker`
  monsters (3439-3442) are targets, in range first then by id (`returnDefenseTarget`,
  3443-3447), a Town cast under attack is cancelled (3448-3456), and skills are limited
  (`returnTargetBlocked`, runtime.ts:72-74).
- **TGT-009 Attack-time gates.** `permitted` (attack-controller.ts:96-123): target still
  eligible (`allowsTarget`, or `allowsPassingTarget` = `consoleDrainAllows` for a passing
  target, 17945), no weapon swap, not disabled, grouped readiness except for a passing
  target (`groupedAttackAllowed`, 14459-14474), damage-type block (TGT-010), rare policy
  (TGT-013). `groupedAttackAllowed`: console drain, dungeon commitment, return attacker,
  formation recovery blocks, travel combat and Hunt loot (departure targets only), then in
  grouped farming only the protocol-4 lock target on this realm, map and instance: allowed
  when engaged; refused while a pursuit is being revoked; otherwise it needs a fresh
  committed group, independent readiness (`independentPullReady`, 14442-14452;
  `independentPeersReady`, 14453-14458: every member ready within 1000 ms), and no other
  monster attacking the party unless the target is pending. Skills use `authorized`
  (runtime.ts:59-67: return and Franky vetoes, damage-type block except Taunt,
  `targetAuthorized` :68-70 = `skillTargetAllowed` 17737-17747 plus `rareAttackAllowed`,
  and in scatter mode an untouched monster is refused when 2 s of the added damage would
  leave the caster under 30% HP) and `targetBlock` (eligibility.ts:43-52: living, not self
  when the skill forbids it, in range, hostile targets authorized and not immune unless the
  skill pierces, plus `safePull`).
- **TGT-024 Departure engagement.** `departureTargetEngaged` (14878-14905): a visible
  living monster that attacks the party, or a Hunt travel defence target, keeps travel
  defence until a death of that id is recorded in the same realm, map and instance (the
  index is rebuilt only when the death list or place changes). `departureCombatPending`
  (14906-14908) says whether any visible monster qualifies.
- **TGT-010 Damage return and reflection.** `monsterAttackBlock`
  (monster-attack-policy.ts:24-35): a porcupine refuses any attack that is not magical or
  pure when the range stat is not at least 75; `slenderman`, `tiger` and `goblin` (hard
  list, :3) refuse any attack that is not physical or pure, unknown types included. Basic
  attacks pass the attacker's type: the native field, then the mainhand weapon, then the
  class (:12-21). Skills pass the skill's type (runtime.ts:61-62).
- **TGT-011 Porcupine bow swap.** `createPorcupineEquipment` (porcupine-equipment.ts:
  32-138) equips the highest-level usable bow (clearing the offhand for a two-handed bow)
  while the character's attack is porcupine-blocked and its target is a porcupine. The
  session lives on the game host so a code reload keeps it, the original hands come back
  on departure except for a grouped approach, and a failure retries after 2 s. Installed
  per character (porcupine-equipment-runtime.ts:4-43); the movement tick drives it
  (runner.ts:200-204, 216) with `equipmentTarget` (18021-18025).
- **TGT-012 Crab range correction.** After a `too_far` rejection on a crab whose drawn box
  is more than 1 unit larger than `G.dimensions.crab` (crab-range.ts:12-17), while the
  native distance is in range and the corrected one is not, the controller uses the
  corrected distance for 30 s with a 500 ms retry (crab-range.ts:44-50). A target change,
  expiry or agreeing geometry resets it. `describeAttackRange` (17338-17350) samples the
  geometry.
- **TGT-013 Tiny Pixie and Fairy policy.** `rareAttackAllowed` (3632-3642): never
  fieldgen0; any other non-tinyp target is allowed. On tinyp a basic attack needs a melee
  hit or a projectile landing within 300 units of a live field generator
  (`tinyProjectileProtected`, 3620-3631, projectile from `nativeAttackProjectile`
  3608-3619); a passing tinyp allows basic attacks only; the rare target allows basic
  attacks only, and only when this character is not the Fairy deployer. Skills on tinyp
  are refused. `rareTarget` (3601-3607), `ownedRareTarget` (3591-3600).
- **TGT-025 Coordinator Phoenix patrol nominations.** During an active Phoenix patrol
  with acquisition allowed (`patrolMembers`, grouped-snapshot.ts:221-224), each member's
  fresh, same-place Phoenix sightings join its candidates at priority 100.5 as passive
  rares (`phoenixCandidates` and `validObservation`, phoenix-candidates.ts:5-24).

### Passing encounters

- **TGT-014 Passing attacks while walking.** `passingTarget` (3457-3490): a keep-moving
  passive target first (`walkingPassiveTarget`, spec 02), none in return mode, a
  convoy-hold defence target, then only while travel allows (`passingTravelAllowed`). On
  an outbound Hunt trip a second attacker interrupts the convoy instead, and a passing
  attack needs a Hunt travel control under 1 s old with no reason and no defence
  (3466-3470). Nothing below 35% HP, as a merchant, after a cancel, during escape,
  recovery, Town, banking, stocking, upgrading, gathering, forced, Town or event travel, an
  event, a rare hunt other than a patrol, or an unfinished fight outside a return
  (3474-3476). Candidates are in range, alive, not fieldgen0, not claimed, not the
  committed Hunt encounter, not the grouped target outside returns, and either the Hunt
  travel primary, a defending attacker on a return, the Hunt target type, or an enabled
  keep-moving rule within its level cap (`passiveLevelAllowed`, 3491-3494). Sorted by
  party targeting, priority, distance, id. `isPassingEncounter` (3333-3372) remembers an
  encounter for 60 s per realm, map, instance and id (`passingKey`, 3319-3322) from its own,
  peer and coordinator lists unless a death was seen; it is never true for the committed
  Hunt encounter, during Hunt travel defence (keep-moving rules aside) or for a required
  stop. `passingEncounterReport` (3323-3332) prunes and sends at most 128.
  `beginPassingAttack` (3520-3536) reserves it, and for a tinyp within 200 units equips a
  field generator after a delay of 1 s per name rank. `committedHuntEncounter`
  (3294-3300). Settings: passive hunting rules (enabled, keepMoving, priority, maxLevel),
  field generator use.
- **TGT-026 Passing admission handshake.** `passingControl` (passing-admission.ts:28-41)
  builds a scope from the convoy and members and admits an encounter token only when every
  member's acknowledgement under 3 s old lists it; during Hunt travel only the primary or a
  keep-moving rule qualifies. `createPassingAdmission` (:43-73) proposes a token, reserves
  the encounter, and lets a member fire only on an admitted token from a control under
  1 s old. The heartbeat response sends it (`passingAdmission`,
  runtime/coordinator/status/response.ts:234-239).
- **TGT-027 Coordinator passing encounter merge.** `collectPassing` (passing.ts:41-47)
  keeps the newest report of each encounter and token from members seen within about 3 s,
  drops one with a death at or after its start, and keeps at most 128 for 60 s (:10).
  The heartbeat response sends the merged list (`passingReports`, response.ts:231-233).

### Aggro

- **TGT-015 Aggro transfer.** Only the party leader owns aggro skills: `ownsAggro`
  (eligibility.ts:72-74) for absorb, taunt and agitate. Warrior Taunt (`mayTaunt`,
  warrior-combat.ts:31-36): leader, level, a monster other than tinyp attacking a party
  member but not this warrior, or an untouched porcupine, that `allowsTarget` accepts
  (:37-44), ready through the engine or by MP, cooldown and range (:45-48); cast from
  `beforeAttack` (warrior.ts:32-43) through `castCombatSkill` (category survival) or raw
  (`taunt`, :3-8). Priest Absorb (`absorbDecision`, protection.ts:5-13): leader priest, MP
  for one heal left after the cast, the lowest-HP ally in range being hit whose damage the
  priest can take safely (`safeTransfer`, spec 05). `absorbSinsBelow` (13857-13860) calls
  it through the skill runtime. `isLeader` (17713). Game data: Taunt is warrior only and
  Absorb Sins priest only (`get_game_data skills taunt` and `absorb`).

### Coordinator grouped queue

- **TGT-016 Character queue report.** The leader nominates focused monsters in its farm
  area (`queueCandidates`, 14269-14299); followers nominate only the Hunt target type and
  passive rares; in a Cave every member nominates dungeon threats; a farming engagement
  nominates only its target. Nominations are blocked during travel intent, departure loot,
  convoy defence or travel, non-grouped combat, manual navigation and death recovery
  (14279-14282). Each report (`queueReport`, 14323-14329, sent through `queueRequest`
  17628) carries the leader's nomination (`groupedNomination`, 14419-14423), threats
  (`groupedThreatReports`, 14173-14181, including a defensive hit under 3 s old),
  sightings (`groupedSightings`, 14182-14189), claims (`queueClaims`, 14387-14398),
  retentions (`queueRetentions`, 14303-14322), acknowledgements (14424-14428, 17630-17632),
  anchor visibility (14429-14434), evidence, deaths and travel facts. The same group
  readers serve the rest of the character: `groupedFresh` (14137-14143, 3 s),
  `unfinishedFight` (14190), `groupedDefensiveTarget` and `groupedDefensePending`
  (14191-14199), `engagedCombatTarget` and `activeCombatTarget` (14200-14209),
  `independentPullActive` (17634), `queueMembers` and `queueClockOffset` (17626-17627).
- **TGT-028 Apply coordinator combat control.** `acceptCombatControl` (14330-14382) takes
  the console maintenance lease, the Hunt travel control (logging a new primary and
  interrupting the convoy for a passive stop), peer passing encounters under 60 s, rare
  control, the farming engagement, travel combat (resetting targeting on a new travel id
  or revision), convoy defence, a combat reset (which clears the group, the selection and
  failed approaches) and death recovery state. `acceptQueue` (14248-14268) installs the
  group snapshot unless it is older, and on a head change cancels approach routes and
  advances targeting.
- **TGT-029 Queue client transport.** `installQueueClient` (client.ts:13-168) ticks every
  100 ms and on native `player` and `entities` events (:148-154), sends the combat report
  when its signature changed or 1 s passed (:134-135), long polls the coordinator
  (`wait`, :103-109, 1 s backoff on error), and applies each reply (`apply`, :88-102:
  combat control, passing control, stale evidence removal, the queue, then a flush when
  the acknowledgement changed). It also drives the independent approach, formation and
  sight recovery clients and prepares passing admission ahead of a keep-moving target
  (:126-127, 155-164).
- **TGT-030 Full entity snapshot refresh.** `createEntityRefresh` (entity-refresh.ts:22-40)
  asks the game for `send_updates` (runner.ts:39-48) after 5 s with a target and no
  accepted basic attack, at most every 10 s, and reports it to `partyCombatState`.
- **TGT-031 Fight evidence.** The queue client records attack actions as pending, engaged
  or rejected (`evidence`, client.ts:46-66; `queueEvidence` 17635), settles pending actions
  on a party hit (`hit`, :67-79), drops evidence for passing encounters and confirmed
  deaths (`reportEvidence`, :39-43; `retireDeadEvidence`, evidence.ts:9-15), and keeps a
  32-entry trace (:33-38). `reportFightDeath` (14144-14152) records a death for 60 s,
  notes a grouped target death and flushes the report.
- **TGT-032 Defensive hit.** `defendPartyHit` (970-991): outside a continuous Hunt return,
  a monster hit on a party member, unless it is splash from a fight with another player, an
  event is joined or event types are set, or it is a passing encounter (outside
  return-departure defence for a non-keep-moving rule), records `__partyDefensiveHit`,
  interrupts the convoy for defence and records engaged evidence.
- **TGT-017 Coordinator queue.** `evaluateGroup` (grouped.ts:56-141) picks a priest anchor
  (`healingAnchor`, composition.ts:9-12), marks members participating or recovering,
  waits 500 ms of stable readiness (:92-93), and calls `reconcileQueue` (queue.ts:12-108):
  tombstones (last 512, :32), claims (TGT-036), evidence to fights, threats to engaged
  fights, lost targets (TGT-035), candidates by priority then leader distance then id
  (:84), retained nominations (nomination-retention.ts:6-24), a passive rare above a
  planned target, pursuit (TGT-034), and a locked current and next pair
  (locked-pair.ts:10-23). Commitment needs every participant's acknowledgement of the
  selection, a previous commitment or a pre-acknowledged queue (grouped.ts:114-121).
- **TGT-033 Successor grants.** `authorizeSuccessor` (successor-grant.ts:53-62) issues a
  grant for the second queue entry, renewed for 3 s at a time (:82-91), while the group is
  ready, committed and every member acknowledged the pair, and within the Hunt kill budget
  (:25-31, 40-50). A grant that no longer fits is revoked until every recipient
  acknowledges or it expires (:63-81). The client (`createSuccessorClient`,
  successor-client.ts:11-67) promotes the successor on the predecessor's death without a
  round trip, if `successorAllowed` (17592-17602) and `successorVisible` (17603-17606)
  hold. The coordinator's policy (grouped-snapshot.ts:172-191) refuses grants during
  travel, a convoy, an event return or an unfinished anniversary cycle.
- **TGT-034 Pursuit revocation.** `trackPursuit` (pursuit.ts:103-115) follows an ordinary
  planned target. After 5 s without approach progress by any member (:52-57, 67-72;
  progress is 8 units of deficit, coverage or waypoint), or at once when a closer eligible
  Hunt or ordinary candidate appears (:80-101), it revokes the pull, waits for every client
  to acknowledge (:58-66), then replaces the target; a stalled target is excluded for 10 s.
- **TGT-035 Lost and unseen targets.** `recoverLostTargets` (lost-target.ts:6-24) retires a
  fight after 8 s of absence once every member observed the place and nearby observers
  covered at least 1 s. `releaseUnseenPrimary` (unseen-primary.ts:22-34) releases an unseen
  primary after 8 s of shared absence when a visible alternative exists (:35-42).
- **TGT-036 Claims and neutral reset.** `reconcileClaims` (claims.ts:5-31) keeps the newest
  claim per monster from restored and fresh reports, with external claims winning ties.
  `releaseResetFights` (reset-fight.ts:18-32) releases an engaged fight older than 5 s when
  no member reports it active and every sighting shows it neutral at full HP.
- **TGT-037 Coordinator grouped snapshot.** `groupedCombatSnapshot`
  (application.ts:2416-2429) calls `coordinatorGroupedSnapshot`
  (grouped-snapshot.ts:110-129): the Cave uses its own combat, a cancelled leader clears
  the group, an event on the leader keeps it, and plain scatter clears it. Otherwise
  `evaluateParticipants` (:131-171) takes the leader and assigned followers except the
  merchant (:57-67), evaluates them with the Hunt target, finalizes through death
  recovery, authorizes a successor, and logs formation changes (:69-95, at most 200
  entries) and unseen releases (:212-220).
- **TGT-038 Retire targets at boundaries.** After an event ends and every member reports
  fresh, `retireEventTargets` (grouped-snapshot.ts:265-314) drops pre-event queue targets
  no member sees. During travel, `defensiveMembers` (:229-239) empties candidates and
  keeps only current attackers as threats, and `retireTravelTargets`
  (travel-defense.ts:214-228) releases fights and queue entries with no current attacker
  or travel commitment, logged by `logTravelRetirement` (grouped-snapshot.ts:240-246).
- **TGT-018 Hunt travel encounters.** `updateHuntTravel` (hunt-travel.ts:124-133), for an
  interruptible convoy without a Hunt arrival, reconciles retirements, commits stop targets
  from passive stop rules (`passiveStopRequired`, passive-travel.ts:4-7 and
  shared.js:3387-3389: an enabled rule with keepMoving false), keeps or releases the
  primary attacker, and returns a control for an outbound Hunt trip or any trip with a
  committed stop. An anniversary return keeps only the first attacker (:136-139).
  `huntDefenseMembers` (grouped-snapshot.ts:192-203) passes the result into the group.

### Settings that change this part

Monster focus, farm area, monster priorities, passive hunting rules (enabled, keepMoving,
priority, maxLevel), field generator use, the Graveyard monster list and selected events,
farming mode (scatter or default). None of the time windows or HP thresholds above is a
setting.

## 2. What goes wrong

### Bug 16 (ledger 16): Sparkbot reflection is not in the reflector list

1. `reflectors` is a hand-kept set of three names (monster-attack-policy.ts:3).
2. `monsterAttackBlock` blocks magical attacks only for those names (:32-33); skills use
   the same function with the skill's damage type (runtime.ts:62).
3. Game data has a numeric `reflection` on eight monsters (MCP v18183,
   `search_game_data reflection`): goblin 99.95, tiger 100, slenderman 96,
   target_ar500red 50, xmagen 30, sparkbot 8, iceroamer 8, greenjr 4.
4. The server reflects a hit against resistance (a magical hit) with a chance equal to
   `reflection` percent. A reflected hit sends 90 to 110% of the damage back to the
   attacker as a projectile and does no damage to the monster
   (al-server node/server.js:3816-3840).
5. A mage or priest that basic-attacks a Sparkbot has about 8% of its hits come back to it
   in full and lands no damage with those hits.

Finding W2 in the same chain: `target_ar500red` reflects half of the magical hits and is a
Targetron, the monster family of the ledger 3 farm. Inference, not measured: a mage in that
farm took about every second hit back, which adds to bug 3's deaths.

Patch: d988fcbd (21b8362d) reads `G.monsters[mtype].reflection` and blocks magical basic
attacks for any value above 0. That fixes the list at source; blocking greenjr at 4% is a
policy question (TGT-Q3).

### Bug 10 (ledger 10): the console Pause check broke extracted tests (fork)

1. 9a34a4c1 (fork) makes `returnCombatActive` and `isAttackingPartyMember` call
   `consolePauseHolds` (fork shared.js:3652, 14847).
2. Unit tests load a hand list of named functions into a VM (fork
   scripts/tests/passive-hunting.test.cjs:20-31, `names` at :28), so the new helper was
   missing there and the functions threw. The 250c61e1 message names
   passive-hunting.test.cjs and event-return-turnover-hold.test.cjs.
3. 250c61e1 (fork) adds `typeof consolePauseHolds === "function"` guards at both calls.
   9f244b62 (fork) adds the same kind of guard for `pullModeActive` in `queueCandidates`.

Root: tests reach the 18,047-line closure (shared.js, `wc -l`) only by slicing functions
out of it, and the fact "this monster attacks the party" carries travel and Pause policy.
The guard keeps both. In the current console the passing exceptions inside
`isAttackingPartyMember` came from four commits (`git log -L` on the function): 9fbeadab
(passing encounters never count), 703d13af (return-departure defence), 2a7b45e6
(continuous Hunt return), d640fd58 (keep-moving rules). 8e4a6cf0 added the Cave member list.

### Bug 3 (ledger 3), targeting parts (fork)

- **3c. Pull mode leaves the puller exposed.** `choosePuller` takes the longest range of
  at least 100 (fork runtime/combat/pulling.ts:20-24). The puller attacks raw when
  `can_attack` is true (fork shared.js:18517), from `pullMovementTick`, which the movement
  tick reaches through `recoverFarmApproach` (fork runner.ts:241, shared.js:16944). That
  is outside `permitted`, the reflection block and the grouped gate. Once the pulled
  monster targets the party, every member holds at the spot while the monster is farther
  than `max(120, range)` from it (`pullHoldsForArrival`, fork shared.js:18524-18530,
  called from `formationMove` at 17637). A monster that stops short holds them (patched by
  c13ff2d1 on 21b8362d: release after 800 ms standing still or 5 s after arrival).
- **3f. The mage becomes puller after the healer dies.** Class base ranges in game data
  are mage and priest 120, warrior 18, ranger, rogue and paladin 15 (a ranger's range
  comes from its bow). In the warrior, mage and priest party only the mage has range 100
  or more once the priest dies (fork pulling.ts:20-24). 4ce3dcdd (21b8362d) holds pulls
  while the designated tank or any priest is dead; `choosePuller` is unchanged.
- **3e. The tank kites into packs below 50%.** Below 50% HP `tankHoldsTarget` releases the
  hold (fork shared.js:18542-18548, thresholds at 18433), and the off tank takes aggro when
  the tank is endangered or below 50% (fork tank-handoff.ts:15-22). The kite
  (`kiteIfNeeded`, spec 02) then steps around the attacker, and the step check in
  `safeCombatPoint` looks only at monsters targeting this character (fork
  shared.js:18056-18062). Inference: a step lands inside an idle Targetron's aggro range.
  Patched only in pull mode (754a9179 adds the pull-mode check at fork 18048).

### Patchwork in the current console

- **P1. Five eligibility gates.** `isAllowedTarget` (14705-14770), `permitted`
  (attack-controller.ts:96-123), `groupedAttackAllowed` (14459-14474), skills
  `authorized` plus `skillTargetAllowed` (runtime.ts:59-67, shared.js:17737-17747) and
  `rareAttackAllowed` (3632-3642). At attack time a passing target checks only
  `consoleDrainAllows` (17945); its own filters are in `passingTarget` (3457-3490). Each
  reads a different subset of travel, return, Franky and rare state.
- **P2. Named special cases in `isAllowedTarget`.** Graveyard (14706), Franky (14713,
  14729), fieldgen0 (14730), tinyp (14735), Horseman and Gargoyle (14741-14742), Goo Brawl
  (14758, 14765). `git log -L` on the function lists 15 commits, 2 of them merges; for
  example 457a9a81 added the Horseman and Gargoyle rule and dd7a3766 the Franky focus.
- **P3. Goo Brawl type list repeated** at 12976, 14051, 14765.
- **P4. Facts carry policy.** `isAttackingPartyMember` folds the passing, keep-moving and
  two return-trip conditions into the threat fact (14003-14005), so its callers (Taunt at
  warrior-combat.ts:42, `groupedThreatReports` at 14176, `isAllowedTarget` at 14745) all
  get travel policy. Inference: at least Taunt wants the plain fact.
- **P5. Two threat models.** The skill engine's `incomingDps` and `endangered`
  (damage.ts:50-57, 64-67) count every monster whose target is the ally, without the
  passing and travel conditions of P4.
- **P6. Reflector list in code** (bug 16) and a porcupine and crab subsystem each keyed
  on one monster name (porcupine-equipment.ts:89, 96; crab-range.ts:13).
- **P7. Many time windows.** 60 s passing memory (3366), 10 s killed list (runner.ts:335),
  3 s report freshness (grouped.ts:66), 1000 ms peer readiness (14457), 5 s pursuit idle
  (pursuit.ts:69), 8 s absence (lost-target.ts:19, unseen-primary.ts:41), 5 s neutral
  reset (reset-fight.ts:21), 3 s successor grant (successor-grant.ts:89), 5 s entity
  refresh grace and 10 s spacing (entity-refresh.ts:33).

## 3. Fork differences

| Feature | Commits | Changes here | Patches |
|---|---|---|---|
| Designated tank and hold | 7bd14d7c, 4075d3f2, 0f600a8f | `ownsAggro`, `mayTaunt` and `absorbDecision` move to the designated tank when one is set, else the leader (fork eligibility.ts:81, warrior-combat.ts:31-35, protection.ts:6-7; all from 7bd14d7c); the hold releases below 50% and returns at 80% (fork shared.js:18433, 18542-18548) | 4075d3f2 replaces the ported tank step that walked the tank to 35 units of its target (commit message); ledger 4 |
| Off tank | ae116693 | `offTankActive` hands over when the tank is endangered, below 50% or gone, and back at 80% with nothing on the tank (fork tank-handoff.ts:15-22); `aggroTank()` caches the answer for 250 ms (fork skills/runtime.ts:116-118) | tank dying alone; any party member can be off tank, with no class check (ae116693 message) |
| Pull mode | 62ab06e5; then 6c80aa4a, 9f244b62, 754a9179, 8dec6e68; 21b8362d: 3365dd57, c13ff2d1, 4ce3dcdd, 2b8414cc | `queueCandidates` returns none in pull mode (fork shared.js:15118, from 6c80aa4a, guarded by 9f244b62), raw pull attack (18517) | Targetron packs; eight follow-ups in two days (2026-10-25 and 2026-10-26) |
| Achievement Hunt boss zones | b5a7c68c, 45344db5 (cf7cba08 for boss avoidance) | `isAllowedTarget` rejects an avoided boss (fork 15597) and a new pull inside a boss keep-out zone (fork 15610), both from b5a7c68c | walking into boss aggro |
| Console Pause | 9a34a4c1, 250c61e1 | Pause counts as return mode and makes passing encounters count as attackers (fork 3652, 14847) | moving while the console reloads; bug 10 |
| Franky routines | d6f67a97 | an off tank holds fire on Franky until someone else holds the boss for 5 s (fork 15578-15579) | aggro race at spawn |
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
| priest-formation (55), combat-movement (36) (selection tests) | runner selection with stubs | real `isAllowedTarget` ordering | yes for stubs | partly |
| e2e live-hunt-* specs (24 files) | full stack on the test server | no assertion per gate | not reviewed in this pass | - |

No test asserts the full ordering of `isAllowedTarget`; the tests that load it
(combat-claims, franky-combat, goobrawl-live-combat, queue-markers) each assert single
cases. Unit tests cover `nearestEventTarget` for Franky, Goo Brawl and a generic event boss
(hunt-event-priority.test.cjs, "dead or other-instance event entities cannot trigger the
combat handoff"); the Mr. Green, Mr. Pumpkin and Horseman add branch has no unit test, and
only the e2e "October Horseman retargets each native Jack-o-Walker wave before resuming
boss" (e2e/live-october-events.spec.ts) exercises it. No test covers Targetron reflection.
TGT-021, TGT-022 and TGT-023 have no test.

## 5. Needs your review

- **TGT-Q1. Who may pull?**
  **Today:** the current console has no pull mode; the grouped queue picks a target and
  every member approaches it (TGT-017). The fork's pull mode takes the living member with
  the longest attack range of at least 100 (fork runtime/combat/pulling.ts:20-24), and
  4ce3dcdd (21b8362d) holds pulls while the tank or a priest is dead. Class base ranges in
  game data: mage and priest 120, warrior 18, ranger, rogue and paladin 15; a ranger's
  range comes from its bow.
  **Options:** (a) only the designated tank pulls. Negatives: a melee tank (range 15 to 18)
  must stand inside the pack's aggro reach (96 units, fork pulling.ts:11) to hit, which is
  what pull mode avoids; no pull without a tank. (b) the longest-range living member (the
  fork). Negatives: in a warrior, mage and priest party the puller is the mage or priest,
  the members with the least HP, and it takes the first hits. (c) the longest range among
  warrior, ranger and paladin. Negatives: only a ranger with a bow reaches 100, so a
  party without a ranger cannot pull.
  **Recommendation:** (b) with the 4ce3dcdd hold. It is the only option that pulls from
  outside aggro reach in every party the console supports: (a) needs the tank inside the
  reach, and (c) leaves most parties with no puller. Its negatives: the puller is a
  low-HP ranged class that takes the first hits until the tank takes aggro, and the hold
  exists only on 21b8362d.
- **TGT-Q2. Off tank class.**
  **Today:** the current console has no off tank. The fork (ae116693) lets any party
  member be off tank; it takes the tank's attackers when the tank is endangered, below 50%
  or gone, and hands back at 80% with nothing on the tank (fork tank-handoff.ts:15-22).
  Taunt is warrior only and Absorb Sins priest only (game data).
  **Options:** (a) only a warrior or a priest can be off tank. Negatives: fewer parties get
  an off tank; in a party with one priest, a priest off tank that absorbs is also the
  healer. (b) any class (the
  fork). Negatives: an off tank without Taunt or Absorb cannot move the attackers; it only
  becomes the tank in the skill context (fork tank-handoff.ts:25-28), so the attackers stay
  on the tank (inference, not measured).
  **Recommendation:** (a). Only a warrior or a priest has a skill that moves aggro, so only
  they can do what the handoff promises; (b) shows a handoff that changes nothing in game.
  Its negatives: a party without a second warrior or a spare priest has no off tank, and
  the dashboard has to refuse the other classes.
- **TGT-Q3. Reflection threshold.**
  **Today:** the current console blocks magical attacks only on slenderman, tiger and
  goblin (monster-attack-policy.ts:3, 32-33). 21b8362d (d988fcbd) blocks every monster
  with reflection above 0. The server reflects a magical hit with a chance of `reflection`
  percent and sends the whole hit back (al-server node/server.js:3816-3840). Values:
  goblin 99.95, tiger 100, slenderman 96, target_ar500red 50, xmagen 30, sparkbot 8,
  iceroamer 8, greenjr 4.
  **Options:** (a) block any reflection (21b8362d). Negatives: a mage or priest cannot
  basic-attack sparkbot, iceroamer or greenjr, where 92 to 96% of its hits land, so the
  party loses that damage. (b) block only above a threshold read from game data, for
  example 10% (sparkbot, iceroamer and greenjr stay allowed). Negatives: at 8% a mage takes
  about one hit in twelve back in full; the number is a guess until measured. (c) a
  per-monster setting. Negatives: another hand-kept list, the pattern behind bug 16, and
  one more setting to save and show.
  **Recommendation:** (b) at 10%. It keeps the data source of (a), so a new reflector is
  never missed, and keeps the mage's damage where almost every hit lands; (c) brings back
  the hand list. Its negatives: a low-HP mage can still die to a reflected hit at 8%
  (not measured), and the threshold needs a measurement to confirm. That measurement is a
  ChronAL E2E scenario: a mage basic-attacks a sparkbot and an iceroamer for a fixed
  number of attacks; measures: reflected hits per 100 attacks and the mage's lowest HP;
  threshold: no mage death, with each reflected hit logged with its damage.
- **TGT-Q4. Threat fact vs travel policy.**
  **Today:** `isAttackingPartyMember` (14001-14013) does not count a passing encounter as
  an attacker unless return-departure defence (14057-14061) or a continuous Hunt return
  holds and its passive rule is not keep-moving (14003-14005). The fork also counts it
  during console Pause (fork 14847). Taunt, threat reports and `isAllowedTarget` read it
  (P4).
  **Options:** (a) always count a passing monster that hits the party. Negatives: each such
  hit nominates a defence target and can stop the walk, which passing encounters exist to
  avoid. (b) count it only on return trips (today). Negatives: an outbound walk keeps
  taking hits from it with only the passing attack in reply, and the rule sits inside the
  fact, so every caller gets it. (c) never count it. Negatives: return trips stop
  defending against passing attackers, which 703d13af and 2a7b45e6 added.
  **Recommendation:** (b), with the travel rule moved out of the fact into the callers in
  M1. It is the behaviour four commits converged on and that passive-hunting.test.cjs
  ("passing retaliation cannot cancel a return convoy; unrelated attackers still defend")
  guards; (a) stops walks and (c) drops return defence. Its negatives: outbound walks still
  take hits without a full defence, and moving the rule touches every caller.
- **TGT-Q5. Aggro owner.**
  **Today:** the current console gives aggro skills to the party leader (eligibility.ts:
  72-74, warrior-combat.ts:32, protection.ts:6). The fork (7bd14d7c) gives them to the
  designated tank when one is set, else the leader (fork eligibility.ts:81,
  warrior-combat.ts:31-33, protection.ts:6-7).
  **Options:** (a) the leader (today). Negatives: when the leader is not a warrior or
  priest, nobody Taunts or Absorbs, since only those classes have the skills. (b) the
  designated tank only. Negatives: with no tank set, nobody owns aggro skills. (c) the
  tank, then the leader when no tank is set (the fork). Negatives: one more setting; a tank
  that is neither warrior nor priest owns skills it does not have, so nobody casts them
  (inference).
  **Recommendation:** (c). It keeps today's behaviour when no tank is set and lets a warrior
  that is not the leader own Taunt; (a) leaves most leaders without the skill and (b)
  leaves untanked parties with nobody. Its negatives are those of (c) above, and the same
  class question as TGT-Q2.

## 6. Gaps

`node tools/check-claims.mjs` (2026-10-26, `LIMIT=100000`), filtered to this spec:
claimed by more than one spec 0, claims naming no known function 0, behaviours with no
test 3 (TGT-021, TGT-022, TGT-023). `catalog/04-targeting.json`: 375 functions in 38
behaviours. By `catalog/proposed-sections.json`: 104 proposed for this spec, 149 from the
combined 03, 04 and 05 proposal, 38 from triage, 84 proposed to other specs (02: 27,
05: 24, 12: 11, 11: 8, 13: 5, 07: 5, 03: 2, 09: 1, 10: 1).

- TGT-021, TGT-022 and TGT-023 have no test: no file under scripts/tests or e2e names
  `consoleDrainAllows`, `excludedGraveyardTarget`, `graveyardAreaAttackAllowed` or
  `uniqueReferences`.
- Claimed by other specs and cited here: `walkingPassiveTarget`, `passingTravelAllowed`
  (02 MOV-044), the Hunt travel helpers (02 MOV-045), `currentTravelAttackers`
  (02 MOV-046), `travelCombatActive` (02 MOV-047), `safeCombatPoint` (02 MOV-097),
  `kiteIfNeeded` (02 MOV-098), `passiveRareCandidate` (07 HNT-068), `rareActive`
  (07 HNT-080), `frankyCombatActive` (06 EVT-048).
- Ledger numbers (3, 4, 10, 16) refer to the bug ledger outside this repo; they are labels,
  not checked here.
- Not reviewed: e2e live-hunt specs for accuracy.

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
