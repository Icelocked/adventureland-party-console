import type { Item } from './coordinator/contracts/item.ts';

/**
 * Prim stacking (#65): upgrade operations that raise an item's hidden grace without
 * attempting a level. In the game's upgrade handler an offering with no scroll adds
 * +0.5 grace; an offering with a stat scroll adds +1 and consumes the grade's scroll
 * count. Offering grade does not change either amount, so only Primling is used.
 */
export type PrimStackMethod = 'offering' | 'stat';
export const primStackGain: Readonly<Record<PrimStackMethod, number>> = { offering: 0.5, stat: 1 };
export const primStackOffering = 'offeringp';
/** Grace counts up to the next level + 1 (with player grace and igrace); +13 is the highest attempt. */
export const primStackMaxTarget = 15;
export const primStackTargets = Array.from({ length: primStackMaxTarget * 2 }, (_, index) => (index + 1) / 2);

export interface PrimStackRequest {
  slot: number;
  item: Item;
  target: number;
  method: PrimStackMethod;
  /** Stat method only: the scroll for the item's current stat and the count each operation consumes. */
  scroll?: string;
  scrolls?: number;
}

export function isPrimStackMethod(value: unknown): value is PrimStackMethod {
  return value === 'offering' || value === 'stat';
}
export function validPrimStackTarget(value: unknown): value is number {
  return typeof value === 'number' && primStackTargets.includes(value);
}
export function statScrollName(stat: string): string {
  return stat === 'mp_cost' ? 'mpcostscroll' : stat + 'scroll';
}
/** The game's calculate_item_grade for an upgradeable item. */
export function upgradeGrade(level: number, grades: readonly number[] = [9, 10, 11, 12]): number {
  return grades.filter(threshold => level >= threshold).length;
}
/** Stat scrolls one stat application consumes at the item's current grade. */
export function statScrollsPerStack(level: number, grades?: readonly number[]): number {
  return [1, 10, 100, 1000, 9999][upgradeGrade(level, grades)]!;
}
