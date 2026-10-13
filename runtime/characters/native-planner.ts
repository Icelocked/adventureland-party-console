import type { Point, Step } from '../navigation/contracts.ts';
import type { MovementHost, NativeFunctions } from './movement-host.ts';
interface SliceMetrics { version?: number; mode: '40ms' | 'native'; reason?: string; hidden?: boolean; calls: number; totalMs: number; maxMs: number; intervalTotal: number; intervalMin: number; intervalMax: number }
/** Only this adapter touches the game's planner globals. It never runs the native walker. */
export function createNativePlanner(host: MovementHost, native: NativeFunctions) {
  let running = false, failure = '', deadline = 0, serial = 0, limit = 30000;
  let hardDeadline = 0, hardLimit = 30000, lastIndex: number | undefined, advancedAt = 0, progressValid = false;
  let searchQueue: unknown[] | undefined;
  let metrics: SliceMetrics | undefined, lastSliceStart: number | undefined;
  function cancel() { running = false; serial++; void Promise.resolve(native.stop('smart')).catch(() => {}); }
  function begin(destination: Point, town: boolean, now: number, timeout = 30000, progressLimit?: number) {
    cancel(); metrics = undefined; lastSliceStart = undefined; failure = ''; limit = timeout; deadline = now + timeout;
    hardLimit = progressLimit ?? timeout; hardDeadline = now + hardLimit; lastIndex = undefined; searchQueue = undefined; advancedAt = now; progressValid = progressLimit !== undefined;
    const token = serial;
    const promise = native.move(destination);
    void promise.catch(error => { if (running && token === serial) failure = String(error?.reason || error); });
    host.smart.use_town = town; running = true;
  }
  function validFrontier(index: number | undefined, queue: unknown): queue is unknown[] {
    return Number.isSafeInteger(index) && index! >= 0 && Array.isArray(queue) && index! <= queue.length &&
      (searchQueue === undefined || searchQueue === queue) && (lastIndex === undefined || index! >= lastIndex);
  }
  function observeProgress(now: number) {
    if (!progressValid) return;
    const index = host.start, queue = host.queue;
    if (!validFrontier(index, queue)) { progressValid = false; return; }
    searchQueue = queue;
    if (lastIndex !== undefined && index! > lastIndex) advancedAt = now;
    lastIndex = index;
  }
  function expired(now: number) {
    return now >= hardDeadline || now >= deadline && (!progressValid || now - advancedAt > 15000);
  }
  function checkDeadline(now: number) {
    if (!failure && !expired(now)) return;
    const reason = failure || `Native planning timed out (${(now >= hardDeadline ? hardLimit : limit) / 1000} seconds)`; cancel(); throw Error(reason);
  }
  function search() {
    if (!host.smart.searching) native.start(); else if (!host.smart.found) native.next();
  }
  function sliceProfile() {
    const parent = host.parent, version = Number(parent?.__partyClientVersion || host.G?.version);
    if (![15555,17665].includes(version)) return {version, reason:'unverified-version'};
    const descriptor = Object.getOwnPropertyDescriptor(parent, 'is_hidden');
    // A scoped parent getter returns a CODE-owned wrapper; restoring it would poison native draw/watchdog calls.
    const visibility = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (!descriptor) return {version, reason:'hook-unavailable'};
    if (!descriptor || !('value' in descriptor) || !descriptor.writable) return {version, reason:'hook-not-writable'};
    if (typeof visibility !== 'function') return {version, reason:'hook-unavailable'};
    return {version, visibility: visibility as () => boolean};
  }
  function recordSlice(started: number, profile: ReturnType<typeof sliceProfile>) {
    let hidden: boolean | undefined;
    try { hidden = profile.visibility?.(); } catch { /* Diagnostics cannot alter native dispatch. */ }
    metrics ??= {version:Number.isFinite(profile.version)?profile.version:undefined,
      mode:profile.visibility?'40ms':'native',reason:profile.reason,hidden,
      calls:0,totalMs:0,maxMs:0,intervalTotal:0,intervalMin:Infinity,intervalMax:0};
    if (lastSliceStart !== undefined) {
      const interval = Math.max(0, started-lastSliceStart);
      metrics.intervalTotal += interval; metrics.intervalMin = Math.min(metrics.intervalMin,interval);
      metrics.intervalMax = Math.max(metrics.intervalMax,interval);
    }
    lastSliceStart = started; metrics.calls++;
  }
  function searchSlice() {
    const profile = sliceProfile(), started = performance.now();
    recordSlice(started,profile);
    if (profile.visibility) host.parent.is_hidden = () => false;
    try { search(); }
    finally {
      if (profile.visibility) host.parent.is_hidden = profile.visibility;
      const elapsed = Math.max(0,performance.now()-started);
      metrics!.totalMs += elapsed; metrics!.maxMs = Math.max(metrics!.maxMs,elapsed);
    }
  }
  function report() {
    if (!metrics) return;
    const {intervalTotal,intervalMin,intervalMax,...sample}=metrics;
    return {...sample,intervals:{minMs:sample.calls>1?intervalMin:0,maxMs:intervalMax,
      meanMs:sample.calls>1?intervalTotal/(sample.calls-1):0}};
  }
  function tick(now: number): Step[] | undefined {
    if (!running) throw Error('Native search not initialized');
    if (lastIndex !== undefined) observeProgress(now);
    checkDeadline(now);
    searchSlice();
    observeProgress(now);
    if (!host.smart.moving && !host.smart.found) throw Error('Native planner found no route');
    if (!host.smart.found) return;
    const plot = host.smart.plot.map(p => ({ ...p }));
    cancel(); return plot;
  }
  return { begin, tick, cancel, report };
}
