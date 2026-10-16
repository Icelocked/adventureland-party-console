import { availableCraftStock } from "../craft-reservations.ts";
Object.assign(globalThis, {partyAvailableCraftStock: availableCraftStock});

import { resolveUpgradeOffering } from '../upgrade-offerings.ts';
Object.assign(globalThis, {partyResolveUpgradeOffering: resolveUpgradeOffering});
