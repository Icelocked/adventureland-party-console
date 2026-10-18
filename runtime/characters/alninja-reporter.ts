// Collects the stand trades a character sees ("+$$") and its own new trade-history entries for
// ALNinja's POST /api/v1/observations. The coordinator holds the instance URL and token and
// forwards each report; this side only buffers, batches and retries.
type Values = Record<string, unknown>;
type HistoryEntry = [string, string, Values, number];
interface Ports {
  now(): number;
  name(): string;
  realm(): { region: string | null; server: string | null };
  map(): string | null;
  inView(): string[];
  requestHistory(): void;
  send(report: Values): Promise<{ accepted?: boolean } | null | undefined>;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
}

const tradeDelayMs = 2_000;
const coverageMs = 60_000;
const retryMs = 10_000;
const salesPerReport = 500;
const historyPerReport = 100;

const sameTrade = (a: HistoryEntry, b: HistoryEntry) =>
  a[0] === b[0] && a[1] === b[1] && a[2]?.name === b[2]?.name && a[2]?.level === b[2]?.level;
const units = (entry: HistoryEntry) => Number(entry[2]?.q) || 1;

/** Entries added to the game's trade history since `previous`. The game merges a repeat of the
 * last trade into it, so a grown last entry counts only its extra units. */
export function newTrades(previous: HistoryEntry[], next: HistoryEntry[]): HistoryEntry[] {
  for (let start = 0; start <= previous.length; start++) {
    const kept = previous.slice(start), last = kept.length - 1;
    if (next.length < kept.length) continue;
    const aligned = kept.every((entry, index) => sameTrade(entry, next[index]) &&
      (index === last || (units(entry) === units(next[index]) && entry[3] === next[index][3])));
    if (!aligned) continue;
    const added: HistoryEntry[] = [];
    const grown = kept.length ? units(next[last]) - units(kept[last]) : 0;
    if (grown > 0) added.push([next[last][0], next[last][1], { ...next[last][2], q: grown }, next[last][3] - kept[last][3]]);
    return added.concat(next.slice(kept.length));
  }
  return next;
}

export function createAlninjaReporter(ports: Ports) {
  let sales: Values[] = [], history: Values[] = [], last: HistoryEntry[] | null = null;
  let enabled = false, busy = false, again = false, timer: unknown = null;

  function schedule(milliseconds: number) {
    if (timer !== null) ports.clearTimer(timer);
    timer = enabled ? ports.setTimer(() => { timer = null; void flush(); }, milliseconds) : null;
  }
  function observeUi(event: Values | null | undefined) {
    if (!enabled || event?.type !== "+$$" || !event.item) return;
    sales.push({ at: ports.now(), seller: event.seller, buyer: event.buyer, slot: event.slot,
      filledBuyOrder: event.snum !== undefined, item: event.item });
    if (sales.length === 1 && !history.length) schedule(tradeDelayMs);
  }
  function observeHistory(list: unknown) {
    if (!enabled || !Array.isArray(list)) return;
    const previous = last;
    last = list as HistoryEntry[];
    if (!previous) return; // the first read is the starting point, not new trades
    const added = newTrades(previous, last);
    for (const [event, counterparty, item, total] of added)
      history.push({ at: ports.now(), event, counterparty, item, total });
    if (added.length) schedule(tradeDelayMs);
  }
  async function flush() {
    if (!enabled) return;
    if (busy) { again = true; return; }
    busy = true;
    ports.requestHistory(); // the answer arrives via observeHistory, sent with a later report
    const batch = { sales: sales.splice(0, salesPerReport), history: history.splice(0, historyPerReport) };
    let failed = false;
    try {
      const result = await ports.send({ reporter: ports.name(), sentAt: ports.now(), ...ports.realm(),
        map: ports.map(), inView: ports.inView().slice(0, 500), ...batch });
      failed = result?.accepted !== true;
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
    if (failed) {
      sales = batch.sales.concat(sales); // kept for the next report
      history = batch.history.concat(history);
    }
    const rerun = again;
    again = false;
    schedule(failed ? retryMs : rerun ? 0 : sales.length || history.length ? tradeDelayMs : coverageMs);
  }
  /** Follows the coordinator's switch; turning off drops anything unsent. */
  function configure(on: boolean) {
    if (on === enabled) return;
    enabled = on;
    if (!on) { sales = []; history = []; last = null; }
    schedule(0);
  }
  function stop() { configure(false); }
  return { observeUi, observeHistory, configure, stop, flush };
}

Object.assign(globalThis, { createPartyAlninjaReporter: createAlninjaReporter });
