const test=require('node:test'),assert=require('node:assert/strict');
const {createInitialCoordinatorState}=require('../../runtime/coordinator/initial-state.ts');

test('state initialization retains persisted Hunt trip and combat handoff records',()=>{
 const huntEventTrips={W:[{id:'trip',event:'anniversary',startedAt:10}]},combatEventHandoff={startedAt:10,endedAt:20};
 const state=createInitialCoordinatorState({persistedSettings:{huntEventTrips,combatEventHandoff},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:[],configuredRealm:'SR_USII'},
  {now:()=>100,loadBankVaultDefinitions:()=>[]});
 assert.equal(state.huntEventTrips,huntEventTrips);assert.equal(state.combatEventHandoff,combatEventHandoff);
});

for(const merchant of ['FonzeMerch','GoldMajesty'])test('new merchant '+merchant+' has no invented lucky slot',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 assert.deepEqual(initialMerchantRuntime({},merchant).luckyUpgradeSlots,{});
});
test('persisted character-specific lucky slots retain zero and other verified values',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 assert.deepEqual(initialMerchantRuntime({luckyUpgradeSlots:{FonzeMerch:0,Other:41}},'FonzeMerch').luckyUpgradeSlots,{FonzeMerch:0,Other:41});
});
test('retire the old hardcoded slot 7 without mutating saved settings or other slots',()=>{
 const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
 const saved={luckyUpgradeSlots:{GoldMajesty:7,FonzeMerch:0}};
 assert.deepEqual(initialMerchantRuntime(saved,'GoldMajesty').luckyUpgradeSlots,{FonzeMerch:0});
 assert.equal(saved.luckyUpgradeSlots.GoldMajesty,7);
});
