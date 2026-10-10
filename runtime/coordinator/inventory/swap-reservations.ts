/**
 * Gear a character holds for its luck swap: saved gear-set members in its bag and combat gear
 * swapped out mid-swap, reported as `reservedInventory`. No automatic rule (bank, merchant, NPC
 * sale, upgrade, compound, deconstruction) may select these slots; manual marks are the user's
 * choice and still apply. A report naming a different item no longer protects the slot.
 */
export interface SwapReservationStatus {
  reservedInventory?: { slot: number; item: { name?: string } | null }[];
}
export function swapHeld(
  status: unknown,
  slot: number | string | undefined,
  item: { name?: string } | null | undefined,
): boolean {
  // Equipped-slot marks (e.g. "ring1") are never bag slots and so never held here.
  if (typeof slot !== "number") return false;
  const held = (status as SwapReservationStatus | null | undefined)?.reservedInventory;
  return !!held?.some(entry => entry.slot === slot && !!item?.name && entry.item?.name === item.name);
}
