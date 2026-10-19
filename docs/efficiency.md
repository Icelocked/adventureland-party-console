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
