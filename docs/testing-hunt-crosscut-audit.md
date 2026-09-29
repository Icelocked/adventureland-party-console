# Hunt crosscut audit

Reviewed failure modes: stale or foreign evidence must not acquire movement; failed planning must retain its destination and retry budget; unrelated commands must survive; every actual quest owner must finish; UI projection must not leak or mutate private state. No isolated tests were added.

The inventory began with 87 files containing Hunt/Daisy/armadillo references, 920 source test declarations, and 286 declarations directly mentioning those terms. This is a broad discovery count, not 920 Hunt-specific tests. Parameterized declarations can expand to several runtime tests. Anniversary, rare and merchant audits also include domain files without those search words.

See [lifecycle](testing-hunt-lifecycle-audit.md), [events](testing-hunt-events-audit.md), and [interruptions](testing-hunt-interruptions-audit.md) for their complete declaration inventories. The entries below close the remaining crosscut review. Case lines refer to the pre-cleanup inventory.

## bee-recovery.test.cjs

Keep lost-sight unanimity, delayed evidence, bounded searching and marker rendering guards. Native kills alone do not inject those faults. Removed the final multiple-owner loot-hold case after native journey 48 passed: a real kill completed the leader's quest while the follower still had kills left, followed by both owners' native rewards. The journey records whether follower completion needed an explicit solo Hunt; it does not claim the original party always completes both unequal quests automatically.

- Line 9: 'every member must lose sight; one observer or one stale member prevents retirement'
- Line 20: 'absence without local coverage stops short of declaring a target lost'
- Line 25: 'retirement removes evidence and blocks delayed resurrection while fresh sighting may nominate again'
- Line 36: 'visible attackers preempt search of an unseen queue head'
- Line 41: 'local recovery is bounded by both elapsed time and destination count'
- Line 48: 'scatter markers stay red regardless of array index; grouped third stays double yellow'
- Line 52: 'nonowner departure hold survives completed loot and returning stage but releases on new mission'
- Line 64: 'queue retirement cannot mistake a filtered stale member for unanimous absence'
- Line 71: 'multiple quest owners continue hunting until all owners are on their final kill' — removed; native unequal-owner journey replaces it.

## coordinator-character-actions.test.cjs

Keep rejected navigation and inherited-worker validation. Solo native Hunt does not exercise rejected manual farm commands.

- Line 23: 'character action validation rejects unavailable farming and inherited worker names before mutation'
- Line 32: 'accepted solo farm commands set personal focus without selecting a party leader'

## coordinator-farm-composition.test.cjs

Keep pending relocation/event ownership and failed-route budget guards; the native event journey does not inject an already pending relocation.

- Line 23: 'event ownership holds a pending Hunt relocation until the live owner releases travel'
- Line 38: 'Hunt route recovery retains its spawn and budget instead of entering the farming retry owner'

## coordinator-focus-routes.test.cjs

Native controls journey targets backup-focus clearing. Keep normalization, invalid radius/priority, independent cancellation and inherited event-selection rejection until individually exercised.

- Line 14: 'clearing ordinary backup focus during Hunt does not cancel quest navigation' — trimmed the leader clear/assertion after the native controls journey passed through a real reward. Retained and renamed the merchant clear branch: clearing merchant focus must still invalidate that independent navigation during another character's Hunt.
- Line 19: 'leader selection clears follower overrides and resets scatter only when focus changes'
- Line 25: 'focus validation rejects invalid priorities and radius before mutation'
- Line 29: 'clearing independent focus invalidates only its checkpoint while a global clear invalidates party members'
- Line 33: 'formation preserves inherited event restrictions and independent merchant selection'

## coordinator-heartbeat-composition.test.cjs

Keep restored merchant-in-participants and combat-only response fencing. Native merchant independence does not create that corrupt historical roster.

- Line 18: 'BankBoi service commands survive repeated heartbeat delivery until completion'
- Line 24: 'Hunt turn-in reserves only its fighters, never merchant anniversary travel'
- Line 31: 'combat-only heartbeat does not deliver or decorate pending navigation commands'

## coordinator-public-state.test.cjs

Keep response partition/privacy, handoff freshness and nonmutating inventory projection. Native status consumption alone does not prove absence of private data or accidental mutation.

- Line 4: 'pending command projection preserves empty entries and excludes absent values from JSON'
- Line 14: 'dashboard config and core partition settings without slowing live progress or changing legacy core'
- Line 30: 'fresh headless telemetry supersedes a lost Steam observation after handoff'
- Line 47: 'inventory presentation trims metadata without mutating the live inventory'
- Line 54: 'overview does not expose unlisted private state and unknown sections retain full responses'

## coordinator-status-ingestion.test.cjs

Keep empty-vs-nonempty catalog preservation, obsolete scatter epochs, bank adoption ordering and Ponty error preservation; native initial discovery is only the successful branch.

- Line 7: 'catalog discovery removes report payloads while retaining prior nonempty catalogs'
- Line 17: 'scatter learning respects epochs, validates IDs, and strips one-shot fields'
- Line 24: 'bank observation deduplicates unchanged content but adopts staging before persistence on a change'
- Line 33: 'local Ponty reports preserve realm keys, reject invalid offers, and do not overwrite an error-free observation on an error'

## coordinator-unselected-leader.test.cjs

Keep missing leader, missing destination and diagnostic revision-history variants. Selected native parties do not cover these inputs.

- Line 9: 'Hunt authorization preserves an exhausted destination result and missing quest id'
- Line 20: 'unselected convoy leader returns before clock, routing, or command allocation'
- Line 28: 'convoy replacement history retains each destination and navigation revision'
- Line 44: 'null destination selection retains shared focus and original dictionary lookup'
- Line 54: 'unselected Hunt leader does not query members, clock or destination zones'
- Line 62: 'unselected leader keeps latest cross-realm feed and legacy dictionary key semantics'

## daisy-door-routes.test.cjs

Native Boo Boo journey targets actual door traversal. Keep both version-17175 spawn geometries, locked/inaccessible door rejection and bounded search: native server is pinned to version15555 and successful traversal cannot prove the newer geometry or search bound.

- Line 14: 'Daisy to both booboo spawns validates completely after the bounded walking repair'
- Line 40: 'level1 door detour walks around the wall and retains the selected transition'
- Line 49: 'inaccessible or locked doors remain rejected without changing the destination'
- Line 57: 'unreachable door search stays within its fixed collision-check budget'

## farm-competition.test.cjs

Keep outsider competition, all-member coverage and fresh matching radius/revision guards. The isolated three-character account has no independent competing farmer.

- Line 6: 'all member radii must be empty, with fresh matching observations and competitor present'
- Line 14: 'client observes live monsters within its radius irrespective of claims and excludes dead or other-instance entities'

## farm-reunion.test.cjs

Keep Mage Blink/Magiport mana, invitation, timeout and cancellation matrices (native fixture has Warrior/Priest/Merchant), full-party wipe, stale teammate and interrupted recovery guards. Successful native Goobrawl evacuation replaces the ordinary transporter-through-farming-ticks case.

- Line 35: 'Magiport permits 10% remaining; Blink requires 30%'
- Line 47: 'late convoy member hands off within waypoint hunt radius without walking to waypoint'
- Line 58: 'one fresh survivor qualifies, wrong realms and stale status do not'
- Line 66: 'recipient arms before accepting only its authorized mage'
- Line 78: 'expired Magiport falls back to cross-map travel, without requesting again'
- Line 86: 'manual navigation change cancels pending recovery and rejects late invitations'
- Line 93: 'convoy or anniversary ownership prevents reunion travel'
- Line 99: 'mage never Blinks across maps and walks when mana is insufficient'
- Line 107: 'mage casts once only after ready and rechecks its own navigation revision'
- Line 122: 'failed travel is cancelled and has a ten-second retry delay'
- Line 133: 'a nearby party member around a corner still requires navigation'
- Line 144: 'handoff recovery: ' + outcome
- Line 161: 'mage Blinks toward direct underground entrance before crossing maps'
- Line 168: 'same-map Blink checks the landing tile rather than requiring a straight walking path'
- Line 175: 'full-party wipe uses saved waypoint when there is no survivor near farm'
- Line 179: 'already-respawned runtime automatically recovers authorized displacement'
- Line 183: owner+' prevents automatic respawn travel'
- Line 191: 'attacked reunion yields travel ownership so defensive combat and healing can run'
- Line 200: 'reaching the live teammate releases reunion before an old smart route finishes'
- Line 205: 'arrival can complete during retry delay instead of suppressing combat for ten seconds'
- Line 210: 'early Hunt handoff rejoins the current leader without returning to the obsolete encounter point'
- Line 219: 'ended Goobrawl exit owns movement despite a restored remote farming waypoint'
- Line 235: 'Goobrawl transporter walk survives farming timer ticks and reaches Main'

## farm-zone-recovery.test.cjs

Keep geometry-exhaustion, repeated ownership-failure budgets, competing farmer, superseded async Town, transport-lock races and target timeout guards. Ordinary native arrival is insufficient to remove these faults.

- Line 18: 'blocked unengaged target starts only one route and times out with a target cooldown'
- Line 23: 'aggro suppresses path search; a replacement navigation owner is never stopped'
- Line 29: 'target loss cancels only owned recovery and allows new acquisition'
- Line 34: 'rare handoff stops empty-zone search while the combat group selects its target'
- Line 44: 'target outside priest spacing does not convoy when already attackable or still approaching'
- Line 54: 'convoy setup waits through transport lock and handles a racing unable rejection'
- Line 79: 'competition waits for fighting to finish, relocates once, and keeps normal focus'
- Line 86: 'failed outbound Hunt convoy retains mission recovery ownership without farming retries'
- Line 95: 'repeated convoy ownership failures retry without declaring the zone unreachable'
- Line 105: 'exhausted geometry repair holds farming without retrying or blacklisting its zone'
- Line 112: 'obsolete recovery pause is cleared once, preserving future deliberate holds'
- Line 118: 'stale travel failure clears only after the party reaches its active farming zone'
- Line 128: 'farm zone retries cannot reroute a protected turn-in toward monsters'
- Line 134: 'merchant never starts a farming search route'
- Line 138: 'empty farming areas wait without routing and a respawn is immediately eligible'
- Line 149: 'arriving inside cancels only the owned empty-area search route'
- Line 158: 'idle leader outside the selected zone routes into it instead of waiting for a visible target'
- Line 162: 'wild boar entry point is inside the zone and valid with game collision geometry'
- Line 171: 'explicit farming route releases completed Escape before authorizing the convoy'
- Line 180: 'convoy announced before local command blocks independent zone searching'
- Line 184: 'Escape release installs convoy ownership before its first asynchronous stop'
- Line 192: 'superseded Town guard cannot stop a new convoy or cast Town after an awaited stop'
- Line 201: 'clear local approach never calls smart routing or group convoy'
- Line 210: 'a blocked target moving slightly cannot reset the local detour deadline forever'
- Line 218: 'competition cannot relocate while a scattered follower still sees the target type'
- Line 223: 'a pending conflict is cancelled if monsters reappear before departure'

## item-exchange-rewards.test.cjs

Incidental monster-token/Hunt reference: reward probability/catalog math is independent of quest lifecycle; retained.

- Line 11: 'nested tables multiply probabilities and combine identical rewards without opening awarded boxes'
- Line 19: 'real Mystery Box and Armor Box tables expand into rewards whose probabilities sum to one'
- Line 31: 'Tracktrix shows acquisition cost; tokens show guaranteed selectable rewards'
- Line 38: 'boxes label actual rewards and display tiny probabilities without rounding them to zero'
- Line 43: 'Reward in finds both direct and nested box rewards, with sprites and percentages'
- Line 54: 'Reward in includes non-box exchanges with their required quantity and reward odds'
- Line 67: 'Reward in combines alternate quantities, excludes token shops, and navigates to the box'

## merchant-exchange.test.cjs

Incidental monster-token currency catalog reference: exchange quantities, bank stock, cosmetic/token catalog and command ownership are not proved by Daisy giving a token; retained.

- Line 29: 'token catalog includes every currency, bundles, and cosmetic reward identifiers'
- Line 62: 'different rewards share a currency budget before travel'
- Line 70: 'token purchases preserve selected rewards through checkpoints and charge bundle cost'
- Line 83: 'unknown token reward is rejected without spending currency'
- Line 89: '40 level-less leather is withdrawn and delivered for one exchange'
- Line 96: 'exchange lookup preserves requested levels'
- Line 103: 'insufficient leather reports failure without visiting exchange NPC'
- Line 110: 'bankbois cannot be queued for merchant services; normal characters still can'
- Line 119: 'dispatch removes persisted bankboi jobs even while merchant is busy'
- Line 128: 'BankBoi shortage yields the exchange before NPC travel'
- Line 136: 'duplicate lines require their combined quantity before NPC travel'
- Line 142: 'storage queues matching worker inventory once and honors item level'
- Line 156: 'confirmed exchanges checkpoint remaining work before returning to bank'
- Line 165: 'completed exchange resumes reward banking without repeating NPC exchange'
- Line 172: 'auto-bank errands cannot redeposit materials reserved for this exchange'

## queue-markers.test.cjs

Keep external-claim cancellation, delayed projectile nominations, reset epochs and native/dashboard marker rendering/layer disposal. A killed rare is different from an externally claimed rare.

- Line 7: 'snake Hunt to Phoenix cancellation resumes one queue and both marker displays without resetting CODE'
- Line 42: 'a resumed global reset epoch is acknowledged before fresh nominations, without CODE restart'
- Line 50: 'Steam overlay owns four circles, follows live positions, and disposes only its layer'
- Line 64: 'dashboard draws red current, yellow next and double yellow third; no ring for hidden entry'
- Line 74: 'selected cooperative event boss stays attackable and yields a single red marker outside grouped farming'
- Line 94: 'Steam draws event target without grouped farming and disposes the ring when event selection ends'
- Line 103: 'dashboard event with no selected marker does not resurrect the old game target ring'
- Line 109: 'scatter publishes every fresh visible party target as red and drops stale or wrong-instance reports'
- Line 122: 'reconciled queue markers omit dead and absent targets; a hold displays only local defense'
- Line 137: 'locked pair marker roles do not shift when current entity is absent'

## return-planner.test.cjs

Keep concurrent candidate identity, one/both candidate failures, shadow mode and timeout classification. An eventual native arrival may succeed using fallback and would miss these defects.

- Line 13: 'parallel return candidates reach the real planner service and select the faster Town route'
- Line 37: 'candidate response identities are checked before restoring the journey identity'
- Line 42: 'a rejected Town candidate still permits a valid walking route'
- Line 51: 'shadow comparison preserves its mode and parent journey identity'
- Line 57: 'failed return candidates preserve a retryable request instead of reporting a broken route'
- Line 61: 'one validated return candidate remains usable when the other request times out'

## ui-cleanup-behavior.test.cjs

Native controls journey targets saved follower preference vs active leader work and merchant rejection. Keep remaining field validation and countdown behavior; HTTP-level success does not exercise every UI draft.

- Line 6: 'only follower mode saves use the preference route; merchants and inherited settings stay protected'
- Line 19: 'follower preference saves validate Hunt backup and never start active work'
- Line 32: 'status countdown retains duration across polls, refreshes and handles unknown duration'
