import {isTransition,type Point,type Step} from './contracts.ts';
import {doorDetour} from './door-detour.ts';
import type {ValidationPorts} from './validation.ts';

function sameContext(from:Point,to:Point):boolean{
 return from.map===to.map&&String(from.in??from.map)===String(to.in??to.map);
}
function eligible(ports:ValidationPorts,from:Step,to:Step):boolean{
 return !isTransition(from)&&!isTransition(to)&&sameContext(from,to)&&!ports.walk(from,to)&&
  ports.walk(from,from)&&ports.walk(to,to);
}
/** Small native-certified interior connector; preserves the exact walking step. */
export function walkingInterior(ports:ValidationPorts,from:Step,to:Step):Point[]|undefined{
 if(!eligible(ports,from,to))return;
 const candidates:Point[]=[];
 for(const dx of [-8,0,8])for(const dy of [-8,0,8])candidates.push({...to,x:to.x+dx,y:to.y+dy});
 // Retain the existing detour's near-target distance, expansion and grid bounds.
 const bounded:ValidationPorts={...ports,walk:(a,b)=>sameContext(from,a)&&sameContext(from,b)&&ports.walk(a,b)};
 const connector=doorDetour(bounded,from,to,candidates);
 if(!connector)return;
 let previous:Point=from;
 for(const point of [...connector,to]){
  if(!bounded.walk(previous,point))return;
  previous=point;
 }
 return connector;
}
export function repairWalkingInteriors(ports:ValidationPorts,from:Point,plot:Step[]):Step[]{
 const result:Step[]=[];let previous:Step=from,repaired=0;
 for(const step of plot){
  // The current map already has owned native segment recovery. Future-map
  // edges cannot use that repair without abandoning the cross-map itinerary.
  const connector=step.map!==from.map&&repaired<3?walkingInterior(ports,previous,step):undefined;
  if(connector){result.push(...connector);repaired++;}
  result.push(step);previous=step;
 }
 return result;
}
