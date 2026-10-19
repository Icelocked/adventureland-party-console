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
