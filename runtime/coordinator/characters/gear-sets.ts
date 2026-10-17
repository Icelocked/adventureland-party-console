import { requestObject, requestText, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Named equipment sets per character: `luck` for the tank's kill-time swap, `tank` to restore after
 * it, `fan` worn while a rogue scatter-farms mobs Fan of Knives one-shots.
 */
export const GEAR_SET_NAMES = ["luck", "tank", "gold", "fan"] as const;
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
  commands: Record<string, unknown>;
  statuses: Record<string, { seenAt?: number; slots?: Record<string, { item?: Record<string, unknown> } | undefined> } | undefined>;
}
interface GearSetPorts {
  now(): number;
  owned(name: string): unknown;
  persist(): void;
  nextCommand(): number;
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
  // Wears the saved set from the bag; the character pauses its automatic swaps first.
  function equip(res: HttpResponse, name: string, set: GearSetName): unknown {
    const saved = state.gearSets[name]?.[set];
    if (!saved) return res.status(409).json({ error: "that gear set is not saved" });
    state.commands[name] = { id: ports.nextCommand(), type: "gear-set-equip", set, slots: saved.slots };
    return res.json({ ok: true });
  }
  /** The equipped set, or an error message when it cannot be saved. */
  function equipped(name: string): GearSet["slots"] | string {
    const status = state.statuses[name];
    if (!status?.slots || !(Number(status.seenAt) >= ports.now() - 10000)) return "no fresh equipment report for " + name;
    const slots: GearSet["slots"] = {};
    for (const slot of GEAR_SET_SLOTS) {
      const member = gearSetItem(status.slots[slot]?.item);
      if (member) slots[slot] = member;
    }
    return Object.keys(slots).length ? slots : "nothing is equipped in the gear set slots";
  }
  return function gearSets(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character), set = requestText(body.set) as GearSetName;
    if (!ports.owned(name)) return res.status(400).json({ error: "invalid character" });
    if (!(GEAR_SET_NAMES as readonly string[]).includes(set)) return res.status(400).json({ error: "invalid gear set" });
    if (body.action === "equip") return equip(res, name, set);
    const sets = (state.gearSets[name] ||= {});
    if (body.action === "clear") delete sets[set];
    else if (body.action === "save") {
      const slots = equipped(name);
      if (typeof slots === "string") return res.status(409).json({ error: slots });
      sets[set] = { slots, savedAt: ports.now() };
    } else return res.status(400).json({ error: "invalid gear set action" });
    ports.persist();
    return res.json({ ok: true, gearSets: state.gearSets[name] });
  };
}
