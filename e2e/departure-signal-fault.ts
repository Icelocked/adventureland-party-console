export function departureSignalFaultSource(character: string): string {
  return `(() => {
    if (!globalThis.$?.fn?.jquery || !globalThis.sharedRoutine?.queueClockOffset) throw Error('Native departure observer unavailable');
    if (globalThis.__e2eDepartureHook) throw Error('Native departure observer already installed');
    const hook = globalThis.__e2eDepartureHook = {enabled:true,signals:[],jquery:$.fn.jquery,generation:globalThis.__partyRuntimeGeneration};
    const blocked = globalThis.__e2eDepartureFaults = [];
    $(document).on('ajaxComplete.e2eDepartureFault', function(event,xhr,options) {
      if (!hook.enabled || hook.signals.length>=3 || options.type!=='POST') return;
      const url=new URL(options.url,location.href);
      if (!url.pathname.endsWith('/party-api/status')) return;
      let request=options.data;
      if (typeof request==='string') { try { request=JSON.parse(request); } catch { return; } }
      if (request?.name!==${JSON.stringify(character)} || xhr.status<200 || xhr.status>=300) return;
      const signal=xhr.responseJSON?.convoySignal;
      const offset=sharedRoutine.queueClockOffset();
      const now=()=>Date.now()+sharedRoutine.queueClockOffset();
      if (signal?.phase!=='scheduled' || !Number.isFinite(signal.epoch) || !Number.isFinite(signal.departAt) ||
          signal.departAt<now() || hook.signals.some(receipt=>receipt.epoch===signal.epoch)) return;
      const receipt={epoch:signal.epoch,departAt:signal.departAt,receivedAt:now(),clockOffset:offset,
        character:${JSON.stringify(character)},method:options.type,phase:signal.phase};
      hook.signals.push(receipt);
      setTimeout(()=>{
        if(!hook.enabled)return;
        const fault={epoch:signal.epoch,deadline:signal.departAt,startedAt:now(),endedAt:0};blocked.push(fault);
        while(now()<signal.departAt+2000){}
        fault.endedAt=now();
      },0);
    });
    return {jquery:hook.jquery,generation:hook.generation};
  })()`;
}
