import { blocked, cost, reserve, unlocked } from './eligibility.ts';
import { damage, usefulDamage, purifiable } from './damage.ts';
import { decision, type Combatant, type SkillDecision, type SkillId, type SkillWorld } from './types.ts';

/** A Knife Belt rogue scatter farming mobs that Fan of Knives kills outright. */
export function fanFarming(w: SkillWorld): boolean {
  return fanVerdict(w) === 'lethal';
}
/** Fan-farming judged with the gear worn now; `unseen` while scatter fan-farming has no authorized mob in view. */
export function fanVerdict(w: SkillWorld): 'lethal' | 'weak' | 'unseen' | 'off' {
  if (w.actor.ctype !== 'rogue' || w.context.mode !== 'scatter' || !unlocked(w, 'fanofknives')) return 'off';
  const seen = w.context.monsters.filter(m => w.allowed(m, 'fanofknives'));
  return !seen.length ? 'unseen' : seen.some(m => damage(w, 'fanofknives', m, true) >= m.max_hp) ? 'lethal' : 'weak';
}
const fanLethal = (w: SkillWorld, m: Combatant) => w.allowed(m, 'fanofknives') && damage(w, 'fanofknives', m, true) >= m.max_hp;
/**
 * While fan farming with MP to cast: the spot within Fan of Knives range of the target that keeps
 * the most other one-shot mobs in range (up to its five targets), nearest first. A rogue whose
 * spot already reaches as many stays where it is.
 */
export function fanStand(w: SkillWorld, primary: Combatant): { x: number; y: number } | null {
  if (!fanFarming(w) || w.actor.mp - cost(w, 'fanofknives') < reserve(w)) return null;
  const range = w.skills.fanofknives?.range || 160, reach = Math.max(20, range - 20);
  const cap = w.skills.fanofknives?.max_targets || 5;
  const near = (p: { x: number; y: number }, m: { x: number; y: number }, r: number) => Math.hypot(m.x - p.x, m.y - p.y) <= r;
  const others = w.context.monsters.filter(m => m.id !== primary.id && fanLethal(w, m) && near(primary, m, reach * 2));
  const covered = (p: { x: number; y: number }) => near(p, primary, reach) ? Math.min(cap, 1 + others.filter(m => near(p, m, reach)).length) : 0;
  const here = { x: w.actor.x, y: w.actor.y };
  let best = here, most = covered(here), travel = 0;
  for (const radius of [0, reach / 3, reach * 2 / 3, reach])
    for (let step = 0; step < (radius ? 16 : 1); step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: primary.x + Math.cos(angle) * radius, y: primary.y + Math.sin(angle) * radius };
      const count = covered(spot), distance = Math.hypot(spot.x - here.x, spot.y - here.y);
      if (count > most || count === most && best !== here && distance < travel) { best = spot; most = count; travel = distance; }
    }
  return best;
}
export function attackChoices(w: SkillWorld, primary: Combatant): SkillDecision[] {
  const ids: SkillId[] = w.actor.ctype === 'ranger' ? ['piercingshot', '3shot', '5shot'] :
    w.actor.ctype === 'rogue' ? ['fanofknives'] : [];
  return ids.map(id => {
    const cap = w.skills[id]?.max_targets || (id === '5shot' || id === 'fanofknives' ? 5 : id === '3shot' ? 3 : 1);
    const targets = [primary, ...w.context.monsters.filter(t => t.id !== primary.id)]
      .filter(t => !blocked(w, decision(id, [t])))
      .sort((a, b) => Number(b.id === primary.id) - Number(a.id === primary.id) ||
        usefulDamage(w, id, b) - usefulDamage(w, id, a) || a.id.localeCompare(b.id)).slice(0, cap);
    return decision(id, targets);
  }).filter(d => d.targets.some(t => t.id === primary.id));
}
export function bestAttack(w: SkillWorld, primary: Combatant, affordable: (d: SkillDecision) => boolean): SkillDecision | null {
  const baseline = usefulDamage(w, 'attack', primary);
  const options = attackChoices(w, primary).filter(affordable).map(d => ({ d,
    score: d.targets.reduce((sum, t) => sum + usefulDamage(w, d.skill, t), 0) }));
  options.sort((a, b) => b.score - a.score || cost(w, a.d.skill) - cost(w, b.d.skill));
  // While fan farming, Fan of Knives replaces the basic attack even on a lone target; the MP
  // reserve and potions keep it affordable, and the basic attack is the fallback below the reserve.
  return options[0]?.score > baseline || fanFarming(w) && options[0]?.score >= baseline ? options[0].d : null;
}
function purifyUseful(w: SkillWorld, target: Combatant): boolean {
  if (damage(w, 'purify', target, true) >= target.hp) return true;
  // Purify strips debuffs too. Do not erase another player's damage setup.
  return !purifiable(w, target).some(id => w.condition(id)?.debuff || w.condition(id)?.bad);
}
function independentUseful(w: SkillWorld, id: SkillId, target: Combatant): boolean {
  const remaining = target.hp - w.incoming(target);
  if (remaining <= 0) return false;
  if (id === 'purify') return purifyUseful(w, target);
  // Fan of Knives needs the MP. Mental Burst refunds its damage on a kill, capped at
  // the target's remaining HP, so it only pays for itself on mobs with at least its cost left.
  if (fanFarming(w)) return id === 'mentalburst' && damage(w, id, target, true) >= remaining && remaining >= cost(w, id);
  if (id === 'huntersmark') return markUseful(w, target, remaining);
  if (id === 'supershot') return remaining >= damage(w, id, target) * .5;
  return true;
}
function markUseful(w: SkillWorld, target: Combatant, remaining: number): boolean {
  const owner = w.context.allies.filter(a => a.ctype === 'ranger' && a.mp >= cost(w, 'huntersmark') && w.range(a, 'huntersmark'))
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return owner?.name === w.actor.name && !target.s?.marked &&
    remaining >= damage(w, 'attack', target) * Math.max(1, w.actor.frequency) * 3;
}
export function damageChoices(w: SkillWorld, target: Combatant): SkillDecision[] {
  const classes: Partial<Record<ActorClass, SkillId[]>> = {
    ranger: ['huntersmark', 'supershot'], rogue: ['mentalburst', 'quickstab', 'quickpunch'],
    paladin: ['purify', 'shield_slam', 'smash'],
  };
  const choices = (classes[w.actor.ctype] || []).filter(id => independentUseful(w, id, target))
    .map(id => decision(id, [target])).filter(d => !blocked(w, d));
  const score = (d: SkillDecision) => {
    if (d.skill === 'mentalburst' && damage(w, d.skill, target, true) >= target.hp) return Infinity;
    if (d.skill === 'huntersmark') return Number.MAX_SAFE_INTEGER;
    const divisor = w.context.mode === 'event' ? (w.skills[d.skill]?.cooldown || 1000) / 1000 : Math.max(1, cost(w, d.skill));
    return usefulDamage(w, d.skill, target) / divisor;
  };
  return choices.sort((a, b) => score(b) - score(a));
}
type ActorClass = SkillWorld['actor']['ctype'];
