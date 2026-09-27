import { randomUUID } from 'node:crypto';
import { requestObject, type HttpRequest, type HttpResponse, type HttpRouter } from '../http/contracts.ts';
import { previewOptions, type UpgradePreviewResult } from '../../upgrade-preview.ts';
import type { InventoryEntry } from '../contracts/item.ts';
import type { MerchantWork } from './work.ts';

interface Status { seenAt?: number; upgradePreviewSession?: string; upgradePreviewRevision?: string; items?: (InventoryEntry | null)[] }
export interface StoredUpgradePreview {result:UpgradePreviewResult;at:number;revision:string}
interface State {
  upgradePreviewResults?: Record<string,StoredUpgradePreview>;
  merchantCharacter?: string | null; statuses: Record<string, Status | undefined>;
  merchantCurrent: MerchantWork | null; merchantQueue: MerchantWork[];
}
interface Ports { persist(): void; dispatch(): void; stamp(job: MerchantWork): MerchantWork }

/** Jobs persist with merchant work; persisted results are read without scheduling more work. */
export function createUpgradePreviews(state: State, ports: Ports, now = Date.now) {
  const results = state.upgradePreviewResults ||= {};
  function request(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body), item = requestObject(body.item), executor = state.merchantCharacter || '';
    if (typeof item.name !== 'string' || !Number.isInteger(body.slot) || Number(body.slot) < 0 || Number(body.slot) > 41)
      return res.status(400).json({ error: 'Invalid preview item' });
    if (!executor || body.character !== executor || body.equipped)
      return res.status(400).json({error:'Item must be in merchant inventory'});
    const key = JSON.stringify([executor,body.slot,item]);
    const stored = results[key];
    const revision=state.statuses[executor]?.upgradePreviewRevision;
    const cached=stored && revision!==undefined && stored.revision===revision ? stored : undefined;
    const existing = [state.merchantCurrent,...state.merchantQueue].find(job=>job?.reason==='upgrade preview' && job.previewKey===key);
    if (existing) return res.json({status:existing===state.merchantCurrent?'running':'queued',jobId:existing.id,result:cached?.result});
    if (body.refresh !== true) return res.json({status:cached?'complete':stored?'invalidated':'idle',result:cached?.result});
    const live = state.statuses[executor]?.items?.find(entry=>entry?.slot===body.slot)?.item;
    if (!live || !Object.entries(item).every(([key,value])=>JSON.stringify(live[key])===JSON.stringify(value)))
      return res.status(409).json({error:'Item changed; reopen the menu'});
    const job = ports.stamp({id:'preview-'+randomUUID(),target:executor,reason:'upgrade preview',manual:true,
      queuedAt:now(),previewKey:key,upgradePreview:{slot:body.slot,item}});
    state.merchantQueue.push(job);ports.persist();ports.dispatch();
    return res.json({status:state.merchantCurrent?.id===job.id?'running':'queued',jobId:job.id,result:cached?.result});
  }
  function response(req: HttpRequest, res: HttpResponse) {
    const body=requestObject(req.body),job=state.merchantCurrent,executor=state.merchantCharacter || '';
    const wanted=requestObject(job?.upgradePreview),result=requestObject(body.result),options=requestObject(result.options);
    if (!job || job.reason!=='upgrade preview' || body.id!==job.id || body.commandId!==job.commandId ||
        typeof body.revision!=='string' || body.character!==executor || body.session!==state.statuses[executor]?.upgradePreviewSession ||
        result.executor!==executor || JSON.stringify(result.item)!==JSON.stringify(wanted.item) ||
        !previewOptions.every(option=>{
          const value=requestObject(options[option]),preview=requestObject(value.preview);
          return typeof value.reason==='string' || preview.calculate===true && typeof preview.chance==='number' &&
            Number.isFinite(preview.chance) && preview.chance>=0 && typeof value.observedAt==='number';
        })) return res.status(409).json({error:'Preview expired or changed'});
    results[String(job.previewKey)]={result:body.result as UpgradePreviewResult,at:now(),revision:body.revision as string};
    const oldest=Object.keys(results).sort((a,b)=>results[a]!.at-results[b]!.at);
    while(oldest.length>100)delete results[oldest.shift()!];
    ports.persist();
    return res.json({ok:true});
  }
  return {install(router:HttpRouter) {
    router.post('/party-api/upgrade-preview',request);
    router.post('/party-api/upgrade-preview/result',response);
  }};
}
