import { test, expect } from './live-fixtures';

// Failure modes: capacity still admits travel/tool swaps/casts; blocked work
// advances a cooldown; one mode bypasses the reserve; freeing space never resumes.
const capacityTest=test.extend({initialGatheringReady:true});
capacityTest('merchant gathering waits at capacity without resetting cooldowns',async({live,page},info)=>{
  const name='E2EMerchant';
  for(const mode of ['fishing','mining'])await live.post('/merchant/gather',{mode,enabled:false});
  const standDeadline=Date.now()+90_000;
  async function standReady(){await expect.poll(async()=>{
    const [state,response]=await Promise.all([live.state(),fetch(live.url+'/party-api/state?section=fast',{signal:AbortSignal.timeout(15_000)})]);
    expect(response.ok).toBe(true);
    const fast=await response.json();expect(fast.pendingCommands).toEqual(expect.any(Object));
    return state.characters[name]?.standOpen && fast.pendingCommands[name]?.type!=='merchant-idle';
  },{timeout:Math.max(1,standDeadline-Date.now()),message:'Native stand return and reconciliation must finish before the capacity-only fixture'}).toBe(true);}
  const standTool=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(!G.items.stand0.stand)throw new Error('Native stand0 definition missing');
    p.items[12]={name:'stand0'};cache_player_items(p);resend(p,'reopen+cid');return p.items[12];})()`);
  expect(standTool).toEqual({name:'stand0'});
  await info.attach('declared-native-stand-tool',{body:JSON.stringify(standTool),contentType:'application/json'});
  await expect.poll(async()=>(await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='stand0')).toBe(true);
  await live.post('/merchant/force-stand',{enabled:true});
  await standReady();
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    const stand=p.items.find(item=>item?.name==='stand0');if(!stand)throw new Error('Native merchant stand tool missing before capacity seed');
    for(let i=0;i<42;i++)p.items[i]=i<39?{name:'helmet',level:0}:null;
    p.items[12]=stand;
    p.items[10]={name:'rod',level:0};p.items[11]={name:'pickaxe',level:0};
    cache_player_items(p);resend(p,'reopen+cid');return {items:p.items,last:{fishing:p.last.fishing,mining:p.last.mining}};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.filter(Boolean).length).toBe(39);
  // Native timestamps were declared before login. Observe the genuine client
  // and coordinator agreement; never clear cooldowns while exercising capacity.
  let availability:any;
  await expect.poll(async()=>{
    const [state,client,server]=await Promise.all([live.state(),live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {now:Date.now(),next:Object.fromEntries(['fishing','mining'].map(mode=>[mode,Number(new Date(game.next_skill[mode]||0))])),
        recorded:{...root.__merchantGatheringCooldowns},session:!!root.__merchantGatheringSession,attempt:!!root.__merchantGatheringAttempt};
    }),live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:p.last.fishing,mining:p.last.mining};})()`)]);
    availability={coordinator:state.gatheringCooldowns,client,server};
    return !client.session&&!client.attempt&&['fishing','mining'].every(mode=>
      Number(new Date(server[mode]))===0&&Number(client.next[mode])<=client.now&&
      Number(client.recorded[mode]||0)===0&&Number(state.gatheringCooldowns[mode]||0)===0);
  },{timeout:15000,message:'Declared available native gathering skills must agree before capacity testing'}).toBe(true);
  await info.attach('native-gathering-initial-availability',{body:JSON.stringify(availability),contentType:'application/json'});
  const before=(await live.state()).gatheringCooldowns;
  await live.post('/merchant/force-stand',{enabled:false});
  for(const mode of ['fishing','mining'])await live.post('/merchant/gather',{mode,enabled:true});
  await page.goto(live.url);await page.getByText(/Merchant logistics ·/).click();
  await expect(page.locator('details').filter({has:page.locator('summary').getByText(/Merchant logistics/)}).getByText('BLOCKED',{exact:true})).toHaveCount(2);
  // Capture real reason transitions in the native document, rather than
  // repeatedly sampling the same heartbeat phase over CDP.
  const reasonFrame=live.clients[name].frame;
  await reasonFrame.evaluate(()=>{
    const game=window as any,until=Date.now()+15000;
    const probe={samples:[] as {at:number;reason:string|null}[],timer:null as any};
    game.__e2eGatheringReasonProbe=probe;
    probe.timer=setInterval(()=>{
      const root=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
      if(probe.samples.length===160)probe.samples.shift();
      probe.samples.push({at:Date.now(),reason:root?.__merchantGatheringBlockedReason??null});
      if(Date.now()>=until)clearInterval(probe.timer);
    },100);
  });
  let reasonSamples:{at:number;reason:string|null}[]=[];
  try{await expect.poll(async()=>{
    try{reasonSamples=await live.clients[name].frame.evaluate(()=>(window as any).__e2eGatheringReasonProbe?.samples||[]);
      return reasonSamples.some(sample=>sample.reason==='inventory capacity');
    }catch(error){
      if(/Execution context was destroyed|Cannot find context|Frame was detached|Native game frame is not present/.test(String(error)))return false;
      throw error;
    }
  },{timeout:15000}).toBe(true);}
  finally{
    if(!reasonFrame.isDetached())try{await reasonFrame.evaluate(()=>{
      const game=window as any,probe=game.__e2eGatheringReasonProbe;
      if(probe){clearInterval(probe.timer);delete game.__e2eGatheringReasonProbe;}
    });}catch(error){if(!/Execution context was destroyed|Cannot find context|Frame was detached/.test(String(error)))throw error;}
    await info.attach('native-gathering-reason-samples',{body:JSON.stringify(reasonSamples),contentType:'application/json'});
  }
  const after=await live.state();expect(after.gatheringCooldowns).toEqual(before);
  const native=await live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,last:{fishing:p.last.fishing,mining:p.last.mining}};})()`);
  expect(Object.values(native.last).map(value=>new Date(value as string).getTime())).toEqual([0,0]);
  await info.attach('native-gathering-capacity',{body:JSON.stringify({seed,before,after,native}),contentType:'application/json'});
  await info.attach('native-gathering-blocked',{body:await page.screenshot(),contentType:'image/png'});
  // Native potion restocking can occupy one reserve cell after the initial
  // seed. Free two helmets so that real capacity crosses below 39 occupied.
  await live.admin(`output=(()=>{const p=get_player('${name}');p.items[37]=p.items[38]=null;cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
  await expect(page.getByText('BLOCKED',{exact:true})).toHaveCount(0);
});

// Failure modes: an old weapon preference overrides manual Equip; gathering
// retains obsolete displaced gear; restart forgets the new preference; any
// swap loses the weapon or tool. Observe native tool equip and native restore.
test('manual merchant weapon remains selected through gathering and restart',async({live,page},info)=>{
  test.setTimeout(300_000);
  const name='E2EMerchant';
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(p.items[10]||p.items[11]||p.items[13])throw Error('Weapon fixture requires empty cells');
    p.items[10]={name:'broom',level:6};p.items[11]={name:'rod',level:0};p.items[13]={name:'pickaxe',level:0};
    p.slots.mainhand={name:'staff',level:0};p.slots.offhand=null;
    cache_player_items(p);p.cslots.mainhand=cache_item(p.slots.mainhand);resend(p,'reopen+cid');
    return {items:p.items,slots:p.slots};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='broom'),{timeout:30_000}).toBe(true);
  // Seed the existing explicit normal-weapon preference through its public action.
  const old=await live.admin(`output=(()=>{const p=get_player('${name}');p.items[12]=p.slots.mainhand;p.slots.mainhand=null;cache_player_items(p);p.cslots.mainhand=null;resend(p,'reopen+cid');return p.items[12];})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.slot===12&&entry.item.name==='staff'),{timeout:30_000}).toBe(true);
  await live.post('/command',{type:'merchant-weapon',character:name,slot:12,item:old});
  // Fixture failure modes: a retained session or its in-flight status response
  // can restore a pre-reset cooldown; an active native skill can finish after
  // the reset. Disable both modes through production actions and observe the
  // old session/attempt retire before declaring skills available.
  for (const mode of ['fishing','mining'])
    await live.post('/merchant/gather',{mode,enabled:false});
  await expect.poll(async()=> (await live.state()).gatheringModes,{timeout:30_000}).toEqual([]);
  await expect.poll(()=>live.clients[name].frame.evaluate(()=>{
    const root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !root.__merchantGatheringSession && !root.__merchantGatheringAttempt;
  }),{timeout:30_000}).toBe(true);
  // Declare available gathering skills at the fixture boundary. Native actions
  // still choose/equip tools, cast and restore gear; no receipt is fabricated.
  // Stop coordinator first so its saved cooldown cannot race this initial seed.
  await live.restoreHistoricalSettings(async () => {
    const server = await live.admin(`output=(()=>{const p=get_player('${name}');
      const before={fishing:p.last.fishing,mining:p.last.mining};
      p.last.fishing=p.last.mining=new Date(0);return {before,after:{fishing:p.last.fishing,mining:p.last.mining}};})()`);
    const client = await live.clients[name].frame.evaluate(() => {
      const game = window as any;
      const root = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const before = {next: {fishing:game.next_skill.fishing,mining:game.next_skill.mining},recorded:{...root.__merchantGatheringCooldowns}};
      for (const mode of ['fishing','mining']) {
        game.next_skill[mode]=new Date(0);
        root.__merchantGatheringCooldowns[mode]=0;
      }
      return {before,after:{next:{fishing:game.next_skill.fishing,mining:game.next_skill.mining},recorded:{...root.__merchantGatheringCooldowns}}};
    });
    await info.attach('declared-gathering-availability',{body:JSON.stringify({server,client}),contentType:'application/json'});
    return {gatheringCooldowns:{fishing:0,mining:0}};
  });
  await live.post('/merchant/gather',{mode:'fishing',enabled:true});
  await live.post('/merchant/gather',{mode:'mining',enabled:true});
  await expect.poll(async()=> (await live.state()).gatheringModes,{timeout:10_000}).toEqual(expect.arrayContaining(['fishing','mining']));
  await expect.poll(()=>live.admin(`output=['rod','pickaxe'].includes(get_player('${name}')?.slots.mainhand?.name)`),{timeout:90_000}).toBe(true);
  await page.goto(live.url);
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=merchant.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  await merchant.getByLabel('Broom',{exact:true}).click({button:'right'});
  const priorWeaponSequence=Math.max(0,...(await live.clients[name].events()).map(event=>event.sequence||0));
  const requestedAt=await live.clients[name].run('Date.now()');
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  let weaponReceipts:any[]=[];
  try{
    await expect.poll(async()=>{weaponReceipts=(await live.clients[name].events()).filter((event:any)=>event.event==='player'&&event.at>=requestedAt&&event.sequence>priorWeaponSequence&&event.data?.slots?.mainhand).map((event:any)=>({sequence:event.sequence,at:event.at,mainhand:event.data.slots.mainhand}));return weaponReceipts.some(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6);},{timeout:30_000,message:'Native item packet must confirm the requested Broom equip'}).toBe(true);
  }finally{await info.attach('native-manual-weapon-equip-receipts',{body:JSON.stringify({requestedAt,priorWeaponSequence,receipts:weaponReceipts.slice(-32)}),contentType:'application/json'});}
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:10_000}).toMatchObject({name:'broom',level:6});
  const broomSequence=weaponReceipts.find(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6).sequence;
  await expect.poll(async()=>(await live.clients[name].events()).some((event:any)=>event.event==='player'&&event.sequence>broomSequence&&['rod','pickaxe'].includes(event.data?.slots?.mainhand?.name)),{timeout:90_000,message:'Native gathering tool equip must follow the actual Broom receipt'}).toBe(true);
  await live.post('/merchant/gather',{mode:'fishing',enabled:false});
  await live.post('/merchant/gather',{mode:'mining',enabled:false});
  await expect.poll(()=>live.admin(`output=get_player('${name}')?.slots.mainhand`),{timeout:30_000}).toMatchObject({name:'broom',level:6});
  const after=await live.state();expect(after.merchantWeapon.item).toMatchObject({name:'broom',level:6});
  await live.restartCoordinator();
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:30_000}).toMatchObject({name:'broom',level:6});
  const cargo=await live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  for(const item of ['staff','broom','rod','pickaxe'])expect([...cargo.items,...Object.values(cargo.slots)].filter((entry:any)=>entry?.name===item)).toHaveLength(1);
  expect(cargo.slots.mainhand).toMatchObject({name:'broom',level:6});
  await info.attach('manual-merchant-weapon-cycle',{body:JSON.stringify({seed,after,cargo,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('manual-merchant-weapon-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

// Failure modes: orb eligibility hides Equip; menu/command changes the item;
// native equip chooses another slot or silently ignores it; replacement destroys
// the old orb; restarting the coordinator replays or loses the equipped result.
test('Loaded Die equips through the priest inventory menu into the native orb slot',async({live,page},info)=>{
  test.setTimeout(240_000);
  const name='E2EPriest';
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(!p||p.items[10])throw Error('Loaded Die fixture requires empty inventory cell 10');
    if(G.items.cave_loaded_die.type!=='orb')throw Error('Native Loaded Die must be orb equipment');
    p.items[10]={name:'cave_loaded_die',level:0};
    p.slots.orb={name:'orbofint',level:0};
    cache_player_items(p);p.cslots.orb=cache_item(p.slots.orb);resend(p,'reopen+cid');
    return {definition:G.items.cave_loaded_die,items:p.items,orb:p.slots.orb};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='cave_loaded_die'),{timeout:30_000}).toBe(true);
  await page.goto(live.url);
  const priest=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=priest.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  const die=priest.getByLabel('Loaded Die',{exact:true});
  await expect(die).toBeVisible();await die.click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'Equip',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  await expect.poll(()=>live.admin(`output=get_player('${name}').slots.orb`),{timeout:30_000}).toMatchObject({name:'cave_loaded_die',level:0});
  const cargo=()=>live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  const after=await cargo();
  expect(after.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  expect([...after.items,...Object.values(after.slots)].filter((item:any)=>item?.name==='cave_loaded_die')).toHaveLength(1);
  await live.restartCoordinator();
  const restarted=await cargo();expect(restarted.slots.orb).toMatchObject({name:'cave_loaded_die',level:0});
  expect(restarted.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  await info.attach('loaded-die-native-equipment',{body:JSON.stringify({seed,after,restarted,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('loaded-die-priest-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
