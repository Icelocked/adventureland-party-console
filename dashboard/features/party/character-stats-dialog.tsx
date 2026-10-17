"use client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Char } from "./char";
import { displayRunSpeed } from "./display-character";
import type { ReactNode, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { GameBox, GameLine } from "./item-card";
import { useStoredBoolean } from "@/hooks/use-stored-boolean";

// docs/character-card.md: the game's character panel (render_character in the game's
// js/html.js) beside every other entry the console computes.
type Effect = { key: string; value: string; color: string; detail?: string };
type Extra = { key: string; label: string; value: string; color: string; note?: ReactNode; effects?: Effect[] };

const HP = "#FF2E46", MP = "#365DC5", ARMOR = "#5C5D5E", RESISTANCE = "#6A5598", SPEED = "#36B89E", ATTACK = "green";

function ExtraEntry({ entry }: { entry: Extra }) {
  // Each breakdown starts open and keeps its open or closed state across characters and reloads.
  const [open, setOpen] = useStoredBoolean(`party-character-effects-${entry.key}`, true);
  const heading = (
    <>
      <span data-label style={{ color: entry.color }}>{entry.label}</span>: {entry.value}{entry.note}
    </>
  );
  if (!entry.effects?.length) return <div data-line={entry.key} className="break-inside-avoid">{heading}</div>;
  return (
    <div data-line={entry.key} className="break-inside-avoid">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="-ml-3 text-left hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#808080]"
      >
        <span aria-hidden className={`inline-block w-3 text-[#808080] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {heading}
      </button>
      {open && entry.effects.map((effect) => (
        <div key={effect.key} data-effect={effect.key} className="pl-3 text-[12px]">
          <span data-value style={{ color: effect.color }}>{effect.value}</span>
          {effect.detail ? <span className="text-[#808080]"> {effect.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function CharacterStatsDialog({
  character,
  onOpenChange,
  returnFocus,
}: {
  character: Char | null;
  onOpenChange: (open: boolean) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  if (!character) return null;
  const primary = String(character.primaryStat || "").toLowerCase();
  const equippedWeaponAttack = Object.entries(character.slots || {})
    .filter(([slot]) => slot === "mainhand" || slot === "offhand")
    .reduce((sum, [, entry]) => sum + Number(entry?.meta?.properties?.attack || 0), 0);
  const attributeEffects = (stat: "str" | "int" | "dex", value: number): Effect[] => {
    const effects: Effect[] = [];
    const attackDivisor = character.ctype === "paladin" && stat === "int" ? 40 : primary === stat ? 20 : 0;
    if (attackDivisor)
      effects.push({ key: "attack", color: ATTACK, value: `+${((equippedWeaponAttack * value) / attackDivisor).toFixed(1)} Attack`,
        detail: `+${(equippedWeaponAttack / attackDivisor).toFixed(2)} per point` });
    if (stat === "str") {
      effects.push({ key: "max_hp", color: HP, value: `+${Math.round(value * 21).toLocaleString()} Max HP`, detail: "+21 per point" });
      effects.push({ key: "armor", color: ARMOR, value: `+${(Math.min(value, 160) + Math.max(0, value - 160) * 0.25).toLocaleString()} Armor`,
        detail: `+${value < 160 ? "1" : "0.25"} per next point` });
      effects.push({ key: "run_speed", color: SPEED, value: `+${(Math.min(value, 256) / 64).toFixed(2)} Run Speed`,
        detail: `+${value < 256 ? "0.0156" : "0"} per next point` });
    } else if (stat === "int") {
      effects.push({ key: "max_mp", color: MP, value: `+${Math.round(value * 15).toLocaleString()} Max MP`, detail: "+15 per point" });
      effects.push({ key: "resistance", color: RESISTANCE, value: `+${(Math.min(value, 180) + Math.max(0, value - 180) * 0.25).toLocaleString()} Resistance`,
        detail: `+${value < 180 ? "1" : "0.25"} per next point` });
      effects.push({ key: "attack_speed", color: "#3BE681", value: `+${(value / 1575).toFixed(3)} Attacks/sec`, detail: "+0.000635 per point" });
    } else {
      effects.push({ key: "run_speed", color: SPEED, value: `+${(Math.min(value, 256) / 32).toFixed(2)} Run Speed`,
        detail: `+${value < 256 ? "0.0313" : "0"} per next point` });
      effects.push({ key: "attack_speed", color: "#3BE681",
        value: `+${(Math.min(160, value) / 640 + Math.max(value - 160, 0) / 925).toFixed(3)} Attacks/sec`,
        detail: `+${value < 160 ? "0.00156" : "0.00108"} per next point` });
    }
    return effects;
  };
  const damageMultiplier = (defense: number) =>
    Math.min(
      1.32,
      Math.max(
        0.05,
        1 -
          (Math.max(0, Math.min(100, defense)) * 0.001 +
            Math.max(0, Math.min(100, defense - 100)) * 0.001 +
            Math.max(0, Math.min(100, defense - 200)) * 0.00095 +
            Math.max(0, Math.min(100, defense - 300)) * 0.0009 +
            Math.max(0, Math.min(100, defense - 400)) * 0.00082 +
            Math.max(0, Math.min(100, defense - 500)) * 0.0007 +
            Math.max(0, Math.min(100, defense - 600)) * 0.0006 +
            Math.max(0, Math.min(100, defense - 700)) * 0.0005 +
            Math.max(0, defense - 800) * 0.0004),
      ),
    );
  const vitality = Number(character.vit || 0);
  const fortitude = Number(character.fortitude || 0);
  const vitalityHp = vitality * (48 + character.level / 3);
  const fortitudeMultiplier = damageMultiplier(fortitude * 5);
  const armorMultiplier = damageMultiplier(Number(character.armor || 0));
  const resistanceMultiplier = damageMultiplier(Number(character.resistance || 0));
  const combat = character.combatStats || {};
  const attribute = (key: "str" | "int" | "dex", label: string, color: string): Extra => ({
    key, label, color, value: Number(character[key] || 0).toLocaleString(), effects: attributeEffects(key, Number(character[key] || 0)),
    note: primary === key ? <span className="text-[gold]"> Primary</span> : undefined,
  });
  const runSpeed = displayRunSpeed(character);
  const plain = (key: string, label: string, color: string, value: string): Extra => ({ key, label, color, value });
  const extras: Extra[] = [
    attribute("str", "Strength", "#F07F2F"),
    attribute("int", "Intelligence", "#3E6EED"),
    attribute("dex", "Dexterity", "#44B75C"),
    { key: "vit", label: "Vitality", color: HP, value: vitality.toLocaleString(), effects: [{ key: "max_hp", color: HP,
      value: `+${Math.round(vitalityHp).toLocaleString()} Max HP`, detail: `${(48 + character.level / 3).toFixed(2)} HP per VIT at level ${character.level}` }] },
    { key: "for", label: "Fortitude", color: "#5F3085", value: fortitude.toLocaleString(), effects: [{ key: "pvp", color: "#9E7BC4",
      value: `${((1 - fortitudeMultiplier) * 100).toFixed(2)}% less incoming PvP damage`, detail: "no PvE reduction" }] },
    { key: "armor", label: "Armor", color: ARMOR, value: Number(character.armor || 0).toLocaleString(), effects: [{ key: "reduction", color: ARMOR,
      value: `${((1 - armorMultiplier) * 100).toFixed(2)}% physical damage reduction`, detail: `a 100-damage physical hit becomes ${(100 * armorMultiplier).toFixed(1)}` }] },
    { key: "resistance", label: "Resistance", color: RESISTANCE, value: Number(character.resistance || 0).toLocaleString(), effects: [{ key: "reduction",
      color: RESISTANCE, value: `${((1 - resistanceMultiplier) * 100).toFixed(2)}% magical damage reduction`,
      detail: `a 100-damage magical hit becomes ${(100 * resistanceMultiplier).toFixed(1)}` }] },
    { key: "run_speed", label: "Run Speed", color: SPEED, value: runSpeed === null ? "Waiting for speed data" : runSpeed.toFixed(2),
      note: runSpeed !== null && character.ctype === "merchant" ? <span className="text-[#808080]"> before movement restrictions</span> : undefined },
    plain("luck", "Luck", "#5DE376", `${Number(character.luck || 100).toLocaleString()}%`),
    plain("crit", "Crit", "#E52967", `${Number(combat.crit || 0).toLocaleString()}%`),
    plain("critdamage", "Crit Damage", "#A8214E", `${(200 + Number(combat.critDamage || 0)).toLocaleString()}%`),
    plain("evasion", "Evasion", "#7AC0F5", `${Number(combat.evasion || 0).toLocaleString()}%`),
    plain("miss", "Miss", "#F36C6E", `${Number(combat.miss || 0).toLocaleString()}%`),
    plain("lifesteal", "Lifesteal", "#9A1D27", `${Number(combat.lifesteal || 0).toLocaleString()}%`),
    plain("manasteal", "Manasteal", "#353C9C", `${Number(combat.manasteal || 0).toLocaleString()}%`),
    plain("dreturn", "D.Return", "#E94959", `${Number(combat.damageReturn || 0).toLocaleString()}%`),
    plain("reflection", "Reflection", "#B484E5", `${Number(combat.reflection || 0).toLocaleString()}%`),
    plain("apiercing", "A.Piercing", ARMOR, Number(combat.armorPiercing || 0).toLocaleString()),
    plain("rpiercing", "R.Piercing", RESISTANCE, Number(combat.resistancePiercing || 0).toLocaleString()),
    plain("pnresistance", "Poison Res.", "#68B84B", Number(combat.poisonResistance || 0).toLocaleString()),
    plain("firesistance", "Fire Res.", "#B42B22", Number(combat.fireResistance || 0).toLocaleString()),
    plain("fzresistance", "Freeze Res.", "#69B1B6", Number(combat.freezeResistance || 0).toLocaleString()),
    plain("phresistance", "Physical Res.", "#69B1B6", Number(combat.physicalResistance || 0).toLocaleString()),
    plain("stresistance", "Status Res.", "#9FA7B6", Number(combat.statusResistance || 0).toLocaleString()),
    plain("blastresistance", "Blast Res.", "#685079", Number(combat.blastResistance || 0).toLocaleString()),
    plain("mp_cost", "MP Cost", MP, Number(combat.mpCost || 0).toLocaleString()),
    plain("heal", "Heal", "#CB83AC", Number(combat.heal || 0).toLocaleString()),
    plain("output", "Output", "#D93319", `${Number(combat.output || 0).toLocaleString()}%`),
  ];
  // The game tags ATT while cursed and ATTSPD while poisoned (info_line in js/html.js).
  const has = (id: string) => (character.conditions || []).some((condition) => condition.id === id);
  const tag = (text: string, color: string) => <span style={{ color }}> [{text}]</span>;
  const heal = Number(combat.heal || 0);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus} showCloseButton={false} className="max-h-[88vh] overflow-y-auto border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-5xl">
        <DialogClose render={<Button variant="outline" size="icon-sm" className="absolute top-2 right-2 border-emerald-700 bg-[#07100f] text-emerald-100 hover:border-emerald-400 hover:bg-[#10251f] hover:text-white" />}>
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{character.name}</DialogTitle>
          <DialogDescription className="uppercase text-emerald-100/55">
            Level {character.level} {character.ctype} {character.primaryStat || ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <GameBox label="Character card" className="w-full shrink-0 sm:w-[14rem]">
            <GameLine line="name" label="NAME" color="gray" value={character.name} />
            <GameLine line="level" label="LEVEL" color="orange" value={character.level} />
            <GameLine line="hp" label="HP" color={HP} value={`${character.hp}/${character.max_hp}`} />
            <GameLine line="mp" label="MP" color={MP} value={`${character.mp}/${character.max_mp}`} />
            {heal > 0 && <GameLine line="heal" label="HEAL" color="#CB83AC" value={Math.round(heal)} />}
            <GameLine line="attack" label="ATT" color={ATTACK} value={<>{Math.round(Number(character.attack || 0))}{has("cursed") && tag("C", "#7D4DAA")}</>} />
            <GameLine line="frequency" label="ATTSPD" color="gray"
              value={<>{Math.round(Number(character.frequency || 0) * 100)}{has("poisoned") && tag("P", "#45993F")}</>} />
            <GameLine line="range" label="RANGE" color="gray" value={Number(character.range || 0)} />
            <GameLine line="speed" label="RUNSPD" color="gray" value={Math.round(Number(character.speed || 0))} />
            <GameLine line="armor" label="ARMOR" color="gray" value={Number(character.armor || 0)} />
            <GameLine line="resistance" label="RESIST." color="gray" value={Number(character.resistance || 0)} />
            <GameLine line="code" label="CODE" color="gold" value="Active" />
          </GameBox>
          <GameBox label="Character extras" className="min-w-[min(100%,20rem)] flex-1 columns-1 gap-6 pl-7 sm:columns-2">
            {extras.map((entry) => <ExtraEntry key={entry.key} entry={entry} />)}
          </GameBox>
        </div>
      </DialogContent>
    </Dialog>
  );
}
