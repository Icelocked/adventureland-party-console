const test=require('node:test'),assert=require('node:assert/strict');
const {createCombatChannel}=require('../../runtime/coordinator/status/combat-channel.ts');
const {preserveNewerCombat}=require('../../runtime/coordinator/status/combat-ingestion.ts');

test('fast report returns receipt timing without changing the combat revision',()=>{
 const {createCombatIngestion}=require('../../runtime/coordinator/status/combat-ingestion.ts');
 let now=100,result;const statuses={W:{name:'W'}};
 const ingestion=createCombatIngestion(statuses,{now:()=>now,groupedCombat:()=>now+=7,response:()=>({groupedCombat:null})});
 ingestion.handle('W',{combatOnly:true,travelSample:{sequence:3}},{json:value=>result=value});
 assert.deepEqual(result.combatReportReceipt,{receivedAt:100,evaluatedAt:107,sequence:3});
 assert.equal(typeof result.combatRevision,'string');
});
test('delayed full reports cannot overwrite a newer runtime-bound rare observation',()=>{
 const previous={name:'W',combatSelection:{runtimeId:'r'},rareObservation:{runtimeId:'r',at:200,sightings:['p']}};
 const old={name:'W',combatSelection:{runtimeId:'r'},rareObservation:{runtimeId:'r',at:100,sightings:[]}};
 assert.equal(preserveNewerCombat(old,previous).rareObservation,previous.rareObservation);
 old.combatSelection.runtimeId='new';old.rareObservation.runtimeId='new';
 assert.equal(preserveNewerCombat(old,previous).rareObservation,old.rareObservation);
});
test('rare encounter handoff wakes combat polling even without a selected group target',()=>{
 let control={id:'scan',kind:'patrol'};const channel=createCombatChannel(()=>({rareControl:control,convoySignal:null,groupedCombat:null}));
 let result;channel.wait('W',channel.snapshot('W').combatRevision,{json:v=>result=v});
 control={id:'p',kind:'encounter'};channel.flush();
 assert.equal(result.rareControl.id,'p');assert.equal(result.convoySignal,null);
});
test('queue change wakes waiting followers immediately and replaces duplicate polls',()=>{
 let group={queueRevision:'A',selection:'A',committed:true};const channel=createCombatChannel(()=>({groupedCombat:group}));const responses=[];
 const revision=channel.snapshot('P').combatRevision;
 channel.wait('P',revision,{json:data=>responses.push(data)});channel.flush();assert.equal(responses.length,0);
 group={queueRevision:'B',selection:'B',committed:true};channel.flush();assert.equal(responses.length,1);assert.equal(responses[0].groupedCombat.selection,'B');
 channel.wait('P',channel.snapshot('P').combatRevision,{json:data=>responses.push(data)});
 channel.wait('P',channel.snapshot('P').combatRevision,{json:data=>responses.push(data)});assert.equal(responses.length,2);
 group={queueRevision:'C',selection:'C',committed:true};channel.flush();assert.equal(responses.length,3);
});

test('native confirmation challenge wakes every waiting fighter synchronously without the poll timeout',()=>{
 let group={queueRevision:'A',selection:'A',committed:false,independentApproach:true};
 const channel=createCombatChannel(()=>({groupedCombat:group})),responses=[];
 for(const name of ['W','P','M'])channel.wait(name,channel.snapshot(name).combatRevision,{json:data=>responses.push({name,data})});
 channel.flush();assert.equal(responses.length,0);
 group={...group,independentConfirmation:{id:'A-round1',selection:'A',target:'A',startedAt:1000,expiresAt:4000}};
 channel.flush();assert.equal(responses.length,3);
 assert.deepEqual(responses.map(r=>r.data.groupedCombat.independentConfirmation.id),['A-round1','A-round1','A-round1']);
 const old=channel.snapshot('W').combatRevision;group={...group,independentConfirmation:{...group.independentConfirmation,expiresAt:4500}};
 assert.equal(channel.snapshot('W').combatRevision,old);
 channel.wait('W',old,{json:data=>responses.push({name:'W',data})});group={...group,independentConfirmation:undefined};channel.flush();assert.equal(responses.length,4);
});
