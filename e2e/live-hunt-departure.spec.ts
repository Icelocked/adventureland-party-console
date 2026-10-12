import {test, expect} from './live-fixtures';
import {warrior as W, fighters, party, world, artifact} from './game/hunt-lifecycle';

// Stall native execution without fabricating movement or acknowledgements.
// Install before travel so fault injection does not race a short departure window.
test('three delayed native departure signals preserve walking recovery budget and reach the destination', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+450*Math.cos(a),y=character.real_y+450*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  const faults: {epoch:number;departAt:number;receivedAt:number;forwardedAt?:number}[] = [];
  const context = live.clients[W].page.context();
  await context.route('**/party-api/status', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.name !== W) return route.fallback();
    const response = await route.fetch(), body = await response.json(), signal = body.convoySignal;
    if (signal?.phase === 'scheduled' && faults.length < 3 && !faults.some(fault => fault.epoch === signal.epoch)) {
      const fault = {epoch:signal.epoch,departAt:signal.departAt,receivedAt:Date.now(),forwardedAt:undefined as number|undefined};
      faults.push(fault);
      // Delaying the response itself also shifts the client's clock estimate and
      // may not miss departure. Block its actual event loop at the deadline.
      await live.clients[W].run(`(()=>{
        const epoch=${signal.epoch},deadline=${signal.departAt};
        const now=()=>Date.now()+sharedRoutine.queueClockOffset();
        const receipts=globalThis.__e2eDepartureFaults ||= [];
        setTimeout(()=>{
          const receipt={epoch,deadline,startedAt:now(),endedAt:0};receipts.push(receipt);
          while(now()<deadline+2000){}
          receipt.endedAt=now();
        // A hidden native frame may dispatch timers a second late. Begin while
        // the scheduled deadline is still ahead, rather than relying on 100ms
        // timer precision; the receipt still proves a real cross-deadline stall.
        },0);
      })()`);
      fault.forwardedAt = Date.now();
    }
    await route.fulfill({response});
  });
  let maxRecoveryAttempts = 0;
  try {
    await live.post('/travel',destination);
    await expect.poll(async () => {
      const convoy = (await live.state()).activeConvoy;
      maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
      const blocked=await live.clients[W].run('globalThis.__e2eDepartureFaults || []');
      return blocked.filter((fault:{deadline:number;startedAt:number;endedAt:number})=>
        fault.startedAt<=fault.deadline && fault.endedAt>=fault.deadline+1500).length;
    }, {timeout:120_000,message:'Three genuine scheduled departure signals must be delayed beyond their deadlines'}).toBe(3);
    await expect.poll(async () => {
      const current = await world(live), convoy = (await live.state()).activeConvoy;
      maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
      return fighters.every(name => current[name].map===destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
    }, {timeout:90_000}).toBe(true);
    expect(maxRecoveryAttempts,'Delayed readiness must not spend physical route retries').toBe(0);
    await artifact(live,info,'native-delayed-departures',{faults,maxRecoveryAttempts,destination});
  } finally {
    await context.unroute('**/party-api/status');
    const blocked=await live.clients[W].run('globalThis.__e2eDepartureFaults || []');
    await info.attach('native-departure-response-delays',{body:JSON.stringify({responses:faults,blocked}),contentType:'application/json'});
  }
});
