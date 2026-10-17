import type { Role } from "../roles/types.ts";
import type { SkillDefinition, SkillId } from "../skills/types.ts";
// use_mp consumes the last inventory item that grants MP.
function lastMpPotion(): number {
  for (let slot = character.items.length - 1; slot >= 0; slot--) {
    const item = character.items[slot];
    const grant = item && G.items[item.name]?.gives?.find(([stat, amount]) => stat === "mp" && amount > 0);
    if (grant) return Number(grant[1]);
  }
  return 0;
}
/** MP for one Fan of Knives after the character's MP reduction. */
function fanCost(): number {
  return Math.ceil(((G.skills as Partial<Record<SkillId, SkillDefinition>>).fanofknives?.mp ?? 180) * (1 - Math.min(100, Math.max(0, character.mp_reduction || 0)) / 100));
}
export const role: Partial<Role> = { name: "rogue", combat: true,
  beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
  beforeAttack: target => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false),
  usePotion: async function () {
    const refill = sharedRoutine.fanOfKnivesFarming?.() ? lastMpPotion() : 0;
    if (!refill) return await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow: 0.2, priority: "hp" });
    // Fan of Knives one-shots: refill MP whenever a whole potion fits, or before fewer than two
    // casts remain even if it overflows; the rogue outspends back-to-back potions.
    const mpBelow = Math.max(0.2, 1 - refill / character.max_mp, 2 * fanCost() / character.max_mp);
    if (await sharedRoutine.useRecoveryPotion({ hpBelow: 0.5, mpBelow, priority: "hp" })) return true;
    // Free regeneration would hold the shared potion cooldown for 4 s.
    return character.mp < character.max_mp && character.hp >= character.max_hp * 0.5;
  },
};
