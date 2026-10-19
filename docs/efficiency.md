# Efficiency

## Persistence

The coordinator keeps its saved state in one append journal,
`caraGarage.jsonl` (`runtime/coordinator/persistence/jsonl-store.ts`). Each
record is one whole document, for example `{"party_dashboard_history_state_v1": {...}}`,
and replay keeps the last record per key. `createCoordinatorPersistence`
(`runtime/coordinator/persistence/writer.ts`) decides when the writer saves
each document.

On a live v1.4.0 console the journal grew 0.9-7 MB/s, and history and settings
rewrites made up 97% of it. This section records the failure inventory for each
change, written before its tests, and the guarantees each change keeps.

Memory is always current. Every change below delays or skips only the disk
copy: HTTP routes, `/party-api/state` and the dashboard read the in-memory
state, so they show a change as soon as it happens.

`tools/benchmark-persistence.mts` drives the real writer and journal at the
live event rates and prints bytes written and call times. Pass `--root` to
measure another checkout with the same script.

### History saves (P2)

`party_dashboard_history_state_v1` holds `merchantActivity` (500 lines) and
`combatLogs` (500 lines per character), about 1.08 MB live. In v1.4.0 every
combat-log POST (`telemetry/combat-log.ts`), merchant activity line
(`telemetry/activity-service.ts`) and convoy acknowledgement
(`http/convoy-acknowledgements.ts`) rewrote the whole document, 3.3-5 times a
second.

`history()` now marks the document dirty and saves it at most once per
`HISTORY_SAVE_MS` (5 s). `historyNow()` saves at once; the combat-log clear
route uses it, so a cleared log stays cleared after a crash. `flush()` saves a
pending document, and coordinator shutdown (`lifecycle/shutdown.ts`) calls it
before it closes the journal.

Crash window: a crash or `SIGKILL` loses at most the last 5 s of history lines
from the disk copy. The game clients keep their own logs.

Failure inventory:

1. A burst of N lines inside the window writes N documents instead of one.
2. A line that arrives inside the window is missing from the saved document.
3. Shutdown inside the window loses the pending lines.
4. The saved document reorders or duplicates lines.
5. The dashboard shows new lines only after the save.
6. A clear followed by a crash restores the cleared lines.
7. A failing disk write inside the timer crashes the coordinator, where the
   v1.4.0 route only returned an error for that request.
8. A failed save leaves the document clean, so a later flush skips it.
9. The pending timer keeps the process alive after shutdown.

Tests: `scripts/tests/coordinator-persistence-writer.test.cjs` (1-4, 6-9) and
`e2e/console-persistence.spec.ts` (2, 3, 5 through the real coordinator and
dashboard).

### Saves by content (P1)

`write` in `writer.ts` passed `structuredClone(value)` to the store, and
`CoordinatorJsonlStore.set` skipped the append only when the new value was the
same object as the stored one, which a fresh clone never is. Every call appended
the whole document. On a live console 20 of 21 roster saves (one per native
status report, `status/ingestion.ts`) and 19 of 20 selections saves were
identical to the record before them.

The store now keeps the JSON text of each key's last record and appends only
when the new text differs. `set` serializes before it returns, which gives
callers the isolation the clone gave, so `write` no longer clones. Replay of the
journal gives the same values, because a skipped record repeats the one before
it. A value with no JSON form (`undefined`) saves as a deletion; v1.4.0 wrote
`{}`, which made the next start fail with `Empty storage record`.

The comparison costs one string compare per save on text `append` already
produced, and it replaces a `structuredClone` of the document (Measurements,
below).

Failure inventory:

1. An identical save appends a record.
2. The store skips a save whose content changed, including a change in key
   order or in an array the caller mutated in place.
3. The store skips a save of the earlier value after a delete.
4. The first save after a restart compares against nothing and appends, or
   compares against the wrong text and skips.
5. A caller that mutates its object after `set` changes what `get`, `entries`
   or the next compaction return.
6. Character `localStorage` strings stop round-tripping.
7. A value with no JSON form writes a record replay cannot read.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-7), including a real
writer and store for unchanged roster reports, and
`e2e/console-persistence.spec.ts` (1 and 4 through the real coordinator).

### Settings split and liveness timestamps (P3)

`party_dashboard_settings_state_v1` was one 1.23 MB document of about 90
fields (`settingsSnapshot`, `snapshots.ts`), saved within a second of any
change (`scheduleSettings`, `writer.ts`). Two parts are large and change on
their own schedule: the ALData market cache (`aldataMarketListings` 0.51 MB,
`aldataMarketBuyOrders` 0.11 MB and three smaller fields), replaced on each
ALData refresh (`commerce/aldata-service.ts`), and `production` (0.33 MB),
whose attempt phases change during upgrades. Most saves changed only liveness
timestamps: on a live console 14 of 14 consecutive settings records differed
in `eventAttendance.<character>.<event>.lastLiveAt` / `lastObservedAt`, and 13
of 14 in `farmAreaState.quiet`.

Layout 2 saves three documents:

| Key | Content | Saved when |
|---|---|---|
| `party_dashboard_market_state_v1` | the five `aldata*` fields | an ALData refresh replaces one of them |
| `party_dashboard_production_state_v1` | `production` | its content changes |
| `party_dashboard_settings_state_v1` | every other settings field, plus `persistenceLayout: 2` | see below |

Liveness timestamps keep their in-memory value at full rate. A settings save
whose only changes are these values waits until 30 s after the previous
settings record (`SETTINGS_LIVENESS_MS`):

- `lastLiveAt`, `lastObservedAt`, `elapsedMs`, `authorizedAt` and `seenAt`
  numbers inside `eventAttendance`, `eventSessions`, `farmingProfiles`,
  `farmAreaState` and `standPriceHistory`
- the timestamps in `farmAreaState.quiet`, whose area keys still count as a
  change, and the `farmAreaState.seen` hit filter

Any other change saves within a second, as in v1.4.0, and carries the pending
timestamps with it. The readers of these values use windows of 3 s to minutes
(`events/attendance-limits.ts`, `scripts/farm-area-control.cjs`), and a
restart already takes longer than those windows, so a value up to 30 s old
after a crash leads to the same decisions.

Crash window: liveness timestamps up to 30 s old; everything else as in
v1.4.0.

The comparison costs one `JSON.stringify` per field, which the save needs
anyway, plus a masked stringify of only the liveness fields that changed
(`eventAttendance` and `farmAreaState` are a few KB). The writer compares the
market document by array identity first, because `aldata-service.ts` replaces
those arrays and never edits them in place.

Migration and rollback:

- Load (`initial-snapshots.ts`): when the settings document carries
  `persistenceLayout: 2`, the market and production documents override the
  same fields in it. Without the marker, the settings document is the only
  source, so a v1.4.0 journal loads every field as before.
- The writer saves market and production before settings. A crash between
  them leaves settings without the marker, and load ignores the newer split
  documents only until the next save.
- Shutdown (`flush()`) saves the settings document in the v1.4.0 layout, with
  the market and production fields inside it and the marker kept. A v1.4.0
  build started after an orderly stop reads every field.
- After a crash, a v1.4.0 build reads settings without `production` and the
  market cache. It starts with no production receipts and refetches the market
  on its first ALData refresh.
- A v1.4.0 build rewrites settings without the marker. When the new build
  starts again, it reads that document and ignores the split documents it left
  behind, which are older.
- Dashboard export and import (`persistence/dashboard-import.ts`) cover neither
  `production` nor the market fields, so the split does not change them.

Failure inventory:

1. A v1.4.0 journal with only the monolithic document loses a field on load.
2. Split documents do not override the fields in a layout 2 settings document.
3. A settings document written by a v1.4.0 build after a rollback loses to
   older split documents.
4. A timestamp-only change appends the market or production document.
5. A timestamp-only change appends settings more often than every 30 s.
6. The writer never saves a timestamp-only change.
7. A material change waits for the liveness window.
8. A change in a liveness field other than a listed timestamp waits for the
   liveness window.
9. Shutdown leaves a settings document a v1.4.0 build cannot read in full.
10. The writer skips a market cache refresh, or saves the cache on every settings save.
11. Credentials or transient fields reach a saved document.

Tests: `scripts/tests/coordinator-persistence-writer.test.cjs` (4-11),
`scripts/tests/coordinator-initialization.test.cjs` (1-3) with a v1.4.0
journal fixture, and `e2e/console-persistence.spec.ts` (7 and 9 through the
real coordinator and dashboard).

### Compaction on growth (P4)

`CoordinatorJsonlStore` rewrote every live record into a replacement file,
fsynced it and renamed it over the journal every 30 s, whether or not the
journal had grown, and at 128 MB. With a 7.6 MB live set the timer alone wrote
about 250 KB/s and blocked the event loop for the whole rewrite.

The store now tracks the bytes of each key's newest record. It compacts when
superseded records exceed both `COMPACT_SUPERSEDED_BYTES` (32 MB) and
`COMPACT_GROWTH` (3) times the live set. A compaction rewrites the live set,
so it writes the append rate times live / superseded: for the 7.6 MB live set,
about a quarter of the append volume. With a threshold of 2 times the live set
and 8 MB, the benchmark compacted every 13 s during production (0.6 MB/s of
appends) and wrote more than the 30 s timer did.
The journal now peaks near 40 MB, under the 90-130 MB it reached between
compactions in v1.4.0. Every append checks the threshold, and the
compaction runs in a `setImmediate` after the request or status report that
crossed the threshold, so that save returns at its own cost. At 128 MB it still
compacts inside the append. The 30 s timer only retries a compaction that a Windows sharing
conflict deferred. Start-up compacts only a journal with superseded records,
and `close()` compacts one at shutdown, so the next start replays a compact
file. Compaction writes the JSON text kept since P1 and no longer stringifies
each value.

Crash safety is unchanged: the journal stays authoritative until the store
renames the fsynced replacement over it, and replay of an uncompacted journal
gives the same values.

Failure inventory:

1. The timer, a restart or shutdown rewrites a journal with nothing
   appended.
2. Growth past the threshold does not compact, compacts before the minimum
   size, or compacts inside the save that crossed it.
3. The live-set count drifts after deletes, replays or compactions, so
   compaction never runs or runs on every append.
4. Compaction loses a key or keeps a deleted one.
5. The store never compacts a journal over 128 MB.
6. A Windows `EPERM` / `EACCES` / `EBUSY` during the rename fails the write
   instead of deferring 30 s.
7. close() compacts a store whose open failed (malformed journal) and overwrites its source.
8. A compaction failure at shutdown keeps the writer lock.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-4, 8 new; 5-7 by
the existing size, sharing-conflict and malformed-input tests).

### Retention (P5)

Every collection below is Ryan's v1.4.0 code (checked with
`git show v1.4.0:<path>`). Counts come from the live journal on 2026-10-05,
10-08, 10-11 and 10-18.

Four collections keyed by game entity ids or player names had no expiry:

| Collection | Live growth | Window derived from the code | Fix |
|---|---|---|---|
| `farmAreaState.seen`, `.quiet`, `.activity`, top level and in each `farmingProfiles` entry | `seen` 0 to 38 entries, then frozen | `record()` in `scripts/farm-area-control.cjs` ignores hits older than 10 s and drops `seen` after 15 s, finished `activity` after 10 s and `quiet` after `COOLDOWN` (120 s), but only while it runs, so a snapshot saved while it is idle keeps them | `prune()` holds those three rules; `record()` calls it, and the coordinator applies it at load (`application.ts`) |
| `mluckCastAt` (player name) | 35 to 49 names | `mluckRemaining` (`merchant/luck.ts`) gives 0 for a cast older than `luckDurationMs` (1 h), the same as no cast | `pruneLuckCasts` drops casts at least 1 h old, on each new cast (`merchant/completion-results.ts`) and at load (`merchant/initial-gathering.ts`) |
| `rarePursuitProgress` (monster instance id) | 1 to 25 | none: an entry matters while its monster lives, and `rare-hunting.ts` deletes it only on a kill or retry evidence | `keepNewestRare` keeps the newest 100 by `progress`, on each write (`rememberPursuit`) and at load for every scope (`navigation/initial-farming.ts`) |
| `rareRetryEvidence` (monster instance id) | 0 to 5 | none: `rare-retry-evidence.ts` deletes an entry only when new evidence makes it eligible | the newest 100 by `sight.seenAt`, on each rejection and when the store loads a scope's evidence |

Dropping a rare entry changes behavior only for an instance not touched
since the 100 newest: its next pursuit starts with a fresh 300 s budget, and
the coordinator can pursue a rejected instance once more.

A cap, the account or the game data bounds every other saved collection:

| Collection | Bound | Where |
|---|---|---|
| `history.combatLogs` | 500 per character | `telemetry/combat-log.ts`, `historySnapshot` (`persistence/snapshots.ts`) |
| `history.merchantActivity`, `anniversary.activity` | 500 | `telemetry/activity.ts` |
| `production.attempts` | 2048, plus receipt pruning | `pruneProductionReceipts` (`inventory/production.ts`) |
| `dailyDungeons.operations` | 200 | `dungeons/service.ts` |
| `huntEventTrips` | 32 per character | `events/hunt-trip.ts` |
| `standListingCache` (in memory) | 500 | `merchant/completion-results.ts` |
| market cache (`aldata*`) | replaced on each refresh | `commerce/aldata-service.ts` |
| `npcSaleMarks`, `deconstructionMarks`, `standListings` | filtered on completion | `http/automatic-sales.ts`, `inventory/automatic-action.ts`, `merchant/deconstruction.ts` |
| `standPriceHistory`, `autoNpcSales`, `autoExchanges`, `autoCompounds`, `autoDeconstruction` | one entry per item id or rule | game item list |
| roster, selections, `characterLocations`, `navigationIntents`, `returnProgress`, `restockPolicies`, `goldTargets`, `eventAttendance`, `eventSessions`, `combatDeathSeen`, `convoyCompletionReceipts`, `luckySlotTracking` | one entry per account character, and per event name where keyed so | account roster, `G` events |
| `merchantRoutinePriorities`, `merchantAutomations`, `huntFailures`, `huntBlacklist`, `passiveHunting.rules` | one entry per routine or monster type | code and game monster list |
| rare `sightings` / `cooldowns` / `kills` (in memory) | 30 s / 3 s / 120 s | `navigation/rare-hunting.ts` |
| rare diagnostics (in memory) | cleared above 100 | `navigation/rare-hunting.ts` |
| Ponty `dismissed` (in memory) | 120 s | `commerce/ponty.ts` |
| Bankboi `completedReports` (in memory) | 32 | `http/bankboi-storage.ts` |
| grouped combat `deaths` / `evidence` / `transitionTrace` (in memory, sent in reports) | 512 / 256 and 60 s / 100 | `runtime/combat/queue.ts`, `runtime/combat/grouped.ts` |

Two remain unbounded, and this change leaves them as they are:

- `anniversary.rounds`, `.attempts`, `.advertisedRounds` and `.abortedRounds`
  gain one entry per anniversary round (288 in the 2026 event, 41 KB in all).
  `anniversaryHandoffs` and `alreadyHandedOff` (`anniversary/handoffs.ts`)
  read `rounds` across every round to find unhanded slices, so trimming it
  changes handoff behavior. They grow only while the event runs.
- Grouped combat `lostTargets` (`runtime/combat/queue.ts:34`) keeps every lost
  target since the last grouped combat reset, with no count cap. It is in
  memory and in each status report, not in the journal. It needs a combat
  E2E before a cap, so it is out of scope for persistence.

Fields that exist only on the user's fork (`achievementHunt`,
`achievementBlacklist`, `achievementTarget`, `achievementPassive`, `bossChase`,
`realmHopBlacklist`, `gearSets`) are not in v1.4.0, and this review leaves
them out.

Failure inventory:

1. An expired farm-area hit, quiet area or activity survives a restart.
2. Load drops a live farm-area entry.
3. The prune drops a luck cast still in effect, or an expired one changes
   `mluckRemaining`.
4. The cap drops the newest rare progress or rejection, or removes more than
   the oldest entries.
5. The in-memory retry evidence keeps a rejection the saved dictionary dropped.
6. An absent collection becomes an empty one at load.

Tests: `scripts/tests/coordinator-retention.test.cjs` (1-6) and
`e2e/console-persistence.spec.ts` (3, 4 and 6 through a saved journal and the
real coordinator load).

### Crash recovery (P6)

A crash or power loss in the middle of an append leaves a half-written last
line. v1.4.0 replay (`record` in `jsonl-store.ts`) passed every line to
`JSON.parse` without a guard, so the coordinator could not start until someone
edited the journal by hand.

Each record goes to disk in one `writeFileSync` call of the whole line,
newline included. The operating system may still split a large write, and
power loss can leave a partial or zero-filled tail, so replay handles the last
line on its own:

- A last line that does not parse is a torn write. Replay copies its raw bytes
  to `<journal>.torn-<time>`, truncates the journal to the last complete
  line, logs a warning that names the key when the line starts with one, and
  starts. The dropped record is the one write that was in flight.
- A last line that parses but has no newline (a v1.4.0 journal can end this
  way) gets its newline before the next append, so two records never share a
  line.
- A line that does not parse with records after it is corruption, not a torn
  write. The store refuses to open and names the line, the byte offset and how
  to recover, and it leaves the journal untouched.

Shutdown stays bounded: `close()` compacts only when the live set is at most
`CLOSE_COMPACT_MAX_BYTES` (64 MB), and leaves a larger journal for the next
start. Measured times are in Measurements below.

Failure inventory:

1. A torn last line, with or without a newline, stops the coordinator from
   starting.
2. Recovery drops more than the torn line, or keeps no copy of its bytes.
3. A record appended after recovery joins the torn bytes or a last line that
   had no newline.
4. Replay drops a corrupt line in the middle silently, or the error does not
   say where it is.
5. A crash mid-append, mid-compaction (before the rename, after it) or
   mid-shutdown loses a record the store saved before the crash, or more
   history or settings than the documented windows.
6. The writer lock left by a killed process blocks the next start.
7. Reopening after a crash hangs.
8. Shutdown takes longer than the 30 s stop grace on a large journal.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-4, 8) and
`scripts/tests/coordinator-crash-recovery.test.cjs` (5-7), which SIGKILLs a
writer process at random points and at each compaction and shutdown step, 50
times, then reopens the journal in a fresh process with a time limit.

### Measurements

All numbers come from `tools/benchmark-persistence.mts` (600 simulated
seconds, real CPU time) and `e2e/console-persistence.spec.ts`, run in the same
Linux container (Node 24, shared with other jobs, load average 8-10). The
benchmark replays the live rates: 4 status reports/s with one native roster
save, 3.3 combat lines/s, merchant activity 0.25/s while farming, and 2 lines
plus 2 production phase changes/s during production, against documents of
live size.

Disk writes in MB/s, appends plus compaction rewrites, each commit added to
the one before:

| Build | Farming | Production |
|---|---:|---:|
| v1.4.0 | 5.27 (4.83 + 0.44) | 7.02 (6.58 + 0.44) |
| + history saves (P2) | 1.70 (1.48 + 0.22) | 1.70 (1.48 + 0.22) |
| + saves by content (P1) | 1.68 (1.47 + 0.22) | 1.69 (1.47 + 0.22) |
| + settings split (P3) | 0.43 (0.21 + 0.22) | 0.82 (0.60 + 0.22) |
| + compaction on growth (P4) | 0.25 (0.21 + 0.03) | 0.72 (0.60 + 0.12) |

P1 saves about 10 KB/s (roster and selections); its larger effect is CPU. P5
changes no write rate. What remains while farming is the history document,
1.08 MB every 5 s.

Speed, v1.4.0 against this branch, median / p95 in ms over three benchmark
runs (run-to-run spread in brackets):

| Path | v1.4.0 | This branch |
|---|---:|---:|
| Persistence work per status report | 0.011-0.016 / 0.07 | 0.001 / 0.016 |
| Roster save (native status report) | 0.06 / 0.10 | 0.011 / 0.02 |
| History save per combat-log POST | 5.4-5.6 / 11-13 | 0.000 / 0.004 |
| Timed save (1 s settings timer, 5 s history timer) | 9.2-10.0 / 17-21 | 1.6-1.7 / 4.2-4.9 |
| Direct settings save with a change | 9.7-10.5 / 19-22 | 2.7-3.0 / 3.9-6.1 |
| Bank save, changed (4.3 MB) | 20.6-22.2 / 31-41 | 15.7-16.0 / 24-31 |
| Bank save, unchanged | 21.2-22.5 / 38-97 | 8.7-9.4 / 12-14 |
| Compaction pause (event loop blocked) | 62-71 / 83-96, 22 per 300 s | 36-44 / 42-59, 6 per 300 s |
| Shutdown (flush and close) | 0.3 | 52-62 |

Shutdown is the one slower path: it now writes settings in the v1.4.0 layout
for rollback and compacts the journal, so the next start replays a compact
file. It runs once per stop, inside the 30 s `stop_grace_period`.

Dashboard latency through the real coordinator and dashboard
(`e2e/console-persistence.spec.ts`, 20 samples each):

| Measure | v1.4.0 | This branch |
|---|---:|---:|
| Status report to DOM, median / p95 | 32 / 66 ms | 22 / 33 ms |
| Status POST response, median / p95 | 6.3 / 15.8 ms | 3.7 / 8.2 ms |
| Combat line to DOM, median | 994 ms | 982 ms |
| History records appended for 20 lines in 20 s | 22 | 3 |

The combat line latency is the dashboard's 1 s `logs` poll; both builds show
one 1.5 s sample when a line lands shortly after a poll.

Crash recovery (`scripts/tests/coordinator-crash-recovery.test.cjs`, 50
SIGKILLs, run with `CRASH_ROOT` against v1.4.0 for comparison):

| Case | Runs | v1.4.0 | This branch |
|---|---:|---|---|
| Random moment while saving | 14 | opens | opens |
| Random moment past the 5 s history window | 6 | opens | opens |
| Compaction, before the rename | 8 | opens | opens |
| Compaction, after the rename | 8 | opens | opens |
| Shutdown, during flush and close | 8 | opens | opens |
| Torn last line, file cut inside it | 6 | fails to start: `SyntaxError: Unterminated string in JSON` | opens, drops the torn record, keeps a copy |

Every run left the killed writer's lock behind except after a finished
shutdown; every reopen took the stale lock, held every acknowledged direct
save, every history line older than 5 s and every setting older than 1 s,
and finished well inside the 15 s limit.

Journal open and `close()` at the 128 MB inline bound (one key rewritten
until one more record would pass 128 MB, a stale lock left behind):

| Live set | v1.4.0 open / close | This branch open / close |
|---:|---|---|
| 8 MB | 626 / 0 ms | 563 / 33 ms (compacts to 9 MB) |
| 60 MB | 749 / 0 ms | 807 / 180 ms (compacts to 61 MB) |
| 70 MB | 833 / 0 ms | 831 / 0 ms (above `CLOSE_COMPACT_MAX_BYTES`, left for the next start) |

## Report payload: per-copy item meta in status reports

Status reports carry only the per-copy part of each item's meta. The per-type
part comes from `merchantCatalog.allItems`, and readers join the two by item
id. On the live stack the merchant's report falls from 5.1 MB to about 0.13 MB,
each fighter's from 0.5-0.8 MB to about 0.16 MB, and the stored bank snapshot
from 4.6 MB to about 19 KB. Dashboard and API speed show no regression beyond
run-to-run noise.

### Before

`itemDefinition` in `characters/shared.js` built the full meta for every
inventory item, equipment slot, bank slot and nearby stand listing in every
report: `definition`, `upgradeable`, `compoundable`, `buyable`, `scaling`,
`maxLevel`, `usage`, `sprite`, `properties` and `world` (drop graph, suggested
prices, recipe with material drops, set and used-in lists). Only `properties`
depends on the copy (level, `stat_type`, title). `merchantCatalog.allItems`
already held the same per-type meta for all 623 items.

Live size-only read (`GET /party-api/state` inside the live container, byte
counts only):

| Report | Status | `meta` | `meta.world` | Per-copy meta |
|---|---:|---:|---:|---:|
| Merchant (59 stand listings) | 5,055,127 | 4,929,054 | 4,853,910 | 5,598 |
| Priest | 769,323 | 612,049 | 583,728 | 1,727 |
| Warrior | 526,741 | 368,310 | 345,028 | 1,545 |
| Mage | 628,578 | 469,839 | 448,369 | 1,151 |
| Bank snapshot | 4,577,678 | 4,566,109 | 4,409,529 | 7,320 |

### Change

- **Character script.** Once a status response clears `needsCatalog`,
  `itemDefinition` returns `{ properties }`, plus `sprite` for a copy whose
  `skin` differs from its definition. Before that point it returns full meta,
  so a fresh coordinator, a coordinator after a game update and a coordinator
  that rejected the catalog keep every field they had.
- **Coordinator join.** `runtime/coordinator/inventory/catalog-meta.ts`
  `entryMeta(catalog, entry)` returns catalog meta with the report's fields on
  top. It indexes `allItems` once per catalog object (O(1) per item) and caches
  each join per report meta object. Readers: `merchant-item-commands.ts`
  (merchant weapon), `stat-scroll-commands.ts`, `transfer-commands.ts`
  (manual weapon, bank upgrades), `mark-reconciliation.ts` (auto upgrade
  marks), `scripts/bank-stack-routing.cjs` (stack homes and storage worker
  unloads) and `scripts/merchant-inventory-stacks.cjs` (stack merges).
- **Public projections keep their shapes.** `compactEntry` joins before it
  selects its field list, so the `inventory` section and the dashboard stream
  send the same fields as before. The `bank` section sends those compact
  fields too, without `world` and `usage`. The unsectioned debug state joins
  full meta (`telemetry/item-meta-projection.ts`). The stream joins a record
  published before the catalog arrived again on its next telemetry sample.
- **Dashboard.** `features/party/item-catalog-meta.ts` joins catalog meta onto
  inventory, equipment and bank entries in `usePanelModel`, so every panel
  reads `entry.meta.world`, `usage` and the rest from the entry. The module
  caches joins per entry and per catalog object, so React Query structural
  sharing keeps unchanged tiles. `detailMeta` uses the same index in place of a
  linear `allItems.find` per call.

### Reader inventory

A type-aware scan (TypeScript checker: every property read whose receiver has
type `ItemMeta` in the dashboard or `ItemMetaRecord` in the coordinator) found
188 dashboard reads in 32 files and 5 coordinator reads. A runtime check ran
the full console E2E suite with a test-mode Proxy over every report meta
object in the coordinator and the browser. It recorded each field read and
each read of a per-type field the report no longer carried while the catalog
had it. It found two readers the scan cannot type: `definition.s` in
`scripts/bank-stack-routing.cjs` and `scripts/merchant-inventory-stacks.cjs`.
Both now read through `entryMeta`. After that fix the run records no such
reads in either process.

### Compatibility

- The mobile apps (PWA and Android) read `definition`, `upgradeable`,
  `compoundable`, `buyable`, `scaling`, `maxLevel`, `sprite` and `properties`
  from `inventory`, `bank` and stream entries; those fields keep their shape.
  They read `world` and `usage` through their `detailMeta` catalog join or
  straight from the catalog, which is unchanged.
- The metrics service reads only `item.name`, `item.q`, `item.level` and
  `bank.gold`.
- Reports from clients that still send full meta join with the report's
  values on top.

### Speed

Coordinator and character numbers come from `bench.cjs` on the E2E runner: a
real coordinator receives reports built by each tree's own `shared.js` meta
builders from installed game data 17175 (merchant: 42 items, 15 slots, 88
stand listings; bank: 8 packs of 42). Each cell is the median of three runs,
with 25 requests per section run, or 300 for `inventory` and `bank`.
Dashboard numbers come from a Playwright probe against the console fixture on
the vinext dev server, 11 runs on v1.4.0 and 10 on this branch, alternating;
each cell is the median of the per-run medians.

| Measure | v1.4.0 | This change |
|---|---:|---:|
| Character: build the item part of a merchant status | 43.1 ms | 1.3 ms |
| Merchant report bytes | 1,734,916 | 29,721 |
| Coordinator: POST merchant report | 24.1 ms | 5.3 ms |
| Fighter report bytes | 554,088 | 8,683 |
| Coordinator: POST fighter report | 8.3 ms | 2.6 ms |
| Coordinator: POST merchant report with bank | 80.2 ms | 5.7 ms |
| `section=fast` bytes / time | 2,457 / 0.7 ms | 2,457 / 0.7 ms |
| `section=inventory` bytes / time | 101,311 / 1.3 ms | 101,311 / 1.1 ms |
| `section=bank` bytes / time | 3,431,872 / 25.8 ms | 197,703 / 1.8 ms |
| `section=catalog` bytes / time | 6,108,982 / 46.7 ms | 6,108,982 / 50.9 ms |
| Dashboard: first meaningful render | 1,809 ms | 1,753 ms |
| Dashboard: open item details | 225 ms | 212 ms |
| Dashboard: open bank | 194 ms | 185 ms |
| Dashboard: open stand | 214 ms | 224 ms |
| Dashboard: open gear comparison | 509 ms | 472 ms |
| Dashboard: status change to DOM | 58 ms | 51 ms |

The `catalog` section time moves by less than its run-to-run spread
(46-58 ms on v1.4.0, 41-63 ms here). The `inventory` section runs 1.1-1.3 ms
on both trees; an in-process loop over the same projection with wire-parsed
objects measures 255-286 us per call including `JSON.stringify` on v1.4.0 and
229-271 us here. The dashboard probe's per-run medians overlap for every
measure: first render 1,660-2,650 ms against 1,636-2,552 ms, bank
134-274 ms against 139-426 ms.

### Tests

- `scripts/tests/inventory-loading.test.cjs`: full meta before the
  acknowledgement, per-copy meta after it, a per-copy skin sprite.
- `scripts/tests/coordinator-public-state.test.cjs`: the inventory, bank and
  debug projections join catalog meta and keep per-copy fields.
- `scripts/tests/bank-stack-routing.test.cjs`,
  `scripts/tests/merchant-inventory-stacks.test.cjs`: stack limits from the
  catalog.
- `e2e/game-fixture.cjs` sends per-copy meta after its first report, so every
  console E2E case reads joined meta.
- `e2e/console-reports.spec.ts`: a saved snapshot with per-copy meta shows the
  catalog's item name in the offline inspection after a restart (C3p).

### Follow-ups for the game-card additions

The same rule applies to the card fields from PR #135. `bonuses`
(`itemBonuses(definition)`) is per-type, so it belongs in the catalog's
`allItems[].meta` only and leaves the per-copy branch of `itemDefinition`.
`title` is per-type data keyed by the copy's title id: the report already
carries that id as `item.p`, the title definitions (`G.titles`) belong in the
catalog once, and readers join `titles[item.p]` the way they join `allItems`.

## Requests and logs

The health check, the dashboard's big sections, the container log and two
browser polls did work nobody used. The health check now asks a 14-byte
readiness route instead of building the 14.6 MB state. The bank, logs and
market sections answer 304 with no body while their content is unchanged, and
any client that does not ask for that gets the full body as before. An unknown
section answers 400 instead of the full payload. Each party kill and find by
a caracAL character prints once in the container log, from that character's
thread, and the account poll logs only when its counts change. The Steam client stops
fetching a missing activation record every 2 s, and two display-only dashboard
timers pause in a hidden tab and read at once when it returns. Section times,
dashboard latency, first render and log capture show no regression beyond
run-to-run noise.

Measurements ran in `ah-e2e-runner` against the real coordinator with the
console fixture (`e2e/coordinator.cjs`, fixture heartbeats on). The "live-size"
bank is 8 packs of 42 items with a 9 KB `world` block per item (3.17 MB), close
to the 4.4 MB live bank; logs are 1,000 lines for each of three characters
(349 KB). The client measures each time, body included. Another test stack
shared the runner, so the runs alternate (v1.4.0, branch, v1.4.0, branch), and
each value below is one run's median / p95.

### Health check (C1)

**Before.** The gateway's `/health` (`tools/hosting/gateway.ts`) calls
`servicesHealthy` (`tools/hosting/health.ts`), which fetched
`/party-api/state?catalog=0` and cancelled the body. The coordinator built the
whole payload anyway: 14.6 MB and 194 ms per call measured live, every 30 s
from the production `HEALTHCHECK`.

**Failure modes** (`scripts/tests/native-host-health.test.cjs`):

1. the check builds the full state to answer "is the coordinator up";
2. it reports healthy while the coordinator is down or answering errors;
3. it reports unhealthy against an older coordinator without the readiness route;
4. it skips the dashboard check, or asks the API before the user configures the account.

**Change.** The coordinator serves `GET /party-api/ready` (`{"ready":true}`)
next to `/party-api/state` (`runtime/coordinator/http/dashboard.ts`), so it
answers from the same moment. `servicesHealthy` asks it. A rollback can run a
coordinator older than the host; it answers 404 there, and the check falls
back to the state route.

The debug image's 3 s health check (`Dockerfile`, `debug` stage) answers from
`tools/debug/gateway.ts` with a ready flag and never reached the coordinator,
so it needed no change.

| Read | Bytes | Median / p95 (ms) |
|---|---:|---:|
| v1.4.0 `/party-api/state?catalog=0`, live-size bank | 3,187,288 | 46.0 / 88.3, 53.7 / 116.9, 51.5 / 111.1 |
| Branch `/party-api/ready` | 14 | 0.54 / 1.5, 0.63 / 2.1, 0.45 / 0.8 |
| Live v1.4.0 state read (breakdown, window A) | 14.6 MB | 194 |

### Unknown sections (C5)

**Before.** `publicState` (`runtime/coordinator/telemetry/public-state.ts`)
answered a section it did not know with the full payload: 14.3 MB measured live
for `section=mail`. A unit test pinned that fallback ("unknown sections retain
full responses").

**Failure modes** (`scripts/tests/coordinator-public-state.test.cjs`,
`e2e/console-requests.spec.ts`):

1. a mistyped or prototype section name (`constructor`, `__proto__`) answers with the full payload;
2. a request without a section stops getting the full payload;
3. a known section changes shape;
4. a client in the repository asks for a section that does not exist.

**Change.** An unknown section answers 400
`{"error":"Unknown state section","sections":[...]}`. No section, or an empty
one, still answers the full payload. The old test now checks the private-state
rule on the full payload. The console E2E records every state request the
dashboard makes while it opens the bank and market and finds only known
sections. The PWA, the APK (`PartyRepository.kt`) and the metrics service
(`collector.ts`, `follow.ts`, `server.ts`) ask only `core`, `config`, `fast`,
`inventory`, `logs`, `bank`, `market` and `catalog`.

| `section=mail` | Status | Bytes | Median / p95 (ms) |
|---|---:|---:|---:|
| v1.4.0, live-size bank | 200 | 3,187,285 | 47.2 / 83.6 |
| Branch | 400 | 114 | 0.66 / 10.8 |

### Conditional bank, logs and market sections (C3)

**Before.** The dashboard polls `bank` every 2 s, `logs` every 1 s and `market`
every 10 s (`dashboard/features/party/query-cache.tsx`, `policies`), and each
poll carried the whole body: 4.4 MB, 1.2 MB and 1.75 MB live. Express already
hashed each body for a weak ETag, but browsers add `Cache-Control: no-cache` to
any fetch that sets `If-None-Match`, and Express's freshness check then always
answers 200. The fixture measurement showed one stable ETag per section and a
200 to every conditional request.

What each section carries (`createPublicStateRoute`):

| Section | Fields |
|---|---|
| `bank` | `bank` (snapshot), `bankVaults`, `bankCurrent`, `bankQueue`, and `bankbois` with `dashboard=1` |
| `logs` | `gameLogs`, `combatLogs`, `merchantActivity` |
| `market` | `aldata`, `ponty`, `standPriceHistory` |

The bank tab (`usePanelModel`) lays the `bank`, `market` and `logs` domains over
the `core`, `config` and `catalog` domains. Marks for sale, withdrawal and
upgrade, NPC sale marks, automatic rules, stand listings, BankBoi summaries and
bank gold come from `config` and `core`. Those sections keep their polling, and
each dashboard action keeps invalidating the domains in `actionDomains`
(`query-actions.ts`).

**Failure modes** (`scripts/tests/coordinator-section-revision.test.cjs`,
`scripts/tests/dashboard-section-revision.test.cjs`,
`e2e/console-requests.spec.ts`):

1. an unchanged bank, logs or market section resends its whole body on every poll;
2. the revision stays the same although a field the section carries changed,
   so the dashboard keeps showing old bank contents, jobs, logs or prices;
3. a client that sends no revision (PWA, APK, metrics) gets anything but the full body;
4. a stale or malformed revision answers 304;
5. sections outside bank, logs and market start answering 304;
6. a 304 replaces the cached data with nothing, or the dashboard sends a
   revision for data it no longer holds (replaced by `setQueryData`, removed);
7. structural sharing loses the revision, so the dashboard never gets a 304;
8. a mark, unmark, withdrawal mark or rule change, or a bank change, shows later than in v1.4.0;
9. auth loss and server errors behave differently.

**Change.**

- **Coordinator.** `sendWithRevision`
  (`runtime/coordinator/telemetry/section-revision.ts`) serializes the section
  once, hashes it with SHA-1 (the hash Express computed for its ETag) and sets a
  strong ETag. A request whose `revision=` query or `If-None-Match` header
  matches answers 304 with no body. The revision is a hash of the whole body,
  so a change in any field in the table above answers 200; the unit test
  mutates each field and checks for a new revision.
- **Dashboard.** `readRevision` (`query-cache.tsx`) keeps each revision with
  the cached data object it arrived with (a `WeakMap`), and sends it only while
  that object is still the cached value. A 304 returns the cached object, so
  nothing re-renders. The domains' `structuralSharing` carries the revision to
  the shared object. The dashboard reads a section in full after `setQueryData`
  replaces its data or the cache removes it.
- **External clients.** A client that sends neither `revision=` nor a matching
  `If-None-Match` gets the same body as v1.4.0 (field-for-field test). The PWA
  and APK (`pm-worktrees/mobile-fork`, `origin/dev` of
  `adventureland-party-mobile`) and the metrics service
  (`party-console-metrics/src`) send neither, so they need no change. The
  gateway's `Cache-Control: no-store` keeps browsers from caching the body, as
  before.

- **Test mocks.** Console E2E tests that rewrite a fetched state body
  (`page.route('**/party-api/state*')` with `route.fetch()`) kept the real
  ETag on the rewritten body, so the next poll's revision matched the real
  body and `route.fetch()` returned a 304 with nothing to rewrite (three
  failures in the first full run). They now fetch through
  `e2e/state-route.ts`, which drops the revision. A proxy that rewrote bodies
  and passed the ETag through would hit the same problem; nothing in the
  hosting stack rewrites bodies.

The server still builds and serializes the section on every poll; a 304 saves
the transfer, the browser's parse and React Query's structural comparison.

| Section (fixture, live-size bank) | Bytes | v1.4.0 median / p95 (ms) | Branch, no revision | Branch, unchanged (304) |
|---|---:|---:|---:|---:|
| `bank` | 3,167,456 | 35.9 / 75.7, 42.8 / 106.0, 54.7 / 84.3 | 42.0 / 101.5, 48.6 / 121.5, 48.1 / 96.8 | 0 B: 16.4 / 42.0, 19.8 / 76.1, 24.1 / 61.4 |
| `logs` | 348,580 | 3.6 / 36.7, 5.2 / 31.3, 4.9 / 26.1 | 2.7 / 25.8, 3.6 / 17.8, 4.0 / 30.3 | 0 B: 1.9 / 2.6, 2.2 / 8.8, 2.4 / 19.1 |
| `market` | 390 | 0.64 / 3.7 | 0.51 / 1.0 | 0 B: 0.46 / 1.7 |

The v1.4.0 conditional reads (the same request with its ETag) answered 200 with
the full body: bank 60.6 / 103.5, 46.2 / 77.4, 50.0 / 101.4 ms.

Bank tab latency in the real dashboard (`bank tab shows marks, unmarks,
withdrawals, rules and bank changes as fast as before`), ms from the action to
the tile change, median of 3 (bank change: of 5, each landing at a different
point of the 2 s poll), two runs each:

| Action | v1.4.0 | Branch |
|---|---:|---:|
| Mark for withdrawal | 856, 903 | 923, 575 |
| Unmark withdrawal | 904, 975 | 856, 566 |
| Sell to NPC (banner "NPC sale") | 690, 671 | 743, 542 |
| Clear all marks | 1,098, 787 | 1,065, 685 |
| Auto sell to NPC rule (banner "Auto NPC", one sample) | 673, 679 | 671, 372 |
| Bank content change (new tile) | 753, 1,116 | 800, 1,192 |
| Bank polls answered 304 | 0 of 16, 0 of 15 | 9 of 15, 9 of 15 |

Bank change samples: v1.4.0 645-1,583 ms, branch 318-1,575 ms, the spread of
one 2 s poll in both.

While farming, `logs` changes almost every second (every kill adds a line), so
it answers 304 mostly between fights and when the party is idle. A cursor for
new log entries would cut it further; that changes the section's shape for
clients that opt in, so it waits for a later change.

### Duplicate game log lines (L1)

**Before.** caracAL's hook in `src/CharacterThread.js` wraps `add_log` and
prints every `game_logs` entry through pino to the container's stdout. The game
delivers each party event to every member's client, so with three headless
fighters each kill printed three times. Live, kill and gold lines were 89% of
17,397 lines/h (breakdown window A). Each character's `N gold` line is its own
share of the loot, not a copy of another character's line.

**Failure modes** (`scripts/tests/game-log-echo.test.cjs`,
`scripts/tests/coordinator-installer.test.cjs`):

1. every caracAL thread prints a party kill or find that a sibling thread also receives;
2. a thread stops printing a line about its own character;
3. two separate events with identical text lose a line, in stdout or in the console capture;
4. a kill or find by a party member outside this caracAL process (the Steam client) leaves stdout;
5. the console capture (`gameLogs`) changes in any byte;
6. a phrase lookup that no `add_log` follows silences the next unrelated line;
7. without a siblings list, or for lines without a phrase, anything stops printing.

**Change.** `installGameLogEcho` (`runtime/characters/game-log-echo.ts`)
replaces the hook. The game's `game_log` handler calls
`ui_log(phrase.message(data, true), data.color)`, so the installer wraps
`phrase.message` to read the event's own phrase arguments. A thread does not
print a `server.kill.player.*` or `server.item.named_found.*` event whose
`player` is one of its running caracAL siblings (`siblings_and_acc`) other than
itself. That sibling receives the same event and prints it; live logs show a
killer's own thread printing "Recharged killed a Tiny Crab" and a finder's
printing "Sadokunn found a Seashell". The choice comes from the event, never
from comparing message text, so two Goos killed at once by the same character
print twice. A kill by the Steam client keeps printing from every thread, as
before. Gold shares, other phrases and plain strings print as before.

Every event still reaches `add_log`, so the console's capture
(`installHostGameLogs`, `runtime/characters/game-logs.ts`) sees the same lines.
The unit test feeds one event stream through the upstream hook and through the
new one, with the capture installed on top as `runner-host.ts` does, and
compares the captured entries byte for byte. The metrics service counts kills
and finds from `gameLogs` and only from the killer's or finder's own log
(`party-console-metrics/src/parse.ts`, `kill` and `drop`), so its counts stay
the same.

**How the console carries it.** `tools/caracal/setup.mts` pins upstream
caracAL at revision `234af745` and applies
`patches/caracal-current-api.patch`. The patch is unchanged for L1:
`tools/caracal/upgrade-runner.mts` adds one guarded line in front of the
upstream hook at install time, like `installGameRendering`. An older lifecycle
bundle without the installer (a rolled-back console build) runs the upstream
hook.

Live log mix, 30 minutes read with `docker logs` (read-only) on 2026-10-19:

| Lines | 30 min |
|---|---:|
| All | 1,887 |
| `game_logs` | 1,254 (498 kills, 96 finds, 504 gold shares) |
| Kill and find lines a sibling prints instead | 396 (21% of all lines) |
| Account info pair (L2) | 598 (32%) |
| After L1 and L2 | about 893 (-53%) |

On the breakdown's busier window A (17,397 lines/h, 7,767 kill lines), L1
removes about 5,200 lines/h and L2 about 1,200, roughly 37%.

### Account info poll (L2)

**Before.** caracAL's `account_info.js` POSTs
`adventure.land/api/servers_and_characters` every 6 s and logged "updating
account info" and "found N servers and N characters" on each poll: 1,198 lines/h.

**Failure modes** (`scripts/tests/account-info-log.test.cjs`):

1. every poll logs the pair although nothing changed;
2. a change in the server or character count goes unlogged;
3. the poll leaves the first account read after start unlogged;
4. the poll interval, the response or the listeners change;
5. a failed poll stops logging its warning.

**Change.** The poll line logs at debug. The found line logs at info on the
first read and when its text changes, and at debug otherwise. Log level
`debug` shows every poll as before.

**Interval.** The poll stays at 6 s. Readers of `my_acc.response` in
`runtime/coordinator/application.ts`:

| Reader | Freshness need |
|---|---|
| `connectionCount` (realm switch, `connectionToSuspend` in `realm-switch.ts`) | reads the cached response without a refresh while it decides whether to suspend a slot |
| `accountCharacters`, `characterCount`, `rosterProjection` (`online`, `server`, `level` in the roster) | the dashboard and roster routes display and check them |
| `servers` (`publicOverview`, giveaway realms) | display |
| `subscribeAccount` listener | pushes `siblings_and_acc` to every character thread on each poll (the game's account data and the L1 siblings list) |
| `confirmOffline`, `confirmAccountHomes`, character creation, realm routes, mail | call `updateInfo()` themselves |

A slower poll would make the first four staler, and the realm switch reads its
count without asking, so the interval stays.

**How the console carries it.** The change is a hunk of
`patches/caracal-current-api.patch` (`account_info.js`), regenerated with
`git diff` from a clean clone at the pinned revision; the rest of the patch is
byte-identical. Docker builds and fresh installs apply it.
`tools/caracal/setup.mts` skips the patch on a checkout that already has the
previous version applied, so an existing local install keeps the old logging
until someone reinstalls it.

### Activation record poll (H2)

**Before.** The universal loader (`runtime/characters/universal-loader.ts`,
published as `characters/universal-loader.js`) asks for
`CODE/adventure_land/activation.json` every 2 s. Only a managed console build
deployment writes that record (`publishCode` in
`tools/console-build/hosting.ts`). The live console runs the production image
without `AL_CONSOLE_MANAGED`, so the coordinator serves `CODE` and has no
record: the Steam client got a 404 every 2 s (61 in 2 minutes measured live)
and returned early.

**Failure modes** (`scripts/tests/loader-activation-poll.test.cjs`,
`e2e/console-requests.spec.ts`):

1. the loader asks for `activation.json` every 2 s while the host has none;
2. the loader ignores an activation the host publishes later, or adopts it a tick late;
3. the loader stops asking a host that does not report its activation for the record;
4. the `console-deployment` poll, its maintenance hold, or the startup manifest load change.

**Change.** `/party-api/console-deployment`, which the loader already polls on
the same tick, names the host's activation record in `activation`, or `null`
when there is none. The managed host reads its deployed directory; the
coordinator reads its `CODE` directory. While the reply says `null`, the loader
skips `activation.json` after its first load. When a record appears, the
control reply that reports it starts a refresh at once, so the loader adopts
a new activation on the same tick as before. The loader asks a host that
leaves the field out (an older host) for the record on every tick, as before.
A loader older than the host ignores the field.

| Steam client, host without a record | Requests per minute |
|---|---:|
| v1.4.0 | 30 `console-deployment` + 30 `activation.json` (404) |
| Branch | 30 `console-deployment` |

The Steam client keeps the loader it started with until it reloads.

### Hidden-tab dashboard timers (H4)

Each plain `setInterval` in the breakdown, and what it does:

| Timer | Request | Role | Branch |
|---|---|---|---|
| `console-build-control.tsx`, 1 s | `GET /console-build` | Shows build and deployment state. After the tab's own deployment completes with a new dashboard, it reloads the page. | Unchanged. It already returns early while `document.hidden` and refreshes on `visibilitychange`, so the post-deploy reload waits until the tab is visible, as in v1.4.0. The deployment itself runs on the host. |
| `console-updates.tsx`, 3 s | `GET /console-update` | Shows update status in the header and in Settings. Download, restart and preference changes are click POSTs. | Paused while hidden; reads at once on return. |
| `debug-instance.tsx`, 1.5 s | `GET /console-debug` | Shows the debug instance. The host's `status()` (`tools/debug/service.ts`) also marks a running instance as failed when its container turns unhealthy, so the read drives a state change. | Unchanged. It runs only while Settings is open. |
| `upgrade-preview-panel.tsx`, 2 s | `POST /upgrade-preview` with `refresh: false` | Reads the stored preview (`createUpgradePreviews`, `request`); only the Refresh chances click queues one. | Paused while hidden; reads at once on return, still with `refresh: false`. |

No flow depends on a timer that now pauses. Browsers also throttle timers in
hidden tabs, so a flow that needed one would already be unreliable there.

**Failure modes** (`e2e/console-requests.spec.ts`, `display-only dashboard
timers pause while the tab is hidden and read at once on return`):

1. a display-only timer keeps requesting while the tab is hidden;
2. a tab that becomes visible shows a stale view until the next tick;
3. returning to the tab queues an upgrade preview;
4. a timer that drives a flow stops.

The test hides the tab (`document.hidden` and `visibilitychange`) for 7 s with
an upgrade preview open:

| Requests while hidden, 7 s | v1.4.0 | Branch |
|---|---:|---:|
| `/console-update` | 4 | 0 |
| `/upgrade-preview` | 4 | 0 |
| `/console-build` | 0 | 0 |
| First read after return, ms (update / preview) | 936-1,460 / 1,751-1,815 (next tick) | 46-119 / 50-127 |

### Dashboard first render and log capture

`first render and game log capture reach the dashboard as fast as before`
(`e2e/console-requests.spec.ts`), three runs per tree, interleaved. First
render is the median of three warm reloads until the merchant card shows (the
first load also compiles the dev dashboard). Log capture is the time from
`POST /party-api/game-logs` to the line in the Live logs sidebar, median of 6
lines placed across the 1 s logs poll.

| Run | v1.4.0 first render / logs open / capture (ms) | Branch |
|---|---|---|
| 1 | 2,311 / 111 / 627 | 2,764 / 320 / 630 |
| 2 | 4,482 / 131 / 635 | 2,553 / 349 / 630 |
| 3 | 2,715 / 301 / 609 | 2,630 / 223 / 638 |

Capture samples ranged 83-997 ms on v1.4.0 and 70-955 ms on the branch, one
logs poll in both.

### Tests

Run in `ah-e2e-runner` on the branch tip (`.caracal` reinstalled with the
branch's patch and installer), against the v1.4.0 baselines:

| Check | v1.4.0 | Branch |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm run lint:runtime` | 132 | 132 |
| Dashboard oxlint | 56 | 56 |
| Unit (`npm run test:unit`) | 2 failures (Caddy HTTPS, launcher restart) | 3,713 / 3,715; the same 2 failures |
| Console E2E | 78 | 83 / 84 (78 + 6 new) |

The one console E2E failure, `log character pills default to all and
independently filter live updates across tabs`, passed in the first full run
of the branch and failed in the second and in four isolated reruns while
another test stack held the runner at load 13-15. v1.4.0 failed it the same
way (the sidebar never opens) in two reruns in the same window. The test
opens the log sidebar 2 s after load, before a slow dev server has finished
its first reload.

New tests: `native-host-health`, `coordinator-public-state` (400),
`coordinator-section-revision`, `dashboard-section-revision`,
`game-log-echo`, `coordinator-installer` (echo transform),
`account-info-log`, `loader-activation-poll`, and six console E2E tests in
`e2e/console-requests.spec.ts`.
