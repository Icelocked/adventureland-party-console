"use client";
import { useEffect, useState } from "react";
import { usePartyAction } from "./query-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function BuyUpgradeBatchSetting({ value = 1 }: { value?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const action = usePartyAction();
  const count = Number(draft);
  const valid = Number.isSafeInteger(count) && count >= 1 && count <= 42;
  return <fieldset disabled={action.isPending} className="space-y-3 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <label htmlFor="buy-upgrade-batch">Maximum number to buy at once for upgrading</label>
    <p className="text-xs text-slate-300">Default: 1. Buys up to this many items and their starting-tier scrolls per batch, within available space and order limits. Higher-tier scrolls are bought as needed. Every purchased item is finished, so a batch can produce extra target-level items.</p>
    <div className="flex gap-2">
      <Input id="buy-upgrade-batch" type="number" min={1} max={42} step={1} value={draft}
        onChange={event => setDraft(event.target.value)} className="border-slate-500 bg-slate-950 text-slate-100" />
      <Button disabled={!valid} onClick={() => { action.reset(); action.mutate({path: "/config", body: {buyUpgradeBatchSize: count}}); }}
        className="border border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400">Apply</Button>
    </div>
    {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
