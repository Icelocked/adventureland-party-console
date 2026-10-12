import {test,expect} from './live-fixtures';

const W='E2EWarrior',P='E2EPriest';

test('realm departure retires an old native convoy before destination arrival',async({live},info)=>{
  test.setTimeout(240_000);
  // Keep merchant stand/home work out of this party realm ownership journey.
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const ready=async()=>{
    const state=await live.state();
    return state.steamSwitch?.phase==='complete'&&[W,P,'E2EMerchant'].every(name=>{
      const report=state.characters[name];
      return report?.runtime==='native'&&report.server==='USI'&&Date.now()-report.seenAt<3000;
    });
  };
  await expect.poll(ready,{timeout:30_000}).toBe(true);
  const destination=await live.admin(`output=(()=>{const members=['${W}','${P}'].map(name=>get_player(name)),p=members[0];for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+600*Math.cos(a),y=p.y+600*Math.sin(a);if(members.every(member=>can_move({map:member.map,x:member.x,y:member.y,going_x:x,going_y:y,base:member.base})))return {map:p.map,x,y};}throw Error('No native collision-free convoy destination')})()`);
  await info.attach('native-reachable-realm-convoy-destination',{body:JSON.stringify(destination),contentType:'application/json'});
  await live.post('/travel',destination);
  await expect.poll(async()=>(await live.state()).activeConvoy?.id,{timeout:30_000}).toBeTruthy();
  await expect.poll(ready,{timeout:15_000}).toBe(true);
  const before=await live.state(),old=before.activeConvoy;
  await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.phase;
  },{timeout:120_000}).toBe('complete');
  await expect.poll(async()=>(await live.state()).activeConvoy?.id || null).not.toBe(old.id);
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${W}')&&!!get_player('${P}')`)).toBe(true);
  const after=await live.state();
  expect(after.combatLogs[W].some((entry:any)=>entry.details?.convoyId===old.id&&entry.message==='Convoy cancelled')).toBe(true);
  await info.attach('native-realm-convoy-retirement',{body:JSON.stringify({before,after}),contentType:'application/json'});
});

test('superseded native Town progress ends quietly and stale pending membership retires',async({live},info)=>{
  test.setTimeout(180_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.admin(`output=(()=>{const p=get_player('${P}');p.x=350;p.y=0;resend(p,'u+cid');return true})()`);
  let held=false,heldAt=0,releasedAt=0,release!:()=>void,heldBody:{navigationRevision:number;cycleId:string}|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const responses:unknown[]=[];
  await live.clients[P].page.route('**/party-api/return-progress',async route=>{
    if(!held){heldBody=route.request().postDataJSON();heldAt=Date.now();held=true;await gate;}
    try{
      const response=await route.fetch();
      responses.push({body:route.request().postDataJSON(),status:response.status(),response:await response.json()});
      await route.fulfill({response});
    }catch(error){responses.push({body:route.request().postDataJSON(),error:String(error)});throw error;}
  });
  try{
    await live.post('/town-party',{});
    await expect.poll(()=>held,{timeout:30_000}).toBe(true);
    const before=await live.state(),revision=heldBody!.navigationRevision;
    await expect.poll(()=>live.savedTownCycle()?.pending.includes(P)).toBe(true);
    const savedBefore=live.savedTownCycle();
    expect(savedBefore?.revisions?.[P]).toBe(revision);
    // Clear party focus under the same controller, advancing its actual
    // navigation revision without replacing the retained Town command.
    await live.post('/focus',{monsterFocus:[]});
    // The API has already persisted supersession. Release before waiting for
    // a heartbeat to update native CODE; its real request timeout is ten seconds.
    releasedAt=Date.now();
    release();
    await expect.poll(async()=>await live.clients[P].run('window.__partyNavigationIntent.revision')).toBeGreaterThan(revision);
    await expect.poll(()=>responses.some((entry:any)=>entry.status===409)).toBe(true);
    await expect.poll(()=>live.savedTownCycle()?.pending.includes(P) || false).toBe(false);
    await expect.poll(async()=>(await live.state()).characters[P].navigationState).not.toBe('town');
    // Local game_log output is DOM text, not a native server game_log packet.
    const nativeLog=await live.clients[P].frame.locator('body').innerText();
    expect(nativeLog).not.toContain('Party command failed: POST /return-progress');
    const restartedAt=Date.now();
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const state=await live.state();
      return [W,P].every(name=>state.characters[name]?.runtime==='native'&&state.characters[name].seenAt>=restartedAt);
    },{timeout:30_000}).toBe(true);
    const after=await live.state();
    const savedAfter=live.savedTownCycle();
    expect(savedAfter?.pending.includes(P)||false).toBe(false);
    // A fresh admission must ignore the old local return-progress record.
    const freshTown=await live.post('/town-party',{});
    expect(freshTown.queued).toContain(P);
    await expect.poll(()=>responses.some((entry:any)=>entry.body.cycleId!==heldBody!.cycleId&&entry.status===200),{timeout:30_000}).toBe(true);
    await expect.poll(()=>live.savedTownCycle()?.pending.length || 0,{timeout:90_000}).toBe(0);
    await expect.poll(async()=>{
      const native=await live.clients[P].snapshot();
      return native.map==='main'&&Math.hypot(native.x,native.y)<=90;
    }).toBe(true);
    const resumed=await live.state();
    const events=await live.clients[P].events();
    const finalLog=await live.clients[P].frame.locator('body').innerText();
    expect(finalLog).not.toContain('Party command failed: POST /return-progress');
    await info.attach('native-town-supersession',{body:JSON.stringify({before,savedBefore,after,savedAfter,resumed,savedResumed:live.savedTownCycle(),responses,events,nativeLog,finalLog}),contentType:'application/json'});
  }finally{
    release();
    await info.attach('native-town-progress-transport',{body:JSON.stringify({heldBody,heldAt,releasedAt,responses,savedTownCycle:live.savedTownCycle()}),contentType:'application/json'});
  }
});
