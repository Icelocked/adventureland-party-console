const test=require('node:test'), assert=require('node:assert/strict');
const rareHunting=require('../rare-hunting.cjs');
const {createMonsterSelectionRoutes}=require('../../runtime/coordinator/http/monster-selection.ts');
function fixture(){
 let code=200,response,writes=0;
 const party={passiveRareHunts:{tinyp:true,phoenix:false,goldenbat:false,cutebee:false}};
 const route=createMonsterSelectionRoutes(party,{validPassive:rareHunting.validPassiveSettings,
  setPassive(settings){Object.assign(party.passiveRareHunts,settings);writes++;}}).passive;
 return {party,writes:()=>writes,post(body){code=200;response=null;const res={status(value){code=value;return res;},json(value){response=value;return res;}};route({body},res);return {code,response};}};
}
test('invalid passive settings are rejected without changing saved preferences',()=>{
 const f=fixture();const before={...f.party.passiveRareHunts};
 for(const body of [{boar:true},{goldenbat:'true'},{cutebee:1},['goldenbat'],{tinyp:true,unknown:false}])assert.equal(f.post(body).code,400);
 assert.deepEqual(f.party.passiveRareHunts,before);assert.equal(f.writes(),0);
});
