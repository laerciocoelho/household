'use client';

import { useState } from 'react';
import { Check, Hourglass, Undo2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { MemberAvatar } from '@/components/MemberAvatar';
import { ChangeList } from '@/components/ChangeList';
import { useHousehold } from '@/hooks/useHousehold';
import { useApprovals } from '@/hooks/useRealtimeFeeds';
import { formatDateTime } from '@/lib/utils';
import type { ApprovalRequest } from '@/types/database';

const ACTION_TEXT: Record<string, string> = {
  task_delete: 'quer excluir a tarefa',
  task_edit: 'quer ajustar a tarefa',
};

const KIND_LABEL: Record<string, string> = { task_delete: 'exclusão', task_edit: 'ajuste' };

function Quote({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
      <span className="font-medium">{label}:</span> {text}
    </p>
  );
}

/** Lista reutilizável (usada na página /aprovacoes e no modal). */
export function ApprovalList({ showHistory = false }: { showHistory?: boolean }) {
  const { memberById } = useHousehold();
  const { pendingForMe, pendingByMe, all, decide, cancel } = useApprovals();
  const [error, setError] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null); // id da solicitação em recusa
  const [note, setNote] = useState('');

  const onError = (e: unknown) => setError((e as Error).message);

  const approve = (req: ApprovalRequest) => {
    setError(null);
    decide.mutate({ id: req.id, approve: true }, { onError });
  };

  const confirmRefuse = (req: ApprovalRequest) => {
    setError(null);
    decide.mutate({ id: req.id, approve: false, note: note.trim() || undefined }, {
      onError,
      onSuccess: () => { setRefusing(null); setNote(''); },
    });
  };

  const cancelRequest = (req: ApprovalRequest) => {
    if (!window.confirm('Cancelar esta solicitação?')) return;
    setError(null);
    cancel.mutate(req.id, { onError });
  };

  const history = all.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-600">Aguardando sua decisão</h3>
        {pendingForMe.length === 0 && <p className="text-sm text-slate-500">Nenhuma solicitação pendente.</p>}
        {pendingForMe.map((r) => {
          const author = memberById(r.requested_by);
          const isRefusing = refusing === r.id;
          return (
            <div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="flex items-start gap-3">
                <MemberAvatar member={author} />
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <b>{author?.display_name ?? 'Alguém'}</b> {ACTION_TEXT[r.entity_type] ?? 'fez uma solicitação'}{' '}
                    <b>“{r.proposed_payload?.title ?? 'tarefa'}”</b>
                  </p>
                  <p className="text-xs text-slate-500">{formatDateTime(r.created_at)}</p>
                  <Quote label="Motivo" text={r.request_note} />
                  {r.entity_type === 'task_edit' && <ChangeList changes={r.proposed_payload?.changes} />}
                </div>
              </div>

              {isRefusing ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-medium text-slate-600">Justificativa da recusa (opcional)</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    rows={2} maxLength={500} autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setRefusing(null); setNote(''); }}
                            className="rounded-lg px-3 py-1.5 text-sm hover:bg-slate-100">Voltar</button>
                    <button disabled={decide.isPending} onClick={() => confirmRefuse(r)}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                      <X className="h-4 w-4" /> Confirmar recusa
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    disabled={decide.isPending}
                    onClick={() => { setRefusing(r.id); setNote(''); }}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" /> Recusar
                  </button>
                  <button
                    disabled={decide.isPending}
                    onClick={() => approve(r)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" /> Aprovar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {pendingByMe.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-600">Enviadas por você</h3>
          {pendingByMe.map((r) => (
            <div key={r.id} className="rounded-xl border bg-amber-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  Aguardando aprovação para {r.entity_type === 'task_delete' ? 'excluir' : 'ajustar'}{' '}
                  <b>“{r.proposed_payload?.title ?? 'tarefa'}”</b>
                  <p className="text-xs text-slate-500">{formatDateTime(r.created_at)}</p>
                  <Quote label="Seu motivo" text={r.request_note} />
                  {r.entity_type === 'task_edit' && <ChangeList changes={r.proposed_payload?.changes} />}
                </div>
                <button
                  disabled={cancel.isPending}
                  onClick={() => cancelRequest(r)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Cancelar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {showHistory && history.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-600">Histórico</h3>
          {history.map((r) => {
            const reviewer = memberById(r.reviewed_by);
            const statusText =
              r.status === 'approved' ? `Aprovada por ${reviewer?.display_name ?? '—'}`
              : r.status === 'rejected' ? `Recusada por ${reviewer?.display_name ?? '—'}`
              : 'Cancelada pelo autor';
            const statusColor =
              r.status === 'approved' ? 'text-emerald-600' : r.status === 'rejected' ? 'text-red-600' : 'text-slate-500';
            return (
              <div key={r.id} className="rounded-xl border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span>
                    {memberById(r.requested_by)?.display_name}: “{r.proposed_payload?.title ?? 'tarefa'}”{' '}
                    <em className="text-xs text-slate-500">({KIND_LABEL[r.entity_type] ?? 'solicitação'})</em>
                  </span>
                  <span className={`text-xs font-medium ${statusColor}`}>{statusText}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Solicitada em {formatDateTime(r.created_at)}
                  {r.reviewed_at && ` · ${r.status === 'cancelled' ? 'Cancelada' : 'Respondida'} em ${formatDateTime(r.reviewed_at)}`}
                </p>
                <Quote label="Motivo" text={r.request_note} />
                <Quote label="Justificativa" text={r.decision_note} />
                {r.entity_type === 'task_edit' && <ChangeList changes={r.proposed_payload?.changes} />}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

export function MutualApprovalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Solicitações de aprovação">
      <ApprovalList />
    </Modal>
  );
}
