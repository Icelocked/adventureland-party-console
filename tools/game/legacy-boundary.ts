/** Small integration hooks while the remaining shared domains are migrated. */
export function adaptLegacyRuntime(source: string): string {
  const snapshot = "      name: character.name,";
  const api = "    isOccupied: function () {";
  if (!source.includes(snapshot) || !source.includes(api))
    throw new Error("Shared runtime integration points changed; refusing to publish");
  return source.replace(snapshot, snapshot + "\n      actualParty: character.party || null,");
}
