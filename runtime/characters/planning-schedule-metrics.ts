// Application diagnostics, not game state. Constant-memory, passive counters.
interface Timing { calls:number; first:number; last:number; total:number; min:number; max:number }
export function createPlanningScheduleMetrics() {
  const timing = ():Timing => ({calls:0,first:0,last:0,total:0,min:Infinity,max:0});
  const scheduler=timing(),plan=timing();
  let ownedCallbacks=0,blockedMoving=0,blockedTransporting=0,pausedCallbacks=0;
  function observe(sample:Timing) {
    const at=performance.now();
    if(sample.calls){const gap=Math.max(0,at-sample.last);sample.total+=gap;sample.min=Math.min(sample.min,gap);sample.max=Math.max(sample.max,gap);}
    else sample.first=at;
    sample.last=at;sample.calls++;
  }
  function snapshot(sample:Timing) {
    return {calls:sample.calls,elapsedMs:sample.calls?sample.last-sample.first:0,
      intervals:{minMs:sample.calls>1?sample.min:0,maxMs:sample.max,meanMs:sample.calls>1?sample.total/(sample.calls-1):0}};
  }
  return {
    scheduler(owner:boolean){observe(scheduler);if(owner)ownedCallbacks++;},
    plan(){observe(plan);},
    blockedMoving(){blockedMoving++;},blockedTransporting(){blockedTransporting++;},paused(){pausedCallbacks++;},
    report:()=>({scheduler:snapshot(scheduler),plan:snapshot(plan),ownedCallbacks,blockedMoving,blockedTransporting,pausedCallbacks}),
  };
}
