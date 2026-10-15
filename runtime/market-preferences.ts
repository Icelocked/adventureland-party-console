import type {ItemInfo} from 'typed-adventureland';

/** ALData can advertise item names absent from the installed game catalog. */
export type MarketItemIdentity = Pick<ItemInfo,'level'> & {name:string};
/** Saved display preference: an omitted native level is normalized to +0. */
export type MarketIgnoredItem = Required<MarketItemIdentity>;
export function marketItemKey(item:MarketItemIdentity){return `${item.name}|${item.level??0}`;}
export function marketListingFresh(seenAt:number|undefined,now:number){
  return typeof seenAt==='number'&&Number.isFinite(seenAt)&&seenAt>=now-120000;
}
export function validMarketIgnoredItem(value:unknown):value is MarketIgnoredItem{
  if(!value||typeof value!=='object')return false;
  const item=value as Record<string,unknown>;
  return typeof item.name==='string'&&/^[a-z0-9_]{1,80}$/i.test(item.name)&&
    typeof item.level==='number'&&Number.isSafeInteger(item.level)&&item.level>=0&&item.level<=100;
}
