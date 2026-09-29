const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorMerchantConfiguration}=require('../../runtime/coordinator/http/merchant-configuration.ts');
function fixture(){
 const state={merchantCharacter:'M',gatheringModes:[],gatheringNoTool:{},merchantActivity:['old'],nextCommandId:10,commands:{},merchantCurrent:null,
  merchantRoutinePriorities:{},merchantAutomations:{},merchantQueue:[],threshold:100,itemCollectionThreshold:5,transferSignatures:{F:'old'}};
 const calls=[];let reasons;
 const service=createCoordinatorMerchantConfiguration(state,{
  ownedType:name=>name==='New'?'merchant':'priest',persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),log:()=>calls.push('log'),
  priorities:{service:50},automations:{'stand bid purchases':true},bidPurchaseReasons:()=>{assert.ok(reasons,'read before initialization');return reasons;},
  stamp:job=>({...job,priority:state.merchantRoutinePriorities.service}),
 });
 function invoke(handler,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,service,invoke,reasons:value=>{reasons=value;}};
}

test('routine checkboxes share the gathering button state and issue one combined command',()=>{
 const t=fixture();t.state.gatheringModes=['mining'];t.state.gatheringNoTool={fishing:true};
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});
 assert.deepEqual(t.state.gatheringModes,['fishing']);assert.deepEqual(t.state.commands.M,{id:10,type:'merchant-gather',modes:['fishing']});
 assert.equal(t.state.gatheringNoTool.fishing,undefined);
 t.invoke(t.service.priorities,{priorities:{},enabled:{fishing:true,mining:false}});assert.equal(t.state.nextCommandId,11);
 t.invoke(t.service.settings.gather,{mode:'fishing',enabled:false});assert.deepEqual(t.state.gatheringModes,[]);
});


test('upgrade batch setting defaults to one and persists only valid integer limits', () => {
 const t=fixture();
 assert.equal(t.invoke(t.service.thresholds,{threshold:100}).body.buyUpgradeBatchSize,1);
 for(const value of [0,43,1.5,'invalid']) assert.equal(t.invoke(t.service.thresholds,{buyUpgradeBatchSize:value}).code,400);
 assert.equal(t.state.buyUpgradeBatchSize,undefined);
 assert.equal(t.invoke(t.service.thresholds,{buyUpgradeBatchSize:10}).code,200);
 assert.equal(t.state.buyUpgradeBatchSize,10);
 const {initialCollectionState}=require('../../runtime/coordinator/inventory/initial-collection.ts');
 assert.equal(initialCollectionState({},{}).buyUpgradeBatchSize,1);
 assert.equal(initialCollectionState({buyUpgradeBatchSize:10},{}).buyUpgradeBatchSize,10);
 const {validators}=require('../../runtime/coordinator/persistence/dashboard-import.ts');
 assert.equal(validators.buyUpgradeBatchSize(10),true);
 assert.equal(validators.buyUpgradeBatchSize(1.5),false);
});
