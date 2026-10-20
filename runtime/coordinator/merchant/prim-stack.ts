import { randomUUID } from 'node:crypto';
import { requestObject, requestText, type HttpRequest, type HttpResponse, type HttpRouter } from '../http/contracts.ts';
import { isPrimStackMethod, primStackOffering, statScrollName, statScrollsPerStack, validPrimStackTarget, type PrimStackMethod, type PrimStackRequest } from '../../prim-stack.ts';
import { protectedMerchantStorageStock } from '../inventory/merchant-storage-stock.ts';
import type { InventoryEntry, Item } from '../contracts/item.ts';
import { entryMeta, type ItemMetaRecord } from '../inventory/catalog-meta.ts';
import type { MerchantWork } from './work.ts';

// Reports carry per-copy meta only; liveEntry joins the per-type definition from merchantCatalog.
interface Entry extends InventoryEntry { meta?: ItemMetaRecord | null }
interface State {
  merchantCharacter?: string | null;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  merchantCatalog?: unknown;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface Ports { persist(): void; dispatch(): void; stamp(job: MerchantWork): MerchantWork }
type Outcome = { status: number; error: string } | { request: PrimStackRequest };

/** Prim-stack jobs act on one merchant inventory item; supplies come from its inventory and bank. */
export function createPrimStacks(state: State, ports: Ports, now = Date.now) {
  function supply(name: string): number {
    return protectedMerchantStorageStock(state).filter(entry => !entry.craftLocation.startsWith('bankboi:') &&
      entry.item?.name === name && !entry.item.l).reduce((total, entry) => total + (Number(entry.item?.q) || 1), 0);
  }
  function requestError(body: Record<string, unknown>, executor: string): Outcome | null {
    if (!validPrimStackTarget(body.target)) return { status: 400, error: 'Choose a target grace from 0.5 to 15' };
    if (!isPrimStackMethod(body.method)) return { status: 400, error: 'Unknown prim-stack method' };
    if (!executor || requestText(body.character) !== executor || !Number.isSafeInteger(body.slot))
      return { status: 400, error: 'Item must be in merchant inventory' };
    return null;
  }
  function liveEntry(body: Record<string, unknown>, executor: string): Entry | null {
    const item = requestObject(body.item) as Item;
    const entry = state.statuses[executor]?.items?.find(value => value?.slot === body.slot);
    const live = entry?.item;
    return live && typeof item.name === 'string' &&
      Object.entries(item).every(([key, value]) => JSON.stringify(live[key]) === JSON.stringify(value))
      ? { ...entry, meta: entryMeta(state.merchantCatalog, entry) } : null;
  }
  /** A stat scroll rewrites stat_type, so only the item's current stat may be used. */
  function statRequest(request: PrimStackRequest, entry: Entry): Outcome {
    const live = request.item, definition = entry.meta?.definition;
    if (!Number(definition?.stat) || typeof live.stat_type !== 'string')
      return { status: 400, error: 'The stat-scroll method needs an item with an applied stat' };
    const scroll = statScrollName(live.stat_type), scrolls = statScrollsPerStack(Number(live.level) || 0, definition?.grades);
    if (!['strscroll', 'intscroll', 'dexscroll', 'vitscroll'].includes(scroll) && supply(scroll) < scrolls)
      return { status: 409, error: `Need ${scrolls} × ${scroll} in merchant inventory or bank` };
    return { request: { ...request, scroll, scrolls } };
  }
  function validate(body: Record<string, unknown>): Outcome {
    const executor = state.merchantCharacter || '';
    const invalid = requestError(body, executor);
    if (invalid) return invalid;
    const entry = liveEntry(body, executor);
    if (!entry?.item) return { status: 409, error: 'Item changed; reopen the menu' };
    if (!entry.meta?.upgradeable) return { status: 400, error: 'Only upgradeable items can be prim stacked' };
    if (!supply(primStackOffering)) return { status: 409, error: 'No Primling in merchant inventory or bank' };
    const request: PrimStackRequest = { slot: Number(body.slot), item: entry.item, target: Number(body.target), method: body.method as PrimStackMethod };
    return request.method === 'offering' ? { request } : statRequest(request, entry);
  }
  function queue(req: HttpRequest, res: HttpResponse) {
    const outcome = validate(requestObject(req.body));
    if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
    const executor = state.merchantCharacter!;
    const existing = [state.merchantCurrent, ...state.merchantQueue].find(job => job?.reason === 'prim stack' &&
      requestObject(job.primStack).slot === outcome.request.slot);
    if (existing) return res.status(409).json({ error: 'A prim stack for this item is already queued' });
    const job = ports.stamp({ id: 'prim-' + randomUUID(), target: executor, reason: 'prim stack', manual: true,
      queuedAt: now(), primStack: outcome.request });
    state.merchantQueue.push(job); ports.persist(); ports.dispatch();
    return res.json({ ok: true, jobId: job.id });
  }
  return { install(router: HttpRouter) { router.post('/party-api/prim-stack', queue); } };
}
