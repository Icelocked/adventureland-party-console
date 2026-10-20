import { type SharedScope } from "../inventory/shared-rules.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { Item } from "../contracts/item.ts";
import { npcSaleRuleKey, releasePlayerSale, type NpcSaleRule } from "../merchant/player-npc-sales.ts";
import type { ItemMark } from "../contracts/item.ts";

interface AutomaticSaleMark {
  id?: string;
  character?: string;
  auto?: boolean;
  autoRuleKey?: string;
}
interface AutomaticSaleState extends SharedScope {
  autoNpcSales: Record<string, NpcSaleRule>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  statuses?: Record<string, unknown>;
  autoStandMarks: Record<string, { item: Item; price: number; createdAt: number }>;
  npcSaleMarks: AutomaticSaleMark[];
  standListings: AutomaticSaleMark[];
  withdrawals?: Record<string, { standListingId?: string }[] | undefined>;
}
interface AutomaticSalePorts {
  selectAction?(item: Item, name: string, action: 'npc' | 'stand'): void;
  now(): number;
  key(item: Item): string;
  reconcile(): void;
  persist(): void;
  publish(): void;
  syncStand(): boolean;
  idle(): void;
}

export function createAutomaticSaleRoutes(state: AutomaticSaleState, ports: AutomaticSalePorts) {
  function discardStand(predicate: (mark: AutomaticSaleMark) => boolean): void {
    const removed = new Set(state.standListings.filter(predicate).map(mark => mark.id));
    state.standListings = state.standListings.filter(mark => !predicate(mark));
    for (const [name, entries] of Object.entries(state.withdrawals || {}))
      state.withdrawals![name] = entries?.filter(entry => !entry.standListingId || !removed.has(entry.standListingId));
  }
  function discardNpc(predicate: (mark: AutomaticSaleMark) => boolean) {
    state.npcSaleMarks = state.npcSaleMarks.filter(mark => {
      if (!predicate(mark)) return true;
      if (mark.id) releasePlayerSale(state, mark as import("../merchant/npc-sales.ts").NpcSale);
      return false;
    });
  }
  function updateNpc(item: Item, action: string, character?: string, keep?: number): void {
    const key = character ? npcSaleRuleKey(item, character) : ports.key(item);
    if (action === "remove") {
      delete state.autoNpcSales[key];
      discardNpc(mark => mark.autoRuleKey === key);
    } else {
      ports.selectAction?.(item, character || String(state.merchantCharacter), 'npc');
      state.autoNpcSales[key] = { item, createdAt: ports.now(), ...(character ? { character } : {}), ...(keep !== undefined ? { keep } : {}) };
      if (character || state.merchantRules) return;
      delete state.autoStandMarks[key];
      discardStand(listing => !!listing.auto && listing.autoRuleKey === key);
    }
  }
  function save(syncStand = false): void {
    ports.reconcile();
    ports.persist();
    ports.publish();
    if (syncStand) ports.syncStand();
  }
  function clearNpc(character?: string): void {
    const keys = new Set(Object.keys(state.autoNpcSales).filter(key => state.autoNpcSales[key].character === character));
    for (const key of keys) delete state.autoNpcSales[key];
    discardNpc(mark => !!mark.auto && keys.has(mark.autoRuleKey!));
  }
  /** #116: a merchant-wide rule may keep some copies; blank sells every copy. Null is invalid. */
  function requestedKeep(value: unknown, character?: string): number | undefined | null {
    if (value === undefined || value === null || value === "") return undefined;
    const keep = Number(value);
    return character || !Number.isSafeInteger(keep) || keep < 0 ? null : keep;
  }
  function npcRuleError(item: Record<string, unknown>, keep: unknown, character?: string): string | null {
    if (typeof item.name !== "string") return "invalid automatic NPC sale item";
    return requestedKeep(keep, character) === null ? "enter a whole number of copies to keep, or leave it blank" : null;
  }
  function npc(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      item = requestObject(body.item),
      action = requestText(body.action || "set");
    const character = state.merchantRules ? undefined : typeof body.character === "string" ? body.character : undefined;
    if (character && !state.statuses?.[character]) return res.status(400).json({ error: "Unknown character" });
    if (action === "clear-all") clearNpc(character);
    else {
      const error = npcRuleError(item, body.keep, character);
      if (error) return res.status(400).json({ error });
      updateNpc(item, action, character, requestedKeep(body.keep, character)!);
    }
    save(!character);
    return res.json({ ok: true, autoNpcSales: state.autoNpcSales });
  }
  function updateStand(item: Item, action: string, price: number): string | null {
    const key = ports.key(item);
    if (action === "remove") {
      delete state.autoStandMarks[key];
      discardStand(listing => listing.autoRuleKey === key);
    } else {
      if (!Number.isSafeInteger(price) || price < 1) return "enter a valid fixed stand price";
      ports.selectAction?.(item, String(state.merchantCharacter), 'stand');
      state.autoStandMarks[key] = { item, price, createdAt: ports.now() };
      if (state.merchantRules) return null;
      delete state.autoNpcSales[key];
      state.npcSaleMarks = state.npcSaleMarks.filter((mark) => mark.autoRuleKey !== key);
    }
    return null;
  }
  function stand(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      item = requestObject(body.item),
      action = requestText(body.action || "set");
    if (action === "clear-all") {
      state.autoStandMarks = {};
      discardStand(listing => !!listing.auto);
    } else {
      if (typeof item.name !== "string")
        return res.status(400).json({ error: "invalid automatic stand item" });
      const error = updateStand(item, action, Number(body.price));
      if (error) return res.status(400).json({ error });
    }
    save();
    if (!ports.syncStand()) ports.idle();
    return res.json({
      ok: true,
      autoStandMarks: state.autoStandMarks,
      standListings: state.standListings,
    });
  }
  return { npc, stand };
}
