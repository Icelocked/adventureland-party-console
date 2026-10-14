import {test,expect} from './live-fixtures';

test('withdrawn manual shield and inventory shield finish one mixed upgrade batch',async({live},info)=>{
  test.setTimeout(240_000);
  const merchant='E2EMerchant';
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.items[9]={name:'sshield',level:0};cache_player_items(p);resend(p,'reopen+cid');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'sshield',level:0}}});return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[9]?.name).toBe('sshield');
  await live.post('/command',{character:merchant,type:'bank'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.some((entry:any)=>entry?.item?.name==='sshield'),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  const bank=(await live.state()).bank.packs.items0.find((entry:any)=>entry?.item?.name==='sshield');
  const withdrawal=await live.post('/command',{character:merchant,type:'withdraw',pack:'items0',slot:bank.slot,item:bank.item,upgradeTiers:4});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:9,item:{name:'sshield',level:0},tiers:4});
  const before=await live.state();
  await info.attach('withdrawn-upgrade-intents',{body:JSON.stringify({withdrawal,before}),contentType:'application/json'});
  expect(before.upgrades[merchant]).toHaveLength(2);
  expect(new Set(before.upgrades[merchant].map((mark:any)=>mark.requestId)).size).toBe(2);
  expect(before.upgrades[merchant].every((mark:any)=>typeof mark.requestId==='string'&&mark.tiers===4&&!mark.auto)).toBe(true);
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>{
    const state=await live.state();
    const errors=state.merchantActivity.filter((entry:any)=>JSON.stringify(entry).includes('Manual upgrade continuation changed'));
    expect(errors).toHaveLength(0);
    return state.upgrades[merchant]?.length||0;
  },{timeout:150_000}).toBe(0);
  const after=await live.state(),events=await live.clients[merchant].events();
  expect(events.filter((event:any)=>event.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(event.data?.response)).length).toBeGreaterThanOrEqual(2);
  await live.restartCoordinator();
  expect((await live.state()).upgrades[merchant]||[]).toHaveLength(0);
  await info.attach('native-manual-upgrade-results',{body:JSON.stringify({after,events,restarted:await live.state()}),contentType:'application/json'});
});
