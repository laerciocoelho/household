'use client';

import { useMemo } from 'react';
import { format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { TaskCard } from '@/components/TaskCard';
import { SHIFTS } from '@/lib/constants';
import { formatLong, sortTasks } from '@/lib/utils';
import type { Task } from '@/types/database';

export function DailyView() {
  const { tasks, isLoading } = useRealtimeTasks();
  const { toggle, openEdit, remove, openCreate } = useTaskActions();
  const today = startOfDay(new Date());
  const todayISO = format(today, 'yyyy-MM-dd');

  const { overdue, overduePending, byShift, total, done } = useMemo(() => {
    const completedToday = (t: Task) =>
      t.status === 'completed' && !!t.completed_at && isSameDay(parseISO(t.completed_at), new Date());

    // Atrasadas: pendentes + as que foram concluídas HOJE (ficam visíveis até o fim do dia)
    const overdue = sortTasks(
      tasks.filter((t) => t.due_date < todayISO && (t.status !== 'completed' || completedToday(t)))
    );
    const todays = tasks.filter((t) => t.due_date === todayISO);
    const byShift = SHIFTS.map((s) => ({
      ...s, items: sortTasks(todays.filter((t) => t.period_shift === s.key)),
    }));
    return {
      overdue,
      overduePending: overdue.filter((t) => t.status !== 'completed').length,
      byShift,
      total: todays.length,
      done: todays.filter((t) => t.status === 'completed').length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todayISO]);

  const card = (t: Task) => (
    <TaskCard key={t.id} task={t} onToggle={toggle} onEdit={openEdit} onDelete={remove} />
  );

  if (isLoading) return <p className="p-4 text-sm text-slate-500">Carregando…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold capitalize">{formatLong(today)}</h1>
        <p className="text-sm text-slate-500">
          {total === 0 ? 'Nada para hoje.' : `${done} de ${total} concluídas`}
        </p>
      </div>

      {overdue.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" /> Atrasadas ({overduePending})
          </h2>
          <div className="space-y-2">{overdue.map(card)}</div>
        </section>
      )}

      {byShift.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.key}>
            <h2 className="mb-2 text-sm font-semibold text-slate-600">{g.label}</h2>
            <div className="space-y-2">{g.items.map(card)}</div>
          </section>
        )
      )}

      {total === 0 && overdue.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-slate-500">
          <CheckCircle2 className="h-10 w-10" />
          <p>Tudo em dia!</p>
          <button onClick={() => openCreate(todayISO)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
            Adicionar tarefa
          </button>
        </div>
      )}
    </div>
  );
}
