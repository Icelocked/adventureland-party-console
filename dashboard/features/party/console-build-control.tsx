"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {deploymentPending,type CandidateSummary,type Component,type ConsoleBuildStatus,type DeploymentJournal,type DeploymentMode} from "../../../tools/console-build/contracts";

const secondary = "border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white";
type Selection = { manifest: CandidateSummary; changed: Component[] };
const pendingKey='party-console-pending-deployment';
function remember(operation:DeploymentJournal|null){try{if(operation)sessionStorage.setItem(pendingKey,JSON.stringify(operation));else sessionStorage.removeItem(pendingKey);}catch{}}

export function ConsoleBuildControl({onActiveChange}:{onActiveChange?:(id:string|undefined)=>void} = {}) {
  const [status, setStatus] = useState<ConsoleBuildStatus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState(false);
  const [menuSelection, setMenuSelection] = useState<Selection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requested = useRef<{ id: string; target: string } | null>(null);
  const submittingRef = useRef(false);
  const dashboardHash=useRef<string|undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    try{const hint=JSON.parse(sessionStorage.getItem(pendingKey)||'null') as DeploymentJournal|null;if(hint&&deploymentPending(hint.phase)){requested.current={id:hint.id,target:hint.target};setStatus({builds:[],operation:hint});}}catch{}
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const response = await fetch("/console-build", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as ConsoleBuildStatus;
        if (controller.signal.aborted) return;
        setStatus(value);
        onActiveChange?.(value.active);
        const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
        dashboardHash.current ||= (window as Window & {__partyDashboardHash?:string}).__partyDashboardHash || navigation?.serverTiming?.find(timing=>timing.name==='party_dashboard')?.description || value.builds.find(build=>build.id===value.active)?.components.dashboard;
        if(value.operation&&deploymentPending(value.operation.phase))remember(value.operation);else remember(null);
        if (!requested.current && value.operation && deploymentPending(value.operation.phase))
          requested.current = {id: value.operation.id, target: value.operation.target};
        const own = requested.current;
        if (own && value.operation?.id === own.id && value.operation.target === own.target) {
          if (value.operation.phase === "complete" && value.active === own.target) {
            requested.current = null;
            const target=value.builds.find(build=>build.id===value.active)?.components.dashboard;
            if(target&&dashboardHash.current&&target!==dashboardHash.current){
              const key='party-console-handled-deployment';
              if(sessionStorage.getItem(key)!==own.id){sessionStorage.setItem(key,own.id);sessionStorage.setItem('party-console-scroll',String(window.scrollY));window.location.reload();}
            }
          } else if (value.operation.phase === "failed") {
            requested.current = null;
          }
        }
      } catch { /* Keep polling when activation temporarily interrupts the host. */ }
      finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [onActiveChange]);

  async function deploy(mode: DeploymentMode = 'now', picked = selection) {
    if (!picked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch("/console-build/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: picked.manifest.id, mode }),
      });
      const result = await response.json() as DeploymentJournal & { error?: string;operation?:DeploymentJournal };
      const reply=response.status===409&&result.operation?result.operation:result;
      if (!response.ok&&!result.operation) throw new Error(reply.error || "Could not start deployment.");
      remember(reply);
      requested.current = { id: reply.id, target: reply.target };
      setStatus(previous => previous && { ...previous, operation: reply });
      setSelection(null);
      setMenu(false);
    } catch {
      // Deployment diagnostics remain in the host journal, never beside the title.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!status) return null;
  const candidate = status.builds.find(build => build.id === status.available);
  const active = status.builds.find(build => build.id === status.active);
  const operation = status.operation;
  const busy = submitting || !!operation&&deploymentPending(operation.phase);
  const buildCount = Math.max(1, status.pendingBuildCount ?? status.builds.filter(build => build.id !== status.active && (!active || build.createdAt > active.createdAt)).length);
  return <>
    {(candidate && candidate.id !== status.active || busy) && <Popover open={menu} onOpenChange={open => {
      setMenu(open);
      if (open && candidate) { setMenuSelection({manifest: candidate, changed: (Object.keys(candidate.components) as Component[]).filter(key => candidate.components[key] !== active?.components[key])}); }
    }}><PopoverTrigger render={<Button
      size="icon" variant="outline" aria-busy={busy}
      aria-label="Deploy new console build" title="New console build ready to deploy"
      className="relative ml-3 border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white"
      />}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /><span aria-label={`${buildCount} completed builds since deployment`} className="pointer-events-none absolute bottom-0.5 left-0.5 z-10 min-w-3 rounded bg-black/85 px-0.5 text-center font-mono text-[10px] leading-3 text-emerald-300">{buildCount}</span></PopoverTrigger>
      <PopoverContent align="start" className="w-48 border border-gray-300 bg-white p-1 text-black shadow-xl data-open:animate-none data-closed:animate-none" aria-label="Load console build">
        {busy&&operation&&<p className="px-2 py-1 text-xs text-black">{operation.phase.replaceAll('-',' ')} · {new Date(operation.phaseStartedAt||operation.startedAt).toLocaleTimeString()}</p>}
        {busy&&operation?.waiting?.length?<p className="px-2 py-1 text-xs text-black">Waiting: {operation.waiting.join(', ')}</p>:null}
        {operation?.error&&<p className="break-words px-2 py-1 text-xs text-red-700">{operation.error}</p>}
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy} onClick={() => { setSelection(menuSelection); setMenu(false); }}>Load now</Button>
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy||status.cave} onClick={() => void deploy('safe', menuSelection)}>Load when safe</Button>
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy||status.cave} onClick={() => void deploy('main', menuSelection)}>Load at Main</Button>
      </PopoverContent>
    </Popover>}
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !submitting) setSelection(null); }}>
      <DialogContent showCloseButton={false} className="border-slate-600 bg-[#091614] text-slate-100">
        <DialogHeader><DialogTitle>Load console build now?</DialogTitle><DialogDescription className="text-slate-300">Loading now may interrupt combat and briefly disconnect headless characters. Characters could die while reconnecting. Load now anyway?</DialogDescription></DialogHeader>
        {selection && <div className="space-y-2 text-sm">
          <p>Build: <span className="break-all font-mono">{selection.manifest.id}</span></p>
          <p>Built: {selection.manifest.createdAt}</p>
          <p>Changed components: {selection.changed.join(", ") || "none"}</p>
          <p>Source: <span className="break-all font-mono">{selection.manifest.sourceHash}</span></p>
          {selection.manifest.commit && <p>Revision: <span className="break-all font-mono">{selection.manifest.commit}</span>{selection.manifest.dirty ? " (includes local changes)" : ""}</p>}
        </div>}
        <div className="flex justify-end gap-2">
          <Button disabled={submitting} className={secondary} onClick={() => setSelection(null)}>Cancel</Button>
          <Button disabled={busy} className="border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" onClick={() => void deploy()}>Load now</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
