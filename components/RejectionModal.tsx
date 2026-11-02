'use client';

import { useState } from 'react';
import { Pencil, Trash2, XCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { MemberAvatar } from '@/components/MemberAvatar';
import { ChangeList } from '@/components/ChangeList';
import { useHousehold } from '@/hooks/useHousehold';
import { useApprovals } from '@/hooks/useRealtimeFeeds';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { formatDateTime } from '@/lib/utils';
import type { ApprovalRequest } from '@/types/database';

/**
 * Avisa quem solicitou o ajuste/exclusão que o parceiro(a) RECUSOU, mostrando a justificativa
 * e oferecendo uma ação (ajustar de novo / solicitar a exclusão de novo).
 */
export function RejectionModal() {
  const { memberById } = useHousehold();
  const { rejectedUnseen, ackRejections } = useApprovals();
  const { tasks } = useRealtimeTasks();
  const { openEdit, remove } = useTaskActions();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const list = rejectedUnseen.filter((r) => !dismissed.has(r.id));
  if (list.length === 0) return null;

  const close = () => setDismissed((d) => new Set([...d, ...list.map((r) => r.id)]));
  const ackAll = () => { ackRejections.mutate(list.map((r) => r.id)); close(); };

  const act = (r: ApprovalRequest) => {
    const task = tasks.find((t) => t.id === r.entity_id);
    ackRejections.mutate([r.id]);
    setDismissed((d) => new Set([...d, r.id]));
    if (!task) return;
    if (r.entity_type === 'task_delete') remove(task);
    else openEdit(task);
  };

  return (
    <Modal open onClose={close} title="Solicitação recusada">
      <div className="space-y-3">
        {list.map((r) => {
          const reviewer = memberById(r.reviewed_by);
          const task = tasks.find((t) => t.id === r.entity_id);
          const isDelete = r.entity_type === 'task_delete';
          return (
            <div key={r.id} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
              <div className="flex items-start gap-3">
                <MemberAvatar member={reviewer} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-start gap-1.5">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <span>
                      <b>{reviewer?.display_name ?? 'Seu parceiro(a)'}</b> recusou {isDelete ? 'a exclusão' : 'o ajuste'} de{' '}
                      <b>“{r.proposed_payload?.title ?? 'tarefa'}”</b>
                    </span>
                  </p>
                  {r.reviewed_at && <p className="text-xs text-slate-500">{formatDateTime(r.reviewed_at)}</p>}
                  <p className="mt-1.5 rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700">
                    <span className="font-medium">Justificativa:</span>{' '}
                    {r.decision_note ?? <em className="text-slate-500">nenhuma justificativa informada</em>}
                  </p>
                  {!isDelete && <ChangeList changes={r.proposed_payload?.changes} />}
                </div>
              </div>
              {task && (
                <div className="mt-3 flex justify-end">
                  <button onClick={() => act(r)}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
                    {isDelete ? <Trash2 className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                    {isDelete ? 'Solicitar exclusão novamente' : 'Ajustar novamente'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={ackAll} className="w-full rounded-lg border py-2 text-sm hover:bg-slate-50">
          Entendi
        </button>
      </div>
    </Modal>
  );
}
