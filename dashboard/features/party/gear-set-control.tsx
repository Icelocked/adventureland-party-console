"use client";
import { memo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePartyAction } from "./query-actions";
import { usePanelModel } from "./use-panel-model";
import type { Char } from "./char";
import type { InventoryModel } from "./character-card-model";
import type { PartyState } from "./party-state";

type GearSetItem = { name: string; level?: number; p?: string; stat_type?: string };
type GearSets = NonNullable<PartyState["gearSets"]>[string];
const SETS = [
  ["luck", "Luck", "Worn by the designated tank right before a kill"],
  ["tank", "Tank", "Restored after the kill"],
  ["fan", "Fan farm", "Rogue: worn while scatter farming mobs Fan of Knives one-shots"],
] as const;

function member(item: { name?: string; level?: number; p?: string; stat_type?: string } | null | undefined, wanted: GearSetItem) {
  return !!item && item.name === wanted.name && (item.level ?? undefined) === (wanted.level ?? undefined) &&
    (item.p ?? undefined) === (wanted.p ?? undefined) && (item.stat_type ?? undefined) === (wanted.stat_type ?? undefined);
}
/** Per slot: worn in that slot, carried in the bag (each copy counted once), or missing. */
function completeness(char: Char, slots: Record<string, GearSetItem>) {
  const taken = new Set<number>(), missing: string[] = [];
  let worn = 0, carried = 0;
  for (const [slot, wanted] of Object.entries(slots)) {
    if (member(char.slots?.[slot]?.item, wanted)) { worn++; continue; }
    const index = (char.items || []).findIndex((entry, i) => !taken.has(i) && member(entry?.item, wanted));
    if (index >= 0) { taken.add(index); carried++; } else missing.push(slot);
  }
  return { total: Object.keys(slots).length, worn, carried, missing };
}

export const GearSetControl = memo(function GearSetControl({ name, model, sets }: { name: string; model: InventoryModel; sets: GearSets | undefined }) {
  const saved = SETS.filter(([id]) => sets?.[id]).length;
  return <Popover>
    <PopoverTrigger className="cursor-pointer whitespace-nowrap rounded border border-slate-500 bg-[#101c1a] px-2 py-1 text-xs text-emerald-100 hover:bg-[#20332e]">Gear sets ({saved}) ▾</PopoverTrigger>
    <PopoverContent align="start" className="w-96 max-w-[calc(100vw-1rem)] space-y-3 rounded border border-slate-500 bg-[#101c1a] p-3 text-xs text-emerald-50 shadow-xl">
      <GearSetDetails name={name} model={model} sets={sets} />
    </PopoverContent>
  </Popover>;
});

/** Mounted only while the popover is open; bag and equipment arrive through the inventory subscription, not the presence state. */
function GearSetDetails({ name, model, sets }: { name: string; model: InventoryModel; sets: GearSets | undefined }) {
  const action = usePartyAction();
  const update = (set: string, kind: "save" | "clear" | "equip") => action.mutate({ path: "/gear-sets", body: { character: name, set, action: kind } });
  const char: Char | undefined = usePanelModel(model, { inventory: true }).state.characters[name];
  const loaded = !!char && Array.isArray(char.items) && !!char.slots;
  return <>
      <p className="text-slate-300">Sets are saved from the gear {name} is wearing, every slot included. Equip wears a saved set from the bag and pauses the tank&apos;s automatic return to its tank set for 10 minutes, so you can adjust and save again. Set members are never taken by automatic compound, upgrade or cleanout rules.</p>
      {SETS.map(([id, label, purpose]) => {
        const set = sets?.[id], state = set && loaded && completeness(char, set.slots as Record<string, GearSetItem>);
        return <section key={id} aria-label={`${label} gear set`} className="space-y-1 rounded border border-slate-600 bg-[#0b1513] p-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-emerald-200">{label}</span>
            <span className="text-slate-400">{purpose}</span>
          </div>
          <p className="text-emerald-50">{!set ? "Not saved" : !state ? "Loading inventory…" : `${state!.worn + state!.carried}/${state!.total} pieces available (${state!.worn} worn, ${state!.carried} in bag)` +
            (state!.missing.length ? ` · missing ${state!.missing.join(", ")}` : "")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={action.isPending} onClick={() => update(id, "save")}
              className="rounded border border-emerald-600 bg-slate-950 px-2 py-1 text-emerald-100 hover:bg-emerald-950 disabled:opacity-50">Save current gear as {label}</button>
            {set && <button type="button" disabled={action.isPending} onClick={() => update(id, "equip")}
              className="rounded border border-sky-600 bg-slate-950 px-2 py-1 text-sky-100 hover:bg-sky-950 disabled:opacity-50">Equip {label}</button>}
            {set && <button type="button" disabled={action.isPending} onClick={() => update(id, "clear")}
              className="rounded border border-rose-700 bg-slate-950 px-2 py-1 text-rose-200 hover:bg-rose-950 disabled:opacity-50">Clear</button>}
          </div>
        </section>;
      })}
      {action.error && <p role="alert" className="text-rose-300">{action.error.message}</p>}
  </>;
}
