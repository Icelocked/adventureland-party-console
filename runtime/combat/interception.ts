import type {RecoveryPoint} from './formation-recovery.ts';
/** Numeric native leg projection; no sampled/estimated game velocity enters here. */
interface NativeMotion {vx:number;vy:number;duration:number}
/** Issue-time numeric evidence, separate from game entities and later packet observations. */
export interface CombatPrediction {at:number;target:RecoveryPoint;destination:RecoveryPoint;targetSpeed:number;own:RecoveryPoint;ownSpeed:number;reach:number;horizon:number}
export function copyPrediction(value?:CombatPrediction):CombatPrediction|undefined {
  return value?{...value,target:{...value.target},destination:{...value.destination},own:{...value.own}}:undefined;
}
function interceptionTime(dx:number,dy:number,speed:number,reach:number,motion:NativeMotion):number {
  const a=motion.vx*motion.vx+motion.vy*motion.vy-speed*speed;
  const b=2*(dx*motion.vx+dy*motion.vy-speed*reach),c=dx*dx+dy*dy-reach*reach;
  if(c<=0)return 0;
  if(Math.abs(a)<1e-8)return b<0?-c/b:Infinity;
  const discriminant=b*b-4*a*c;if(discriminant<0)return Infinity;
  const root=Math.sqrt(discriminant),times=[(-b-root)/(2*a),(-b+root)/(2*a)].filter(t=>t>=0);
  return times.length?Math.min(...times):Infinity;
}
export function predictCombatIntercept(self:RecoveryPoint,speed:number,target:RecoveryPoint,reach:number,motion?:NativeMotion):RecoveryPoint {
  const current={x:target.x,y:target.y};
  if(!motion || ![self.x,self.y,target.x,target.y,speed,reach,motion.vx,motion.vy,motion.duration].every(Number.isFinite))return current;
  if(speed<=0 || reach<0 || motion.duration<=0 || Math.hypot(motion.vx,motion.vy)<=0)return current;
  const time=Math.min(2,motion.duration,interceptionTime(target.x-self.x,target.y-self.y,speed,reach,motion));
  return {x:target.x+motion.vx*time,y:target.y+motion.vy*time};
}
