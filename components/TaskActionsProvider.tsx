'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useHousehold } from '@/hooks/useHousehold';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useApprovals } from '@/hooks/useRealtimeFeeds';
import { TaskFormDialog } from '@/components/TaskFormDialog';
import { NoteDialog, type NoteDialogConfig } from '@/components/NoteDialog';
import type { Task, TaskInput } from '@/types/database';

interface Actions {
  openCreate: (date?: string) => void;
  openEdit: (task: Task) => void;
  toggle: (task: Task) => void;
  remove: (task: Task) => void;
  patch: (task: Task, patch: Partial<TaskInput>) => void;
  /** O autor cancela a própria solicitação de ajuste/exclusão pendente. */
  cancel: (task: Task) => void;
  notify: (msg: string) => void;
}

const Ctx = createContext<Actions | null>(null);
export const useTaskActions = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTaskActions fora do provider');
  return v;
};

/** Centraliza diálogos de criação/edição, exclusão, justificativas e toasts para todas as views. */
export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const { isLockedByOther, memberById, lockOwner } = useHousehold();
  const { toggleComplete, requestDelete, updateTask } = useRealtimeTasks();
  const { pendingByMe, cancel: cancelRequest } = useApprovals();
  const [dialog, setDialog] = useState<{ open: boolean; task: Task | null; date?: string }>({
    open: false, task: null,
  });
  const [noteDialog, setNoteDialog] = useState<NoteDialogConfig | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const guardLock = useCallback((task: Task) => {
    if (isLockedByOther(task.id)) {
      const who = memberById(lockOwner(task.id))?.display_name ?? 'Seu parceiro(a)';
      notify(`${who} está editando esta tarefa agora.`);
      return true;
    }
    return false;
  }, [isLockedByOther, lockOwner, memberById, notify]);

  const actions = useMemo<Actions>(() => ({
    notify,
    openCreate: (date) => setDialog({ open: true, task: null, date }),
    openEdit: (task) => { if (!guardLock(task)) setDialog({ open: true, task }); },
    toggle: (task) => {
      if (guardLock(task)) return;
      if (task.status === 'completed' && !window.confirm(`Reativar a tarefa "${task.title}"? Ela voltará a ficar pendente.`)) return;
      toggleComplete.mutate(task, { onError: (e) => notify((e as Error).message) });
    },
    remove: (task) => {
      if (guardLock(task)) return;
      if (task.requires_approval) {
        setNoteDialog({
          title: 'Solicitar exclusão',
          description: `Excluir "${task.title}"? Seu parceiro(a) precisará aprovar.`,
          label: 'Motivo da exclusão (opcional)',
          confirmLabel: 'Solicitar exclusão',
          onConfirm: (note) =>
            requestDelete.mutate({ taskId: task.id, reason: note }, {
              onSuccess: (r) => notify(r === 'requested' ? 'Solicitação enviada ao seu parceiro(a).' : 'Tarefa excluída.'),
              onError: (e) => notify((e as Error).message),
            }),
        });
        return;
      }
      if (!window.confirm(`Excluir "${task.title}"?`)) return;
      requestDelete.mutate({ taskId: task.id }, {
        onSuccess: () => notify('Tarefa excluída.'),
        onError: (e) => notify((e as Error).message),
      });
    },
    patch: (task, p) => {
      if (guardLock(task)) return;
      const run = (reason?: string) =>
        updateTask.mutate({ task, patch: p, reason }, {
          onSuccess: (res) => {
            if (res.status === 'pending_approval') notify('Solicitação de ajuste enviada ao seu parceiro(a).');
          },
          onError: (e) => notify((e as Error).message),
        });
      if (task.requires_approval) {
        setNoteDialog({
          title: 'Solicitar ajuste',
          description: `"${task.title}" exige aprovação mútua. Seu parceiro(a) precisará aprovar a mudança.`,
          label: 'Descrição do ajuste (opcional)',
          confirmLabel: 'Solicitar ajuste',
          onConfirm: run,
        });
        return;
      }
      run();
    },
    cancel: (task) => {
      const req = pendingByMe.find((r) => r.entity_id === task.id);
      if (!req) return notify('Solicitação não encontrada.');
      if (!window.confirm('Cancelar esta solicitação?')) return;
      cancelRequest.mutate(req.id, {
        onSuccess: () => notify('Solicitação cancelada.'),
        onError: (e) => notify((e as Error).message),
      });
    },
  }), [guardLock, notify, requestDelete, toggleComplete, updateTask, pendingByMe, cancelRequest]);

  return (
    <Ctx.Provider value={actions}>
      {children}
      <TaskFormDialog
        open={dialog.open}
        task={dialog.task}
        defaultDate={dialog.date}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />
      <NoteDialog config={noteDialog} onClose={() => setNoteDialog(null)} />
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg md:bottom-6">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
