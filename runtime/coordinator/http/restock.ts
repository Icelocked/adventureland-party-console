import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface Supply {
  item: string;
  min: number;
  max: number;
}
export interface RestockPolicy {
  hp: Supply;
  mp: Supply;
  /** Elixirs the merchant keeps `min`..`max` spares of: bought from an NPC, or withdrawn from the bank. */
  elixirs: Supply[];
  /** The elixir the character keeps active unless its worn gear set names another; null keeps none. */
  keepElixir: string | null;
}
function nonnegative(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function supply(value: unknown, item: string, min: number, max: number): Supply {
  // Preserve null/false/zero coercion in existing saved-policy requests.
  const object = requestObject(value);
  return {
    item,
    min: nonnegative(Number(value && object.min), min),
    max: nonnegative(Number(value && object.max), max),
  };
}
/** An item name, never the text "undefined" that policies saved before 10-19 could hold. */
function itemName(value: unknown): string | null {
  return typeof value === "string" && value && value !== "undefined" ? value : null;
}
/**
 * The policy in its current shape. A policy saved before per-character elixirs had one `elixir`
 * supply, kept active while its max was above zero; that becomes the one supply and the default.
 */
export function normalizeRestockPolicy(value: unknown): RestockPolicy {
  const body = requestObject(value);
  const elixirs: Supply[] = [];
  let keepElixir: string | null = null;
  if (Array.isArray(body.elixirs)) {
    for (const entry of body.elixirs) {
      const item = itemName(requestObject(entry).item);
      if (item && !elixirs.some(e => e.item === item)) elixirs.push(supply(entry, item, 0, 0));
    }
    keepElixir = itemName(body.keepElixir);
  } else if (body.elixir) {
    const legacy = supply(body.elixir, itemName(requestObject(body.elixir).item) || "elixirluck", 0, 0);
    if (legacy.max > 0) { elixirs.push(legacy); keepElixir = legacy.item; }
  }
  return { hp: supply(body.hp, "hpot1", 5, 20), mp: supply(body.mp, "mpot1", 0, 0), elixirs, keepElixir };
}
export function createRestockRoute(
  state: { restockPolicies: Record<string, RestockPolicy> },
  ports: { owned(name: unknown): unknown; persist(): void },
) {
  return function restock(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = body.character;
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const policy = normalizeRestockPolicy(body);
    if ([policy.hp, policy.mp, ...policy.elixirs].some(rule => rule.min > rule.max))
      return res.status(400).json({ error: "minimum cannot exceed maximum" });
    state.restockPolicies[requestText(name)] = policy;
    ports.persist();
    return res.json({ ok: true, policy });
  };
}
