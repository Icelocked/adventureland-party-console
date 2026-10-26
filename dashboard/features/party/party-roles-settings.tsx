"use client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "none";

function RolePicker({
  label,
  value,
  characters,
  onSelect,
}: {
  label: string;
  value: string | null;
  characters: string[];
  onSelect: (name: string | null) => void;
}) {
  return (
    <label className="grid gap-1 text-xs uppercase tracking-wider text-emerald-400">
      {label}
      <Select value={value || NONE} onValueChange={(next) => onSelect(next === NONE ? null : next)}>
        <SelectTrigger className="min-w-40 border-cyan-800 bg-black/30 text-sm text-emerald-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None</SelectItem>
          {characters.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function PartyRolesSettings({
  tank,
  offTank,
  characters,
  onSelectTank,
  onSelectOffTank,
}: {
  tank: string | null;
  offTank: string | null;
  characters: string[];
  onSelectTank: (name: string | null) => void;
  onSelectOffTank: (name: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-emerald-900 bg-[#071315] p-3 text-sm text-emerald-100">
      <RolePicker label="Tank" value={tank} characters={characters} onSelect={onSelectTank} />
      <RolePicker label="Off tank" value={offTank} characters={characters} onSelect={onSelectOffTank} />
      <p className="max-w-sm text-xs text-emerald-100/60">
        The tank holds its target at its own range, owns taunt and absorb, and swaps into its
        highest-luck gear right before a kill. The off tank takes the tank&apos;s attackers while
        the tank is in danger and hands them back once it recovers.
      </p>
    </div>
  );
}
