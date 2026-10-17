import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";

// A port of the game's item card (render_item in the game's js/html.js): its line
// order, English labels (languages/en/interface.js) and colors (colors in
// js/old_common_functions.js plus the literals in render_item). docs/item-card.md.
export type ItemCardLine =
  | { kind: "prop"; key: string; label: string; value: string; color: string; valueColor?: string; skill?: string }
  | { kind: "text"; key: string; text: string; color: string };

type Values = Record<string, unknown>;
// Definition values are loosely typed game data; only primitives print.
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";

const COLORS = {
  hp: "#FF2E46", mp: "#3A62CE", attack: "#DB2900", range: "#93A6A2", armor: "#5C5D5E", resistance: "#6A5598",
  str: "#F07F2F", int: "#3E6EED", dex: "#44B75C", for: "#5F3085", speed: "#36B89E", lifesteal: "#9A1D27",
  manasteal: "#353C9C", poison: "#41834A", ability: "#ff9100", gold: "gold", gray: "gray", text: "#C3C3C3",
};

const WEAPON_TYPES: Record<string, string> = {
  sword: "Sword", short_sword: "Short Sword", great_sword: "Great Sword", axe: "Axe", wblade: "Magical Sword",
  basher: "Basher", dartgun: "Dart Gun", bow: "Bow", crossbow: "Crossbow", rapier: "Rapier", spear: "Spear",
  fist: "Fist Weapon", dagger: "Dagger", stars: "Throwing Stars", mace: "Mace", pmace: "Priest Mace", staff: "Staff",
  wand: "Wand", quiver: "Quiver", shield: "Shield", misc_offhand: "Misc Offhand", source: "Source",
};
const OFFHAND_TYPES = new Set(["quiver", "shield", "misc_offhand", "source"]);
export const STAT_NAMES: Record<string, string> = { str: "Strength", int: "Intelligence", dex: "Dexterity", vit: "Vitality", for: "Fortitude" };

// Abilities with their own game description; {value} is attr0 and {value2} attr1.
const ABILITIES: Record<string, { name: string; color: string; text?: string }> = {
  bash: { name: "Bash", color: COLORS.ability, text: "Stuns the opponent for {value} seconds with {value2}% chance." },
  freeze: { name: "Freeze", color: "#2EBCE2", text: "Freezes the opponent with a {value}% chance." },
  poison: { name: "Poison", color: COLORS.poison, text: "Poisons the opponent with a {value}% chance." },
  burn: { name: "Burn", color: "#E03D31", text: "Burns the opponent with a {value}% chance. Deals damage over time." },
  weave: { name: "Weave", color: "#AAA9D2", text: "Each hit slows the opponent more and more." },
  secondchance: { name: "Second Chance", color: COLORS.ability, text: "Avoid death with a {value}% chance." },
  sugarrush: { name: "Sugar Rush", color: "#D64770", text: "Trigger a Sugar Rush on attack with {value}% chance. Gain 240 Attack Speed for 10 seconds!" },
  charm: { name: "Charm", color: "#D64770", text: "Charm an enemy with {value}% chance. Activate the ability from the 'SKILLS' system." },
  restore_mp: { name: "Restore MP", color: "#5D9ED9", text: "Instead of using MP, skills restore 2X the amount with {value}% chance." },
};

const GRADES = [null, { name: "High", color: "#696354" }, { name: "Rare", color: "#6668AC" },
  { name: "Legendary", color: "#39A868" }, { name: "Exalted", color: "#2875F9" }];

// to_pretty_float and to_pretty_num in the game's js/old_common_functions.js.
export const prettyFloat = (value: number) => (0 + Math.trunc((value || 0) * 100) / 100).toLocaleString("en-US");
export const prettyNum = (value: number) => (Math.floor(value || 0) + 0).toLocaleString("en-US");
const signed = (value: number, text = String(value)) => (value > 0 ? "+" : "") + text;
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

// calculate_item_grade in the game's js/old_common_functions.js.
export function itemGrade(definition: Values, level: number): number {
  if (!(definition.upgrade || definition.compound)) return 0;
  const grades = Array.isArray(definition.grades) ? definition.grades.map(Number) : [9, 10, 11, 12];
  for (let grade = 4; grade >= 1; grade--) if (level >= grades[grade - 1]) return grade;
  return 0;
}

function fill(template: string, values: { value?: unknown; value2?: unknown }) {
  return template.replace("{value2}", text(values.value2)).replace("{value}", text(values.value));
}

function statLines(prop: Values, definition: Values): ItemCardLine[] {
  const lines: ItemCardLine[] = [];
  const add = (key: string, label: string, value: string, color: string) => lines.push({ kind: "prop", key, label, value, color });
  const n = (key: string) => Number(prop[key]) || 0;
  const percent = (key: string, label: string, color: string, sign = false) => {
    if (n(key)) add(key, label, (sign ? signed(n(key), prettyFloat(n(key))) : prettyFloat(n(key))) + "%", color);
  };
  const plain = (key: string, label: string, color: string) => { if (n(key)) add(key, label, text(prop[key]), color); };
  if (n("miss") && definition.type === "elixir") add("miss", "Alcohol", n("miss") + "%", "#7CAAF6");
  for (const gift of Array.isArray(definition.gives) ? definition.gives : []) {
    const [stat, amount] = Array.isArray(gift) ? gift : [];
    if (stat === "hp") add("gives_hp", "HP", Number(amount) < 0 ? prettyNum(Number(amount)) : "+" + prettyNum(Number(amount)), COLORS.hp);
    if (stat === "mp") add("gives_mp", "MP", "+" + prettyNum(Number(amount)), COLORS.mp);
  }
  if (definition.debuff) add("debuff", "Effect", "Debuff", "#343792");
  if (n("gold")) add("gold", "Gold", signed(n("gold")) + "%", COLORS.gold);
  if (n("luck")) add("luck", "Luck", signed(n("luck")) + "%", "#5DE376");
  if (n("xp")) add("xp", "XP", signed(n("xp")) + "%", "#1E73DE");
  percent("lifesteal", "Lifesteal", COLORS.lifesteal);
  percent("manasteal", "Manasteal", COLORS.manasteal);
  if (definition.goldsteal) add("goldsteal", "Goldsteal", "Dynamic", COLORS.gold);
  percent("evasion", "Evasion", "#7AC0F5");
  percent("avoidance", "Avoidance", "#7AC0F5");
  if (n("miss") && definition.type !== "elixir") add("miss", "Miss", n("miss") + "%", "#F36C6E");
  percent("reflection", "Reflection", "#B484E5");
  percent("dreturn", "D.Return", "#E94959");
  percent("crit", "Crit", "#E52967");
  if (n("critdamage")) add("critdamage", "Crit Damage", "+" + prettyFloat(n("critdamage")) + "%", "#A8214E");
  plain("attack", "Damage", COLORS.attack);
  const damageTypes: Record<string, [string, string]> = { pure: ["Pure", "#AA9B55"], magical: ["Magical", "#8998AA"], physical: ["Physical", "#93AB98"] };
  const damageType = damageTypes[text(definition.damage_type)];
  if (damageType) add("damage_type", "Type", damageType[0], damageType[1]);
  if (n("range")) add("range", "Range", "+" + text(prop.range), COLORS.range);
  plain("hp", "HP", COLORS.hp);
  plain("str", "Strength", COLORS.str);
  plain("int", "Intelligence", COLORS.int);
  plain("dex", "Dexterity", COLORS.dex);
  plain("vit", "Vitality", COLORS.hp);
  plain("for", "Fortitude", COLORS.for);
  plain("mp", "MP", COLORS.mp);
  if (n("mp_cost")) add("mp_cost", "Attack MP Cost", signed(n("mp_cost")), COLORS.mp);
  if (n("mp_reduction") > 0) add("mp_reduction", "Skill MP Reduction", "%" + n("mp_reduction"), COLORS.mp);
  else if (n("mp_reduction")) add("mp_reduction", "Skill MP Increase", "%" + -n("mp_reduction"), COLORS.mp);
  if (n("stat")) add("stat", "Stat", text(prop.stat), COLORS.gray);
  plain("armor", "Armor", COLORS.armor);
  plain("apiercing", "A.Piercing", COLORS.armor);
  plain("rpiercing", "R.Piercing", COLORS.resistance);
  plain("resistance", "Resistance", COLORS.resistance);
  plain("pnresistance", "Poison Res.", "#68B84B");
  plain("firesistance", "Fire Res.", "#B42B22");
  plain("fzresistance", "Freeze Res.", "#69B1B6");
  plain("phresistance", "Impact Res.", "#69B1B6");
  plain("stresistance", "Status Res.", "#9FA7B6");
  if (definition.wspeed) add("wspeed", "Speed", titleCase(text(definition.wspeed)), COLORS.gray);
  if (n("speed")) add("speed", definition.wtype ? "Run Speed" : "Speed", signed(n("speed")), COLORS.speed);
  if (n("frequency")) add("frequency", "A.Speed", text(prop.frequency), "#3BE681");
  if (n("output")) add("output", "Damage Output", signed(n("output")) + "%", "#D93319");
  if (n("incdmgamp")) add("incdmgamp", "Incoming Damage", n("incdmgamp") + "%", "#D93319");
  for (const [key, label, color] of [["stun", "Stun", "#784224"], ["explosion", "Explosion", "#782D33"], ["blast", "Blast", "#685079"]] as const)
    if (n(key)) add(key, label, n(key) + "%", color);
  if (n("breaks") > 0) add("breaks", "Breaks", prettyFloat(n("breaks")) + "%", "#782D33");
  for (const [key, label, color] of [["charisma", "Charisma", "#4DB174"], ["awesomeness", "Awesomeness", "#FFDE2F"],
    ["bling", "Bling", "#A4E6FF"], ["cuteness", "Cuteness", "#FD82F0"], ["intensity", "Intensity", "#786D6A"],
    ["courage", "Courage", "#9E1813"], ["mcourage", "M.Courage", "#4628A0"], ["pcourage", "P.Courage", "#D19D32"]] as const)
    plain(key, label, color);
  return lines;
}

function abilityLines(prop: Values, definition: Values, skillName: (id: string) => string | undefined): ItemCardLine[] {
  const lines: ItemCardLine[] = [];
  const id = definition.ability ? text(definition.ability) : "";
  const value = prop.attr0 ?? definition.attr0, value2 = prop.attr1 ?? definition.attr1;
  if (id) {
    const known = ABILITIES[id], skill = known ? undefined : skillName(id);
    // A granted skill links to its details, as the game's card opens render_skill.
    lines.push({ kind: "prop", key: "ability", label: "Ability", value: known?.name || skill || titleCase(id), color: known?.color || "#E1924D",
      ...(skill ? { skill: id } : {}) });
    if (known?.text) lines.push({ kind: "text", key: "ability_text", text: fill(known.text, { value, value2 }), color: COLORS.text });
    else {
      if (value) lines.push({ kind: "prop", key: "ability_chance", label: "Chance", value: "%" + text(value), color: "grey" });
      lines.push({ kind: "text", key: "ability_text", text: "Activate the ability from the 'SKILLS' system.", color: COLORS.text });
    }
  }
  if (definition.aura) {
    lines.push({ kind: "prop", key: "aura", label: "Aura", value: titleCase(text(definition.aura)), color: "#E1924D" });
    if (value) lines.push({ kind: "prop", key: "aura_amount", label: "Amount", value: "%" + text(value), color: "grey" });
  }
  return lines;
}

function hoursLine(hours: number): ItemCardLine {
  if (hours <= 1 / 60) return { kind: "prop", key: "duration", label: "Seconds", value: prettyFloat(hours * 3600), color: COLORS.gray };
  if (hours < 1) return { kind: "prop", key: "duration", label: "Minutes", value: prettyFloat(hours * 60), color: COLORS.gray };
  return { kind: "prop", key: "duration", label: "Hours", value: prettyFloat(hours), color: COLORS.gray };
}

// "Strength +10 · A.Piercing +40" for a bonus's stats, with the card's labels.
export function statSummary(stats: Values): string {
  return statLines(stats, {}).filter((line) => line.kind === "prop")
    .map((line) => line.kind === "prop" ? `${line.label} ${/^[+-]/.test(line.value) ? line.value : "+" + line.value}` : "").join(" · ");
}

export function itemCardLines({ meta, item, level, properties, setName, usable, skillName = () => undefined }: {
  meta: ItemMeta | null | undefined;
  item: Item;
  level: number;
  // Stats at the shown level: live item_properties, or the console's level preview.
  properties: Values;
  setName?: string;
  // Whether a party class can wield the weapon; the game colors the type line by it.
  usable: boolean;
  skillName?: (id: string) => string | undefined;
}): ItemCardLine[] {
  const definition: Values = meta?.definition || {};
  const prop: Values = { ...definition, ...properties };
  // A stat scroll folds the base stat into the scrolled stat (calculate_item_properties sets prop.stat=0).
  if (item.stat_type) prop.stat = 0;
  const lines: ItemCardLine[] = [...statLines(prop, definition)];
  const grade = GRADES[itemGrade(definition, level)];
  if (grade && definition.type !== "booster") lines.push({ kind: "prop", key: "grade", label: "Grade", value: grade.name, color: grade.color });
  if (definition.poisonous) lines.push({ kind: "text", key: "poisonous", text: "Poisonous", color: COLORS.poison });
  if (definition.cooperative) lines.push({ kind: "text", key: "cooperative", text: "Cooperative", color: "#aeaeae" });
  if (definition.peaceful) lines.push({ kind: "text", key: "peaceful", text: "Peaceful", color: "#54B25F" });
  if (definition.supporter) lines.push({ kind: "text", key: "supporter", text: "Supporter", color: "#CA5931" });
  for (const bonus of meta?.bonuses || [])
    lines.push({ kind: "prop", key: `bonus_${bonus.id}`, label: "Bonus", value: `${bonus.name} [Only] ${statSummary(bonus.stats)}`.trim(), color: "#7738E8" });
  const classes = Array.isArray(definition.class) ? definition.class : definition.class ? [definition.class] : [];
  if (classes.length) lines.push({ kind: "prop", key: "class", label: "Class", value: classes.map((name) => titleCase(text(name))).join(", "), color: COLORS.gray });
  if (definition.type === "elixir" && Number(definition.duration)) lines.push(hoursLine(Number(definition.duration)));
  lines.push(...abilityLines(prop, definition, skillName));
  if (definition.explanation) lines.push({ kind: "text", key: "explanation", text: text(definition.explanation), color: COLORS.text });
  else if (definition.type === "material") lines.push({ kind: "text", key: "unknown_material", text: "An unknown material, as in, you have no idea what to do with it!", color: COLORS.text });
  if (Number(definition.multiplier) && Number(definition.multiplier) !== 1)
    lines.push({ kind: "prop", key: "multiplier", label: "Multiplier", value: text(definition.multiplier), color: COLORS.gray });
  if (setName) lines.push({ kind: "prop", key: "set", label: "Set", value: setName, color: "#f1c054" });
  lines.push(...stateLines(item));
  const wtype = text(definition.wtype || definition.type);
  if (definition.type === "weapon" || OFFHAND_TYPES.has(text(definition.type)))
    lines.push({ kind: "prop", key: "weapon_type", label: "Type", value: `T${prettyFloat(Number(definition.tier) || 0)} ${WEAPON_TYPES[wtype] || titleCase(wtype)}`, color: COLORS.gray,
      valueColor: usable ? "#56A244" : "#CC3837" });
  lines.push({ kind: "prop", key: "info", label: "[i]", value: infoPhrase(meta, level), color: COLORS.gray });
  return lines;
}

// render_item's "[i]" phrase: exchange, then upgrade below +10, compound, then
// collector-quest and other crafting uses.
function infoPhrase(meta: ItemMeta | null | undefined, level: number): string {
  const definition: Values = meta?.definition || {};
  if (definition.e) return "Exchangeable";
  if (definition.upgrade && level < 10) return "Upgradeable";
  if (definition.compound) return "Compoundable";
  const uses = meta?.world?.usedIn || [];
  if (uses.some((use) => use.quest === "mcollector")) return "Collectable";
  return uses.length ? "Usable" : "Information";
}

// Per-copy state the game shows on the card. Quantity and stat scroll show on the
// game's inventory slot instead, so the extras box carries them (itemSlotExtras).
function stateLines(item: Item): ItemCardLine[] {
  const lines: ItemCardLine[] = [];
  if (item.l === "s") lines.push({ kind: "text", key: "lock", text: "Sealed", color: "#C45F5F" });
  else if (item.l === "u") lines.push({ kind: "text", key: "lock", text: "Unsealing", color: "#C4A35F" });
  else if (item.l) lines.push({ kind: "text", key: "lock", text: "Locked", color: "#404141" });
  if (item.acl) lines.push({ kind: "text", key: "acl", text: "Account Bound", color: "#ADA68E" });
  if (item.expires) lines.push({ kind: "prop", key: "expires", label: "Expires", value: new Date(item.expires).toLocaleString(), color: COLORS.gray });
  return lines;
}

// Quantity and stat scroll for the extras box.
export function itemSlotExtras(item: Item): [key: string, value: string][] {
  const extras: [string, string][] = [];
  if (Number(item.q) > 1) extras.push(["quantity", prettyNum(Number(item.q))]);
  if (item.stat_type) extras.push(["stat_type", STAT_NAMES[item.stat_type] || titleCase(item.stat_type)]);
  return extras;
}

// Whether the card shows a grid field. Tier appears only in a weapon's type line.
export function onItemCard(key: string, definition: Values): boolean {
  if (key === "tier") return definition.type === "weapon" || OFFHAND_TYPES.has(text(definition.type));
  return CARD_KEYS.has(key);
}

// Definition fields the card already shows, or that only drive other sections.
export const CARD_KEYS = new Set([
  "name", "skin", "skin_a", "skin_c", "skin_r", "explanation", "type", "g", "s", "grades", "upgrade", "compound",
  "level", "set", "wtype", "damage_type", "class", "ability", "aura", "attr0", "attr1", "gives", "debuff",
  "goldsteal", "wspeed", "duration", "multiplier", "poisonous", "cooperative", "peaceful", "supporter", "e",
  "miss", "gold", "luck", "xp", "lifesteal", "manasteal", "evasion", "avoidance", "reflection", "dreturn", "crit",
  "critdamage", "attack", "range", "hp", "str", "int", "dex", "vit", "for", "mp", "mp_cost", "mp_reduction", "stat",
  "armor", "apiercing", "rpiercing", "resistance", "pnresistance", "firesistance", "fzresistance", "phresistance",
  "stresistance", "speed", "frequency", "output", "incdmgamp", "stun", "explosion", "blast", "breaks", "charisma",
  "awesomeness", "bling", "cuteness", "intensity", "courage", "mcourage", "pcourage",
]);
