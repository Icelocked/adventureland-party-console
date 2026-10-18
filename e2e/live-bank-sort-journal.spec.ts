import { test, expect } from './live-fixtures';

// Failure inventory: e2e/bank-sort-journal-failures.md. Declared inputs: the post-swap native state
// (a Helmet in inventory slot 11, a Candy deposited into the bank cell the swap freed) and the merchant's
// persisted bank sort journal for that swap, as the live merchant had it. The runtime reload, recovery
// and bank moves are native.
const M = 'E2EMerchant';
const identity = (name: string) => JSON.stringify([name, 0, null, null, null, null, null, null, null]);

test('a completed bank sort swap whose freed cell was refilled settles instead of blocking merchant work', async ({ live }, info) => {
  test.setTimeout(240_000);
  const bank = await live.admin(`output={map:'bank',x:G.maps.bank.spawns[0][0],y:G.maps.bank.spawns[0][1]}`);
  await live.post('/merchant/force-stand', { enabled: true });
  await live.post('/command', { character: M, type: 'character-travel', location: bank });
  await expect.poll(async () => (await live.clients[M].snapshot()).map, { timeout: 120_000 }).toBe('bank');
  await live.admin(`output=(()=>{const p=get_player('${M}');p.items[11]={name:'helmet',level:0};p.items[12]={name:'candy1',q:1};
    cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async () => live.clients[M].run(`[character.items[11]?.name||null, character.items[12]?.name||null, !!character.bank?.items0]`),
    { timeout: 30_000 }).toEqual(['helmet', 'candy1', true]);
  // The deposit that refilled the freed cell is native.
  const cell: number = await live.clients[M].run(`(()=>{const pack=character.bank.items0;let s=1;while(s<42&&pack[s])s++;if(s>=42)throw Error('items0 full');
    bank_store(12,'items0',s);return s})()`);
  await expect.poll(async () => live.clients[M].run(`[character.items[11]?.name||null, character.items[12]?.name||null, character.bank?.items0?.[${cell}]?.name||null]`),
    { timeout: 30_000 }).toEqual(['helmet', null, 'candy1']);
  const journal = [{ slot: 11, floor: 'bank', identities: [identity('helmet')],
    pending: { pack: 'items0', slot: cell, inventory: JSON.stringify([identity('helmet'), 1]), bank: 'null' } }];
  await live.clients[M].run(`(()=>{localStorage.setItem('party-bank-sort-buffer:'+character.name, ${JSON.stringify(JSON.stringify(journal))});return true})()`);
  const before = await live.state(), runtime = before.characters[M].dashboardRuntime;
  // 1: a fresh runtime in the bank recovers the journal before any work.
  await live.clients[M].frame.evaluate(() => { const game = window as any, runner = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    game.start_runner('maincode', `$.getScript(${JSON.stringify(runner.__partyServer + '/CODE/adventure_land/universal-loader.js')});`); });
  await expect.poll(async () => (await live.state()).characters[M]?.dashboardRuntime !== runtime, { timeout: 60_000 }).toBe(true);
  await live.post('/merchant/force-stand', { enabled: false });
  try {
    await expect.poll(async () => {
      const state = await live.state();
      expect(state.merchantActivity.filter((e: any) => JSON.stringify(e).includes('swap not confirmed')), 'The journal must not block merchant work').toEqual([]);
      return live.clients[M].run(`JSON.parse(localStorage.getItem('party-bank-sort-buffer:'+character.name)||'[]').length`);
    }, { timeout: 120_000, intervals: [1000] }).toBe(0);
    // 3, 4: the Helmet goes back to the bank; the Candy stays in its cell. 2: nothing swapped back.
    await expect.poll(async () => live.clients[M].run('character.items[11]?.name||null'), { timeout: 60_000 }).toBeNull();
    const stored = await live.admin(`output=(async()=>{const p=get_player('${M}');const user=await db.collection('user').findOne({_id:p.owner});
      const packs=Object.entries(user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v));
      return {helmets:packs.flatMap(([,v])=>v).filter(x=>x&&x.name==='helmet'&&!x.level).length,cell:user.info.items0[${cell}]};})()`);
    expect(stored.cell).toMatchObject({ name: 'candy1' });
    expect(stored.helmets).toBe(1);
  } finally {
    const state = await live.state();
    await info.attach('bank-sort-journal', { body: JSON.stringify({ cell, journal, activity: state.merchantActivity,
      items: (await live.clients[M].snapshot()).items }), contentType: 'application/json' });
  }
});
