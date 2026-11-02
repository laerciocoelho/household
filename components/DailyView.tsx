'use client';

import { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { CheckCircle2 } from 'lucide-react';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { TaskCard } from '@/components/TaskCard';
import { OverdueSection, selectOverdue } from '@/components/OverdueSection';
import { SHIFTS } from '@/lib/constants';
import { formatLong, sortTasks } from '@/lib/utils';
import type { Task } from '@/types/database';

export function DailyView() {
  const { tasks, isLoading } = useRealtimeTasks();
  const { toggle, openEdit, remove, openCreate } = useTaskActions();
  const today = startOfDay(new Date());
  const todayISO = format(today, 'yyyy-MM-dd');

  const { overdue, byShift, total, done } = useMemo(() => {
    const overdue = selectOverdue(tasks);
    const todays = tasks.filter((t) => t.due_date === todayISO);
    const byShift = SHIFTS.map((s) => ({
      ...s, items: sortTasks(todays.filter((t) => t.period_shift === s.key)),
    }));
    return {
      overdue,
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
        {overdue.items.length > 0 && (
          <p className="text-sm text-red-600">
            Atrasadas: {overdue.done} de {overdue.items.length} concluídas
          </p>
        )}
      </div>

      <OverdueSection items={overdue.items} done={overdue.done} />

      {byShift.map((g) =>
        g.items.length === 0 ? null : (
          <section key={g.key}>
            <h2 className="mb-2 text-sm font-semibold text-slate-600">{g.label}</h2>
            <div className="space-y-2">{g.items.map(card)}</div>
          </section>
        )
      )}

      {total === 0 && overdue.items.length === 0 && (
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
