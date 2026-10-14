import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, location } from './game/hunt-lifecycle';

// Failure inventory: e2e/monster-safety-reach-failures.md (#121, Icelocked's booboo
// party from #39). Declared inputs: two booboos (range 420) spawned side by side 390
// from the party, with damage zeroed and a long stun so they stay where a holding tank
// would keep them, both targeting the warrior. Target selection, formation movement,
// range and attacks are native.
const M = 'E2EBankBoi';
test.use({ loadout: 'combat-range', extraFighter: 'mage' });

test('a mage reaches its booboo while a second booboo attacks the warrior', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];

  try {
    expect(await live.clients[M].run('character.ctype')).toBe('mage');
    const mageRange = await live.clients[M].run('character.range');
    expect(mageRange, 'The mage must be outranged by a booboo').toBeLessThan(420);
    await live.post('/formation', { leader: W });
    for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.post('/focus', { character: W, monsterFocus: ['booboo'] });
    await live.post('/travel', await location(live));
    await expect.poll(async () => live.admin(`output=(()=>{const ps=${JSON.stringify([W, P, M])}.map(get_player);
      return ps.every(p=>p.map==='main'&&!p.moving)&&ps.every(p=>Math.hypot(p.x-ps[0].x,p.y-ps[0].y)<250);})()`), { timeout: 120_000 }).toBe(true);
    await live.admin(`output=(()=>{globalThis.__e2eMonsterReachOwned=[];return true;})()`);
    const spawned = await live.admin(`output=(()=>{const w=get_player('${W}'),ids=[];
      for(const dx of [-12,12]){const m=new_monster(w.in,{type:'booboo',position:[w.x+dx,w.y+390],radius:0,count:1},{temp:1});
        globalThis.__e2eMonsterReachOwned.push({id:String(m.id),in:m.in,map:m.map,type:m.type});
        m.hp=m.max_hp=5000000;m.attack=0;m.s.stunned={ms:600000};target_player(m,w);ids.push(String(m.id));}
      return ids;})()`);
    await info.attach('declared-booboos', { body: JSON.stringify({ spawned, mageRange }), contentType: 'application/json' });
    // The setup itself: the mage has to approach to reach either booboo.
    expect(await live.clients[M].run(`${JSON.stringify(spawned)}.every(id => !parent.entities[id] || !is_in_range(parent.entities[id]))`)).toBe(true);

    // 1: within a minute the mage is in native range of its booboo most of the time.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      samples.push(await live.clients[M].run(`(() => { const p = globalThis.partyCombatPosition, t = p && p.target && parent.entities[p.target];
        return { at: Date.now(), target: t && t.mtype, inRange: !!(t && is_in_range(t)), mode: p && p.mode, reason: p && p.reason,
          constraint: p && p.constraint }; })()`));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const booboo = samples.filter(s => s.target === 'booboo');
    expect(booboo.length, 'The party must select a booboo').toBeGreaterThan(30);
    expect(booboo.filter(s => s.inRange).length, 'The mage must spend most of the minute in range').toBeGreaterThan(booboo.length / 2);
  } finally {
    try {await info.attach('mage-reach-samples', { body: JSON.stringify(samples), contentType: 'application/json' });}
    finally {await live.admin(`output=(()=>{for(const entry of globalThis.__e2eMonsterReachOwned||[]){const m=instances[entry.in]?.monsters[entry.id];if(m&&m.type===entry.type&&m.map===entry.map)remove_monster(m,{method:'disappear',nospawn:true});}delete globalThis.__e2eMonsterReachOwned;return true;})()`);}
  }
});
