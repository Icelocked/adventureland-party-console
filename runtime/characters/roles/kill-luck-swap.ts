export type GearItem = { name: string; level?: number; [key: string]: unknown };
/**
 * Equip slots this module swaps: every gear-set slot but the elixir, which equipping consumes and
 * the game refuses to unequip. The porcupine weapon swap shares mainhand/offhand; the luck swap
 * waits while it is busy (otherSwapBusy). Mainhand goes before offhand so a two-handed weapon is
 * replaced before a shield returns.
 */
export const LUCK_SWAP_SLOTS = [
  "mainhand", "offhand", "chest", "pants", "helmet", "gloves", "shoes", "cape", "belt", "orb", "amulet",
  "ring1", "ring2", "earring1", "earring2",
] as const;
export type LuckSlot = (typeof LUCK_SWAP_SLOTS)[number];
type Loadout = Partial<Record<LuckSlot, GearItem | null>>;
export interface LuckSwapSession {
  original: Loadout;
  expected: Loadout;
  plan: Partial<Record<LuckSlot, GearItem>>;
  restoring: boolean;
  /** The kill this session is worn for; the session moves to the next target while kills keep coming. */
  targetId?: string;
}
export interface LuckTarget {
  id: string;
  hp: number;
  dead?: unknown;
  rip?: unknown;
}
export interface LuckSwapMemory {
  session?: LuckSwapSession;
  pending?: Promise<void>;
  retryAt?: number;
  swappedInAt?: number;
  /** A manual equip (dashboard item or gear-set Equip) holds the stranded-luck correction off until then. */
  manualUntil?: number;
  hpTrend?: { id: string; samples: { t: number; hp: number }[] };
}
export interface LuckSwapPorts {
  now(): number;
  isTank(): boolean;
  equipped(slot: LuckSlot): GearItem | null;
  items(): (GearItem | null)[];
  /** This character's saved gear set (`luck` worn at the kill, `tank` restored after), or null. */
  gearSet(name: "luck" | "tank"): Partial<Record<LuckSlot, GearItem>> | null;
  fingerprint(item: GearItem | null): GearItem | null;
  same(a: GearItem | null, b: GearItem | null): boolean;
  equip(index: number, slot: LuckSlot): Promise<unknown>;
  /** Empty a slot (back into the bag); a luck piece worn where nothing was before the swap. */
  unequip(slot: LuckSlot): Promise<unknown>;
  lethalBasicAttack(target: LuckTarget): boolean;
  /**
   * True while this monster's own `.target` is this character's name. Ordinary (non-cooperative)
   * monster deaths roll their drop using only whoever the monster was attacking at that instant
   * (`issue_monster_award`'s `players[name_to_id[monster.target]]`, upstream `node/server.js`) —
   * not a per-contributor share, and not the party's other members at all. A luck swap only pays
   * off if this character actually holds that aggro when the kill lands.
   */
  holdsAggro(target: LuckTarget): boolean;
  endangered(): boolean;
  otherSwapBusy(): boolean;
  report(message: string): void;
}

/**
 * Swaps the designated tank into its saved `luck` gear set right before a monster dies, then
 * restores its `tank` set (or the gear worn when the swap began) once the kill is confirmed. Per
 * upstream `node/server.js`'s `issue_monster_award()`, an ordinary monster's drop is rolled using
 * only whoever it was attacking when it died, so this only pays off while the tank holds that
 * aggro (`holdsAggro`); a lethal attack from this character sets its own aggro as part of the
 * kill. The trigger predicts the kill from an HP-trend time-to-death estimate plus a one-shot path.
 */
export function createKillLuckSwap(ports: LuckSwapPorts, memory: LuckSwapMemory = {}) {
  let active = true;
  const copyLoadout = (): Loadout => {
    const loadout: Loadout = {};
    for (const slot of LUCK_SWAP_SLOTS) loadout[slot] = ports.fingerprint(ports.equipped(slot));
    return loadout;
  };
  const matches = (loadout: Loadout) =>
    (Object.keys(loadout) as LuckSlot[]).every(slot => ports.same(ports.equipped(slot), loadout[slot] ?? null));
  function relinquish() { delete memory.session; }
  function owned(session: LuckSwapSession): boolean {
    if (!active || memory.session !== session) return false;
    if (matches(session.expected)) return true;
    relinquish();
    return false;
  }
  function find(item: GearItem): number {
    const index = ports.items().findIndex(candidate => ports.same(candidate, item));
    if (index < 0) throw new Error("Saved luck-swap item is missing from inventory: " + item.name);
    return index;
  }
  async function equipSlot(item: GearItem, slot: LuckSlot, session: LuckSwapSession): Promise<void> {
    if (!owned(session)) return;
    await ports.equip(find(item), slot);
    session.expected = { ...session.expected, [slot]: ports.fingerprint(item) };
    if (!ports.same(ports.equipped(slot), item)) throw new Error("Game did not equip " + item.name);
  }
  function planApplied(session: LuckSwapSession): boolean {
    return (Object.keys(session.plan) as LuckSlot[]).every(slot => ports.same(ports.equipped(slot), session.plan[slot]!));
  }
  async function swap(session: LuckSwapSession): Promise<void> {
    for (const slot of Object.keys(session.plan) as LuckSlot[]) {
      if (!owned(session) || session.restoring) return;
      const wanted = session.plan[slot]!;
      if (!ports.same(ports.equipped(slot), wanted)) await equipSlot(wanted, slot, session);
    }
  }
  function restoreTarget(session: LuckSwapSession): Loadout {
    const tank = ports.gearSet("tank");
    if (!tank) return session.original;
    const target: Loadout = { ...session.original };
    for (const slot of Object.keys(tank) as LuckSlot[]) {
      const [index] = locate([tank[slot]!]);
      const worn = ports.equipped(slot);
      if (member(worn, tank[slot]!)) target[slot] = ports.fingerprint(worn);
      else if (index >= 0) target[slot] = ports.fingerprint(ports.items()[index]);
    }
    return target;
  }
  async function restore(session: LuckSwapSession): Promise<void> {
    const target = restoreTarget(session);
    for (const slot of Object.keys(target) as LuckSlot[]) {
      if (!owned(session)) return;
      const wanted = target[slot] ?? null;
      if (!wanted) {
        // The slot was empty before the swap: take the luck piece off again.
        if (session.plan[slot] && ports.same(ports.equipped(slot), session.plan[slot]!)) {
          await ports.unequip(slot);
          session.expected = { ...session.expected, [slot]: null };
        }
        continue;
      }
      // A piece that is no longer carried leaves its slot as it is rather than failing the restore.
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
  /** Set members match by identity; lock state and quantity can change without it becoming another item. */
  function member(item: GearItem | null, wanted: GearItem): boolean {
    return !!item && item.name === wanted.name &&
      (["level", "p", "stat_type"] as const).every(key => (item[key] ?? undefined) === (wanted[key] ?? undefined));
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
  /** The luck set's pieces not yet worn in their slot and carried in the bag; nothing without a saved luck set. */
  function planSwap(): Partial<Record<LuckSlot, GearItem>> {
    const set = ports.gearSet("luck");
    if (!set) return {};
    const slots = (Object.keys(set) as LuckSlot[]).filter(slot => LUCK_SWAP_SLOTS.includes(slot) && !member(ports.equipped(slot), set[slot]!));
    const found = locate(slots.map(slot => set[slot]!));
    const plan: Partial<Record<LuckSlot, GearItem>> = {};
    slots.forEach((slot, index) => { if (found[index] >= 0) plan[slot] = ports.fingerprint(ports.items()[found[index]])!; });
    return plan;
  }
  /**
   * Luck-set pieces worn with no session to restore them: a client restart or a dashboard
   * equip drops the session that put them on. Each such slot maps to its tank-set piece when
   * carried, or to null when the tank set left the slot empty (saved sets record every worn
   * slot). Slots holding anything else are left as they are.
   */
  function strandedLuckPieces(): Partial<Record<LuckSlot, GearItem | null>> {
    const luck = ports.gearSet("luck"), tank = ports.gearSet("tank");
    if (!luck || !tank) return {};
    const stranded: Partial<Record<LuckSlot, GearItem | null>> = {};
    const slots = LUCK_SWAP_SLOTS.filter(slot => {
      const worn = ports.equipped(slot);
      return luck[slot] && member(worn, luck[slot]!) && !(tank[slot] && member(worn, tank[slot]!));
    });
    const found = locate(slots.map(slot => tank[slot]).filter((item): item is GearItem => !!item));
    let next = 0;
    for (const slot of slots) {
      if (!tank[slot]) { stranded[slot] = null; continue; }
      const index = found[next++];
      if (index >= 0) stranded[slot] = ports.fingerprint(ports.items()[index]);
    }
    return stranded;
  }
  async function putBack(stranded: Partial<Record<LuckSlot, GearItem | null>>): Promise<void> {
    for (const slot of Object.keys(stranded) as LuckSlot[]) {
      if (memory.session) return;
      const wanted = stranded[slot];
      if (!wanted) { await ports.unequip(slot); continue; }
      const index = find(wanted);
      if (index >= 0) await ports.equip(index, slot);
    }
  }
  function beginSwap(target: LuckTarget): void {
    const plan = planSwap();
    // No saved luck set, or every carried member is already worn: nothing to swap.
    if (!Object.keys(plan).length) { memory.retryAt = ports.now() + 2000; return; }
    const next: LuckSwapSession = { original: copyLoadout(), expected: copyLoadout(), plan, restoring: false, targetId: target.id };
    memory.session = next;
    memory.swappedInAt = ports.now();
    run(() => swap(next));
  }
  function trackHpTrend(target: LuckTarget): void {
    const trend = memory.hpTrend?.id === target.id ? memory.hpTrend : { id: target.id, samples: [] };
    trend.samples = trend.samples.filter(sample => ports.now() - sample.t <= 2000).concat({ t: ports.now(), hp: target.hp });
    memory.hpTrend = trend;
  }
  function estimatedSecondsToDeath(): number {
    const samples = memory.hpTrend?.samples || [];
    const oldest = samples[0], newest = samples[samples.length - 1];
    if (!oldest || !newest || oldest === newest) return Infinity;
    const elapsedSeconds = (newest.t - oldest.t) / 1000;
    const dps = elapsedSeconds > 0 ? (oldest.hp - newest.hp) / elapsedSeconds : 0;
    return dps > 0 ? newest.hp / dps : Infinity;
  }
  /** True when this character's attack, or the target's falling HP, makes the kill imminent. */
  function killImminent(target: LuckTarget, pieces: number): boolean {
    trackHpTrend(target);
    // A lethal attack from this character sets (or confirms) its own aggro as part of that same
    // kill, even if the monster had no target yet — so the aggro check only gates the trend-based
    // prediction, where the kill (and whichever aggro was already in place) may come from elsewhere.
    if (ports.lethalBasicAttack(target)) return true;
    // Each piece is a server round trip, so a larger set needs a longer lead before the kill.
    return pieces > 0 && ports.holdsAggro(target) && estimatedSecondsToDeath() <= Math.max(3, 1.5 + 0.35 * pieces);
  }
  function shouldSwapIn(target: LuckTarget | null): boolean {
    if (!target || !ports.isTank() || ports.otherSwapBusy()) return false;
    return killImminent(target, Object.keys(planSwap()).length);
  }
  /**
   * The session's kill landed and the tank already has its next target. Keep the luck set on
   * when that kill is imminent too, rather than restoring and swapping straight back; the
   * safety timeout then counts from this hand-over.
   */
  function handOver(session: LuckSwapSession, target: LuckTarget): boolean {
    if (!killImminent(target, Object.keys(session.plan).length)) return false;
    session.targetId = target.id;
    memory.swappedInAt = ports.now();
    return true;
  }
  /** The session's target is gone and the tank's next kill is not imminent enough to keep the luck set on. */
  function lostItsKill(session: LuckSwapSession, target: LuckTarget): boolean {
    return session.targetId !== undefined && target.id !== session.targetId && !handOver(session, target);
  }
  function shouldRestore(session: LuckSwapSession, target: LuckTarget | null): boolean {
    if (!ports.isTank()) return true;
    if (!target || target.dead || target.rip) return true;
    if (ports.endangered()) return true;
    if (lostItsKill(session, target)) return true;
    // Safety timeout: covers a boss phase where the trend estimate dipped then stabilized —
    // don't stay in weaker gear indefinitely waiting for a death that isn't imminent anymore.
    if (ports.now() - (memory.swappedInAt || 0) > 10000) return true;
    return false;
  }
  function continueSession(session: LuckSwapSession, target: LuckTarget | null): void {
    if (!owned(session)) return;
    if (!session.restoring && shouldRestore(session, target)) session.restoring = true;
    if (session.restoring) { run(() => restore(session)); return; }
    if (!planApplied(session)) run(() => swap(session));
  }
  return {
    tick(target: LuckTarget | null): void {
      if (!active || memory.pending) return;
      const session = memory.session;
      if (session) { continueSession(session, target); return; }
      if (ports.otherSwapBusy()) return;
      if (shouldSwapIn(target)) { beginSwap(target!); return; }
      if (!ports.isTank() || ports.now() < (memory.manualUntil || 0)) return;
      const stranded = strandedLuckPieces();
      if (Object.keys(stranded).length) run(() => putBack(stranded));
    },
    depart(): void {
      if (!memory.session) return;
      memory.session.restoring = true;
      memory.retryAt = 0;
      run(() => restore(memory.session!));
    },
    async manual(): Promise<void> {
      relinquish();
      // Long enough to adjust a set by hand and save it again.
      memory.manualUntil = ports.now() + 10 * 60_000;
      await memory.pending;
    },
    busy: () => !!memory.pending,
    /**
     * Inventory slots this swap holds: combat gear waiting to be restored and the luck pieces it
     * wears or will wear. Automatic upgrade/compound pickups must leave them alone; one slot per
     * held item, so identical copies elsewhere in the bag stay eligible.
     */
    reservedSlots(): number[] {
      if (!active) return [];
      const held: GearItem[] = [];
      for (const name of ["luck", "tank"] as const) {
        const set = ports.gearSet(name) || {};
        for (const slot of Object.keys(set) as LuckSlot[]) if (!member(ports.equipped(slot), set[slot]!)) held.push(set[slot]!);
      }
      const session = memory.session;
      if (session) for (const item of Object.values(session.original)) if (item) held.push(item);
      return [...new Set(locate(held).filter(index => index >= 0))].sort((a, b) => a - b);
    },
    stop() { active = false; },
  };
}
