import { test, expect } from './live-fixtures';
import { location } from './game/hunt-lifecycle';

// Failure inventory: e2e/rogue-fan-crab-rate-failures.md. Crab kills per minute for a Knife Belt
// rogue (E2EWarrior seeded as a level-80 rogue, Fiery Throwing Stars +7 in both hands like the
// user's Fan farm set) scatter farming the native Mainland crab spawn (8 crabs, ~1.1 s respawn),
// alone and against a competitor. Declared inputs: the two stars, and in the contested case a
// competitor at the spawn's south-east (where a live competitor farmed) that kills up to five crabs
// within 150 of its spot every 600 ms, the pace of another Fan of Knives rogue. Crabs, respawns,
// casts, potions and the rogue's kills are native.
test.use({ primaryClass: 'rogue', loadout: 'combat-range' });
const R = 'E2EWarrior', P = 'E2EPriest', MINUTES = 4;
const competitorSpot = { x: -1160, y: -230 };

async function farm(live: any, info: any, contested: boolean) {
  const native = () => live.admin(`output=(()=>{const p=get_player('${R}');
    return {x:p.x,y:p.y,mp:p.mp,max_mp:p.max_mp,rip:p.rip,potions:p.items.filter(i=>i&&i.name==='mpot1').reduce((n,i)=>n+(i.q||1),0)};})()`);
  await live.admin(`output=(()=>{const p=get_player('${R}');for(const level of [7,7]){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name:'firestars',level};}
    cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async () => live.clients[R].run(`character.items.filter(i=>i&&i.name==='firestars').length`), { timeout: 30_000 }).toBe(2);
  for (const slot of ['mainhand', 'offhand']) {
    await live.clients[R].run(`(()=>{const i=character.items.findIndex(x=>x&&x.name==='firestars');equip(i,'${slot}');return true})()`);
    await expect.poll(async () => live.clients[R].run(`character.slots.${slot}?.name`), { timeout: 10_000 }).toBe('firestars');
  }
  // Passive observer: the rogue's native actions and hits.
  await live.clients[R].run(`(() => {
    const log = globalThis.__crabRate = { actions: [], hits: [] };
    parent.socket.on('action', d => { if (d && d.attacker === character.name) log.actions.push({ at: Date.now(), type: d.type, mp: character.mp }); });
    parent.socket.on('hit', d => { if (d && d.hid === character.name) log.hits.push({ at: Date.now(), source: d.source, id: d.id, kill: !!d.kill }); });
    // Every 100 ms with the attack cooldown ready: MP and crabs within native Fan of Knives range.
    log.ready = []; log.decisions = [];
    // At each Fan of Knives decision: targets chosen against crabs in native range and authorized ones.
    const state = globalThis.partyCombatState; let value = state.skill;
    Object.defineProperty(state, 'skill', { configurable: true, enumerable: true, get: () => value, set: d => { value = d;
      if (d && d.skill === 'fanofknives' && d.status === 'selected') {
        const crabs = Object.values(parent.entities).filter(e => e && e.mtype === 'crab' && !e.dead && e.visible && distance(character, e) <= G.skills.fanofknives.range);
        log.decisions.push({ at: Date.now(), chosen: (d.targets || []).length, inRange: crabs.length,
          allowed: crabs.filter(e => globalThis.sharedRoutine?.skillTargetAllowed?.(e)).length }); } } });
    // What the attack loop reported at that moment.
    const why = crabs => { const c = globalThis.partyCombatState || {}, sel = parent.entities[c.selectedTarget];
      return { skipped: c.skippedAttack || null, stage: c.stage || null, skill: c.skill ? c.skill.status + ':' + (c.skill.reason || '') + '@' + (Date.now() - c.skill.at) : null,
        selectedInRange: sel ? distance(character, sel) <= G.skills.fanofknives.range : null }; };
    const cost = Math.ceil(G.skills.fanofknives.mp * (1 - Math.min(100, character.mp_reduction || 0) / 100));
    log.timer = setInterval(() => { if (!(Number(parent.next_skill?.attack || 0) <= Date.now())) return;
      const crabs = Object.values(parent.entities).filter(e => e && e.mtype === 'crab' && !e.dead && e.visible);
      log.ready.push({ at: Date.now(), mp: character.mp, cost, inRange: crabs.filter(e => distance(character, e) <= G.skills.fanofknives.range).length,
        visible: crabs.length, moving: !!character.moving, ...why(crabs) }); }, 100);
    return true; })()`);
  await live.post('/formation', { leader: R });
  await live.post('/formation', { character: P, follow: false });
  await live.post('/focus', { monsterFocus: ['crab'] });
  await live.post('/farming-mode', { character: R, mode: 'scatter' });
  await live.post('/travel', await location(live, 'crab'));
  await expect.poll(async () => live.clients[R].run('globalThis.__crabRate.hits.filter(h=>h.kill).length'),
    { timeout: 150_000, intervals: [1000], message: 'The rogue must kill native crabs' }).toBeGreaterThan(0);
  if (contested) await live.admin(`output=(()=>{
    const spot=${JSON.stringify(competitorSpot)};globalThis.__crabCompetitor&&clearInterval(globalThis.__crabCompetitor);
    globalThis.__crabCompetitorKills=0;
    globalThis.__crabCompetitor=setInterval(()=>{const crabs=Object.values(instances.main.monsters).filter(m=>m.type==='crab'&&!m.dead&&
      Math.hypot(m.x-spot.x,m.y-spot.y)<=150).sort((a,b)=>Math.hypot(a.x-spot.x,a.y-spot.y)-Math.hypot(b.x-spot.x,b.y-spot.y)).slice(0,5);
      for(const m of crabs){remove_monster(m);globalThis.__crabCompetitorKills++;}},600);return true;})()`);
  // Passive server observer: each crab's appearance, position and disappearance.
  await live.admin(`output=(()=>{globalThis.__crabLife&&clearInterval(globalThis.__crabLife.timer);
    const life=globalThis.__crabLife={alive:{},done:[]};
    life.timer=setInterval(()=>{const now=Date.now(),seen=new Set();
      for(const m of Object.values(instances.main.monsters))if(m.type==='crab'&&!m.dead){seen.add(m.id);life.alive[m.id]??={at:now,x:Math.round(m.x),y:Math.round(m.y)};}
      for(const [id,c] of Object.entries(life.alive))if(!seen.has(id)){life.done.push({...c,ms:now-c.at});delete life.alive[id];}},100);return true;})()`);
  const before = await native(), started = Date.now(), track: any[] = [];
  while (Date.now() - started < MINUTES * 60_000) {
    track.push({ at: Date.now(), ...(await native()) });
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  const after = await native();
  const lives: any[] = await live.admin(`output=(()=>{const l=globalThis.__crabLife;clearInterval(l.timer);return l.done.filter(c=>c.at>=${started});})()`);
  const competitorKills = contested ? await live.admin(`output=(()=>{clearInterval(globalThis.__crabCompetitor);return globalThis.__crabCompetitorKills})()`) : 0;
  const seen = await live.clients[R].run(`(() => { const l = globalThis.__crabRate, s = ${started}, e = s + ${MINUTES * 60_000};
    clearInterval(l.timer);
    return { actions: l.actions.filter(a => a.at >= s && a.at < e), hits: l.hits.filter(h => h.at >= s && h.at < e),
      ready: l.ready.filter(r => r.at >= s && r.at < e), decisions: l.decisions.filter(r => r.at >= s && r.at < e) }; })()`);
  // The server sends one action per knife; knives of one cast arrive together.
  const knives = seen.actions.filter((a: any) => a.type === 'fanofknives'), basics = seen.actions.filter((a: any) => a.type === 'attack');
  const fans: { at: number; knives: number }[] = [];
  for (const k of knives) { const last = fans.at(-1); if (last && k.at - last.at < 120) last.knives++; else fans.push({ at: k.at, knives: 1 }); }
  const histogram = fans.reduce((h: Record<number, number>, f) => (h[f.knives] = (h[f.knives] || 0) + 1, h), {});
  const gaps = fans.slice(1).map((f, i) => f.at - fans[i].at).sort((a, b) => a - b);
  let moved = 0; for (let i = 1; i < track.length; i++) moved += Math.hypot(track[i].x - track[i - 1].x, track[i].y - track[i - 1].y);
  const kills = seen.hits.filter((h: any) => h.kill).length;
  const result = { contested, minutes: MINUTES, kills, killsPerMinute: kills / MINUTES, competitorKills,
    casts: fans.length, castsPerMinute: fans.length / MINUTES, basicAttacks: basics.length,
    knives: knives.length, targetsPerCast: histogram, meanTargets: fans.length ? knives.length / fans.length : 0,
    castGapMs: { median: gaps[gaps.length >> 1] ?? null, p90: gaps[Math.floor(gaps.length * .9)] ?? null }, potions: before.potions - after.potions, movedPerMinute: Math.round(moved / MINUTES),
    position: { x: Math.round(track.reduce((s, t) => s + t.x, 0) / track.length), y: Math.round(track.reduce((s, t) => s + t.y, 0) / track.length) },
    died: !!after.rip, crabLife: summarize(lives, track), idle: idleReasons(seen.ready), decisions: decisionGaps(seen.decisions) };
  await info.attach('crab-rate-' + (contested ? 'contested' : 'solo'), { body: JSON.stringify({ result, track }, null, 2), contentType: 'application/json' });
  console.log('CRAB RATE', JSON.stringify(result));
  return result;
}

// Where a cast took fewer than five: what was in range and authorized at the decision.
function decisionGaps(decisions: any[]) {
  const short = decisions.filter(d => d.chosen < 5);
  const key = (d: any) => `chosen ${d.chosen} / inRange ${Math.min(d.inRange, 9)} / allowed ${Math.min(d.allowed, 9)}`;
  return { decisions: decisions.length, short: short.length,
    meanChosen: decisions.reduce((n, d) => n + d.chosen, 0) / Math.max(1, decisions.length),
    shortBecause: short.reduce((h: Record<string, number>, d) => (h[key(d)] = (h[key(d)] || 0) + 1, h), {}) };
}
// Ready samples are 100 ms apart, so each one is about 100 ms of an attack slot left unused.
function idleReasons(ready: any[]) {
  const ms = (f: (r: any) => boolean) => ready.filter(f).length * 100;
  return { readyMs: ready.length * 100, noCrabInRange: ms(r => r.inRange === 0), mpBelowCost: ms(r => r.inRange > 0 && r.mp < r.cost),
    crabAndMpButNoCast: ms(r => r.inRange > 0 && r.mp >= r.cost), whileMoving: ms(r => r.moving),
    inRangeWhenReady: ready.reduce((h: Record<number, number>, r) => (h[r.inRange] = (h[r.inRange] || 0) + 1, h), {}),
    noCastBecause: ready.filter(r => r.inRange > 0 && r.mp >= r.cost).reduce((h: Record<string, number>, r) => {
      const k = `${r.skipped}|${r.stage}|selectedInRange=${r.selectedInRange}|${String(r.skill).replace(/@\d+$/, '')}`; h[k] = (h[k] || 0) + 1; return h; }, {}) };
}
function summarize(lives: any[], track: any[]) {
  if (!lives.length) return null;
  const ms = lives.map(c => c.ms).sort((a, b) => a - b), at = (q: number) => ms[Math.floor(ms.length * q)];
  const center = { x: track.reduce((s, t) => s + t.x, 0) / track.length, y: track.reduce((s, t) => s + t.y, 0) / track.length };
  const far = lives.filter(c => Math.hypot(c.x - center.x, c.y - center.y) > 170);
  return { crabs: lives.length, lifeMs: { p25: at(.25), median: at(.5), p75: at(.75), p90: at(.9) },
    spawnedBeyond170: far.length, beyond170MedianMs: far.map(c => c.ms).sort((a, b) => a - b)[far.length >> 1] ?? null };
}
test('crab kills per minute alone', async ({ live }, info) => {
  test.setTimeout(MINUTES * 60_000 + 360_000);
  const r = await farm(live, info, false);
  expect(r.died).toBe(false);
  // Control before the change: 282-294 a minute (rogue-fan-crab-rate-failures.md).
  expect(r.killsPerMinute, 'Crab kills per minute alone').toBeGreaterThanOrEqual(300);
});
test('crab kills per minute against a competitor', async ({ live }, info) => {
  test.setTimeout(MINUTES * 60_000 + 360_000);
  const r = await farm(live, info, true);
  expect(r.died).toBe(false);
  // Control before the change: 246-269 a minute against the same competitor.
  expect(r.killsPerMinute, 'Crab kills per minute against a competitor').toBeGreaterThanOrEqual(275);
});
