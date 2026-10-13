import type {RecoveryPoint} from './formation-recovery.ts';
interface Context {key:string;target:string;point:RecoveryPoint;radius:number;allowed:boolean;planned:boolean;selection?:string;committed?:boolean;confirmation?:string}
interface Ports {now():number;context():Context|null;ready():boolean;clear(goal:RecoveryPoint):boolean;goal(point:RecoveryPoint,radius:number):RecoveryPoint|null;start(goal:RecoveryPoint,id:string,direct:boolean):Promise<unknown>;owned(id:string):boolean;cancel(id:string):void;position(id:string,target:string,radius:number,goal:RecoveryPoint|null,phase:string):void}
/** One actor's collision-certified journey; actual native attack range ends it. */
export function createIndependentApproachClient(p:Ports){
 let current:{key:string;target:string;point:RecoveryPoint;radius:number;level:number;id:string;goal:RecoveryPoint|null;pending:boolean;arrived:boolean;failed:boolean;ready:boolean;direct:boolean;issuedAt:number}|null=null,serial=0;
 function stop(){const old=current;current=null;if(old&&p.owned(old.id))p.cancel(old.id);}
 function launch(c:NonNullable<typeof current>){
  c.goal=p.goal(c.point,c.radius);c.arrived=false;c.ready=false;c.failed=false;c.issuedAt=p.now();
  if(!c.goal){c.failed=true;return;}
  c.pending=true;c.direct=p.clear(c.goal);p.position(c.id,c.target,c.radius,c.goal,'routing');
  const issued=c.id;
  try {void p.start(c.goal,c.id,c.direct).then(()=>{if(current===c&&c.id===issued){c.pending=false;c.arrived=true;}},()=>{if(current===c&&c.id===issued){c.pending=false;c.failed=true;}});}
  catch {if(current===c&&c.id===issued){c.pending=false;c.failed=true;}}
 }
 function retireSuperseded(ctx:Context){if(current&&(current.key!==ctx.key||current.target!==ctx.target))stop();}
 function issue(c:NonNullable<typeof current>,ctx:Context){if(p.owned(c.id))p.cancel(c.id);c.point={...ctx.point};c.id='combat-approach:'+ ++serial;launch(c);}
 function mayIssue(c:NonNullable<typeof current>){return p.now()-c.issuedAt>=250;}
 function followTarget(c:NonNullable<typeof current>,ctx:Context){
  if(c.pending&&!c.direct)return false;
  if(!c.pending&&c.level<8&&c.radius>1)return false;
  if(Math.hypot(c.point.x-ctx.point.x,c.point.y-ctx.point.y)<=12||!mayIssue(c))return false;
  issue(c,ctx);return true;
 }
 function advance(c:NonNullable<typeof current>,ctx:Context){
  if(c.pending||!c.arrived&&!c.failed)return true;
  if(c.level>=8||c.radius<=1){p.position(c.id,c.target,c.radius,c.goal,'unreachable');return false;}
  if(!mayIssue(c))return true;
  c.level++;c.radius=Math.max(1,c.radius/2);issue(c,ctx);return true;
 }
 function makeCurrent(ctx:Context){return {key:ctx.key,target:ctx.target,point:{...ctx.point},radius:Math.max(1,ctx.radius),level:0,id:'combat-approach:'+ ++serial,goal:null,pending:false,arrived:false,failed:false,ready:false,direct:false,issuedAt:-Infinity};}
 function waitReady(ctx:Context){
  if(ctx.committed){stop();return false;}
  if(!current)current=makeCurrent(ctx);
  if(p.owned(current.id))p.cancel(current.id);
  current.pending=false;current.failed=false;current.arrived=true;current.ready=true;
  p.position(current.id,current.target,current.radius,current.goal,'ready');return true;
 }
 function readiness(){
  const ctx=p.context();if(!ctx?.allowed||!ctx.selection)return;
  const matching=!current||current.key===ctx.key&&current.target===ctx.target,ready=matching&&p.ready();
  return {selection:ctx.selection,target:ctx.target,at:p.now(),ready,confirmation:ready?ctx.confirmation:undefined};
 }
 function resumeReady(c:NonNullable<typeof current>,ctx:Context){
  if(c.goal&&!c.direct){c.radius=Math.max(1,c.radius/2);c.level=Math.min(8,c.level+1);}
  issue(c,ctx);
 }
 function route(c:NonNullable<typeof current>,ctx:Context){
  if(c.pending&&!p.owned(c.id)){stop();return false;}
  if(c.ready){if(mayIssue(c))resumeReady(c,ctx);else return true;}
  if(!followTarget(c,ctx)&&!advance(c,ctx))return true;
  p.position(c.id,c.target,c.radius,c.goal,c.pending?'routing':'planning');return true;
 }
 function tick(){
  const ctx=p.context();if(!ctx?.allowed){stop();return false;}
  retireSuperseded(ctx);if(p.ready())return waitReady(ctx);
  if(!current){current=makeCurrent(ctx);launch(current);}
  return route(current,ctx);
 }
 return {tick,movement:tick,stop,readiness,report:()=>current?{id:current.id,key:current.key,target:current.target,radius:current.radius,level:current.level,direct:current.direct,pending:current.pending,goal:current.goal,phase:current.ready?'ready':!current.pending&&(current.level>=8||current.radius<=1)?'unreachable':'routing'}:null};
}
