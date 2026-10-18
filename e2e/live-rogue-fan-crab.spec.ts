import { test, expect } from './live-fixtures';
import { location } from './game/hunt-lifecycle';

// Failure inventory: e2e/rogue-fan-crab-failures.md. The rogue (E2EWarrior seeded as a level-80
// rogue with the native Knife Belt) scatter farms native crabs alone, wearing Fiery Throwing Stars +7
// in both hands like the user's Fan farm set. Declared input: the two stars, written to the bag and
// equipped natively. Crabs, casts, potions and kills are native.
test.use({ primaryClass: 'rogue', loadout: 'combat-range' });
const R = 'E2EWarrior', P = 'E2EPriest';
const native = (live: any) => live.admin(`output=(()=>{const p=get_player('${R}');
  return {mp:p.mp,max_mp:p.max_mp,rip:p.rip,potions:p.items.filter(i=>i&&i.name==='mpot1').reduce((n,i)=>n+(i.q||1),0)};})()`);

test('a Knife Belt rogue with Fiery Throwing Stars fans crabs without basic attacks while it has the MP', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];
  let seen: any = null;
  try {
    expect(await live.clients[R].run('character.ctype')).toBe('rogue');
    expect(await live.clients[R].run('character.slots.belt?.name')).toBe('knifebelt');
    await live.admin(`output=(()=>{const p=get_player('${R}');for(const level of [7,7]){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name:'firestars',level};}
      cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    await expect.poll(async () => live.clients[R].run(`character.items.filter(i=>i&&i.name==='firestars').length`), { timeout: 30_000 }).toBe(2);
    for (const slot of ['mainhand', 'offhand']) {
      await live.clients[R].run(`(()=>{const i=character.items.findIndex(x=>x&&x.name==='firestars');equip(i,'${slot}');return true})()`);
      await expect.poll(async () => live.clients[R].run(`character.slots.${slot}?.name`), { timeout: 10_000 }).toBe('firestars');
    }
    // Passive observers: native actions with the rogue's MP, and every skill diagnostic.
    await live.clients[R].run(`(() => {
      const log = globalThis.__fanObserver = { actions: [], hits: [], diagnostics: [] };
      const cost = () => Math.ceil(G.skills.fanofknives.mp * (1 - Math.min(100, Math.max(0, character.mp_reduction || 0)) / 100));
      // At a basic attack, the state the attack controller and skill engine decided from.
      const why = target => { const e = parent.entities[target];
        return { cooldowns: { attack: Number(parent.next_skill?.attack) - Date.now(), fanofknives: Number(parent.next_skill?.fanofknives) - Date.now() }, combat: JSON.parse(JSON.stringify(globalThis.partyCombatState || {}, (k, v) => k === 'skill' || k === 'attackTiming' ? undefined : v)),
          target: e ? { hp: e.hp, max_hp: e.max_hp, level: e.level, target: e.target || null, dead: !!e.dead, d: Math.round(distance(character, e)) } : null }; };
      parent.socket.on('action', data => { if (data && data.attacker === character.name)
        log.actions.push({ at: Date.now(), type: data.type, target: data.target, mp: character.mp, cost: cost(), ...(data.type === 'attack' ? { why: why(data.target) } : {}) }); });
      parent.socket.on('hit', data => { if (data && data.hid === character.name)
        log.hits.push({ at: Date.now(), source: data.source, id: data.id, kill: !!data.kill }); });
      // The moment the client sends a basic attack is the decision; probe there too.
      log.sent = [];
      const emit = parent.socket.emit.bind(parent.socket);
      parent.socket.emit = (event, data, ...rest) => {
        if (event === 'attack' || event === 'skill' && data && data.name === 'fanofknives')
          log.sent.push({ at: Date.now(), event, id: data && (data.id || data.ids), mp: character.mp, ...(event === 'attack' ? { why: why(data && data.id) } : {}) });
        return emit(event, data, ...rest);
      };
      const state = globalThis.partyCombatState;
      let value = state.skill;
      Object.defineProperty(state, 'skill', { configurable: true, enumerable: true, get: () => value, set: d => {
        value = d; if (d && d.skill === 'fanofknives' && d.status !== 'selected')
          log.diagnostics.push({ at: Date.now(), status: d.status, reason: d.reason || null, mp: character.mp });
      } });
      return true; })()`);
    await live.post('/formation', { leader: R });
    await live.post('/formation', { character: P, follow: false });
    await live.post('/focus', { monsterFocus: ['crab'] });
    await live.post('/farming-mode', { character: R, mode: 'scatter' });
    await live.post('/travel', await location(live, 'crab'));
    await expect.poll(async () => live.clients[R].run("globalThis.__fanObserver.hits.length"),
      { timeout: 150_000, intervals: [1000], message: 'The rogue must attack native crabs' }).toBeGreaterThan(0);
    const before = await native(live), started = Date.now();
    while (Date.now() - started < 60_000) {
      samples.push({ at: Date.now(), native: await native(live), fanFarming: await live.clients[R].run('globalThis.sharedRoutine?.fanOfKnivesFarming?.() ?? null') });
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    const after = await native(live);
    seen = await live.clients[R].run(`(() => { const log = globalThis.__fanObserver, since = ${started};
      return { actions: log.actions.filter(a => a.at >= since), hits: log.hits.filter(h => h.at >= since),
        diagnostics: log.diagnostics.filter(d => d.at >= since), sent: log.sent.filter(d => d.at >= since) }; })()`);
    const fans = seen.actions.filter((a: any) => a.type === 'fanofknives').length;
    expect(before.potions - after.potions, 'The rogue must drink MP potions while fan farming').toBeGreaterThan(0);
    // 1: a basic attack is only the fallback below one cast's MP.
    expect(seen.actions.filter((a: any) => a.type === 'attack' && a.mp >= a.cost),
      'Basic attacks made with the MP for Fan of Knives').toEqual([]);
    // 2: no rejection other than the shared cooldown race.
    expect(seen.diagnostics.filter((d: any) => d.status === 'rejected' && d.reason !== 'cooldown'),
      'Fan of Knives rejections that lock it out').toEqual([]);
    // 3: no budget or reserve skips while potions remain.
    expect(seen.diagnostics.filter((d: any) => d.status === 'skipped' && /budget|reserved/.test(d.reason || '')),
      'Fan of Knives budget or reserve skips').toEqual([]);
    // 4, 5
    expect(fans, 'Fan of Knives must keep firing for the whole minute').toBeGreaterThanOrEqual(30);
    expect(after.rip).toBeFalsy();
  } finally {
    await info.attach('rogue-fan-crab', { body: JSON.stringify({ samples, observed: seen }), contentType: 'application/json' });
  }
});
