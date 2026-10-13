import {test,expect} from './live-fixtures';
import {W,P,M} from './hunt-interruption-helpers';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {createDeploymentDriver} from '../tools/console-build/driver';
import {safeReload} from '../tools/console-build/safe-reload';
import {atomicJson} from '../tools/build-store';
import type {GameManifest,CharacterClass} from '../tools/game/manifest';
test.use({liveHeadless:true,movementMode:'shadow',loadout:'god',initialPosition:{map:'main',x:349,y:1532}});
test('one deployment barrier covers the native browser and real headless workers through coordinator restart',async({live},info)=>{
  test.setTimeout(360000);
  const names=[W,P,M],samples:any[]=[],hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  await live.post('/merchant/force-stand',{enabled:true});await live.post('/focus',{monsterFocus:[],monsterPriorities:{}});
  for(const name of [P,M]){
    await live.post('/steam/action',{character:name,action:'logout'});
    await expect.poll(async()=>{const state=await live.state();return !state.activeSlots.some((slot:any)=>slot.character===name)&&(!state.steamSwitch||state.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
    await expect.poll(()=>live.admin(`output=!!get_player('${name}')`),{timeout:30000}).toBe(false);
    const state=await live.state(),slot=state.activeSlots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
    const index=slot?.slot??slot?.index??(name===P?0:1);
    await live.post('/slots/'+index+'/spawn',{character:name});
    await expect.poll(async()=>(await live.state()).characters[name]?.runtime,{timeout:90000}).toBe('headless');
  }
  const movementSamples:any[]=[];
  const origin={map:'main',x:349,y:1532},destination={map:'main',x:738,y:1702};
  async function nativeWalking(goal:{map:string;x:number;y:number},label:string){
    try{
    const before=await live.admin(`output=(()=>{const p=get_player('${P}');if(!p)throw Error('Headless Priest missing');return {name:p.name,map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:p.rip,blocked:!can_move({...p,going_x:${goal.x},going_y:${goal.y}}),goalClear:can_move({...p,x:${goal.x},y:${goal.y},going_x:${goal.x},going_y:${goal.y}})};})()`);
    expect(before.blocked,'Declared Main approach must require a native terrain route').toBe(true);expect(before.goalClear).toBe(true);
    await live.post('/command',{character:P,type:'character-travel',location:goal});
    let nativePlanning=false;
    await expect.poll(async()=>{
      const state=await live.state(),character=state.characters[P],movement=character?.movement;
      const actual=await live.admin(`output=(()=>{const p=get_player('${P}');return p&&{map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:p.rip,moving:p.moving};})()`);
      nativePlanning ||= movement?.engine==='native'&&movement?.nativePlanning?.calls>0;
      if(movementSamples.length<160)movementSamples.push({label,at:Date.now(),runtime:character?.runtime,codeHash:character?.codeHash,movement,actual});
      return nativePlanning&&character?.runtime==='headless'&&actual?.hp>0&&!actual.rip&&actual.map===goal.map&&Math.hypot(actual.x-goal.x,actual.y-goal.y)<35;
    },{timeout:60000,intervals:[500],message:'Actual headless native planning and physical arrival '+label}).toBe(true);
    }finally{await info.attach('native-headless-walking-'+label.replaceAll(' ','-'),{body:JSON.stringify({goal,movementSamples,final:await live.state()}),contentType:'application/json'});}
  }
  await nativeWalking(destination,'before CODE retirement');
  const original:GameManifest=JSON.parse(await readFile('.build/game/manifest.json','utf8'));
  const root=info.outputPath('mixed-store'),store=new ConsoleBuildStore(root),manifests=new Map<string,GameManifest>();
  async function stage(label:string,changed:boolean){
    const id=hash(label),directory=path.join(root,label,'app'),manifest:GameManifest=JSON.parse(JSON.stringify(original)),files:Record<string,string>={};
    for(const [name,entry]of Object.entries(manifest.classes)){
      const text=await readFile(path.join('.build/game',entry.file),'utf8')+(changed?'\n// isolated deployment revision\n':'');
      entry.sha256=hash(text);entry.file='generated/'+entry.sha256+'/'+name+'.js';
      const file='characters/'+entry.file;await mkdir(path.dirname(path.join(directory,file)),{recursive:true});await writeFile(path.join(directory,file),text);files[file]=entry.sha256;
    }
    manifest.generation=hash(Object.entries(manifest.classes).map(([name,entry])=>name+':'+entry.sha256).join('\n'));
    const text=JSON.stringify(manifest);await writeFile(path.join(directory,'characters/manifest.json'),text);files['characters/manifest.json']=hash(text);
    manifests.set(id,manifest);
    return store.complete(path.dirname(directory),{schema:1,id,sourceHash:id,createdAt:new Date().toISOString(),components:{dashboard:hash('unchanged-dashboard'),coordinator:hash('coordinator-'+label),characters:manifest.generation},files});
  }
  const first=await stage('mixed-first',false),next=await stage('mixed-next',true);await store.setReferences({active:first.manifest.id,latest:next.manifest.id});
  const drain=safeReload(live.deploymentPaths.directory,async(signal)=>{const response=await fetch(live.deploymentPaths.apiUrl+'/party-api/console-maintenance',{signal});return response.json();});
  const driver=createDeploymentDriver({stopCoordinator:async()=>{},startCoordinator:async(directory)=>{const candidate=await store.verify(path.basename(path.dirname(directory)));await live.restartCoordinatorIdentity(candidate.manifest.id,candidate.manifest.components.coordinator);},
    activateDashboard:async()=>{throw Error('Gameplay-only deployment touched dashboard');},
    reloadCharacters:async(directory)=>{
      const id=path.basename(path.dirname(directory)),manifest=manifests.get(id)!;
      for(const destination of live.deploymentPaths.codeRoots){await cp(path.join(directory,'characters'),destination,{recursive:true});await atomicJson(path.join(destination,'activation.json'),{id,manifest,maintenance:drain.lease,serverNow:Date.now()});}
      return Object.fromEntries(names.map(name=>[name,manifest.classes[({[W]:'warrior',[P]:'priest',[M]:'merchant'} as Record<string,CharacterClass>)[name]].sha256]));
    },observe:async()=>{
      const state=await live.state(),response=await fetch(live.deploymentPaths.apiUrl+'/party-api/build-identity');
      const reports=Object.fromEntries(names.map(name=>[name,{runtime:state.characters[name]?.runtime,hash:state.characters[name]?.codeHash,hold:state.characters[name]?.consoleMaintenance}]));samples.push({at:Date.now(),reports});
      return {coordinator:await response.json(),dashboardHash:first.manifest.components.dashboard,characters:Object.fromEntries(names.filter(name=>state.characters[name]?.consoleMaintenance?.id===drain.lease?.id&&state.characters[name]?.consoleMaintenance?.ready===true).map(name=>[name,state.characters[name]?.codeHash]))};
    }});
  const controller=new ConsoleBuildController(store,{...driver,beginMaintenance:async(operation)=>{await drain.begin(operation.id,operation.mode);},waitUntilSafe:drain.waitUntilSafe,releaseSafeWait:drain.releaseSafeWait},120000);
  try{
    const operation=await controller.deploy(next.manifest.id,'safe');
    await expect.poll(async()=>(await store.journal())?.phase,{timeout:180000}).toBe('complete');
    const final=await live.state();expect(final.characters[W].runtime).toBe('native');expect(final.characters[P].runtime).toBe('headless');expect(final.characters[M].runtime).toBe('headless');
    expect((await store.references()).active).toBe(next.manifest.id);expect(samples.some(sample=>names.every(name=>sample.reports[name].hold?.ready===true))).toBe(true);
    expect(final.characters[W].rip).toBe(false);
    await nativeWalking(origin,'after CODE retirement');
    await info.attach('native-mixed-deployment-barrier',{body:JSON.stringify({operation,journal:await store.journal(),samples}),contentType:'application/json'});
  }finally{await info.attach('native-headless-planner-code-retirement',{body:JSON.stringify({origin,destination,movementSamples,final:await live.state()}),contentType:'application/json'});await drain.releaseSafeWait((await store.journal())?.id||'');}
});
