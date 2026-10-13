import {expect,type Page,type Route,type Response} from '@playwright/test';
import type {LiveGame} from './live-fixtures';
const W='E2EWarrior',P='E2EPriest';
/** Declared one-shot transport failure; native sockets, ACKs, coordinates and routes remain untouched. */
export async function installTerminalSettlementFault(live:LiveGame,page:Page){
  const startedAt=Date.now();
  const transitionFlags=await Promise.all([W,P].map(async name=>({name,previous:await live.clients[name].frame.evaluate(()=>{const g=window as any,old=g.__e2eObserveTransitions;g.__e2eObserveTransitions=true;return old===true;})})));
  const context=page.context(),ledger:Record<string,any>[]=[];let owner:any,held:Route|undefined,release:(()=>void)|undefined,holdGate:Promise<void>|undefined;
  const pendingHolds=new Set<Promise<void>>(),samples:Record<string,unknown>[]=[];
  let dropping=false,closed=false,peerReleased:any,receipt:any,nativeIssued:any;
  const body=(route:Route)=>{try{return route.request().postDataJSON();}catch{return null;}};
  function same(value:any){return owner && ['convoyId','epoch','commandId','navigationRevision','runtimeId','routeVersion'].every(key=>value?.[key]===owner[key]);}
  const status=async(route:Route)=>{
    if(dropping && body(route)?.name===W){if(ledger.length<128)ledger.push({at:Date.now(),action:'status-aborted',name:W});await route.abort('failed');}
    else await route.fallback();
  };
  const barrier=async(route:Route)=>{
    const value=body(route);
    if(!owner && value?.character===W && value.completed===true && value.destination?.method==='leave' && value.destination.map==='main'){
      owner={...value};dropping=true;holdGate=new Promise<void>(resolve=>{release=resolve;});
      ledger.push({at:Date.now(),action:'armed-candidate-status-drop',owner});
      const actual=await live.clients[W].run(`(()=>{const m=globalThis.__partyMovement,r=m?.report?.(),s=m?.state,c=character;return {report:r?{id:r.id,owner:r.owner}:null,
        goal:s?{map:s.map,in:s.in,x:s.x,y:s.y}:null,plot:s?.plot?.map(p=>({map:p.map,in:p.in,x:p.x,y:p.y,town:p.town,transport:p.transport,s:p.s,method:p.method})),
        native:{map:c.map,in:c.in,x:c.real_x,y:c.real_y,rip:c.rip,moving:c.moving}}})()`);
      const last=actual.plot?.[0],goal=actual.goal,current=actual.report?.owner;
      const final=actual.plot?.length===1 && last?.method==='leave' && last.map==='main' &&
        ['map','x','y'].every(key=>last[key]===value.destination[key] && goal?.[key]===last[key]) &&
        ['convoyId','epoch','commandId','navigationRevision','routeVersion'].every(key=>current?.[key]===value[key]);
      if(!final){dropping=false;owner=undefined;release?.();if(ledger.length<128)ledger.push({at:Date.now(),action:'intermediate-leave-not-faulted',actual});await route.fallback();return;}
      nativeIssued=actual;held=route;ledger.push({at:Date.now(),action:'held-unforwarded-final-completion',owner});
      const task=(async()=>{await holdGate;try{await route.abort('failed');ledger.push({at:Date.now(),action:'completion-aborted-without-forwarding'});}finally{held=undefined;}})();
      pendingHolds.add(task);try{await task;}finally{pendingHolds.delete(task);}
    }else if(owner && value?.character===W && value.completed===true && same(value)){
      ledger.push({at:Date.now(),action:'duplicate-completion-held-unforwarded'});
      const task=(async()=>{await holdGate;if(owner)await route.abort('failed');else await route.fallback();})();
      pendingHolds.add(task);try{await task;}finally{pendingHolds.delete(task);}
    }else await route.fallback();
  };
  const complete=async(route:Route)=>{
    const value=body(route);
    if(owner && !peerReleased && value?.character===W && same(value)){
      if(ledger.length<128)ledger.push({at:Date.now(),action:'convoy-complete-aborted-before-peer-release'});await route.abort('failed');
    }else await route.fallback();
  };
  const response=(res:Response)=>{
    if(!owner || !res.url().endsWith('/party-api/movement-barrier'))return;
    const value=res.request().postDataJSON();
    if(value?.character!==P || value.completed!==true || value.convoyId!==owner.convoyId || value.epoch!==owner.epoch || value.routeVersion!==owner.routeVersion || value.step!==owner.step || JSON.stringify(value.destination)!==JSON.stringify(owner.destination))return;
    void res.json().then(result=>{if(result.ready===true){peerReleased={at:Date.now(),request:value,response:result};ledger.push({action:'actual-peer-completion-released',...peerReleased});}},()=>{});
  };
  await context.route('**/party-api/status',status);await context.route('**/party-api/movement-barrier',barrier);
  await context.route('**/party-api/convoy-complete',complete);page.on('response',response);
  return {
    async prove(deadline:number){
      await expect.poll(()=>!!owner&&!!nativeIssued,{timeout:Math.max(1,deadline-Date.now()),message:'Fault must capture the actual completed native final leave request'}).toBe(true);
      try{
        await expect.poll(async()=>{
          const sample=await live.clients[W].run(`(()=>{const m=globalThis.__partyMovement,c=character;return {active:m?.report?.(),last:m?.last?.(),found:m?.state?.found,moving:m?.state?.moving,remaining:m?.state?.plot?.length,paused:!!globalThis.__partyMovementPaused,native:{map:c.map,in:c.in,x:c.real_x,y:c.real_y,moving:c.moving,rip:c.rip}}})()`);
          if(samples.length<32)samples.push({at:Date.now(),...sample});const value=sample.last;
          if(value?.done!==true || !value.terminalSettlement)return false;
          const proof=value.terminalSettlement;
          if(!same(proof)||proof.step!==owner.step||proof.destination?.method!=='leave'||proof.destination.map!=='main')return false;
          receipt=value;return true;
        },{timeout:Math.min(10_000,Math.max(1,deadline-Date.now())),message:'A genuine acknowledged terminal settlement must replace the undelivered completion POST'}).toBe(true);
      }finally{dropping=false;release?.();}
      await expect.poll(()=>!!peerReleased,{timeout:Math.min(20_000,Math.max(1,deadline-Date.now())),message:'Fresh native terminal receipt must release the actual peer barrier before Warrior convoy completion'}).toBe(true);
      const nativeEvents=await live.clients[W].events();
      const windowEvents=nativeEvents.filter((event:any)=>event.at>=startedAt&&event.at<=peerReleased.at);
      const issued=windowEvents.filter((event:any)=>event.event==='leave-issued'&&event.data?.actor===W);
      const acknowledgements=windowEvents.filter((event:any)=>event.event==='game_response'&&event.data?.success===true&&event.data?.place==='leave');
      expect(issued,'Only one real native leave may be issued during the faulted exit').toHaveLength(1);
      expect(acknowledgements,'Only one actual successful native leave acknowledgement may complete the exit').toHaveLength(1);
      expect(['convoyId','epoch','commandId','navigationRevision','routeVersion'].every(key=>issued[0].data.owner?.[key]===owner[key])).toBe(true);
      return {startedAt,owner,nativeIssued,receipt,peerReleased,ledger,samples,issued,acknowledgements,nativeEvents};
    },
    async finish(){if(!closed){closed=true;dropping=false;release?.();await Promise.allSettled([...pendingHolds]);page.off('response',response);
      await context.unroute('**/party-api/status',status);await context.unroute('**/party-api/movement-barrier',barrier);await context.unroute('**/party-api/convoy-complete',complete);
      await Promise.all(transitionFlags.map(async value=>live.clients[value.name].frame.evaluate(previous=>{(window as any).__e2eObserveTransitions=previous;},value.previous)));}
      return {owner,nativeIssued,receipt,peerReleased,ledger,samples,pendingHeld:!!held};}
  };
}
