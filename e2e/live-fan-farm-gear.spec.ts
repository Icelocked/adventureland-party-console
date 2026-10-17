import { test, expect, type LiveGame } from './live-fixtures';
import { location } from './game/hunt-lifecycle';

// Failure inventory: e2e/gear-sets-failures.md (25-30). The rogue (E2EWarrior seeded as a
// level-80 rogue with the native Knife Belt) farms native Goos, which Fan of Knives kills
// outright. Declared inputs: two Sparkling rings (ringsj) in the rogue's bag, and full HP after
// the setup swaps. The Fan farm set
// is saved natively from worn gear, those rings in place of the vitality rings. Swaps,
// farming and kills are native.
test.use({ primaryClass: 'rogue', loadout: 'combat-range' });
const R = 'E2EWarrior', P = 'E2EPriest';
const rings = (live: LiveGame) => live.admin(`output=(()=>{const p=get_player('${R}');return {ring1:p.slots.ring1?.name||null,ring2:p.slots.ring2?.name||null};})()`);
async function wear(live: LiveGame, name: string, level: number | null) {
  for (const slot of ['ring1', 'ring2']) {
    await live.clients[R].run(`(()=>{const i=character.items.findIndex(item=>item&&item.name===${JSON.stringify(name)}&&(${level}===null||item.level===${level}));
      if(i<0)throw Error('missing ${name}');equip(i,${JSON.stringify(slot)});return true})()`);
    await expect.poll(async () => (await rings(live))[slot as 'ring1'], { timeout: 10_000 }).toBe(name);
  }
}

test('a rogue wears its Fan farm set only while scatter fan-farming and restores its gear after', async ({ live, page }, info) => {
  test.setTimeout(300_000);
  const samples: any[] = [];
  const sample = async (phase: string) => { const now = { phase, at: Date.now(), rings: await rings(live),
    client: await live.clients[R].run(`(() => { const m = parent.__partyFanFarmGear || {};
      return { verdict: globalThis.sharedRoutine?.fanOfKnivesVerdict?.() ?? null, attack: character.attack, hp: character.hp,
        error: globalThis.partyCombatState?.error ?? null, session: !!m.session, heldUntil: m.heldUntil ?? null }; })()`) };
    samples.push(now); return now; };
  try {
    expect(await live.clients[R].run('character.ctype')).toBe('rogue');
    expect(await live.clients[R].run('character.slots.belt?.name')).toBe('knifebelt');
    const normal = await rings(live);
    expect(normal).toEqual({ ring1: 'vitring', ring2: 'vitring' });
    await live.admin(`output=(()=>{const p=get_player('${R}');
      for(let n=0;n<2;n++){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]={name:'ringsj',level:0};}
      cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    await expect.poll(async () => live.clients[R].run(`character.items.filter(i=>i&&i.name==='ringsj').length`), { timeout: 30_000 }).toBe(2);
    // 25: the Fan farm set is saved from worn gear.
    await wear(live, 'ringsj', null);
    // A set is saved from the coordinator's equipment report, which follows the native equip.
    await expect.poll(async () => { const slots = (await live.state()).characters[R]?.slots || {};
      return [slots.ring1?.item?.name, slots.ring2?.item?.name]; }, { timeout: 15_000 }).toEqual(['ringsj', 'ringsj']);
    await expect.poll(async () => (await live.post('/gear-sets', { character: R, set: 'fan', action: 'save' }).catch(error => ({ error: String(error) }))).ok,
      { timeout: 30_000, message: 'The Fan farm set must be saved' }).toBe(true);
    await wear(live, 'vitring', 100);
    // Declared: the setup swaps clamp HP to the ring-less maximum; below 30% HP the skill engine
    // rightly treats every idle Goo as an unsafe pull, which is not what this journey measures.
    await live.admin(`output=(()=>{const p=get_player('${R}');p.hp=p.max_hp;resend(p,'u+cid');return p.hp})()`);
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: R, exact: true }) });
    await expect(async () => {
      if (!await page.getByRole('region', { name: 'Fan farm gear set' }).isVisible()) await card.getByText(/^Gear sets \(/).click();
      await expect(page.getByRole('region', { name: 'Fan farm gear set' })).toContainText('in bag', { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await info.attach('fan-farm-set', { body: await page.screenshot(), contentType: 'image/png' });

    await live.clients[R].run(`(() => { globalThis.__fanHits = 0;
      parent.socket.on('hit', data => { if (data && data.hid === character.name) globalThis.__fanHits++; }); return true; })()`);
    await live.post('/formation', { leader: R });
    await live.post('/formation', { character: P, follow: false });
    await live.post('/focus', { monsterFocus: ['goo'] });
    // 27: grouped farming kills the same Goos without the set.
    await live.post('/farming-mode', { character: R, mode: 'default' });
    await live.post('/travel', await location(live));
    await expect.poll(async () => { await sample('grouped'); return live.clients[R].run('globalThis.__fanHits'); },
      { timeout: 120_000, intervals: [1000], message: 'The rogue must reach and attack the Goos' }).toBeGreaterThan(0);
    const groupedUntil = Date.now() + 20_000;
    while (Date.now() < groupedUntil) {
      expect((await sample('grouped')).rings, 'The Fan farm set must stay off in grouped farming').toEqual(normal);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    // 26: scatter fan-farming wears the set.
    await live.post('/farming-mode', { character: R, mode: 'scatter' });
    await expect.poll(async () => (await sample('scatter')).rings, { timeout: 60_000, intervals: [1000],
      message: 'The rogue must wear its Fan farm set while scatter fan-farming' }).toEqual({ ring1: 'ringsj', ring2: 'ringsj' });
    // 28: it stays on while farming, including between respawns.
    const scatterUntil = Date.now() + 20_000;
    while (Date.now() < scatterUntil) {
      expect((await sample('scatter-held')).rings, 'The Fan farm set must stay on while fan-farming').toEqual({ ring1: 'ringsj', ring2: 'ringsj' });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    // 27, 30: leaving scatter mode restores the gear worn before.
    await live.post('/farming-mode', { character: R, mode: 'default' });
    await expect.poll(async () => (await sample('restored')).rings, { timeout: 30_000, intervals: [1000],
      message: 'Leaving fan-farming must restore the previous rings' }).toEqual(normal);
    expect(await live.admin(`output=get_player('${R}').rip`)).toBeFalsy();
  } finally {
    await info.attach('fan-farm-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
  }
});
