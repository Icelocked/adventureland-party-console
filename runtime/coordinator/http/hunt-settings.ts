import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { zones, type Catalog } from '../../../dashboard/lib/farming-zones.ts';
import { huntSpawnKey } from '../hunt/spawn-preferences.ts';
import {
  applyHuntThresholds,
  huntSettings,
  validHuntSettings,
  type HuntFailureState,
} from "../hunt/settings.ts";
export function createHuntSettingsRoute(
  state: HuntFailureState & { monsterChoices?: Catalog | null; farmAreaState?: { pending?: unknown } | null },
  ports: { now(): number; persist(): void },
) {
  return (req: HttpRequest, res: HttpResponse): unknown => {
    const { character: _character, ...body } = requestObject(req.body);
    if (!validHuntSettings(body))
      return res
        .status(400)
        .json({ error: "Invalid Hunt settings or spawn preferences" });
    if (body.preferredSpawns && !Object.entries(body.preferredSpawns).every(([monster, key]) =>
      !key || zones(state.monsterChoices || [], [monster]).some(location => huntSpawnKey(location) === key)))
      return res.status(400).json({ error: 'Select an available Hunt spawn from the catalog' });
    const previous = huntSettings(state);
    state.huntSettings = { ...previous, ...body,
      ...(body.preferredSpawns ? { preferredSpawns: { ...previous.preferredSpawns, ...body.preferredSpawns } } : {}) };
    if (
      !state.huntSettings.relocateIfCompeting &&
      (state.farmAreaState?.pending as { cause?: string } | undefined)?.cause === "farming-conflict"
    )
      state.farmAreaState!.pending = null;
    applyHuntThresholds(state, ports.now());
    ports.persist();
    return res.json({ ok: true, huntSettings: state.huntSettings });
  };
}
