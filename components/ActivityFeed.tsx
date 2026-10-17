'use client';

import {
  CheckCircle2, Circle, Hourglass, Pencil, PlusCircle, ShieldQuestion, Trash2, Undo2, XCircle, type LucideIcon,
} from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useActivityLogs } from '@/hooks/useRealtimeFeeds';
import { MemberAvatar } from '@/components/MemberAvatar';
import { ChangeList } from '@/components/ChangeList';
import { formatDateTime, fromISODate } from '@/lib/utils';
import { format } from 'date-fns';
import type { ActivityAction } from '@/types/database';

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

/** Anexa a data de atribuição da tarefa ao título: Editou a tarefa "Título - dd/mm/aaaa" */
function withTaskDate(summary: string, taskDate?: string | null) {
  if (!taskDate) return summary;
  const date = format(fromISODate(taskDate), 'dd/MM/yyyy');
  const i = summary.lastIndexOf('"');
  return i > 0 ? `${summary.slice(0, i)} - ${date}${summary.slice(i)}` : summary;
}

export function ActivityFeed() {
  const { memberById } = useHousehold();
  const { logs, isLoading } = useActivityLogs();

  if (isLoading) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (logs.length === 0) return <p className="text-sm text-slate-500">Nenhuma atividade ainda.</p>;

  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-6">
      {logs.map((log) => {
        const member = memberById(log.member_id);
        const Icon = ACTION_ICON[log.action] ?? Pencil;
        const d = log.details;
        return (
          <li key={log.id} className="relative">
            <span className="absolute -left-[37px] top-0 rounded-full bg-white p-0.5">
              <MemberAvatar member={member} size="sm" />
            </span>
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <p className="flex items-start gap-2 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span>
                  <b>{member?.display_name ?? 'Alguém'}</b> — {withTaskDate(log.summary, d?.task_date)}
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
  );
}
