import type {RecoveryPoint} from './formation-recovery.ts';
interface Node extends RecoveryPoint {cost:number;rank:number;parent?:Node}
/** Incremental multi-goal A*: every edge uses the caller's live collision/safety rule. */
export function recoveryRoute(origin:RecoveryPoint, destination:RecoveryPoint|RecoveryPoint[], clear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean) {
  const start={x:origin.x,y:origin.y},goals=Array.isArray(destination)?destination:[destination];
  const open:Node[]=[],costs=new Map<string,number>();
  let expanded=0,finished=false,spacing=16;
  const distance=(a:RecoveryPoint,b:RecoveryPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
  const key=(p:RecoveryPoint)=>`${Math.round((p.x-start.x)/spacing)},${Math.round((p.y-start.y)/spacing)}`;
  const heuristic=(p:RecoveryPoint)=>Math.min(...goals.map(g=>distance(p,g)));
  const limit=Math.max(...goals.map(g=>distance(start,g)),0)+768;
  function push(n:Node){let i=open.length;open.push(n);while(i){const parent=(i-1)>>1;if(open[parent]!.rank<=n.rank)break;open[i]=open[parent]!;i=parent;}open[i]=n;}
  function pop(){const first=open[0]!,last=open.pop()!;if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1]!.rank<open[child]!.rank)child++;if(open[child]!.rank>=last.rank)break;open[i]=open[child]!;i=child;}open[i]=last;}return first;}
  function reset(){expanded=0;open.length=0;costs.clear();costs.set(key(start),0);push({...start,cost:0,rank:heuristic(start)});}
  function path(node:Node,goal:RecoveryPoint){const result:RecoveryPoint[]=[goal];let n:Node|undefined=node;while(n?.parent){result.unshift({x:n.x,y:n.y});n=n.parent;}return result;}
  reset();
  return {tick():RecoveryPoint[]|null|undefined {
    if(finished||!goals.length)return null;
    const deadline=performance.now()+4;
    for(let i=0;i<512&&open.length&&expanded<16384&&performance.now()<deadline;i++){
      const current=pop();if(current.cost>(costs.get(key(current))??Infinity))continue;expanded++;
      for(const goal of [...goals].sort((a,b)=>distance(current,a)-distance(current,b)))if(clear(current,goal)){finished=true;return path(current,goal);}
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){
        if(!x&&!y)continue;
        const next={x:current.x+x*spacing,y:current.y+y*spacing},cost=current.cost+distance(current,next);
        if(cost>=(costs.get(key(next))??Infinity)||distance(start,next)>limit||!clear(current,next))continue;
        costs.set(key(next),cost);push({...next,cost,rank:cost+heuristic(next),parent:current});
      }
    }
    if(!open.length||expanded>=16384){if(spacing===16){spacing=8;reset();return;}finished=true;return null;}
  }};
}

/** Retain a combat detour across ticks; return only a live-validated next segment. */
export function createCombatApproachRoute(){
  let liveClear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean=()=>false;
  let selected:{key:string;search:ReturnType<typeof recoveryRoute>;path?:RecoveryPoint[];endpoint?:RecoveryPoint;failedAt?:number}|undefined;
  return {next(key:string,self:RecoveryPoint,goals:RecoveryPoint[],clear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean):RecoveryPoint|undefined{
    liveClear=clear;
    if(selected?.key!==key || selected.failedAt!==undefined&&Date.now()-selected.failedAt>=1000 ||
        selected.path?.length===0 && selected.endpoint && distance(self,selected.endpoint)>=6)
      selected={key,search:recoveryRoute(self,goals,(a,b)=>liveClear(a,b))};
    if(!selected.path){const result=selected.search.tick();if(result===null){selected.failedAt??=Date.now();return;}if(!result)return;selected.path=result;selected.endpoint=result.at(-1);}
    while(selected.path.length&&distance(self,selected.path[0]!)<6)selected.path.shift();
    if(!selected.path.length)return;
    let next:RecoveryPoint|undefined,index=0;
    for(let i=0;i<selected.path.length;i++){const point=selected.path[i]!;if(!clear(self,point))break;next=point;index=i;}
    if(next && index)selected.path.splice(0,index);
    if(!next){selected=undefined;return;}
    return next;
  },status(){return selected?.failedAt!==undefined?'unreachable':selected?.path?(selected.path.length?'routing':'arrived'):'planning';},reset(){selected=undefined;}};
}
function distance(a:RecoveryPoint,b:RecoveryPoint){return Math.hypot(a.x-b.x,a.y-b.y);}
