// Achievement Hunt target choice (docs/achievement-hunt.md). Pure: no state, no I/O.

export interface AchievementCatalogEntry {
  id: string;
  name?: string;
  hp?: unknown;
  xp?: unknown;
  threat?: unknown;
  definition?: {
    achievements?: unknown;
    special?: unknown;
    cooperative?: unknown;
    stype?: unknown;
    unlist?: unknown;
  } | null;
}
export interface AchievementChoice {
  id: string;
  locations?: readonly unknown[] | null;
}
export interface AchievementMonster {
  id: string;
  name: string;
  /** Kill counts at which each reward is earned, ascending. */
  ladder: number[];
  /** The game's reward for a kill; it follows HP, damage and defenses, so it ranks difficulty. */
  xp: number;
  threat: number;
  hp: number;
  /** Bosses, event, cooperative and random-respawn monsters, monsters the game leaves out of its
   *  list (training dummies, Cave of Many Dreams), and any without a regular spawn. */
  special: boolean;
}
export interface AchievementTarget {
  id: string;
  /** Zero-based position of `milestone` in the monster's own ladder. */
  step: number;
  milestone: number;
  kills: number;
}

/** The kill counts of `G.monsters[id].achievements` entries (`[count, "stat", name, value]`). */
export function milestones(achievements: unknown): number[] {
  if (!Array.isArray(achievements)) return [];
  return achievements
    .map((entry) => (Array.isArray(entry) ? Number(entry[0]) : NaN))
    .filter((count) => Number.isFinite(count) && count > 0)
    .sort((a, b) => a - b);
}

/** Every monster that has achievements, weakest first: by XP, then threat (attack × speed), HP and name.
 *  Threat alone misranks monsters (a Vampire Rat hits harder than a Fire Spirit but has a ninth of its HP). */
export function achievementMonsters(
  catalog: readonly AchievementCatalogEntry[] | null | undefined,
  choices: readonly AchievementChoice[] | null | undefined,
): AchievementMonster[] {
  const routable = new Set((choices || []).filter((choice) => (choice.locations || []).length > 0).map((choice) => choice.id));
  return (catalog || [])
    .map((entry) => {
      const definition = entry.definition || {};
      return {
        id: entry.id,
        name: entry.name || entry.id,
        ladder: milestones(definition.achievements),
        xp: Number(entry.xp) || 0,
        threat: Number(entry.threat) || 0,
        hp: Number(entry.hp) || 0,
        special: !!definition.special || !!definition.cooperative || !!definition.unlist ||
          definition.stype === "randomrespawn" || !routable.has(entry.id),
      };
    })
    .filter((monster) => monster.ladder.length > 0)
    .sort((a, b) => a.xp - b.xp || a.threat - b.threat || a.hp - b.hp || a.name.localeCompare(b.name));
}

/** Index of the first milestone not yet reached, or -1 once the ladder is complete. */
export function nextStep(ladder: readonly number[], kills: number): number {
  return ladder.findIndex((milestone) => kills < milestone);
}

/**
 * The first monster, in list order, whose next milestone is at the lowest step
 * among the selected, not excluded, unfinished monsters: every monster reaches
 * step n before any is farmed for step n + 1.
 */
export function chooseAchievementTarget(
  order: readonly AchievementMonster[],
  selected: ReadonlySet<string>,
  excluded: (id: string) => boolean,
  kills: Readonly<Record<string, number>>,
): AchievementTarget | null {
  let best: AchievementTarget | null = null;
  for (const monster of order) {
    if (!selected.has(monster.id) || excluded(monster.id)) continue;
    const count = Number(kills[monster.id]) || 0;
    const step = nextStep(monster.ladder, count);
    if (step < 0) continue;
    if (!best || step < best.step) best = { id: monster.id, step, milestone: monster.ladder[step]!, kills: count };
  }
  return best;
}

/** Account-wide progress: the highest count any party member's client reports. */
export function partyAchievementKills(
  statuses: Readonly<Record<string, { monsterAchievementKills?: Record<string, unknown> | null } | undefined>>,
  names: readonly string[],
): Record<string, number> {
  const kills: Record<string, number> = {};
  for (const name of names) {
    for (const [id, value] of Object.entries(statuses[name]?.monsterAchievementKills || {})) {
      const count = Number(value);
      if (Number.isFinite(count) && count > (kills[id] || 0)) kills[id] = count;
    }
  }
  return kills;
}
