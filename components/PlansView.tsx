'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, CalendarClock, Lock, Plus, Settings2, X } from 'lucide-react';
import { PlanDialog } from '@/components/PlanDialog';
import { PlanColumnsDialog } from '@/components/PlanColumnsDialog';
import { useRealtimePlans } from '@/hooks/useRealtimePlans';
import { PLAN_CATEGORIES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Plan, PlanCategory } from '@/types/database';

const MIME = 'text/plan-id';
const MAX_ITEMS_ON_CARD = 5;

interface Warning { text: string; undo: () => void }

export function PlansView() {
  const { plans, items, columns, isLoading, movePlan, toggleItem } = useRealtimePlans();
  const [filter, setFilter] = useState<PlanCategory | 'all'>('all');
  const [dialog, setDialog] = useState<{ open: boolean; planId: string | null }>({ open: false, planId: null });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showWarning = (w: Warning) => {
    clearTimeout(timer.current);
    setWarning(w);
    timer.current = setTimeout(() => setWarning(null), 10_000);
  };

  const visible = useMemo(
    () => plans
      .filter((p) => filter === 'all' || p.category === filter)
      // data-alvo mais próxima primeiro; sem data por último
      .sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999')),
    [plans, filter],
  );

  const itemsOf = (p: Plan) => items.filter((i) => i.plan_id === p.id);
  const dialogPlan = plans.find((p) => p.id === dialog.planId) ?? null;

  /** Avisa quando um plano com etapas pendentes avança para uma coluna à frente. */
  const warnIfForward = (plan: Plan, fromId: string, toId: string) => {
    const from = columns.find((c) => c.id === fromId);
    const to = columns.find((c) => c.id === toId);
    const pending = itemsOf(plan).filter((i) => !i.done).length;
    if (!from || !to || to.position <= from.position || pending === 0) return;
    const total = itemsOf(plan).length;
    showWarning({
      text: `“${plan.title}” foi para “${to.name}” com ${pending} de ${total} etapas ainda pendentes.`,
      undo: () => {
        const latest = plans.find((p) => p.id === plan.id) ?? plan;
        movePlan.mutate({ plan: latest, columnId: fromId }, { onError: (e) => setError((e as Error).message) });
        setWarning(null);
      },
    });
  };

  const drop = (e: DragEvent, columnId: string) => {
    e.preventDefault();
    setHoverCol(null);
    const plan = plans.find((p) => p.id === e.dataTransfer.getData(MIME));
    if (!plan || plan.column_id === columnId) return;
    setError(null);
    const from = plan.column_id;
    movePlan.mutate({ plan, columnId }, {
      onSuccess: () => warnIfForward(plan, from, columnId),
      onError: (err) => setError((err as Error).message),
    });
  };

  const chip = (active: boolean) =>
    cn('shrink-0 rounded-full border px-3 py-1 text-xs', active ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50');

  if (isLoading) return <p className="p-4 text-sm text-slate-500">Carregando…</p>;

  return (
    <div className="mx-auto max-w-[100rem] space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Planos</h1>
        <div className="flex gap-2">
          <button onClick={() => setColumnsOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            <Settings2 className="h-4 w-4" /> Colunas
          </button>
          <button onClick={() => setDialog({ open: true, planId: null })}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> Novo plano
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button className={chip(filter === 'all')} onClick={() => setFilter('all')}>Todos</button>
        {Object.entries(PLAN_CATEGORIES).map(([k, c]) => (
          <button key={k} className={chip(filter === k)} onClick={() => setFilter(k as PlanCategory)}>{c.label}</button>
        ))}
      </div>

      {error && (
        <p className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} aria-label="Fechar aviso"><X className="h-4 w-4" /></button>
        </p>
      )}

      <p className="text-xs text-slate-500">Arraste os cards entre as colunas. Marque as etapas direto no card.</p>

      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const list = visible.filter((p) => p.column_id === col.id);
          return (
            <section
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setHoverCol(col.id); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverCol(null); }}
              onDrop={(e) => drop(e, col.id)}
              className={cn(
                'w-72 shrink-0 space-y-2 rounded-2xl border bg-slate-100/60 p-2 transition',
                hoverCol === col.id && 'border-slate-900 bg-slate-200',
              )}
            >
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-slate-600">
                <span className="truncate">{col.name}</span>
                <span className="rounded-full bg-slate-200 px-2 text-xs">{list.length}</span>
              </h2>
              {list.length === 0 && (
                <p className="rounded-xl border border-dashed p-3 text-center text-xs text-slate-400">Solte um plano aqui</p>
              )}
              {list.map((p) => {
                const cat = PLAN_CATEGORIES[p.category];
                const Icon = cat.icon;
                const its = itemsOf(p);
                const done = its.filter((i) => i.done).length;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData(MIME, p.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onClick={() => setDialog({ open: true, planId: p.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter') setDialog({ open: true, planId: p.id }); }}
                    className="block w-full cursor-grab rounded-xl border border-l-4 bg-white p-3 text-left shadow-sm transition hover:bg-slate-50 active:cursor-grabbing"
                    style={{ borderLeftColor: cat.color }}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="shrink-0" style={{ color: cat.color }}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1 break-words">{p.title}</span>
                      {p.is_personal && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-label="Plano pessoal" />}
                    </p>
                    {p.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{cat.label}</span>
                      {p.target_date && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" />
                          {format(parseISO(p.target_date), "d 'de' MMM yyyy", { locale: ptBR })}
                        </span>
                      )}
                    </div>

                    {its.length > 0 && (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${(done / its.length) * 100}%`, backgroundColor: cat.color }} />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{done}/{its.length} etapas</p>
                        <ul className="mt-1 space-y-0.5">
                          {its.slice(0, MAX_ITEMS_ON_CARD).map((i) => (
                            <li key={i.id}>
                              <label className="flex cursor-pointer items-start gap-2 text-xs">
                                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0" checked={i.done}
                                       onChange={() => toggleItem.mutate(i, { onError: (e) => setError((e as Error).message) })} />
                                <span className={cn('min-w-0 break-words', i.done && 'text-slate-400 line-through')}>{i.title}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        {its.length > MAX_ITEMS_ON_CARD && (
                          <button type="button" onClick={() => setDialog({ open: true, planId: p.id })}
                                  className="mt-1 text-[11px] text-indigo-700 hover:underline">
                            + {its.length - MAX_ITEMS_ON_CARD} etapas
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {warning && (
        <div role="alert"
             className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-lg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{warning.text}</span>
          <button onClick={warning.undo} className="shrink-0 rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-medium hover:bg-amber-100">
            Desfazer
          </button>
          <button onClick={() => setWarning(null)} aria-label="Fechar aviso" className="shrink-0"><X className="h-4 w-4" /></button>
        </div>
      )}

      <PlanDialog
        open={dialog.open}
        plan={dialogPlan}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onColumnChanged={warnIfForward}
      />
      <PlanColumnsDialog open={columnsOpen} onClose={() => setColumnsOpen(false)} />
    </div>
  );
}
