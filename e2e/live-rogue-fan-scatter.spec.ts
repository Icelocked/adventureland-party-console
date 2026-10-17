import { test, expect } from './live-fixtures';
import { location } from './game/hunt-lifecycle';

// Failure inventory: e2e/rogue-fan-scatter-failures.md. The rogue (E2EWarrior seeded as a
// level-80 rogue with the native Knife Belt) scatter farms native Goos, which Fan of
// Knives kills outright. The fixture's native inventory already carries mpot1. Casts,
// potions, regeneration and kills are native. The level-zero weapon keeps the rogue's
// native melee range: a +100 claw reaches past Fan of Knives' 160.
test.use({ primaryClass: 'rogue', loadout: 'combat-range' });
const R = 'E2EWarrior', P = 'E2EPriest';
type Live = { admin(code: string): Promise<any>; post(path: string, body: unknown): Promise<any>;
  clients: Record<string, { run(code: string): Promise<any> }> } & Parameters<typeof location>[0];
const native = (live: Live) => live.admin(`output=(()=>{const p=get_player('${R}');
  return {mp:p.mp,max_mp:p.max_mp,hp:p.hp,max_hp:p.max_hp,rip:p.rip,potions:p.items.filter(i=>i&&i.name==='mpot1').reduce((n,i)=>n+(i.q||1),0)};})()`);

// Passive observers: native action and hit broadcasts and the combat skill diagnostics.
async function observe(live: Live) {
  expect(await live.clients[R].run('character.ctype')).toBe('rogue');
  expect(await live.clients[R].run("character.slots.belt?.name")).toBe('knifebelt');
  await live.clients[R].run(`(() => {
    const log = globalThis.__fanObserver = { actions: [], hits: [], skips: [], casts: [] };
    parent.socket.on('action', data => { if (data && data.attacker === character.name)
      log.actions.push({ at: Date.now(), type: data.type, target: data.target }); });
    parent.socket.on('hit', data => { if (data && data.hid === character.name) { const e = parent.entities[data.id];
      log.hits.push({ at: Date.now(), source: data.source, id: data.id, kill: !!data.kill,
        distance: e ? Math.round(distance(character, e)) : null }); } });
    const state = globalThis.partyCombatState;
    let value = state.skill;
    Object.defineProperty(state, 'skill', { configurable: true, enumerable: true, get: () => value, set: d => {
      value = d; if (d && d.status === 'skipped') log.skips.push({ at: Date.now(), skill: d.skill, reason: d.reason, mp: character.mp });
      if (d && d.status === 'accepted') log.casts.push({ at: Date.now(), skill: d.skill, targets: d.targets.length });
    } });
    return true; })()`);
}
async function scatter(live: Live) {
  await live.post('/formation', { leader: R });
  await live.post('/formation', { character: P, follow: false });
  await live.post('/focus', { monsterFocus: ['goo'] });
  await live.post('/farming-mode', { character: R, mode: 'scatter' });
  await live.post('/travel', await location(live));
}
const observed = (live: Live, since: number) => live.clients[R].run(`(() => { const log = globalThis.__fanObserver, since = ${since};
  return { actions: log.actions.filter(a => a.at >= since), hits: log.hits.filter(h => h.at >= since),
    skips: log.skips.filter(s => s.at >= since), casts: log.casts.filter(c => c.at >= since) }; })()`);
const sample = (live: Live) => live.clients[R].run(`(() => {
  const shared = globalThis.sharedRoutine, context = shared?.combatContext?.(), p = globalThis.partyCombatPosition;
  return { mode: context?.mode, fanFarming: shared?.fanOfKnivesFarming?.() ?? null, range: character.range,
    position: p && { mode: p.mode, distance: p.distance && Math.round(p.distance), target: p.target },
    goos: Object.values(parent.entities).filter(e => e.type === 'monster' && e.mtype === 'goo' && distance(character, e) < 200)
      .map(e => ({ id: e.id, d: Math.round(distance(character, e)) })) }; })()`);

test('a Knife Belt rogue sustains Fan of Knives with MP potions while scatter farming one-shot mobs', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];
  let seen: any = null;
  try {
    await observe(live);
    await scatter(live);
    // The rogue reaches the Goos and starts killing them.
    await expect.poll(async () => live.clients[R].run("globalThis.__fanObserver.hits.length"),
      { timeout: 120_000, intervals: [1000], message: 'The rogue must attack native Goos' }).toBeGreaterThan(0);
    const before = await native(live), started = Date.now();
    // 1, 2, 3: observe one minute of scatter farming after the first attack.
    while (Date.now() - started < 60_000) {
      samples.push({ at: Date.now(), native: await native(live), client: await sample(live) });
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    const after = await native(live);
    seen = await observed(live, started);
    // The native action broadcast reports one entry per Fan of Knives target.
    const count = (type: string) => seen.actions.filter((a: any) => a.type === type).length;
    expect(seen.actions.length, 'The native action broadcast must report the rogue\'s attacks').toBeGreaterThan(0);
    // 1: MP potions refill the Fan of Knives MP.
    expect(before.potions - after.potions, 'The rogue must drink MP potions while Fan of Knives one-shots').toBeGreaterThan(0);
    // 2: Fan of Knives is never held back by the farming budget while potions remain.
    expect(seen.skips.filter((s: any) => s.skill === 'fanofknives' && s.reason === 'sustained farming MP budget'),
      'Fan of Knives must not be throttled by the sustained farming MP budget').toEqual([]);
    // 3: no single-target damage skills compete for the Fan of Knives MP on one-shot mobs.
    expect({ quickstab: count('quickstab'), quickpunch: count('quickpunch'), mentalburst: count('mentalburst') },
      'Single-target skills must not spend MP Fan of Knives needs').toEqual({ quickstab: 0, quickpunch: 0, mentalburst: 0 });
    expect(count('fanofknives'), 'Fan of Knives must keep firing for the whole minute').toBeGreaterThanOrEqual(30);
    // 7: no Assassin's Smoke opener: its 1.25x sneak bonus is overkill on one-shot mobs.
    expect(seen.casts.filter((c: any) => c.skill === 'invis'), 'The rogue must not go invisible before one-shot kills').toEqual([]);
    // 5: extra targets are authorized: each Fan of Knives averages several Goos.
    const fanCasts = seen.casts.filter((c: any) => c.skill === 'fanofknives').length;
    expect(seen.hits.filter((h: any) => h.source === 'fanofknives').length / Math.max(1, fanCasts),
      'Each Fan of Knives must average at least 1.5 Goos').toBeGreaterThanOrEqual(1.5);
    // 6: the rogue survives.
    expect(after.rip).toBeFalsy();
  } finally {
    await info.attach('rogue-fan-samples', { body: JSON.stringify({ samples, observed: seen }), contentType: 'application/json' });
  }
});

// 8: declared sparse layout. The natural main-map Goos and their respawns are removed and
// waves of five native Goos are placed inside the native Goo boundary [-282,702,218,872],
// every pair more than 160 apart, so each Goo stands alone.
const sparse = [[-262, 712], [-22, 712], [198, 712], [-142, 862], [98, 862]];
test('a Knife Belt rogue kills isolated one-shot mobs with Fan of Knives from range, not melee', async ({ live }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [], waves: any[] = [];
  let seen: any = null;
  try {
    await observe(live);
    await live.admin(`output=(()=>{for(const m of Object.values(instances.main.monsters))if(m.type==='goo')remove_monster(m,{method:'disappear',nospawn:true});
      for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='main'&&monster_respawns[i][0]?.type==='goo')monster_respawns.splice(i,1);return true;})()`);
    await scatter(live);
    // Waves start after arrival: travel blocks combat skills, so a Goo on the route is not a combat stand.
    await expect.poll(async () => (await sample(live)).mode, { timeout: 120_000, intervals: [1000],
      message: 'The rogue must arrive and scatter farm' }).toBe('scatter');
    const started = Date.now();
    for (let wave = 0; wave < 3; wave++) {
      const ids: string[] = await live.admin(`output=${JSON.stringify(sparse)}.map(([x,y])=>String(new_monster('main',{type:'goo',count:1,position:[x,y],radius:0},{temp:1}).id))`);
      waves.push({ wave, ids, at: Date.now() });
      await expect.poll(async () => {
        samples.push({ at: Date.now(), wave, client: await sample(live) });
        return live.admin(`output=${JSON.stringify(ids)}.filter(id=>instances.main.monsters[id]).length`);
      }, { timeout: 90_000, intervals: [1000], message: `Every Goo of wave ${wave + 1} must die` }).toBe(0);
    }
    seen = await observed(live, started);
    const kills = seen.hits.filter((h: any) => h.kill);
    expect(kills.length, 'The rogue must make kills in the sparse layout').toBeGreaterThan(0);
    // 8: lone Goos die to Fan of Knives from range; the rogue does not walk in to swing.
    expect(kills.filter((h: any) => h.source !== 'fanofknives').map((h: any) => h.source),
      'Isolated one-shot Goos must die to Fan of Knives, not melee attacks').toEqual([]);
    // 7: no Assassin's Smoke opener before one-shot kills.
    expect(seen.casts.filter((c: any) => c.skill === 'invis'), 'The rogue must not go invisible before one-shot kills').toEqual([]);
    expect((await native(live)).rip).toBeFalsy();
  } finally {
    await info.attach('rogue-fan-sparse', { body: JSON.stringify({ waves, samples, observed: seen }), contentType: 'application/json' });
  }
});
