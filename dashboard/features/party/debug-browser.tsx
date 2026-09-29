'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { setLocalDebugAssets } from './game-image-url';
export const debugGameUrl = '/debug-game/vnc.html?autoconnect=1&resize=scale&path=debug-game/websockify';
export function useDebugBrowser() {
  return useQuery({
    queryKey: ['debug-browser'], staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch('/console-debug');
      if (!response.ok) return false;
      return (await response.json() as { insideDebug?: boolean }).insideDebug === true;
    },
  }).data === true;
}
export function DebugBrowserBanner() {
  const debug = useDebugBrowser();
  useEffect(() => { setLocalDebugAssets(debug); }, [debug]);
  if (!debug) return null;
  return <div className="flex flex-wrap items-center gap-3 border-b border-cyan-800 bg-slate-950 px-5 py-3 text-sm text-cyan-100">
    <span>Debug instance · god party · unlimited Cave visits</span>
    <a className="rounded border border-cyan-500 bg-cyan-950 px-3 py-2 text-cyan-100 hover:bg-cyan-900 hover:text-white" href={debugGameUrl} target="_blank" rel="noreferrer">Open game client</a>
    <span className="text-slate-300">View and control the running browser. Closing its viewer keeps the party running.</span>
  </div>;
}
