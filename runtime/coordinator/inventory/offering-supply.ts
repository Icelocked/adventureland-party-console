import {requestObject,type HttpHandler} from '../http/contracts.ts';
import {isUpgradeOffering,resolveUpgradeOffering,type UpgradeOfferingRule,type UpgradeOffering} from '../../upgrade-offerings.ts';
import type {MerchantWork} from '../merchant/work.ts';
import type {InventoryEntry} from '../contracts/item.ts';
import {protectedMerchantStorageStock} from './merchant-storage-stock.ts';
import {sameMarkedItem} from './item-identity.ts';
import type {SharedScope} from './shared-rules.ts';

interface State extends SharedScope {
  merchantCharacter:string|null;
  merchantCurrent:MerchantWork|null;
  upgradeOfferingRules?:UpgradeOfferingRule[];
  upgrades?:Record<string,unknown[]|undefined>;
  statuses?:Record<string,{items?:(InventoryEntry|null)[]}|undefined>;
  commands?:Record<string,unknown>;
  autoUpgradeMarks?:Record<string,Record<string,unknown>|undefined>;
}
/** Slot handoff is queued here; the issuing character must yield before storage runs. */
export function createOfferingSupplyRoute(state:State,queue:(offering:UpgradeOffering,quantity:number)=>boolean,persist:()=>void=()=>{}):HttpHandler {
  return (req,res)=>{
    const body=requestObject(req.body),job=state.merchantCurrent;
    if(!job || job.id!==body.jobId || job.commandId!==body.commandId)
      return res.status(409).json({error:'upgrade job is no longer current'});
    if(!isUpgradeOffering(body.offering) || !authorized(state,job,body))
      return res.status(409).json({error:'upgrade offering intent changed'});
    admitBankContinuations(state,job,body);
    const outstanding = authorizedOfferingDemand(state,job,body.offering);
    const pending = outstanding > 0 && queue(body.offering,outstanding);
    const dependency = {...supplyStatus(state,body.offering,outstanding,pending),intents:structuredClone(requestObject(state.commands?.[String(state.merchantCharacter)]).upgrades)};
    if (pending) job.offeringSupply = dependency;
    else delete job.offeringSupply;
    persist();
    return res.json({...dependency,pending});
  };
}
function authorized(state:State,job:MerchantWork,body:Record<string,unknown>):boolean {
  const item=requestObject(body.item),mark=requestObject(body.mark);
  if(!liveItem(state,item) || typeof item.name!=='string') return false;
  const command=requestObject(state.commands?.[String(state.merchantCharacter)]);
  if(command.id!==job.commandId) return false;
  const admitted=admittedMark(command,mark);
  if(!admitted && !admittedBankMark(state,job,item,mark)) return false;
  const marks=intentMarks(state,job);
  if(mark.auto!==true) return manualIntent(marks,mark,item,body.offering,state);
  return automaticOfferingIntent(state,job,body,marks);
}
function admittedBankMark(state:State,job:MerchantWork,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  return mark.auto===true && authorizedBankRule(state,job,item,mark);
}
function automaticOfferingIntent(state:State,job:MerchantWork,body:Record<string,unknown>,marks:unknown[]):boolean {
  const item=requestObject(body.item),mark=requestObject(body.mark);
  return selectedOffering(state,item,body.offering) && currentUpgradeRule(state,item,mark) && unfinished(mark,item) &&
    (automaticIntent(marks,item,mark) || authorizedBankRule(state,job,item,mark));
}
function admittedMark(command:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  return Array.isArray(command.upgrades) && command.upgrades.some(raw=>{
    const saved=requestObject(raw);
    return Number(saved.tiers)===Number(mark.tiers) && saved.auto===mark.auto &&
      sameMarkedItem(requestObject(saved.item),requestObject(mark.item)) &&
      (saved.requestId ? saved.requestId===mark.requestId : saved.slot===mark.slot);
  });
}
function intentMarks(state:State,job:MerchantWork):unknown[] {return state.upgrades?.[String(job.target || state.merchantCharacter)] || [];}
function selectedOffering(state:State,item:Record<string,unknown>,offering:unknown):boolean {
  return resolveUpgradeOffering(state.upgradeOfferingRules || [],String(item.name),Number(item.level)||0)?.offering===offering;
}
function currentUpgradeRule(state:State,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const key=String(item.name)+'@+'+Number(requestObject(mark.item).level||0);
  const owners=state.merchantRules?[state.autoUpgradeMarks?.[String(state.merchantCharacter)]]:Object.values(state.autoUpgradeMarks || {});
  return owners.some(rules=>{
    const saved=rules?.[key],data=requestObject(saved);
    const tiers=typeof saved==='object'?data.tiers:saved;
    return Number(tiers)===Number(mark.tiers) && data.quantity!==0;
  });
}
function liveItem(state:State,item:Record<string,unknown>):boolean {
  const live=state.statuses?.[String(state.merchantCharacter)]?.items?.some(entry=>entry?.item &&
    Object.keys(item).every(key=>JSON.stringify(entry.item![key])===JSON.stringify(item[key])));
  return live===true;
}
function automaticIntent(marks:unknown[],item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  return marks.some(raw=>{
      const saved=requestObject(raw),start=requestObject(saved.item);
      return saved.auto===true && start.name===item.name && start.level===requestObject(mark.item).level;
    });
}
function manualIntent(marks:unknown[],mark:Record<string,unknown>,item:Record<string,unknown>,offering:unknown,state:State):boolean {
  return marks.map(requestObject).some(saved=>originalManual(saved,mark) && unfinished(saved,item) &&
    resolveUpgradeOffering(state.upgradeOfferingRules || [],String(item.name),Number(item.level)||0,explicitOffering(saved))?.offering===offering);
}
function explicitOffering(mark:Record<string,unknown>):UpgradeOffering|undefined {return isUpgradeOffering(mark.offering)?mark.offering:undefined;}
function originalManual(saved:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const identity=typeof saved.requestId==='string' ? saved.requestId===mark.requestId : saved.slot===mark.slot && !!saved.equipped===!!mark.equipped;
  return identity && saved.auto!==true && sameMarkedItem(requestObject(saved.item),requestObject(mark.item)) && Number(saved.tiers)===Number(mark.tiers);
}
function unfinished(mark:Record<string,unknown>,item:Record<string,unknown>):boolean {
  const start=requestObject(mark.item),level=Number(item.level)||0,origin=Number(start.level)||0;
  return level>=origin && level<origin+Number(mark.tiers) && sameMarkedItem({...item,level:origin},{...start,level:origin});
}
/** Count only admitted, authorized unfinished steps, assigning each live copy once. */
export function authorizedOfferingDemand(state:State,job:MerchantWork,offering:UpgradeOffering):number {
  const command=requestObject(state.commands?.[String(state.merchantCharacter)]);
  if(command.id!==job.commandId || !Array.isArray(command.upgrades)) return 0;
  const live=state.statuses?.[String(state.merchantCharacter)]?.items || [],used=new Set<number>();
  let demand=0;
  for(const raw of command.upgrades){
    const mark=requestObject(raw),index=liveMarkIndex(live,mark,used);
    if(index<0) continue;
    const item=live[index]!.item!;
    if(!authorizedCurrentOffering(state,job,item,mark)) continue;
    used.add(index);
    demand+=plannedOfferingSteps(state,mark,item,offering);
  }
  return Math.max(0,demand-carriedQuantity(state,offering));
}
function authorizedCurrentOffering(state:State,job:MerchantWork,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const selected=resolveUpgradeOffering(state.upgradeOfferingRules || [],String(item.name),Number(item.level)||0,explicitOffering(mark));
  return authorized(state,job,{item,mark,offering:selected?.offering});
}
function carriedQuantity(state:State,offering:UpgradeOffering):number {
  return protectedMerchantStorageStock(state).filter(entry=>entry.craftLocation==='inventory:'+state.merchantCharacter && entry.item?.name===offering && !entry.item.l && !entry.item.b)
    .reduce((sum,entry)=>sum+(Number(entry.item?.q)||1),0);
}
function liveMarkIndex(live:(InventoryEntry|null)[],mark:Record<string,unknown>,used:Set<number>):number {
  const matches=(entry:InventoryEntry|null,index:number)=>!used.has(index) && !!entry?.item && unfinished(mark,entry.item);
  const index=live.findIndex((entry,index)=>entry?.slot===(mark.liveSlot ?? mark.slot) && matches(entry,index));
  return index>=0 ? index : live.findIndex(matches);
}
function plannedOfferingSteps(state:State,mark:Record<string,unknown>,item:Record<string,unknown>,offering:UpgradeOffering):number {
  const start=requestObject(mark.item),target=Number(start.level||0)+Number(mark.tiers||1);
  let demand=0;
  for(let level=Number(item.level||0);level<target;level++){
    if(resolveUpgradeOffering(state.upgradeOfferingRules || [],String(item.name),level,explicitOffering(mark))?.offering===offering) demand++;
    if(mark.offering) break;
  }
  return demand;
}
function supplyStatus(state:State,offering:UpgradeOffering,outstanding:number,pending:boolean) {
  const status=pending ? 'pending' : outstanding ? 'unavailable' : 'delivered';
  const blockingReason=pending ? 'Waiting for confirmed merchant collection' : outstanding ? 'No usable offering stock' : null;
  return {offering,outstanding,state:status,blockingReason,rulesSignature:JSON.stringify(state.upgradeOfferingRules || [])};
}
/** Bank input admission is capped by the character's existing three-copy batch. */
function admitBankContinuations(state:State,job:MerchantWork,body:Record<string,unknown>):void {
  const command=requestObject(state.commands?.[String(state.merchantCharacter)]);
  if(!Array.isArray(command.bankUpgradeRules)) return;
  const marks=Array.isArray(command.upgrades)?command.upgrades:[];
  const additions=bankContinuations(state,job,command,marks);
  for(const mark of additions){
    if(mark.slot===requestObject(body.mark).slot) Object.assign(mark,requestObject(body.mark));
    const owner=String(job.target || state.merchantCharacter),saved=(state.upgrades ||= {})[owner] ||= [];
    saved.push(mark);marks.push(mark);
  }
  command.upgrades=marks;
}
function bankContinuations(state:State,job:MerchantWork,command:Record<string,unknown>,marks:unknown[]):Record<string,unknown>[] {
  const candidates=state.statuses?.[String(state.merchantCharacter)]?.items || [];
  const rules=Array.isArray(command.bankUpgradeRules)?command.bankUpgradeRules.map(requestObject):[];
  return candidates.flatMap(entry=>bankContinuation(state,job,entry,marks,rules)).slice(0,3);
}
function bankContinuation(state:State,job:MerchantWork,entry:InventoryEntry|null,marks:unknown[],rules:Record<string,unknown>[]):Record<string,unknown>[] {
  if(!entry?.item || marks.some(raw=>requestObject(raw).slot===entry.slot)) return [];
  const item=entry.item,rule=rules.find(rule=>rule.name===item.name && Number(rule.level||0)===Number(item.level||0));
  if(!rule) return [];
  const mark={slot:entry.slot,item,tiers:rule.tiers,auto:true};
  return currentUpgradeRule(state,item,mark) && authorizedBankRule(state,job,item,mark) ? [mark] : [];
}
function authorizedBankRule(state:State,job:MerchantWork,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const command=requestObject(state.commands?.[String(state.merchantCharacter)]);
  if(command.id!==job.commandId || !Array.isArray(command.bankUpgradeRules)) return false;
  const start=requestObject(mark.item),level=Number(item.level)||0;
  return command.bankUpgradeRules.some(raw=>{
    const rule=requestObject(raw),sourceLevel=Number(rule.level)||0,tiers=Number(rule.tiers);
    return rule.name===item.name && sourceLevel===Number(start.level||0) &&
      Number(mark.tiers)===tiers && level>=sourceLevel && level<sourceLevel+tiers;
  });
}
