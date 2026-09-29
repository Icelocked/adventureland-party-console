const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorHeartbeatResponse}=require('../../runtime/coordinator/status/response-composition.ts');
function fixture(){
 const state={commands:{},statuses:{},followers:{},monsterFocus:['goo'],monsterFocusByCharacter:{},
  monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},monsterChoices:['catalog'],farmingPolicy:'normal',
  monsterHunt:null,bankQueue:[],bankbois:{},bankSnapshot:{},goldTargets:{},merchantCharacter:'M',gatheringModes:[]};
 let intent={revision:1},waypoint={map:'main'};
 const api=createCoordinatorHeartbeatResponse(state,{
  now:()=>100,activeNames:()=>[],enabled:()=>false,intent:()=>intent,escapeOwns:()=>false,rareControl:()=>null,
  convoySignal:(current,name)=>({current,name}),waypoint:()=>waypoint,resolveArea:(catalog,focus,point)=>({catalog,focus,point}),
  rareEncounter:()=>null,huntOwns:hunt=>!!hunt?.turnIn,mapSubscriberCount:()=>0,
  stackHomes:(bank,bankbois)=>({bank,bankbois}),groupedCombat:()=>null,selectedEvents:current=>current.selection,
  anniversary:()=>null,rareOwns:()=>false,
 });
 return {state,api,setIntent:value=>intent=value,setWaypoint:value=>waypoint=value};
}

test('BankBoi service commands survive repeated heartbeat delivery until completion',()=>{
 const {state,api}=fixture();const command={id:7,type:'bankboi-service'};state.commands.B=command;
 assert.equal(api.response('B').command,command);assert.equal(api.response('B').command,command);
 assert.equal(state.commands.B,command);
});

test('Hunt turn-in reserves only its fighters, never merchant anniversary travel',()=>{
 const {state,api}=fixture();state.monsterHunt={target:null,turnIn:true,participants:['P','M']};
 assert.equal(api.response('P').huntTurnInPriority,true);
 assert.equal(api.response('M').huntTurnInPriority,false,'merchant stays independent even in a restored participant list');
 assert.equal(api.response('B').huntTurnInPriority,false);
 state.monsterHunt.turnIn=null;assert.equal(api.response('P').huntTurnInPriority,false);
});
test('combat-only heartbeat does not deliver or decorate pending navigation commands',()=>{
 const {state,api}=fixture();const command={type:'travel'};state.commands.P=command;
 const response=api.response('P','combat');
 assert.equal(response.convoySignal.current,state);assert.equal(response.convoySignal.name,'P');
 assert.equal(state.commands.P,command);assert.equal(command.navigationRevision,undefined);
 assert.equal(Object.hasOwn(response,'command'),false);
});
