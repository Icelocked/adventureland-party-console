import {test,expect} from './live-fixtures';
import {cipherIngredients,trickOrTreatRoute} from '../runtime/events/october';

test.use({initialPosition:{map:'halloween',x:0,y:0}});

test('October native door tour visits every door once and restores its farming checkpoint',async({live},info)=>{
  test.setTimeout(420_000);
  const name='E2EWarrior';
  await live.post('/formation',{leader:name});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  await live.post('/formation',{character:'E2EMerchant',eventSelections:[]});
  const initial=await live.admin(`output=(()=>{events.halloween=true;E.halloween=true;const p=get_player('${name}');p.p.trickortreat=null;p.trickortreat=trick_or_treat_status(p);resend(p,'u+cid');broadcast_e();return {at:Date.now(),map:p.map,x:p.x,y:p.y,doors:G.events.trickortreat.doors}})()`);
  await info.attach('october-door-initial-native',{body:JSON.stringify(initial),contentType:'application/json'});
  await expect.poll(async()=>{const s=await live.state(),c=s.characters[name];return c?.map===initial.map&&Math.hypot(c.x-initial.x,c.y-initial.y)<5;},{timeout:30_000}).toBe(true);
  const checkpoint=await live.post('/checkpoint',{});
  expect(checkpoint.ok).toBe(true);
  expect(checkpoint.partyLocation.map).toBe(initial.map);
  await live.post('/formation',{character:name,eventSelections:['trickortreat']});
  await expect.poll(async()=>Promise.all([name,'E2EPriest'].map(n=>live.clients[n].run('character.trickortreat?.doors?.length??0'))),{timeout:300_000}).toEqual([7,7]);
  const receipts=await live.clients[name].run(`get('party-october-${name}')`);
  expect(receipts.doors).toEqual([...trickOrTreatRoute]);
  const followerReceipts=await live.clients.E2EPriest.run("get('party-october-E2EPriest')");
  expect(followerReceipts.doors).toEqual([...trickOrTreatRoute]);
  await expect.poll(async()=>{const s=await live.state();return !s.eventSessions?.[name]&&!s.eventReturn&&s.characters[name]?.joinedEvent==null;},{timeout:120_000}).toBe(true);
  await expect.poll(async()=>{const actual=await live.clients[name].snapshot();return actual.map===checkpoint.partyLocation.map&&Math.hypot(actual.x-checkpoint.partyLocation.x,actual.y-checkpoint.partyLocation.y)<100;},{timeout:120_000}).toBe(true);
  const final=await live.clients[name].snapshot();
  await live.restartCoordinator();
  const after=await live.admin(`output=(()=>{const p=get_player('${name}');return {doors:p.p.trickortreat,items:p.items,map:p.map,x:p.x,y:p.y}})()`);
  expect(after.doors.doors).toHaveLength(7);
  await info.attach('october-native-door-tour',{body:JSON.stringify({initial,receipts,followerReceipts,final,after,state:await live.state()}),contentType:'application/json'});
});

test('October native cipher merchant solves a constrained recipe and does not replay after restart',async({live,page},info)=>{
  test.setTimeout(360_000);
  const merchant='E2EMerchant',secret=Array(5).fill('verdantspore');
  for(const name of ['E2EWarrior','E2EPriest',merchant])await live.post('/formation',{character:name,eventSelections:[],follow:false});
  const seed=await live.admin(`output=(()=>{
    const p=get_player('${merchant}');
    const names=${JSON.stringify(cipherIngredients)};
    for(let i=0;i<names.length;i++){if(p.items[20+i])throw Error('Seed slot occupied');p.items[20+i]={name:names[i],q:25};}
    cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');
    witch_cipher_start({id:'e2e-october-cipher'});
    witch_cipher.secret=${JSON.stringify(secret)};
    witch_cipher.history=Array.from({length:5},(_,i)=>({mix:witch_cipher.secret.map((name,j)=>j===i?'frostscale':name),right:4}));
    witch_cipher_publish();
    return {board:witch_cipher_public(),items:p.items,position:{map:p.map,x:p.x,y:p.y}};
  })()`);
  await info.attach('october-cipher-declared-initial-board',{body:JSON.stringify(seed),contentType:'application/json'});
  await expect.poll(async()=>{const s=await live.state();return s.characters[merchant]?.eventSchedules?.find((entry:{id:string})=>entry.id==='witchcipher')?.cipher?.board?.id;},{timeout:30_000}).toBe(seed.board.id);
  expect(await live.clients[merchant].run(`get('party-october-${merchant}')?.gathering??null`)).toBeNull();
  await live.post('/formation',{character:merchant,eventSelections:['witchcipher'],eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:0,minClues:6,automatic:true}}}});
  await expect.poll(async()=>{const s=await live.state();return s.eventSchedules?.find((entry:{id:string})=>entry.id==='witchcipher')?.cipher?.runtime?.phase;},{timeout:90_000}).toBe('waiting for clues');
  expect(await live.clients[merchant].run('character.witchcipher?.mixes??0')).toBe(0);
  await live.post('/formation',{character:merchant,eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:0,minClues:5,automatic:true}}}});
  await expect.poll(async()=>await live.clients[merchant].run("character.witchcipher?.mixes??0"),{timeout:180_000}).toBe(1);
  const native=await live.admin(`output=(()=>{const p=get_player('${merchant}');return {day:p.witchcipher,board:witch_cipher_public(),items:p.items,position:{map:p.map,x:p.x,y:p.y}}})()`);
  expect(native.board.cracks).toBe(1);expect(native.board.cracked.recipe).toEqual(secret);
  expect(native.items[20].q).toBe(20);
  await expect.poll(async()=>await live.clients[merchant].run(`get('party-october-${merchant}')?.last?.result?.cracked`),{timeout:30_000}).toBe(true);
  await live.restartCoordinator();
  const ledger=await live.clients[merchant].run(`get('party-october-${merchant}')`);
  expect(ledger.pending).toBeUndefined();expect(ledger.last.result.mixes_left).toBe(4);
  expect(await live.clients[merchant].run('character.witchcipher.mixes')).toBe(1);
  await expect.poll(async()=>{const s=await live.state(true);return s.bestiaryCatalog?.some((entry:{id:string})=>entry.id==='horseman')&&s.merchantCatalog?.allItems?.some((entry:{id:string})=>entry.id==='witchparcel')&&s.skillCatalog?.some((entry:{id:string})=>entry.id==='conditions');},{timeout:90_000}).toBe(true);
  const catalogs=await live.state(true);
  for(const id of ['horseman','jackowalker','zombie','ghoul','gargoyle'])expect(catalogs.bestiaryCatalog.some((entry:{id:string})=>entry.id===id)).toBe(true);
  for(const id of ['witchparcel','horsemanpumpkin',...cipherIngredients])expect(catalogs.merchantCatalog.allItems.some((entry:{id:string})=>entry.id===id)).toBe(true);
  const conditions=catalogs.skillCatalog.find((group:{id:string})=>group.id==='conditions');
  const nativeCatalog=await live.clients[merchant].run('({conditions:Object.keys(G.conditions),skills:Object.keys(G.skills),monsters:Object.keys(G.monsters),items:Object.keys(G.items)})');
  expect(conditions.skills.map((entry:{id:string})=>entry.id).sort()).toEqual(nativeCatalog.conditions.sort());
  expect([...new Set(catalogs.skillCatalog.filter((group:{id:string})=>group.id!=="conditions").flatMap((group:{skills:{id:string}[]})=>group.skills.map(entry=>entry.id)))].sort()).toEqual(nativeCatalog.skills.sort());
  expect(catalogs.bestiaryCatalog.map((entry:{id:string})=>entry.id).sort()).toEqual(nativeCatalog.monsters.sort());
  expect(catalogs.merchantCatalog.allItems.map((entry:{id:string})=>entry.id).sort()).toEqual(nativeCatalog.items.sort());
  await info.attach('october-native-cipher-result',{body:JSON.stringify({seed,native,ledger,state:await live.state()}),contentType:'application/json'});
  await live.post('/formation',{character:merchant,eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:0,minClues:5,automatic:false}}}});
  // The leader owns party Cipher settings; the merchant popup must submit to
  // that same policy instead of saving an ineffective merchant-only request.
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EWarrior',eventSelections:['witchcipher'],eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:0,minClues:5,automatic:false}}}});
  const manualSeed=await live.admin(`output=(()=>{witch_cipher.secret=Array(5).fill('frostscale');witch_cipher.history=Array.from({length:5},(_,i)=>({mix:witch_cipher.secret.map((name,j)=>j===i?'embercoal':name),right:4}));witch_cipher_publish();return witch_cipher_public();})()`);
  // The dashboard fixture blocks external requests. Serve the actual pinned
  // native image bytes from this test's game host, just like the Cave journey.
  await page.route('https://adventure.land/images/**',async route=>{
    const response=await page.request.get(new URL(live.clients[merchant].page.url()).origin+new URL(route.request().url()).pathname);
    expect(response.ok()).toBe(true);
    await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
  });
  await page.goto(live.url);
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:merchant,exact:true})});
  await card.getByRole('button',{name:/^Events \(/}).click();
  await expect(page.getByText('Realm schedule confirmed',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:"Witch's Cipher settings",exact:true}).click();
  const board=page.getByRole('region',{name:'Shared realm board',exact:true});
  await expect(board.getByText('5 clues · 1 possible recipes · recipe 2',{exact:true})).toBeVisible();
  const spriteUrls=(await live.state()).eventSchedules.find((entry:{id:string})=>entry.id==='witchcipher').cipher.ingredients.map((entry:{sprite:{url:string}})=>entry.sprite.url);
  const decoded=await page.evaluate(async(urls:string[])=>Promise.all([...new Set(urls)].map(async url=>{const image=new Image();image.src=url;await image.decode();return {url,width:image.naturalWidth,height:image.naturalHeight};})),spriteUrls);
  expect(decoded.every(image=>image.width>100&&image.height>100)).toBe(true);
  await board.scrollIntoViewIfNeeded();
  await info.attach('october-native-cipher-board',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await live.admin('output=(()=>{witch_cipher.history.push({...witch_cipher.history[0]});witch_cipher_publish();return witch_cipher_public();})()');
  await expect(board.getByText('6 clues · 1 possible recipes · recipe 2',{exact:true})).toBeVisible({timeout:30_000});
  const sources=page.getByRole('combobox',{name:'verdantspore farming monster',exact:true});
  await sources.click();
  await expect(page.getByRole('option',{name:/Goo.*%/i})).toBeVisible();
  await info.attach('october-ingredient-source-sprites-and-rates',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await page.keyboard.press('Escape');
  const settings=page.getByRole('dialog',{name:"Witch's Cipher settings",exact:true});
  await settings.getByRole('spinbutton',{name:'Minimum clues',exact:true}).fill('7');
  for(const ingredient of ['Verdant Spore','Frost Scale','Ember Coal','Gloom Feather']){
    await settings.getByRole('button',{name:`View ${ingredient} details`,exact:true}).first().click();
    const details=page.getByRole('dialog',{name:ingredient,exact:true});
    await expect(details).toBeVisible();
    await expect(details.getByText('Buy from NPC',{exact:true})).toBeVisible();
    await expect(details.getByRole('heading',{name:'Monster drops',exact:true})).toBeVisible();
    if(ingredient==='Verdant Spore')await info.attach('october-clickable-ingredient-details',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
    await details.getByRole('button',{name:'Close',exact:true}).click();
    await expect(settings.getByRole('spinbutton',{name:'Minimum clues',exact:true})).toHaveValue('7');
  }
  await page.getByRole('button',{name:'Manually enter solution',exact:true}).click();
  const manual=page.getByRole('dialog',{name:'Enter a five-ingredient solution',exact:true});
  for(let i=1;i<=5;i++)await manual.getByRole('combobox',{name:`Ingredient ${i}`,exact:true}).selectOption('frostscale');
  await expect(manual.getByText('Fits every known clue.',{exact:true})).toBeVisible();
  await info.attach('october-manual-solution-preview',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await manual.getByRole('button',{name:'Send solution to merchant',exact:true}).click();
  await expect.poll(async()=>await live.clients[merchant].run('character.witchcipher.mixes'),{timeout:90_000}).toBe(2);
  await expect.poll(async()=>await live.clients[merchant].run(`get('party-october-${merchant}')?.last?.result?.mix`),{timeout:30_000}).toEqual(Array(5).fill('frostscale'));
  const manualReceipt=await live.clients[merchant].run(`get('party-october-${merchant}')`);
  await live.restartCoordinator();
  expect(await live.clients[merchant].run('character.witchcipher.mixes')).toBe(2);
  await info.attach('october-manual-native-result',{body:JSON.stringify({manualSeed,manualReceipt,state:await live.state()}),contentType:'application/json'});
});

test('October Horseman walks to the forest graveyard and engages the native boss',async({live},info)=>{
  test.setTimeout(300_000);
  const name='E2EWarrior';
  await live.post('/formation',{leader:name});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const seed=await live.admin(`output=(()=>{
    G.monsters.horseman={...G.monsters.horseman,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'horseman',count:1,boundary:[-405,-1640,-405,-1640]},{temp:1});
    E.horseman={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
  await live.post('/formation',{character:name,eventSelections:['horseman']});
  const lineup=await live.clients[name].run('server.status.schedule');
  const horseman=[...lineup.events,...lineup.repeats].filter((entry:{event:string;status:string})=>entry.event==='horseman'&&entry.status==='scheduled').map((entry:{at:number})=>entry.at);
  expect(horseman.length).toBeGreaterThan(0);
  await expect.poll(async()=>{const s=await live.state();return s.eventSchedules?.find((entry:{id:string})=>entry.id==='horseman')?.occurrences?.map((entry:{at:number})=>entry.at);},{timeout:30_000}).toEqual(horseman);
  await expect.poll(async()=>{const hits=await live.clients[name].events();return ['E2EWarrior','E2EPriest'].every(name=>hits.some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>0));},{timeout:180_000}).toBe(true);
  const position=await live.clients[name].snapshot();
  expect(position.map).toBe('halloween');expect(Math.hypot(position.x-seed.x,position.y-seed.y)).toBeLessThan(250);
  await info.attach('october-native-horseman-combat',{body:JSON.stringify({seed,position,lineup,events:await live.clients[name].events(),state:await live.state()}),contentType:'application/json'});
});

test.describe('October Horseman add priority',()=>{
  test.use({initialPosition:{map:'halloween',x:-245,y:-1640}});
  // Failure inventory: a sticky boss selection ignores new adds; followers stay
  // on the boss; one dead add returns the party before the wave is cleared;
  // the second native wave fails to preempt; clearing adds never resumes boss.
  test('October Horseman retargets each native Jack-o-Walker wave before resuming boss',async({live},info)=>{
    test.setTimeout(600_000);
    const names=['E2EWarrior','E2EPriest'];
    await live.post('/formation',{leader:names[0]});
    await live.post('/formation',{character:names[1],follow:true});
    const seed=await live.admin(`output=(()=>{
      const dps=${JSON.stringify(names)}.reduce((sum,name)=>{const p=get_player(name);return sum+p.attack*p.frequency;},0);
      const original={horseman:G.monsters.horseman,jackowalker:G.monsters.jackowalker};
      global.e2eHorsemanPriority={original,spawner:new_monster,adds:[]};
      G.monsters.horseman={...original.horseman,hp:Math.ceil(dps*45),attack:1,speed:0,charge:0,range:1,armor:0,resistance:0,phresistance:0};
      G.monsters.jackowalker={...original.jackowalker,hp:Math.ceil(dps*6),attack:1,speed:0,charge:0,range:1,armor:0,resistance:0};
      new_monster=function(...args){const m=e2eHorsemanPriority.spawner.apply(this,args);if(m?.type==='jackowalker'&&m.master)e2eHorsemanPriority.adds.push({id:String(m.id),master:String(m.master),at:Date.now()});return m;};
      const m=new_monster('halloween',{type:'horseman',count:1,boundary:[-405,-1640,-405,-1640]},{temp:1});
      E.horseman={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
      return {id:String(m.id),spawns:original.horseman.spawns,dps,bossHp:m.hp,addHp:G.monsters.jackowalker.hp};
    })()`);
    const observations:any[]=[];
    const sample=()=>live.admin(`output=(()=>{const s=e2eHorsemanPriority,monsters=instances.halloween.monsters,boss=monsters[${JSON.stringify(seed.id)}];return {at:Date.now(),boss:boss?{hp:boss.hp,max_hp:boss.max_hp}:null,adds:s.adds.map(a=>({...a,alive:!!monsters[a.id]&&!monsters[a.id].dead&&monsters[a.id].hp>0}))};})()`);
    try{
      await live.post('/formation',{character:names[0],eventSelections:['horseman']});
      await expect.poll(async()=>{const events=await live.clients[names[0]].events();return names.every(name=>events.some((e:any)=>e.event==='hit'&&e.data.hid===name&&String(e.data.id)===seed.id&&e.data.damage>0));},{timeout:90_000}).toBe(true);
      let total=0;
      for(const spawn of seed.spawns.filter((entry:any)=>entry[1]==='jackowalker')){
        const start=total;total+=spawn[2];
        await expect.poll(async()=>{const s=await sample();observations.push(s);return s.adds.filter((a:any)=>a.master===seed.id).length;},{timeout:180_000}).toBe(total);
        const wave=(await sample()).adds.filter((a:any)=>a.master===seed.id).slice(start,total);
        expect(wave).toHaveLength(4);
        await expect.poll(async()=>{const s=await live.state();return names.every(name=>wave.some((a:any)=>a.id===String(s.characters[name]?.target?.id)));},{timeout:30_000,message:'Both fighters must leave Horseman for a live Jack-o-Walker'}).toBe(true);
        await expect.poll(async()=>{const s=await sample();observations.push(s);expect(s.boss,'Boss must survive while the party clears its wave').not.toBeNull();return s.adds.filter((a:any)=>wave.some((w:any)=>w.id===a.id)&&a.alive).length;},{timeout:180_000}).toBe(0);
        const cleared=await sample();
        await expect.poll(async()=>{const events=await live.clients[names[0]].events();return names.every(name=>events.some((e:any)=>e.event==='hit'&&e.at>=cleared.at&&e.data.hid===name&&String(e.data.id)===seed.id&&e.data.damage>0));},{timeout:45_000,message:'Both fighters must resume actual boss damage after clearing the wave'}).toBe(true);
        observations.push({wave,cleared,state:await live.state()});
      }
      expect(total).toBe(8);
    }finally{
      await info.attach('horseman-native-add-priority',{body:JSON.stringify({seed,observations,native:await sample(),events:await live.clients[names[0]].events(),state:await live.state()}),contentType:'application/json'});
      await live.admin('output=(()=>{const s=e2eHorsemanPriority;new_monster=s.spawner;Object.assign(G.monsters,s.original);return true;})()');
    }
  });
});

test.describe('October Graveyard targeting',()=>{
  test.use({initialPosition:{map:'spookytown',x:255,y:-1350}});
  test('October Graveyard ignores an unchecked Gargoyle and fights it after enabling',async({live},info)=>{
    test.setTimeout(300_000);
    const name='E2EWarrior';
    await live.post('/formation',{leader:name});
    await live.post('/formation',{character:'E2EPriest',follow:true});
    const seed=await live.admin(`output=(()=>{
      const result={};for(const [type,x] of [['zombie',235],['gargoyle',275]]){
        G.monsters[type]={...G.monsters[type],hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true};
        const m=new_monster('spookytown',{type,count:1,boundary:[x,-1440,x,-1440]},{temp:1});result[type]=String(m.id);
      }
      E.graveyard={live:true,start:Date.now(),map:'spookytown',x:255,y:-1545,wave:1,left:2};broadcast_e();return result;
    })()`);
    await live.post('/formation',{character:name,eventSelections:['graveyard'],eventLimits:{event:'graveyard',limits:{deathLimit:null,timeLimitMinutes:null,monsters:['zombie','ghoul']}}});
    await expect.poll(async()=>{const hits=await live.clients[name].events();return ['E2EWarrior','E2EPriest'].every(name=>hits.filter((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.zombie&&e.data?.hid===name&&e.data?.damage>0).length>=3);},{timeout:90_000}).toBe(true);
    const excluded=await live.admin(`output=(()=>{const m=instances.spookytown.monsters[${JSON.stringify(seed.gargoyle)}];return {hp:m.hp,max_hp:m.max_hp,target:m.target}})()`);
    expect(excluded.hp).toBe(excluded.max_hp);expect(excluded.target||null).toBeNull();
    expect((await live.clients[name].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.gargoyle)).toBe(false);
    await live.post('/formation',{character:name,eventLimits:{event:'graveyard',limits:{deathLimit:null,timeLimitMinutes:null,monsters:['gargoyle']}}});
    await live.admin(`output=(()=>{const m=instances.spookytown.monsters[${JSON.stringify(seed.zombie)}];if(m)remove_monster(m,{silent:true});return true;})()`);
    await expect.poll(async()=>{const hits=await live.clients[name].events();return ['E2EWarrior','E2EPriest'].every(name=>hits.some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.gargoyle&&e.data?.hid===name&&e.data?.damage>0));},{timeout:90_000}).toBe(true);
    await info.attach('october-native-graveyard-exclusion',{body:JSON.stringify({seed,excluded,events:await live.clients[name].events(),state:await live.state()}),contentType:'application/json'});
  });
});

test.describe('October Cipher gathering',()=>{
  test.use({initialPosition:null,initialMonsterSpawn:'arcticbee'});
  test('October party gathers and transfers ingredients to its designated merchant',async({live},info)=>{
    test.setTimeout(600_000);
    const name='E2EWarrior',merchant='E2EMerchant';
    await live.post('/formation',{leader:name});
    await live.post('/formation',{character:'E2EPriest',follow:true});
    const seed=await live.admin(`output=(()=>{
      const p=get_player('${name}');
      const ingredients=${JSON.stringify(cipherIngredients)};
      for(let i=0;i<ingredients.length;i++){if(p.items[20+i])throw Error('Seed slot occupied');p.items[20+i]=i===1?null:{name:ingredients[i],q:3};}
      cache_player_items(p);resend(p,'reopen+cid');
      G.monsters.arcticbee={...G.monsters.arcticbee,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true};
      const m=new_monster(p.map,{type:'arcticbee',count:1,boundary:[p.x,p.y,p.x,p.y]},{temp:1});
      witch_cipher_start({id:'e2e-october-gathering'});
      // Declare a shorter native drop window up front; retain six minutes of
      // actual gathering and exercise the same published cutoff without a sleep.
      witch_cipher.gather_end=Date.now()+7*60_000;witch_cipher_publish();
      return {id:String(m.id),map:p.map,x:p.x,y:p.y,board:witch_cipher_public()};
    })()`);
    await live.post('/formation',{character:name,eventSelections:['witchcipher'],eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:20,minClues:1,automatic:false}}}});
    await expect.poll(async()=>{const s=await live.state();return ['E2EWarrior','E2EPriest',merchant].every(n=>s.characters[n]?.joinedEvent==='witchcipher');},{timeout:60_000}).toBe(true);
    await expect.poll(async()=>{const hits=await live.clients[name].events();return hits.filter((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>0).length>=3;},{timeout:60_000}).toBe(true);
    await expect.poll(async()=>await live.clients[merchant].run(`Object.fromEntries(${JSON.stringify(cipherIngredients)}.map(name=>[name,character.items.reduce((n,item)=>n+(item?.name===name?(item.q||1):0),0)]))`),{timeout:60_000}).toEqual(Object.fromEntries(cipherIngredients.map((name,i)=>[name,i===1?0:3])));
    const plans=await Promise.all([name,'E2EPriest',merchant].map(n=>live.clients[n].run(`get('party-october-${n}')?.gathering`)));
    expect(plans.every(plan=>plan?.ingredient==='frostscale'&&plan?.monster==='arcticbee'&&plan?.owner===name)).toBe(true);
    await live.restartCoordinator();
    await live.post('/formation',{character:name,eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{gatherMinutes:20,minClues:1,automatic:false,gatherMonsters:['goo','wolfie','plantoid','snake']}}}});
    await expect.poll(()=>live.admin('output=Date.now()'),{timeout:400_000}).toBeGreaterThan(seed.board.start+6*60_000);
    const retained=await Promise.all([name,'E2EPriest',merchant].map(n=>live.clients[n].run(`get('party-october-${n}')?.gathering`)));
    expect(retained).toEqual(plans);
    const after=(await live.clients[name].events()).filter((entry:any)=>entry.event==='hit'&&String(entry.data?.id)===seed.id&&entry.data?.hid===name&&entry.data?.damage>0&&entry.at>=seed.board.start+5*60_000);
    expect(after.length).toBeGreaterThan(0);
    const remaining=await live.clients[name].run(`character.items.filter(item=>${JSON.stringify(cipherIngredients)}.includes(item?.name))`);
    expect(remaining).toEqual([]);
    expect(await live.clients[merchant].run('character.witchcipher?.mixes??0')).toBe(0);
    await expect.poll(async()=>Promise.all([name,'E2EPriest',merchant].map(n=>live.clients[n].run(`get('party-october-${n}')?.gathering?.mode`))),{timeout:120_000}).toEqual(['finished','finished','finished']);
    await expect.poll(async()=>{const s=await live.state();return [name,'E2EPriest',merchant].every(n=>s.characters[n]?.joinedEvent!=='witchcipher');},{timeout:120_000}).toBe(true);
    expect(await live.clients[merchant].run('character.witchcipher?.mixes??0')).toBe(0);
    await info.attach('october-native-gathering-and-transfer',{body:JSON.stringify({seed,plans,retained,remaining,merchant:await live.clients[merchant].snapshot(),events:await live.clients[name].events(),state:await live.state()}),contentType:'application/json'});
  });
});

test.describe('October Cipher inventory decisions',()=>{
  test.use({initialPosition:{map:'halloween',x:858,y:-120}});
  for(const shortage of [false,true])test(`October Cipher ${shortage?'farms an unavoidable recipe shortage without spending a try':'prefers abundant ingredients for equally informative guesses'}`,async({live},info)=>{
    test.setTimeout(240_000);
    const merchant='E2EMerchant';
    for(const character of ['E2EWarrior','E2EPriest',merchant])await live.post('/formation',{character,eventSelections:[],follow:false});
    const seed=await live.admin(`output=(()=>{
      const p=get_player('${merchant}'),ingredients=${JSON.stringify(cipherIngredients)};
      for(let i=0;i<ingredients.length;i++){if(p.items[20+i])throw Error('Seed slot occupied');p.items[20+i]={name:ingredients[i],q:i===0?25:1};}
      cache_player_items(p);resend(p,'reopen+cid');witch_cipher_start({id:'e2e-stock-decision'});
      witch_cipher.secret=${JSON.stringify(shortage?Array(5).fill('frostscale'):['verdantspore','frostscale','embercoal','gloomfeather','frostscale'])};
      if(${shortage})witch_cipher.history=Array.from({length:5},(_,i)=>({mix:witch_cipher.secret.map((name,j)=>j===i?'embercoal':name),right:4}));
      witch_cipher_publish();
      global.e2eCipherReceipts=[];const original=witch_cipher_brew;
      witch_cipher_brew=async function(player,names){const at=Date.now(),result=await original(player,names);e2eCipherReceipts.push({at,player:player.name,mix:names.slice(),result});return result;};
      return {board:witch_cipher_public(),stock:p.items};
    })()`);
    // Native day claims survive earlier rounds on this fixture's shared realm.
    // Assert an exact unchanged counter, in addition to zero brew receipts.
    const startingMixes=await live.admin(`output=witch_cipher_info(get_player('${merchant}')).then(info=>info.mixes-info.mixes_left)`);
    await live.post('/formation',{character:merchant,eventSelections:['witchcipher'],eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{minClues:0,automatic:true}}}});
    if(shortage){
      await expect.poll(()=>live.clients[merchant].run(`get('party-october-${merchant}')?.gathering`),{timeout:90_000}).toMatchObject({mode:'gathering',ingredient:'frostscale',monster:'arcticbee',reason:'recipe shortage'});
      expect(await live.admin('output=e2eCipherReceipts')).toEqual([]);
      expect(await live.clients[merchant].run('character.witchcipher?.mixes??0')).toBe(startingMixes);
      expect(await live.clients[merchant].run("character.items.find(item=>item?.name==='frostscale')?.q")).toBe(1);
    }else{
      await expect.poll(()=>live.admin('output=e2eCipherReceipts[0]||null'),{timeout:90_000}).toMatchObject({player:merchant,mix:Array(5).fill('verdantspore'),result:{success:true,right:1}});
    }
    await info.attach('october-native-stock-decision',{body:JSON.stringify({seed,startingMixes,receipts:await live.admin('output=e2eCipherReceipts'),journal:await live.clients[merchant].run(`get('party-october-${merchant}')`),state:await live.state()}),contentType:'application/json'});
  });
});

test.describe('October Cipher complete stock at cutoff',()=>{
  test.use({initialPosition:null,initialMonsterSpawn:'goo'});
  test('October Cipher gathers through the cutoff then brews with all four ingredient types',async({live},info)=>{
    test.setTimeout(420_000);
    const name='E2EWarrior',merchant='E2EMerchant';
    await live.post('/formation',{leader:name});
    await live.post('/formation',{character:'E2EPriest',follow:true});
    const seed=await live.admin(`output=(()=>{
      const p=get_player('${merchant}'),ingredients=${JSON.stringify(cipherIngredients)};
      for(let i=1;i<ingredients.length;i++){if(p.items[20+i])throw Error('Seed slot occupied');p.items[20+i]={name:ingredients[i],q:25};}
      cache_player_items(p);resend(p,'reopen+cid');
      // Guaranteed native ingredient rolls from real goo kills; no fabricated
      // inventory, action result, or runtime deadline transition after setup.
      G.events.witchcipher.loot=100;
      witch_cipher_start({id:'e2e-cutoff-complete'});witch_cipher.gather_end=Date.now()+3*60_000;
      witch_cipher.secret=Array(5).fill('frostscale');
      witch_cipher.history=Array.from({length:5},(_,i)=>({mix:witch_cipher.secret.map((name,j)=>j===i?'embercoal':name),right:4}));witch_cipher_publish();
      global.e2eCipherReceipts=[];const original=witch_cipher_brew;
      witch_cipher_brew=async function(player,names){const at=Date.now(),result=await original(player,names);e2eCipherReceipts.push({at,player:player.name,mix:names.slice(),result});return result;};
      return {board:witch_cipher_public()};
    })()`);
    await live.post('/formation',{character:name,eventSelections:['witchcipher'],eventLimits:{event:'witchcipher',limits:{deathLimit:null,timeLimitMinutes:null,cipher:{minClues:5,automatic:true}}}});
    await expect.poll(()=>live.clients[name].run(`get('party-october-${name}')?.gathering`),{timeout:60_000}).toMatchObject({mode:'gathering',ingredient:'verdantspore',monster:'goo'});
    await expect.poll(()=>live.clients[merchant].run("character.items.filter(item=>item?.name==='verdantspore').reduce((n,item)=>n+(item.q||1),0)"),{timeout:120_000}).toBeGreaterThan(0);
    const before=await live.admin('output={at:Date.now(),receipts:e2eCipherReceipts}');
    expect(before.at).toBeLessThan(seed.board.gather_end);expect(before.receipts).toEqual([]);
    await expect.poll(()=>live.admin('output=e2eCipherReceipts[0]||null'),{timeout:240_000}).toMatchObject({mix:Array(5).fill('frostscale'),result:{success:true,cracked:true}});
    const receipts=await live.admin('output=e2eCipherReceipts');
    expect(receipts[0].at).toBeGreaterThanOrEqual(seed.board.gather_end);
    const journal=await live.clients[name].run(`get('party-october-${name}')`);
    expect(journal.gathering).toMatchObject({mode:'brewing',reason:'gathering ended'});
    await info.attach('october-native-cutoff-complete',{body:JSON.stringify({seed,before,receipts,journal,state:await live.state()}),contentType:'application/json'});
  });
});
