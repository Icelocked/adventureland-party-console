"use client";
import { GameBox, GameLine } from "./item-card";
import { monsterCardLines, monsterExtras } from "./item-card-lines";

// Extras labels colored by meaning from the game's palette; anything else reads light gray.
const EXTRA_COLORS: Record<string, string> = {
  respawn: "#7AC0F5", aggro: "#E13758", rage: "#F36C6E", charge: "#36B89E", roam: "#36B89E", difficulty: "orange",
  aa: "#E1924D", immune: "#A59FFF", abilities: "#FC5F39", special: "gold", global: "#FFDE2F", announce: "#FFDE2F",
  humanoid: "#C6AA62", cute: "#FD82F0", hit: "#DB2900", slots: "#B484E5", cbuff: "#CB83AC", rbuff: "#CB83AC",
  stationary: "#9FA7B6", passive: "#9FA7B6",
};

// The game's monster card and its extras box, shared by the Bestiary dialog and item
// details. A spawn or skill line links to its details where the dialog can drill in.
// docs/monster-card.md.
export function MonsterCards({ definition, skillName, monsterName, onMonster, onSkill }: {
  definition: Record<string, unknown>;
  skillName: (id: string) => string | undefined;
  monsterName: (id: string) => string | undefined;
  onMonster?: (id: string) => void;
  onSkill?: (id: string) => void;
}) {
  const lines = monsterCardLines(definition, skillName, monsterName);
  const extras = monsterExtras(definition, skillName);
  const link = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#808080]"
    >
      {label}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-3">
      <GameBox label="Monster card" className="min-w-[14rem] flex-1">
        {lines.map((line) => {
          if (line.kind === "text") return <div key={line.key} data-line={line.key} style={{ color: line.color }}>{line.text}</div>;
          const value = line.monster && onMonster ? link(line.value, () => onMonster(line.monster!))
            : line.skill && onSkill ? link(line.value, () => onSkill(line.skill!)) : line.value;
          return <GameLine key={line.key} line={line.key} label={line.label} value={value} color={line.color} />;
        })}
      </GameBox>
      {!!extras.length && (
        <GameBox label="Monster extras" className="min-w-[14rem] flex-1">
          {extras.map(([key, label, value]) => <GameLine key={key} line={key} label={label} value={value} color={EXTRA_COLORS[key] || "#C3C3C3"} />)}
        </GameBox>
      )}
    </div>
  );
}
