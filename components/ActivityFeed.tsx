'use client';

import {
  CheckCircle2, Circle, Hourglass, Pencil, PlusCircle, ShieldQuestion, Trash2, Undo2, XCircle, type LucideIcon,
} from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useState } from 'react';
import { useActivityLogs } from '@/hooks/useRealtimeFeeds';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { MemberAvatar } from '@/components/MemberAvatar';
import { ChangeList } from '@/components/ChangeList';
import { formatDateTime, fromISODate } from '@/lib/utils';
import { format } from 'date-fns';
import type { ActivityAction, ActivityLog, Task } from '@/types/database';

const ACTION_ICON: Record<ActivityAction, LucideIcon> = {
  created: PlusCircle,
  updated: Pencil,
  completed: CheckCircle2,
  uncompleted: Circle,
  deletion_requested: ShieldQuestion,
  edit_requested: Hourglass,
  deleted: Trash2,
  rejected: XCircle,
  cancelled: Undo2,
};

/**
 * Quebra o resumo no trecho entre aspas (título da tarefa) para torná-lo clicável.
 * Ex.: Editou a tarefa "Título" -> [Editou a tarefa "] [Título - dd/mm/aaaa] ["]
 */
function splitSummary(log: ActivityLog) {
  const first = log.summary.indexOf('"');
  const last = log.summary.lastIndexOf('"');
  if (first < 0 || last <= first) return null;
  const date = log.details?.task_date ? format(fromISODate(log.details.task_date), 'dd/MM/yyyy') : null;
  const title = log.summary.slice(first + 1, last);
  return {
    before: log.summary.slice(0, first + 1),
    label: date ? `${title} - ${date}` : title,
    after: log.summary.slice(last),
  };
}

export function ActivityFeed() {
  const { memberById } = useHousehold();
  const { tasks } = useRealtimeTasks();
  const { openEdit } = useTaskActions();
  const [full, setFull] = useState(false);
  const { logs, isLoading, hasMore, loadMore, loadingMore } = useActivityLogs(full);

  const toggle = (
    <div className="mb-4 flex justify-end">
      <button onClick={() => setFull((f) => !f)} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
        {full ? 'Ver apenas hoje' : 'Ver histórico completo'}
      </button>
    </div>
  );

  if (isLoading) return <>{toggle}<p className="text-sm text-slate-500">Carregando…</p></>;
  if (logs.length === 0) {
    return <>{toggle}<p className="text-sm text-slate-500">{full ? 'Nenhuma atividade ainda.' : 'Nenhuma atividade hoje.'}</p></>;
  }

  return (
    <>
    {toggle}
    <ol className="relative space-y-4 border-l border-slate-200 pl-6">
      {logs.map((log) => {
        const member = memberById(log.member_id);
        const Icon = ACTION_ICON[log.action] ?? Pencil;
        const d = log.details;
        const parts = log.entity_type === 'task' ? splitSummary(log) : null;
        // só é clicável enquanto a tarefa ainda existe (e é visível para mim)
        const task: Task | undefined = parts ? tasks.find((t) => t.id === log.entity_id) : undefined;
        return (
          <li key={log.id} className="relative">
            <span className="absolute -left-[37px] top-0 rounded-full bg-white p-0.5">
              <MemberAvatar member={member} size="sm" />
            </span>
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <p className="flex items-start gap-2 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span>
                  <b>{member?.display_name ?? 'Alguém'}</b> —{' '}
                  {parts ? (
                    <>
                      {parts.before}
                      {task ? (
                        <button type="button" onClick={() => openEdit(task)}
                                title="Abrir a tarefa para ajuste"
                                className="rounded font-medium text-indigo-700 underline decoration-dotted underline-offset-2 hover:bg-indigo-50">
                          {parts.label}
                        </button>
                      ) : parts.label}
                      {parts.after}
                    </>
                  ) : log.summary}
                </span>
              </p>
              <ChangeList changes={d?.changes} />
              {d?.request_note && (
                <p className="mt-1.5 text-xs text-slate-600"><b>Motivo:</b> {d.request_note}</p>
              )}
              {d?.decision_note && (
                <p className="mt-1.5 text-xs text-slate-600"><b>Justificativa:</b> {d.decision_note}</p>
              )}
              <time className="mt-1 block text-xs text-slate-500">{formatDateTime(log.created_at)}</time>
            </div>
          </li>
        );
      })}
    </ol>
    {full && hasMore && (
      <button onClick={loadMore} disabled={loadingMore}
              className="mt-4 w-full rounded-lg border py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {loadingMore ? 'Carregando…' : 'Carregar mais'}
      </button>
    )}
    </>
  );
}
