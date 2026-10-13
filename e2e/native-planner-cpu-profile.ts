import {type Frame,type CDPSession} from '@playwright/test';
// Passive, case-owned diagnostics. Poll callers supply the clock; no timers.
export function nativePlannerCpuProfile(frame:Frame){
  let session:CDPSession|undefined,used=false,startedAt=0,stopped=false;
  let pending:Promise<void>|undefined;
  const evidence:any={errors:[],probes:[]};
  const record=(error:unknown)=>{evidence.errors.push(String(error));};
  async function stop(){
    if(stopped||!session||!startedAt)return;
    stopped=true;
    try{
      evidence.after=await session.send('Performance.getMetrics');
      evidence.profile=(await session.send('Profiler.stop')).profile;
      evidence.stoppedAt=Date.now();
      for(const node of evidence.profile.nodes){const f=node.callFrame;if(f?.url)f.url=f.url.split(/[?#]/,1)[0];}
      const before=new Map<string,number>((evidence.before.metrics||[]).map((m:any)=>[m.name,m.value]));
      evidence.deltas=Object.fromEntries((evidence.after.metrics||[]).filter((m:any)=>['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].includes(m.name)).map((m:any)=>[m.name,m.value-(before.get(m.name)||0)]));
      const nodes=new Map<number,any>(evidence.profile.nodes.map((n:any)=>[n.id,n.callFrame]));
      const counts=new Map<number,number>();for(const id of evidence.profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
      evidence.dominant=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,samples])=>({samples,frame:nodes.get(id)}));
    }catch(error){record(error);}
    finally{await session.detach().catch(record);}
  }
  return {
    observe(sample:any){
      if(evidence.probes.length<3)evidence.probes.push(sample);
      if(sample?.error)record(sample.error);
      if(used||!sample?.active||sample?.nativeMoving||sample?.transporting||sample?.nativePlanning?.calls<8||!sample?.nativePlanning)return;
      used=true;evidence.trigger=sample;
      pending=(async()=>{
        try{
          session=await frame.page().context().newCDPSession(frame);
          await session.send('Performance.enable');await session.send('Profiler.enable');
          await session.send('Profiler.setSamplingInterval',{interval:10000});
          evidence.before=await session.send('Performance.getMetrics');
          await session.send('Profiler.start');startedAt=Date.now();evidence.startedAt=startedAt;
        }catch(error){record(error);await session?.detach().catch(record);session=undefined;}
      })();
    },
    poll(){if(startedAt&&!stopped&&Date.now()-startedAt>=10000&&!pending)pending=stop();},
    async settle(){if(pending){await pending;pending=undefined;}},
    async finish(){await this.settle();await stop();return evidence;},
  };
}
