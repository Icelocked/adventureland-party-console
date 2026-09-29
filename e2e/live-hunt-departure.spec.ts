import {test, expect} from './live-fixtures';
import {warrior as W, fighters, party, world, artifact} from './game/hunt-lifecycle';

// Fault boundary: a native browser event-loop stall, not fabricated game movement,
// command acknowledgement or a replacement coordinator response.
test('three delayed native departures preserve walking recovery budget and reach the destination', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+450*Math.cos(a),y=character.real_y+450*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  const faults: unknown[] = [];
  await live.post('/travel',destination);
  let previousEpoch = -1;
  for(let index=0;index<3;index++) {
    let convoy: any;
    await expect.poll(async () => {
      convoy = (await live.state()).activeConvoy;
      return convoy?.phase==='scheduled' && convoy.epoch!==previousEpoch && convoy.departAt>Date.now()+300;
    }, {timeout:60_000,intervals:[50,100],message:'A fresh native departure must become scheduled'}).toBe(true);
    previousEpoch = convoy.epoch;
    const fault = {epoch:convoy.epoch,departAt:convoy.departAt,stallMs:1200};
    faults.push(fault);
    await live.clients[W].frame.evaluate(({departAt,stallMs}) => {
      const game = window as any;
      setTimeout(() => {
        const started=Date.now();
        while(Date.now()-started<stallMs) { /* Deliberate bounded scheduler fault. */ }
        (game.__e2eDepartureStalls ||= []).push({started,ended:Date.now(),departAt});
      },Math.max(0,departAt-Date.now()-100));
    },fault);
    await expect.poll(async () => {
      const current = (await live.state()).activeConvoy;
      return current?.epoch!==previousEpoch || current?.phase==='failed';
    }, {timeout:20_000}).toBe(true);
    expect((await live.state()).activeConvoy?.recoveryAttempts || 0,'Late readiness does not spend physical route retries').toBe(0);
  }
  await expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => current[name].map===destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
  }, {timeout:90_000}).toBe(true);
  const observedStalls = await live.clients[W].frame.evaluate(() => (window as any).__e2eDepartureStalls);
  expect(observedStalls).toHaveLength(3);
  await artifact(live,info,'native-delayed-departures',{faults,observedStalls,destination});
});
