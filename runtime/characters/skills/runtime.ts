import type { CombatRoot, Target } from '../roles/types.ts';
import { effectiveAttackDamageType, monsterAttackBlock } from '../roles/monster-attack-policy.ts';
import { createSkillEngine } from './engine.ts';
import { decision, type Actor, type Combatant, type CombatContext, type SkillDefinition, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';
import { damage, endangered, incomingDps } from './damage.ts';
import { createProjectileTracker } from './projectiles.ts';

interface Host {
  damage_multiplier?(this: void, defense: number): number;
  is_disabled?(actor: Actor): boolean;
  next_skill?: Partial<Record<SkillId, Date>>;
  socket?: { connected: boolean;
    on?(event: string, listener: (data: object) => void): void;
    off?(event: string, listener: (data: object) => void): void;
  };
  entities: Record<string, Combatant>;
  G: typeof G;
  use_skill(id: SkillId, target?: string | string[]): Promise<unknown>;
}
export function mitigation(defense: number): number {
  const rates = [.001, .001, .00095, .0009, .00082, .0007, .0006, .0005];
  const reduction = rates.reduce((sum, rate, i) => sum + Math.max(0, Math.min(100, defense - i * 100)) * rate, 0) + Math.max(0, defense - 800) * .0004;
  const piercing = [.001, .00075, .0005].reduce((sum, rate, i) => sum + Math.max(0, Math.min(50, -defense - i * 50)) * rate, 0) + Math.max(0, -defense - 150) * .00025;
  return Math.min(1.32, Math.max(.05, 1 - reduction + piercing));
}
export function installSkillRuntime(root: CombatRoot) {
  const host = parent as unknown as Host;
  const shared = root.sharedRoutine;
  const projectiles = createProjectileTracker(world);
  function world(): SkillWorld {
    // Normalize the local skill world, never mutate the native player object.
    // Offensive skill definitions retain their own damage_type precedence.
    const actor: Actor = { ...character, damage_type: effectiveAttackDamageType(character, typeof G === 'undefined' ? undefined : G) };
    // combatContext copies every visible monster, the largest console self
    // time in a fighter thread (docs/efficiency.md, CT7). busy(), attack() for
    // classes without attack skills and projectile pruning never read it, so
    // world() builds it on the first read and keeps it for this world.
    let context: CombatContext | undefined;
    const build = (): CombatContext => {
      const built: CombatContext = shared.combatContext?.() || {
        leader: '', tank: null, allies: [], monsters: [], mode: 'blocked', event: null, observedAt: 0,
      };
      if (host.is_disabled?.(actor)) built.mode = 'blocked';
      return built;
    };
    const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
    const result: SkillWorld = {
      actor, get context() { return context ??= build(); }, skills, now: Date.now(),
      item: name => (G.items as Record<string, { wtype?: string; type?: string; charge?: number }>)[name],
      condition: name => (G.conditions as Record<string, ReturnType<SkillWorld['condition']>>)[name],
      cooldown: id => id === 'invis' && !!shared.merchantVisibilityActive?.() || Number(host.next_skill?.[id]) > Date.now(),
      damageMultiplier: host.damage_multiplier || mitigation,
      incoming: t => projectiles.incoming(t.id, Date.now()),
      range: (t, id) => skillRange(actor, t, skills[id]),
      allowed: (t, id) => authorized(result, t, id),
    };
    return result;
  }
  function authorized(w: SkillWorld, t: Combatant, id: SkillId): boolean {
    if(returnTargetBlocked(t,id) || frankySkillBlocked(id, [t]))return false;
    const type = w.skills[id]?.damage_type || 'physical';
    if (id !== 'taunt' && monsterAttackBlock(t.mtype, type, w.actor.range)) return false;
    if (!targetAuthorized(t, id)) return false;
    if (t.target || w.context.mode !== 'scatter') return true;
    const added = { ...w.context, monsters: w.context.monsters.map(m => m.id === t.id ? { ...m, target: w.actor.name } : m) };
    return w.actor.hp - 2 * incomingDps({ ...w, context: added }, w.actor) > w.actor.max_hp * .3;
  }
  function targetAuthorized(t: Combatant, id: SkillId): boolean {
    return !!shared.skillTargetAllowed?.(t as Target) && shared.rareAttackAllowed?.(t as Target, id) !== false;
  }
  const returnExcluded = new Set<string>(['taunt','agitate','charge','dash','blink','scare','stomp','cleave','fanofknives']);
  function returnTargetBlocked(t:Combatant,id:SkillId):boolean {
    return !!shared.returnCombatActive?.() && (returnExcluded.has(id) || !shared.returnAttacker?.(t as Target));
  }
  function returnCastBlocked(d:SkillDecision):boolean {
    if(!shared.returnCombatActive?.())return false;
    if(returnExcluded.has(d.skill))return true;
    return !!world().skills[d.skill]?.hostile && d.targets.some(t=>!shared.returnAttacker?.(t as Target));
  }
  // Area effects and movement skills cannot honor strict boss-only, hold-position combat.
  const frankyExcluded = new Set<string>(['agitate','charge','dash','blink','scare','stomp','cleave','fanofknives']);
  function frankySkillBlocked(id: SkillId, targets: Combatant[]): boolean {
    if (!shared.frankyCombatActive?.()) return false;
    return frankyExcluded.has(id) || !!world().skills[id]?.hostile &&
      targets.some(t => t.type !== 'monster' || t.mtype !== 'franky' || !shared.skillTargetAllowed?.(t as Target));
  }
  function castSkill(d:SkillDecision):Promise<unknown> {
    if (frankySkillBlocked(d.skill, d.targets)) return Promise.reject(new Error('Skill conflicts with Franky-only combat'));
    if(returnCastBlocked(d))return Promise.reject(new Error('Skill conflicts with return movement or attacker-only policy'));
    const argument=d.argument ?? (d.targets.length>1 || world().skills[d.skill]?.multi ? d.targets.map(t=>t.id) : d.targets[0]?.id || d.targets[0]?.name);
    return host.use_skill(d.skill,argument);
  }
  const engine = createSkillEngine({
    world,
    cast:castSkill,
    publishAfterCast: d => {
      const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
      return !!skills[d.skill]?.hostile && d.targets.length > 0 &&
        d.targets.every(t => shared.independentPullActive?.(t as Target));
    },
    evidence: (t, state, action) => shared.queueEvidence?.(t as Target, state, action) || null,
    diagnostic: d => { if (root.partyCombatState) root.partyCombatState.skill = d; },
  });
  shared.skillSupport = () => engine.support();
  shared.skillOffense = t => engine.offense(t);
  shared.absorbLeaderAggro = () => engine.absorb();
  if (shared.combatContext) {
    shared.combatSkillReady = (id, target, category) => engine.ready(decision(id, [target], category));
    shared.castCombatSkill = (id, target, category) => engine.cast(decision(id, [target], category));
  }
  const action = (data: object) => projectiles.action(data);
  const hit = (data: object) => projectiles.hit(data);
  host.socket?.on?.('action', action);
  host.socket?.on?.('hit', hit);
  return { ...engine,
    // A basic attack that would drop the target below zero right now. Used to decide
    // whether a kill-time gear swap (e.g. the designated tank's luck swap) needs to
    // happen before this tick's attack, for a target with no HP-decline history yet.
    lethalBasicAttack: (target: Combatant) => damage(world(), 'attack', target, true) >= target.hp,
    // Used by the designated tank's kill-time luck swap to bail out of weaker gear
    // immediately if it starts taking dangerous damage rather than finish a swap.
    endangeredSelf: () => endangered(world(), world().actor as unknown as Combatant),
    reset() { engine.reset(); projectiles.clear(); },
    stop() {
      engine.stop(); projectiles.clear();
      host.socket?.off?.('action', action); host.socket?.off?.('hit', hit);
    },
  };
}
export function skillRange(actor: Actor, target: Combatant, s?: SkillDefinition): boolean {
  if (!s) return false;
  const base = s.use_range ? actor.range : s.range || actor.range;
  const range = base * (s.range_multiplier || 1) + (s.range_bonus || 0);
  const distanceTo = typeof distance === 'function' ? distance(actor, target) : Math.hypot(actor.x - target.x, actor.y - target.y);
  return distanceTo <= range;
}
