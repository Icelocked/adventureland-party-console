# 08. Merchant jobs

Checked against Ryan's base `refs/review/ryan-1.5` (b9b5c91e) in (local checkout). Every file:line is on that ref unless it says "fork HEAD" (af92de45). The fork's live tip 21b8362d changes no file in this part (`git diff --stat af92de45 21b8362d` in pm-worktrees/pta-pull touches only characters/shared.js lines 71 and 18438-18926).

This spec maps which job the merchant runs and what interrupts it: the job queue, routine
priorities, the dispatcher and its gates, the command the coordinator writes for the merchant, the
character-side job wrapper, recovery, completion and retries, party visits and handoffs with
fighters, gathering (fishing and mining) and how it yields, the stand, idle behaviour, giveaways and
merchant luck.

Which realm the merchant is on and what it holds in its hands are in
[09](09-merchant-realm-and-gear.md). What the jobs buy, sell, bank, upgrade and craft is in
[10](10-inventory-bank-commerce.md). Movement during a convoy pause belongs to
[02](02-movement.md); event reserves come from [06](06-events.md).

Counts: 48 behaviours and 618 functions in `catalog/08-merchant-jobs.json` (counted with `node -e` over that file); 13 handoffs in `catalog/handoffs-08.json`.

How this map was made: four readers went through every function in this part on the Ryan ref (shared.js by its Ryan line ranges, every other file start to end) and checked the full review (local checkout) and the first pass `review/merchant.md` claim by claim. Section 7 lists each review claim with its verdict. Line numbers in the full review are mostly fork HEAD lines; this spec gives Ryan lines.

## 1. What it does today

### Queue and priorities

**MJB-001 Rank each job by its routine priority.** Every queued job gets a number from 0 to 100 from the routine it belongs to; higher numbers run first.

Rules:

- merchantRoutinePriority reads the saved priority for the job's reason, maps "Ponty purchases" to "stand bid purchases" and "marked items" to "party collection", clamps it to 0-100 and falls back to 50 (runtime/coordinator/merchant/priority.ts:27-38)
- merchantJobPriority order: storage staging 101, then a valid job.priorityOverride 0-100, then the bid's priorityOverride for non-manual bid jobs, then the routine priority (runtime/coordinator/merchant/priority.ts:44-50)
- routineFor groups reasons into routines: bank collection is party collection, exchange splits into automatic or manual exchange, purchases split into manual marketplace purchases or stand bid purchases, merchant commerce into manual crafting or manual buying (runtime/coordinator/merchant/routines.ts:3-18)
- routineEnabled always allows manual exchange and manual party collection; any other routine runs unless its automation is false (runtime/coordinator/merchant/routines.ts:19-23)
- migrateRoutinePriorities folds the old keys exchange, stand purchases, ALData marketplace purchases, upgrades and compounds, merchant commerce and npc sales into the split routines, then lets saved current keys win (runtime/coordinator/merchant/routines.ts:30-46)
- splitLegacyWork splits an old "upgrades and compounds" job into manual upgrades and manual compounds, and a commerce job with both buys and crafts into two jobs (runtime/coordinator/merchant/routines.ts:53-59)
- stampMerchantJob rewrites "merchant luck exchange" to "merchant luck" with expandLuckCluster false, keeps the oldest queuedAt and stores the computed priority (runtime/coordinator/merchant/priority.ts:52-66)
- Default priorities: merchant luck 100, inventory cleanout 95, deliveries/withdrawals/party collection/restock/bank unlock/mail 90, gold threshold 85, npc sales and deconstruction 80, manual marketplace purchases 76, upgrades 70, auto compound 68, exchange 67, buying and crafting 65, donation 60, join giveaway 55, stand search 50, stand maintenance 40, fishing and mining 20, merchant idle 0 (runtime/coordinator/merchant/initial-settings.ts:32-77)
- Default automations: craft fishing/mining tools false; deliveries, withdrawals, merchant luck, party collection, auto npc sales, restock, gold threshold, inventory cleanout, auto compound, auto upgrade, automatic exchange, stand bid purchases, join giveaway true (runtime/coordinator/merchant/initial-settings.ts:78-96)
- coordinatorPrioritizedBids sorts stand bids by their job priority, highest first (runtime/coordinator/merchant/job-policy.ts:49-58)

Settings:

- merchantRoutinePriorities: defaults runtime/coordinator/merchant/initial-settings.ts:32-77, merged with saved values at :117-120; read at runtime/coordinator/application.ts:1547, runtime/coordinator/merchant/job-policy.ts:43
- merchantAutomations: defaults runtime/coordinator/merchant/initial-settings.ts:78-96, merged at :121; read at runtime/coordinator/merchant/routines.ts:19-23 via queue-composition.ts:55 and dispatch-composition.ts:143
- standBids[id].priorityOverride: read at runtime/coordinator/merchant/priority.ts:48

Handed over by other specs: 4 functions (13-lifecycle).

**MJB-002 Clear occupied outbound bank staging before anything else.** When the bank staging slot holds an item, the merchant job that retrieves it outranks every other job.

Rules:

- completesStorageHandoff returns priority 101 only while bankStagingReserved is true, the job is the merchant's own withdrawals, bank collection, manual bank exchange or upgrade/compound routine, and a withdrawal request points at items1 slot 35 or higher that is occupied in the bank snapshot (runtime/coordinator/merchant/job-policy.ts:21-35, runtime/coordinator/merchant/priority.ts:46)

**MJB-003 Queue work once per character and routine.** Asking for the same work twice for the same character leaves one queued job, raised to the higher priority.

Rules:

- queue skips disabled routines and BankBoi storage workers, splits "upgrades and compounds" into manual upgrades and manual compounds, persists only when something changed and always calls dispatch (runtime/coordinator/merchant/queue.ts:119-128)
- canEnqueue refuses an item collection that is not ready, a disabled routine, a resource-blocked job and work that matches the current job (runtime/coordinator/merchant/queue.ts:99-103)
- sameWork treats all fighter work as one job except the eleven separate routines (exchange pickup, deliveries, upgrades, compounds, buying, npc sale pickups and sales); for the merchant itself withdrawals and bank collection merge (runtime/coordinator/merchant/queue.ts:77-83)
- enqueue maps fighter auto upgrade, auto compound, auto npc sale pickup and deconstruction pickup to "marked items" (runtime/coordinator/merchant/pickup-jobs.ts:8-10, runtime/coordinator/merchant/queue.ts:105)
- promote replaces a queued fighter job's reason when the new routine priority is higher, or when the queued job is "marked items" (runtime/coordinator/merchant/queue.ts:85-97)
- createMerchantQueue merges all queued pickup jobs per target on start; mergePickupJobs keeps the oldest queuedAt, the latest retryAt and any realm block (runtime/coordinator/merchant/queue.ts:48-49, runtime/coordinator/merchant/pickup-jobs.ts:19-36)
- Job ids are "merchant-<now>-<nextCommandId>" (runtime/coordinator/merchant/queue-composition.ts:63)

Handed over by other specs: 6 functions (13-lifecycle).

**MJB-004 Hold work that failed for gold or space until resources change.** A job that failed for lack of gold, bag space or an ambiguous upgrade stays blocked until the inventory, bank or gold changes.

Rules:

- resourceBlock records a block for upgrade, compound and commerce jobs that failed with bank_full, inventory_full, no_space, a lucky slot error or "insufficient gold" (runtime/coordinator/merchant/completion-retries.ts:97-108, 134-151)
- upgradeRecoveryBlock records a block for "Upgrade inventory recovery ambiguous:" and "Automatic upgrade survivor is ambiguous" errors with an upgrade signature (runtime/coordinator/merchant/completion-retries.ts:123-133)
- blocked keeps the job out while the signature (upgrade, capacity) or the bank and merchant gold are unchanged, and deletes the block and logs a retry when they change; it also reads the legacy "upgrades and compounds" key (runtime/coordinator/merchant/queue.ts:52-75)
- The capacity signature is the merchant's items, the target's items and the bank packs as JSON (runtime/coordinator/merchant/job-policy.ts:75-84)

**MJB-005 Pick the highest ready job, oldest first on ties.** Of the jobs that are ready, the dispatcher takes the highest priority; equal priorities go oldest first.

Rules:

- merchantJobReady requires no realmBlockedReason, retryAt at or before now, not blockedOnBankboi, not transfer capacity blocked and collection ready (runtime/coordinator/merchant/priority.ts:75-83)
- precedes and selectMerchantJob pick by priority, then lower queuedAt; selection has no realm term (runtime/coordinator/merchant/priority.ts:85-107)
- takeCoordinatorMerchantJob removes only the chosen job from the queue and stamps it (runtime/coordinator/merchant/queue-selection.ts:100-114)
- ready also marks a merchant job that needs home as blocked with the exact text "Merchant realm return failed after 3 attempts; manual retry required" while the home return is exhausted, and drops disabled routines (runtime/coordinator/merchant/dispatcher.ts:115-125)

**MJB-006 Collect from a fighter only when enough items wait or the merchant is close.** A collection trip waits until the fighter carries at least the threshold of marked items, or the merchant is already within 200 of them.

Rules:

- markedCollectionReady needs a target status fresher than 15 s and at least one marked slot, and either count >= itemCollectionThreshold (minimum 1) or the merchant nearby (runtime/coordinator/merchant/collection.ts:5-6, 59-70)
- merchantCollectionNearby needs both statuses fresher than 15 s, both alive, same map, server and instance, and distance <= 200 (runtime/coordinator/merchant/collection.ts:40-53)
- coordinatorCollectionReady holds exchange pickups until their handoff confirms, waits for offering supplies, blocks jobs whose recipient is in a non-preemptible convoy, and checks bank collection against bankCollectionReason (runtime/coordinator/merchant/queue-selection.ts:61-82)
- merchantMovementBlocked blocks any fighter job, and commerce jobs whose order sources include a fighter, while that fighter is in a non-preemptible convoy, except commerce in the leveling or crafting phase (runtime/coordinator/merchant/movement-block.ts:7-20)
- coordinatorMerchantTransferBlocked holds marked items, inventory cleanout and exchange pickup while the merchant has 3 or fewer free slots (runtime/coordinator/merchant/job-policy.ts:60-72)
- pruneIneligibleCollections drops queued collections that are not ready and not movement blocked, keeping exchange, offering and supply work, and forgets the target's transfer signature (runtime/coordinator/merchant/queue-selection.ts:85-97, called at runtime/coordinator/application.ts:1664)

Settings:

- itemCollectionThreshold: read at runtime/coordinator/merchant/queue-selection.ts:78 and runtime/coordinator/status/merchant-scheduling.ts:180, 184

**MJB-007 Choose which items a collection picks up.** One rule decides which marked and automatic items a visit takes from a fighter; it drives counts, admission and the handoff.

Rules:

- collectionPickups returns bank marks and merchant-kept marks, never trackers or supercomputers, and adds automatic pickups for auto upgrade, auto compound (below target tier) and automatic exchange items (runtime/coordinator/merchant/collection-pickups.ts:46-79)
- Protected entries are locked or bound items, personal trackers, manually reserved upgrade, stat scroll, compound or exchange slots, and items with rule conflicts (runtime/coordinator/merchant/collection-pickups.ts:28-48)
- "npc sale pickup" keeps only the character's own manual sale marks that are not blocked (runtime/coordinator/merchant/collection-pickups.ts:65-68)
- exchangePickup takes a whole stack only when craft protection leaves the full quantity available (runtime/coordinator/merchant/collection-pickups.ts:82-89)

Settings:

- merchantAutomations "auto npc sales", "auto upgrade", "auto compound", "automatic exchange": read at runtime/coordinator/merchant/collection-pickups.ts:23, 26, 41, 53, 61

**MJB-008 Queue work from every status report.** Each character report can queue upgrades, compounds, buying, deliveries, collections, bank collection and gold threshold visits, then dispatches or idles.

Rules:

- observe order: deliveries reconcile, equip resume, receipt reconcile (skipped on the first report after reconnect), luck schedule, merchant observations, compounds, improvements, merchant inventory or fighter collection, stand sync, dispatch or idle, BankBoi, cleanout, bank recovery, gold threshold (runtime/coordinator/status/merchant-scheduling.ts:262-282)
- It dispatches when the job phase is "switching party realm", or when there is no job and the queue or gathering modes are non-empty; otherwise it idles (runtime/coordinator/status/merchant-scheduling.ts:274-277)
- merchantInventory sets merchantCapacityBlocked at 3 or fewer free slots and resets transfer signatures when it turns on (runtime/coordinator/status/merchant-scheduling.ts:130-138)
- collection queues "marked items" when slots >= threshold and the signature changed, skipped when the merchant has 3 or fewer free slots (runtime/coordinator/status/merchant-scheduling.ts:161-187)
- goldThreshold queues "gold threshold" once per run for each member above the threshold (runtime/coordinator/status/merchant-scheduling.ts:210-228)
- upgradeWork queues "auto upgrade" for the merchant and "marked items" for fighters (runtime/coordinator/status/merchant-scheduling.ts:140-146)

Settings:

- threshold: read at runtime/coordinator/status/merchant-scheduling.ts:213

Handed over by other specs: 1 functions (03-turns-and-cooldowns).

**MJB-009 Queue a potion restock at the low-water mark.** When a character holds the minimum or fewer of a configured potion or elixir, the merchant queues a restock.

Rules:

- needsSupply is true when max > 0 and the count is <= min (runtime/coordinator/status/merchant-scheduling.ts:95-97)
- supplies queues "restock" for hp, mp or a ready elixir unless the restock automation is off (runtime/coordinator/status/merchant-scheduling.ts:122-128)

Settings:

- merchantAutomations.restock: read at runtime/coordinator/status/merchant-scheduling.ts:123

**MJB-010 Adopt the first connected owned merchant.** With no merchant configured, the first managed merchant that reports in becomes the merchant.

Rules:

- identifyMerchant needs no configured merchant, ctype merchant, not a BankBoi, a headless slot or Steam member, and an owned merchant record (runtime/coordinator/status/composition.ts:58-60, 83-91)

Settings:

- merchantCharacter: written at runtime/coordinator/status/composition.ts:89 and runtime/coordinator/http/merchant-settings.ts:65

Handed over by other specs: 1 functions (13-lifecycle).

### Dispatcher and gates

**MJB-011 Assign one job only when every gate allows it.** The dispatcher hands the merchant a job only when it is alive, free, not reserved, and no other system owns it.

Rules:

- dispatchMerchant does nothing while a console update or the realm owner holds the merchant, then expires offline work and prunes collections (runtime/coordinator/application.ts:1661-1666)
- dispatch order: event reserve, production hold, upgradeInventoryBusy, an active gathering cast, party realm advance, then available, capacity clear, gatherBefore, idle when nothing is ready, pick (runtime/coordinator/merchant/dispatcher.ts:275-299)
- available returns false while a home return is pending and ensureHome refuses, while the merchant status is missing, dead or older than 10 s, when a job is current, when equip, unequip or use-item is in the slot, or when reserved (runtime/coordinator/merchant/dispatcher.ts:239-253)
- available also merges pickups, splits legacy work, drops empty manual compound, delivery and withdrawal jobs, BankBoi targets, disabled routines (except buy-upgrade orders) and giveaway jobs past expiresAt (runtime/coordinator/merchant/dispatcher.ts:230-246)
- reserved holds work while BankBoi storage is pending (and starts it), during an anniversary featured, reserved, kiss-due or busy state, and while force stand is on; featured and force stand also call idle (runtime/coordinator/merchant/dispatcher.ts:89-113)
- dispatchJob requeues a merchant job whose routine needs home when ensureHome refuses, then batches, checks the target status and begins a party realm switch or assigns (runtime/coordinator/merchant/dispatcher.ts:300-308)
- enabled refuses a job whose target a dungeon owns (runtime/coordinator/merchant/dispatch-composition.ts:143)

Settings:

- merchantAutomations: read at runtime/coordinator/merchant/dispatch-composition.ts:143

**MJB-012 Hold merchant work while production receipts are unreconciled.** While any paid crafting or upgrade attempt has no receipt, the merchant takes no new job and is asked every 5 s to reconcile its journal.

Rules:

- productionHeld returns true while pendingProduction lists attempts; with no current job and a live merchant it writes merchant-production-recover at most every 5000 ms and logs the hold once per pending set (runtime/coordinator/merchant/dispatcher.ts:254-274)
- The character answers merchant-production-recover only with no active job, runs recoverProductionJournal and reports accepted or deferred (characters/shared.js:10446-10453)

**MJB-013 Hold merchant work during a home-realm return.** While the merchant is being sent back to its home realm, new work waits; after three failed returns, work that needs home is blocked until a manual retry.

Rules:

- returningHome is true while merchantHomeReturnAt is set and the merchant's realm request is not exhausted (runtime/coordinator/merchant/dispatch-composition.ts:146)
- homeBlocked is true when the merchant's request is owner home, for activeRealm, exhausted, and the status has not arrived (runtime/coordinator/merchant/dispatch-composition.ts:147-152)

Settings:

- merchantHomeReturnAt: restored at runtime/coordinator/merchant/initial-runtime.ts:27-30, 55; read at runtime/coordinator/merchant/dispatch-composition.ts:146

**MJB-014 Yield to BankBoi storage transactions.** While a BankBoi storage worker is busy or planned, the merchant neither takes jobs nor returns to the stand.

Rules:

- storagePending is true when storage is busy, a bankboiTransaction exists or a storage plan exists (runtime/coordinator/merchant/dispatch-composition.ts:154-155, runtime/coordinator/merchant/idle-composition.ts:33-34)
- BankBoi workers are never queued as job targets (runtime/coordinator/merchant/queue-composition.ts:56, runtime/coordinator/merchant/dispatch-composition.ts:153)
- Each heartbeat starts the BankBoi scheduler and logs "Bankboi scheduler failed" on error (runtime/coordinator/status/scheduling-composition.ts:25-35)

**MJB-015 Force stand pauses all work and keeps the merchant at the stand.** With force stand on, the dispatcher pauses the current job, sends the merchant home and only issues stand returns.

Rules:

- forcedStand reads merchantForceStand (runtime/coordinator/merchant/dispatch-composition.ts:156, runtime/coordinator/merchant/idle-composition.ts:40)
- reserved returns true and calls idle while force stand is on (runtime/coordinator/merchant/dispatcher.ts:108-111)

Settings:

- merchantForceStand: default false (runtime/coordinator/merchant/initial-runtime.ts:50); written by the force route (runtime/coordinator/http/merchant-control.ts:131)

Handed over by other specs: 4 functions (13-lifecycle).

**MJB-016 Wait for a manual equip, unequip or use-item command.** A dashboard equip, unequip or use-item command in the merchant slot blocks dispatch and stand return until it is consumed.

Rules:

- manualEquipmentPending checks the slot type against equip, unequip, use-item (runtime/coordinator/merchant/dispatch-composition.ts:157-158)
- idle returns early for the same three types (runtime/coordinator/merchant/idle.ts:157)

**MJB-017 Requeue a job whose target or merchant status is stale.** A job goes back to the queue when the target or merchant has not reported in 10 s, or they are on different realms with no travel port.

Rules:

- targetStatus requeues when either status is older than 10_000 ms, or travel is unavailable and the normalized realms differ (runtime/coordinator/merchant/dispatcher.ts:164-179)

**MJB-018 Bank the merchant's own marks before queued fighter cleanouts.** When queued collections are blocked by a full merchant bag, the merchant first runs one bank exchange, at most once a minute.

Rules:

- clearCollectionCapacity runs when a queued job is capacity blocked, the merchant has bank marks and 60000 ms passed since the last attempt; it reuses a ready queued "manual bank exchange" or creates one with capacityRecovery (runtime/coordinator/merchant/dispatcher.ts:76-88)
- capacityRecovery commands carry empty withdrawals and npc sales (runtime/coordinator/merchant/commands.ts:127)

**MJB-019 Start gathering when it outranks every ready job.** If a gathering mode is off cooldown and its priority beats every ready job, the dispatcher sends the merchant gathering instead.

Rules:

- gatherBefore returns false at 3 or fewer free slots; it sorts modes whose coordinator cooldown passed by routine priority and gathers when the best beats the best ready job (or -1 with none) (runtime/coordinator/merchant/dispatcher.ts:127-135)
- It writes merchant-gather with all modes only when ensureHome("gathering") allows, but returns true either way, so no job is picked that tick (runtime/coordinator/merchant/dispatcher.ts:136-142)

Settings:

- gatheringModes, gatheringCooldowns: read at runtime/coordinator/merchant/dispatch-composition.ts:159-160
- routine priorities fishing and mining: default 20 (runtime/coordinator/merchant/initial-settings.ts:69-70)

**MJB-020 Pause running work at a checkpoint for higher-priority work or an event.** At each checkpoint the merchant reports in, and the coordinator pauses the job when an event is reserved or something more important waits.

Rules:

- checkpointWork saves resume state, then yields when an event or anniversary reserve holds, or when the best ready queued job or ready gathering mode has higher priority, unless cycleBoundary is false (runtime/coordinator/http/merchant-progress.ts:144-163)
- priorities compares the current job with ready queued jobs and with gathering modes whose coordinator cooldown passed; it has no free-slot check (runtime/coordinator/http/merchant-progress.ts:77-98)
- pause requeues at the tail with a fresh stamp, strips phase, operationStage, startedAt, checkpointAt, handoff, commandId, commandReport, heartbeatAt and progressAt, deletes the merchant slot and dispatches (runtime/coordinator/http/merchant-progress.ts:99-121)

Handed over by other specs: 12 functions (13-lifecycle).

### Commands

**MJB-021 Build each job into the command the merchant runs.** The dispatcher turns a job into one command whose type and payload depend on the reason, and records the job as current.

Rules:

- assign stamps commerceProgressVersion 2 for buy-upgrade orders, clears pauseReason, sets current with phase assigned, startedAt and a new commandId, then writes merchant-mluck, an own-merchant command or merchant-service (runtime/coordinator/merchant/dispatcher.ts:196-228)
- ownCommandType maps 21 reasons to merchant-* types, in-place stand maintenance to merchant-stand-sync, and everything else to merchant-self-improve (runtime/coordinator/merchant/command-kind.ts:3-31)
- ownMerchantCommand builds upgrade preview separately and otherwise merges purchase, marketplace, supplies, per-reason, improvement and commerce details; aldataHomeRealm is job.homeRealm or activeRealm for ALData and Ponty jobs (runtime/coordinator/merchant/commands.ts:57-72, 102-129)
- partyMerchantCommand builds merchant-service with the target's realm, position, gold, inventory, marks, cluster options, withdrawals, deliveries, restock and cargo (runtime/coordinator/merchant/commands.ts:149-182)
- scopeWork empties the payload lists that belong to other routines and filters upgrades and npc sales by auto flag (runtime/coordinator/merchant/command-scope.ts:3-16)
- characterWork filters upgrades by offering readiness and drops deliveries that wait for a matching unapplied stat scroll (runtime/coordinator/merchant/dispatch-composition.ts:83-95)
- Dispatch log text comes from a fixed table, a dynamic table and the fallback "Merchant dispatched for its own upgrades and compounds" (runtime/coordinator/merchant/command-kind.ts:33-69)

Settings:

- threshold, buyUpgradeBatchSize (default 1), gatheringModes, merchantCargo: passed at runtime/coordinator/merchant/dispatch-composition.ts:97-117

**MJB-022 One command slot per merchant, written by many owners.** Each character has one command slot; the dispatcher, idle, HTTP routes, completion and recovery all write or clear the merchant's slot without a shared claim.

Rules:

- Dispatcher writes overwrite the slot (runtime/coordinator/merchant/dispatch-composition.ts:163-165, used at runtime/coordinator/merchant/dispatcher.ts:137, 215, 221, 224, 267)
- Idle writes merchant-idle (runtime/coordinator/merchant/idle-composition.ts:57-59, runtime/coordinator/merchant/idle.ts:164-171)
- Completion deletes the merchant slot without checking type or job (runtime/coordinator/merchant/completion.ts:83); recovery clears only the owned job's command (runtime/coordinator/merchant/recovery-composition.ts:34-36)
- Four merchant-gather writers never check the current job: gather toggle (runtime/coordinator/http/merchant-settings.ts:79-84), no-tool report (:110-114), routine priority save (runtime/coordinator/http/merchant-configuration.ts:88-93), clear (runtime/coordinator/http/merchant-control.ts:97-102)
- Other writers: force stand delete (runtime/coordinator/http/merchant-control.ts:134, 138), checkpoint pause delete (runtime/coordinator/http/merchant-progress.ts:113), idle route delete (runtime/coordinator/http/merchant-idle.ts:23-27), travel port delete (runtime/coordinator/application.ts:363), home recovery deletes (runtime/coordinator/merchant/home-recovery.ts:107, 143), realm switch (characters/realm-composition.ts:41, 49), native-realm-switch (runtime/coordinator/merchant/automation-composition.ts:58-61)

Handed over by other specs: 1 functions (13-lifecycle).

### Character side

**MJB-023 Merchant preflight before accepting a command.** Before running a command the merchant finishes inventory recovery, checks event and anniversary reserves and stops gathering, then reports "accepted".

Rules:

- commandFor resends retained command types on every heartbeat and deletes all others after one delivery; retained merchant types are merchant-service, handoff, idle, stand-sync, npc-sale, self-bank, self-restock, self-improve, production-recover, donate, commerce, exchange, stand-search, join-giveaway, stand-buy, ponty-buy, aldata-buy/sell/auth, order-handoff, mluck (runtime/coordinator/status/response.ts:18-51, 123-133)
- handle counts every command in root.__partyInventoryCommands while it runs, which gathering reads as "inventory command" (characters/shared.js:10388-10393, 10021)
- handleOwnedCommand skips commands while a dungeon owns the character, defers during escape and ignores ids at or below lastCommand (characters/shared.js:10395-10414)
- Preflight order: wait for an inventory tidy and lucky-slot recovery (deferred while a job runs), recover the production journal, defer merchant-* during event work, defer merchant-* except idle and stand-sync during anniversary work, gathering handoff, then report accepted (characters/shared.js:10456-10486)
- Every merchant command except merchant-idle and merchant-stand-sync clears atStandForCooldown and closes the stand (characters/shared.js:10516-10523)
- Routing: 22 merchant-* types run inside runMerchantJob, all but upgrade preview and stand sync through afterCombat; merchant-idle, bankboi-service, handoff and order handoff run outside it (characters/shared.js:10524-10635)
- merchant-gather replaces the mode list and calls selectGatheringMode (characters/shared.js:10662-10666)
- merchant-collect-mail waits up to 20000 ms for mail_item_taken and needs one free slot (characters/shared.js:10598-10623)
- reportMerchantCommand stores {commandId, jobId, state, reason, at} for the next status report (characters/shared.js:10382-10386)
- merchantResponse sends gatheringModes (empty for BankBoi workers), the craft tool flags, bank queue state and the merchant gold target (runtime/coordinator/status/response.ts:197-213)

**MJB-024 Run a job with a token, a 5 s heartbeat and gathering suspended.** The merchant marks the job active, sends a heartbeat every 5 s, stops gathering for movement jobs and resumes it when the job ends.

Rules:

- runMerchantJob refuses a duplicate of the same job from another runtime whose heartbeat is younger than 20000 ms, and cancels the smart path of an orphaned different job (characters/shared.js:8421-8439)
- It sets root.__merchantActiveJob, sends a heartbeat at once and every 5000 ms with progressAt and operationStage (characters/shared.js:8440-8451)
- Suspend list: merchant-service, merchant-npc-sale, merchant-deconstruct, merchant-commerce, merchant-upgrade-preview bump the gathering generation, clear the timers, stop smart and wait up to 15000 ms for idle and gathering to stop, else throw "interrupted" (characters/shared.js:8454-8467)
- Commerce and upgrade preview close the stand again (characters/shared.js:8468)
- Before the action it recovers the production journal (commerce v2), preview supplies and lucky-slot state, and tidies the lucky slot (characters/shared.js:8469-8474)
- A failure before the action starts posts /merchant/complete with success false (characters/shared.js:8478-8481)
- finally clears the token and calls setGathering(suspended mode) only when no job is active (characters/shared.js:8483-8487)
- The heartbeat route moves phase assigned to processing, records operationStage for the merchant's own jobs and caps progressAt at now (runtime/coordinator/http/merchant-progress.ts:64-76, runtime/coordinator/merchant/activity.ts:6-8)
- merchantOperationStage posts a heartbeat when a processing routine changes stage (characters/shared.js:6043-6049)

Handed over by other specs: 2 functions (02-movement, 13-lifecycle).

### Recovery

**MJB-025 Requeue work whose merchant stops reporting.** If a job gets no heartbeat or checkpoint in time, the coordinator puts it back in the queue with a backoff and stops after three tries.

Rules:

- checkpointExpired: phase checkpointed for more than 10000 ms (runtime/coordinator/merchant/recovery.ts:43-47)
- workerExpired: phase assigned or processing with no heartbeat for more than 20000 ms, or a commerce job with no progress for 90000 ms (runtime/coordinator/merchant/recovery.ts:49-56)
- expire requeues any job silent for 180_000 ms except ALData marketplace sales and the switching party realm phase (runtime/coordinator/merchant/recovery.ts:175-183)
- requeue gives a new id with resumedFrom, adds a recovery attempt and retryAt = now + min(300000, 20000 * 2^min(4, attempts-1)) unless checkpointed, and stops after 3 attempts except checkpointed jobs and buy-upgrade orders (runtime/coordinator/merchant/recovery.ts:77-105)
- acceptReport accepts a command report only for the current job and commandId, after startedAt and within 10 s; a deferral before any heartbeat records the reason, and an anniversary or event deferral releases the job to the queue (runtime/coordinator/merchant/recovery.ts:107-152)
- completeRestock ends a restock job as soon as the merchant's inventory satisfies the policy (runtime/coordinator/merchant/recovery.ts:67-75)
- currentMerchantReport fences reports by jobId, and by commandId when one is sent, the failure is hunt_movement_owned, or the job is commerce v2 (runtime/coordinator/merchant/commerce-progress.ts:4-9)

**MJB-026 Recover the merchant queue after a console restart.** After a restart the job that was running goes back to the head of the queue, its carried cargo is kept, and duplicate commerce orders collapse.

Rules:

- recoverMerchantQueue moves handoff banked marks and gold into merchantCargo, requeues the current job at the head with reason fallback "resumed service", deletes phase, startedAt and handoff, and keeps one commerce job per identical buys and crafts (runtime/coordinator/merchant/restart-queue.ts:16-49)
- initialMerchantRuntime restores queue, current, cargo, force stand, stand location and realm requests; merchantHomeReturnAt comes from an unexhausted home request (runtime/coordinator/merchant/initial-runtime.ts:27-58)
- The default merchant name is "GoldMajesty" and a saved lucky slot 7 for GoldMajesty is discarded (runtime/coordinator/merchant/initial-runtime.ts:36, 40)

Settings:

- merchantCharacter: default "GoldMajesty" (runtime/coordinator/merchant/initial-runtime.ts:36)

### Completion and retries

**MJB-027 Commit receipts when a job completes.** On completion the coordinator records what moved, releases the convoy pause and the slot, queues deferred work and dispatches the next job.

Rules:

- complete resolves receipts, decides retries, releases the convoy interruption, deletes the merchant slot, clears a failed recipient's merchant-handoff, clears current, then queues retries, deferred improvements and repeat cleanouts (runtime/coordinator/merchant/completion.ts:76-91)
- resolve records deconstruction and bank upgrade receipts, stat scroll receipts, commerce, cargo, success marks, withdrawals, npc sales, deliveries and activity; a wrong-realm failure counts as success for receipts (runtime/coordinator/merchant/completion-results.ts:147-169, 185-187)
- On success the receipt removes banked and kept marks, upgrades, stat scrolls, compounds and purchases, and writes apply-stat-scrolls into the fighter slot when scrolls are ready (runtime/coordinator/merchant/completion-results.ts:49-55, 82-106)
- deferredImprovements queues manual upgrades, auto upgrade, manual compounds, manual buying and auto compound after a deferred visit (runtime/coordinator/merchant/completion.ts:39-60)
- finish calls ensureHome after ALData sales and giveaways, persists, dispatches, and rechecks Ponty then ALData matches 1000 ms after purchases (runtime/coordinator/merchant/completion.ts:61-75)
- The completion route accepts reports only for the current job (runtime/coordinator/http/merchant-completion.ts:30-38)

Handed over by other specs: 2 functions (13-lifecycle).

**MJB-028 Requeue interrupted or failed work by error type.** Interrupted work goes back to the head of the queue; the error text decides whether, when and how often.

Rules:

- classify reads error text and failureKind: bankboi_pending, merchant_anniversary_reserved, "interrupted", "Merchant died during rendezvous with ", rendezvous timed out (fewer than 2 retries), wrong realm, commerce_movement, commerce_recovery, hunt_movement_owned, communication failures for upgrades (runtime/coordinator/merchant/completion-retries.ts:24-74)
- retryAllowed never retries npc sales; it retries yields always, and other interruptions while retryCount < 2 or for commerce (runtime/coordinator/merchant/completion-retries.ts:75-81)
- enqueue unshifts a copy with a new id (same id for hunt and storage yields), increments retryCount except for yields, strips run fields and skips duplicates (runtime/coordinator/merchant/completion-retries.ts:188-216)
- Delays: rendezvous 10000 ms, death 10000 ms, realm 10000 ms with realmRetryExhausted at 3, movement and interrupted buy-upgrade orders [10 s, 30 s, 60 s, 300 s] (runtime/coordinator/merchant/completion-retries.ts:196, 243-262, runtime/coordinator/merchant/commerce-progress.ts:20-22)
- npcSales marks the attempted sale marks failed using the command still in the merchant slot (runtime/coordinator/merchant/completion-retries.ts:152-163)
- completionMessage and completionLevel pick the log text and level (runtime/coordinator/merchant/completion-retries.ts:82-96, 117-120)

### Handoffs with fighters

**MJB-029 Deliver reserved items and equip them on the recipient.** The merchant sends reserved items to fighters with a durable receipt journal, and asks the fighter to equip delivered gear.

Rules:

- sendReservedMerchantDelivery writes an "uncertain" receipt to localStorage before the send, asks the coordinator, marks "sending", and stores confirmed or uncertain after (characters/shared.js:7155-7206)
- acknowledgeDelivery removes a receipt's mark or sets awaitingEquip for equip-on-delivery marks (runtime/coordinator/merchant/delivery-recovery.ts:123-132)
- queueEquipment adds equipItems to an existing apply-stat-scrolls command or writes equip-deliveries into an empty fighter slot (runtime/coordinator/merchant/completion-results.ts:121-128)
- resumeDeliveryEquip rewrites equip-deliveries every 30000 ms (in memory) when the fighter slot is empty or holds party-monster-travel and the convoy admits the interruption (runtime/coordinator/status/merchant-scheduling.ts:230-253)
- reconcileDeliveries reassigns stock to marks, blocks a mark whose item is missing ("Reserved delivery item missing"), reconciles legacy equipped marks and retries failed equips with a new id when the item is still held (runtime/coordinator/merchant/delivery-recovery.ts:32-120)
- equipDeliveredItems waits up to 20 x 250 ms for the item, unequips the offhand for two-handed weapons and confirms the equip (characters/shared.js:6792-6845)

Handed over by other specs: 3 functions (05-survival, 13-lifecycle).

**MJB-030 Visit a fighter to collect, deliver and service.** The merchant fetches bank items, buys restock potions, meets the fighter, delivers, collects marked items and gold, and banks the cargo at the end of the itinerary.

Rules:

- merchantService order: bank withdrawals and gold shortage, restock buying (any supply at or below min refills all to max), rendezvous, clusters, deliveries, lucky tidy, Merchant's Luck below 600000 ms, collection, gold target, improvements, return deliveries, final Town and bank visit (characters/shared.js:6847-7114)
- rendezvous pursues the target for up to 120000 ms using the job's targetStatus (characters/shared.js:5497-5502)
- collectFromTarget asks for capacity = free slots minus 3 (minus 1 when retrying after send_no_space) and waits up to 60000 ms for the handoff receipt (characters/shared.js:6866-6884)
- canContinueCollection when a next target exists and free slots > 3; then it sets a 30000 ms logistics hold and defers banking and improvements (characters/shared.js:7041-7045)
- On failure it keeps cargo, sets a 30000 ms logistics hold and reports failureKind hunt_movement_owned for Hunt deferrals (characters/shared.js:7115-7151)
- merchantSendItem waits up to 10000 ms for the recipient (characters/shared.js:5504-5507)
- merchantPartyGroups groups the leader and followers as one visit group and every other member alone (runtime/party-groups.ts:2-16)

Handed over by other specs: 11 functions (02-movement, 04-targeting, 05-survival, 07-hunts-and-farming, 13-lifecycle).

**MJB-031 Expand a visit to nearby party members on arrival.** When the merchant reaches a fighter it also queues nearby members for the same trip.

Rules:

- leader queues "party collection" for members within the job radius (default 200) of the leader, nearest first (runtime/coordinator/merchant/clusters.ts:64-87)
- marked replaces queued "marked items" jobs for members within 200 that have marks with one batch at the queue head (runtime/coordinator/merchant/clusters.ts:88-108)
- Cluster jobs are unshifted to the queue head (runtime/coordinator/merchant/clusters.ts:73, 97)

Handed over by other specs: 3 functions (13-lifecycle).

**MJB-032 Fighter sends marked items and gold to the merchant.** The fighter waits for a safe send window, sends the requested items one by one, then all carried gold, and reports the receipt.

Rules:

- waitForHandoffSendWindow needs the merchant within 400 on the same map and instance and character.cc <= 120; it walks toward the merchant when not engaged, for up to 30000 ms (characters/shared.js:5706-5733)
- merchantHandoff unequips marked equipped upgrades, then orders requests: work items, auto compounds, bank marks, kept marks, automatic item rules and cleanout items; personal trackers never go (characters/shared.js:5735-5812)
- Automatic pickups are re-authorized from the job before each send; a new send window after a wait re-checks the item (characters/shared.js:5826-5854)
- After items it sends all carried gold and posts /merchant/handoff-complete with sent, banked, kept, cleaned, gold, partial and cleanoutRemaining (characters/shared.js:5876-5888)
- merchantOrderHandoff waits up to 45000 ms for the merchant and throws on a missing material (characters/shared.js:5892-5909)
- assertMerchantContinuation throws when a convoy continuation expired or was superseded (characters/shared.js:5684-5689)

Handed over by other specs: 15 functions (07-hunts-and-farming, 13-lifecycle).

**MJB-033 Empty a fighter's full bag.** When a fighter has 3 or fewer free slots, the merchant visits and takes everything not protected, weapons first.

Rules:

- fighterInventory queues "inventory cleanout" at 3 or fewer free slots unless the automation is off (runtime/coordinator/status/merchant-scheduling.ts:196-201)
- cleanoutProtected keeps locked, bound, tracker, supercomputer and hpot0, mpot0, hpot1, mpot1 (characters/shared.js:5621-5623)
- cleanoutPriority sends weapons 4, armor 3, jewelry and offhands 2, others 1 (characters/shared.js:5645-5652)
- Cleanout items go only while the fighter had 3 or fewer free slots at the start (characters/shared.js:5814-5821)
- repeatCleanoutAfterWindow queues another cleanout at once after a full visit, or 10000 ms later after a partial one (runtime/coordinator/merchant/completion.ts:92-102)

Handed over by other specs: 3 functions (05-survival, 13-lifecycle).

**MJB-034 Fighters drop invisibility while the merchant visits.** A fighter that is part of the current visit and within 180 of the merchant ends invisibility so the merchant can see it.

Rules:

- merchantVisibility returns the merchant name when the fighter is the job target or a commerce source, both statuses are fresher than 5000 ms and they are within 180 on the same server, map and instance (runtime/coordinator/merchant/visibility.ts:11-36)
- applyMerchantVisibility stops invis and keeps a 5000 ms window (characters/shared.js:11104-11112, 17337)

### Interruptions

**MJB-035 Reserve the merchant for events and anniversary rounds.** During a selected event or an anniversary round the merchant takes no jobs, and anniversary work owns movement.

Rules:

- merchantEventReserved is true while the merchant is in an event return, a deferred return, its own event session, or reports merchantEventReserved within 10 s with a selected event other than anniversary (runtime/coordinator/merchant/event-control.ts:15-29)
- merchantAnniversaryControl: staging window from 90 s before to 15 s after the next round; a live round needs a target and unexpired round; the featured merchant finishes 240 s before expiry; reserved = (staging or live and not completed) and available (runtime/coordinator/merchant/anniversary-control.ts:31-147)
- The character applies the same reserves before accepting merchant-* commands (characters/shared.js:10475-10481)

### Gathering

**MJB-036 Choose fishing or mining.** The merchant picks an enabled mode that is off cooldown, or the one whose cooldown ends first, and runs a 2 s gathering timer for it.

Rules:

- selectGatheringMode keeps only fishing and mining, cancels an active attempt for a disabled mode, turns gathering off with no modes, and prefers a ready mode (characters/shared.js:10203-10221)
- setGathering bumps the generation, restores hands when turned off, creates a session that remembers the non-tool mainhand and offhand, and starts a 2000 ms timer (characters/shared.js:10223-10276)
- initialGatheringState restores modes (old single mode migrates), noTool and cooldowns defaulting to 0 (runtime/coordinator/merchant/initial-gathering.ts:12-25)

Settings:

- gatheringModes: default [] (runtime/coordinator/merchant/initial-gathering.ts:16-20); written by runtime/coordinator/http/merchant-settings.ts:76-78, 109, runtime/coordinator/http/merchant-configuration.ts:84-86, runtime/coordinator/http/merchant-control.ts:107
- gatheringNoTool: written at runtime/coordinator/http/merchant-settings.ts:75, 108
- craft fishing tools / craft mining tools: default false (runtime/coordinator/merchant/initial-settings.ts:80-81), sent at runtime/coordinator/status/response.ts:208-209

Handed over by other specs: 27 functions (03-turns-and-cooldowns, 13-lifecycle).

**MJB-037 Gather on a 2 s tick unless something blocks it.** Every 2 s the merchant checks 15 reasons to wait; if none applies it walks to the spot, equips the tool and casts.

Rules:

- gatheringBlockReason checks, in order: superseded generation, disabled, active attempt, stand operation, status update, banking, merchant job, inventory command, logistics handoff, anniversary reservation, retry delay, upgrading, departure pending, dead, 3 or fewer free slots (characters/shared.js:10010-10030)
- gatheringTick needs merchant level 16; during cooldown it restores hands, uses Town and opens the stand once (characters/shared.js:10053-10096)
- Spots: fishing main (-1597, 552), mining tunnel (277, -96), arrival tolerance 1 (characters/shared.js:9636-9644, 10107-10125)
- settleBeforeGathering waits for 500 ms without movement, up to 6000 ms (characters/shared.js:9729-9751)
- A miss leaves no cooldown and recasts; a catch sets cooldownUntil from the server cooldown (characters/shared.js:10141-10147, 9688-9701)
- Failures retry after 1000 ms (moving or interrupted) or 15000 ms (other) (characters/shared.js:10164-10178)
- gatheringAttemptCurrent ends the attempt when it is replaced, cancelled, a new generation starts, a job is active or anniversary work holds (characters/shared.js:9988-9992)
- gatheringStatus posts a status line at most every 30000 ms per message (characters/shared.js:9646-9656)

**MJB-038 Gathering yields to a merchant command.** An incoming command cancels the gathering attempt, except that a merchant-* command waits for a cast already in progress.

Rules:

- gatheringCommandHandoff returns true at once with no attempt or for merchant-gather; during a cast a merchant-* command is deferred with "finishing <mode> cast" unless force stand or anniversary work applies; otherwise it cancels, sets a 1000 ms hold, stops and waits for the attempt (characters/shared.js:9994-10008)
- It returns without restoring the merchant's hands (characters/shared.js:10006-10007)
- The coordinator skips dispatch while a fresh status reports gatheringPhase casting (runtime/coordinator/merchant/gathering.ts:2-7, runtime/coordinator/merchant/dispatcher.ts:285)
- A deferred command sets a 5000 ms logistics hold when the attempt ends (characters/shared.js:10181-10182)

**MJB-039 Bank newly gathered items when the bag fills.** When free slots drop below 3 the merchant banks only the items it gathered, splitting stacks, then sorts the bank floor.

Rules:

- depositGatheringGains compares the bag with the session baseline, stores whole new stacks first and splits merged stacks (characters/shared.js:9926-9986)
- gatheringBaseline counts bag items plus mainhand and offhand so a tool swap is not a gain (characters/shared.js:9658-9672)
- It runs when free slots < 3 before an attempt or after a cast (characters/shared.js:10054, 10148)

### Stand

**MJB-040 Pick and validate the stand location.** The merchant stands at a saved point on Main; first setup picks a random clear point near (0, 0), older setups use (-63, 100).

Rules:

- initializeStandLocation keeps a saved point, uses (-63, 100) when not first setup, else tries 256 random points in -100..100 and then scans the 201 x 201 grid (runtime/coordinator/merchant/stand-location.ts:14-33)
- The stand location route accepts only a clear point on main (runtime/coordinator/merchant/stand-location.ts:35-44)
- idle sends standLocation with merchant-idle; the character copies it into merchantMarketLocation (runtime/coordinator/merchant/idle.ts:150-152, characters/shared.js:11339)

Settings:

- merchantStandLocation: default null (runtime/coordinator/merchant/initial-runtime.ts:51); written at runtime/coordinator/merchant/stand-location.ts:17, 25, 30, 40; read at runtime/coordinator/merchant/idle-composition.ts:41

**MJB-041 Return to the stand and open it.** With no work, the merchant returns to its home realm, uses Town, walks to the stand point, opens the stand and lists its stand items.

Rules:

- merchantIdle returns to merchantHomeRealm first, then posts returning, closes the stand, uses merchantTownReturn and smart_moves to the stand with a 90000 ms limit (characters/shared.js:9477-9516)
- Arrival needs main and distance <= 35; the stand must open within 250 ms (characters/shared.js:9501-9533)
- It removes trade slots that match no desired listing, lists missing ones in free trade1..trade16 and waits up to 30 x 100 ms for each (characters/shared.js:9536-9572)
- A second idle request during one in progress waits as merchantIdlePending and runs after it (characters/shared.js:9467-9471, 9606-9614)
- merchantTownReturn skips within 140 of the stand point and uses Town with a 12000 ms relocation wait (characters/shared.js:827-870)
- ownsIdle stops the return when a newer command or job takes over (characters/shared.js:9475)

Handed over by other specs: 6 functions (13-lifecycle).

**MJB-042 Decide when the merchant should go back to the stand.** The coordinator sends a stand return only when no job, gathering, navigation or reserve owns the merchant and the stand needs it.

Rules:

- navigationOwnsMovement holds stand return for travel commands and for 10_000 ms after one until movement is seen or a newer command lands (runtime/coordinator/merchant/idle.ts:45-80)
- workOwnsMovement: a finishing cast, a current job, anniversary busy or kiss due own movement; reserved, featured or force stand do not; otherwise ready queued work, active gathering or a ready gathering mode do (runtime/coordinator/merchant/idle.ts:95-103)
- gatheringReady: more than 3 free slots and a mode whose coordinator and status cooldowns passed (runtime/coordinator/merchant/idle.ts:82-93)
- needsCommand skips when the stand is open within 35 of the stand point, all listings are live and no merge is needed; otherwise it issues when the slot is not the same merchant-idle (runtime/coordinator/merchant/idle.ts:105-122)
- readyQueuedWork copies the merchantJobReady clauses (runtime/coordinator/merchant/idle-composition.ts:42-50)
- merchant-idle carries listings, homeRealm = activeRealm and an inventory merge plan (runtime/coordinator/merchant/idle.ts:164-171)

**MJB-043 Move marked items into stand storage in place.** When stand listings are pending, the merchant opens its stand where it is, lists the items and closes it again, without walking home.

Rules:

- localStandSync queues "stand maintenance" with inPlaceStandSync and priority 99 when a listing is not paused, not live and not in the bank, once per signature (runtime/coordinator/merchant/queue.ts:130-154, runtime/coordinator/merchant/queue-composition.ts:68-73)
- standSyncSignature covers listings and owned quantities so unrelated bag changes do not retrigger (runtime/coordinator/merchant/stand-sync-signature.ts:7-14)
- merchantStandSync runs merchantIdle inPlace with closeAfterSync and fails the job unless it completes (characters/shared.js:9618-9634)
- In place, merchantIdle suspends gathering and resumes it in finally (characters/shared.js:9487-9500, 9605)

**MJB-044 Log stand sales from observed trade slots.** The coordinator compares trade slots between reports to log sales, and logs bank entry, deaths and stand openings.

Rules:

- standSales runs when the stand stays open and gold rises; each trade slot that lost quantity updates or removes its listing (runtime/coordinator/status/merchant-observation.ts:111-143)
- logStand reports "At stand" within 35 of the fixed point (-63, 100) on main (runtime/coordinator/status/merchant-observation.ts:75-88)

### Giveaways

**MJB-045 Find giveaways and queue one entry per offer.** The merchant reports giveaways it sees, and ALData lists more; each new offer becomes one "join giveaway" job.

Rules:

- nearbyGiveaways lists trade slots with giveaway and rid on other characters, with entrants and position (characters/shared.js:2330-2345)
- schedule skips PVP realms, offers the merchant already entered, queued offers and offers claimed in the last 30 minutes (runtime/coordinator/merchant/giveaway-scheduler.ts:50-61, 65-91, 115-122)
- scheduleMarket reads ALData merchants seen within 120_000 ms, not PVP, and sets expiresAt = min(lastSeen + 120 s, lastSeen + giveaway minutes) (runtime/coordinator/merchant/giveaway-scheduler.ts:123-145)
- Character-observed giveaways carry no expiresAt (characters/shared.js:2339-2341, runtime/coordinator/merchant/giveaway-scheduler.ts:103)

Settings:

- giveawayAttempts: default {} (runtime/coordinator/merchant/initial-settings.ts:103); written at runtime/coordinator/merchant/giveaway-scheduler.ts:116-120
- merchantAutomations["join giveaway"]: read at runtime/coordinator/merchant/giveaway-scheduler.ts:78

**MJB-046 Travel to a giveaway and join it.** The merchant switches realm if needed, walks to the seller and joins each matching giveaway slot.

Rules:

- merchantJoinGiveaway refuses PVP and expired offers, changes realm, closes the stand, walks to the location (default the stand point), waits up to 60000 ms for the seller and joins each slot not already entered (characters/shared.js:8706-8770)
- The join command carries seller, slot, rid, realm, location, expiresAt and expectedItem (runtime/coordinator/merchant/commands.ts:88-96)

Handed over by other specs: 8 functions (02-movement, 13-lifecycle).

### Merchant luck

**MJB-047 Schedule Merchant's Luck before it runs out.** The coordinator queues a luck trip when a party member's luck will expire before the merchant could reach them.

Rules:

- schedule needs the automation on, a merchant status within 10 s and level 40, and no luck job queued or running (runtime/coordinator/merchant/luck-scheduler.ts:46-55)
- eligible takes party members and the merchant on the merchant's server, alive and without a strong luck buff (runtime/coordinator/merchant/luck-scheduler.ts:30-42)
- A member is due when remaining <= lead; lead is 330000 ms across maps, else max(30000, distance / speed x 2000 + 30000) with speed 40 by default (runtime/coordinator/merchant/luck.ts:15-17, 63-75)
- mluckRemaining is 0 when a fresh report lacks mluck or another merchant owns it, else the reported ms, else 3600000 minus the time since the last cast (runtime/coordinator/merchant/luck.ts:44-57)
- It queues the soonest non-merchant member first with radius 200, cluster expansion and casting on (runtime/coordinator/merchant/luck-scheduler.ts:56-80)
- Completion records each recipient's cast time and prunes casts older than 1 hour (runtime/coordinator/merchant/completion-results.ts:44-48, runtime/coordinator/merchant/luck.ts:40-42)

Settings:

- mluckCastAt: restored and pruned at runtime/coordinator/merchant/initial-gathering.ts:13-14; read at runtime/coordinator/application.ts:2217
- merchantAutomations["merchant luck"]: read at runtime/coordinator/merchant/luck-scheduler.ts:47

Handed over by other specs: 1 functions (02-movement).

**MJB-048 Cast Merchant's Luck on the target and nearby players.** On arrival the merchant casts luck on itself, the target, the cluster and up to 12 passing players whose luck is below 10 minutes.

Rules:

- merchantLuck rendezvous with the target, casts on itself when it is the target, asks for the luck cluster, then casts on visible players (characters/shared.js:5577-5619)
- castMerchantLuck skips other merchants, the dead, foreign strong buffs, buffs above 600000 ms and targets beyond 200, and waits up to 5000 ms for the cooldown (characters/shared.js:5524-5541)
- hasStrongMerchantLuck treats only another merchant's strong buff as strong (characters/shared.js:5517-5522)
- The luck cluster queues every party member within the radius on the same server and map, at the queue head (runtime/coordinator/merchant/clusters.ts:109-154)
- luckMerchantCommand sends radius 200 and no npc sales (runtime/coordinator/merchant/commands.ts:184-199)

Handed over by other specs: 3 functions (03-turns-and-cooldowns, 13-lifecycle).

## 2. What goes wrong

### Luck scheduler never refreshes the party's own strong luck before it lapses

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. The game marks mluck strong whenever caster and target share an owner (game node/server.js:10896-10898), so every buff our merchant casts on our own account's characters is strong
2. Characters report the buff with live.strong (characters/shared.js:1830-1845, safeFields 1805-1813 keeps booleans)
3. hasStrongMluck returns true for any strong buff, with no owner check (runtime/coordinator/merchant/luck.ts:59-61)
4. eligible drops every status with a strong buff (runtime/coordinator/merchant/luck-scheduler.ts:40), so no refresh is queued while the buff exists; snapshot does the same (:85)
5. Only after the buff expires does mluckRemaining return 0 (luck.ts:52) and the member qualify, so the lead time (luck.ts:63-75) never applies to own characters
6. The character side treats only a foreign strong buff as blocking (shared.js:5517-5522) and the comment says the merchant must refresh its own

### Five job command types are dropped from the slot after one heartbeat

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. merchant-upgrade-preview, merchant-bank-unlock, merchant-send-mail, merchant-collect-mail and merchant-deconstruct are job commands (runtime/coordinator/merchant/command-kind.ts:4, 15-16, 25; commands.ts:108)
2. They are missing from retainedCommands (runtime/coordinator/status/response.ts:18-51), so commandFor deletes them after the first delivery (:129)
3. When the character defers that delivery (gathering cast at shared.js:9998-10001, event or anniversary at 10475-10481, lucky-slot recovery at 10459) it never sees the command again
4. The job stays current until workerExpired after 20000 ms with no heartbeat (runtime/coordinator/merchant/recovery.ts:49-56), which costs a recovery attempt and a 20 s or longer backoff (:93-97) (inference: consequence)

### Merchant command slot has many writers and no claim

Kind: patchwork. Origin: Ryan base. Confidence: inference.

1. Four HTTP routes write merchant-gather without checking merchantCurrent (http/merchant-settings.ts:79-84, 110-114; http/merchant-configuration.ts:88-93; http/merchant-control.ts:97-102)
2. A gather toggle between dispatch and acceptance replaces the retained job command (dispatcher.ts:221 vs response.ts:127-129)
3. Completion deletes whatever is in the merchant slot, including a newer equip or gather command (runtime/coordinator/merchant/completion.ts:83)
4. The job then waits for recovery after 20 s (recovery.ts:49-56)

### A preempting job leaves the rod or pickaxe in hand

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

The rod or pickaxe left in hand after a job preempts gathering is ledger 6. Its causal chain is in [09 What goes wrong](09-merchant-realm-and-gear.md#2-what-goes-wrong), because the fault is what the merchant holds; this spec covers the yield side in MJB-038.

### Gathering stops at 3 free slots, but deposit needs fewer than 3

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. gatheringBlockReason returns "inventory capacity" at 3 or fewer free slots (characters/shared.js:10028)
2. gatheringTick runs it synchronously, then checks freeInventorySlots() < 3 before any await (10034-10054), so depositGatheringGains at 10055 cannot run
3. The only other call needs fewer than 3 free slots right after a cast that began with more than 3 (10129, 10148)
4. The dispatcher and idle also skip gathering at 3 or fewer free slots (dispatcher.ts:129, idle.ts:83), so gathered items are never banked by gathering itself (inference: they wait for other bank work)

### Recovery backoff cap values are unreachable

Kind: dead code. Origin: Ryan base. Confidence: confirmed in code.

1. requeue stops at recoveryAttempts >= 3 (runtime/coordinator/merchant/recovery.ts:80)
2. The highest attempt number written is 3, so the delay is at most 20000 x 2^2 = 80000 ms (:94-96)
3. Math.min(4, ...) and the 300000 ms cap never bind

Commits:

- fad9a38f 2026-09-30 and 0631e72c 2026-10-01 Breene26 added the stop and the backoff (review section 4)

### Character-observed giveaway jobs never expire

Kind: bug. Origin: Ryan base. Confidence: confirmed in code.

1. nearbyGiveaways reports minutes but no expiresAt (characters/shared.js:2339-2341)
2. enqueueGiveaway copies expiresAt undefined (runtime/coordinator/merchant/giveaway-scheduler.ts:103)
3. available drops only jobs with Number(expiresAt) < now, which is false for undefined (dispatcher.ts:246)
4. An expired ALData job is dropped but its 30-minute claim stays (giveaway-scheduler.ts:117-120)

Commits:

- 79567a23 2026-10-20 Icelocked: fork adds withExpiry from minutes, releases the claim on expiry and uses lastSeen + minutes for ALData
- 05456efd 2026-10-20 Icelocked: lint follow-up

### Two pause functions strip different fields

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. Force stand pause unshifts the job and keeps operationStage, checkpointAt, commandId and commandReport (http/merchant-control.ts:112-126)
2. Checkpoint pause pushes the job and strips them (http/merchant-progress.ts:99-121)
3. Completion retries strip a third list (completion-retries.ts:201-210), recovery requeue a fourth (recovery.ts:92, 98-99), restart a fifth (restart-queue.ts:33-35)
4. A force-stand resume carries a stale commandReport into assign (dispatcher.ts:204-211 overwrites commandId but not commandReport) (inference)

Commits:

- dd7a3766 2026-09-26, 2c323b98 2026-09-27 Breene26 (merchant-progress pause, per review Appendix B)

### Three copies of "is gathering ready"

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. dispatcher gatherBefore: coordinator cooldowns and more than 3 free slots (dispatcher.ts:127-135)
2. idle gatheringReady: max of coordinator and status cooldowns and more than 3 free slots (idle.ts:82-93)
3. checkpoint priorities: coordinator cooldowns only, no free-slot check (http/merchant-progress.ts:86-92)
4. A checkpoint can yield to gathering that gatherBefore then refuses, so the paused job is picked again (inference)

### Free-slot threshold copied in a dozen places

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. 3 or fewer free slots: dispatcher.ts:129, idle.ts:83, job-policy.ts:71, status/merchant-scheduling.ts:133, 177, 199, characters/shared.js:5815, 7041, 10028, 10129
2. Fewer than 3: characters/shared.js:10054, 10148
3. collectFromTarget reserves 3 or 1 slots (shared.js:6871)

### Idle and dispatcher disagree on ready work

Kind: duplicate rule. Origin: Ryan base. Confidence: inference.

1. readyQueuedWork copies merchantJobReady (idle-composition.ts:42-50 vs priority.ts:75-83)
2. dispatcher ready also refuses home-blocked merchant jobs (dispatcher.ts:117-120)
3. With an exhausted home return and a queued home-needing job, idle sees ready work and stays (idle.ts:102) while the dispatcher refuses it, so the merchant neither works nor returns to the stand

### Ryan's own names and realm hard-coded as defaults

Kind: wrong value. Origin: Ryan base. Confidence: confirmed in code.

1. Default merchant "GoldMajesty" and a GoldMajesty lucky slot cleanup (runtime/coordinator/merchant/initial-runtime.ts:36, 40)
2. Character default merchantHomeRealm "SR_USII" (characters/shared.js:871) and realm fallbacks US/II (8709, 9478)
3. hasStrongMerchantLuck comment names GoldMajesty (shared.js:5520)

### Stand log uses the fixed legacy stand point

Kind: wrong value. Origin: Ryan base. Confidence: confirmed in code.

1. logStand tests distance to (-63, 100) on main (runtime/coordinator/status/merchant-observation.ts:81-82)
2. The configured point lives in merchantStandLocation (stand-location.ts:14-44) and idle uses it (idle.ts:105-111)
3. A merchant at a configured stand logs "Stand opened away from market"

### Stand closed three times for one job

Kind: duplicate rule. Origin: Ryan base. Confidence: confirmed in code.

1. handleCommand closes the stand for every merchant command except idle and stand-sync (characters/shared.js:10516-10523)
2. runMerchantJob closes it again for commerce and upgrade preview (8468)
3. merchantJoinGiveaway closes it again (8731)

### Restart requeue keeps stale run fields

Kind: patchwork. Origin: Ryan base. Confidence: inference.

1. recoverMerchantQueue deletes only phase, startedAt and handoff (runtime/coordinator/merchant/restart-queue.ts:33-35)
2. commandId, commandReport, heartbeatAt, progressAt, checkpointAt and operationStage stay on the queued job
3. assign overwrites commandId and heartbeatAt but keeps commandReport and operationStage (dispatcher.ts:204-211)

### Every command counts as an inventory command for gathering

Kind: patchwork. Origin: Ryan base. Confidence: confirmed in code.

1. handle increments root.__partyInventoryCommands around every command, including travel and merchant-gather (characters/shared.js:10388-10393)
2. gatheringBlockReason returns "inventory command" while it is above 0 (10021)
3. A long command such as merchant-idle therefore blocks gathering for its whole run, in addition to "stand operation" (10014)

Commits:

- 580856b6 2026-10-19 Breene26 added the inventory command reason (git log -L10010,10030)

## 3. Fork differences

What the fork (af92de45) adds or changes in this part. Fork code is not in Ryan's catalog; its lines are fork HEAD.

| What | Commits | What it patches | Where |
|---|---|---|---|
| Prim stack job runs inside the suspend list and closes the stand | 2055dd82 2026-10-20 Icelocked feat: prim stack an item's grace (#65) | Adds a new job type; extends the suspend list rather than replacing it | fork HEAD characters/shared.js:8981, 8995, 11280-11281; merchant/commands.ts:110; merchant/initial-settings.ts:48 |
| restoreGatheringHandsForJob restores the mainhand when a merchant-* job preempts gathering | 0ce1071a 2026-10-24 Icelocked Restore merchant hands when a job preempts gathering | Ledger 6 (rod kept after a Ponty job); ignores a failed restore, skips non merchant-* commands, triggers only on the mainhand, adds two hold windows | fork HEAD characters/shared.js:10690-10715 |
| Giveaway expiry from remaining minutes, claim release on expiry, bank exclusion, merchant directory lookup | 79567a23 2026-10-20 Icelocked fix(merchant): find giveaway hosts through the merchant directory; expire giveaway jobs at their real end (#129), 05456efd 2026-10-20 Icelocked lint | Character-observed giveaways never expiring on the Ryan base; ALData expiry capped at 2 minutes | fork HEAD merchant/giveaway-scheduler.ts:50-57, 94-106; merchant/dispatcher.ts:245-250; merchant/dispatch-composition.ts:146-152; characters/shared.js:9282-9330 |
| Ron purchases job type (merchant-ron-buy), retained in the slot | 9476cd15 2026-10-22 Icelocked feat: buy from Ponty and Ron with standing orders | New feature | fork HEAD merchant/command-kind.ts:13; merchant/commands.ts:79; status/response.ts:32; characters/shared.js:11266-11269 |
| Cosmetic commands handled before merchant preflight | 40abe1b2 2026-10-20 feat(dashboard): show CX jars, manage worn cosmetics and use emotes | New feature; cosmetics set lastCommand, which supersedes an in-flight merchantIdle (ownsIdle) (inference) | fork HEAD characters/shared.js:11163-11169 |
| merchantHandoff authorizes an ordinary merchant mark that replaces an automatic pickup in the same slot | 947fa15e 2026-10-20 fix(merchant): send auto-merchant copies that also feed a compound rule | Auto-merchant copies that also feed a compound rule were skipped (#43) | fork HEAD characters/shared.js:6351-6357 |

## 4. Tests today

Tests were mapped to behaviours by what they load: a unit test that requires a TypeScript file maps to the behaviours that own functions in that file, and a test that slices characters/shared.js maps to the behaviours whose functions it names. Within a file, each test goes to the behaviour whose title shares the most words with the test name. The per-test list is in the catalog file. The mapping is mechanical; whether each test proves what its name says, passes for the right reason and matches the game has not been reviewed yet (Gaps).

| Test file | Tests mapped here | Behaviours |
|---|---|---|
| e2e/console.spec.ts | 11 | MJB-023, MJB-041, MJB-046 |
| scripts/tests/automatic-collection-client.test.cjs | 3 | MJB-032 |
| scripts/tests/automatic-collection.test.cjs | 9 | MJB-004, MJB-007, MJB-024 |
| scripts/tests/bankboi-transfer-confirmation.test.cjs | 1 | MJB-027 |
| scripts/tests/character-field-registry.test.cjs | 1 | MJB-045 |
| scripts/tests/cleanout-item-level.test.cjs | 1 | MJB-033 |
| scripts/tests/collection-threshold.test.cjs | 6 | MJB-005, MJB-006 |
| scripts/tests/console-improvements.test.cjs | 6 | MJB-023 |
| scripts/tests/convoy-defense.test.cjs | 11 | MJB-023, MJB-025 |
| scripts/tests/convoy-timing.test.cjs | 10 | MJB-023 |
| scripts/tests/coordinator-anniversary-control.test.cjs | 3 | MJB-035 |
| scripts/tests/coordinator-dispatch-composition.test.cjs | 3 | MJB-011, MJB-013, MJB-016 |
| scripts/tests/coordinator-giveaway-scheduler.test.cjs | 4 | MJB-045 |
| scripts/tests/coordinator-improvement-scheduler.test.cjs | 2 | MJB-021 |
| scripts/tests/coordinator-job-policy.test.cjs | 4 | MJB-001, MJB-002, MJB-004, MJB-006 |
| scripts/tests/coordinator-legacy-schedulers.test.cjs | 3 | MJB-047 |
| scripts/tests/coordinator-merchant-actions.test.cjs | 1 | MJB-015 |
| scripts/tests/coordinator-merchant-automation.test.cjs | 1 | MJB-047 |
| scripts/tests/coordinator-merchant-clusters.test.cjs | 3 | MJB-031, MJB-048 |
| scripts/tests/coordinator-merchant-completion.test.cjs | 7 | MJB-004, MJB-027, MJB-028 |
| scripts/tests/coordinator-merchant-configuration.test.cjs | 2 | MJB-036 |
| scripts/tests/coordinator-merchant-control.test.cjs | 5 | MJB-003, MJB-015, MJB-022, MJB-046 |
| scripts/tests/coordinator-merchant-initial-settings.test.cjs | 2 | MJB-001 |
| scripts/tests/coordinator-merchant-progress.test.cjs | 7 | MJB-020, MJB-024, MJB-032 |
| scripts/tests/coordinator-merchant-queue.test.cjs | 7 | MJB-003, MJB-004, MJB-043 |
| scripts/tests/coordinator-merchant-recovery.test.cjs | 7 | MJB-025 |
| scripts/tests/coordinator-observation.test.cjs | 3 | MJB-044 |
| scripts/tests/coordinator-queue-selection.test.cjs | 5 | MJB-005, MJB-006 |
| scripts/tests/coordinator-recovery-composition.test.cjs | 3 | MJB-025 |
| scripts/tests/coordinator-restart-queue.test.cjs | 2 | MJB-026 |
| scripts/tests/coordinator-retention.test.cjs | 4 | MJB-047 |
| scripts/tests/coordinator-scheduling-composition.test.cjs | 1 | MJB-008 |
| scripts/tests/coordinator-scheduling.test.cjs | 7 | MJB-008, MJB-033 |
| scripts/tests/coordinator-settings.test.cjs | 4 | MJB-001, MJB-036 |
| scripts/tests/coordinator-stand-control.test.cjs | 2 | MJB-041 |
| scripts/tests/coordinator-state-factory.test.cjs | 4 | MJB-026 |
| scripts/tests/coordinator-status-composition.test.cjs | 1 | MJB-010 |
| scripts/tests/craft-compound-reservations.test.cjs | 1 | MJB-020 |
| scripts/tests/deconstruction.test.cjs | 1 | MJB-006 |
| scripts/tests/delivery-precedence.test.cjs | 1 | MJB-027 |
| scripts/tests/delivery-trip-settings.test.cjs | 3 | MJB-001 |
| scripts/tests/emergency-cleanout.test.cjs | 3 | MJB-032, MJB-033 |
| scripts/tests/event-bank-recovery.test.cjs | 1 | MJB-024 |
| scripts/tests/event-return.test.cjs | 20 | MJB-030 |
| scripts/tests/farm-reunion.test.cjs | 22 | MJB-032, MJB-033 |
| scripts/tests/farming-navigation-client.test.cjs | 6 | MJB-023 |
| scripts/tests/franky-recovery.test.cjs | 10 | MJB-023 |
| scripts/tests/gathering-destinations.test.cjs | 1 | MJB-037 |
| scripts/tests/gathering-ownership.test.cjs | 16 | MJB-023, MJB-036, MJB-037, MJB-038 |
| scripts/tests/gathering-tool.test.cjs | 1 | MJB-037 |
| scripts/tests/hunt-return-recovery.test.cjs | 3 | MJB-032 |
| scripts/tests/hunt-return-town.test.cjs | 9 | MJB-023 |
| scripts/tests/inventory-delta.test.cjs | 2 | MJB-008 |
| scripts/tests/item-operations.test.cjs | 1 | MJB-024 |
| scripts/tests/mail-inbox.test.cjs | 1 | MJB-024 |
| scripts/tests/manual-party-collection.test.cjs | 1 | MJB-001 |
| scripts/tests/merchant-anniversary-reservation.test.cjs | 8 | MJB-035 |
| scripts/tests/merchant-bank-full.test.cjs | 1 | MJB-004 |
| scripts/tests/merchant-buy-cycle.test.cjs | 8 | MJB-004, MJB-020, MJB-028, MJB-030 |
| scripts/tests/merchant-convoy-interruption.test.cjs | 11 | MJB-022, MJB-027, MJB-032, MJB-033 |
| scripts/tests/merchant-delivery-recovery.test.cjs | 15 | MJB-027, MJB-029, MJB-032 |
| scripts/tests/merchant-events.test.cjs | 9 | MJB-017, MJB-035, MJB-042 |
| scripts/tests/merchant-idle-return.test.cjs | 14 | MJB-024, MJB-036, MJB-041, MJB-042, MJB-044 |
| scripts/tests/merchant-npc-sales.test.cjs | 1 | MJB-041 |
| scripts/tests/merchant-party-realm.test.cjs | 8 | MJB-011, MJB-017, MJB-027 |
| scripts/tests/merchant-rendezvous-retry.test.cjs | 2 | MJB-028 |
| scripts/tests/merchant-rendezvous.test.cjs | 15 | MJB-030 |
| scripts/tests/merchant-stand-sync.test.cjs | 5 | MJB-004, MJB-041, MJB-043 |
| scripts/tests/merchant-visibility.test.cjs | 4 | MJB-034 |
| scripts/tests/party-status-diagnostics.test.cjs | 1 | MJB-023 |
| scripts/tests/passing-admission.test.cjs | 14 | MJB-023 |
| scripts/tests/phoenix-patrol-regression.test.cjs | 24 | MJB-023 |
| scripts/tests/routine-separation.test.cjs | 2 | MJB-001 |
| scripts/tests/shared-convoy.test.cjs | 53 | MJB-023 |
| scripts/tests/shared-merchant-rules.test.cjs | 2 | MJB-006 |
| scripts/tests/smart-loot.test.cjs | 1 | MJB-030 |

Behaviours with no mapped test (7): MJB-009, MJB-012, MJB-014, MJB-018, MJB-019, MJB-039, MJB-040.

## 5. Needs your review

Each question gives Today, Options and a Recommendation. The coordinator copies them into REVIEW-QUEUE.md.

### Q1. Should the merchant refresh luck on its own characters before it runs out?

**Today:** the game marks every mluck the merchant casts on a character of the same owner as
"strong" (game node/server.js:10896-10898). The coordinator's luck scheduler skips every member
whose buff is strong (runtime/coordinator/merchant/luck-scheduler.ts:36-41, through
`hasStrongMluck`, runtime/coordinator/merchant/luck.ts:59-61), so it queues a refresh for our own
fighters only after the buff has expired. The character-side scan treats only a strong buff from
another owner as blocking (characters/shared.js:5517-5522). The fork does not change this.

**Options:**
- A. Refresh our own characters on the normal lead time (luck.ts:63-75) and skip only strong buffs
  cast by another owner. Fighters keep luck without a gap; the merchant makes the same number of
  trips it makes today, just earlier.
- B. Keep today's rule. Fighters lose luck for the time between expiry and the next visit.
- C. Never schedule luck trips; cast only when the merchant is already nearby. Fewest trips, most
  time without luck.

**Recommendation:** A. It matches what the character side already does, and the gap in B is a
side effect of the "strong" flag, not a choice anyone made.

### Q2. Should gathering bank its own catches when the bag fills?

**Today:** gathering stops when the merchant has 3 or fewer free slots
(characters/shared.js:10028, in `gatheringBlockReason`), but the deposit step only runs with fewer
than 3 free slots (characters/shared.js:10054), so the deposit code never runs in practice
(MJB-039). The dispatcher and idle code also skip gathering at 3 or fewer free slots. The merchant
stops fishing or mining until some other job empties the bag. The fork does not change this.

**Options:**
- A. Let gathering make a bank trip at the 3-slot mark, then go back to the spot. Continuous
  gathering; one extra bank trip per full bag, and bank visits cost calls (see 09 call budget).
- B. Keep today's stop and rely on other jobs (bank collection, cleanouts) to empty the bag.
  Simple; gathering sits idle for long stretches.
- C. Queue a bank collection job for the merchant when gathering stops for space, at the
  gathering routine's priority. The dispatcher decides when, so a higher job is never delayed.

**Recommendation:** C. It reuses the queue instead of a second banking path inside gathering, and
it keeps the dispatcher as the one place that decides what runs next.

### Q3. Should giveaways the merchant finds itself expire?

**Today:** on Ryan's base a giveaway job that the merchant queued from what it saw near itself has
no expiry (characters/shared.js:2330-2345 reports them; runtime/coordinator/merchant/dispatcher.ts:246
admits queued giveaway jobs with no end check), so the merchant can walk to a giveaway that has
already ended. The fork adds an expiry from the giveaway's minutes and a 30 minute claim per
attempt (fork HEAD giveaway-scheduler.ts:51-57, 103-106; dispatcher.ts:248-250, commit 79567a23).

**Options:**
- A. Expire every giveaway job at the giveaway's own end time, as the fork does. No wasted trips.
- B. Keep no expiry; rely on the join step failing on arrival. Wasted trips, and the merchant is
  away from its stand.

**Recommendation:** A, and offer it to Ryan as a small issue, because the bug is in his base.

### Q4. When the merchant is gathering and a job arrives, should a cast in progress finish first?

**Today:** `gatheringCommandHandoff` defers the incoming command while a gathering cast is running
and cancels the gathering attempt otherwise (characters/shared.js:9994-10008). A cast lasts a few
seconds; the deferred command waits for the next heartbeat.

**Options:**
- A. Keep it: finish the cast, then run the job. Small delay, no lost catch.
- B. Cancel the cast at once for jobs above a priority threshold (for example party visits for a
  fighter that needs potions). Faster response for urgent work, loses the cast.

**Recommendation:** A for all jobs today. The delay is a few seconds and B adds a second priority
rule; revisit only if a test shows a party visit arriving late because of it.

## 6. Gaps

`node tools/check-claims.mjs` (run with `LIMIT=100000`), filtered to this spec:

- Functions claimed by this spec and by another spec: 0.
- Claims naming no known function: 0.
- Behaviours with no test: 7 (MJB-009, MJB-012, MJB-014, MJB-018, MJB-019, MJB-039, MJB-040).
- Unclaimed functions across all specs: 3743 (the tool does not split these by spec; none of them is in this spec's proposed list).

Not yet verified:

- runtime/coordinator/merchant/home-recovery.ts and characters/realm-composition.ts: only the command-slot writer lines were checked (09 scope) (reader 08).
- http/routine-priorities.ts and http/thresholds.ts: writers of merchantRoutinePriorities, threshold and itemCollectionThreshold not read; defaults for threshold and itemCollectionThreshold not traced (reader 08).
- characters/shared.js executors called from handleCommand (merchantSelfImprove, merchantSelfBank, merchantPontyBuy and others) belong to 09/10 and were not read here (reader 08).
- Test accuracy: no test in section 4 has been reviewed for whether it proves what its name says (method step 2).
- The test mapping is by file and test name; a test can prove more behaviours than the one it is mapped to.

## 7. Review claims checked

| Claim | Verdict | Evidence |
|---|---|---|
| Review 2.2: dispatcher command port writes the slot (dispatch-composition.ts:172-174; dispatcher.ts:139, 217-226, 271) | PARTLY | Content right; Ryan lines are dispatch-composition.ts:163-165 and dispatcher.ts:137, 215, 221, 224, 267 (review cites HEAD) |
| Review 2.2: idle issue writes merchant-idle (idle-composition.ts:57-59, idle.ts:164-171), skipped for equip/unequip/use-item (idle.ts:157) | CONFIRMED | runtime/coordinator/merchant/idle-composition.ts:57-59; idle.ts:157, 164-171 |
| Review 2.2: travel port delete at application.ts:386 | PARTLY | HEAD line; Ryan ref is runtime/coordinator/application.ts:363 |
| Review 2.2: completion delete (completion.ts:83), recovery clearCommand checks job id (recovery-composition.ts:34-36), home recovery deletes (home-recovery.ts:107, 143), automation native-realm-switch (automation-composition.ts:58-61), realm-composition 40-50 | CONFIRMED | completion.ts:83; recovery-composition.ts:34-36; home-recovery.ts:107, 143; automation-composition.ts:58-61; realm-composition.ts:41, 49 |
| Review 2.2 / Appendix B 3: four merchant-gather writers never check the current job | CONFIRMED | http/merchant-settings.ts:79-84, 110-114; http/merchant-configuration.ts:88-93; http/merchant-control.ts:97-102 |
| Review 2.2: status/response.ts:18-45 keeps some types until a route clears them | CONFIRMED | status/response.ts:18-51 (list), :129 (delete of all others) |
| Review 2.3: job executor token (runMerchantJob 8967-8969), cleared in finally (9012) | PARTLY | HEAD lines; Ryan characters/shared.js:8440-8442 and 8485 |
| Review 2.3: gathering loop gets control when gatheringBlockReason returns null (10717-10737); current() checks attempt, generation, job, anniversary (10682-10686) | PARTLY | HEAD lines; Ryan shared.js:10010-10030 and gatheringAttemptCurrent 9988-9992 |
| Review 2.3: stand return via merchant-idle or the gathering cooldown branch, ownsIdle | CONFIRMED | Ryan shared.js:9461-9616, cooldown branch 10087, ownsIdle 9475, merchantTownReturn 827-870 |
| Review 2.3: convoy pause 60 s deadline or job change (merchant-interruption.ts:17-119) | CONFIRMED | navigation/merchant-interruption.ts:24, 117-119 |
| Review 2.3: coordinator idle infers movement owner with a 10 s window (idle.ts:49-103) | CONFIRMED | merchant/idle.ts:54-60, 62-80 |
| Review 2.5: gatherBefore dispatcher.ts:129-145 | PARTLY | Ryan lines dispatcher.ts:127-143 |
| Review 2.5: priority yield comparison merchant-progress.ts:77-98 | CONFIRMED | http/merchant-progress.ts:77-98; it ignores free slots, unlike dispatcher.ts:129 |
| Review 2.5: job suspend list (runMerchantJob 8981-8994, resume 9013) has six command types | PARTLY | Ryan shared.js:8454 lists five (service, npc-sale, deconstruct, commerce, upgrade-preview); the sixth (merchant-prim-stack) is fork commit 2055dd82; resume Ryan 8486 |
| Review 2.5: in-place stand sync suspend 10181-10194, resume 10299 | PARTLY | Ryan shared.js:9487-9500, resume 9605 |
| Review 2.5: gatheringBlockReason has 15 reasons; six writers of __merchantLogisticsHoldUntil | PARTLY | 15 reasons confirmed at Ryan shared.js:10010-10030; Ryan has four writers (7042, 7118, 10004, 10182), fork 0ce1071a adds two |
| Review 2.6: selectMerchantJob by priority then queuedAt through takeCoordinatorMerchantJob; promote, localStandSync 99, staging 101, bid override, retry unshift, clusters, recovery requeue reorder the queue | CONFIRMED | priority.ts:85-107; queue-selection.ts:100-114; queue.ts:85-97, 147; priority.ts:46, 48; completion-retries.ts:197, 212; clusters.ts:73, 97, 144; recovery.ts:100 |
| Review 3 row 1.1: priority.ts:85-94 and 97-107 via the pick port | CONFIRMED | priority.ts:85-107; queue-selection.ts:100-114; application.ts:1592-1594 |
| Review 3 row 1.2: one command in the slot; dispatch-composition.ts:172-174 | PARTLY | Ryan line dispatch-composition.ts:163-165 |
| Review 3 row 1.3: runMerchantJob token, 5 s heartbeat, /merchant/complete; completion-retries decides requeue (188-216) | CONFIRMED | Ryan shared.js:8440-8451; completion-retries.ts:188-216 |
| Review 3 row 1.4: about 20 gates in the dispatcher | CONFIRMED | dispatcher.ts:89-125, 239-308 (event, production, inventory busy, cast, realm advance, home return, alive, storage, anniversary x4, force stand, current, manual equipment, capacity, gather, stale target, home needs, enabled, giveaway expiry, BankBoi) |
| Review 3 row 1.5: character chain before accepted (11170-11199) | PARTLY | HEAD lines; Ryan shared.js:10456-10486 |
| Review 3 row 1.6: 2 s timer and 15 block reasons | CONFIRMED | Ryan shared.js:10274, 10010-10030 |
| Review 3 row 1.7: gatheringCommandHandoff cancels and stops, or defers during a cast (Ryan 9994-10008) | CONFIRMED | Ryan shared.js:9994-10008 |
| Review 3 row 1.8: suspend list bumps generation, kills timers, waits up to 15 s, resumes in finally | CONFIRMED | Ryan shared.js:8454-8467, 8486 |
| Review 3 row 1.9: coordinator gathering decided in several places | CONFIRMED | dispatcher.ts:127-143; idle.ts:82-93; http/merchant-progress.ts:86-92; four HTTP writers (Appendix B 3) |
| Review 3 row 1.10: merchantInterruption 60 s deadline, four phases | CONFIRMED | navigation/merchant-interruption.ts:8, 24 |
| Review 3 row 1.11: idle infers movement owner (idle.ts:49-103) | CONFIRMED | merchant/idle.ts:49-103 |
| Review 3 row 1.12: realm writers table | PARTLY | Out of 08 scope beyond dispatcher gates; dispatch-composition.ts:146-152 home gates confirmed; home-recovery.ts not read in full here (09) |
| Review 3 row 1.13: merchantHomeReturnAt read in dispatch-composition.ts:155 | PARTLY | Ryan line dispatch-composition.ts:146 |
| Review 3 row 1.14: completesStorageHandoff job-policy.ts:21-35, coordinatorMerchantTransferBlocked :60-72, reasonAliases priority.ts:27-30, and more reason lists | CONFIRMED | job-policy.ts:21-35, 60-72; priority.ts:27-30; collection.ts:55-57; pickup-jobs.ts:3-9; queue.ts:77; completion-retries.ts:61, 77, 106; completion.ts:68; command-scope.ts:5-11; routines.ts:3-4 |
| Review 3 row 2.3: no preemption path restores hands in Ryan base; gatheringCommandHandoff returns true after the cancel; ledger 6 Ponty is not in the suspend list | CONFIRMED | Ryan shared.js:9994-10008 (no restore), 8454 (no merchant-ponty-buy), restore only from 10072 and 10237 |
| Review 3 row 2.4: gathering polls flags; logistics hold set from several places | CONFIRMED | Ryan shared.js:10010-10030; hold writers 7042, 7118, 10004, 10182 |
| Review 3 row 2.5: two lists decide preemption | CONFIRMED | Ryan shared.js:8454 suspend list; all other types rely on 9994-10008 plus "merchant job" at 10017 |
| Review 3 row 2.6: gates duplicated across the wire | CONFIRMED | dispatcher.ts:89-113, 276 vs Ryan shared.js:10475-10481; anniversary-control.ts:119-147 vs character merchantAnniversaryWorkReserved |
| Review 3 row 2.7: retries classified by error text; three typed kinds | CONFIRMED | completion-retries.ts:24-74, 105, 114, 124, 136; failureKind hunt_movement_owned (:49), commerce_recovery (:71), commerce_movement (commerce-progress.ts:17) |
| Review 4: dispatcher ready 9fbeadab, dd7a3766, 0631e72c, 3bb52c1f; available adds abd3db8b; productionHeld/dispatch 829b85ba, 0de261d5, 0631e72c, cb8881f6; gatherBefore 2be25ed8 | CONFIRMED | git log -L115,125 / 127,143 / 239,248 / 254,299 on refs/review/ryan-1.5 runtime/coordinator/merchant/dispatcher.ts |
| Review 4: suspend list history 9fbeadab, dd7a3766, 034dcfdf, 2a1a72f2 (+ fork 2055dd82) | CONFIRMED | git log -L8453,8467:characters/shared.js refs/review/ryan-1.5 |
| Review 4: gatheringBlockReason history 9fbeadab, 2be25ed8, 580856b6 | CONFIRMED | git log -L10010,10030:characters/shared.js refs/review/ryan-1.5 |
| Review 5.2 step 3: the coordinator assigns a job by writing the slot | CONFIRMED | dispatch-composition.ts:163-165; dispatcher.ts:221 |
| Review 5.2 step 4: handleCommand calls gatheringCommandHandoff and it returns true with the tool in hand; true at once between ticks | CONFIRMED | Ryan shared.js:10482, 9996, 10003-10007 |
| Review 5.2 step 5: merchant-ponty-buy not in the suspend list; gathering returns "merchant job" | CONFIRMED | Ryan shared.js:8454, 10017 |
| Review 5.2 step 6: runMerchantJob finally and merchant-idle do not touch hands | CONFIRMED | Ryan shared.js:8483-8487, 9461-9616 |
| Appendix B 3: two pause functions strip different field lists | CONFIRMED | http/merchant-control.ts:112-126 (unshift, keeps operationStage, checkpointAt, commandId, commandReport) vs http/merchant-progress.ts:99-121 (push, strips them) |
| Appendix B 3: equipmentOwnsSlot overwrites party-monster-travel while handoff admits through the interruption | CONFIRMED | status/merchant-scheduling.ts:247-253; http/merchant-handoff.ts:129 |

## 8. Settings index

| Setting | Default | Read at | Written at |
|---|---|---|---|
| merchantRoutinePriorities | initial-settings.ts:32-77 (merged with migrateRoutinePriorities at :117-120) | runtime/coordinator/application.ts:1547; runtime/coordinator/merchant/job-policy.ts:43; runtime/coordinator/http/merchant-progress.ts:91 | http/routine-priorities.ts (route, not read here) |
| merchantAutomations | initial-settings.ts:78-96 (+ auto upgrade migration :121) | runtime/coordinator/merchant/queue-composition.ts:55; runtime/coordinator/merchant/dispatch-composition.ts:143; runtime/coordinator/merchant/luck-scheduler.ts:47; runtime/coordinator/merchant/giveaway-scheduler.ts:78; runtime/coordinator/status/merchant-scheduling.ts:123, 145, 157, 176, 199, 226; runtime/coordinator/merchant/completion.ts:94; runtime/coordinator/merchant/collection-pickups.ts:23 | runtime/coordinator/http/merchant-control.ts:67, 76, 82, 83 |
| gatheringModes | [] (initial-gathering.ts:16-20) | runtime/coordinator/merchant/dispatch-composition.ts:159; runtime/coordinator/merchant/idle-composition.ts:51; runtime/coordinator/status/response.ts:207; runtime/coordinator/http/merchant-progress.ts:86; runtime/coordinator/status/merchant-scheduling.ts:275 | runtime/coordinator/http/merchant-settings.ts:76-78, 109; runtime/coordinator/http/merchant-configuration.ts:84-86; runtime/coordinator/http/merchant-control.ts:107 |
| gatheringCooldowns | {fishing: 0, mining: 0} (initial-gathering.ts:22) | runtime/coordinator/merchant/dispatch-composition.ts:160; runtime/coordinator/merchant/idle-composition.ts:52; runtime/coordinator/http/merchant-progress.ts:87 | runtime/coordinator/status/merchant-scheduling.ts:110-120 |
| gatheringNoTool | {} (initial-gathering.ts:21) |  | runtime/coordinator/http/merchant-settings.ts:75, 108; runtime/coordinator/http/merchant-configuration.ts:83 |
| merchantForceStand | false (initial-runtime.ts:50) | runtime/coordinator/merchant/dispatch-composition.ts:156; runtime/coordinator/merchant/idle-composition.ts:40 | runtime/coordinator/http/merchant-control.ts:131 |
| merchantStandLocation | null, then initializeStandLocation (stand-location.ts:14-33) | runtime/coordinator/merchant/idle-composition.ts:41; characters/shared.js:11339 | runtime/coordinator/merchant/stand-location.ts:17, 25, 30, 40 |
| itemCollectionThreshold | not read here | runtime/coordinator/merchant/queue-selection.ts:78; runtime/coordinator/status/merchant-scheduling.ts:180, 184 | runtime/coordinator/http/merchant-configuration.ts:131 |
| threshold | not read here | runtime/coordinator/status/merchant-scheduling.ts:213; runtime/coordinator/merchant/dispatch-composition.ts:107 | runtime/coordinator/http/merchant-configuration.ts:126 |
| buyUpgradeBatchSize | 1 (dispatch-composition.ts:99) | runtime/coordinator/merchant/commands.ts:122 | runtime/coordinator/http/merchant-configuration.ts:121 |
| mluckCastAt | {} pruned to 1 hour (initial-gathering.ts:13-14) | runtime/coordinator/application.ts:2217 | runtime/coordinator/merchant/completion-results.ts:46-47 |
| giveawayAttempts | {} (initial-settings.ts:103) | runtime/coordinator/merchant/giveaway-scheduler.ts:116-119 | runtime/coordinator/merchant/giveaway-scheduler.ts:117, 120 |
| merchantCharacter | "GoldMajesty" (initial-runtime.ts:36) | everywhere | runtime/coordinator/status/composition.ts:89; runtime/coordinator/http/merchant-settings.ts:65 |
| craft fishing tools / craft mining tools | false (initial-settings.ts:80-81) | runtime/coordinator/status/response.ts:208-209; runtime/coordinator/http/merchant-settings.ts:106 | merchantAutomations writers |

## The design

M1.

## What changes for the player

M1.

## Proof

M1.

## Migration

M1.
