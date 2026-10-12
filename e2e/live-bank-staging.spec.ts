import {test, expect} from './live-fixtures';

test('bank uses all initial slots until the first offline BankBoi reserves its transfer row', async ({live, page}, info) => {
  test.setTimeout(240_000);
  const merchant = 'E2EMerchant';
  const openBank = async () => {
    const dialog = page.getByRole('dialog',{name:'Bank',exact:true});
    // Reload returns server-rendered controls before client event handlers attach.
    await expect(async () => {
      if (!await dialog.isVisible()) await page.getByRole('button',{name:'Bank',exact:true}).click();
      await expect(dialog).toBeVisible({timeout:1000});
    }).toPass({timeout:30_000,intervals:[1000]});
    return dialog;
  };
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');const a=Array.from({length:42},()=>({name:'helmet',level:0})),b=Array(42).fill(null);for(let i=0;i<35;i++)b[i]={name:'helmet',level:0};b[40]={name:'sword',level:0};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':a,'info.items1':b}});return true})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bank?.packs?.items1?.[35]?.item?.name, {timeout:90_000}).toBe('sword');
  const ordinary = await live.state();
  expect(ordinary.bank.packs.items1[40]).toBeFalsy();
  expect(ordinary.bankboiQueue).toHaveLength(0);
  expect(Object.values(ordinary.bank.packs).flat().filter((entry:any)=>entry?.item?.name==='helmet')).toHaveLength(77);
  await expect.poll(async () => (await live.state()).merchantCurrent, {timeout:90_000}).toBeNull();
  await page.goto(live.url);
  const dialog = await openBank();
  await expect(dialog.getByText('RESERVED',{exact:true})).toHaveCount(0);
  await info.attach('ordinary-full-bank',{body:JSON.stringify(ordinary),contentType:'application/json'});
  await info.attach('ordinary-bank-dashboard',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await live.restoreHistoricalSettings(() => ({bankbois:{OfflineStorage:{name:'OfflineStorage',state:'idle',items:[]}}}));
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bankboiQueue?.some((request:any)=>request.pack==='items1'&&request.slot===35&&request.item.name==='sword'),{timeout:90_000}).toBe(true);
  await page.reload();
  await openBank();
  await expect(page.getByRole('dialog',{name:'Bank',exact:true}).getByText('RESERVED',{exact:true})).toHaveCount(7);
  const reserved = await live.state();
  expect(reserved.bank.packs.items1[35]?.item?.name).toBe('sword');
  await info.attach('first-offline-bankboi-reservation',{body:JSON.stringify({reserved,events:await live.clients[merchant].events()}),contentType:'application/json'});
  await info.attach('reserved-bank-dashboard',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await live.restoreHistoricalSettings(() => ({bankbois:{}}));
  await expect.poll(async () => (await live.state()).bankboiQueue?.length).toBe(0);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await page.reload();
  await openBank();
  await expect(page.getByRole('dialog',{name:'Bank',exact:true}).getByText('RESERVED',{exact:true})).toHaveCount(0);
  expect((await live.state()).bank.packs.items1[35]?.item?.name).toBe('sword');
  await info.attach('last-worker-removed',{body:JSON.stringify(await live.state()),contentType:'application/json'});
});
