import type { KeyValueStorage } from "./json-store.ts";
import {
  stateKeys,
  rosterFields,
  bankFields,
  selectionFields,
  selectSnapshot,
  settingsSnapshot,
  historySnapshot,
  authSnapshot,
} from "./snapshots.ts";

type PersistedCoordinator = Parameters<typeof settingsSnapshot>[0] &
  Record<
    (typeof rosterFields)[number] | (typeof bankFields)[number] | (typeof selectionFields)[number],
    unknown
  > & {
    merchantActivity: unknown[];
    combatLogs: Record<string, unknown[]>;
    aldata: Parameters<typeof settingsSnapshot>[0]["aldata"] & Parameters<typeof authSnapshot>[0];
  };

/**
 * History lines arrive 3-5 times a second. The saved history trails memory by
 * at most this long; docs/efficiency.md (Persistence) states the crash window.
 */
export const HISTORY_SAVE_MS = 5000;

/** Use explicit snapshots so process handles and credentials stay in their intended documents. */
export function createCoordinatorPersistence(
  state: PersistedCoordinator,
  storage: KeyValueStorage,
) {
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let historyDirty = false;
  function write(key: string, value: unknown): void {
    storage.set(key, structuredClone(value));
  }
  function roster(): void {
    write(stateKeys.roster, selectSnapshot(state, rosterFields));
  }
  function bank(): void {
    write(stateKeys.bank, selectSnapshot(state, bankFields));
  }
  function settings(): void {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    write(stateKeys.settings, settingsSnapshot(state));
  }
  function historyNow(): void {
    clearTimeout(historyTimer);
    historyTimer = undefined;
    historyDirty = true;
    write(stateKeys.history, historySnapshot(state.merchantActivity, state.combatLogs));
    historyDirty = false;
  }
  function savePendingHistory(): void {
    historyTimer = undefined;
    // The timer has no request to fail. The document stays dirty, so the next
    // line or the shutdown flush retries it.
    try { historyNow(); } catch (error) { console.error("Coordinator history save failed", error); }
  }
  function history(): void {
    historyDirty = true;
    if (historyTimer) return;
    historyTimer = setTimeout(savePendingHistory, HISTORY_SAVE_MS);
    historyTimer.unref();
  }
  function aldata(): void {
    write(stateKeys.aldata, authSnapshot(state.aldata));
  }
  function scheduleSettings(): void {
    if (settingsTimer) return;
    settingsTimer = setTimeout(settings, 1000);
    settingsTimer.unref();
  }
  function flush(): void {
    try {
      if (settingsTimer) settings();
    } finally {
      if (historyDirty) historyNow();
    }
  }
  return { roster, bank, settings, scheduleSettings, flush, history, historyNow, aldata };
}
