import { LUCK_SWAP_SLOTS, type GearItem, type LuckSlot } from "./kill-luck-swap.ts";

type Loadout = Partial<Record<LuckSlot, GearItem | null>>;
/**
 * The skill engine's judgement of fan-farming with the gear worn now: `lethal` when Fan of
 * Knives one-shots an authorized mob in view, `weak` when mobs are in view but none dies to it,
 * `unseen` when scatter fan-farming has nothing in view (between respawns), `off` otherwise.
 */
export type FanVerdict = "lethal" | "weak" | "unseen" | "off";
interface FanSession { original: Loadout; expected: Loadout; plan: Partial<Record<LuckSlot, GearItem>>; restoring: boolean; appliedAt?: number }
export interface FanFarmGearMemory {
  session?: FanSession;
  pending?: Promise<void>;
  retryAt?: number;
  wantSince?: number;
  leaveSince?: number;
  /** A set too weak for the farmed mob, or a manual equip, holds the set off until then. */
  heldUntil?: number;
}
export interface FanFarmGearPorts {
  now(): number;
  equipped(slot: LuckSlot): GearItem | null;
  items(): (GearItem | null)[];
  /** This character's saved `fan` gear set, or null. */
  gearSet(): Partial<Record<LuckSlot, GearItem>> | null;
  fingerprint(item: GearItem | null): GearItem | null;
  same(a: GearItem | null, b: GearItem | null): boolean;
  equip(index: number, slot: LuckSlot): Promise<unknown>;
  unequip(slot: LuckSlot): Promise<unknown>;
  verdict(): FanVerdict;
  otherSwapBusy(): boolean;
  report(message: string): void;
}
const SWAP_IN_MS = 2000, LEAVE_MS = 3000, SETTLE_MS = 1500, HOLD_MS = 10 * 60_000;

/**
 * Wears the rogue's saved `fan` set (barely enough damage to one-shot, the rest luck and attack
 * speed) while it scatter-farms mobs Fan of Knives kills outright, and restores the gear worn
 * before once it stops. The set is judged with the gear actually worn: a set that no longer
 * one-shots what is being farmed comes off and is held off for ten minutes.
 */
export function createFanFarmGear(ports: FanFarmGearPorts, memory: FanFarmGearMemory = {}) {
  let active = true;
  const copyLoadout = (): Loadout => Object.fromEntries(LUCK_SWAP_SLOTS.map(slot => [slot, ports.fingerprint(ports.equipped(slot))]));
  const matches = (loadout: Loadout) =>
    (Object.keys(loadout) as LuckSlot[]).every(slot => ports.same(ports.equipped(slot), loadout[slot] ?? null));
  function owned(session: FanSession): boolean {
    if (!active || memory.session !== session) return false;
    if (matches(session.expected)) return true;
    delete memory.session;
    return false;
  }
  /** Set members match by identity; lock state and quantity can change without it becoming another item. */
  function member(item: GearItem | null, wanted: GearItem): boolean {
    return !!item && item.name === wanted.name && (item.level ?? undefined) === (wanted.level ?? undefined) &&
      (item.p ?? undefined) === (wanted.p ?? undefined) && (item.stat_type ?? undefined) === (wanted.stat_type ?? undefined);
  }
  /** Each wanted item claims its own bag slot, so two identical rings fill both ring slots. */
  function locate(wanted: GearItem[]): number[] {
    const taken = new Set<number>(), items = ports.items();
    return wanted.map(item => {
      const index = items.findIndex((candidate, slot) => !taken.has(slot) && member(candidate, item));
      if (index >= 0) taken.add(index);
      return index;
    });
  }
  function planSwap(): Partial<Record<LuckSlot, GearItem>> {
    const set = ports.gearSet();
    if (!set) return {};
    const slots = (Object.keys(set) as LuckSlot[]).filter(slot => LUCK_SWAP_SLOTS.includes(slot) && !member(ports.equipped(slot), set[slot]!));
    const found = locate(slots.map(slot => set[slot]!));
    const plan: Partial<Record<LuckSlot, GearItem>> = {};
    slots.forEach((slot, index) => { if (found[index] >= 0) plan[slot] = ports.fingerprint(ports.items()[found[index]])!; });
    return plan;
  }
  async function equipSlot(item: GearItem, slot: LuckSlot, session: FanSession): Promise<void> {
    if (!owned(session)) return;
    const index = ports.items().findIndex(candidate => ports.same(candidate, item));
    if (index < 0) throw new Error("Fan farm set item is missing from inventory: " + item.name);
    await ports.equip(index, slot);
    session.expected = { ...session.expected, [slot]: ports.fingerprint(item) };
  }
  async function swap(session: FanSession): Promise<void> {
    for (const slot of Object.keys(session.plan) as LuckSlot[]) {
      if (!owned(session) || session.restoring) return;
      if (!ports.same(ports.equipped(slot), session.plan[slot]!)) await equipSlot(session.plan[slot]!, slot, session);
    }
    if (owned(session)) session.appliedAt = ports.now();
  }
  async function restore(session: FanSession): Promise<void> {
    for (const slot of Object.keys(session.original) as LuckSlot[]) {
      if (!owned(session)) return;
      const wanted = session.original[slot] ?? null;
      if (!wanted) {
        // The slot was empty before the set went on.
        if (session.plan[slot] && ports.same(ports.equipped(slot), session.plan[slot]!)) {
          await ports.unequip(slot);
          session.expected = { ...session.expected, [slot]: null };
        }
        continue;
      }
      if (!ports.same(ports.equipped(slot), wanted) && ports.items().some(item => ports.same(item, wanted)))
        await equipSlot(wanted, slot, session);
    }
    if (owned(session)) delete memory.session;
  }
  function run(operation: () => Promise<void>): void {
    if (!active || memory.pending || ports.now() < (memory.retryAt || 0)) return;
    const pending = operation().catch(error => {
      memory.retryAt = ports.now() + 2000;
      ports.report(String(error instanceof Error ? error.message : error));
    }).finally(() => { if (memory.pending === pending) delete memory.pending; });
    memory.pending = pending;
  }
  function begin(): void {
    const plan = planSwap();
    if (!Object.keys(plan).length) return;
    const session: FanSession = { original: copyLoadout(), expected: copyLoadout(), plan, restoring: false };
    memory.session = session;
    run(() => swap(session));
  }
  function considerSwapIn(allowed: boolean): void {
    // Fan of Knives empties the view between casts and looting briefly blocks combat; only
    // leaving fan-farming (or a too-weak verdict) restarts the wait.
    const verdict = ports.verdict();
    if (ports.now() < (memory.heldUntil || 0) || ports.otherSwapBusy() || !ports.gearSet() || allowed && (verdict === "off" || verdict === "weak")) {
      delete memory.wantSince; return;
    }
    if (!allowed || verdict !== "lethal") return;
    memory.wantSince ??= ports.now();
    if (ports.now() - memory.wantSince >= SWAP_IN_MS) { delete memory.wantSince; begin(); }
  }
  /** True once the worn set should come off: too weak for the farmed mob, or fan-farming stopped for a while. */
  function shouldRestore(session: FanSession, allowed: boolean): boolean {
    const verdict = allowed ? ports.verdict() : "off";
    if (verdict === "weak" && ports.now() - (session.appliedAt ?? Infinity) >= SETTLE_MS) {
      memory.heldUntil = ports.now() + HOLD_MS;
      ports.report("Fan farm set does not one-shot what is being farmed; wearing the previous gear for 10 minutes");
      return true;
    }
    if (verdict === "lethal" || verdict === "unseen") { delete memory.leaveSince; return false; }
    memory.leaveSince ??= ports.now();
    return ports.now() - memory.leaveSince >= LEAVE_MS;
  }
  function continueSession(session: FanSession, allowed: boolean): void {
    if (!owned(session)) return;
    if (session.appliedAt === undefined && !session.restoring) { run(() => swap(session)); return; }
    if (!session.restoring && shouldRestore(session, allowed)) { session.restoring = true; delete memory.leaveSince; }
    if (session.restoring) run(() => restore(session));
  }
  return {
    tick(allowed: boolean): void {
      if (!active || memory.pending) return;
      if (memory.session) continueSession(memory.session, allowed);
      else considerSwapIn(allowed);
    },
    depart(): void {
      if (!memory.session) return;
      memory.session.restoring = true;
      memory.retryAt = 0;
      run(() => restore(memory.session!));
    },
    async manual(): Promise<void> {
      delete memory.session;
      delete memory.wantSince;
      // Long enough to adjust the set by hand and save it again.
      memory.heldUntil = ports.now() + HOLD_MS;
      await memory.pending;
    },
    busy: () => !!memory.pending,
    /** Carried set pieces and the gear waiting to be restored; one bag slot per held item. */
    reservedSlots(): number[] {
      if (!active) return [];
      const set = ports.gearSet() || {};
      const held = (Object.keys(set) as LuckSlot[]).filter(slot => !member(ports.equipped(slot), set[slot]!)).map(slot => set[slot]!);
      for (const item of Object.values(memory.session?.original || {})) if (item) held.push(item);
      return [...new Set(locate(held).filter(index => index >= 0))].sort((a, b) => a - b);
    },
    stop() { active = false; },
  };
}
