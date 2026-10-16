import {requestObject} from '../http/contracts.ts';
import type {InventoryEntry} from '../contracts/item.ts';

/** Only the requested gear and intent can resolve survivor ambiguity; potions cannot. */
export function upgradeRecoverySignature(marks:unknown[],items:(InventoryEntry|null)[]):string {
  const names=new Set(marks.map(mark=>requestObject(requestObject(mark).item).name));
  return JSON.stringify([marks,items.filter(entry=>entry?.item && names.has(entry.item.name))
    .map(entry=>({slot:entry!.slot,item:entry!.item}))]);
}
