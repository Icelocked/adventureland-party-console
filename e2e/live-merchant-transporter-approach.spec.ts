import {test,expect} from './live-fixtures';
import {W,P,M,seedCargo,totalLeather} from './hunt-interruption-helpers';
test.use({liveHeadless:true,initialPositions:{E2EWarrior:{map:'main',x:0,y:0},E2EPriest:{map:'main',x:0,y:0},E2EMerchant:{map:'desertland',x:0,y:0}}});
test('native headless merchant approaches Desert transporter within range and collects real cargo',async({live},info)=>{
 test.setTimeout(240000);const samples:any[]=[];
 await live.post('/focus',{monsterFocus:[],monsterPriorities:{}});
 await live.post('/merchant/stand-location',{map:'desertland',x:0,y:0});
 await live.post('/merchant/force-stand',{enabled:true});
 await live.post('/steam/action',{character:M,action:'logout'});
 await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===M)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
 await expect.poll(()=>live.admin(`output=!!get_player('${M}')`),{timeout:30000}).toBe(false);
 const slots=(await live.state()).activeSlots,slot=slots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
 await live.post('/slots/'+(slot?.slot??slot?.index??1)+'/spawn',{character:M});
 await expect.poll(async()=>{const c=(await live.state()).characters[M];return c?.runtime==='headless'&&c.map==='desertland'&&Math.hypot(c.x,c.y)<15;},{timeout:90000}).toBe(true);
 try{
  await live.post('/config',{itemCollectionThreshold:1});await seedCargo(live,W);expect(await totalLeather(live)).toBe(7);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true}});
  await live.post('/merchant/force-stand',{enabled:false});
  let approached=false,crossed=false;
  await expect.poll(async()=>{
   const s=await live.state(),actual=await live.admin(`output=(()=>{const m=get_player('${M}'),w=get_player('${W}'),npc=G.maps.desertland.npcs.find(n=>n.id==='transporter').position;return {merchant:m&&{map:m.map,x:m.x,y:m.y,hp:m.hp,rip:m.rip,range:Math.hypot(m.x-npc[0],m.y-npc[1]),clear:can_move({...m,going_x:m.x,going_y:m.y})},stock:w.items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0)};})()`);
   approached ||= actual.merchant?.map==='desertland'&&actual.merchant.range<75&&actual.merchant.clear;
   crossed ||= actual.merchant?.map==='main';
   if(samples.length<200)samples.push({at:Date.now(),actual,movement:s.characters[M]?.movement,current:s.merchantCurrent,queue:s.merchantQueue});
   return approached&&crossed&&actual.stock===0;
  },{timeout:120000,intervals:[200,500],message:'Native transporter approach, actual transport and real cargo receipt'}).toBe(true);
  expect(await totalLeather(live)).toBe(7);
 }finally{await info.attach('native-merchant-desert-transporter-collection',{body:JSON.stringify({samples,final:await live.state(),total:await totalLeather(live)}),contentType:'application/json'});}
});
