'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePartyAction } from './query-actions';
import type { Item } from './item';
import type { ItemMeta } from './item-meta';
import { primStackTargets, statScrollName, statScrollsPerStack, type PrimStackMethod } from '../../../runtime/prim-stack';

const secondary = 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white';
const control = 'rounded border border-slate-600 bg-slate-900 p-2 text-slate-100 disabled:text-slate-500';

/** Prim stacking (#65): Primling-only or Primling + stat-scroll operations raise grace without a level attempt. */
export function PrimStackDialog({ item, meta, name, label, character, slot, primlings, close }: {
  item: Item; meta?: ItemMeta | null; name: string; label: (id: string) => string; character: string; slot: number; primlings: number; close: () => void;
}) {
  const level = Number(item.level) || 0;
  const [target, setTarget] = useState(Math.min(15, level + 2));
  const statType = typeof item.stat_type === 'string' && Number(meta?.definition.stat) ? item.stat_type : null;
  const [method, setMethod] = useState<PrimStackMethod>('offering');
  const action = usePartyAction();
  const grades = Array.isArray(meta?.definition.grades) ? meta.definition.grades.map(Number) : undefined;
  const scrolls = statScrollsPerStack(level, grades);
  async function confirm() {
    action.reset();
    try { await action.mutateAsync({ path: '/prim-stack', body: { character, slot, item, target, method } }); close(); }
    catch { /* The error stays visible in the dialog. */ }
  }
  return <Dialog open onOpenChange={open => { if (!open && !action.isPending) close(); }}>
    <DialogContent className="border-slate-600 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>Prim stack</DialogTitle>
        <DialogDescription className="text-slate-300">
          Raise {name}&apos;s hidden grace without attempting an upgrade. Grace stays on the item until it is destroyed;
          during an upgrade it counts up to the next level + 1, and most when that attempt also uses an offering.
        </DialogDescription>
      </DialogHeader>
      <label className="flex flex-wrap items-center gap-2 text-sm">Stack until grace
        <select aria-label="Target grace" className={control} disabled={action.isPending} value={target} onChange={e => setTarget(Number(e.target.value))}>
          {primStackTargets.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <fieldset className="space-y-2 text-sm" disabled={action.isPending}><legend className="sr-only">Prim-stack method</legend>
        <label className="flex items-center gap-2"><input type="radio" name="prim-stack-method" checked={method === 'offering'} onChange={() => setMethod('offering')} />
          Primling only (+0.5 grace each)</label>
        <label className={`flex items-center gap-2 ${statType ? '' : 'text-slate-500'}`}><input type="radio" name="prim-stack-method" disabled={!statType}
          checked={method === 'stat'} onChange={() => setMethod('stat')} />
          {statType ? `Primling + ${scrolls.toLocaleString()} × ${label(statScrollName(statType))} (+1 grace each, keeps ${statType.toUpperCase()})` : 'Primling + stat scroll (needs an item with an applied stat)'}</label>
      </fieldset>
      <p className="text-xs text-slate-300">The merchant reads the current grace first and stops at the target. {primlings.toLocaleString()} Primling{primlings === 1 ? '' : 's'} in merchant inventory and storage.</p>
      {action.error && <p role="alert" className="text-sm text-rose-300">{action.error.message}</p>}
      <DialogFooter><Button variant="outline" className={secondary} disabled={action.isPending} onClick={close}>Cancel</Button>
        <Button className="border border-sky-400 bg-sky-700 text-white hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-400"
          disabled={action.isPending} onClick={() => void confirm()}>{action.isPending ? 'Queueing…' : 'Stack grace'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
