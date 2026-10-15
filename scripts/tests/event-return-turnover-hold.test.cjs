const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const c=vm.createContext({root:{__partyEventRecoveryCycleId:'event-1'},character:{name:'W',map:'main',in:'main',rip:false},
  navigationIntent:{cancelled:false},escapeOwns:()=>false,combatRecoveryActive:()=>false,
  eventReturnPending:false,convoyTraveling:null,parent:{entities:{}},isAttackingPartyMember:e=>e.target==='W'||e.target==='P',is_in_range:()=>true});
 vm.runInContext(['eventExitOwnsMovement','returnCombatActive','returnAttacker','returnDefenseTarget'].map(name=>namedFunction(source,name)).join('\n'),c);return c;
}
test('ordered backend event cycle preserves movement ownership after local CODE continuation disappears',()=>{
 const c=fixture();assert.equal(c.eventExitOwnsMovement(),true);assert.equal(c.returnCombatActive(),true);
 c.root.__partyEventRecoveryCycleId=null;assert.equal(c.eventExitOwnsMovement(),false);assert.equal(c.returnCombatActive(),false);
 c.root.__partyEventRecoveryCycleId='';assert.equal(c.eventExitOwnsMovement(),false);assert.equal(c.returnCombatActive(),false);
});
test('retained exit remains defensive only and does not authorize nearby unclaimed monsters',()=>{
 const c=fixture(),idle={id:'idle',type:'monster',visible:true,hp:100,map:'main',in:'main',target:null};
 c.parent.entities={idle};assert.equal(c.returnCombatActive(),true);assert.equal(c.returnDefenseTarget(),null);
 const attacker={...idle,id:'attacker',target:'P'};c.parent.entities.attacker=attacker;assert.equal(c.returnDefenseTarget().id,'attacker');
 for(const mutation of [{dead:true},{hp:0},{map:'other'},{in:'other-instance'},{target:'stranger'}]){
  c.parent.entities.attacker={...attacker,...mutation};assert.equal(c.returnDefenseTarget(),null);
 }
});
test('retained exit cannot override disengagement death Escape or emergency combat recovery',()=>{
 for(const mutate of [c=>c.character.rip=true,c=>c.navigationIntent.cancelled=true,c=>c.escapeOwns=()=>true,c=>c.combatRecoveryActive=()=>true]){
  const c=fixture();mutate(c);assert.equal(c.returnCombatActive(),false);
 }
});
