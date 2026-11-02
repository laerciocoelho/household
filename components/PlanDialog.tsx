'use client';

import { useEffect, useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useHousehold } from '@/hooks/useHousehold';
import { useRealtimePlans } from '@/hooks/useRealtimePlans';
import { PLAN_CATEGORIES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Plan, PlanCategory, PlanInput } from '@/types/database';

interface Props {
  open: boolean;
  plan: Plan | null; // null = criar
  onClose: () => void;
  /** Pergunta antes de mover para a coluna (ex.: etapas pendentes). Resolve false se o usuário recusar. */
  confirmMove?: (plan: Plan, toColumnId: string) => Promise<boolean>;
}

const emptyForm = (columnId: string): PlanInput => ({
  title: '', description: null, category: 'trip', column_id: columnId, target_date: null, is_personal: false,
});

/** Criar/editar plano. Ao editar, também gerencia as etapas (checklist). */
export function PlanDialog({ open, plan, onClose, confirmMove }: Props) {
  const { memberById } = useHousehold();
  const { items, columns, createPlan, updatePlan, deletePlan, addItem, toggleItem, deleteItem } = useRealtimePlans();
  const [form, setForm] = useState<PlanInput>(emptyForm(''));
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNewItem('');
    setForm(plan
      ? {
          title: plan.title, description: plan.description, category: plan.category, column_id: plan.column_id,
          target_date: plan.target_date, is_personal: plan.is_personal,
        }
      : emptyForm(columns[0]?.id ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id]);

  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const planItems = plan ? items.filter((i) => i.plan_id === plan.id) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError('Informe um título.');
    setSaving(true); setError(null);
    const payload: PlanInput = {
      ...form, title: form.title.trim(), description: form.description?.trim() || null,
    };
    try {
      if (plan) {
        const patch: Partial<PlanInput> = {};
        (Object.keys(payload) as (keyof PlanInput)[]).forEach((k) => {
          if (k !== 'is_personal' && payload[k] !== plan[k]) (patch as Record<string, unknown>)[k] = payload[k];
        });
        if (patch.column_id && confirmMove && !(await confirmMove(plan, patch.column_id))) {
          // recusou: nada é salvo e a coluna volta ao valor original
          set('column_id', plan.column_id);
          return;
        }
        if (Object.keys(patch).length > 0) await updatePlan.mutateAsync({ plan, patch });
      } else {
        await createPlan.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!plan || !window.confirm(`Excluir o plano "${plan.title}" e todas as suas etapas?`)) return;
    try { await deletePlan.mutateAsync(plan.id); onClose(); } catch (err) { setError((err as Error).message); }
  }

  async function add() {
    const title = newItem.trim();
    if (!plan || !title) return;
    setNewItem('');
    try { await addItem.mutateAsync({ plan, title }); } catch (err) { setError((err as Error).message); }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
  const label = 'mb-1 block text-xs font-medium text-slate-600';

  return (
    <Modal open={open} onClose={onClose} title={plan ? 'Editar plano' : 'Novo plano'}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Título</label>
          <input className={input} value={form.title} maxLength={150} autoFocus
                 placeholder="Ex.: Viagem para a praia" onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className={label}>Descrição / notas</label>
          <textarea className={input} rows={3} value={form.description ?? ''}
                    onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Categoria</label>
            <select className={input} value={form.category}
                    onChange={(e) => set('category', e.target.value as PlanCategory)}>
              {Object.entries(PLAN_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Coluna</label>
            <select className={input} value={form.column_id}
                    onChange={(e) => set('column_id', e.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>Data-alvo (opcional)</label>
            <input type="date" className={input} value={form.target_date ?? ''}
                   onChange={(e) => set('target_date', e.target.value || null)} />
          </div>
        </div>

        {(!plan || plan.is_personal) && (
          <label className={cn('flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-3', !plan && 'cursor-pointer')}>
            <input type="checkbox" className="mt-1 h-4 w-4" checked={form.is_personal} disabled={!!plan}
                   onChange={(e) => set('is_personal', e.target.checked)} />
            <span className="text-sm">
              <span className="flex items-center gap-1 font-medium text-slate-800">
                <Lock className="h-4 w-4" /> Plano pessoal
              </span>
              <span className="block text-xs text-slate-600">
                Somente você poderá ver e editar este plano (ótimo para surpresas). Não pode ser alterado depois.
              </span>
            </span>
          </label>
        )}

        {plan && (
          <div className="rounded-xl border p-3">
            <p className="mb-2 text-sm font-medium">
              Etapas ({planItems.filter((i) => i.done).length}/{planItems.length})
            </p>
            <ul className="space-y-1">
              {planItems.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={i.done} onChange={() => toggleItem.mutate(i)} />
                  <span className={cn('flex-1', i.done && 'text-slate-400 line-through')}>
                    {i.title}
                    {i.assigned_to && <em className="ml-1 text-xs text-slate-500">· {memberById(i.assigned_to)?.display_name}</em>}
                  </span>
                  <button type="button" onClick={() => deleteItem.mutate(i.id)} aria-label="Remover etapa"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {planItems.length === 0 && <li className="text-xs text-slate-500">Nenhuma etapa ainda.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <input className={input} value={newItem} maxLength={150} placeholder="Nova etapa (ex.: pesquisar hotéis)"
                     onChange={(e) => setNewItem(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
              <button type="button" onClick={add} aria-label="Adicionar etapa"
                      className="shrink-0 rounded-lg bg-slate-900 px-3 text-white">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-2">
          {plan ? (
            <button type="button" onClick={remove}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-slate-100">
              {plan ? 'Fechar' : 'Cancelar'}
            </button>
            <button disabled={saving}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
