'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useRealtimePlans } from '@/hooks/useRealtimePlans';
import type { PlanColumn } from '@/types/database';

const MAX_COLUMNS = 10;

function ColumnRow({
  col, index, total, planCount, onMove, onDelete, onError,
}: {
  col: PlanColumn; index: number; total: number; planCount: number;
  onMove: (dir: -1 | 1) => void; onDelete: () => void; onError: (m: string) => void;
}) {
  const { renameColumn } = useRealtimePlans();
  const [name, setName] = useState(col.name);

  const save = () => {
    const v = name.trim();
    if (!v) { setName(col.name); return; }
    if (v !== col.name) renameColumn.mutate({ id: col.id, name: v }, { onError: (e) => onError((e as Error).message) });
  };

  return (
    <li className="flex items-center gap-2">
      <div className="flex flex-col">
        <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Mover para a esquerda"
                className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Mover para a direita"
                className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
      </div>
      <input
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        value={name} maxLength={30} aria-label="Nome da coluna"
        onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="w-14 shrink-0 text-center text-xs text-slate-500">{planCount} {planCount === 1 ? 'plano' : 'planos'}</span>
      <button type="button" disabled={total <= 1} onClick={onDelete} aria-label="Excluir coluna"
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Personaliza o quadro: renomear, reordenar, adicionar e excluir colunas. */
export function PlanColumnsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { columns, plans, addColumn, reorderColumns, deleteColumn } = useRealtimePlans();
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<PlanColumn | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onError = (m: string) => setError(m);
  const count = (id: string) => plans.filter((p) => p.column_id === id).length;

  const move = (index: number, dir: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    reorderColumns.mutate(ids, { onError: (e) => onError((e as Error).message) });
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    addColumn.mutate(name, { onSuccess: () => setNewName(''), onError: (e) => onError((e as Error).message) });
  };

  const startDelete = (col: PlanColumn) => {
    setError(null);
    setDeleting(col);
    setTarget(columns.find((c) => c.id !== col.id)?.id ?? '');
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteColumn.mutate({ id: deleting.id, moveTo: target || null }, {
      onSuccess: () => setDeleting(null),
      onError: (e) => onError((e as Error).message),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Colunas do quadro">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Renomeie, reordene (da esquerda para a direita) ou adicione colunas. Mover um plano para uma coluna mais à
          direita com etapas pendentes gera um aviso.
        </p>

        <ul className="space-y-2">
          {columns.map((c, i) => (
            <ColumnRow key={c.id} col={c} index={i} total={columns.length} planCount={count(c.id)}
                       onMove={(d) => move(i, d)} onDelete={() => startDelete(c)} onError={onError} />
          ))}
        </ul>

        {deleting && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Excluir a coluna <b>“{deleting.name}”</b>? Os planos dela serão movidos para:
            </p>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm">
              {columns.filter((c) => c.id !== deleting.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-lg px-3 py-1.5 text-xs hover:bg-amber-100">Voltar</button>
              <button type="button" disabled={deleteColumn.isPending} onClick={confirmDelete}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                Excluir coluna
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            placeholder={columns.length >= MAX_COLUMNS ? 'Limite de colunas atingido' : 'Nome da nova coluna'}
            value={newName} maxLength={30} disabled={columns.length >= MAX_COLUMNS}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
          <button type="button" onClick={add} disabled={columns.length >= MAX_COLUMNS || !newName.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">
            <Plus className="h-4 w-4" /> Adicionar
          </button>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={onClose} className="w-full rounded-lg border py-2 text-sm hover:bg-slate-50">Fechar</button>
      </div>
    </Modal>
  );
}
