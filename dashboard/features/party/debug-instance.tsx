'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
type State = { phase: string; message: string; error?: string; port?: number; token?: string; project?: string; insideDebug?: boolean };
const colors = 'border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white';
export function DebugInstanceSettings() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true, busy = false;
    const refresh = async () => {
      if (busy) return; busy = true;
      try {
        const response = await fetch('/console-debug');
        if (!response.ok) throw Error('Debug service is starting or unavailable.');
        const value = await response.json() as State; if (alive) { setState(value); setError(''); }
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const action = async (name: 'start' | 'stop') => {
    setPending(true); setError('');
    try {
      const response = await fetch('/console-debug/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const value = await response.json() as State; if (!response.ok) throw Error(value.error || 'Debug request failed'); setState(value);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  const busy = pending || state?.phase === 'starting' || state?.phase === 'stopping';
  const href = state?.port && typeof window !== 'undefined' ? (() => {
    const url = new URL(window.location.origin); url.protocol = 'http:'; url.port = String(state.port); url.pathname = '/';
    url.hash = 'debug=' + state.token; return url.href;
  })() : '';
  if (state?.insideDebug) return <div className="border-t border-slate-700 pt-3"><h4 className="font-semibold">Debug instance</h4><p>God party · unlimited Cave visits. Stop this instance from your main console to destroy its data.</p></div>;
  return <div className="space-y-3 border-t border-slate-700 pt-3">
    <h4 className="font-semibold">Cave of Many Dreams debugging</h4>
    <p className="text-slate-300">Launch a separate game server and Party Console with a god-equipped party and unlimited Cave visits. Requires Docker. Stopping destroys the debug party and all its data.</p>
    <div className="flex flex-wrap items-center gap-2">
      {!state?.project && <Button className={colors} disabled={pending || !state} onClick={() => void action('start')}>Start debug instance</Button>}
      {state?.project && <Button className={colors} disabled={pending || state.phase === 'stopping'} onClick={() => void action('stop')}>Stop running</Button>}
      {state?.phase === 'running' && href && <a className="rounded border border-emerald-500 bg-emerald-950 px-3 py-2 text-emerald-100 hover:bg-emerald-900 hover:text-white" href={href} target="_blank" rel="noreferrer">Open debug console</a>}
      {busy && <LoaderCircle className="size-5 animate-spin text-slate-100" aria-label="Working" />}
    </div>
    <output aria-label="Debug instance status" className="block text-slate-300">{state?.message || 'Checking debug service…'}</output>
    {(state?.error || error) && <p role="alert" className="whitespace-pre-wrap text-rose-300">{state?.error || error}</p>}
  </div>;
}
