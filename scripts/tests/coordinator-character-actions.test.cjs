const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorCharacterCommands} = require('../../runtime/coordinator/http/character-actions.ts');
const {autoItemRuleKey, autoItemRuleMode, sameMarkedItem} = require('../../runtime/coordinator/inventory/item-identity.ts');

function fixture() {
  const state = {merchantCharacter: 'M', nextCommandId: 30, statuses: {W: {}}, commands: {},
    marked: {}, merchantMarked: {}, autoItemMarks: {}, upgrades: {}, autoUpgradeMarks: {}, goldTargets: {},
    compounds: {}, autoCompounds: {}, merchantQueue: [], merchantCurrent: null, merchantWeapon: null,
    merchantDeliveries: {}, withdrawals: {}, bankbois: {}, autoExchanges: {}, purchases: {}, statScrolls: {}, farmAreaState: null};
  const workers = Object.assign(Object.create({Ghost: {}}), {W: {}, M: {}}), calls = [];
  const ports = {navigation: body => {calls.push(['navigation', body.type]);}, farmingLocation: () => null,
    key: autoItemRuleKey, mode: autoItemRuleMode, persist: () => calls.push(['persist']), persistBank: () => calls.push(['bank']),
    queue: (...args) => calls.push(['queue', ...args]), reconcileUpgrades: (...args) => calls.push(['upgrades', ...args]),
    reconcileMarks: (...args) => calls.push(['marks', ...args]), scheduleCompound: () => {}, scheduleExchange: () => {},
    log: () => {}, removeReservations: () => {}, clearIncoming: () => {}, sameItem: sameMarkedItem,
    identity: item => JSON.stringify(item), bankboi: async () => {}};
  const route = createCoordinatorCharacterCommands(state, workers, ports);
  const invoke = body => {let status = 200, result; const res = {status: code => {status = code; return res;}, json: value => {result = value;}};
    route({body}, res); return {status, result};};
  return {state, workers, calls, ports, invoke};
}

test('character action validation rejects unavailable farming and inherited worker names before mutation', () => {
  const t = fixture(), body = {character: 'W', type: 'mark', slot: 1, item: {name: 'leather'}};
  assert.equal(t.invoke({...body, farmingMonsterIds: ['goo']}).status, 400);
  assert.equal(t.invoke({...body, character: 'Ghost'}).status, 400); assert.deepEqual(t.calls, []);
  t.workers.Ghost = {};
  assert.equal(t.invoke({...body, character: 'Ghost'}).status, 200);
  assert.equal(t.state.marked.Ghost[0].item.name, 'leather');
});

test('accepted solo farm commands set personal focus without selecting a party leader',()=>{
 const t=fixture();Object.assign(t.state,{leader:null,followers:{},farmingProfiles:{},monsterFocus:[],monsterFocusByCharacter:{},monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},characterLocations:{}});
 const scopes=require('../../runtime/coordinator/hunt/scopes.ts').createFarmingScopes(t.state);
 t.ports.farmingState=name=>scopes.effective(name);
 t.ports.farmingLocation=(_catalog,_ids,location)=>location;
 t.ports.navigation=()=>null;
 const route=createCoordinatorCharacterCommands(t.state,t.workers,t.ports);
 const send=()=>{let status=200;route({body:{character:'W',type:'character-travel',farmingMonsterIds:['goo'],location:{map:'main',x:0,y:780}}},{status(n){status=n;return this},json(){}});return status};
 assert.equal(send(),200);assert.deepEqual(scopes.profile('W').monsterFocus,['goo']);assert.equal(t.state.leader,null);assert.deepEqual(t.state.followers,{});
 assert.deepEqual(require('../../runtime/coordinator/status/response-party.ts').monsterFocus(scopes.effective('W'),'W'),['goo']);
 scopes.profile('W').monsterFocus=[];t.ports.navigation=()=>({status:409,body:{error:'busy'}});
 // Recreate because handlers capture the navigation function at composition time.
 const rejected=createCoordinatorCharacterCommands(t.state,t.workers,t.ports);
 rejected({body:{character:'W',type:'character-travel',farmingMonsterIds:['goo'],location:{map:'main',x:0,y:780}}},{status(){return this},json(){}});
 assert.deepEqual(scopes.profile('W').monsterFocus,[]);
});
