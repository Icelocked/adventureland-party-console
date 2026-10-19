"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memo, useEffect, useId, useRef, useState } from "react";
import {useStoredBoolean} from "@/hooks/use-stored-boolean";
import {CharacterSectionToggle} from "./character-section-toggle";
import { RestockPolicy } from "./restock-policy";

const defaults: RestockPolicy = {
  hp: { min: 5, max: 20, item: "hpot1" },
  mp: { min: 0, max: 0, item: "mpot1" },
  elixirs: [],
  keepElixir: null,
};
/** An elixir the dashboard can offer, from the item catalog. */
export type ElixirOption = { id: string; name: string };
const control = "h-8 rounded border border-emerald-900 bg-[#07100f] px-1 text-xs text-emerald-100";

export const RestockControls = memo(function RestockControls({
  character,
  value,
  elixirOptions,
  onSave,
}: {
  character: string;
  value?: RestockPolicy;
  elixirOptions: ElixirOption[];
  onSave: (character: string, value: RestockPolicy) => Promise<void>;
}) {
  const [open,setOpen]=useStoredBoolean(`party-section:${character}:restock`,false);
  const id=useId();
  const [draft, setDraft] = useState<RestockPolicy>({ ...defaults, ...value }),
    dirty = useRef(false);
  // Character status polling returns a new policy object on every refresh.
  // Reconcile it only while the user has no unsaved local edits.
  useEffect(() => {
    if (!dirty.current) setDraft({ ...defaults, ...value });
  }, [value]);
  const elixirs = draft.elixirs || [];
  const editElixirs = (next: NonNullable<RestockPolicy["elixirs"]>) => { dirty.current = true; setDraft({ ...draft, elixirs: next }); };
  const count = (text: string) => Number(text.replace(/[^0-9]/g, ""));
  const nameOf = (id: string) => elixirOptions.find(option => option.id === id)?.name || id;
  const field = (kind: "hp" | "mp", key: "min" | "max", label: string) => (
    <label className="grid gap-1 font-mono text-[10px] uppercase text-emerald-100/45">
      {label}
      <Input
        inputMode="numeric"
        value={draft[kind]![key]}
        onChange={(event) => {
          dirty.current = true;
          setDraft({
            ...draft,
            [kind]: {
              ...draft[kind],
              [key]: Number(event.target.value.replace(/[^0-9]/g, "")),
            },
          });
        }}
        className="h-8 border-emerald-900 bg-[#07100f] text-xs text-emerald-100"
      />
    </label>
  );
  return (
    <section className="mt-4 border-y border-emerald-900/70">
      <CharacterSectionToggle label="Merchant restock" open={open} controls={id} onToggle={()=>setOpen(value=>!value)}/>
      <div id={id} hidden={!open} className="pb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] text-emerald-100/65">Potion thresholds</span>
        <Button
          aria-label="Save restock"
          size="sm"
          variant="outline"
          onClick={async () => {
            await onSave(character, draft);
            dirty.current = false;
          }}
          className="h-8 border-emerald-800 bg-[#07100f] text-[10px] text-emerald-300 hover:bg-emerald-950 hover:text-emerald-100"
        >
          Save
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {field("hp", "min", "HP min")}
        {field("hp", "max", "HP max")}
        {field("mp", "min", "MP min")}
        {field("mp", "max", "MP max")}
      </div>
      <div className="mt-3 grid gap-2">
        <span className="font-mono text-[10px] text-emerald-100/65">Elixirs</span>
        {elixirs.map((supply, index) => {
          const n = index + 1;
          return <div key={index} className="grid grid-cols-[1fr_4rem_4rem_auto] items-end gap-2">
            <select aria-label={`Elixir ${n}`} className={control} value={supply.item}
              onChange={event => editElixirs(elixirs.map((e, i) => i === index ? { ...e, item: event.target.value } : e))}>
              {!elixirOptions.some(option => option.id === supply.item) && <option value={supply.item}>{nameOf(supply.item)}</option>}
              {elixirOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <Input aria-label={`Elixir ${n} min`} inputMode="numeric" value={supply.min} className="h-8 border-emerald-900 bg-[#07100f] text-xs text-emerald-100"
              onChange={event => editElixirs(elixirs.map((e, i) => i === index ? { ...e, min: count(event.target.value) } : e))} />
            <Input aria-label={`Elixir ${n} max`} inputMode="numeric" value={supply.max} className="h-8 border-emerald-900 bg-[#07100f] text-xs text-emerald-100"
              onChange={event => editElixirs(elixirs.map((e, i) => i === index ? { ...e, max: count(event.target.value) } : e))} />
            <Button aria-label={`Remove elixir ${n}`} size="sm" variant="outline" className="h-8 border-rose-900 bg-[#07100f] text-[10px] text-rose-200"
              onClick={() => editElixirs(elixirs.filter((_, i) => i !== index))}>×</Button>
          </div>;
        })}
        <Button size="sm" variant="outline" disabled={!elixirOptions.length}
          className="h-8 w-fit border-emerald-800 bg-[#07100f] text-[10px] text-emerald-300 hover:bg-emerald-950"
          onClick={() => editElixirs([...elixirs, { item: elixirOptions.find(o => !elixirs.some(e => e.item === o.id))?.id || elixirOptions[0]?.id || "elixirluck", min: 0, max: 1 }])}>
          Add elixir
        </Button>
        <label className="grid gap-1 font-mono text-[10px] uppercase text-emerald-100/45">
          Kept active
          <select aria-label="Elixir kept active" className={control} value={draft.keepElixir || ""}
            onChange={event => { dirty.current = true; setDraft({ ...draft, keepElixir: event.target.value || null }); }}>
            <option value="">None</option>
            {draft.keepElixir && !elixirOptions.some(option => option.id === draft.keepElixir) && <option value={draft.keepElixir}>{nameOf(draft.keepElixir)}</option>}
            {elixirOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-[10px] text-emerald-100/45">The merchant keeps min..max spares of each elixir carried, bought from an NPC or taken from the bank. The kept-active elixir is drunk when none is active; a gear set can name its own. An active elixir is never replaced.</p>
      </div>
    </section>
  );
});
