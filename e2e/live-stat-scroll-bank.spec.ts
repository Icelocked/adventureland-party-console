import { test, expect } from './live-fixtures';

// Failure inventory: e2e/stat-scroll-bank-failures.md. The declared inputs are the
// merchant's seeded item and one STR scroll in its native bank; the withdrawal,
// any NPC purchase and the stat application are native.
const merchant = 'E2EMerchant';
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const scrolls=list=>(list||[]).filter(i=>i&&i.name==='strscroll').reduce((n,i)=>n+(i.q||1),0);
  return {helmet:p.items[20],gold:p.gold+(Number(u.gold)||0),carried:scrolls(p.items),
    bank:Object.entries(u).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+scrolls(v),0)};})()`);

test('a merchant stat scroll comes from the bank instead of being bought again', async ({ live }, info) => {
  test.setTimeout(300_000);
  const observations: any[] = [];
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(async()=>{const p=get_player('${merchant}');
      if(p.items[20]) throw Error('Fixture requires empty inventory cell 20');
      if(p.items.some(i=>i&&i.name==='strscroll')) throw Error('Fixture requires no carried STR scrolls');
      p.items[20]={name:'helmet',level:0,stat_type:'dex'};
      const seed=info=>{const pack=info.items0||(info.items0=[]);const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42) throw Error('Fixture requires a free items0 slot');pack[slot<0?pack.length:slot]={name:'strscroll',q:1};};
      if(p.user) seed(p.user); else {const u=await db.collection('user').findOne({_id:p.owner});
        if(Object.values(u.info).some(v=>Array.isArray(v)&&v.some(i=>i&&i.name==='strscroll'))) throw Error('Fixture requires no banked STR scrolls');
        seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      cache_player_items(p);resend(p,'reopen+cid');return {item:p.items[20],inBank:!!p.user};})()`);
    await info.attach('declared-inputs', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item, { timeout: 30_000 })
      .toEqual({ name: 'helmet', level: 0, stat_type: 'dex' });
    const before = await native(live);
    expect(before).toMatchObject({ carried: 0, bank: 1 });

    await live.post('/command', { character: merchant, type: 'stat-scroll-mark', slot: 20, item: { name: 'helmet', level: 0, stat_type: 'dex' }, statType: 'str' });
    await expect.poll(async () => { const n = await native(live); observations.push({ at: Date.now(), n }); return n.helmet?.stat_type; },
      { timeout: 240_000, intervals: [500, 1000] }).toBe('str');
    const after = await native(live);
    // 1: the banked scroll was used; nothing was bought. A bank visit may deposit
    // carried gold, so compare carried plus banked gold.
    expect(after).toMatchObject({ carried: 0, bank: 0 });
    expect(after.gold).toBe(before.gold);
  } finally {
    await info.attach('native-stat-scroll-bank', { body: JSON.stringify({ observations, native: await native(live).catch(String),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
});
