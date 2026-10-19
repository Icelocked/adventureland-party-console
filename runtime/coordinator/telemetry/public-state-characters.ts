import { selectSnapshot } from "../persistence/snapshots.ts";
import { fastProjection, sectionFields } from "./character-fields.ts";
import type { PresentationEntry, PresentationStatus, PublicCommand } from "./public-state-types.ts";

export function diagnosticCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  const allowed = new Set<string>(sectionFields.diagnostics);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...Object.fromEntries(Object.entries(status).filter(([key]) => allowed.has(key))),
        combat: {
          positioning: (status.combat as { positioning?: unknown } | undefined)?.positioning,
        },
      },
    ]),
  );
}

const metadataFields = [
  "definition",
  "upgradeable",
  "compoundable",
  "buyable",
  "properties",
  "scaling",
  "maxLevel",
  "sprite",
  "title",
] as const;

export function fastCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      fastProjection(status || {}),
    ]),
  );
}

export function compactEntry(entry: PresentationEntry | null): PresentationEntry | null {
  return !entry
    ? entry
    : { ...entry, meta: entry.meta ? selectSnapshot(entry.meta, metadataFields) : null };
}

export function inventoryCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        items: (status.items || []).map(compactEntry),
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [slot, compactEntry(entry)]),
        ),
        characterDollHtml: status.characterDollHtml || null,
      },
    ]),
  );
}

export function pendingCommands(
  commands: Readonly<Record<string, PublicCommand | null | undefined>>,
) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      command && {
        id: command.id,
        type: command.type,
        phase: command.phase || null,
        convoyId: command.convoyId || null,
      },
    ]),
  );
}
