/** Stable across catalog ordering; coordinates identify the catalog spawn center. */
export function huntSpawnKey(location: { map: string; x: unknown; y: unknown }): string {
  return JSON.stringify([location.map, Number(location.x), Number(location.y)]);
}

export function validSpawnPreferences(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([monster, key]) => monster.length > 0 &&
      monster.length <= 100 && typeof key === 'string' && key.length <= 200);
}
