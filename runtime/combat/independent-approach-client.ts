import type {RecoveryPoint} from './formation-recovery.ts';
interface Context {key:string;target:string;point:RecoveryPoint;radius:number;allowed:boolean;planned:boolean;selection?:string;committed?:boolean}
interface Ports {now():number;context():Context|null;ready():boolean;goal(point:RecoveryPoint,radius:number):RecoveryPoint|null;start(goal:RecoveryPoint,id:string):Promise<unknown>;owned(id:string):boolean;cancel(id:string):void;position(id:string,target:string,radius:number,goal:RecoveryPoint|null,phase:string):void}
/** One actor's native journey. Cohort spacing does not participate in admission. */
export function createIndependentApproachClient(p:Ports){
 let current:{key:string;target:string;point:RecoveryPoint;radius:number;level:number;id:string;goal:RecoveryPoint|null;pending:boolean;arrived:boolean;failed:boolean;ready:boolean}|null=null,serial=0;
 function stop(){const old=current;current=null;if(old&&p.owned(old.id))p.cancel(old.id);}
 function launch(c:NonNullable<typeof current>){
  c.goal=p.goal(c.point,c.radius);c.arrived=false;c.ready=false;
  if(!c.goal){c.failed=true;return;}
  c.pending=true;p.position(c.id,c.target,c.radius,c.goal,'routing');
  const issued=c.id;
  try {void p.start(c.goal,c.id).then(()=>{if(current===c&&c.id===issued){c.pending=false;c.arrived=true;}},()=>{if(current===c&&c.id===issued){c.pending=false;c.failed=true;}});}
  catch {if(current===c&&c.id===issued){c.pending=false;c.failed=true;}}
 }
 function retireSuperseded(ctx:Context){
  if(current&&(current.key!==ctx.key||current.target!==ctx.target))stop();
 }
 function followTarget(c:NonNullable<typeof current>,ctx:Context){
  if(Math.hypot(c.point.x-ctx.point.x,c.point.y-ctx.point.y)<=12)return;
  if(p.owned(c.id))p.cancel(c.id);
  c.point={...ctx.point};c.radius=Math.max(1,ctx.radius);c.level=0;c.id='combat-approach:'+ ++serial;launch(c);
 }
 function advance(c:NonNullable<typeof current>){
  if(c.pending||!c.arrived&&!c.failed)return true;
  if(c.level>=8||c.radius<=1){p.position(c.id,c.target,c.radius,c.goal,'unreachable');return false;}
  c.level++;c.radius=Math.max(1,c.radius/2);c.id='combat-approach:'+ ++serial;launch(c);return true;
 }
 function makeCurrent(ctx:Context){return {key:ctx.key,target:ctx.target,point:{...ctx.point},radius:Math.max(1,ctx.radius),level:0,id:'combat-approach:'+ ++serial,goal:null,pending:false,arrived:false,failed:false,ready:false};}
 function waitReady(ctx:Context){
  if(ctx.committed){stop();return false;}
  if(!current?.ready){stop();current=makeCurrent(ctx);current.ready=true;current.arrived=true;}
  p.position(current.id,current.target,current.radius,current.goal,'ready');return true;
 }
 function readiness(){
  const ctx=p.context();if(!ctx?.allowed||!ctx.selection)return;
  const matching=!current||current.key===ctx.key&&current.target===ctx.target;
  return {selection:ctx.selection,target:ctx.target,at:p.now(),ready:matching&&p.ready()};
 }
 function tick(){
  const ctx=p.context();
  if(!ctx?.allowed){stop();return false;}
  retireSuperseded(ctx);
  if(p.ready())return waitReady(ctx);
  if(!current){current=makeCurrent(ctx);launch(current);}
  const c=current;
  followTarget(c,ctx);
  if(c.pending&&!p.owned(c.id)){stop();return false;}
  if(!advance(c))return true;
  p.position(c.id,c.target,c.radius,c.goal,c.pending?'routing':'planning');return true;
 }
 return {tick,movement:tick,stop,readiness,report:()=>current?{id:current.id,key:current.key,target:current.target,radius:current.radius,level:current.level,pending:current.pending,goal:current.goal,phase:current.ready?'ready':!current.pending&&(current.level>=8||current.radius<=1)?'unreachable':'routing'}:null};
}
