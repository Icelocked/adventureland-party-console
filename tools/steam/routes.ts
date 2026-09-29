import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, json } from '../hosting/http.ts';
import type { Options } from '../hosting/setup-routes.ts';

/** Called only after gateway browser authorization; bridge traffic never enters here. */
export async function steamAction(req: IncomingMessage, res: ServerResponse, options: Options) {
  const input = await body(req);
  const port = options.apiPort || 924;
  await prepareAction(input, port, options);
  // Forward only after a real bridge lease exists. Original coordinator checks,
  // offline confirmation, bootstrap preparation and arrival fencing stay intact.
  const response = await fetch(`http://127.0.0.1:${port}/party-api/steam/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60000),
  });
  json(res, response.status, await response.json());
}
async function prepareAction(input: Record<string, unknown>, port: number, options: Options) {
  if (['primary', 'login'].includes(String(input.action)) && typeof input.character === 'string' && options.steam) {
    await savePreferences(input, options.steam);
    const response = await fetch(`http://127.0.0.1:${port}/party-api/state?section=core`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('Party coordinator is unavailable.');
    const state = await response.json() as { roster?: { name: string }[]; steamSwitch?: { phase: string } };
    if (!state.roster?.some(member => member.name === input.character)) throw Error('Choose an owned character.');
    if (state.steamSwitch && state.steamSwitch.phase !== 'complete') throw Error('Resolve the pending Steam operation first.');
    await options.steam.ensure(input.character);
  }
}
async function savePreferences(input: Record<string, unknown>, steam: NonNullable<Options['steam']>) {
  if (input.clientSetup && typeof input.clientSetup === 'object')
    await steam.preferences.save(input.clientSetup as Record<string, unknown>);
}
export function isSteamAction(url: URL, req: IncomingMessage, bridge: RegExpExecArray | null) {
  return !bridge && url.pathname === '/party-api/steam/action' && req.method === 'POST';
}
