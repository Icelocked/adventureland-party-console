import type { GData } from 'typed-adventureland';
type Animatable = NonNullable<NonNullable<GData['maps']['main']['animatables']>['the_door']>;
export interface MapGeometry {
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default?: number;
  tiles?: readonly (readonly (string | number)[] | null)[];
  placements?: readonly unknown[];
  groups?: readonly unknown[];
}

export interface MapCatalog {
  // typed-adventureland 0.0.57 names only door/lever; native maps also contain
  // dreams_gate. Keep the upstream entry shape while allowing new identifiers.
  maps?: Readonly<Record<string, { animatables?: Readonly<Record<string, Animatable>> }>>;
  geometry?: Readonly<Record<string, MapGeometry | undefined>>;
  tilesets?: Readonly<Record<string, { file?: string } | undefined>>;
}

export interface MapDefinition {
  name: string;
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default: number | null;
  tiles: NonNullable<MapGeometry["tiles"]>;
  placements: readonly unknown[];
  groups: readonly unknown[];
  tilesets: Record<string, { file: string }>;
  decorations?: { kind: 'dreams_gate'; x: number; y: number }[];
}

function tilesetsFor(geometry: MapGeometry, catalog: MapCatalog, extra: string[]): MapDefinition["tilesets"] {
  const used = new Set([...extra, ...(geometry.tiles || []).map((tile) => tile?.[0]).filter(Boolean)]);
  const tilesets: MapDefinition["tilesets"] = {};
  for (const id of used) {
    const definition = catalog.tilesets?.[String(id)];
    if (definition?.file)
      tilesets[String(id)] = { file: "https://adventure.land" + definition.file };
  }
  return tilesets;
}

function describeMap(name: string, geometry: MapGeometry, catalog: MapCatalog): MapDefinition {
  const gate = catalog.maps?.[name]?.animatables?.dreams_gate;
  return {
    name,
    min_x: geometry.min_x,
    min_y: geometry.min_y,
    max_x: geometry.max_x,
    max_y: geometry.max_y,
    default: Number.isInteger(geometry.default) ? Number(geometry.default) : null,
    tiles: geometry.tiles || [],
    placements: geometry.placements || [],
    groups: geometry.groups || [],
    tilesets: tilesetsFor(geometry, catalog, gate ? ['dungeon', 'outside', 'custom_a'] : []),
    decorations: gate ? [{ kind: 'dreams_gate', x: gate.x, y: gate.y }] : [],
  };
}

/** An eight-entry insertion-order cache, matching the coordinator's existing eviction policy. */
export function createMapDefinitions(load: () => MapCatalog) {
  const cache = new Map<string, MapDefinition>();
  return {
    get(name: string): MapDefinition | null {
      const cached = cache.get(name);
      if (cached) return cached;
      const catalog = load();
      const geometry = catalog.geometry?.[name];
      if (!geometry) return null;
      const result = describeMap(name, geometry, catalog);
      cache.set(name, result);
      const oldest = cache.keys().next();
      if (cache.size > 8 && !oldest.done) cache.delete(oldest.value);
      return result;
    },
  };
}
