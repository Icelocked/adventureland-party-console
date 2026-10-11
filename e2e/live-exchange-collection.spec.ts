import { test, expect, type LiveGame } from './live-fixtures';
import { W, M } from './game/hunt-events';

// Failure inventory: e2e/exchange-collection-failures.md. A fighter's stack under an Auto exchange
// rule, with no merchant mark, is collected by party collection and exchanged by the merchant, but
// only while automatic exchange is enabled; a locked stack and unrelated items stay with the fighter.
type Stack = { name: string; q?: number; l?: string } | null;

async function bag(live: LiveGame, name: string): Promise<Stack[]> {
  return live.admin(`output=get_player(${JSON.stringify(name)}).items`);
}
const count = (items: Stack[], id: string, locked = false) =>
  items.reduce((total, item) => total + (item?.name === id && !!item.l === locked ? Number(item.q) || 1 : 0), 0);
async function banked(live: LiveGame, id: string): Promise<number> {
  return live.admin(`output=(async()=>{const m=get_player(${JSON.stringify(M)});
    const mounted=Object.values(players).find(p=>p.owner===m.owner&&p.user);
    const info=mounted?mounted.user:(await db.collection('user').findOne({_id:m.owner})).info;
    return Object.entries(info).filter(([key,items])=>/^items[0-9]+$/.test(key)&&Array.isArray(items))
      .reduce((total,[,items])=>total+items.reduce((sum,item)=>sum+(item&&item.name===${JSON.stringify(id)}?Number(item.q)||1:0),0),0)})()`);
}

test('party stock under an Auto exchange rule is collected and exchanged only while automatic exchange runs', async ({ live, page }, info) => {
  test.setTimeout(600_000);
  const samples: unknown[] = [];
  const sample = async (phase: string) => {
    const now = { phase, at: Date.now(), fighter: await bag(live, W), merchant: await bag(live, M), bankGems: await banked(live, 'gem0') };
    samples.push(now);
    return now;
  };
  try {
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'gem0'),
      { timeout: 120_000, message: 'The native merchant must publish the Raw Emerald exchange' }).toBe(true);
    // Collection would otherwise run before the rule exists; automatic exchange starts disabled.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': false, 'automatic exchange': false } });
    await live.post('/config', { itemCollectionThreshold: 1 });

    // Declared fixture: three Raw Emeralds, one locked Raw Emerald and unrelated Bee Wings in the fighter's bag.
    const given = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
      const add=[{name:'gem0',q:3},{name:'gem0',q:1,l:'l'},{name:'beewings',q:2}];
      for(const item of add){const i=p.items.findIndex(x=>!x);if(i<0)throw Error('bag full');p.items[i]=item;}
      cache_player_items(p);resend(p,'u+cid+reopen');return add})()`);
    await expect.poll(async () => (await live.state()).characters[W]?.items?.filter((entry: { item?: Stack } | null) => entry?.item?.name === 'gem0').length,
      { timeout: 30_000, message: 'The coordinator must observe the fixture before rules change' }).toBe(2);
    const before = await sample('fixture');
    expect(count(before.merchant, 'gem0')).toBe(0);

    // The Auto exchange rule is the only rule for Raw Emeralds: no merchant or bank mark.
    await live.post('/command', { character: M, type: 'auto-exchange', slot: -1, item: { name: 'gem0', level: 0 } });
    const rules = await live.state();
    expect(rules.autoExchanges?.['gem0@0']).toBeTruthy();
    expect(Object.values(rules.autoItemMarks || {}).some((marks: any) => marks?.['gem0@+0'])).toBe(false);

    // Dashboard: the fighter's unlocked stack is labelled for exchange, not left looking unmarked.
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
    const gems = card.getByLabel('Raw Emerald', { exact: true });
    await expect(gems).toHaveCount(2);
    await expect.poll(async () => (await gems.allTextContents()).filter(text => text.includes('Auto exchange')).length, { timeout: 30_000 }).toBe(2);
    await info.attach('exchange-collection-dashboard', { body: await card.screenshot(), contentType: 'image/png' });

    // Routine disabled: party collection runs, but the merchant must not take stock it won't exchange.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true } });
    const until = Date.now() + 45_000;
    while (Date.now() < until) {
      const now = await sample('exchange disabled');
      expect(count(now.fighter, 'gem0'), 'No pickup while automatic exchange is disabled').toBe(3);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Routine enabled: the unlocked stack is collected and exchanged; the locked stack and Bee Wings stay.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': true } });
    await expect.poll(async () => count((await sample('collecting')).fighter, 'gem0'),
      { timeout: 240_000, intervals: [3000], message: 'Party collection must pick up the Raw Emeralds under the exchange rule' }).toBe(0);
    await expect.poll(async () => count((await sample('exchanging')).merchant, 'gem0'),
      { timeout: 300_000, intervals: [3000], message: 'The merchant must exchange the collected Raw Emeralds' }).toBe(0);
    const after = await sample('settled');
    expect(count(after.fighter, 'gem0', true), 'The locked stack stays with the fighter').toBe(1);
    expect(count(after.fighter, 'beewings'), 'Unrelated items stay with the fighter').toBe(2);
    expect(after.bankGems, 'Collected stock is exchanged, not banked').toBe(before.bankGems);
    const events = await live.clients[M].events();
    const exchanged = events.filter((event: any) => JSON.stringify(event).includes('gem0') && /exchange/i.test(JSON.stringify(event)));
    await info.attach('exchange-collection-evidence', { body: JSON.stringify({ given, exchanged: exchanged.slice(-20),
      autoExchanges: (await live.state()).autoExchanges }, null, 2), contentType: 'application/json' });
  } finally {
    await info.attach('exchange-collection-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  }
});
