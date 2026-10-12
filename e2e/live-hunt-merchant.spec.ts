import {test,expect} from './live-fixtures';
import {W,M,fighters,hunt,observed,prepareHunt,beginHunt,reward,seedCargo,totalLeather,evidence,quantity,killNativeCharacter} from './hunt-interruption-helpers';

test.describe('native merchant interruption of Hunt',()=>{
  test.setTimeout(480000);
  for(const fault of ['coordinator restart','queued merchant death','active merchant death'] as const) {
    test(`Hunt collection resumes after ${fault} without losing or duplicating cargo`,async({live},info)=>{
      const setup=await prepareHunt(live);await seedCargo(live);
      const total=await totalLeather(live);
      if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:true});
      await beginHunt(live,setup);
      await expect.poll(async()=>{const s=await live.state();return hunt(s)?.stage==='mission-travel'&&!!s.activeConvoy;},{timeout:90000}).toBe(true);
      const cycle=hunt(await live.state()).cycleId;
      await live.post('/bank-party',{});
      if(fault==='queued merchant death') {
        await expect.poll(async()=>(await live.state()).merchantQueue.length,{timeout:20000}).toBeGreaterThan(0);
      } else {
        await expect.poll(async()=>!!(await live.state()).merchantCurrent,{timeout:90000}).toBe(true);
        await expect.poll(async()=>{const s=await live.state();return !!s.activeConvoy?.merchantInterruption||s.commands?.[W]?.type==='merchant-handoff';},
          {timeout:90000,intervals:[100,250],message:'Native collection must actually interrupt the owned Hunt convoy before fault injection'}).toBe(true);
      }
      await evidence(live,info,'hunt-merchant-owned-before-fault',{fault,total,cycle,destination:setup.location});
      if(fault==='coordinator restart')await live.restartCoordinator();
      else {
        const death=await killNativeCharacter(live,M);
        await info.attach('native-merchant-death',{body:JSON.stringify(death,null,2),contentType:'application/json'});
        await expect.poll(async()=>(await observed(live))[M].rip,{timeout:15000}).toBe(true);
        await expect.poll(async()=>{const m=(await observed(live))[M];return !m.rip&&m.hp>0;},{timeout:120000}).toBe(true);
        if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:false});
      }
      const continued=hunt(await live.state());
      if(fault==='queued merchant death'&&continued?.cycleId!==cycle) {
        const completed=await observed(live);
        expect(fighters.every(name=>quantity(completed[name].items,'monstertoken')===quantity(setup.before[name].items,'monstertoken')+1),
          'A queued merchant may outlive this Hunt only after both original owners actually received their rewards').toBe(true);
        await live.post('/farming-mode',{character:W,mode:'default'});
      } else expect(continued?.cycleId).toBe(cycle);
      const rendezvousSamples:any[]=[];let lastRendezvousSample=0;
      try{await expect.poll(async()=>{
        const native=await observed(live);
        if(fault==='active merchant death'&&Date.now()-lastRendezvousSample>=1000){
          lastRendezvousSample=Date.now();let client:any;
          try{client=await live.clients[M].frame.evaluate(()=>{
            const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
            const merchant=game.character,target=game.get_player?.('E2EWarrior'),smart=root?.smart;
            return {character:merchant&&{name:merchant.name,map:merchant.map,in:merchant.in,x:merchant.real_x??merchant.x,y:merchant.real_y??merchant.y,rip:merchant.rip,moving:merchant.moving},
              target:target&&{name:target.name,map:target.map,in:target.in,x:target.real_x??target.x,y:target.real_y??target.y,rip:target.rip,visible:target.visible},
              distance:merchant&&target?Math.hypot((target.real_x??target.x)-(merchant.real_x??merchant.x),(target.real_y??target.y)-(merchant.real_y??merchant.y)):null,
              directClear:target&&root?.can_move_to?.(target.real_x??target.x,target.real_y??target.y),realm:String(game.server_region)+String(game.server_identifier),
              commandId:root?.__partyLastCommand,activeJob:root?.__merchantActiveJob,
              navigationIntent:root?.__partyNavigationIntent,route:smart&&{moving:smart.moving,found:smart.found,map:smart.map,x:smart.x,y:smart.y,remaining:smart.plot?.length}};
          });}catch(error){client={observationError:String(error)};}
          if(rendezvousSamples.length===96)rendezvousSamples.splice(64,1);
          rendezvousSamples.push({at:lastRendezvousSample,server:Object.fromEntries([W,M].map(name=>[name,{...native[name],items:undefined}])),client});
        }
        return quantity(native[W].items,'leather');
      },{timeout:180000,message:'The native merchant must actually collect the marked stack'}).toBe(0);}
      finally{if(fault==='active merchant death')await info.attach('native-merchant-recovery-rendezvous-samples',{body:JSON.stringify({fault,cycle,total,rendezvousSamples}),contentType:'application/json'});}
      await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.merchantMarked?.[W]?.length;},{timeout:180000}).toBe(true);
      expect(await totalLeather(live)).toBe(total);
      await reward(live,setup.before);
      await live.restartCoordinator();
      expect(await totalLeather(live)).toBe(total);
      await evidence(live,info,'hunt-merchant-recovered-and-rewarded',{fault,total,cycle});
    });
  }
});
