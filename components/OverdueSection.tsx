'use client';

import { format, isSameDay, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { TaskCard } from '@/components/TaskCard';
import { sortTasks } from '@/lib/utils';
import type { Task } from '@/types/database';

/**
 * Atrasadas = pendentes com data anterior a hoje + as que foram concluídas HOJE
 * (ficam visíveis até o fim do dia). Retorna a lista e o indicativo de conclusão.
 */
export function selectOverdue(tasks: Task[], now = new Date()) {
  const todayISO = format(now, 'yyyy-MM-dd');
  const completedToday = (t: Task) =>
    t.status === 'completed' && !!t.completed_at && isSameDay(parseISO(t.completed_at), now);
  const items = sortTasks(
    tasks.filter((t) => t.due_date < todayISO && (t.status !== 'completed' || completedToday(t))),
  );
  return { items, done: items.filter((t) => t.status === 'completed').length };
}

/** Lista "Atrasadas (concluídas/total)" compartilhada por Hoje, Semanal e Mensal. */
export function OverdueSection({ items, done }: { items: Task[]; done: number }) {
  const { toggle, openEdit, remove } = useTaskActions();
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
        <AlertTriangle className="h-4 w-4" /> Atrasadas ({done}/{items.length})
      </h2>
      <div className="space-y-2">
        {items.map((t) => (
          <TaskCard key={t.id} task={t} onToggle={toggle} onEdit={openEdit} onDelete={remove} />
        ))}
      </div>
    </section>
  );
}
