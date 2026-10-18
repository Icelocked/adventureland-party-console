"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API } from "./api";
import { copyText } from "./copy-text";
import { usePartyAction } from "./query-actions";

interface LastReport { at: number; reporter: string; ok: boolean; stored?: number; error?: string }
export interface AlninjaStatus {
  enabled: boolean;
  hasToken: boolean;
  hasKey: boolean;
  keyOwner: string | null;
  reporting: boolean;
  reporters: Record<string, LastReport>;
}
interface AlninjaAuth { enabled: boolean; mailTo: string | null; subject: string; merchant: string | null; registered: boolean; valid: boolean }
export interface MailDraft { recipient: string; subject: string; message: string }

const ago = (at: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  return seconds < 120 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};
async function call<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json" } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/** Trade reports to alninja.trade. A reporting key is mailed to ALNinja by the merchant (like the
 * ALData key), or an instance admin's REPORT_TOKEN is used instead. Neither is shown again unasked. */
export function AlninjaSettings({ status, onPrepareMail }: { status?: AlninjaStatus; onPrepareMail: (draft: MailDraft) => void }) {
  const action = usePartyAction();
  const [token, setToken] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Until ALNinja confirms the mailed key, check every 15 seconds while settings are open.
  const auth = useQuery({
    queryKey: ["party", "alninja-auth", status?.hasKey, status?.keyOwner],
    queryFn: () => call<AlninjaAuth>("/alninja/auth"),
    refetchInterval: status?.hasKey && !status.keyOwner ? 15_000 : false,
    retry: false,
  });
  const save = (body: Record<string, unknown>) => {
    action.reset();
    action.mutate({ path: "/alninja", body }, { onSuccess: () => setToken("") });
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) { setError(String((failure as Error).message || failure)); } finally { setBusy(false); }
  };
  const reveal = async () => (key ?? (await call<{ key: string }>("/alninja/key")).key);
  const reporters = Object.values(status?.reporters || {}).sort((a, b) => a.reporter.localeCompare(b.reporter));
  const keyState = status?.keyOwner ? `Key registered to ${status.keyOwner}`
    : status?.hasKey ? (auth.data?.registered ? "Mailed key not matched yet" : "Key not registered yet — prepare and send the mail") : "No key";
  return <fieldset disabled={action.isPending || busy} className="rounded border border-slate-800 bg-black/20 p-4 text-sm text-slate-100">
    <legend className="sr-only">ALNinja trade reports</legend>
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold">ALNinja</p>
        <p className="font-mono text-[10px] uppercase text-slate-400">
          {status?.reporting ? "Reporting" : status?.enabled ? "Needs a registered key" : "Off"} · {status?.hasToken ? "Admin token" : keyState}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" className="accent-violet-500" checked={!!status?.enabled}
          aria-label="Report trades to ALNinja" onChange={event => save({ enabled: event.target.checked })} />
        Report trades
      </label>
    </div>
    <div className="mt-4 flex gap-2">
      <Input readOnly type={keyVisible ? "text" : "password"} value={key ?? ""} aria-label="ALNinja reporting key"
        placeholder={status?.hasKey ? "Stored key — reveal to view" : "No key generated"} className="border-slate-800 bg-black/40 font-mono text-xs" />
      <Button size="icon" variant="outline" aria-label="Reveal ALNinja key" disabled={!status?.hasKey}
        onClick={() => void run(async () => { setKey(await reveal()); setKeyVisible(value => !value); })}
        className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">
        {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button size="icon" variant="outline" aria-label="Copy ALNinja key" disabled={!status?.hasKey}
        onClick={() => void run(async () => { const value = await reveal(); setKey(value); if (!(await copyText(value))) setKeyVisible(true); })}
        className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">
        <Copy className="h-4 w-4" />
      </Button>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-3">
      <Button onClick={() => void run(async () => { setKey((await call<{ key: string }>("/alninja/key", "POST")).key); setKeyVisible(true); })}
        className="bg-slate-700 text-white hover:bg-slate-600">Generate key</Button>
      <Button disabled={!status?.hasKey} className="bg-violet-700 text-white hover:bg-violet-600"
        onClick={() => void run(async () => {
          const instructions = await call<AlninjaAuth>("/alninja/auth");
          if (!instructions.enabled || !instructions.mailTo) throw new Error("ALNinja isn't accepting reporting keys right now");
          onPrepareMail({ recipient: instructions.mailTo, subject: instructions.subject, message: await reveal() });
        })}>Prepare mail</Button>
      <Button variant="outline" disabled={!status?.hasKey} onClick={() => void auth.refetch()}
        className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">Check status</Button>
    </div>
    <p className="mt-3 text-xs text-slate-400">
      Generate a key, then Prepare mail: your merchant mails it to ALNinja{auth.data?.mailTo ? ` (${auth.data.mailTo})` : ""} with
      the usual mail fee. ALNinja picks it up within a minute; reporting starts once it confirms the key. Each character then
      reports the stand trades it sees and its own trades, within seconds of a trade and at least once a minute.
    </p>
    <details className="mt-3 text-xs text-slate-400">
      <summary className="cursor-pointer">Instance admin token</summary>
      <div className="mt-2 flex gap-2">
        <Input type="password" value={token} onChange={event => setToken(event.target.value)} aria-label="ALNinja report token"
          placeholder={status?.hasToken ? "Stored token — type to replace" : "REPORT_TOKEN"} className="border-slate-800 bg-black/40 font-mono text-xs" />
        <Button disabled={!token} onClick={() => save({ token })} className="bg-slate-700 text-white hover:bg-slate-600">Save</Button>
        {status?.hasToken && <Button variant="outline" onClick={() => save({ token: "" })}
          className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">Remove</Button>}
      </div>
      <p className="mt-1">Only for the ALNinja instance&rsquo;s operator: used instead of the mailed key, with no rate limit.</p>
    </details>
    {reporters.length > 0 && <ul className="mt-3 grid gap-1 font-mono text-[11px]">
      {reporters.map(last => <li key={last.reporter} className={last.ok ? "text-emerald-200/80" : "text-rose-300"}>
        {last.reporter}: {last.ok ? `accepted, ${last.stored ?? 0} new` : last.error} · {ago(last.at)}
      </li>)}
    </ul>}
    {(error || action.error || auth.error) && <p role="alert" className="mt-2 text-xs text-rose-300">{error || action.error?.message || auth.error?.message}</p>}
  </fieldset>;
}
