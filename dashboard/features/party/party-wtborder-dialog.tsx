"use client";
import type { PartyConsoleModel } from "./use-party-console";
import { WTBOrderDialog } from "./wtborder-dialog";
import { AlninjaBidPrice } from "./alninja-stand-price";

import { usePanelModel } from "./use-panel-model";
export function PartyWTBOrderDialog({ model }: { model: PartyConsoleModel }) {
  return model.wtbItem ? <PartyWTBOrderDialogConnected base={model} /> : null;
}
function PartyWTBOrderDialogConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, market: true });
  const { state, setWtbItem, wtbItem, saveStandBid } = model;
  if (!wtbItem) return null;
  return (
    <WTBOrderDialog
      item={wtbItem}
      onOpenChange={(open) => {
        if (!open) setWtbItem(null);
      }}
      catalog={state.merchantCatalog?.allItems || []}
      buyable={state.merchantCatalog?.buyable || []}
      history={wtbItem ? state.standPriceHistory?.[wtbItem.item.name] : undefined}
      existing={wtbItem ? state.standBids?.[wtbItem.item.name] : undefined}
      pricing={(level, apply) => <AlninjaBidPrice item={wtbItem.item} level={level} onApply={apply}
        server={state.merchantCharacter ? state.characters[state.merchantCharacter]?.server : null} />}
      onSave={async (itemId, price, quantity, level, priorityOverride, options) => {
        await saveStandBid(itemId, price, quantity, level, false, priorityOverride, options);
        setWtbItem(null);
      }}
    />
  );
}
