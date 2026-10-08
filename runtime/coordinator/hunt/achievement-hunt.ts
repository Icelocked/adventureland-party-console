// Achievement Hunt, the "achievements" farming mode: chooses farming targets
// from monster kill-achievement progress and hands each one to the regular
// manual-monster convoy (docs/achievement-hunt.md § Failure modes).
import type { ReturnLocation } from "../events/return-types.ts";
import {
  achievementMonsters,
  chooseAchievementTarget,
  nextStep,
  partyAchievementKills,
  type AchievementCatalogEntry,
  type AchievementChoice,
  type AchievementMonster,
  type AchievementTarget,
} from "../../hunt/achievement-policy.ts";
import {
  defaultAchievementHuntSettings,
  type AchievementBlacklistEntry,
  type AchievementHuntSettings,
  type AchievementTargetState,
} from "./achievement-settings.ts";

export interface AchievementHuntState {
  leader: string | null;
  farmingPolicy: string;
  monsterFocus: string[];
  statuses: Record<string, {
    seenAt: number;
    lastDeath?: { at?: number } | null;
    monsterAchievementKills?: Record<string, unknown> | null;
  } | undefined>;
  bestiaryCatalog?: unknown;
  monsterChoices?: AchievementChoice[] | null;
  achievementHunt: AchievementHuntSettings;
  achievementBlacklist: Record<string, AchievementBlacklistEntry>;
  achievementTarget: AchievementTargetState | null;
  achievementMessage: string;
}
export interface AchievementHuntPorts {
  now(): number;
  members(): string[];
  /** Why another owner holds travel right now (dungeon, event, rare hunt, convoy), or null. */
  busy(): string | null;
  destination(id: string): ReturnLocation | null | undefined;
  /** Starts the manual-monster convoy, staying in this mode; null when it could not start. */
  select(id: string, location: ReturnLocation): string[] | null;
  persist(): void;
}

// A focus change this soon after our own switch is still settling, not the player.
const SWITCH_GRACE_MS = 15_000;
// A monster whose route failed is retried after this long.
const UNROUTABLE_RETRY_MS = 10 * 60_000;

const killText = (kills: number, milestone: number, step: number) =>
  `${Math.floor(kills).toLocaleString()} / ${milestone.toLocaleString()} kills (step ${step + 1})`;

export function createAchievementHunt(state: AchievementHuntState, ports: AchievementHuntPorts) {
  const unroutable = new Map<string, number>();

  const settings = (): AchievementHuntSettings => (state.achievementHunt ||= { ...defaultAchievementHuntSettings });
  const say = (message: string): void => { state.achievementMessage = message; };
  function excluded(id: string): boolean {
    const failedAt = unroutable.get(id);
    return !!state.achievementBlacklist[id] || (failedAt !== undefined && ports.now() - failedAt < UNROUTABLE_RETRY_MS);
  }
  function leaderOnline(): boolean {
    const status = state.leader ? state.statuses[state.leader] : undefined;
    return !!status && ports.now() - status.seenAt <= 10_000;
  }
  /** Leaves the mode for Auto, as picking a monster by hand does. */
  function stop(message: string): void {
    state.farmingPolicy = "auto";
    state.achievementTarget = null;
    say(message);
    ports.persist();
  }

  /** Counts each character's death once, and only deaths after the target started. */
  function newDeaths(target: AchievementTargetState, names: string[]): string[] {
    return names.filter((name) => {
      const at = Number(state.statuses[name]?.lastDeath?.at) || 0;
      if (at <= target.startedAt || at === target.counted[name]) return false;
      target.counted[name] = at;
      target.deaths++;
      return true;
    });
  }
  /** Blacklists the target once the party has died there `deathThreshold` times. */
  function recordDeaths(names: string[]): void {
    const target = state.achievementTarget;
    if (!target) return;
    const died = newDeaths(target, names);
    if (!died.length) return;
    const options = settings();
    if (options.blacklistDeaths && target.deaths >= options.deathThreshold) {
      state.achievementBlacklist[target.id] = {
        monsterId: target.id, at: ports.now(), deaths: target.deaths, characters: died,
        reason: `${target.deaths} death${target.deaths === 1 ? "" : "s"} while farming for achievements`,
      };
      state.achievementTarget = null;
    }
    ports.persist();
  }

  /** The player picked something else after our switch settled. */
  function focusChangedByHand(): boolean {
    const current = state.achievementTarget;
    return !!current && JSON.stringify(state.monsterFocus || []) !== JSON.stringify([current.id]) &&
      ports.now() - current.startedAt > SWITCH_GRACE_MS;
  }

  /**
   * Keeps the current target until its milestone is met, so lagging counts never cause a switch.
   * A monster at a lower step (re-selected, unblacklisted, or a route retry) takes over: kills only
   * rise, so that cannot thrash.
   */
  function stillWorking(order: AchievementMonster[], kills: Record<string, number>, best: AchievementTarget | null): boolean {
    const current = state.achievementTarget;
    if (!current || !settings().monsters.includes(current.id) || excluded(current.id)) return false;
    const monster = order.find((entry) => entry.id === current.id);
    const count = Number(kills[current.id]) || 0;
    if (!monster || nextStep(monster.ladder, count) !== current.step || (best && best.step < current.step)) return false;
    say(`Farming ${monster.name}: ${killText(count, current.milestone, current.step)}`);
    return true;
  }

  function switchTo(choice: AchievementTarget | null, order: AchievementMonster[]): void {
    if (!choice) {
      state.achievementTarget = null;
      return say("Nothing left to farm: every selected monster has finished its ladder or is skipped");
    }
    const location = ports.destination(choice.id);
    const started = location ? ports.select(choice.id, location) : null;
    if (!started) {
      unroutable.set(choice.id, ports.now());
      return say(`Skipping ${choice.id}: ${location ? "the party convoy could not be started" : "no known spawn location"}`);
    }
    state.achievementTarget = { id: choice.id, step: choice.step, milestone: choice.milestone, startedAt: ports.now(), deaths: 0, counted: {} };
    const name = order.find((monster) => monster.id === choice.id)?.name || choice.id;
    say(`Farming ${name}: ${killText(choice.kills, choice.milestone, choice.step)}`);
    ports.persist();
  }

  function tick(): void {
    if (state.farmingPolicy !== "achievements") {
      // Another mode was chosen: forget the target; that mode owns travel now.
      if (state.achievementTarget) { state.achievementTarget = null; say(""); ports.persist(); }
      return;
    }
    if (!leaderOnline()) return say("Waiting for an online party leader");
    const names = ports.members();
    recordDeaths(names);
    const busy = ports.busy();
    if (busy) return say(`Waiting: ${busy}`);
    if (focusChangedByHand()) return stop("Switched to Auto: the monster focus was changed by hand");
    const order = achievementMonsters(state.bestiaryCatalog as AchievementCatalogEntry[] | null, state.monsterChoices);
    const kills = partyAchievementKills(state.statuses, names.length ? names : [String(state.leader)]);
    const best = chooseAchievementTarget(order, new Set(settings().monsters), excluded, kills);
    if (!stillWorking(order, kills, best)) switchTo(best, order);
  }

  /** Settings changes forget failed routes, so a fixed spawn is tried again at once. */
  const reset = (): void => unroutable.clear();
  return { tick, reset };
}
