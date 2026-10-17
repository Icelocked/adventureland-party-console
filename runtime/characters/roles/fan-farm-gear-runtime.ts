import { createFanFarmGear, type FanFarmGearMemory } from "./fan-farm-gear.ts";
import type { GearItem, LuckSlot } from "./kill-luck-swap.ts";
import type { CombatRoot } from "./types.ts";

export interface FanFarmGearEquipmentPort {
  busy(): boolean;
}

export function installFanFarmGear(root: CombatRoot, others: FanFarmGearEquipmentPort[]) {
  const host = parent as unknown as { __partyFanFarmGear?: FanFarmGearMemory };
  const memory = host.__partyFanFarmGear ??= {};
  const fingerprint = (item: GearItem | null): GearItem | null => {
    if (!item) return null;
    const result: GearItem = { name: item.name };
    for (const key of ["level", "p", "stat_type", "data", "rid", "b", "m", "l", "v"])
      if (item[key] !== undefined) result[key] = item[key];
    return result;
  };
  root.partyFanFarmGear?.stop();
  return root.partyFanFarmGear = createFanFarmGear({
    now: Date.now,
    equipped: (slot: LuckSlot) => character.slots[slot] as GearItem | null,
    items: () => character.items as (GearItem | null)[],
    gearSet: () => {
      const slots = root.partyGearSets?.[character.name]?.fan?.slots as Partial<Record<LuckSlot, GearItem>> | undefined;
      return slots ? Object.fromEntries(Object.entries(slots).filter(([, item]) => item && item.name !== "undefined")) as Partial<Record<LuckSlot, GearItem>> : null;
    },
    fingerprint,
    same: (item, wanted) => JSON.stringify(fingerprint(item)) === JSON.stringify(fingerprint(wanted)),
    equip: (index, slot) => Promise.resolve(equip(index, slot)),
    unequip: slot => Promise.resolve(unequip(slot)),
    verdict: () => sharedRoutine.fanOfKnivesVerdict?.() ?? "off",
    otherSwapBusy: () => others.some(other => other.busy()),
    report(message) {
      if (root.partyCombatState) {
        root.partyCombatState.error = message;
        root.partyCombatState.errorAt = Date.now();
      }
    },
  }, memory);
}
