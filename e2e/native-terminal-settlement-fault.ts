import {expect,type Page,type Route,type Response} from '@playwright/test';
import type {LiveGame} from './live-fixtures';
const W='E2EWarrior',P='E2EPriest';
/** Declared one-shot transport failure; native sockets, ACKs, coordinates and routes remain untouched. */
export async function installTerminalSettlementFault(live:LiveGame,page:Page){
  const startedAt=Date.now();
  const transitionFlags=await Promise.all([W,P].map(async name=>({name,previous:await live.clients[name].frame.evaluate(()=>{const g=window as any,old=g.__e2eObserveTransitions;g.__e2eObserveTransitions=true;return old===true;})})));
  const context=page.context(),ledger:Record<string,any>[]=[];let owner:any,held:Route|undefined,release:(()=>void)|undefined,holdGate:Promise<void>|undefined;
  const pendingHolds=new Set<Promise<void>>(),samples:Record<string,unknown>[]=[];
  const forwardingErrors:string[]=[];let forwarded=0,acceptedObservations=0;
  let dropping=false,closed=false,peerReleased:any,receipt:any,nativeIssued:any,faultArmedAt:number|undefined,alignedNative:any,nativeAcknowledgement:any,nativeScatter:any;
  let arming:Promise<boolean>|undefined;
  async function nativeSnapshot(){
    return live.clients[W].frame.evaluate(startedAt=>{
      const g=window as any,r=g.document.getElementById('maincode')?.contentWindow,m=r?.__partyMovement,c=g.character,state=m?.state;
      const events=g.__e2eEvents||[],ack=events.filter((event:any)=>event.at>=startedAt&&event.event==='game_response'&&event.data?.success===true&&event.data?.place==='leave').at(-1);
      const scatter=events.filter((event:any)=>event.at>=startedAt&&event.event==='new_map'&&event.data?.name==='main').at(-1);
      return {active:m?.report?.(),last:m?.last?.(),goal:state?{map:state.map,in:state.in,x:state.x,y:state.y}:null,
        plot:state?.plot?.map((p:any)=>({map:p.map,in:p.in,x:p.x,y:p.y,town:p.town,transport:p.transport,s:p.s,method:p.method})),
        found:state?.found,moving:state?.moving,remaining:state?.plot?.length,paused:!!r?.__partyMovementPaused,
        native:c?{map:c.map,in:c.in,x:c.real_x,y:c.real_y,moving:c.moving,rip:c.rip,hp:c.hp}:null,ack,
        scatter:scatter?{sequence:scatter.sequence,at:scatter.at,event:scatter.event,data:{name:scatter.data.name,in:scatter.data.in,x:scatter.data.x,y:scatter.data.y,m:scatter.data.m}}:undefined};
    },startedAt);
  }
  async function armAfterAlignment(){
    if(faultArmedAt)return true;
    if(arming)return arming;
    arming=(async()=>{
      const sample=await nativeSnapshot();if(samples.length<32)samples.push({at:Date.now(),stage:'alignment-before-fault',...sample});
      const native=sample.native,current=sample.active;
      if(!owner || !pendingHolds.size || !current || current.id!==nativeIssued.report.id || current.progress?.phase!=='barrier' ||
        !['convoyId','epoch','commandId','navigationRevision','routeVersion'].every(key=>current.owner?.[key]===owner[key]) ||
        sample.remaining!==1 || sample.paused || !native || native.rip || !(native.hp>0) || native.moving ||
        !Number.isFinite(native.x)||!Number.isFinite(native.y)||native.map!=='main' || String(native.in??native.map)!=='main' ||
        Math.hypot(native.x-owner.destination.x,native.y-owner.destination.y)>1 || !sample.ack)return false;
      alignedNative=sample;nativeAcknowledgement=sample.ack;nativeScatter=sample.scatter;faultArmedAt=Date.now();dropping=true;
      ledger.push({at:faultArmedAt,action:'control-response-loss-armed-after-actual-native-alignment',native,acknowledgement:sample.ack,pendingCompletions:pendingHolds.size});return true;
    })();
    try{return await arming;}finally{arming=undefined;}
  }
  const body=(route:Route)=>{try{return route.request().postDataJSON();}catch{return null;}};
  function same(value:any){return owner && ['convoyId','epoch','commandId','navigationRevision','runtimeId','routeVersion'].every(key=>value?.[key]===owner[key]);}
  const status=async(route:Route)=>{
    const value=body(route);
    if(dropping && value?.name===W){
      try{
        const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:5000});
        if(!response.ok())throw Error('Actual status observation rejected with HTTP '+response.status());
        const result=await response.json();forwarded++;
        const sequence=value.travelSample?.sequence,actualReceipt=result.combatReportReceipt;
        if(value.combatWait!==true && (value.combatOnly===true ? actualReceipt?.sequence===sequence && Number.isFinite(actualReceipt?.receivedAt) : Number.isFinite(result.serverNow)))acceptedObservations++;
        if(ledger.length<128)ledger.push({at:Date.now(),action:'genuine-status-forwarded-response-discarded',name:W,status:response.status(),
          sequence:value.travelSample?.sequence,kind:value.combatOnly?'report':value.combatWait?'wait':'full',serverNow:result.serverNow,
          receipt:actualReceipt?{sequence:actualReceipt.sequence,receivedAt:actualReceipt.receivedAt,evaluatedAt:actualReceipt.evaluatedAt}:undefined});
      }catch(error){if(forwardingErrors.length<8)forwardingErrors.push(String(error));}
      await route.abort('failed');
    }else await route.fallback();
  };
  const barrier=async(route:Route)=>{
    const value=body(route);
    if(!owner && value?.character===W && value.completed===false && value.destination?.method==='leave' && value.destination.map==='main'){
      const began=Date.now();
      const sample=await nativeSnapshot(),actual={...sample,report:sample.active};
      const last=actual.plot?.[0],goal=actual.goal,current=actual.report?.owner;
      const final=actual.plot?.length===1 && last?.method==='leave' && last.map==='main' &&
        (['map','x','y'] as const).every(key=>last[key]===value.destination[key] && goal?.[key]===last[key]) &&
        ['convoyId','epoch','commandId','navigationRevision','routeVersion'].every(key=>current?.[key]===value[key]);
      if(!final){if(ledger.length<128)ledger.push({at:Date.now(),action:'intermediate-leave-not-faulted',actual});await route.fallback();return;}
      const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:5000}),result=await response.json();
      if(response.ok() && result.ready===true && !owner){
        owner={...value};nativeIssued=actual;holdGate=new Promise<void>(resolve=>{release=resolve;});
        ledger.push({at:Date.now(),action:'genuine-final-pre-barrier-released-response-delivered',began,owner,response:{status:response.status(),ready:result.ready}});
      }
      await route.fulfill({response});
    }else if(owner && value?.character===W && value.completed===true && same(value)){
      held=route;ledger.push({at:Date.now(),action:'completion-held-unforwarded'});
      const task=(async()=>{await holdGate;try{await route.abort('failed');ledger.push({at:Date.now(),action:'completion-aborted-without-forwarding'});}finally{if(held===route)held=undefined;}})();
      pendingHolds.add(task);try{try{await armAfterAlignment();}catch(error){if(ledger.length<128)ledger.push({at:Date.now(),action:'alignment-read-failed',error:String(error)});}await task;}finally{pendingHolds.delete(task);}
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
    void res.json().then(result=>{if(result.ready===true){peerReleased={at:Date.now(),proofPath:'coordinator-barrier-reconciliation',request:value,response:result};ledger.push({action:'actual-peer-completion-released',...peerReleased});}},()=>{});
  };
  async function independentlySettledPeer(){
    if(!receipt)return false;
    const actual=await live.clients[P].frame.evaluate(()=>{const g=window as any,r=g.document.getElementById('maincode')?.contentWindow,m=r?.__partyMovement,c=g.character;
      return {active:m?.report?.(),last:m?.last?.(),native:c?{map:c.map,in:c.in,x:c.real_x,y:c.real_y,moving:c.moving,rip:c.rip,hp:c.hp}:null};});
    // Observe coordinator ownership after the native read, so an intervening retirement cannot certify an old peer.
    const state=await live.state(),convoy=state.activeConvoy,member=state.characters[P],expected=convoy?.expected?.[P];
    if(!convoy || convoy.id!==owner.convoyId || convoy.epoch!==owner.epoch || convoy.routeVersion!==owner.routeVersion ||
      convoy.routeServer!==receipt.terminalSettlement.server || !convoy.completed?.includes(P) || !expected ||
      !['map','x','y'].every(key=>convoy.location?.[key]===owner.destination[key]) ||
      member?.combatSelection?.runtimeId!==expected.runtimeId || member?.lastCommandId!==expected.commandId)return false;
    const movement=actual.last,proof=movement?.terminalSettlement,native=actual.native,geometry=receipt.terminalSettlement.geometry;
    if(actual.active || movement?.done!==true || !proof || proof.acknowledged!==true || !proof.journeyId || movement.id!==proof.journeyId ||
      proof.convoyId!==owner.convoyId || proof.epoch!==owner.epoch || proof.routeVersion!==owner.routeVersion ||
      proof.commandId!==expected.commandId || proof.navigationRevision!==expected.revision || proof.runtimeId!==expected.runtimeId ||
      proof.step!==owner.step || !['map','in','x','y','method'].every(key=>proof.destination?.[key]===owner.destination[key]) ||
      !['version','fingerprint'].every(key=>proof.geometry?.[key]===geometry?.[key]) || proof.server!==receipt.terminalSettlement.server ||
      !native || native.rip || !Number.isFinite(native.hp) || !(native.hp>0) || native.moving || native.map!==owner.destination.map ||
      !Number.isFinite(native.x) || !Number.isFinite(native.y) ||
      String(native.in??native.map)!==String(owner.destination.in??owner.destination.map) ||
      Math.hypot(native.x-owner.destination.x,native.y-owner.destination.y)>1)return false;
    peerReleased={at:Date.now(),proofPath:'peer-independently-settled',coordinator:{convoyId:convoy.id,epoch:convoy.epoch,routeVersion:convoy.routeVersion,routeServer:convoy.routeServer,location:convoy.location,expected,completed:convoy.completed},actual};
    ledger.push({action:'actual-peer-independently-settled',...peerReleased});return true;
  }
  await context.route('**/party-api/status',status);await context.route('**/party-api/movement-barrier',barrier);
  await context.route('**/party-api/convoy-complete',complete);page.on('response',response);
  return {
    async prove(deadline:number){
      await expect.poll(()=>!!owner&&!!nativeIssued,{timeout:Math.max(1,deadline-Date.now()),message:'Fault must deliver the genuinely released native final leave pre-barrier'}).toBe(true);
      await expect.poll(armAfterAlignment,{intervals:[50,100],timeout:Math.max(1,deadline-Date.now()),message:'Only a genuine held completion POST and acknowledged stopped owned native endpoint may arm response loss'}).toBe(true);
      try{
        await expect.poll(async()=>{
          const sample=await nativeSnapshot();
          if(samples.length<32)samples.push({at:Date.now(),...sample});const value=sample.last;
          if(value?.done!==true || !value.terminalSettlement)return false;
          const proof=value.terminalSettlement;
          if(!same(proof)||proof.step!==owner.step||proof.destination?.method!=='leave'||proof.destination.map!=='main')return false;
          receipt=value;return true;
        },{timeout:Math.min(10_000,Math.max(1,deadline-Date.now())),message:'A genuine acknowledged terminal settlement must replace the undelivered completion POST'}).toBe(true);
      }finally{dropping=false;release?.();}
      await expect.poll(async()=>!!peerReleased || await independentlySettledPeer(),{timeout:Math.min(20_000,Math.max(1,deadline-Date.now())),message:'The peer must genuinely finish through its matching barrier or independently acknowledged terminal settlement before Warrior completion'}).toBe(true);
      expect(acceptedObservations,'The coordinator must accept genuine full or combatOnly native observations while their actual control responses are lost').toBeGreaterThan(0);
      expect(forwardingErrors,'The declared fault must not become a missing-observation transport failure').toEqual([]);
      const nativeEvents=await live.clients[W].events();
      const windowEvents=nativeEvents.filter((event:any)=>event.at>=startedAt&&event.at<=peerReleased.at);
      const issued=windowEvents.filter((event:any)=>event.event==='leave-issued'&&event.data?.actor===W);
      const acknowledgements=windowEvents.filter((event:any)=>event.event==='game_response'&&event.data?.success===true&&event.data?.place==='leave');
      expect(issued,'Only one real native leave may be issued during the faulted exit').toHaveLength(1);
      expect(acknowledgements,'Only one actual successful native leave acknowledgement may complete the exit').toHaveLength(1);
      expect(['convoyId','epoch','commandId','navigationRevision','routeVersion'].every(key=>issued[0].data.owner?.[key]===owner[key])).toBe(true);
      return {startedAt,owner,nativeIssued,faultArmedAt,alignedNative,nativeAcknowledgement,nativeScatter,receipt,peerReleased,ledger,samples,forwarded,acceptedObservations,forwardingErrors,issued,acknowledgements,nativeEvents};
    },
    async finish(){if(!closed){closed=true;dropping=false;release?.();await Promise.allSettled([...pendingHolds]);page.off('response',response);
      await context.unroute('**/party-api/status',status);await context.unroute('**/party-api/movement-barrier',barrier);await context.unroute('**/party-api/convoy-complete',complete);
      await Promise.all(transitionFlags.map(async value=>live.clients[value.name].frame.evaluate(previous=>{(window as any).__e2eObserveTransitions=previous;},value.previous)));}
      return {owner,nativeIssued,faultArmedAt,alignedNative,nativeAcknowledgement,nativeScatter,receipt,peerReleased,ledger,samples,forwarded,acceptedObservations,forwardingErrors,pendingHeld:!!held};}
  };
}
