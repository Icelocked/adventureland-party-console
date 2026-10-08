// Achievement Hunt settings and blacklist (docs/achievement-hunt.md).

/** Achievement Hunt runs while farmingPolicy is "achievements"; these are its choices. */
export interface AchievementHuntSettings {
  /** Selected monster ids. The bestiary sets the list order. */
  monsters: string[];
  blacklistDeaths: boolean;
  deathThreshold: number;
}
export interface AchievementBlacklistEntry {
  monsterId: string;
  at: number;
  reason: string;
  deaths?: number;
  characters?: string[];
}
export interface AchievementTargetState {
  id: string;
  step: number;
  milestone: number;
  startedAt: number;
  deaths: number;
  /** Last counted `lastDeath.at` per character, so one death counts once. */
  counted: Record<string, number>;
}

// A rotation visits many easy monsters; one unlucky death should not skip one.
export const defaultAchievementHuntSettings: AchievementHuntSettings = {
  monsters: [],
  blacklistDeaths: true,
  deathThreshold: 3,
};

const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const validThreshold = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100);
const validMonsters = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.length <= 500 && value.every((id) => typeof id === "string" && /^[a-z0-9_]+$/i.test(id)));

export function validAchievementHuntSettings(value: unknown): value is Partial<AchievementHuntSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return optionalBoolean(settings.blacklistDeaths) &&
    validThreshold(settings.deathThreshold) && validMonsters(settings.monsters);
}
