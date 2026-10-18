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
