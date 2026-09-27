const {test}=require('node:test'),assert=require('node:assert/strict');
const {previewUpgrade}=require('../../runtime/characters/upgrade-preview.ts');
const {createUpgradePreviews}=require('../../runtime/coordinator/merchant/upgrade-preview.ts');
const {unavailablePreview}=require('../../runtime/upgrade-preview.ts');

function fixture() {
 const item={name:'sword',level:8,rid:'exact'},items=[item,{name:'scroll1',q:4},{name:'offeringp'},{name:'offering'},{name:'offeringx'}],calls=[];
 const request={id:'r',executor:'M',session:'s',slot:0,item:{...item},expiresAt:11000};
 const ports={items:()=>items,grade:()=>1,current:()=>true,now:()=>1000,preview:async(...args)=>{
  calls.push(args);return {calculate:true,chance:0.15321,item:{...item},scroll:'scroll1',...(args[2]===null?{}:{offering:items[args[2]].name}),grace:2};
 }};
 return {items,calls,request,ports};
}
test('all four previews use calculate=true and preserve items, quantities and item grace',async()=>{
 const f=fixture(),before=JSON.stringify(f.items),result=await previewUpgrade(f.request,f.ports);
 assert.deepEqual(f.calls,[[0,1,null,true],[0,1,2,true],[0,1,3,true],[0,1,4,true]]);
 assert.equal(JSON.stringify(f.items),before);assert.equal(result.options.offeringp.preview.grace,2);
 assert.equal(result.options.none.preview.chance,0.15321);
});
test('missing scrolls and offerings never issue fake substitute attempts',async()=>{
 const f=fixture();f.items.splice(2);const result=await previewUpgrade(f.request,f.ports);
 assert.equal(f.calls.length,1);assert.match(result.options.offeringp.reason,/Offering not/);
 f.items.splice(1);f.calls.length=0;const missing=await previewUpgrade(f.request,f.ports);
 assert.equal(f.calls.length,0);assert.match(missing.options.none.reason,/Missing scroll1/);
});
test('slot replacement, session changes and expiry discard previews',async()=>{
 const f=fixture();f.items[0]={name:'sword',level:8,rid:'different'};
 assert.match((await previewUpgrade(f.request,f.ports)).options.none.reason,/Item changed/);assert.equal(f.calls.length,0);
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>{const result=await run(...args);g.items[0]={name:'sword',level:9};return result;};
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/changed/);assert.equal(g.calls.length,1);
 const h=fixture();h.ports.now=()=>12000;await previewUpgrade(h.request,h.ports);assert.equal(h.calls.length,0);
});
test('server rejections and mismatched response identities are unavailable',async()=>{
 const f=fixture();f.ports.preview=async()=>{throw {reason:'cant_in_bank'};};
 assert.equal((await previewUpgrade(f.request,f.ports)).options.none.reason,'Merchant is in the bank');
 const g=fixture(),run=g.ports.preview;g.ports.preview=async(...args)=>({...await run(...args),scroll:'scroll0'});
 assert.match((await previewUpgrade(g.request,g.ports)).options.none.reason,/Mismatched/);
});

function coordinator(saved) {
 const item={name:'sword',level:8},state=saved||{merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],statuses:{M:{seenAt:1000,upgradePreviewSession:'session',upgradePreviewRevision:'0',items:[{slot:0,item}]}}};
 const routes={},service=createUpgradePreviews(state,{persist(){},dispatch(){},stamp:j=>({...j,priority:70})},()=>1000);
 service.install({post:(path,handler)=>routes[path]=handler});
 function send(path,body) {const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;}};routes['/party-api/upgrade-preview'+path]({body},res);return res;}
 const body={character:'M',slot:0,item};
 return {state,item,send,body};
}
test('preview reads do not enqueue; explicit refresh deduplicates and obeys normal job priority',()=>{
 const f=coordinator();assert.equal(f.send('',f.body).value.status,'idle');assert.equal(f.state.merchantQueue.length,0);
 assert.equal(f.send('',{...f.body,refresh:true}).value.status,'queued');f.send('',{...f.body,refresh:true});
 assert.equal(f.state.merchantQueue.length,1);assert.equal(f.state.merchantQueue[0].priority,70);
 f.state.merchantCurrent={...f.state.merchantQueue.shift(),commandId:7};assert.equal(f.send('',f.body).value.status,'running');
});
test('results survive restart and reopening but a real upgrade invalidates every previous preview',()=>{
 const f=coordinator();f.send('',{...f.body,refresh:true});f.state.merchantCurrent={...f.state.merchantQueue.shift(),commandId:7};
 const payload={character:'M',id:f.state.merchantCurrent.id,commandId:7,session:'session',revision:'0',result:unavailablePreview('M',f.item,'not in bank')};
 assert.equal(f.send('/result',{...payload,commandId:8}).statusCode,409);
 assert.equal(f.send('/result',{...payload,session:'stale'}).statusCode,409);
 assert.equal(f.send('/result',payload).statusCode,200);f.state.merchantCurrent=null;
 const g=coordinator(JSON.parse(JSON.stringify(f.state)));
 assert.equal(g.send('',g.body).value.status,'complete');
 g.state.statuses.M.upgradePreviewRevision='123';assert.equal(g.send('',g.body).value.status,'invalidated');
 assert.equal(g.send('',g.body).value.result,undefined);
});
test('changed or foreign items cannot create jobs',()=>{
 const f=coordinator();assert.equal(f.send('',{...f.body,character:'F',refresh:true}).statusCode,400);
 assert.equal(f.send('',{...f.body,item:{name:'sword',level:9},refresh:true}).statusCode,409);assert.equal(f.state.merchantQueue.length,0);
});
function bankFixture() {
 const fs=require('node:fs'),vm=require('node:vm'),{namedFunction}=require('./helpers/named-function.cjs');
 const source=fs.readFileSync('characters/shared.js','utf8'),store=new Map(),calls=[];
 const items=[{name:'sword',level:8},{name:'scroll1',q:3},null,null,null],bank={items0:[{name:'offeringp',q:2},{name:'offeringx'},null]};
 const c=vm.createContext({root:{localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}},
  character:{name:'M',map:'main',items,bank},parent:{},bank_packs:{items0:['bank']},item_grade:()=>1,freeInventorySlots:()=>items.filter(x=>!x).length,
  smart_move:async d=>{calls.push(['move',d]);c.character.map=d;},
  findBankItem:w=>{const slot=bank.items0.findIndex(i=>i?.name===w.name);return slot>=0?{pack:'items0',slot}:null;},
  bankRetrieveConfirmed:async(pack,slot)=>{calls.push(['withdraw',bank[pack][slot].name]);items[items.indexOf(null)]=bank[pack][slot];bank[pack][slot]=null;},
  bankStageConfirmed:async(slot,pack,target)=>{calls.push(['return',items[slot].name]);bank[pack][target]=items[slot];items[slot]=null;}
 });
 vm.runInContext(['previewSuppliesKey','previewTravel','borrowUpgradePreviewSupplies','restoreUpgradePreviewSupplies'].map(n=>namedFunction(source,n)).join('\n'),c);
 return {c,items,bank,store,calls};
}
test('bank supplies are borrowed without buying or consuming, then returned without touching owned scrolls',async()=>{
 const f=bankFixture(),before=JSON.stringify({items:f.items,bank:f.bank});
 await f.c.borrowUpgradePreviewSupplies({item:f.items[0]});assert.equal(f.calls.filter(c=>c[0]==='withdraw').length,2);
 await f.c.restoreUpgradePreviewSupplies();assert.equal(JSON.stringify({items:f.items,bank:f.bank}),before);assert.equal(f.store.size,0);
});
test('lost withdrawal acknowledgement keeps recovery journal and safely returns borrowed supplies',async()=>{
 const f=bankFixture(),withdraw=f.c.bankRetrieveConfirmed;
 f.c.bankRetrieveConfirmed=async(...args)=>{await withdraw(...args);throw Error('lost reply');};
 await assert.rejects(f.c.borrowUpgradePreviewSupplies({item:f.items[0]}),/lost reply/);
 await f.c.restoreUpgradePreviewSupplies();assert.equal(f.bank.items0[0].name,'offeringp');assert.equal(f.store.size,0);
});
test('lost deposit acknowledgement is reconciled without another withdrawal or duplicate return',async()=>{
 const f=bankFixture();await f.c.borrowUpgradePreviewSupplies({item:f.items[0]});const deposit=f.c.bankStageConfirmed;
 f.c.bankStageConfirmed=async(...args)=>{await deposit(...args);throw Error('lost reply');};
 await assert.rejects(f.c.restoreUpgradePreviewSupplies(),/lost reply/);f.c.bankStageConfirmed=deposit;
 await f.c.restoreUpgradePreviewSupplies();assert.equal(f.calls.filter(c=>c[0]==='return').length,2);assert.equal(f.store.size,0);
});


test('preview job retains the upgrade guard until calculation settles and returns supplies before publishing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{namedFunction}=require('./helpers/named-function.cjs');
 const source=fs.readFileSync('characters/shared.js','utf8'),events=[];
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const item={name:'sword',level:8};
 const c=vm.createContext({root:{localStorage:{getItem:()=>null},__merchantActiveJob:{commandId:7},previewPartyUpgrade:()=>pending},
  character:{name:'M',items:[item],q:{}},parent:{},upgradePreviewSession:'session',coordinatorClockOffset:0,
  sameItem:()=>true,runtimeCurrent:()=>true,item_grade:()=>1,upgrade(){throw Error('unexpected real upgrade');},
  borrowUpgradePreviewSupplies:async()=>events.push('borrow'),previewTravel:async()=>events.push('travel'),
  restoreUpgradePreviewSupplies:async()=>events.push('return'),request:async path=>events.push(path)});
 vm.runInContext(namedFunction(source,'merchantUpgradePreview'),c);
 const job=c.merchantUpgradePreview({id:7,jobId:'job',upgradePreview:{slot:0,item}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(c.root.__partyUpgradePreviewInFlight);assert.equal(c.upgrading,true);assert.deepEqual(events,['borrow','travel']);
 finish({executor:'M',item,options:{}});await job;
 assert.equal(c.root.__partyUpgradePreviewInFlight,null);assert.equal(c.upgrading,false);
 assert.deepEqual(events,['borrow','travel','return','/upgrade-preview/result','/merchant/complete']);
});

test('only a real upgrade packet invalidates saved previews',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{namedFunction}=require('./helpers/named-function.cjs'),writes=[];
 const c=vm.createContext({character:{name:'M'},root:{localStorage:{setItem:(...args)=>writes.push(args)}},runtimeCurrent:()=>true,luckySlotTracking:()=>({observe(){}})});
 vm.runInContext(namedFunction(fs.readFileSync('characters/shared.js','utf8'),'luckySlotRollListener'),c);
 c.luckySlotRollListener({calculate:true,chance:0.2});c.luckySlotRollListener({q:{compound:{}}});assert.equal(writes.length,0);
 c.luckySlotRollListener({q:{upgrade:{ms:100}}});assert.equal(writes.length,1);assert.equal(writes[0][0],'party-upgrade-preview-revision:M');
});
