import { test, expect, type LiveGame } from './live-fixtures';
import { W, P } from './game/hunt-events';

// Failure inventory: e2e/gear-sets-failures.md (16-18). Declared inputs: the luck pieces in
// the tank's bag and one stationary, harmless 5M HP goo attacking the tank. The tank is
// left wearing its luck set with no swap in progress, as after a client restart; the
// correction, the fight and every equip are native.
const LUCK: Record<string, string> = { ring1: 'ringofluck', ring2: 'ringofluck', earring1: 'mearring', earring2: 'mearring', orb: 'rabbitsfoot', amulet: 'spookyamulet' };
const SLOTS = Object.keys(LUCK);
const worn = (live: LiveGame) => live.clients[W].run(`(${JSON.stringify(SLOTS)}).reduce((out,slot)=>{out[slot]=character.slots[slot]?character.slots[slot].name:null;return out},{})`);
async function equipBy(live: LiveGame, wanted: Record<string, string | null>) {
  for (const [slot, name] of Object.entries(wanted)) {
    if (!name) continue;
    await live.clients[W].run(`(()=>{const i=character.items.findIndex(item=>item&&item.name===${JSON.stringify(name)});if(i<0)throw Error('missing ${name}');equip(i,${JSON.stringify(slot)});return true})()`);
    await expect.poll(async () => (await worn(live))[slot], { timeout: 10_000 }).toBe(name);
  }
}

test('a tank left in its luck set returns to its tank set at the start of a long fight', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];
  let goo = '';
  try {
    await live.post('/formation', { leader: W, tank: W });
    await live.post('/formation', { character: P, follow: true });
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
      for(const name of ['ringofluck','ringofluck','mearring','mearring','rabbitsfoot','spookyamulet']){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name,level:0};}
      cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    await expect.poll(async () => live.clients[W].run(`character.items.filter(i=>i&&i.name==='ringofluck').length`), { timeout: 30_000 }).toBe(2);
    const tankWorn = await worn(live);
    await expect.poll(async () => (await live.post('/gear-sets', { character: W, set: 'tank', action: 'save' }).catch(() => ({}))).ok, { timeout: 30_000 }).toBe(true);
    await equipBy(live, LUCK);
    await expect.poll(async () => { const slots = (await live.state()).characters[W]?.slots || {};
      return SLOTS.every(slot => slots[slot]?.item?.name === LUCK[slot]); }, { timeout: 15_000 }).toBe(true);
    expect((await live.post('/gear-sets', { character: W, set: 'luck', action: 'save' })).ok).toBe(true);
    // 16: still in the luck set, no swap session: the state a client restart leaves behind.
    expect(await live.clients[W].run('!(parent.__partyKillLuckSwap && parent.__partyKillLuckSwap.session)')).toBe(true);
    goo = await live.admin(`output=(()=>{const t=get_player(${JSON.stringify(W)});
      const m=new_monster(t.in,{type:'goo',position:[t.x+40,t.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=5000000;m.attack=0;m.speed=0;target_player(m,t);return String(m.id);})()`);
    const deadline = Date.now() + 45_000;
    let restored = false;
    while (Date.now() < deadline && !restored) {
      const sample = { at: Date.now(), worn: await worn(live), hp: await live.admin(`output=(()=>{const m=Object.values(instances.main.monsters).find(m=>String(m.id)===${JSON.stringify(goo)});return m?m.hp:null;})()`) };
      samples.push(sample);
      restored = SLOTS.every(slot => sample.worn[slot] === tankWorn[slot]);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // 16, 17: the tank set is back, empty slots emptied, while the long fight continues.
    expect(restored, 'The tank set must return during the fight').toBe(true);
    const hp = samples.at(-1)!.hp;
    expect(hp, 'The fight must be under way and far from a kill').toBeGreaterThan(4_000_000);
    expect(hp).toBeLessThan(5_000_000);
  } finally {
    await info.attach('gear-set-recovery-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    if (goo) await live.admin(`output=(()=>{const m=Object.values(instances.main.monsters).find(m=>String(m.id)===${JSON.stringify(goo)});if(m)remove_monster(m,{silent:true});return true;})()`).catch(() => {});
  }
});
