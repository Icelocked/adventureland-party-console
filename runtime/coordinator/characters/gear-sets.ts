import { requestObject, requestText, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/** Named equipment sets per character: `luck` for the tank's kill-time swap, `tank` to restore after it. */
export const GEAR_SET_NAMES = ["luck", "tank", "gold"] as const;
export type GearSetName = (typeof GEAR_SET_NAMES)[number];
/** Every equipment slot (the game's character_slots). The elixir is recorded but never swapped. */
export const GEAR_SET_SLOTS = [
  "mainhand", "offhand", "chest", "pants", "helmet", "gloves", "shoes", "cape", "belt", "orb", "amulet",
  "ring1", "ring2", "earring1", "earring2", "elixir",
] as const;
export type GearSetItem = { name: string; level?: number; p?: string; stat_type?: string };
export interface GearSet { slots: Partial<Record<(typeof GEAR_SET_SLOTS)[number], GearSetItem>>; savedAt: number }
export type GearSets = Record<string, Partial<Record<GearSetName, GearSet>> | undefined>;

interface GearSetState {
  gearSets: GearSets;
  statuses: Record<string, { seenAt?: number; slots?: Record<string, { item?: Record<string, unknown> } | undefined> } | undefined>;
}
interface GearSetPorts {
  now(): number;
  owned(name: string): unknown;
  persist(): void;
}

/** The identity a set member is matched by; lock state and quantity may change without it becoming another item. */
export function gearSetItem(value: unknown): GearSetItem | null {
  const item = requestObject(value);
  // An empty slot reports an item without a name; String() would save it as "undefined".
  const name = typeof item.name === "string" ? item.name : "";
  if (!name) return null;
  const member: GearSetItem = { name };
  if (Number.isFinite(Number(item.level)) && item.level !== undefined) member.level = Number(item.level);
  if (typeof item.p === "string") member.p = item.p;
  if (typeof item.stat_type === "string") member.stat_type = item.stat_type;
  return member;
}

export function createGearSetRoute(state: GearSetState, ports: GearSetPorts) {
  return function gearSets(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character), set = requestText(body.set);
    if (!ports.owned(name)) return res.status(400).json({ error: "invalid character" });
    if (!(GEAR_SET_NAMES as readonly string[]).includes(set)) return res.status(400).json({ error: "invalid gear set" });
    const sets = (state.gearSets[name] ||= {});
    if (body.action === "clear") {
      delete sets[set as GearSetName];
    } else if (body.action === "save") {
      const status = state.statuses[name];
      if (!status?.slots || !(Number(status.seenAt) >= ports.now() - 10000))
        return res.status(409).json({ error: "no fresh equipment report for " + name });
      const slots: GearSet["slots"] = {};
      for (const slot of GEAR_SET_SLOTS) {
        const member = gearSetItem(status.slots[slot]?.item);
        if (member) slots[slot] = member;
      }
      if (!Object.keys(slots).length) return res.status(409).json({ error: "nothing is equipped in the gear set slots" });
      sets[set as GearSetName] = { slots, savedAt: ports.now() };
    } else return res.status(400).json({ error: "invalid gear set action" });
    ports.persist();
    return res.json({ ok: true, gearSets: state.gearSets[name] });
  };
}
