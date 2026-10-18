"use client";
import { useQuery } from "@tanstack/react-query";
import { API } from "./api";
import { StandPriceButton } from "./stand-price-button";
import type { Item } from "./item";

interface AlninjaPrice {
  level: number;
  variant: string;
  price: number | null;
  lowest: number | null;
  median: number | null;
  bestBid: number | null;
  sellers: number;
  buyers: number;
  soldPerDay: number;
  stale: boolean;
}

// Outbid or undercut by one unit in the price's third significant digit, at a round number
// (7,000,000 → 7,010,000), so the step scales with the price; below 1,000 it is 1 gold.
const step = (price: number) => 10 ** Math.max(0, Math.floor(Math.log10(price)) - 2);
const outbid = (price: number) => (Math.floor(price / step(price)) + 1) * step(price);
const undercut = (price: number) => (Math.ceil(price / step(price)) - 1) * step(price);
const regionOf = (server?: string | null) => /^(US|EU|ASIA)/.exec(server || "")?.[1] || "ALL";
// ALNinja keys variants by the item's p and data, joined with "/".
const variantOf = (item: Item) => [item.p, (item as { data?: unknown }).data].filter(v => typeof v === "string" && v).join("/");

/** ALNinja's current price row for an item at one level (and its variant), in the merchant's region. */
export function useAlninjaPrice(item: Item, level: number, server?: string | null) {
  const region = regionOf(server);
  const query = useQuery({
    queryKey: ["alninja-price", item.name, region],
    queryFn: async () => {
      const response = await fetch(`${API}/alninja/price?item=${encodeURIComponent(item.name)}&region=${region}`);
      const body = await response.json() as { error?: string; prices?: AlninjaPrice[]; source?: string };
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      return body;
    },
    staleTime: 60_000,
    retry: false,
  });
  const variant = variantOf(item);
  const row = query.data?.prices?.find(entry => entry.level === level && entry.variant === variant);
  const failure = query.isPending ? "loading…" : query.error ? query.error.message : !row ? `no ${region} listings` : null;
  return { region, row, failure };
}

// What ALNinja's suggestion is based on, in the order it picks them.
const basisLabel: Record<string, string> = {
  asks: "the cheapest other seller", sales: "30-day sales", history: "the last asking price",
  cost_to_make: "the cost to make", bid: "the best bid", npc: "the NPC price",
};

/** ALNinja's one suggested selling price at a level, also when nobody lists it there. */
function useAlninjaValue(item: Item, level: number, region: string) {
  const variant = variantOf(item);
  const query = useQuery({
    queryKey: ["alninja-value", item.name, level, variant, region],
    queryFn: async () => {
      const params = new URLSearchParams({ item: item.name, level: String(level), variant, region });
      const response = await fetch(`${API}/alninja/value?${params}`);
      const body = await response.json() as { error?: string; suggested?: number; basis?: string };
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      return body;
    },
    staleTime: 60_000,
    retry: false,
  });
  const suggested = Number(query.data?.suggested) > 0 ? Number(query.data!.suggested) : null;
  const note = query.isPending ? "loading…" : query.error ? query.error.message
    : suggested ? `from ${basisLabel[query.data!.basis!] || query.data!.basis}` : "no suggestion";
  return { suggested, note };
}

/** ALNinja's prices for the item being listed on the stand. */
export function AlninjaStandPrice({ item, server, onApply }: { item: Item; server?: string | null; onApply: (price: number) => void }) {
  const { region, row, failure } = useAlninjaPrice(item, Number(item.level) || 0, server);
  const value = useAlninjaValue(item, Number(item.level) || 0, region);
  const status = failure ?? `${row!.sellers} selling · ${row!.soldPerDay.toFixed(1)} sold/day${row!.stale ? " · stale" : ""}`;
  return <div className="col-span-2 grid gap-2 sm:col-span-3">
    <p className="font-mono text-[10px] text-amber-100/70">ALNinja ({region}): {status}</p>
    <p className="font-mono text-[10px] text-amber-100/70">ALNinja value {value.note}</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <StandPriceButton label="ALNinja value" value={value.suggested ?? 0} disabled={!value.suggested}
        onClick={() => value.suggested && onApply(value.suggested)} tone="amber" />
      <StandPriceButton label="ALNinja price" value={Number(row?.price)} disabled={!row?.price}
        onClick={() => row?.price && onApply(row.price)} tone="amber" />
      <StandPriceButton label="ALNinja median" value={Number(row?.median)} disabled={!row?.median}
        onClick={() => row?.median && onApply(row.median)} tone="amber" />
      <StandPriceButton label="ALNinja undercut" value={row?.lowest ? undercut(row.lowest) : 0} disabled={!row?.lowest || row.lowest <= 1}
        onClick={() => row?.lowest && onApply(undercut(row.lowest))} tone="amber" />
    </div>
  </div>;
}

/** ALNinja's prices for a buy order: the best current bid to match or outbid, and the cheapest seller. */
export function AlninjaBidPrice({ item, level, server, onApply }: { item: Item; level: number; server?: string | null; onApply: (price: number) => void }) {
  const { region, row, failure } = useAlninjaPrice(item, level, server);
  const status = failure ?? `${row!.buyers} buying · ${row!.sellers} selling · ${row!.soldPerDay.toFixed(1)} sold/day${row!.stale ? " · stale" : ""}`;
  return <div className="col-span-2 grid gap-2 sm:col-span-4">
    <p className="font-mono text-[10px] text-amber-100/70">ALNinja ({region}{level ? ` +${level}` : ""}): {status}</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <StandPriceButton label="ALNinja outbid" value={row?.bestBid ? outbid(row.bestBid) : 0} disabled={!row?.bestBid}
        onClick={() => row?.bestBid && onApply(outbid(row.bestBid))} tone="amber" />
      <StandPriceButton label="ALNinja best bid" value={Number(row?.bestBid)} disabled={!row?.bestBid}
        onClick={() => row?.bestBid && onApply(row.bestBid)} tone="amber" />
      <StandPriceButton label="ALNinja lowest seller" value={Number(row?.lowest)} disabled={!row?.lowest}
        onClick={() => row?.lowest && onApply(row.lowest)} tone="amber" />
    </div>
  </div>;
}

/** Warns (never blocks) when an item marked for NPC sale really sells for far more: at least
 * `minUnits` sold in the last week at this level and variant, at a median at least `minAbove` gold
 * over the NPC price. Unsold asks don't count. */
export function AlninjaNpcSaleWarning({ item, npcPrice, server, settings }: {
  item: Item; npcPrice: number; server?: string | null; settings?: { minUnits: number; minAbove: number };
}) {
  const region = regionOf(server), level = Number(item.level) || 0, variant = variantOf(item);
  const { minUnits, minAbove } = settings || { minUnits: 3, minAbove: 1_000_000 };
  const query = useQuery({
    queryKey: ["alninja-sales", item.name, level, variant, region],
    queryFn: async () => {
      const params = new URLSearchParams({ item: item.name, level: String(level), variant, region });
      const response = await fetch(`${API}/alninja/sales?${params}`);
      const body = await response.json() as { error?: string; units?: number; median?: number | null };
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      return body;
    },
    staleTime: 60_000,
    retry: false,
  });
  const units = Number(query.data?.units) || 0, median = Number(query.data?.median) || 0;
  const warn = units >= minUnits && median >= npcPrice + minAbove;
  const check = query.isPending ? "pending" : warn ? "warn" : "clear";
  return <span data-alninja-npc-check={check} className={warn ? "block" : "hidden"}>
    {warn && <span role="status" className="block rounded border border-amber-500/70 bg-amber-950/40 p-3 text-sm text-amber-100">
      <span className="font-semibold">Players pay well over the NPC price.</span>{" "}
      ALNinja ({region}): {units.toLocaleString()} sold in the last 7 days at a median of {Math.round(median).toLocaleString()} gold,
      against {Math.round(npcPrice).toLocaleString()} gold each from the NPC. Consider the stand instead.
    </span>}
  </span>;
}
