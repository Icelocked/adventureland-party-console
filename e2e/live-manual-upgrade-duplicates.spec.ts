import {test,expect} from './live-fixtures';

// Failure inventory: e2e/manual-upgrade-duplicates-failures.md. Declared input: three identical
// wcap +0 in the merchant's bag (an administrative write). Requests, swaps and upgrades are native.
test('identical displaced copies with their own manual upgrade requests are each upgraded once',async({live},info)=>{
  test.setTimeout(240_000);const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(()=>{const p=get_player('${merchant}');for(const i of [7,9,12])p.items[i]={name:'wcap',level:0};
    for(const i of [10,11])p.items[i]=null;cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[12]?.name).toBe('wcap');
  for(const slot of [7,9,12])await live.post('/command',{character:merchant,type:'upgrade-mark',slot,item:{name:'wcap',level:0},tiers:1});
  // 1: two copies leave their requested slots; 2: the third stays in its own.
  await live.clients[merchant].run(`(async()=>{await swap(7,10);await swap(9,11);return true})()`);
  await expect.poll(async()=>{const items=(await live.clients[merchant].snapshot()).items;return [7,9,10,11,12].map(i=>items[i]?.name||null);})
    .toEqual([null,null,'wcap','wcap','wcap']);
  const before=await live.state();
  expect(before.upgrades[merchant]).toHaveLength(3);
  expect(new Set(before.upgrades[merchant].map((mark:any)=>mark.requestId)).size).toBe(3);
  await info.attach('duplicate-manual-upgrades-before',{body:JSON.stringify({marks:before.upgrades[merchant],items:(await live.clients[merchant].snapshot()).items}),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  try {
    await expect.poll(async()=>{
      const state=await live.state();
      expect(state.merchantActivity.filter((entry:any)=>JSON.stringify(entry).includes('recovery ambiguous')),'No request may stop as ambiguous').toEqual([]);
      return state.upgrades[merchant]?.length||0;
    },{timeout:180_000,intervals:[1000]}).toBe(0);
  } finally {
    const state=await live.state();
    await info.attach('duplicate-manual-upgrades-activity',{body:JSON.stringify({marks:state.upgrades[merchant],activity:state.merchantActivity,items:(await live.clients[merchant].snapshot()).items}),contentType:'application/json'});
  }
  // 3: three native upgrade results, and no copy upgraded twice or left at +0.
  const events=await live.clients[merchant].events(),items=(await live.clients[merchant].snapshot()).items;
  const results=events.filter((e:any)=>e.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(e.data?.response));
  const caps=items.filter((item:any)=>item?.name==='wcap');
  await info.attach('duplicate-manual-upgrades-after',{body:JSON.stringify({results,items}),contentType:'application/json'});
  expect(results).toHaveLength(3);
  expect(caps.filter((item:any)=>item.level!==1),'Every surviving copy is at +1').toEqual([]);
  expect(caps.length+results.filter((e:any)=>e.data.response==='upgrade_fail').length).toBe(3);
});
