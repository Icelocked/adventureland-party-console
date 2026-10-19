// Collects the stand trades a character sees ("+$$") and its own new trade-history entries for
// ALNinja's POST /api/v1/observations. The coordinator holds the instance URL and token and
// forwards each report; this side only buffers, batches and retries.
type Values = Record<string, unknown>;
type HistoryEntry = [string, string, Values, number];
interface Realm { region: string | null; server: string | null }
interface Ports {
  now(): number;
  name(): string;
  realm(): Realm;
  map(): string | null;
  inView(): string[];
  requestHistory(): void;
  send(report: Values): Promise<{ accepted?: boolean } | null | undefined>;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
  /** The character's saved reporter state, kept across code reloads and realm hops. */
  load(): unknown;
  save(state: Saved | null): void;
}
/** Where a trade was seen: its report names this realm and map, whichever the character is on later. */
interface Origin extends Realm { map: string | null }
interface Pending { origin: Origin; entry: Values }
interface Saved { savedAt: number; sales: Pending[]; history: Pending[]; last: HistoryEntry[] | null }

const tradeDelayMs = 2_000;
const coverageMs = 60_000;
const retryMs = 10_000;
const salesPerReport = 500;
const historyPerReport = 100;
// A saved trade-history read older than this is not diffed against: trades made since would be
// reported as happening now.
const lastReadLifetimeMs = 600_000;

const sameTrade = (a: HistoryEntry, b: HistoryEntry) =>
  a[0] === b[0] && a[1] === b[1] && a[2]?.name === b[2]?.name && a[2]?.level === b[2]?.level;
const units = (entry: HistoryEntry) => Number(entry[2]?.q) || 1;
const originKey = (origin: Origin) => `${origin.region}\u0000${origin.server}\u0000${origin.map}`;

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

function savedState(value: unknown, now: number): Saved | null {
  const saved = value as Partial<Saved> | null | undefined;
  if (!saved || typeof saved !== "object" || !Number.isFinite(saved.savedAt)) return null;
  const pending = (list: unknown) => Array.isArray(list) ? list.filter((p: Pending) => p && p.origin && p.entry) : [];
  return { savedAt: Number(saved.savedAt), sales: pending(saved.sales), history: pending(saved.history),
    last: Array.isArray(saved.last) && now - Number(saved.savedAt) <= lastReadLifetimeMs ? saved.last : null };
}

export function createAlninjaReporter(ports: Ports) {
  let sales: Pending[] = [], history: Pending[] = [], last: HistoryEntry[] | null = null;
  let enabled = false, busy = false, again = false, timer: unknown = null, restored = false, stopped = false;

  const origin = (): Origin => ({ ...ports.realm(), map: ports.map() });
  /** Unsent trades (including a report still in flight) and the last history read: a trade seen
   * just before a reload or realm hop is reported after the code starts again. */
  function persist() {
    if (!stopped) ports.save({ savedAt: ports.now(), sales, history, last });
  }
  function schedule(milliseconds: number) {
    if (timer !== null) ports.clearTimer(timer);
    timer = enabled ? ports.setTimer(() => { timer = null; void flush(); }, milliseconds) : null;
  }
  function observeUi(event: Values | null | undefined) {
    if (!enabled || event?.type !== "+$$" || !event.item) return;
    sales.push({ origin: origin(), entry: { at: ports.now(), seller: event.seller, buyer: event.buyer, slot: event.slot,
      filledBuyOrder: event.snum !== undefined, item: event.item } });
    persist();
    if (sales.length === 1 && !history.length) schedule(tradeDelayMs);
  }
  function observeHistory(list: unknown) {
    if (!enabled || !Array.isArray(list)) return;
    const previous = last;
    last = list as HistoryEntry[];
    if (previous) { // the first read without a recent saved one is the starting point, not new trades
      const added = newTrades(previous, last), where = origin();
      for (const [event, counterparty, item, total] of added)
        history.push({ origin: where, entry: { at: ports.now(), event, counterparty, item, total } });
      if (added.length) schedule(tradeDelayMs);
    }
    persist();
  }
  /** One report per realm and map the pending trades were seen on. Only the current one lists the
   * stands in view; another realm's report claims none. */
  async function report(where: Origin, salesBatch: Pending[], historyBatch: Pending[], current: boolean) {
    try {
      const result = await ports.send({ reporter: ports.name(), sentAt: ports.now(), region: where.region, server: where.server,
        map: where.map, inView: current ? ports.inView().slice(0, 500) : [],
        sales: salesBatch.map(p => p.entry), history: historyBatch.map(p => p.entry) });
      if (result?.accepted !== true) return false;
    } catch {
      return false;
    }
    sales = sales.filter(p => !salesBatch.includes(p));
    history = history.filter(p => !historyBatch.includes(p));
    persist();
    return true;
  }
  async function flush() {
    if (!enabled) return;
    if (busy) { again = true; return; }
    busy = true;
    ports.requestHistory(); // the answer arrives via observeHistory, sent with a later report
    const here = origin(), groups = new Map<string, Origin>([[originKey(here), here]]);
    for (const p of [...sales, ...history]) if (!groups.has(originKey(p.origin))) groups.set(originKey(p.origin), p.origin);
    let failed = false;
    try {
      for (const [key, where] of groups) {
        const of = (list: Pending[], limit: number) => list.filter(p => originKey(p.origin) === key).slice(0, limit);
        const salesBatch = of(sales, salesPerReport), historyBatch = of(history, historyPerReport), current = key === originKey(here);
        if (!current && !salesBatch.length && !historyBatch.length) continue;
        if (!await report(where, salesBatch, historyBatch, current)) { failed = true; break; }
      }
    } finally {
      busy = false;
    }
    const rerun = again;
    again = false;
    schedule(failed ? retryMs : rerun ? 0 : sales.length || history.length ? tradeDelayMs : coverageMs);
  }
  /** Follows the coordinator's switch; turning off drops anything unsent. */
  function configure(on: boolean) {
    if (stopped || on === enabled) return;
    enabled = on;
    if (on && !restored) {
      restored = true;
      const saved = savedState(ports.load(), ports.now());
      if (saved) { sales = saved.sales.concat(sales); history = saved.history.concat(history); last = saved.last; }
    }
    if (!on) { sales = []; history = []; last = null; ports.save(null); }
    schedule(0);
  }
  /** A code reload replacing this reporter: keeps the saved state for the next one. */
  function stop() {
    stopped = true; // a report still in flight must not overwrite its successor's saved state
    enabled = false;
    schedule(0);
  }
  return { observeUi, observeHistory, configure, stop, flush };
}

Object.assign(globalThis, { createPartyAlninjaReporter: createAlninjaReporter });
