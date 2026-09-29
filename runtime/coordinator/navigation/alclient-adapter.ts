import * as pathfinder from 'alpathfinder';
import type { GData, MapKey } from 'typed-adventureland';
import type { GameData, PlanRequest, Step } from '../../navigation/contracts.ts';
/** Adapted from earthiverse/ALClient (MIT), Pathfinder.ts at
 * 853cf80279b761ecbea238c4b3acd9caab102e11, SHA256
 * 1415e92d71d93e5321992b38da9ca65c37d758f1ffdbd73bd90fbfea0bd73996.
 * Only prepare/getPath are needed. No cheat edges; no Character/socket client.
 */
let preparedGame: GameData;
// Route-cost estimate only; actual movement and town authorization are separate.
const PLANNER_SPEED = 200;
// alpathfinder 0.6 exposes cost speed and avoidMaps, but no Town prohibition.
// Bias toward walking, then reject any residual Town edge before publishing it.
const WALK_PLANNER_SPEED = 1_000_000;
const RESTRICTED_TRANSIT: MapKey[] = ['cyberland', 'jail'];
export function prepare(g: GameData): void {
  preparedGame = g;
  const maps = new Set(['main']);
  for (const map of maps) for (const door of g.maps[map]?.doors || []) maps.add(String(door[4]));
  for (const map of Object.keys(g.npcs.transporter?.places || {})) maps.add(map);
  for (const map of ['abtesting', 'goobrawl', 'jail']) maps.add(map);
  pathfinder.prepare(g as unknown as GData, Object.keys(g.maps).filter(m => !maps.has(m)) as MapKey[]);
}
export function getPath(request: PlanRequest): Step[] {
  const { from, to } = request;
  const raw = request.avoidLeave ? withoutLeave(request) : findPath(from, to, request.town);
  if (!raw?.length) throw Error('ALClient found no route');
  if (!request.town && raw.some(p => p.method === 'town')) throw Error('ALClient found no route without Town');
  const plot: Step[] = transporterApproaches(raw, from, request.town).map(p => ({ map: p.map, x: p.x, y: p.y, method: p.method,
    ...(p.method === 'town' ? { town: true } : {}),
    ...(['door', 'transport', 'enter'].includes(p.method) ? { transport: true, s: p.spawn ?? 0 } : {}),
    ...(p.key ? { key: p.key } : {}) }));
  if (plot[0].map !== from.map || plot[0].x !== from.x || plot[0].y !== from.y) plot.unshift({ ...from });
  return plot;
}

function findPath(from: Step, to: Step, town: boolean, avoidLeave = false): pathfinder.PathNode[] | null {
  return pathfinder.getPath(from.map as MapKey, from.x, from.y, to.map as MapKey, to.x, to.y, {
    speed: town ? PLANNER_SPEED : WALK_PLANNER_SPEED,
    avoidMaps: avoidLeave ? RESTRICTED_TRANSIT.filter(map => map !== from.map && map !== to.map) : undefined,
  });
}

function withoutLeave(request: PlanRequest): pathfinder.PathNode[] | null {
  const {from, to} = request;
  if (!['cyberland', 'jail'].includes(from.map))
    return findPath(from, to, request.town, true);
  const door = preparedGame.maps[from.map]?.doors?.find(d => d[4] === 'main' && !d[7] && !d[8]);
  if (!door) throw Error('Leave recovery unavailable: no ordinary exit');
  const spawn = Number(door[5] || 0), xy = preparedGame.maps.main.spawns[spawn];
  const approach = findPath(from, {map:from.map,x:Number(door[0]),y:Number(door[1])}, request.town, true);
  const rest = findPath({map:'main',x:xy[0],y:xy[1]}, to, request.town, true);
  if (!approach || !rest || approach.some(p => p.map !== from.map || p.method === 'leave')) throw Error('Leave recovery unavailable: ordinary exit inaccessible');
  return [...approach, {map: 'main', x: xy[0], y: xy[1], method: 'door', spawn}, ...rest];
}

function transporterApproaches(raw: pathfinder.PathNode[], origin: Step, town: boolean): pathfinder.PathNode[] {
  const result: pathfinder.PathNode[] = [];
  let previous: Step = origin;
  for (const step of raw) {
    if (step.method === 'transport') {
      const npc = preparedGame.maps[previous.map]?.npcs?.find(n => n.id === 'transporter')?.position;
      if (npc && Math.hypot(previous.x - npc[0], previous.y - npc[1]) >= 75) {
        const approach = transporterApproach(previous, npc, town);
        if (approach) result.push(...approach);
      }
    }
    result.push(step); previous = step;
  }
  return result;
}

function transporterApproach(from: Step, npc: number[], town: boolean): pathfinder.PathNode[] | undefined {
  const points = Array.from({length: 16}, (_, i) => ({map: from.map as MapKey,
    x: npc[0] + 60 * Math.cos(i * Math.PI / 8), y: npc[1] + 60 * Math.sin(i * Math.PI / 8), method: 'move' as const}));
  points.sort((a,b) => Math.hypot(a.x-from.x,a.y-from.y)-Math.hypot(b.x-from.x,b.y-from.y));
  for (const p of points) {
    if(pathfinder.canWalkPath(p.map,from.x,from.y,p.x,p.y))return [p];
    const path=findPath(from,p,town);
    if(path?.length && path.every(step=>step.map===from.map && step.method==='move')) {
      // Stop at the first graph node in interaction range. The library's final
      // exact-point connector can cut through a corner near the transporter.
      const arrived=path.findIndex(step=>Math.hypot(step.x-npc[0],step.y-npc[1])<70);
      if(arrived>=0)return path.slice(0,arrived+1);
    }
  }
  return undefined;
}
