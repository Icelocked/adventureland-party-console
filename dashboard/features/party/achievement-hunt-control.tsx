"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { achievementMonsters, nextStep, type AchievementMonster } from "../../../runtime/hunt/achievement-policy";
import type { AchievementHuntSettings } from "../../../runtime/coordinator/hunt/achievement-settings";
import { HuntBlacklistPicker } from "./hunt-blacklist-picker";
import type { MonsterChoice } from "./monster-choice";
import type { PartyState } from "./party-state";

const control = "border border-emerald-600 bg-[#07110f] text-emerald-100 hover:border-emerald-300 hover:bg-emerald-950 hover:text-white";
// Phoenix needs a route order and the Fairy passive hunting; the coordinator rejects both.
const untargetable = new Set(["phoenix", "tinyp"]);

type Patch = Partial<AchievementHuntSettings>;

function progress(monster: AchievementMonster, kills: number): string {
  const step = nextStep(monster.ladder, kills);
  return step < 0
    ? `${Math.floor(kills).toLocaleString()} kills · ladder complete`
    : `${Math.floor(kills).toLocaleString()} / ${monster.ladder[step]!.toLocaleString()} · step ${step + 1}`;
}

/** Achievement Hunt (docs/achievement-hunt.md): farms selected monsters for their kill achievements. */
export function AchievementHuntControl({
  state, kills, catalog, onSave, onBlacklist, renderMonsterDetails,
}: {
  state: Pick<PartyState, "achievementHunt" | "achievementBlacklist" | "achievementTarget" | "achievementMessage" | "bestiaryCatalog" | "monsterChoices" | "farmingPolicy">;
  kills: Record<string, number>;
  catalog: MonsterChoice[];
  onSave: (patch: Patch) => Promise<void>;
  onBlacklist: (action: "add" | "remove" | "clear", monsterId?: string) => Promise<void>;
  renderMonsterDetails?: (id: string, onClose: () => void) => ReactNode;
}) {
  const settings = state.achievementHunt;
  const blacklist = state.achievementBlacklist || {};
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const monsters = useMemo(
    () => achievementMonsters(state.bestiaryCatalog as never, state.monsterChoices as never).filter((m) => !untargetable.has(m.id)),
    [state.bestiaryCatalog, state.monsterChoices],
  );
  const regular = monsters.filter((m) => !m.special), special = monsters.filter((m) => m.special);
  const selected = new Set(settings?.monsters || []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save Achievement Hunt"); }
    finally { setBusy(false); }
  }
  const save = (patch: Patch) => run(() => onSave(patch));
  const choose = (ids: string[]) => save({ monsters: ids });
  const toggle = (id: string) => choose(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id]);
  // "Up to here": every regular monster from the weakest through this one; special picks are kept.
  const upTo = (index: number) => choose([...regular.slice(0, index + 1).map((m) => m.id), ...special.filter((m) => selected.has(m.id)).map((m) => m.id)]);
  if (!settings) return null;
  const hunting = state.farmingPolicy === "hunt";
  const row = (monster: AchievementMonster, index: number | null) => (
    <div key={monster.id} className={`flex items-center gap-2 rounded border p-2 ${blacklist[monster.id] ? "border-rose-900 opacity-60" : "border-emerald-800"} bg-[#07110f]`}>
      <input type="checkbox" aria-label={`Farm ${monster.name} for achievements`} checked={selected.has(monster.id)} disabled={busy} onChange={() => void toggle(monster.id)} className="h-4 w-4 accent-emerald-500" />
      <span className="min-w-0 flex-1 text-sm text-emerald-50">
        {monster.name}
        <span className="block font-mono text-xs text-emerald-200">{progress(monster, Number(kills[monster.id]) || 0)}{blacklist[monster.id] ? " · blacklisted" : ""}</span>
      </span>
      {index !== null && <Button size="sm" className={control} disabled={busy} onClick={() => void upTo(index)}>Up to here</Button>}
    </div>
  );
  return (
    <section aria-label="Achievement Hunt" className="mt-3 space-y-2 rounded border border-emerald-800 bg-[#081713] p-3 text-emerald-50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Achievement Hunt</span>
        <Button size="sm" className={control} disabled={busy || (hunting && !settings.enabled) || !selected.size} onClick={() => void save({ enabled: !settings.enabled })}>
          {settings.enabled ? "Stop" : "Start"}
        </Button>
      </div>
      <p className="text-xs text-emerald-100/80">
        {hunting && !settings.enabled ? "Turn off Hunt mode to start." : state.achievementMessage || "Off"}
        {" · "}{selected.size} selected · fight style follows Auto/Default/Scatter
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className={control} onClick={() => { setError(""); setOpen(true); }}>Choose monsters…</Button>
        <HuntBlacklistPicker catalog={catalog.filter((m) => monsters.some((x) => x.id === m.id))} blacklist={blacklist} disabled={busy} onAdd={(id) => run(() => onBlacklist("add", id))} renderMonsterDetails={renderMonsterDetails} />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={settings.blacklistDeaths} disabled={busy} onChange={(e) => void save({ blacklistDeaths: e.target.checked })} className="h-4 w-4 accent-emerald-500" />
        Blacklist after
        <input aria-label="Achievement Hunt death threshold" type="number" min={1} max={100} defaultValue={settings.deathThreshold} disabled={busy || !settings.blacklistDeaths}
          onBlur={(e) => { const value = Number(e.target.value); if (Number.isSafeInteger(value) && value >= 1 && value <= 100 && value !== settings.deathThreshold) void save({ deathThreshold: value }); }}
          className="w-14 rounded border border-emerald-600 bg-[#07110f] px-1 text-emerald-50" />
        deaths
      </label>
      {Object.keys(blacklist).length > 0 && (
        <div aria-label="Achievement Hunt blacklist" className="space-y-1">
          {Object.values(blacklist).map((entry) => (
            <div key={entry.monsterId} className="flex items-center justify-between gap-2 text-xs">
              <span>{monsters.find((m) => m.id === entry.monsterId)?.name || entry.monsterId} · {entry.reason}</span>
              <Button size="sm" className={control} disabled={busy} onClick={() => void run(() => onBlacklist("remove", entry.monsterId))}>Remove</Button>
            </div>
          ))}
          <Button size="sm" className={control} disabled={busy} onClick={() => void run(() => onBlacklist("clear"))}>Clear blacklist</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Achievement Hunt monsters</DialogTitle>
            <DialogDescription className="text-emerald-100/80">
              Weakest first. Every selected monster reaches its next milestone before any moves to the one after.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button size="sm" className={control} disabled={busy} onClick={() => void choose(regular.map((m) => m.id))}>All regular</Button>
            <Button size="sm" className={control} disabled={busy} onClick={() => void choose([])}>None</Button>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain">
            <section aria-label="Regular monsters" className="space-y-2">{regular.map((m, i) => row(m, i))}</section>
            <h3 className="pt-2 text-sm font-semibold">Special monsters</h3>
            <p className="text-xs text-emerald-100/70">Bosses, event, cooperative and random-respawn monsters, and any without a regular spawn. Never selected by “Up to here”.</p>
            <section aria-label="Special monsters" className="space-y-2">{special.map((m) => row(m, null))}</section>
          </div>
          {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
