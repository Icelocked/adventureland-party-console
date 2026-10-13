import type {Page,Request,Response} from '@playwright/test';
const paths=new Set(['/party-api/movement-barrier','/party-api/convoy-complete']);
const actors=new Set(['E2EWarrior','E2EPriest']);
/** Passive request/response observation; no interception, replay or new HTTP. */
export function observeNativeNavigationHttp(page:Page){
  const requests=new Map<Request,Record<string,unknown>>(),pending=new Set<Promise<void>>();
  const first:Record<string,unknown>[]=[],latest:Record<string,unknown>[]=[],errors:string[]=[];
  const counts:Record<string,number>={},aggregates=new Map<string,Record<string,any>>();let dropped=0,aggregateOverflow=0,closed=false;
  function retain(entry:Record<string,unknown>){if(first.length<32)first.push(entry);else{latest.push(entry);if(latest.length>64)latest.shift();}}
  function request(req:Request){
    try{
      const url=new URL(req.url());if(req.method()!=='POST'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!paths.has(url.pathname))return;
      const body=req.postDataJSON() as Record<string,any>;if(!actors.has(String(body.character)))return;
      const entry={at:Date.now(),endpoint:url.pathname,character:body.character,convoyId:body.convoyId,epoch:body.epoch,
        commandId:body.commandId,runtimeId:body.runtimeId,navigationRevision:body.navigationRevision,routeVersion:body.routeVersion,
        step:body.step,completed:body.completed,ready:body.ready,destination:body.destination?{
          map:body.destination.map,in:body.destination.in,x:body.destination.x,y:body.destination.y,town:body.destination.town,
          transport:body.destination.transport,s:body.destination.s,method:body.destination.method}:undefined};
      const identity=JSON.stringify([entry.endpoint,entry.character,entry.convoyId,entry.epoch,entry.commandId,entry.runtimeId,entry.navigationRevision,entry.routeVersion,entry.step,entry.completed,entry.destination]);
      let aggregate=aggregates.get(identity);
      if(!aggregate&&aggregates.size<64){aggregate={...entry,requests:0,readyTrue:0,readyFalse:0,responseErrors:0,failed:0,bodyUnavailable:0,firstAt:entry.at,lastAt:entry.at};aggregates.set(identity,aggregate);}
      if(aggregate){aggregate.requests++;aggregate.lastAt=entry.at;}else aggregateOverflow++;
      counts[url.pathname]=(counts[url.pathname]||0)+1;requests.set(req,{...entry,identity});
      if(requests.size>128){requests.delete(requests.keys().next().value!);dropped++;}
    }catch(error){if(errors.length<8)errors.push(String(error));}
  }
  function response(res:Response){
    const req=res.request(),entry=requests.get(req);if(!entry)return;requests.delete(req);
    if(pending.size>=8){dropped++;return;}
    const task=(async()=>{
      try{
        const value=await res.json(),aggregate=aggregates.get(String(entry.identity));
        if(aggregate){if(value.ready===true)aggregate.readyTrue++;if(value.ready===false)aggregate.readyFalse++;if(value.error)aggregate.responseErrors++;aggregate.lastResponseAt=Date.now();aggregate.lastStatus=res.status();aggregate.lastResponse={ready:value.ready,error:value.error,code:value.code,waiting:value.waiting};}
        retain({...entry,receivedAt:Date.now(),status:res.status(),response:{
          ready:value.ready,error:value.error,code:value.code,waiting:value.waiting,superseded:value.superseded}});
      }catch(error){const aggregate=aggregates.get(String(entry.identity));if(aggregate)aggregate.bodyUnavailable++;if(errors.length<8)errors.push(String(error));retain({...entry,receivedAt:Date.now(),status:res.status(),bodyUnavailable:true});}
    })();pending.add(task);void task.finally(()=>pending.delete(task));
  }
  function failed(req:Request){const entry=requests.get(req);if(!entry)return;requests.delete(req);const aggregate=aggregates.get(String(entry.identity));if(aggregate)aggregate.failed++;retain({...entry,failedAt:Date.now(),failure:req.failure()?.errorText});}
  page.on('request',request);page.on('response',response);page.on('requestfailed',failed);
  return {async finish(){if(!closed){closed=true;page.off('request',request);page.off('response',response);page.off('requestfailed',failed);}
    await Promise.allSettled([...pending]);return {counts,first,latest,aggregates:[...aggregates.values()],aggregateOverflow,pending:requests.size,dropped,errors};}};
}
