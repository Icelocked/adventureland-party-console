# 08 and 09 Merchant jobs, realm, hands and call budget: M1 design draft

Draft of the M1 design for spec 08 (merchant jobs: which job the merchant runs and what interrupts
it), spec 09 (merchant realm and gear: which realm the merchant is on, what it holds, and the game
call budget) and the parts of spec 10 the merchant executes (bank visits, gold, the stand, Ponty,
ALData, mail). It goes into 08-merchant-jobs.md and 09-merchant-realm-and-gear.md section "The
design" later. It builds on sections 1 to 5 of specs 08, 09 and 10 as checked claim by claim
(docs/implementation/07-verification-08-10.md), on the task owner design
(01-groups-and-tasks-design.md), where the merchant is its own group with `merchant-job` at rank 65
and `realm-hold` at 88 (task design 2.5), and on the movement design (02-movement-design.md), where
merchant walks are `errand` requests (movement 5.4). "Corrections to the checked specs" at the end
lists what this design found wrong or missing in them.

Refs. Line numbers are on the current console at `b9b5c91e` (`refs/review/ryan-1.5` in
(local checkout), read with `git show refs/review/ryan-1.5:<path>`) unless
marked (fork) for `af92de45`, the checkout on disk in that worktree. `shared.js` means
`characters/shared.js`. Bare `merchant/`, `http/`, `status/`, `characters/`, `commerce/`,
`inventory/` and `navigation/` paths are under `runtime/coordinator/`; `roster/` is
`runtime/roster/` and `steam/` is `runtime/steam/`, as in spec 09; `application.ts` is
`runtime/coordinator/application.ts`. Game rules cite kaansoral/adventureland_mongodb at `43b2c8fc`
(the clone at (local checkout)); `server.js` and
`server_functions.js` are under its `node/`.

The design marks decisions that wait on the user "pending your answer (queue A#)" or "pending your
answer (M#)" and uses the review queue recommendation as the working assumption. Section 14 lists
every decision.

## 0. The design in one page

- Four owners, each with one job:
  - the **job owner** on the coordinator decides which merchant job runs; it is the merchant
    group's `merchant-job` provider (rank 65) in the task owner;
  - the **realm owner** on the coordinator is the only writer of the merchant's realm; while a
    login is in flight it holds the merchant group's `realm-hold` task (rank 88);
  - the **hands owner** on the merchant's character decides what the merchant holds; every
    temporary loadout is a lease, restored before any other command runs;
  - the **call budget owner** on every character wraps `parent.socket.emit` and keeps the
    socket under the game's 200 per 4 s limit (server.js:261-262, 5022-5026).
- **One job kind table** replaces the reason-string lists: 109 reason tests in 43 coordinator
  files today (command in 9.1). Each kind declares its command, the realm it needs, the items and
  gold it needs, whether it may be interrupted, how it retries and its default priority.
- **One bank plan for the queue.** The owner computes the gold and items the next jobs need and
  sends one bank visit that serves all of them. The merchant keeps a working gold target, so a job
  no longer opens with a deposit followed by a withdrawal, and stand funding stops moving gold to
  the bank and back (queue A89).
- **One realm writer.** The 13 writers of spec 09 become requests to the realm owner. Jobs are
  grouped by realm, so the merchant no longer hops home between two jobs on the same realm; PVP is
  refused for every move and the hop blacklist for every automatic move (queue A17). The home
  return climbs the task ladder and never gives up (queue A90). A party realm switch that fails
  halfway retries its stragglers once, then rolls back on a backoff (queue A59).
- **One hands record and a lease.** Gathering tools, stat scroll and upgrade unequips are leases;
  any command restores the merchant's normal hands first, both hands, whatever the command type.
  A failed restore lets the command run and retries on the backoff, with no fixed cap (queue A15).
- **One call budget.** Costs come from the game's own table, planned at the upper value (the
  call's `CC` entry plus a base charge of 1, 00-method "Game call cost, settled"). Background
  reads wait first, job steps next, survival last. The fork's Ponty pacer and move counter go.
- **Gathering is a job.** It runs only while the job owner gives it the merchant. The 15 block
  reasons of `gatheringBlockReason` (shared.js:10010-10030) reduce to the attempt's own state.
- **No fixed retry counts.** Seven caps in this part end a job or hold the merchant (section 1.8);
  each becomes a backoff with a "stuck for N minutes" line.
- **Hooks:** one request hook to register a job kind and one to propose jobs of that kind, and
  four notices (job started, paused, resumed, ended). The fork's Ponty and Ron watch is the worked
  example (section 7.3).
- **Records:** a 128-entry decision ring for the merchant and a 64-entry ring for each
  character's call budget, saved to disk only on a death, a failed job, a realm escalation or a
  `limitdc` disconnect.
- **No new saved state** beyond one setting (the merchant's working gold floor, M5). The owners
  rebuild from the queue, the current job and the realm request the console already saves.

## 1. The job owner

### 1.1 Where it lives

On the coordinator, in `runtime/coordinator/merchant/job-owner.ts`. It wraps the existing
dispatcher (`merchant/dispatcher.ts:71-311`) and keeps its state, `merchantQueue` and
`merchantCurrent`, as the saved record. The job kind table is one module,
`runtime/merchant/job-kinds.ts`, that the coordinator and the merchant's character runtime both
import, the same pattern as `runtime/tasks/task-rules.ts` (task design 1.1). The character reads
it for routing, for the gathering suspend rule and for the stand close rule, so neither side keeps
its own list of command types.

The job owner is a task provider in the merchant group (task design 2.5):
- it calls `tasks.request({kind: 'merchant-job', owner: 'job:<jobId>', label})` when it assigns
  a job, and `release(handle, code)` when the job ends;
- its `onSuspend` pauses the job at its next checkpoint, or at once by the rows of 1.6;
- its `onResume` dispatches, and the paused job comes back with its resume state (MJB-020);
- with no job, it releases, and the group's live task is `idle` (rank 0), whose walk is the stand
  return (MJB-041).

Its walks are movement `errand` requests (movement 2.1, rank 65) with the identity
`job:<jobId>:<commandId>`. The merchant runs one job at a time, so movement never ranks two
merchant errands against each other.

### 1.2 What it holds

| Field | What | Bound |
|---|---|---|
| `queue` | today's `merchantQueue`, each job `{id, kind, target, priority, queuedAt, retryAt, resumeState, ...}` | the queue; enqueue merges by the kind's merge key (1.3) |
| `current` | today's `merchantCurrent` | 1 |
| `holds` | user holds on the merchant: force stand (`merchant/dispatch-composition.ts:156`) | one per source |
| `plan` | the bank plan for the next visit (section 2): `{visitId, jobs, gold, withdrawals, deposits}` | 1, rebuilt each dispatch |
| `ladder` | per job: `{step, failures, nextAt}` for the retry backoff (1.8) | one per queued job |
| `status` | the merchant group's job line `{phase, label, since, reasons}` (task design 3.2) | 1 |
| `ring` | the decision ring (section 8) | 128 entries |

`plan` and `ladder` are not saved: the plan is rebuilt from the queue at each dispatch, and the
ladder step is read back from the fields jobs already carry (`retryCount`, `recoveryAttempts`,
`movementRetryCount`, `realmAttempts`, `retryAt`).

### 1.3 Job kinds: one registry

A kind declaration:

```
{
  kind,          // the saved reason string, unchanged, so saved queues keep working
  routine,       // priority and automation key (today routineFor, merchant/routines.ts:11-18)
  command,       // the merchant command type (today commandTypes, merchant/command-kind.ts:3-26)
  target,        // 'merchant' or 'member'
  realm,         // 'home', 'target' (the member's realm), 'listing' (each listing's realm) or 'here'
  needs(job, inputs) -> {gold, withdrawals, freeSlots, bank}   // section 2
  interrupt,     // 'checkpoint' or 'never'
  deadline?,     // ms; the job ends at it
  retry,         // 'backoff' or 'never'
  holdsQueue?,   // while a job of this kind waits, no other kind is picked
  expires?(job), // the time after which the job is dropped
  mergeKey(job), // two jobs with one key are one job (today sameWork, merchant/queue.ts:77-83)
  visits?,       // asks allows('merchant-visit', target) (task design 2.2)
}
```

Core kinds, grouped by command. Priorities are today's defaults
(`merchant/initial-settings.ts:32-77`); the user's saved priorities still win
(`merchant/priority.ts:27-38`).

| Kinds | Command | Realm | Needs | Interrupt | Retry | Priority |
|---|---|---|---|---|---|---|
| party collection, marked items, inventory cleanout, deliveries, restock (for a member), gold threshold, manual visit, npc sale pickup, auto npc sale pickup, deconstruction pickup, exchange pickup | `merchant-service` (`merchant/commands.ts:149-182`) | target | the member's withdrawals and deliveries, restock potion gold, free slots for the collection (`shared.js:6866-6884`) | checkpoint | backoff | 95, 90, 85, 80 |
| merchant luck | `merchant-mluck` | target | none | checkpoint | backoff | 100 |
| withdrawals, bank collection, manual bank exchange | `merchant-self-bank` | home | the bank | checkpoint | backoff | 90, 80 |
| manual upgrades, auto upgrade, manual compounds, auto compound, deconstruction, upgrade preview | `merchant-self-improve`, `merchant-deconstruct`, `merchant-upgrade-preview` | home | scroll gold (INV-079), bank inputs (INV-077, INV-035) | checkpoint | backoff | 70, 68, 80 |
| merchant commerce (manual buying, manual crafting) | `merchant-commerce` | home | the order's gold estimate (INV-036), materials (INV-084) | checkpoint (the executor posts `cycleBoundary: false` inside a paid step, `http/merchant-progress.ts:153`) | backoff | 65 |
| exchange (manual, automatic) | `merchant-exchange` | home | exchange stock (INV-086) | checkpoint | backoff | 67 |
| npc sales, auto npc sales | `merchant-npc-sale` | home | bank stock marked for sale (INV-094) | checkpoint | never (today, `merchant/completion-retries.ts:77`) | 80 |
| stand purchases, stand bid purchases, stand search | `merchant-stand-buy`, `merchant-stand-search` | home | listing totals, 3 free slots (INV-093) | checkpoint | backoff | 75, 50 |
| Ponty purchases | `merchant-ponty-buy` | listing | listing totals, 3 free slots | checkpoint | backoff | 75 (`merchant/priority.ts:28` maps it to stand bid purchases) |
| ALData marketplace purchases | `merchant-aldata-buy` | listing | listing totals, 3 free slots | checkpoint | backoff | 76 |
| ALData marketplace sales | `merchant-aldata-sell` | listing | the items sold | never; deadline 180 s (`merchant/home-recovery.ts:127-130`) | never (an ambiguous sale is never replayed, `merchant/home-recovery.ts:133`) | 76 |
| ALData authentication, send mail, collect mail, bank unlock, merchant donation | `merchant-aldata-auth`, `merchant-send-mail`, `merchant-collect-mail`, `merchant-bank-unlock`, `merchant-donate` | home | gold: 50000 for auth (INV-088), 48000 or 360000 postage (game `logic/mail.js:143-144`), the vault price (INV-109), the donation; one free slot for collect mail (`shared.js:10598-10623`) | checkpoint | backoff | 90, 60 |
| join giveaway | `merchant-join-giveaway` | listing (the offer's realm) | none | checkpoint | backoff | 55; expires at the giveaway's end (queue A57) |
| stand maintenance | `merchant-stand-sync` in place (`merchant/command-kind.ts:29`) | here | none | checkpoint | backoff | 99 in place (`merchant/queue.ts:130-154`), else 40 |
| fishing, mining | `merchant-gather` | home | the tool (a hands lease, section 4), 4 or more free slots | checkpoint between casts (queue A58) | backoff | 20 |
| production recover | `merchant-production-recover` (`merchant/dispatcher.ts:254-274`) | here | none | never | backoff, first wait 5 s | 102, holdsQueue |
| bankboi storage | the BankBoi slot swap (INV-055) | home | none | never | backoff | 101, holdsQueue |
| manual equipment | the dashboard's equip, unequip and use-item (MJB-016) | here | none | never | never | 100 |
| merchant idle | `merchant-idle` | home | none | always | n/a | 0 |

Rules the table carries:
1. **A storage staging release ranks 101.** Today `completesStorageHandoff` returns 101 for eight
   reasons while staging holds an item (`merchant/job-policy.ts:21-35`). It becomes a kind field,
   `releasesStaging: true`, on the bank and improvement kinds, with the same test.
2. **The logistics reserve is one constant**, `LOGISTICS_RESERVE = 3` in the kind module. Today it
   is written out in 14 places in three forms (spec 08 section 2 item 10; spec 10 "The 3-slot
   inventory reserve is restated in five forms"). Needs read it as "free slots minus the job's new
   slots at least 3", today's purchase rule (`shared.js:5405-5414`).
3. **Every job command is retained** until its job ends. Today five job commands are missing from
   `retainedCommands` (`status/response.ts:18-51`) and are lost after one delivery (spec 08
   section 2 item 3). `commandFor` (`status/response.ts:123-133`) asks the kind table instead.
4. **Gathering is suspended by every kind**, not by a list of five (`shared.js:8454`), because a
   job of any kind holds the merchant (section 6).
5. **The stand closes once,** in the command preflight (`shared.js:10516-10523`), for every kind
   but idle and in-place stand maintenance. The two extra closes go (`shared.js:8468`, 8731; spec
   08 section 2 item 14).
6. **Fork kinds are add-ons.** Ron purchases (fork `merchant/command-kind.ts:13`) and prim stack
   (fork `merchant/commands.ts:110`) register through the hook (section 7), as the principle
   "fork features as add-ons" asks.

### 1.4 API

Every call names its owner identity, as the task owner's API does (task design 1.3).

- **`jobs.kind(declaration)`**: core kinds at load; add-ons through `merchant.jobKind` (7.1).
- **`jobs.enqueue(job)`** returns `{id, status}` with `status` one of `queued`, `merged` (the
  merge key matched a queued or current job; today's `promote` keeps the higher priority,
  `merchant/queue.ts:85-97`) or `refused` with a reason (automation off, BankBoi target, an
  expired offer, a resource block, `merchant/queue.ts:99-103`). It replaces `queue`,
  `canEnqueue` and `sameWork` (`merchant/queue.ts:77-128`).
- **`jobs.cancel(id, by)`**: the dashboard cancel (`http/merchant-control.ts:85-93`) and
  automation changes.
- **`jobs.dispatch()`**: the one entry that picks and assigns (1.5). It replaces
  `dispatchMerchant` (`application.ts:1661-1666`) and the dispatcher's gate chain
  (`merchant/dispatcher.ts:275-308`).
- **`jobs.checkpoint(jobId, commandId, report)`** returns `{yield}`: today's checkpoint route
  (`http/merchant-progress.ts:122-163`), with the interruption rows of 1.6.
- **`jobs.complete(jobId, commandId, report)`** returns `{code, next}`: today's completion
  (`merchant/completion.ts:76-91`), with the retry rule of the kind (1.8).
- **`jobs.command(owner, command)`**: the only writer of the merchant's command slot. Today the
  15 code paths MJB-022 lists share the slot with no claim (spec 08 section 2 item 4). The four
  `merchant-gather` routes, the force stand route, the idle route, the travel port, completion,
  home recovery and the realm switch all call it; it refuses a write whose owner does not hold the
  slot, and records the refusal in the ring.
- **`jobs.hold(by, reason)` and `jobs.unhold(by)`**: user holds. Force stand is one
  (`http/merchant-control.ts:112-138`); it follows task design 2.3 rule 4: the status line shows
  "needs your action", and death recovery still runs.
- **`jobs.view()`**: queue, current, plan, gathering readiness and stand slot use, for the
  dashboard (queue A79, A80).

### 1.5 How a job claims the merchant

`jobs.dispatch()` runs on every merchant status report and after every end, as `dispatchMerchant`
does today (`status/merchant-scheduling.ts:274-277`). In this order:

1. **The group's live task.** The owner acts only while the merchant group's live task is
   `merchant-job` or `idle`. Event attendance (66), event return (68), `realm-hold` (88) and death
   recovery (95) hold the merchant above it (task design 2.5). This replaces the event reserve
   check (`merchant/dispatcher.ts:276`), the anniversary reserves
   (`merchant/dispatcher.ts:102-107`), the realm switch return (`application.ts:1662`) and the
   home return wait (`merchant/dispatcher.ts:242`).
2. **The merchant can act:** a status no older than 10 s, alive, and not reporting
   `upgradeInventoryBusy` (today `merchant/dispatcher.ts:244`, 250-253 and 281).
3. **Expire and merge:** drop jobs past their kind's `expires` and merge by key (today
   `merchant/dispatcher.ts:245-246`, giveaway expiry at 246).
4. **A job of a `holdsQueue` kind waits:** pick it; nothing else is picked while it waits
   (production recover, BankBoi storage: today `productionHeld`, `merchant/dispatcher.ts:254-274`,
   and `reserved`, 89-101).
5. **Ready jobs:** today's `merchantJobReady` (`merchant/priority.ts:75-83`), plus the kind's
   realm rule (3.4 rule 3) and, for a visit, `allows('merchant-visit', target)` (task design 2.2;
   today `merchant/dispatch-composition.ts:143` and `merchant/movement-block.ts:7-20`).
6. **Pick** the highest priority, oldest first (`merchant/priority.ts:85-107`), within the realm
   group (3.4 rule 3).
7. **Plan the bank** for the picked job and the jobs behind it (section 2).
8. **Claim:** request the merchant group's task, ask the realm owner for the job's realm, write
   the command through `jobs.command`, and record `started` in the ring.

A job whose target or merchant status is stale goes back with its age (today
`merchant/dispatcher.ts:164-179`); the claim ends and the next dispatch tries again.

### 1.6 What may interrupt what

Rows are the taker; "running" is the kind's `interrupt` field.

| Taker | Running `checkpoint` | Running `never` | Today |
|---|---|---|---|
| death recovery (95, task) | suspended at once; the character's own runtime dies with it | ends `failed:died`; a `retry: never` kind is not requeued | `merchant/completion-retries.ts:29-31`, retried 10 s later (256) |
| realm-hold for a party realm switch (88, task) | paused at once, as today (`merchant/realm-pause.ts:9-26`) | the switch's merchant leg waits for the job to end or reach its deadline; the fighters' legs go at once (M16) | every job is paused at once, an ALData sale included (`merchant/realm-pause.ts:18-25`) |
| force stand (user hold) | paused at once (`http/merchant-control.ts:112-126`) | finishes first, as for the party switch | paused at once |
| event return (68) and event attendance (66, task) | paused at the next checkpoint (`http/merchant-progress.ts:145-146`, 153); the character defers new merchant commands during event work (`shared.js:10475-10481`) | finishes first | same |
| a ready job of higher priority | paused at the next checkpoint that is a cycle boundary (`http/merchant-progress.ts:153`) | finishes first | same |
| a `holdsQueue` job | never interrupts; it is picked next | finishes first | same (`merchant/dispatcher.ts:247`, 257) |
| manual equipment (100) | paused at the next checkpoint | finishes first | the dashboard command replaces the job's command in the slot (spec 08 section 2 item 4) |
| any job | gathering yields between casts (section 6) | n/a | `shared.js:9994-10008` |

The checkpoint compares only ready jobs that `jobs.dispatch` would pick next: the same
readiness, the same realm group rule and the same free slot rule. Today the checkpoint has its
own copy without the free slot rule, so it can yield to gathering that the dispatcher then refuses
(spec 08 section 2 item 9, `http/merchant-progress.ts:77-98` against `merchant/dispatcher.ts:129`).

### 1.7 Resume after interruption

One pause function, `jobs.pause(job, by)`, replaces the five field lists (spec 08 section 2 items
8 and 15):

| Today | file:line |
|---|---|
| force stand pause | `http/merchant-control.ts:112-126` |
| checkpoint pause | `http/merchant-progress.ts:99-121` |
| completion retry | `merchant/completion-retries.ts:201-210` |
| recovery requeue | `merchant/recovery.ts:92`, 98-99 |
| restart requeue | `merchant/restart-queue.ts:33-35` |
| realm pause | `merchant/realm-pause.ts:21-22` |

`jobs.pause` keeps the job's identity, `queuedAt`, `resumeState`, `retryAt` and the receipts it
recorded, and strips one list, `RUN_FIELDS`: `phase`, `operationStage`, `startedAt`,
`checkpointAt`, `handoff`, `commandId`, `commandReport`, `heartbeatAt`, `progressAt`,
`itemMarksCleared`. It releases the convoy interruption (`navigation/merchant-interruption.ts`)
and the slot through `jobs.command`, and records `paused` with `by`. A force stand resume then
never carries a stale `commandReport` into `assign` (spec 08 section 2 item 8 step 4).

Position in the queue does not decide order, because the pick sorts by priority and `queuedAt`
(`merchant/priority.ts:85-94`); a paused job with its old `queuedAt` comes back ahead of newer
jobs of the same priority, which today's checkpoint pause already does through `stamp`
(`merchant/priority.ts:61-65`).

On resume the realm owner restores the job's realm (3.4), the hands owner gives the job's
executor a fresh lease (section 4), and the executor continues from `resumeState` as today
(`http/merchant-progress.ts:139-143`).

### 1.8 Fixed counts and dead ends in the job part, and what replaces them

| Count or hold | file:line | Replacement |
|---|---|---|
| a job that stops reporting is dropped after 3 recovery attempts ("Stopped unresponsive merchant work after three retries") | `merchant/recovery.ts:80-86` | the job stays queued; the backoff it already uses (20 s doubling to 300 s, `merchant/recovery.ts:95-96`) repeats at 300 s; after 5 minutes of failures the status line shows "stuck for N minutes" with the job and its last error |
| an interrupted job retries while `retryCount < 2`, then is dropped | `merchant/completion-retries.ts:75-81` | the kind's `retry: backoff` on the task ladder's waits (5, 15, 30, then 60 s repeating, movement N7); `retry: never` kinds (npc sales, ALData sales) keep today's no replay |
| a rendezvous retries while `rendezvousRetryCount < 2` | `merchant/completion-retries.ts:24-28` | the backoff; a target that cannot be reached is a visit refused by `allows('merchant-visit')`, so the job waits without a trip |
| a party visit's realm switch stops after 3 failures ("manual retry required") | `merchant/party-realm.ts:26-27`, 50-61; completion `merchant/completion-retries.ts:249-253` | the realm owner's ladder (3.5); the job stays queued with `retryAt` on the backoff |
| the home return stops after 3 attempts and every home job waits for Retry | `merchant/home-recovery.ts:95-99`; `merchant/dispatcher.ts:115-121` | the realm owner's ladder (3.5, queue A90) |
| a missing gathering tool turns the mode off until the user turns it on again | `shared.js:9784-9795`; `http/merchant-settings.ts:102-115` | the gathering job waits until the bank or bag signature changes, then looks again (M14) |
| a failed hands restore before a job | fork `shared.js:10712-10714` ignores it; the queue's earlier cap of 3 | the backoff (section 4, queue A15) |

Bounded searches inside one attempt stay, because they limit work per try and do not end the job:
the 120 s rendezvous (`shared.js:5497-5502`), the 60 s handoff receipt (6866-6884), the 20 s
duplicate guard (8421-8439), the 15 s gathering release (8462-8466) and the 180 s ALData sale
deadline.

## 2. Bank trips planned once for the queue

### 2.1 The bank-first chain today

Spec 08 section 2 item 1 traces it; in short:
1. Every merchant command carries `merchantGoldTarget = goldTargets[merchant]`, 0 when unset
   (`merchant/commands.ts:12-25`), and every merchant command carries every pending withdrawal and
   bank mark (`merchant/commands.ts:16-25`, spread at 117).
2. The first bank visit of each command runs the errands once (`shared.js:5921-5926`), which
   deposit every coin above that target (5942-5949): with 0, all of it.
3. Spending steps withdraw only the shortfall (`withdrawMerchantCash`, `shared.js:5911-5919`).
4. So each job ends near 0 gold, and the next job that spends gold opens with a bank visit that
   deposits and then withdraws.
5. Several executors visit the bank before they check anything (spec 08 section 2 item 1 step 5
   lists them).
6. Withdrawals queue a job on every merchant report at priority 90
   (`status/merchant-scheduling.ts:136-137`).
7. Every physical visit sorts the floor (`shared.js:6059-6065`).
8. **The stand funding loop:** while the stand is open, each stand report queues "native stand
   funding" when carried gold is below the highest allocated bid (`http/native-stand.ts:67-77`,
   113-116). That job's errands deposit down to the 0 target and then withdraw the bid price
   (`shared.js:9031-9039`; its own `goldTarget` at `merchant/commands.ts:121`). The next job's
   visit deposits it again, and the next stand report queues funding again.
9. Nothing shares a visit: the errands flag lives on the command (`shared.js:5922`), and the
   dispatcher combines only marketplace orders (`merchant/dispatcher.ts:145-162`).

### 2.2 The working gold target

The merchant keeps `gold.target` and deposits only above it. Pending your answer (queue A89; M5):

```
gold.target = max(
  merchantGoldFloor,                          // a merchant setting, default 0 (M5)
  standFunding,                               // fundingTarget(state, available), http/native-stand.ts:113-116
  sum of gold needs of the jobs in the plan   // 2.3
)
gold.available = carried + bank - gold.reserve - gold needs of queued jobs outside the plan
```

- `gold.reserve` is the one gold reserve for every automatic purchase, default 0 (queue C9): the
  fork's `spendableGold` (fork `commerce/npc-shop.ts:131-142`) becomes this one figure, and the
  current bid jobs read it too.
- The errands deposit `carried - gold.target` when positive (today `shared.js:5945-5948` with
  `gold.target` in place of the command's target), and spending steps withdraw
  `gold.target - carried` when positive (today `shared.js:5916` with the same value). Both sides
  read one number, so one visit never deposits and withdraws.
- **The stand funding loop ends:** the funding amount is part of `gold.target`, so no visit
  deposits it. The "native stand funding" kind goes; when the stand needs gold and no visit is
  planned, the plan opens one visit whose only need is the funding (2.3 rule 4). After that visit
  the funding stays on the merchant until a bid fills or the allocation changes.
- A fighter's gold target reads bank gold (`shared.js:6889-6892`, 6898); gold on the merchant is
  not in the bank for it. `gold.available` counts carried gold, and a party visit that needs bank
  gold for a fighter carries it from the merchant directly (`partyMerchantCommand` already sends
  the merchant's gold to the visit, `merchant/commands.ts:149-182`).

### 2.3 The bank plan

At each dispatch, after the pick (1.5 step 7), the owner builds the plan:

1. Start with the picked job's `needs`. If the merchant already carries them (items by
   fingerprint, INV-062; gold at or above the job's need), the job runs with no bank step.
2. Otherwise add, in pick order, the next ready jobs on the same realm group whose needs fit the
   free slots minus `LOGISTICS_RESERVE` and `gold.available`. Their withdrawals and gold ride the
   same visit.
3. Add every pending automatic withdrawal and bank mark: they ride the visit (M7).
4. A visit with no job that needs it opens only for: a manual withdrawal (user intent, its own
   job at priority 90 as today), stand funding with nothing planned for 10 minutes, a full bag
   (`LOGISTICS_RESERVE` reached, today's capacity recovery, `merchant/dispatcher.ts:76-88`), or an
   automatic withdrawal that has waited 10 minutes (M7).

The plan goes to the character with the command that opens the visit:

```
bankVisit: {id, gold: {target}, withdrawals: [...], deposits: [...], forJobs: [jobId, ...]}
```

- The errands run once per `bankVisit.id` (`root.__merchantBankVisit`), not once per command
  (`shared.js:5922`). A later job of the plan finds its items carried and skips the walk.
- Each bank-first executor (spec 08 section 2 item 1 step 5) asks `bankStepNeeded(command)`
  first: true only when the command carries a `bankVisit` or its needs are not carried. The
  executors that bank by definition (`merchant-self-bank`, the gathering deposit) always visit.
- Items withdrawn for a later job are reserved for it through the craft protection path the
  errands already ask (`shared.js:5927-5941`): the coordinator answers that job's withdrawals as
  reserved, so another visit does not deposit them. A cancelled job releases them, and the next
  visit banks them.
- The plan is not saved. After a restart the owner rebuilds it from the queue and the merchant's
  inventory; a reservation lost in a restart costs at most one extra deposit at the next visit.
- The sort stays on every physical visit (`shared.js:6059-6065`); fewer visits mean fewer sorts.

### 2.4 Spec 10 work the plan changes

| Spec 10 | Change |
|---|---|
| INV-068 errands | once per visit, deposit and withdraw to `gold.target` (2.2) |
| INV-100 withdrawals routine choice | automatic withdrawals ride the plan; manual ones keep their job (M7) |
| INV-098 bank stock marked for automatic sale while idle | the marks become plan withdrawals instead of a trip each (`merchant/automatic-sales.ts:142-164`, 289-293) |
| INV-108 set carried gold, INV-016 native stand funding | `gold.target`; the funding kind goes |
| INV-106 mail postage (queue A62) | the kind's gold need is the postage, with 48000 and 360000 as the fallback when `scripts/mail-postage.cjs:2-5` returns null; the plan withdraws it before the attachment moves |
| INV-011 and C9 gold reserve | `gold.available` binds every automatic purchase |
| INV-087 Ponty, INV-089 ALData buy | the per-listing bank funding stays as the fallback for a price that rose; the plan funds the expected total |

### 2.5 What a visit costs

From the call table (spec 09 section 1, costs at the upper value of 00-method): entering a bank
floor costs 41 and leaving 25 (`server.js:5978`, 5989, 4808, plus the base charge each), each
bank call 2 (`server.js:9478`, plus the base charge), and the walk's moves 2.5 each. Each visit
the plan avoids saves at least 66 of the merchant's 200 per 4 s, the walk and a sort pass.

## 3. The realm owner

### 3.1 Where it lives

On the coordinator, in `runtime/coordinator/merchant/realm-owner.ts`. It is the only code that
writes the merchant's `block.realm`, `block.pendingRealm` and `merchantRealmRequests[merchant]`,
and the only one that sends the merchant `native-realm-switch` (through `jobs.command`). Fighters'
realms stay with the party realm switch (`characters/realm-switch.ts`), which asks the realm owner
for the merchant's leg.

It is the merchant group's `realm-hold` provider (task design 2.5, rank 88): every move holds the
task from the write of the destination to the arrival or the attempt's failure, whoever asked for
it. A character in the middle of a login can do nothing else, so a job hop, a home return, a party
switch leg and a force stand return all hold `realm-hold` while the login is in flight, and the
owner of the move is recorded in the ring (M10). When the move ends, the job that asked continues
as the `merchant-job` task without a new pick.

### 3.2 What it holds

| Field | What | Bound |
|---|---|---|
| `home` | `activeRealm` (`characters/realm-composition.ts:53-55`), read, never written here | 1 |
| `wants` | the realm each owner asks for: party switch, user hold (force stand), the current job, home | at most four, ranked in that order |
| `move` | the move in flight: `{id, realm, owner, attempt, startedAt, step, nextAt}`, saved as today's `merchantRealmRequests[merchant]` (`merchant/home-recovery.ts:84-89`) | 1 |
| `ring` | shared with the job owner's ring (section 8), entries marked `realm` | 128 in all |

`merchantHomeReturnAt` (`merchant/home-recovery.ts:78`, 86, 92, 97, 105, 149; `application.ts:362`)
goes: "a home return is in flight" is `move.owner === 'home'`.

The highest want wins. With no other want, the merchant wants home. The owner compares the winner
with the merchant's reported realm on every merchant status report and on every dispatch; a
difference with no move in flight starts one (3.5).

### 3.3 The 13 writers today, and what each becomes

| Writer (spec 09 table) | Where | Becomes |
|---|---|---|
| party visit travel port | `merchant/party-realm.ts:62-76`; `application.ts:358-368` | the job's `realm: 'target'`: `realm.want('job:<id>', targetRealm)` at claim |
| job realm route `switchRealm` | `http/merchant-realms.ts:39-68` | stays as the character's door for a listing hop; it calls `realm.want('job:<id>', realm)`, which refuses PVP and blacklisted realms (3.4 rule 2) |
| ensure-home route | `http/merchant-realms.ts:69-89`, called by `merchantIdle` (`shared.js:9477-9486`) | goes: the idle job's `realm: 'home'` means the owner moves the merchant home before it writes `merchant-idle` |
| `attemptReturn` | `merchant/home-recovery.ts:91-111` | the home want with the ladder (3.5) |
| `recoverStalledSale` | `merchant/home-recovery.ts:134-160` | the ALData sale kind's 180 s deadline ends the job (`never` retry); the home want then moves the merchant |
| force stand `returnHome` | `http/merchant-actions.ts:42-49` | `realm.want('user:force-stand', home)`; a Steam merchant gets `native-realm-switch` at once instead of 60 s later (spec 09 "Force stand return for a Steam merchant waits 60 s") |
| dashboard Retry | `http/merchant-control.ts:36-48` | `realm.retry()`: the ladder goes back to step 0 and the next attempt runs now; the job's `retryAt` resets |
| party realm switch `depart` | `characters/realm-switch.ts:75-94` | for the merchant: `realm.want('party-switch:<id>', destination)`; for fighters, unchanged |
| set-home visit | `characters/realm-switch.ts:174-197` | for an offline merchant: `realm.want('party-switch:<id>:home', destination)`, released in the visit's cleanup |
| worker setup `connectionRealm` | `characters/worker-setup.ts:30-63` | reads `realm.target()` for the merchant; it no longer deletes requests (30-42, 43-57) |
| character page navigation | `shared.js:8567-8587`; `native-realm-switch` 10963-10969 | stays as the executor of a move; the four `changeRealm` copies become one helper (3.4 rule 6) |
| Steam group navigate | `steam/bridge.ts:229-241`, 287-293; `roster/steam-group.ts:63`, 76 | for the merchant, the destination is `realm.target()`; a group action that would move the merchant elsewhere waits while a move is in flight |
| Steam single handoff navigate | `steam/bridge.ts:321-323`; `roster/routes.ts:152` | same |

### 3.4 Rules

1. **One writer.** Any other write to the merchant's realm fields is a bug the comparison mode
   lists (11.2).
2. **Refusals.** `realm.want` refuses a realm ending in `PVP` for every owner, as the party switch
   route already does (`http/realms.ts:104-107`). It refuses a realm in the hop blacklist for every
   automatic owner (a job queued by a scheduler, a bid, a watch). The base gains a blacklist
   modelled on the fork's (af92de45 `navigation/realm-hop-blacklist.ts:12-14`; 972c9fce drops the
   fork's copy with boss chase), and it binds every automatic hop, merchant hops included. A
   refused listing is dropped from the job's plan, the job continues with the rest, and the ring
   records `refused:pvp` or `refused:blacklist`. A manual order on a blacklisted realm runs, because the user named the realm. Pending your answer (queue A17; M9).
3. **Jobs grouped by realm.** While the merchant stands on a realm other than home, the pick
   (1.5 step 6) takes the highest ready job runnable on this realm, as long as its priority is at
   least the highest ready job that needs home. When a home job of higher priority is ready, or no
   job here is ready, the group ends and the home want wins. Pending your answer (queue A17; M8).
   - A Ponty or ALData buy job orders its listings current realm first (today's sort,
     `scripts/ponty-market.cjs:66-77`) and never hops home between them; the hops home at the end
     go (`shared.js:8660`, 8929-8930).
   - Jobs carry no `homeRealm`. The owner reads `home` when it decides, so a party switch never
     sends a later job back to the old home (spec 09 "Stale homeRealm captured at queue time";
     today `commerce/bids.ts:113`, `commerce/manual-orders.ts:70`, 129, `merchant/commands.ts:69`).
4. **The home return never gives up.** Section 3.5.
5. **Steam and headless take the same path.** A Steam merchant's move writes `native-realm-switch`
   through `jobs.command` (today `merchant/automation-composition.ts:55-65`); a headless merchant's
   move stops the block after 150 ms (today `merchant/home-recovery.ts:110`).
6. **One `changeRealm` on the character.** The four copies (`shared.js:8593-8598`, 8711-8716,
   8827-8832, 8971-8976) become `requestRealm(command, realm)`: it posts the route, continues at
   once on `alreadyThere` when the live realm already matches, and otherwise waits for the restart.
   That removes the hang where three copies wait for a restart the route never schedules (spec 09
   "Four changeRealm copies disagree"), and the US and II defaults go (`shared.js:8709`,
   8825-8826, 8969-8970).

### 3.5 Moves climb the task ladder

Every move uses one ladder, the task ladder of task design 4.1 with movement's backoff (N7):

| Step | What the realm owner does |
|---|---|
| 0 | write the destination, restart the runtime (headless stop after 150 ms, Steam `native-realm-switch`), wait up to 60 s for a fresh status on the destination (today's arrival test, `characters/realm-request.ts:10-13`) |
| 1 | the other path: a headless merchant whose worker did not reconnect gets a full stop and start (`characters/ownership.ts:182-190`); a Steam merchant whose page did not navigate gets the command again |
| 2 to 4 | wait 5, 15, then 30 s, then step 0 again |
| 5 | wait 60 s, then step 0; the 60 s wait repeats; after 5 minutes the status line shows "Merchant cannot reach <realm>: stuck for N minutes" with the last error |

- Progress, a fresh status on the destination, resets the ladder.
- While a home move climbs, jobs that need home wait queued with the reason "waiting for home
  realm" on the status line, not a blocked tag on each job (`merchant/dispatcher.ts:115-121`
  goes). Jobs that do not need home run if the merchant is connected where they need it.
- The dashboard Retry is a shortcut to step 0 (3.3).
- A job's move (target or listing realm) uses the same ladder under the job's identity; the job
  stays queued with `retryAt` set to the ladder's next due time, and other jobs run meanwhile.
- Cost: one login attempt a minute while a failure lasts (queue A90).

### 3.6 A party realm switch that fails halfway

Pending your answer (queue A59). `run` (`characters/realm-switch.ts:287-303`) gains two phases:

1. **`retrying`:** when `awaitArrival` times out (`characters/realm-switch.ts:100-119`), each
   participant that has not arrived is asked once more (headless: stop and start; Steam:
   `native-realm-switch` again; the merchant: its realm want again), with another 60 s.
2. **`rolling-back`:** when a participant still has not arrived, every participant that moved is
   sent back to the old realm, the merchant through `realm.want('party-switch:<id>', oldRealm)`.
   When `finish` already set `activeRealm` (the setHome case, `characters/realm-switch.ts:249`,
   256-261), the rollback sets it back.
3. A rollback login that fails climbs the ladder of 3.5 until every participant reports one known
   realm; the status line names the stragglers.
4. `realmOperationOwnsCharacter` (`characters/realm-switch.ts:308-311`) covers both new phases,
   so the merchant group's `realm-hold` stays live and no job starts during them.
5. A participant that arrives late during `rolling-back` is moved back like the others; the
   operation ends `failed:rolled-back` with the stragglers listed, and the party stands on the old
   realm.

## 4. The hands owner

### 4.1 Where it lives

On the merchant's character, in `runtime/characters/merchant-hands.ts`, installed by `shared.js`
next to the gathering code. It owns every equip and unequip of the merchant's mainhand and
offhand. Other slots (armor, rings) stay with the job that changes them.

### 4.2 One normal-hands record

Today two records say what the hands should be: the gathering session's `mainhand` and `offhand`
(`shared.js:9809-9812`) and the coordinator's `merchantWeapon` intent
(`inventory/merchant-item-commands.ts:74`; `inventory/transfer-commands.ts:55-69`); the dashboard
equip writes both (`shared.js:6769-6782`, from 5146e0d2), and the restore prefers the intent
(`shared.js:9861-9869`). Spec 09 "Two normal-hands records".

`hands.normal()` returns one record: the `merchantWeapon` intent when it is set (saved on the
coordinator, sent with the status reply, `shared.js:11330`), else the hands the owner observed at
the start of its first lease since the runtime started. A manual equip updates the intent through
`rememberManualWeapon` only; the session copy goes. An item listed for stand sale is never normal
(today's rule at `shared.js:11341-11353` and 9861-9869).

### 4.3 Leases

```
hands.lease(owner, loadout) -> handle     // equip the loadout, remember the owner
hands.release(handle)                     // restore normal hands
hands.settle(command) -> {ok, code}       // before any command
```

| Lease owner | Loadout | Today |
|---|---|---|
| gathering | the rod or pickaxe in the mainhand, no offhand | `equipGatheringTool`, `shared.js:9798-9847` |
| stat scroll application | the marked gear unequipped | `shared.js:6706`, 6714, 6723 |
| self improve and upgrades | equipped upgrades and stat marks unequipped | `shared.js:7314`, 7321; re-equip 7291, 7351, 7357 |

**The rule:** `hands.settle(command)` runs at the start of `handle` (`shared.js:10388-10393`), for
every command type, before the command's own routing. When a lease is held by an owner other than
the command's job, it releases that lease first: both hands, the offhand after a two-handed weapon
as today (`shared.js:9870-9886`), each call checked as today (9906-9923). The exceptions are the
lease's own commands: `merchant-gather` for the gathering lease, and the job's own command for a
job lease. A job lease also ends in the job's `finally`, so a throw in a self improve step no
longer leaves stat scroll gear in the bag (spec 10 "Self improve can strand stat-scroll gear
unequipped").

**A failed restore** lets the command run, logs the failure, and sets `restoreDue`. The idle pass
(the stand return, MJB-041) retries it on the backoff (5, 15, 30, then 60 s repeating) until the
hands match `normal()`. No count ends it (queue A15).

**An item that is not there** is not a failure: when a normal item is in neither the bag nor the
hands, `settle` restores what it can, the status line shows "marked weapon missing", and the retry
waits for the bag signature to change instead of trying every 60 s (M11).

The other writers become calls to the owner:
- `restore-equipment` (`shared.js:10636-10641`) becomes `hands.restore(items)`, with the delay and
  result check the gathering restore uses;
- the status handler's release of a listed weapon (`shared.js:11341-11353`) becomes a rule of
  `normal()`;
- the dashboard equip (`shared.js:6754-6782`) updates the intent and, when a gathering lease is
  live, ends it first.

Every equip and unequip goes through the call budget (section 5): 6 per equip and 9 per unequip at
the upper value (spec 09 call table, plus the base charge).

## 5. The call budget owner

### 5.1 Where it lives

On every character, in `runtime/characters/call-budget.ts`, installed once by the loader before
any game call, around `parent.socket.emit`, in both the Steam and the caracAL runtime. Today the
only emit wrapper, `installSilentTracker`, skips caracAL (`shared.js:742`) and re-wraps on every
frame (spec 09 "Socket listeners and the emit wrapper survive a CODE frame replacement"); the
budget replaces it as the one layer, keyed on the socket, with the tracker's manual-request marker
(`shared.js:745-748`) inside it. Raw emits (`shared.js:512`, 785, 823, 8360, 9297, 10617) pass
through the same layer, so none bypasses it (spec 10 "Raw socket emits bypass the game wrappers").

### 5.2 Costs from the game rule

The server charges each message `CC[method]` (`server.js:247-260`, added at 5018-5020) plus what
the handler's `resend` adds (`server.js:4632-4670`), against 200 per 4 s (`server.js:261-262`,
5022-5026). The base charge of 1 from `add_call_cost(-1)` (`server.js:4980`) is booked before
`current_socket` is set (:4981). This design plans for the upper value, base charge included, as
00-method "Game call cost, settled" asks (see correction 1 for what the clone shows):

| Call | Upper cost |
|---|---|
| move | 2.5 (1 + `CC.move` 1.5); 4.5 when the handler resends `u+cid` (`server.js:11300`) |
| players | 13 |
| secondhands | 17 |
| tracker | 51 |
| equip, trade | 6 (1 + 3 + 2 for the resend) |
| unequip | 9 (1 + 6 + 2) |
| bank (retrieve, store, swap) | 2 |
| transport through a door | 9 |
| bank floor enter, leave | 41, 25 |
| equip_batch | 1 + 3 x (0.5 + n/2) (`server.js:4990-4995`) |
| any other call | 1 + `CC[method]`, 0 when absent, + 2 for a handler that resends `u` without `nc` |

The owner keeps a ledger of its own emits in the last 4000 ms, each with its upper cost, and reads
the server's own figure, which arrives on every player update as `cc` (`server.js:1024`) and the
client keeps as `character.cc`. It decides from

```
used = max(character.cc, sum of the ledger over the last 4000 ms)
```

so a wrong table entry can only make it wait earlier, and a lagging `character.cc` is covered by
the ledger.

### 5.3 Priorities

| Band | Calls | Sends while | When it does not fit |
|---|---|---|---|
| survival | escape, potion `use`, heals, combat skills and attacks, combat steps (movement `step()`) and the escape's moves | `used + cost <= 200` | waits in its own queue, first out |
| job | merchant job calls, travel moves, bank, trade, equip, mail, the fighter's handoff sends | `used + cost <= 170` | waits in order |
| background | players (`shared.js:822-824`), the merchant's background Ponty read (1265-1290), the automatic tracker request (780-786) | `used + cost <= 120` | skips this turn; the timer asks again |

Pending your answer (queue A16; M12).

- **Order.** Calls in one band leave in the order they were made. A waiting survival call goes
  before waiting job calls. A job call never passes a waiting survival call.
- **Wait bound.** Every ledger entry ages out within 4000 ms, so a queued call waits at most 4 s.
  The game's own timeouts for job calls are longer (bank calls 5000 ms, `shared.js:4587-4607`;
  `get_secondhands` 10000 ms, js/runner_functions.js:992-1004).
- **Classification.** The band comes from the caller: background timers call through
  `budget.background(fn)`, which sets a flag the wrapper reads synchronously, because the game
  functions emit before their first await (js/runner_functions.js:1003); the movement owner tags
  its `step()` calls and the escape's moves as survival; everything else is a job call.
- **The fighter's send window** (`cc <= 120`, `shared.js:5719-5720`) goes: its sends are job
  calls under the same rule.

### 5.4 Background reads

Three rules that cut background cost at the source, beside the band:
1. **Ponty in the background** reads only while the merchant stands within 500 of Ponty, because
   the server charges the read and answers `distance` beyond 500 (`server.js:251`, 5018-5020,
   7948-7951; spec 09 "Background secondhands read costs 16 away from Ponty").
2. **The tracker request** waits for its reply on the backoff (5, 15, 30, then 60 s repeating)
   instead of every 2 s (`shared.js:780-786`); a reply still schedules the 30 s refresh (801).
   Today a lost reply costs 50 every 2 s (spec 09 "Tracker retry every 2 s at cost 50").
   Pending your answer (M13).
3. **The players list** keeps its 10 s timer (`shared.js:889-890`) in the background band.

### 5.5 What replaces the Ponty pacer and the fork's move budget

- **The Ponty pacer** (fork `shared.js:9221-9230`, spacing every `secondhands` call 1.5 s apart)
  goes. The budget spaces calls by cost for every source, which the pacer did for one method only.
  The fork's read pattern stays as the Ponty job's own rule: one read per realm on arrival and one
  after each buy (fork `shared.js:9126`, c3a8a57d), in place of one read per listing
  (`shared.js:8607-8622`). Thirteen listings then cost one or two reads plus one per buy, not 13.
- **The fork's move budget** (fork `runtime/characters/move-budget.ts`, wired at fork
  `runtime/characters/movement.ts:51`) splits as movement N4 decides: its call cost check (wait
  250 ms while `character.cc >= 150`, fork `move-budget.ts:5`, 24-25) becomes the job band's
  limit for travel moves, and its 40-move counter is deleted once the benchmark of movement 9.3
  shows native moves stay under 40 per 4 s without it.
- **The stand reconcile** (16 unequips back to back, `shared.js:9537-9551`; 144 at the upper
  value) runs in the job band, so it spreads over the window instead of reaching 200 with other
  calls (spec 09 "Stand reconcile sends up to 16 unequips back to back").

## 6. Gathering yields through the job owner

### 6.1 Gathering as a job

Each enabled mode is one standing job in the queue: `{kind: 'fishing' or 'mining', retryAt:
cooldown}`, with the cooldown from `gatheringCooldowns` (`status/merchant-scheduling.ts:110-120`).
`jobs.setGathering(modes)` creates and removes them; the four routes that write `merchant-gather`
today (`http/merchant-settings.ts:79-84`, 110-114; `http/merchant-configuration.ts:88-93`;
`http/merchant-control.ts:97-102`) call it and no longer write the slot.

The three copies of "is gathering ready" become the one readiness path of 1.5: the dispatcher's
`gatherBefore` (`merchant/dispatcher.ts:127-143`), idle's `gatheringReady`
(`merchant/idle.ts:82-93`) and the checkpoint's copy (`http/merchant-progress.ts:86-92`). That
removes the case where a checkpoint yields to gathering that the dispatcher refuses (spec 08
section 2 item 9) and the case where idle sees ready work the dispatcher refuses (item 11).

### 6.2 The character side

The character gathers only while it runs a `merchant-gather` command for the current gathering
job. The 15 reasons in `gatheringBlockReason` (`shared.js:10010-10030`) map as follows:

| Reason today | After |
|---|---|
| superseded generation, disabled | the job id: a new command ends the old attempt |
| active gathering attempt | kept: the attempt's own state |
| stand operation, status update, banking, merchant job, inventory command, logistics handoff, upgrading, departure pending | another job or the idle job holds the merchant, so no gathering command is live |
| anniversary reservation | event attendance holds the merchant group (task design 2.5) |
| retry delay | kept: the attempt's own backoff (`shared.js:10164-10178`) |
| dead | death recovery holds the merchant group |
| inventory capacity | the kind's needs: the job ends `needs:space` and the plan opens a deposit visit (6.3) |

So `gatheringBlockReason` keeps two checks: the attempt in flight and its retry delay. "Every
command counts as an inventory command for gathering" (spec 08 section 2 item 16) and the logistics
hold writers (`shared.js:7042`, 7118, 10004, 10182) go with the reasons that read them.

### 6.3 Yield, cooldown and a full bag

- **Yield.** When a higher job claims the merchant, its command reaches `handle`. A cast in
  progress finishes first (today `shared.js:9998-10001`, queue A58), then `hands.settle` restores
  the hands (queue A15), the attempt stops, and the gathering job goes back to the queue with its
  cooldown. Every job command is retained (1.3 rule 3), so the deferred command is sent again on
  the next heartbeat.
- **Cooldown.** A catch ends the gathering job `cooldown` with `retryAt` from the server's
  cooldown (`shared.js:9688-9701`); the merchant then runs the idle job (stand return), the one
  stand path. The cooldown branch's own Town and stand opening (`shared.js:10053-10096`) goes.
- **A full bag.** At `LOGISTICS_RESERVE` the gathering job ends `needs:space`, and the plan opens
  a deposit visit at gathering's priority whose deposits are the gathered items
  (`depositGatheringGains`, `shared.js:9926-9986`, which then runs for the first time; spec 08
  section 2 item 6). Pending your answer (queue A56).
- **A missing tool** waits for the bank or bag signature to change instead of turning the mode
  off (1.8; M14).

## 7. Hooks

Declared in the one hook registry, `runtime/hooks/registry.ts` (movement section 6, task design
section 5). With nothing registered, each hook point is one check of an empty list.

### 7.1 The hooks

| Hook | Kind | Receives | May return | Decision point |
|---|---|---|---|---|
| `merchant.jobKind` | request | `{merchant}` once at load | one kind declaration (1.3) with `kind: 'addon:<name>'`, plus an optional character executor `{command, run(command)}` | the kind registry; the executor goes into the character's command routing |
| `merchant.job` | request | `{merchant, realm, home, gold: {available, reserve}, queue: [{id, kind, priority}], tick}` once per dispatch pass | at most one job of the add-on's own kinds | `jobs.enqueue`, ranked by the pick like any job |
| `merchant.job.started` | notice | `{jobId, kind, target, realm, priority, resumed}` | nothing | after a claim and after a resume |
| `merchant.job.paused` | notice | `{jobId, kind, by}` with `by` one of `task:<kind>`, `job:<id>`, `realm`, `user` | nothing | `jobs.pause` |
| `merchant.job.resumed` | notice | `{jobId, kind}` | nothing | when a paused job is claimed again |
| `merchant.job.ended` | notice | `{jobId, kind, code, receipts, next}` | nothing | every end |

- **Priority cap:** an add-on kind ranks from 1 to 74, below the core market purchases (75, 76)
  and every party visit, the bank and the account kinds. The owner clamps a value outside the band
  and records the clamp in the ring. Pending your answer (M15).
- **An add-on kind's realm** is `home`, `here` or `listing`; a `listing` realm passes the same
  refusals as core jobs (3.4 rule 2).
- **End codes are a fixed list:** `done`, `failed:<code>`, `yielded`, `cooldown`, `needs:<what>`,
  `expired`, `cancelled:<by>`, `refused:<why>`, `deadline`, `runtime-replaced`. The text regexes
  that pick the retry today (`merchant/completion-retries.ts:24-74`) read the code instead
  (spec 10 "Failure text is the contract with the coordinator").
- **`receipts`** in the ended notice are the completion report's purchase and delivery receipts
  (`merchant/completion-results.ts:147-169`), so an add-on counts its fills without reading the
  queue.
- **No realm or budget notices in M1.** No add-on today needs one; a new kind is added when one
  does (00-overview "Two kinds of hook, no more").

### 7.2 What the hooks do not do

An add-on cannot write the command slot, the realm or the hands: its executor runs inside
`runMerchantJob` (`shared.js:8420-8487`) under the job's lease, and its realm hop goes through
`requestRealm` (3.4 rule 6). Its walks are `errand` requests with the job's identity.

### 7.3 Worked example: the fork's Ponty and Ron watch

The fork adds standing Ponty watches and Ron visits (fork `commerce/npc-shop.ts`, 549 lines;
9476cd15, 6f4ed09a, 388b9248, df1858c6), wired into the core at four points (fork
`application.ts:1539-1565`): it shares `merchantQueue`, wraps `queuePontyMatches` and
`fulfillStandBid`, and keeps its own gold reserve. As an add-on in `addons/npc-shop/`, enabled by
one line in the add-on list:

| Today (fork) | As an add-on |
|---|---|
| `matchPonty` pushes "Ponty purchases" jobs into the core queue (fork `commerce/npc-shop.ts:357-430`) | `merchant.job` returns one `addon:ponty-watch` job per pass; its realm is `home` (df1858c6, fork `commerce/npc-shop.ts:357-380`), so the watch never hops; its command is the core `merchant-ponty-buy` |
| `queueRon` pushes "Ron purchases" (fork `commerce/npc-shop.ts:483-494`) and the character runs `merchant-ron-buy` (fork `shared.js:9899-9977`) | `merchant.jobKind` registers `addon:ron-visit` with its executor; its needs declare the 1000000 donation when consent allows (fork `commerce/npc-shop.ts:94`, 479-481), so the plan funds it; its realm is `home` |
| `spendableGold` (fork `commerce/npc-shop.ts:131-142`) | `gold.available` in the request input (2.2); the core and the add-on read one reserve (queue C9) |
| `fulfilled` wrapped into `fulfillStandBid` (fork `application.ts:1549-1555`) | `merchant.job.ended` with `receipts` |
| watch jobs at 75 through "Ponty purchases" (`merchant/priority.ts:28`) | `addon:ponty-watch` at 74, just below stand bid purchases |
| Ron's purchases skip `guardedMarketPurchase` and the 3-slot reserve (spec 10 fork row) | the kind's needs include `LOGISTICS_RESERVE`; the executor keeps its own buy calls |
| npc-price.ts duplicates the Ponty price formula (spec 10 "Ponty secondhand price formula duplicated by the fork") | stays in the add-on until the core exports `scripts/ponty-market.cjs`'s formula; not a hook concern |

Removing the add-on line removes every watch and Ron job; nothing in the core refers to them.

## 8. Bounded records

- **Merchant decision ring:** 128 entries for the job, realm and hands owners together, in memory
  on the coordinator. An entry is `{at, part, decision, kind, jobId, owner, realm, code, by,
  ladderStep}`, about 150 bytes, so about 19 KB. Decisions are enqueues, merges, refusals, claims,
  pauses, resumes, ends, bank plan visits, realm wants, moves and their ladder steps, hands leases
  and failed restores (reported by the character with its status). A label change is not a
  decision.
- **Call budget ring:** 64 entries per character, in the character runtime: each wait, each skip
  of a background read and each refusal, `{at, method, band, cost, used, waitedMs}`, about 80
  bytes, so about 5 KB. The ledger itself holds only the last 4 s of emits.
- **Not in the heartbeat or the dashboard state.** Both rings are read on demand through the
  diagnostics lease (movement queue A73).
- **Saved to disk only when:**
  1. the merchant dies;
  2. a job ends `failed:<code>` or reaches "stuck" (1.8);
  3. a realm move reaches ladder step 5;
  4. a character receives `disconnect_reason` `limitdc` (`server.js:5022-5025`): the runtime
     writes its budget ring and ledger to local storage at once and posts them with its next status
     after the reconnect.
- **Pruning:** at most 20 saved snapshots per character and none older than 7 days, pruned when a
  new one is written.
- The comparison logs of migration (11.2) are separate rings of the same sizes and go with the
  comparison code.

## 9. What it replaces and deletes

### 9.1 On the current console

`git grep -nE "(job|current|candidate|retry|queued|entry|work|paused|recovered|existing|j)\.reason *(===|!==)|\.includes\((job|current|candidate|retry|queued|entry|work|paused|recovered|existing|j)\.reason\)" refs/review/ryan-1.5 -- runtime/coordinator | wc -l`
gives 109 lines; with `-l`, 43 files. The reason lists among them:

| Stand-in | file:line | Why it goes |
|---|---|---|
| `merchantRoutineNeedsHome` list | `merchant/home-recovery.ts:28-36` | kind `realm` |
| `realmJobs` | `http/merchant-realms.ts:24-29` | kind `realm: 'listing'` |
| `marketplaceDetails` travelling and resumable lists | `merchant/commands.ts:57-63` | kind `realm` and `resumeState` |
| `commandTypes` and `ownCommandType` | `merchant/command-kind.ts:3-31` | kind `command` |
| merchant entries of `retainedCommands` | `status/response.ts:18-51` | 1.3 rule 3 |
| `separateRoutines` and `sameWork` | `merchant/queue.ts:77-83` | kind `mergeKey` |
| `automaticPickups`, `collectsPartyItems`, `pickupReason` | `merchant/pickup-jobs.ts:3-10` | kind `target` and `mergeKey` |
| `completesStorageHandoff` reason list | `merchant/job-policy.ts:26` | kind field `releasesStaging` |
| `coordinatorMerchantTransferBlocked` list | `merchant/job-policy.ts:60-72` | kind `needs.freeSlots` |
| `improvementCommunicationFailure` list, `retryAllowed` npc sales | `merchant/completion-retries.ts:61`, 75-81 | kind `retry` |
| `finish` ensureHome and Ponty recheck lists | `merchant/completion.ts:61-75` | the realm owner's home want; the recheck stays, keyed by kind |
| `expire` exceptions | `merchant/recovery.ts:179` | kind `interrupt: 'never'` and `deadline` |
| `processingRoutine` list | `merchant/commands.ts:114` | kind field |
| character suspend list and stand close list | `shared.js:8454`, 8468 | 1.3 rules 4 and 5 |
| the dispatcher's gate chain | `merchant/dispatcher.ts:89-125`, 239-253, 275-308 | 1.5 |
| `gatherBefore`, `gatheringReady`, the checkpoint's gathering copy | `merchant/dispatcher.ts:127-143`; `merchant/idle.ts:82-93`; `http/merchant-progress.ts:86-92` | 6.1 |
| `readyQueuedWork` copy | `merchant/idle-composition.ts:42-50` | 1.5 |
| five pause field lists | 1.7 table | `jobs.pause` |
| 15 slot writers with no claim | MJB-022; spec 08 section 2 item 4 | `jobs.command` |
| the 3-attempt drop, the `< 2` retries, `realmRetryExhausted` | 1.8 table | the backoff |
| errands once per command | `shared.js:5922-5923` | once per visit (2.3) |
| `merchantGoldTarget` 0 default and deposit to it | `merchant/commands.ts:12-19`; `shared.js:5942-5949` | `gold.target` (2.2) |
| "native stand funding" kind and its queueing | `http/native-stand.ts:67-77`; `merchant/command-kind.ts:8`; `merchant/commands.ts:121` | `gold.target` |
| `merchantHomeReturnAt` | spec 09 MRG-006 settings list | `move.owner` |
| `attemptReturn` cap, its dead 15 s branch and the two failure texts | `merchant/home-recovery.ts:91-111` (93-94 dead); `merchant/dispatcher.ts:115-121` | 3.5 |
| `recoverStalledSale` interval | `application.ts:489-493`; `merchant/home-recovery.ts:127-160` | the sale kind's deadline |
| party visit realm check | `merchant/party-realm.ts:21-105` | kind `realm: 'target'` and 3.5 |
| `ensureMerchantHome` and the ensure-home route | `application.ts:1640-1655`; `http/merchant-realms.ts:69-89` | the home want |
| travel port | `application.ts:358-368` | `realm.want` |
| realm request deletes in worker setup | `characters/worker-setup.ts:30-57` | `realm.target()` |
| four `changeRealm` copies and their defaults | `shared.js:8593-8598`, 8711-8716, 8827-8832, 8971-8976 | `requestRealm` |
| hops home at the end of Ponty and ALData buys | `shared.js:8660`, 8929-8930 | realm groups (3.4 rule 3) |
| `homeRealm` stamped at queue time | `commerce/bids.ts:113`; `commerce/manual-orders.ts:70`, 129; `merchant/commands.ts:69` | the owner reads `home` when it decides |
| the gathering session's hands copy, `restore-equipment` without checks, the status handler weapon release | `shared.js:9809-9812`, 6769-6782, 10636-10641, 11341-11353 | section 4 |
| 13 of the 15 gathering block reasons | `shared.js:10010-10030` | 6.2 |
| `__partyInventoryCommands` as a gathering reason, the logistics hold writers | `shared.js:10388-10393` (counter kept for other readers), 10021, 7042, 7118, 10004, 10182 | 6.2 |
| gathering cooldown branch's stand return | `shared.js:10060-10096` | the idle job |
| noTool turning a mode off | `shared.js:9784-9795`; `http/merchant-settings.ts:102-115` | M14 |
| `installSilentTracker` emit wrapper | `shared.js:740-770` | the call budget layer |
| fighter's `cc <= 120` send window | `shared.js:5719-5720` | the job band |
| tracker 2 s retry | `shared.js:780-786` | the backoff (5.4) |
| background Ponty read anywhere | `shared.js:17388-17391` | within 500 of Ponty (5.4) |
| Ponty read once per listing | `shared.js:8607-8622` | once per realm and after each buy (5.5) |
| stand closes inside jobs | `shared.js:8468`, 8731 | 1.3 rule 5 |
| stand log at the fixed legacy point | `status/merchant-observation.ts:81-82` | the configured `merchantStandLocation` (spec 08 section 2 item 13) |

### 9.2 On the fork (af92de45)

| Stand-in | file:line | Why it goes |
|---|---|---|
| Ponty pacer | fork `shared.js:9221-9230` (callers 1294, 9126) | the call budget (5.5) |
| move budget | fork `runtime/characters/move-budget.ts`; fork `runtime/characters/movement.ts:51` | movement N4 and the job band (5.5) |
| `restoreGatheringHandsForJob` and its 15 s and 1 s holds | fork `shared.js:10688-10715` | `hands.settle` (section 4) |
| npc-shop wiring into the core queue and bid fills | fork `application.ts:1539-1565` | the add-on (7.3) |
| `spendableGold` reserve for watch orders only | fork `commerce/npc-shop.ts:131-142` | `gold.reserve` (2.2, queue C9) |
| realm hop blacklist for boss chase only, dropped with it in 972c9fce | fork af92de45 `navigation/realm-hop-blacklist.ts:3-14`; `application.ts:1236` | the base gains one for every automatic hop (3.4 rule 2) |
| prim stack and Ron command types in the core lists | fork `merchant/command-kind.ts:13`; fork `merchant/commands.ts:79`, 110; fork `status/response.ts:32`; fork `shared.js:8981` | add-on kinds |
| giveaway expiry patch | 79567a23 (fork `merchant/giveaway-scheduler.ts:50-57`, 94-106) | the kind's `expires` (queue A57) |

## 10. Efficiency

### 10.1 What goes away

| Cost | Where today | After |
|---|---|---|
| a deposit and a withdrawal at the bank for almost every gold-spending job | spec 08 section 2 item 1 | one visit per plan; none when the merchant carries the job's needs |
| a "native stand funding" trip per job boundary while the stand is open and a bid is funded | `http/native-stand.ts:67-77`; `shared.js:9031-9039` | at most one visit per funding change |
| a withdrawals trip queued on every merchant report at priority 90 | `status/merchant-scheduling.ts:136-137` | automatic withdrawals ride the next visit |
| a hop pair at each boundary between two jobs on one non-home realm, and the hop back from stale `homeRealm` | spec 09 ledger 1, "Stale homeRealm" | one return per realm group |
| 17 per 10 s for the background Ponty read away from Ponty | `shared.js:17388-17391` | 0 away from Ponty |
| 51 per 2 s while a tracker reply is missing | `shared.js:780-786` | 51 at 5, 15, 30, then every 60 s |
| 13 Ponty reads for a 13-listing job, 221 at the upper value | `shared.js:8607-8622` | one read per realm plus one per buy |
| 144 in one burst for a 16-slot stand reconcile | `shared.js:9537-9551` | the same calls spread under 170 |
| a job lost after a deferral for five command types, then a 20 s recovery | spec 08 section 2 item 3 | none |
| gathering's 15-reason check every 2 s | `shared.js:10010-10030`, timer 10274 | two checks |

### 10.2 What the owners add

- Per dispatch: one pass over the queue for readiness, one plan pass over the ready jobs (bounded
  by the queue), one want compare.
- Per merchant command: `hands.settle`, one compare when no lease is live.
- Per emit on every character: one ledger push, one sum over the last 4 s (at most 200 entries,
  because every entry costs at least 1 at the upper value), one band compare.
- Per heartbeat response: `bankVisit` on the command that opens a visit, about 200 bytes with a
  few withdrawals; nothing on the others.
- Memory: about 19 KB for the merchant ring on the coordinator, about 5 KB per character for the
  budget ring.

### 10.3 How both are measured

Before and after, on the same queue, stand and party, with the method's benchmark set
(docs/implementation/00-method.md "Proof of efficiency"):

- **Calls per 4 s:** the budget ledger in comparison mode (it records and does not wait) gives,
  per character and per method, the peak and the 95th percentile of `used` per 4 s window, and the
  `limitdc` count. Pass: the merchant's peak below 200 in every window, `limitdc` 0, and no
  fighter's 95th percentile higher than before.
- **Bank visits per hour:** the ring's `visit` entries and the bank snapshot's observer changes
  (`status/bank.ts:38-45`), with deposits followed by withdrawals in one visit counted apart.
  Pass: fewer visits per job, and 0 visits that deposit and withdraw.
- **Hops per hour:** the ring's realm moves by owner. Pass: no hop pair between two jobs on one
  realm.
- **Job latency:** seconds from a job's enqueue to its claim, by kind, from the ring. Pass: no
  kind slower at the 95th percentile than before, except jobs that waited for a realm group or a
  checkpoint by design (the ring names the wait).
- **Console cost:** CPU per coordinator tick, persistence writes per minute
  (`tools/benchmark-persistence.mts`), heartbeat and dashboard bytes
  (`scripts/benchmark-dashboard-*.cjs`).
- **Play results:** stand sales per hour, bids filled per hour, gathering casts per hour, fighters'
  kills per hour; `tools/sim/e2e-benchmark.mts` and `tools/sim/e2e-rate-benchmark.mts`.
- **Pass rule:** no row gets worse on console cost or game cost; the owners do not ship until it
  holds (00-overview "No efficiency regressions").

## 11. Player-visible changes

Every change on purpose. Anything not listed stays the same.

1. **The merchant goes to the bank less.** A job no longer opens with a bank trip when the
   merchant already carries what it needs, and one trip serves several queued jobs. (queue A89)
2. **The merchant keeps working gold.** Stand bids stay funded without gold moving to the bank and
   back; gold above the target is still banked at each visit. (queue A89, M5)
3. **A gold reserve protects every automatic purchase,** default 0, so nothing changes until you
   set it. (queue C9)
4. **The merchant never gives up on its home realm.** The "retry a queued job to resume" and
   "manual retry required" holds go; it keeps trying and the card shows how long it has been
   stuck. Retry still works as a shortcut. (queue A90)
5. **Realm work is grouped:** the merchant finishes jobs on another realm before it returns home,
   never enters a PVP realm, and respects the hop blacklist for automatic work. (queue A17)
6. **A party realm switch that fails halfway ends with the whole party on one realm.**
   (queue A59)
7. **The merchant's hands are right before any command after gathering or an upgrade,** both
   hands, travel and event commands included. (queue A15)
8. **No disconnects from merchant call bursts;** background lists can be one window stale during
   busy jobs, the Ponty list refreshes only near Ponty, and a missing tracker reply is retried
   less often. (queue A16)
9. **Gathering banks its own catches** through the queue and starts again on its own when a tool
   appears in the bank. (queue A56, M14)
10. **Giveaways the merchant found itself expire at their end.** (queue A57)
11. **The merchant refreshes luck on its own characters before it runs out.** (queue A21)
12. **No job command is lost** after the merchant defers it, and a gathering toggle never replaces
    a job's command.
13. **Work that stops responding is retried on a backoff and never dropped.**
14. **A dashboard equip during a merchant job waits for the job's next checkpoint** instead of
    replacing the job's command.
15. **A party realm switch or force stand during a WTB sale waits for the sale** (up to its 180 s
    deadline), so an ambiguous sale is never replayed. (M16)
16. **Mail withdraws its postage first;** the stand uses 24 or 30 slots for a merchant that has
    them; a WTB offer whose slot emptied without a receipt is replaced after a window.
    (queue A62, A60, A61)
17. **Fork: the Ponty and Ron watch runs at priority 74,** just below core stand bid purchases,
    which it ties today. (M15)

## 12. Migration

### 12.1 Steps

Each step is one shippable change with its own rollback. Four settings select each owner's path,
as `PARTY_MOVEMENT_OWNER` and `PARTY_TASK_OWNER` do (movement 11.1, task design 10.1):
`MERCHANT_JOB_OWNER`, `MERCHANT_REALM_OWNER`, `MERCHANT_HANDS` and `CALL_BUDGET`, each
`off|compare|on`.

1. **Records first, no behaviour change.** The merchant ring and the budget ring with its ledger;
   the `limitdc` snapshot. This alone names the calls of the next disconnect.
2. **Call budget in comparison mode,** then on: one emit layer, the cost table, the bands, the
   background rules (5.4). It goes first because it guards every later step's call bursts.
3. **Kind table beside the reason lists.** The kind module loads and the comparison mode checks
   every reason list's answer against the kind's field (11.2).
4. **Job owner in comparison mode,** then on for the pick, the checkpoint, `jobs.pause` and
   `jobs.command`; the slot writers convert one route at a time.
5. **Realm owner in comparison mode,** then on: the 13 writers convert in the order of 3.3; then
   the ladder (3.5) and the party switch phases (3.6). This step follows task design step 9 (the
   task ladder).
6. **Hands owner:** leases, `settle`, one normal record.
7. **Bank plan and gold target** (section 2), then the funding kind's removal.
8. **Gathering as a job** (section 6), then the 13 block reasons' removal.
9. **Fixed counts** (1.8) on the backoff.
10. **Hooks and the fork's npc-shop add-on,** then the fork stand-ins (9.2).
11. **Delete the current stand-ins (9.1) and the comparison code.**

**Rollback:** each step is one commit or a short series, reverted on its own; steps 2 to 8 also
fall back to `compare` without a deploy of old code.

**Every step** (00-method "Rules every change follows", from the console's `AGENTS.md`):
- Its E2E scenarios from 12.3 are written, with their measures and thresholds, before its code,
  and pass on ChronAL virtual time before the next step starts.
- It ends with `npm run typecheck` and a completed console artifact. The artifact stays staged;
  the user decides when to load it.
- Steps that touch the coordinator start from `runtime/coordinator/README.md` and edit maintained
  sources: the TypeScript under `runtime/coordinator/`, never the generated
  `.build/runtime/coordinator-*.cjs` bundles. The Steam bridge changes regenerate
  `characters/steam-bridge.js` from `runtime/steam/` (spec 09 "Committed steam-bridge.js lags its
  TypeScript source").
- Game-object types the owners read (character, item, bank, status) come from
  `typed-adventureland` through `Pick` or indexed access; the kind, plan, want, lease and ledger
  types are the console's own protocol and stay local.

### 12.2 Comparison mode

- **Job owner:** every dispatch, checkpoint and completion still runs as today. Beside each, the
  owner computes its pick, its yield, its pause fields, its plan and its retry decision, and
  writes a ring entry when one differs. Every slot write by a writer that would not hold the slot
  is listed.
- **Realm owner:** every writer still writes. The owner records each write with its writer and
  the want it would have honoured, and lists every write it would not have made.
- **Hands owner:** every command still runs as today. The owner records each command that starts
  with a lease's loadout still in hand, and each restore it would have run.
- **Call budget:** every emit still goes at once. The owner records each emit it would have held
  or skipped, with `used` and the band.

A separate check resolves each difference as a bug in the owner, a bug in the old code, or an
intended change in section 11. An owner takes over when the list is empty on real play (00-method
"Proof on real play"). Comparison costs one extra decision per event, measured apart (10.3).

### 12.3 Tests

Current tests that prove each rule (spec 08 section 4 and spec 09 section 4 map them):

| Rule | Current tests |
|---|---|
| queue, merge, priorities (1.3, 1.4) | `coordinator-merchant-queue.test.cjs`, `coordinator-job-policy.test.cjs`, `coordinator-queue-selection.test.cjs`, `coordinator-merchant-initial-settings.test.cjs`, `routine-separation.test.cjs`, `delivery-trip-settings.test.cjs` |
| dispatch gates (1.5) | `coordinator-dispatch-composition.test.cjs`, `merchant-party-realm.test.cjs`, `merchant-events.test.cjs`, `merchant-anniversary-reservation.test.cjs` |
| checkpoint, pause, resume (1.6, 1.7) | `coordinator-merchant-progress.test.cjs`, `merchant-buy-cycle.test.cjs`, `coordinator-merchant-control.test.cjs` |
| completion and retries (1.8) | `coordinator-merchant-completion.test.cjs`, `coordinator-merchant-recovery.test.cjs`, `coordinator-recovery-composition.test.cjs`, `merchant-rendezvous-retry.test.cjs`, `coordinator-restart-queue.test.cjs` |
| home return and realm writers (section 3) | `merchant-recovery.test.cjs`, `coordinator-no-merchant.test.cjs`, `coordinator-merchant-job-actions.test.cjs`, `coordinator-realm-switch.test.cjs`, `coordinator-realm-routes.test.cjs`, `coordinator-realm-pause.test.cjs`, `coordinator-worker-setup.test.cjs` |
| hands (section 4) | `gathering-equipment-restore.test.cjs`, `gathering-tool.test.cjs`, `item-action-safety.test.cjs` |
| gathering (section 6) | `gathering-ownership.test.cjs`, `gathering-destinations.test.cjs`, `merchant-idle-return.test.cjs` |
| stand and visits | `merchant-stand-sync.test.cjs`, `merchant-rendezvous.test.cjs`, `merchant-convoy-interruption.test.cjs`, `merchant-delivery-recovery.test.cjs` |
| call cost | `tracktrix-refresh.test.cjs` (no other test covers the budget; MRG-025 has none) |

These are the baseline (00-method "Proof of function", step 1). Six change on purpose, and each
changed expectation is shown old and new side by side (method step 4):
- `merchant-recovery.test.cjs` cases that expect "failed after 3 attempts" expect the ladder's
  next wait (queue A90).
- `merchant-party-realm.test.cjs` cases that expect `realmRetryExhausted` expect the job queued on
  the backoff.
- `coordinator-merchant-recovery.test.cjs` "stops after three retries" expects the job kept with
  the stuck line.
- `coordinator-merchant-progress.test.cjs` pause cases expect the one `RUN_FIELDS` list.
- `gathering-ownership.test.cjs` block reason cases expect the two remaining checks and a job
  command in place of the flags.
- `gathering-equipment-restore.test.cjs` expects a restore before every command, not only at
  cooldown.

Each changed unit test changes only its expected value. Its proof moves to the E2E scenario of the
same rule below, and it retires once that scenario passes (method step 5).

#### The owners' proof: ChronAL E2E scenarios by rule

Every scenario is a gameplay E2E under `e2e/` on ChronAL virtual time, run through `npm test` with
the live fixtures (spec 15 TST-026 to TST-029): a disposable game server, the production
coordinator and native game clients, with browser, persistence and telemetry coverage. Each run
writes the e2e report artifact and removes its own workspace. Each scenario follows 00-method
"Every test is defined, measurable and labelled":
- **Label:** the rules it proves and the gaps it leaves.
- **Setup:** merchant level, gear, bag, bank, gold, queue, stand listings and bids, positions and
  settings, fixed in the scenario file.
- **Measures:** counted from the merchant ring and the budget ring (section 8), the end codes
  (section 7), the status line, the bank snapshot and the native client's outgoing packets
  (TST-027 records them).
- **Invariants checked on every coordinator tick and every merchant status report:** the merchant
  group has one live task; at most one job is current; the slot holds only the current job's
  command or none; no realm write comes from a code path other than the realm owner; `used` never
  passes 200 on any socket. The run fails at the first break and saves the rings.
- **Checks:** asynchronous state is read with a bounded poll for exact values from one fresh
  snapshot, with no sleeps and no widened timeouts. No assertion reads source text, callback order
  or CSS classes.

**J1. Claim, interrupt, resume** (1.5, 1.6, 1.7).
- Setup: a queue of a commerce job (65), an upgrade (70) and a party collection (90) arriving
  while the commerce job runs; an event attendance for the merchant opens during the upgrade; a
  dashboard equip during the collection.
- Measures and thresholds: claims whose job differs from the highest ready job: 0; yields outside a
  cycle boundary: 0; resumed jobs whose `resumeState` differs from the saved one: 0; paused jobs
  carrying any `RUN_FIELDS` field: 0; slot writes by a non-holder: 0; seconds from the event's
  end to the paused job's claim: under 2.
- Gaps: anniversary rounds are spec 06's scenario set.

**J2. One bank visit for several jobs** (2.3; queue A89).
- Setup: 0 carried gold, 5000000 in the bank; a restock (fighter), a stand bid purchase, an
  upgrade needing scrolls and a mail with an attachment, all ready, with room for every
  withdrawal; then the same queue with a bag that fits only two jobs' withdrawals.
- Measures and thresholds: bank visits for the first queue: 1 (today: one per gold-spending job,
  4, from `shared.js:5922-5923`); visits that deposit and withdraw: 0; jobs that walk to the bank with
  their needs carried: 0; for the second queue: 2 visits; reserved withdrawals deposited by
  another visit: 0.
- Gaps: BankBoi floors (INV-055) are their own scenario in spec 10.

**J3. The stand funding loop ends** (2.2).
- Setup: the stand open with one allocated bid at 2000000 and 0 carried; then six jobs of
  different kinds run back to back over 30 minutes of virtual time.
- Measures and thresholds: funding visits after the first: 0; gold deposited below `gold.target`
  at any visit: 0; native offers refused for gold while the bank covers them: 0.
- Gaps: two merchants are outside the console's model.

**J4. Realm groups, PVP and the blacklist** (3.4; queue A17). Needs the disposable server pool to
run two realms in one scenario (TST-028); see I2 when it cannot.
- Setup: Ponty listings for one bid on the home realm, a second realm, a blacklisted realm and a
  PVP realm; an ALData buy on the second realm queued behind them; a home upgrade at 70 becomes
  ready halfway.
- Measures and thresholds: moves to PVP: 0; automatic moves to the blacklisted realm: 0; hops home
  between the two jobs on the second realm: 0; returns home after the upgrade became ready while
  only lower jobs remained on the second realm: within one job end; moves whose ring owner is not
  the realm owner: 0.
- Gaps: Steam merchants (spec 15: Steam stays outside the fixtures), covered by I2.

**J5. Home return without a cap** (3.5; queue A90; with task design G8).
- Setup: the merchant on a second realm; its home realm refuses logins for 10 minutes; a home job
  and a listing job queued.
- Measures and thresholds: seconds with no due step: never more than 60; waits of 5, 15, 30, 60
  and 60 s, each within 1 s; dead-end texts ("failed after 3 attempts", "manual retry required"):
  0; the stuck line within 1 s after 5 minutes; arrival home within 70 s after the refusal lifts;
  the listing job's claim while home is refused: yes, if the merchant is connected where it needs.
- Gaps: a refusal on every realm leaves no job runnable; the line still shows.

**J6. Party realm switch rollback** (3.6; queue A59).
- Setup: a party switch of three fighters and the merchant; one fighter's login is refused
  through the retry; a second run refuses the rollback login of one character for 3 minutes; a
  third run fails `setHome` after `finish`.
- Measures and thresholds: participants on another realm than the party's when the operation
  ends: 0; `activeRealm` after a failed setHome: the old realm; stragglers named on the status
  line: every one; merchant jobs claimed during `retrying` or `rolling-back`: 0.
- Gaps: two realms needed, as J4.

**J7. Hands lease** (section 4; queue A15).
- Setup: the merchant fishing with a marked weapon and an offhand; then a Ponty job (not in
  today's suspend list), an event command, a manual travel and a stat scroll job that throws
  halfway; a last run sells the marked weapon while it is leased out.
- Measures and thresholds: commands that start with the rod in hand: 0; commands delayed by a
  restore: every one under 1.5 s; stat scroll gear left unequipped after the throw: 0; restore
  retries while the marked weapon is missing and the bag is unchanged: 0; the "marked weapon
  missing" line: within one status report.
- Gaps: two-handed weapons with a cosmetic offhand.

**J8. Call budget** (section 5; queue A16; with movement's move benchmark).
- Setup: a 13-listing Ponty job at Ponty; an idle merchant holding a Tracktrix whose replies are
  dropped, then a 16-slot stand reconcile; a bank visit while the tracker loop runs; a fighter
  party in combat beside the merchant.
- Measures and thresholds: `limitdc` on any socket: 0; the merchant's peak `used` per 4 s: under
  200 in every window; secondhands calls for the 13 listings: at most one per realm plus one per
  buy; background reads sent while `used` is above 120: 0; survival calls delayed: 0 in the combat
  run; the longest job call wait: under 4 s; budget ring and ledger saved on a forced `limitdc`
  (fault injector with the budget `off`): 1 snapshot.
- Gaps: the live game server may charge differently from the clone (spec 09 Gaps).

**J9. Gathering through the job owner** (section 6; queue A56, A58).
- Setup: fishing enabled; a party collection becomes ready mid-cast and between casts; the bag
  fills while fishing; the rod is missing from the bank, then is deposited by a fighter's
  collection.
- Measures and thresholds: casts while another job holds the merchant: 0; seconds from the claim
  to the merchant leaving the spot: under one cast plus 2 s; deposit visits after the bag filled:
  1 at gathering's priority; gathering restarts after the rod was banked: within one dispatch of
  the bank snapshot change; modes turned off by a missing tool: 0.
- Gaps: mining's tunnel spot is the same path.

**J10. Fixed counts gone** (1.8).
- Setup: a merchant worker that stops reporting four times in a row on one job; a rendezvous that
  times out three times; an interrupted upgrade three times.
- Measures and thresholds: jobs dropped: 0; waits that match the backoff: every one within 1 s;
  the stuck line after 5 minutes: within 1 s; other ready jobs claimed between the retries: all.
- Gaps: none known.

**J11. Hooks: the npc-shop add-on** (section 7).
- Setup: the fork's watch as an add-on with one Ponty watch on the home realm and Ron consent; a
  fixture add-on that asks priority 90 and a PVP listing realm.
- Measures and thresholds: add-on jobs above 74: 0; clamps in the ring: one per request outside
  the band; jobs with exactly one `started` and one `ended` notice: all; watch fills counted from
  `receipts` equal to the native receipts: all; add-on moves to PVP: 0; with the add-on line
  removed, add-on jobs in the queue after one dispatch: 0.
- Gaps: add-ons other than the fixture and the fork's watch.

**J12. Spec 10 work the merchant runs** (2.4; queue A60, A61, A62, C9).
- Setup: a level 70 merchant with 20 planned listings; a WTB offer whose slot empties with no
  receipt; a mail with an attachment and 0 carried gold; a gold reserve of 1000000 with bids that
  would spend below it.
- Measures and thresholds: listings placed in trade17 to trade24: 4 (queue A60); the blocked
  offer replaced after the window: yes (queue A61); attachment mails sent with less than the
  postage carried: 0, items moved to slot 0 before the postage is on hand: 0 (queue A62); spending
  below the reserve: 0 (queue C9).
- Gaps: level 80 merchants (30 slots) need a second seed.

**J13. Records and comparison mode** (section 8; 12.2).
- Setup: a fault injector forces a merchant death, a failed job, a realm move to step 5 and a
  `limitdc`; the run then advances 8 days with 25 triggers. A second run uses the J1 setup with
  each owner in `compare` beside an `off` run on the same seed.
- Measures and thresholds: snapshots per trigger: 1; ring entries after 200 decisions: 128 (64 for
  the budget ring); saved snapshots per character after pruning: at most 20, none older than 7
  days; ring fields in the heartbeat and dashboard payload: 0; in compare mode, claims, moves and
  emits per minute equal to the `off` run, and differences with no ring entry: 0.
- Gaps: disk failures while saving.

The efficiency measures and their pass rule are in 10.3; they run on the J2, J3, J4 and J8
setups.

#### Isolated tests, where no E2E can reach the case

Each failure list below comes before the code (AGENTS.md: write down every way the system could
fail, then write the code). Each test loads the TypeScript module it names.

**I1. The kind table and the interruption rows** (`runtime/merchant/job-kinds.ts`; 1.3, 1.6).
- Why no E2E: about 40 kinds against 9 takers give some 360 pairs, and most never meet in a run
  that can be set up (a bank unlock against a party switch, an add-on against a `holdsQueue`
  kind). J1, J7 and J9 cover the pairs that meet in play.
- Expected values: the 1.3 and 1.6 tables as written in this design, typed in by hand, not
  generated from the module under test.
- Failure list:
  1. A kind's command, realm or retry differs from the table.
  2. A saved reason with no kind is dropped instead of mapped through today's aliases
     (`merchant/routines.ts:4`; `merchant/priority.ts:27-30`).
  3. A `never` kind yields at a checkpoint, or a `checkpoint` kind yields outside a cycle
     boundary.
  4. A `holdsQueue` kind lets another kind be picked while it waits.
  5. Two jobs with one merge key both stay queued, or two keys merge.
  6. A kind's command is not retained.
  7. The character and the coordinator route one command type to different kinds.
  8. An add-on priority outside 1 to 74 is not clamped, or the clamp is not recorded.

**I2. Realm moves on two realms and on Steam** (`runtime/coordinator/merchant/realm-owner.ts`;
3.4, 3.5).
- Why no E2E: spec 15 leaves public realms and Steam outside the fixtures; if TST-028's pools
  cannot run two realms in one scenario, J4 to J6 cannot run either, and this test carries their
  rules.
- Failure list:
  1. A want for a PVP realm is accepted for any owner.
  2. An automatic want for a blacklisted realm is accepted, or a manual one is refused.
  3. Two wants are ranked out of the order party switch, user hold, job, home.
  4. A failed attempt does not advance the ladder, or progress does not reset it, or any count
     ends it.
  5. A Steam merchant's move writes a headless stop, or a headless one writes
     `native-realm-switch`.
  6. A job carries a `homeRealm` into a command after a party switch.
  7. Worker setup returns a realm other than `realm.target()` for the merchant.
  8. A rollback leaves `activeRealm` on the destination after a failed setHome.

## 13. The parts of spec 10 the merchant executes, by owner

| Spec 10 | Owner after | What changes |
|---|---|---|
| INV-065 to INV-067 bank primitives | stay spec 10's | each bank call is a job call in the budget (2 at the upper value); the settle waits are spec 10's |
| INV-068 errands | job owner, bank plan | once per visit, to `gold.target` (2.2, 2.3) |
| INV-069, INV-070 bank sort | stay spec 10's | runs per physical visit; fewer visits |
| INV-016, INV-092 native WTB, INV-099 stand listings | stand maintenance kind | slot count from the game rule (queue A60), blocked offer replaced after a window (queue A61), reconcile calls in the job band |
| INV-087 Ponty | `Ponty purchases` kind | reads once per realm and after each buy; listings grouped by realm; no hop home at the end |
| INV-089, INV-090 ALData buy and sell | kinds with `realm: 'listing'` | refusals of 3.4 rule 2; the sale's 180 s deadline and no replay |
| INV-091, INV-093 stand buys and the reserve | kinds | `LOGISTICS_RESERVE` |
| INV-094, INV-098 NPC sales | kinds | bank stock marks ride the plan |
| INV-104 to INV-109 preview, donation, mail, restock, gold, unlock | kinds | gold needs feed the plan (queue A62 for mail) |
| INV-110 Tracktrix pin and stack merge | stay spec 10's | its 13 conditions read the job owner's `current` and the gathering job in place of the flags (`shared.js:5629-5643`) |
| INV-055, INV-056 BankBoi swap | `bankboi storage` kind | `holdsQueue` in place of the `reserved` gate |

## 14. Decisions for you

Each item: the recommendation, why it beats the others, and the negatives of every option. Items
from the review queue use its recommendation as the working assumption.

### Decided 2026-10-26

These decisions replace any working assumption or recommendation for the same item elsewhere in this document.

- **A89** (MJB-Q5: should the merchant carry working gold between jobs; decided by your answer): The merchant keeps the gold its queued jobs, its stand buy orders and your minimum need; when gold runs short it pauses the buy order or holds the job until enough gold arrives, and says so on the card.
- **M9** (Your own merchant orders on a blacklisted realm; decided by your answer): Option 1 with a warning: a manual order to a blacklisted realm shows the warning and runs once you override it, and the console recovers if the hop goes badly.
- **A15** (MRG-Q1: the merchant's gear after gathering; decided by your answer): The merchant puts its normal gear back on; if a weapon is missing it looks in the bag and bank, says so on the card and carries on.
- **A16** (MRG-Q4: the merchant's call limit; decided by your answer): Background lookups wait when the call limit gets close.
- **A17** (MRG-Q2: merchant realm hops for trading; decided by the plan): The merchant never enters PVP or blacklisted realms for automatic work, does all jobs on one realm before one trip home, and watch orders stay on the home realm.
- **A21** (MJB-Q1: Merchant's Luck on your own characters; decided by the plan): The merchant refreshes Merchant's Luck on your fighters before it runs out, starting early by the trip's length at walk speed.
- **A56** (MJB-Q2: a full bag while gathering; decided by the plan): A full bag while gathering queues a bank trip, and gathering resumes after it.
- **A59** (MRG-Q3: a party realm switch that fails halfway; decided by the plan): Stragglers in a failed realm switch keep retrying while their logins make progress, the status line names them, and the card says stuck when nothing changes (rule R2).
- **A90** (MJB-Q6: the merchant's trip home after 3 failures; decided by the plan): Trips home keep trying with growing waits, and Retry stays as a shortcut.
- **M3** (When a more urgent job takes over; decided by the plan): A more urgent job takes over at the running job's next safe stopping point, and a never interrupt job finishes first.
- **M4** (Pausing a merchant job; decided by the plan): Every pause clears the same parts of a job and keeps its place in line.
- **M5** (How much working gold; decided by the plan): The merchant keeps what its queued jobs, stand buy orders and your minimum need (A89).
- **M6** (Several jobs on one bank visit; decided by the plan): One bank visit also prepares the next ready jobs on the same realm, as far as the bag and gold allow.
- **M7** (Automatic withdrawals; decided by the plan): Automatic withdrawals ride the next planned bank visit and get their own trip once a job or the stand cannot go on without them (rule R2).
- **M8** (When the merchant leaves another realm; decided by the plan): The merchant stays on another realm while its best job there is at least as urgent as its best job at home.
- **M10** (An event during a merchant realm hop; decided by the plan): An event that opens while the merchant logs in to another realm waits for the login, within the 60 s event arrival limit (rule R6).
- **M11** (A marked weapon that is missing; decided by the plan): When a marked weapon is missing, the merchant looks in the bag and bank, says so on the card and carries on with its jobs (rule R3).
- **M12** (Shares of the call limit; decided by the plan): Escape, potion and heal calls keep the share of the call limit they need, worked out from the game's call costs, and background lookups and job calls share the rest (rule R2).
- **M14** (Fishing and mining with a missing tool; decided by the plan): When a rod or pickaxe is missing, the mode stays on, the merchant looks in the bag and bank, says so on the card and carries on with other jobs (rule R3).
- **M15** (Where add-on merchant jobs rank; decided by the plan): Add-on merchant jobs rank below market purchases, party visits and banking, and above donations, giveaways, stand work and gathering.
- **M16** (A party realm switch during an ALData sale; decided by the plan): The merchant finishes an ALData sale before it follows a party realm switch.

### From the review queue

| Item | Working assumption | Why | Negatives |
|---|---|---|---|
| A15 hands after gathering | A: restore both hands before any command that is not gathering; a failed restore lets the command run and retries on the backoff, no cap (section 4) | one rule covers travel and event commands, where the hands matter most | (A) up to about 1 s before each job after gathering; one failed restore sends that job with the tool; (B) travel and event commands still leave with the tool; (C) the merchant travels and stands in events with a rod |
| A16 call budget | A: one budget on `parent.socket.emit` reading `character.cc`, with bands (section 5) | no share sits unused, and it covers bursts before the first disconnect | (A) every emit passes one more layer; Ponty and player lists can be one window stale; (B) fixed shares that sit unused and need tuning; (C) a throttle per burst after each disconnect |
| A17 realm hops for commerce | B: hops allowed; PVP refused for every move, the blacklist for automatic moves; jobs grouped by realm; one return per group (3.4) | keeps cross-realm buying and removes the hop pairs | (B) a home job can wait up to one realm group; the blacklist moves into the base; (A) cheaper listings and giveaways elsewhere are missed; (C) hop pairs and PVP hops stay |
| A21 luck on own characters | A: refresh on the lead time, skip only another merchant's strong buff | the "strong" flag is a side effect, and the character side already does this | (A) one more check; earlier luck trips at priority 100 preempt other work; (B) fighters lose luck until the next visit; (C) the longest time without luck |
| A56 gathering and a full bag | C: the job ends `needs:space` and the plan opens a deposit visit at gathering's priority (6.3) | the job owner stays the one place that decides | (C) a slow restart when the queue is busy; (A) a second banking path; (B) gathering idles until other work empties the bag |
| A57 self-found giveaways | A: expire at the giveaway's end, release the claim | removes trips to ended giveaways | (A) the end time is an estimate from one report; (B) wasted trips |
| A58 a cast in progress | A: finish the cast, then the job; every job command retained (1.3 rule 3) | a few seconds of delay, no second priority rule | (A) an urgent visit waits for the cast; (B) the catch is lost and the character gains a priority rule |
| A59 a party switch that fails halfway | B then A: one retry per straggler, then roll back, with failed rollback logins on the backoff (3.6) | the party always ends on one known realm without you | (B) about 2 minutes in the usual worst case, longer while a login fails; one login a minute meanwhile; (A) a full rollback for a straggler that only missed the deadline; (C) a split party until you notice |
| A60 stand slots | A: the slot count from the game rule in one helper | follows the game exactly | (A) the status must carry the stand type; the reconcile must tolerate the count growing; (B) up to 14 slots unused; (C) a wrong setting plans slots the game does not have |
| A61 a blocked WTB offer | A: drop and re-place after a window, with a dashboard notice | the bid recovers without you | (A) a lost receipt can over-buy one batch; the window needs a length; (B) the bid stalls; (C) a manual removal counts as a purchase |
| A62 mail postage | A: withdraw postage first; fail clearly when the bank cannot cover it; the plan carries it (2.4) | the merchant already withdraws gold this way | (A) the postage read can return null and needs the 48000 and 360000 fallback; (B) you fund every mail; (C) the item moves before the send fails |
| A73 rings in the heartbeat | read on demand with a lease | cuts payload | no ring history unless the view was opened or a snapshot was saved |
| A79 which rule decides the stand is full | (a): the coordinator publishes free stand slots through `jobs.view()` | it cannot drift from the coordinator's refusal | one more field, up to one poll late |
| A80 gathering rows on the card | (a): the job owner publishes gathering readiness through `jobs.view()` | only the runtime knows when gathering runs | a new field |
| A89 working gold | A: a working gold target, here derived from the plan's needs plus a floor setting (2.2, M5) | one value changes and the shared errand stays | (A) gold held on the merchant is not in the bank for fighters; a purchase above the target still needs a trip; (B) changes the shared errand, and gold builds up without a ceiling; (C) does nothing alone; (D) leaves the gold trips |
| A90 home return | (b): no cap, the realm owner's ladder (3.5) | the merchant gets home without you | (b) one login attempt a minute while the failure lasts; home jobs wait through it; (a) waits for you; (c) the merchant works away from its stand and the party |
| C9 gold reserve | A: one reserve for every automatic purchase, default 0 | protects all automatic spending | (A) bids and watch orders compete above the reserve with no order between them; (B) the reserve does not mean what its name says; (C) one bid can empty the bank |
| D10 and A45 merchant at events | the merchant's own event attendance and return (task design D10) | the merchant travels alone already | two returns for one event |

### New in this design

**M1. Four owners, where each lives.**
- Recommendation: the job owner and the realm owner on the coordinator, the hands owner on the
  merchant's character, the call budget on every character.
- Why: the queue, the realm request and the realm switch are coordinator records today
  (`merchant/dispatcher.ts:19-22`; `merchant/home-recovery.ts:84-89`;
  `characters/realm-switch.ts:57`), so their owners sit with them. Hands and the socket are
  per character and change between two heartbeats, so a coordinator owner would decide on stale
  data. It beats one merchant owner for all four because each has a different clock (dispatch per
  report, login per minute, hands per command, budget per emit), and beats putting the job owner on
  the character because the queue's producers (status scheduling, bids, routes) are on the
  coordinator.
- Negatives: (recommended) a hands failure reaches the coordinator one status report late; the
  kind module serves two runtimes. (one owner) one module with four clocks. (job owner on the
  character) every producer posts to the character, and a restart loses the queue.

Answer in the review queue (M1).

**M2. The reason string stays the kind's id.**
- Recommendation: each kind's id is today's reason string; aliases (`merchant/routines.ts:4`,
  `merchant/priority.ts:27-30`) map old saved reasons to kinds.
- Why: saved queues, saved priorities and the dashboard keep working with no migration, and the
  kind table removes the lists, not the names. It beats new ids because those need a migration of
  every saved job and every saved priority key (spec 11).
- Negatives: (recommended) some ids stay unclear ("marked items" is a party collection);
  (new ids) a migration and a second set of names during it.

Answer in the review queue (M2).

**M3. A higher job interrupts only at a cycle boundary.**
- Recommendation: keep today's rule: a ready job of higher priority takes over at the next
  checkpoint that is a cycle boundary; `never` kinds finish first.
- Why: the executors already mark their safe points (`cycleBoundary`,
  `http/merchant-progress.ts:153`), and a paid step interrupted mid-way is what the production
  journal guards. It beats interrupting at once because a half-done upgrade or trade leaves
  inventory the journal must reconcile, and beats a priority margin (yield only for +10) because
  no measurement shows the churn that a margin would answer.
- Negatives: (recommended) a long job with rare checkpoints delays an urgent visit until its next
  boundary; (at once) more production recoveries; (a margin) a number to tune.

Answer in the review queue (M3).

**M4. One pause field list, and order by age.**
- Recommendation: `jobs.pause` strips one `RUN_FIELDS` list for every pause source and keeps
  `queuedAt`; order comes from priority and age only.
- Why: five lists strip different fields today, and a force stand resume carries a stale
  `commandReport` (spec 08 section 2 item 8). It beats keeping per-source lists because each list
  is a chance to keep one stale field.
- Negatives: (recommended) a field one source kept on purpose (force stand keeps
  `operationStage`, `http/merchant-control.ts:112-126`) is stripped; the executor then restarts
  that stage from `resumeState`. (per source) today's stale fields.

Answer in the review queue (M4).

**M5. What the working gold target is.**
- Recommendation: `gold.target = max(floor setting, stand funding, the plan's gold needs)`, the
  floor defaulting to 0.
- Why: queue A89 (A) asks for a default someone picks; deriving the target from the queue's own
  needs gives the merchant the gold it is about to spend without a number to guess, and the floor
  lets you keep more. It beats a fixed default because any fixed value is wrong for some queue, and
  beats no target because the bank-first chain stays.
- Negatives: (recommended) the needs are estimates (a commerce order's 90th percentile, INV-036),
  so a job can still need a second withdrawal; stand income above the target is banked only at a
  visit. (fixed default) a value that is too small makes trips, too large keeps gold off the bank.
  (no target) today's chain.

Answer in the review queue (M5).

**M6. Which jobs ride one visit.**
- Recommendation: the picked job plus the next ready jobs on its realm group, in pick order,
  while their withdrawals fit the free slots minus 3 and their gold fits `gold.available`; items
  for later jobs are reserved for them.
- Why: it uses the visit the picked job makes anyway and stops at the bag and the gold, the two
  limits the errands already respect (`shared.js:5950-5959`). It beats planning the whole queue
  because the queue changes between visits, and beats the picked job only because the trips stay.
- Negatives: (recommended) reserved items occupy slots until their job runs, so a cleanout or
  collection that arrives meanwhile has fewer slots; a cancelled job leaves items to bank at the
  next visit. (whole queue) withdrawals for jobs that change before they run. (picked job only) a
  trip per job.

Answer in the review queue (M6).

**M7. When automatic withdrawals get their own visit.**
- Recommendation: automatic withdrawals and bank sale marks ride the next planned visit, and get
  a visit of their own after 10 minutes without one; manual withdrawals keep their own job at 90.
- Why: today an automatic withdrawal queues a trip on every report at 90
  (`status/merchant-scheduling.ts:136-137`), above most jobs; riding the plan removes those trips,
  and the 10 minute bound keeps sale stock from waiting forever. Manual withdrawals are your own
  request, so they keep today's speed.
- Negatives: (recommended) NPC and stand sale stock can wait up to 10 minutes; the 10 is not
  measured (J2 reports the waits). (today) a trip per withdrawal set. (no bound) stock waits as
  long as no job visits the bank.

Answer in the review queue (M7).

**M8. When a realm group ends.**
- Recommendation: the merchant stays on a non-home realm while the best ready job runnable there
  has at least the priority of the best ready home job; it returns when a higher home job is ready
  or nothing here is ready.
- Why: queue A17 (B) asks for an end rule; this one never lets a lower job here delay a higher job
  at home, and never returns home only to hop back for a job of equal priority. It beats a time cap
  because priority is the user's own order, and beats "finish every job here" because a home job
  of higher priority would wait behind any number of lower ones.
- Negatives: (recommended) two equal-priority jobs, one here and one at home, run here first even
  when the home one is older; (time cap) a number to tune, and hops at the cap; (finish all here)
  home jobs wait behind the whole group.

Answer in the review queue (M8).

**M9. Manual orders and the hop blacklist.**
- Recommendation: the blacklist binds automatic jobs only; a manual order on a blacklisted realm
  runs; PVP is refused for every move.
- Why: the blacklist lists realms you do not want automatic hops to pick (fork af92de45
  `navigation/realm-hop-blacklist.ts:3-7`), and a manual order names its realm on purpose. PVP is
  refused because the party switch already refuses it (`http/realms.ts:104-107`) and a merchant on
  a PVP realm can be killed by players. It beats binding manual orders too because that refuses
  your own order without a reason you chose.
- Negatives: (recommended) a manual order can take the merchant to a realm with a bad ping; (bind
  both) a manual order fails with "blacklisted" until you edit the list.

Answer in the review queue (M9).

**M10. Every realm move holds `realm-hold`.**
- Recommendation: from the write of the destination to the arrival or the attempt's failure,
  every move, including a job's listing hop, holds the merchant group's `realm-hold` task at 88.
- Why: a character in the middle of a login can do nothing else, and the task owner's table then
  says so: an event attendance (66) waits for the login instead of asking a merchant that is not
  connected. It beats leaving job hops inside `merchant-job` because the task owner would then see
  a job it can suspend while no runtime exists to suspend it.
- Negatives: (recommended) an event that opens during a login waits up to the login's 60 s; the
  task line flips between `merchant-job` and `realm-hold` during a multi-realm job. (job hops
  inside the job) suspends sent to a runtime that is restarting.

Answer in the review queue (M10).

**M11. A missing normal item is not a failed restore.**
- Recommendation: when a normal-hands item is in neither the bag nor the hands, the owner shows
  "marked weapon missing" and retries only when the bag signature changes.
- Why: queue A15's own negative is a restore that cannot succeed costing one failed attempt a
  minute while the merchant idles. Waiting for the bag to change costs nothing while the item is
  gone and retries as soon as it returns. It beats clearing the intent because the weapon may be in
  the bank or on its way back from an upgrade.
- Negatives: (recommended) an item that moves into the bank does not change the bag, so the
  restore waits until the next bag change; (retry every 60 s) a failed equip a minute; (clear the
  intent) you mark the weapon again.

Answer in the review queue (M11).

**M12. Call budget bands and costs.**
- Recommendation: background reads at 120, job calls at 170, survival at 200; costs at the upper
  value (`CC` plus 1); `used = max(character.cc, ledger)`.
- Why: 120 is queue A16's example and leaves 80 for jobs and combat; 170 leaves 30 for a survival
  burst during a job (inference: potions, heals and attacks have no `CC` entry, `server.js:247-260`,
  so a potion, a heal and ten combat steps cost about 30 at the upper value, 2.5 per step). The upper cost and the max of two sources mean a
  wrong entry or a stale `cc` only makes calls wait earlier. It beats per-source shares (A16 (B))
  because no share sits unused.
- Negatives: (recommended) the numbers are not measured yet (J8 reports the windows); at 170 a
  job can wait while survival does not use its 30; the upper cost wastes up to 1 per call if the
  clone's charging holds (correction 1). (lower bands) slower jobs. (higher bands) less room for
  survival.

Answer in the review queue (M12).

**M13. Background read rules.**
- Recommendation: the background Ponty read only within 500 of Ponty; the tracker retry on the
  5, 15, 30, 60 s backoff; players every 10 s as today.
- Why: the server charges a Ponty read beyond 500 and answers only `distance`
  (`server.js:7948-7951`), so the read away from Ponty buys nothing; a missing tracker reply is not
  helped by asking every 2 s at 51 each. The fork's Ponty matching already prefers ALData's feed
  for other realms (INV-006 refreshes every 60 s).
- Negatives: (recommended) the merchant's own Ponty view is older while it stands elsewhere, so a
  local Ponty bid waits for ALData's minute refresh or the next visit near Ponty; the tracker panel
  can lag up to a minute after a lost reply. (today) 17 per 10 s with no data, and 51 per 2 s.

Answer in the review queue (M13).

**M14. Gathering as a standing job, and a missing tool.**
- Recommendation: each enabled mode is a standing job; a missing tool makes it wait for a bank or
  bag change instead of turning the mode off.
- Why: one readiness path replaces three copies (spec 08 section 2 items 9 and 11), and a mode
  turned off by a missing tool waits for you today (`http/merchant-settings.ts:102-115`), a state
  the upstream priorities rule out.
- Negatives: (recommended) two standing entries in the queue view; a merchant with no tool anywhere
  keeps one entry waiting. (today's timer and flags) the copies and the manual turn-on.

Answer in the review queue (M14).

**M15. The add-on job band.**
- Recommendation: add-on kinds rank 1 to 74.
- Why: below the core market purchases (75, 76), party visits, the bank and the account kinds, so
  no add-on delays a fighter's restock or a cleanout; above donation, giveaways, stand search,
  stand maintenance and gathering, so an add-on market job can still run before idle work. The
  fork's watch lands at 74, one below the stand bids it ties today.
- Negatives: (recommended) an add-on can never outrank a core purchase even when you want it to;
  two add-ons at one priority keep age order. (1 to 99) an add-on could delay a party visit.

Answer in the review queue (M15).

**M16. A party switch or force stand during a `never` job.**
- Recommendation: the merchant's leg of a party switch, and a force stand, wait for a `never` kind
  (today only the ALData sale) to end or reach its deadline; fighters' legs go at once.
- Why: today the party switch requeues a running ALData sale at the head
  (`merchant/realm-pause.ts:18-25`), while the stall recovery says never to replay one
  (`merchant/home-recovery.ts:133`), so a switch can replay a sale the server already filled
  (correction 3). The sale's deadline is 180 s, so the wait is bounded.
- Negatives: (recommended) the merchant joins the party's new realm up to 180 s late; (today) a
  possible double sale into one WTB order.

Answer in the review queue (M16).

**M17. One writer for the merchant's command slot.**
- Recommendation: every write to the merchant's slot goes through `jobs.command`, which refuses a
  writer that does not hold the slot.
- Why: the 15 code paths of MJB-022 share the slot today with no claim, and a gather toggle or a completion can
  replace or delete a newer command (spec 08 section 2 item 4). It beats per-writer guards because
  each guard sees only its own case.
- Negatives: (recommended) every route that writes the slot today must change; a refused write
  from a route answers 409, which the dashboard must show. (guards) the races stay for writers
  without a guard.

Answer in the review queue (M17).

**M18. No saved plan, lease or ledger.**
- Recommendation: the bank plan, the hands leases and the budget ledger are not saved; the owners
  rebuild them at load.
- Why: the plan follows from the queue and the inventory, a lease from the hands the character
  sees, the ledger from the next 4 s of calls; a saved copy can disagree with them after a crash
  (00-overview "Function without bloat"). The only new saved value is the gold floor (M5).
- Negatives: (recommended) a restart can lose a reservation, costing one extra deposit at the next
  visit, and a lease held at the restart ends without a restore until the first `settle`; (saved)
  more saved fields and their registry entries (spec 11).

Answer in the review queue (M18).

## Corrections to the checked specs

Found while designing, each rechecked on `refs/review/ryan-1.5` or the game clone. They are not
applied to the specs; the next verification pass decides them.

1. **The base call charge (00-method "Game call cost, settled"; 00-overview finding 5;
   QUESTIONS; movement design N4 and 9.3).** These say the base charge from
   `add_call_cost(-1)` lands on the socket that sent the previous message, so a move costs 2.5 and
   13 Ponty reads 208 to 221. In the clone, `current_socket` is assigned only at `server.js:4981`
   (set to the sender after the charge) and at :5054 (reset to `false_socket` after every handler,
   outside the `try`), and nowhere else (`grep -n "current_socket *=" node/*.js`). So at :4980 it
   is always `false_socket`, and the base charge never reaches a player socket. That is what spec 09
   (call table first row, ledger 12) and 07-verification-08-10.md rows C-1 and R-4 say, and the
   logged `["secondhands",208]` is exactly 13 x 16. This design still plans for the upper value as
   asked, which costs a margin of 1 per call; the "settled" text and the overview's "208 to 221"
   conflict with the clone and with spec 09.
2. **Move cost across specs.** Spec 09's fork table row says the fork's 40-move cap is 60 of 200
   (1.5 per move); movement design N4 and 9.3 say 100 (2.5 per move). They follow correction 1's
   two readings; one of them changes with it.
3. **A party switch requeues a running ALData sale (spec 09 MRG-003; spec 08 MJB-025).**
   `pauseMerchantForRealm` requeues any current job at the head (`merchant/realm-pause.ts:18-25`),
   an ALData sale included, while `recoverStalledSale` never retries one
   (`merchant/home-recovery.ts:133`) and `expire` skips it (`merchant/recovery.ts:179`). Neither
   spec lists the replay. Inference: the replay can sell into the same order twice when the first
   trade went through before the switch.
4. **Jobs dropped after fixed counts are not flagged (spec 08 MJB-025, MJB-028; the review queue).**
   `requeue` drops a job after 3 recovery attempts ("Stopped unresponsive merchant work after three
   retries", `merchant/recovery.ts:80-86`), and `retryAllowed` drops an interrupted job after 2
   retries (`merchant/completion-retries.ts:75-81`). Spec 08 describes both as rules, not as bugs
   against the upstream priority on fixed retry counts, and the queue has no item for them. This
   design answers them in 1.8.
5. **A missing gathering tool turns the mode off (spec 08 MJB-036, MJB-037).** The no-tool report
   removes the mode until the user turns it on again (`http/merchant-settings.ts:102-115`;
   `shared.js:9784-9795`), a state that waits for manual action. Spec 08 does not flag it. This
   design answers it with M14.
6. **Task design 2.5 cites the wrong behaviour.** The `merchant-job` row says "the job keeps its
   resume state (spec 08 MJB-023)". MJB-023 is the preflight; the resume state is MJB-020
   (`checkpointWork` saves it, `http/merchant-progress.ts:139-143`).
7. **Task design 2.5 keeps the home return in the job owner.** It says the job owner keeps "home
   return" among its gates. In this design the home return is the realm owner's, as task design
   4.2's own row and queue A90 already say ("spec 09's realm owner climbs the same ladder").
8. **Spec 08 section 2 item 10 count.** It lists 12 places for "3 or fewer free slots" plus 2 for
   "fewer than 3" and one for the 3-or-1 reserve; spec 10 lists five forms. The two lists overlap
   only in part (spec 10 adds `merchantBuyUpgradeLine` at `shared.js:7655`, `reconcileNativeStand`
   at 9350 and `canReceiveCompoundInputs` at `merchant/improvement-scheduler.ts:56-58`), so
   neither is the full count. This design's `LOGISTICS_RESERVE` replaces the union.
9. **`installSilentTracker` does not wrap headless runtimes (spec 09 MRG-024).** MRG-024 says the
   runtime wraps `parent.socket.emit`; the wrapper returns early under caracAL (`shared.js:742`),
   so headless workers have no emit wrapper at all. A budget built on that wrapper would miss every
   headless character.
10. **MJB-022 misses the dashboard's slot writers.** The equip route writes the merchant's slot
    directly (`state.commands[name] = {type: "equip", ...}`, `inventory/transfer-commands.ts:66`),
    and MJB-016 describes the equip, unequip and use-item commands it waits for, but MJB-022's list
    of slot writers does not include these routes. This design counts them under the manual
    equipment kind (1.3) and `jobs.command` (1.4).
