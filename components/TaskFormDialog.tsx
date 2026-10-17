'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { useHousehold } from '@/hooks/useHousehold';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { PRIORITY_LABEL, RECURRENCE_LABEL, SHIFTS } from '@/lib/constants';
import { toISODate } from '@/lib/utils';
import type { PeriodShift, RecurrenceRule, Task, TaskInput, TaskPriority } from '@/types/database';

interface Props {
  open: boolean;
  task: Task | null; // null = criar
  defaultDate?: string;
  onClose: () => void;
}

interface FormState {
  title: string;
  description: string;
  assigned_to: string | null;
  period_shift: PeriodShift;
  due_date: string;
  due_time: string; // 'HH:mm' ou ''
  recurrence_rule: RecurrenceRule;
  priority: TaskPriority;
  requires_approval: boolean;
}

const emptyForm = (date: string): FormState => ({
  title: '', description: '', assigned_to: null, period_shift: 'anytime',
  due_date: date, due_time: '', recurrence_rule: 'none', priority: 'normal', requires_approval: false,
});

const fromTask = (t: Task): FormState => ({
  title: t.title, description: t.description ?? '', assigned_to: t.assigned_to,
  period_shift: t.period_shift, due_date: t.due_date, due_time: t.due_time?.slice(0, 5) ?? '',
  recurrence_rule: t.recurrence_rule, priority: t.priority, requires_approval: t.requires_approval,
});

const toInput = (f: FormState): TaskInput => ({
  title: f.title.trim(),
  description: f.description.trim() || null,
  assigned_to: f.assigned_to,
  period_shift: f.period_shift,
  due_date: f.due_date,
  due_time: f.due_time || null,
  recurrence_rule: f.recurrence_rule,
  priority: f.priority,
  requires_approval: f.requires_approval,
});

/** Somente os campos que realmente mudaram. */
function diffPatch(task: Task, f: FormState): Partial<TaskInput> {
  const next = toInput(f);
  const prev: TaskInput = {
    title: task.title, description: task.description || null, assigned_to: task.assigned_to,
    period_shift: task.period_shift, due_date: task.due_date, due_time: task.due_time?.slice(0, 5) ?? null,
    recurrence_rule: task.recurrence_rule, priority: task.priority, requires_approval: task.requires_approval,
  };
  const patch: Record<string, unknown> = {};
  (Object.keys(next) as (keyof TaskInput)[]).forEach((k) => {
    if (next[k] !== prev[k]) patch[k] = next[k];
  });
  return patch as Partial<TaskInput>;
}

export function TaskFormDialog({ open, task, defaultDate, onClose }: Props) {
  const { members, acquireLock, releaseLock } = useHousehold();
  const { notify } = useTaskActions();
  const { createTask, updateTask } = useRealtimeTasks();
  const [form, setForm] = useState<FormState>(emptyForm(defaultDate ?? toISODate(new Date())));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ao abrir em modo edição: adquire o lock (broadcast TASK_LOCK + heartbeat).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote('');
    if (task) {
      setForm(fromTask(task));
      const ok = acquireLock(task.id);
      if (!ok) { setError('Outra pessoa está editando esta tarefa agora.'); }
      return () => releaseLock(task.id);
    }
    setForm(emptyForm(defaultDate ?? toISODate(new Date())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const needsApproval = !!task?.requires_approval;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError('Informe um título.');
    setSaving(true);
    setError(null);
    try {
      if (task) {
        const patch = diffPatch(task, form);
        if (Object.keys(patch).length === 0) { onClose(); return; }
        const res = await updateTask.mutateAsync({
          task, patch, reason: needsApproval ? note.trim() || undefined : undefined,
        });
        if (res.status === 'pending_approval') notify('Solicitação de ajuste enviada ao seu parceiro(a).');
      } else {
        await createTask.mutateAsync(toInput(form));
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
  const label = 'mb-1 block text-xs font-medium text-slate-600';

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Editar tarefa' : 'Nova tarefa'}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Título</label>
          <input className={input} value={form.title} maxLength={150} autoFocus
                 onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className={label}>Descrição</label>
          <textarea className={input} rows={2} value={form.description}
                    onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Responsável</label>
            <select className={input} value={form.assigned_to ?? ''}
                    onChange={(e) => set('assigned_to', e.target.value || null)}>
              <option value="">Ambos</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Data</label>
            <input type="date" className={input} value={form.due_date}
                   onChange={(e) => set('due_date', e.target.value)} required />
          </div>
          <div>
            <label className={label}>Turno</label>
            <select className={input} value={form.period_shift}
                    onChange={(e) => set('period_shift', e.target.value as PeriodShift)}>
              {SHIFTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Horário (opcional)</label>
            <div className="flex gap-1">
              <input type="time" className={input} value={form.due_time}
                     onChange={(e) => set('due_time', e.target.value)} />
              {form.due_time && (
                <button type="button" onClick={() => set('due_time', '')}
                        className="rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100" aria-label="Remover horário">
                  Limpar
                </button>
              )}
            </div>
          </div>
          <div>
            <label className={label}>Recorrência</label>
            <select className={input} value={form.recurrence_rule}
                    onChange={(e) => set('recurrence_rule', e.target.value as RecurrenceRule)}>
              {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Prioridade</label>
            <select className={input} value={form.priority}
                    onChange={(e) => set('priority', e.target.value as TaskPriority)}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={form.requires_approval}
                 onChange={(e) => set('requires_approval', e.target.checked)} />
          <span className="text-sm">
            <span className="flex items-center gap-1 font-medium text-indigo-900">
              <ShieldCheck className="h-4 w-4" /> Exigir aprovação mútua
            </span>
            <span className="block text-xs text-indigo-800">
              Qualquer ajuste ou exclusão desta tarefa só valerá depois que o outro membro aprovar.
              {needsApproval && ' Desativar esta opção também exigirá aprovação.'}
            </span>
          </span>
        </label>

        {needsApproval && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-xs text-amber-900">
              Esta tarefa exige aprovação mútua: as alterações só serão aplicadas após seu parceiro(a) aprovar.
            </p>
            <label className={label}>Descrição do ajuste (opcional)</label>
            <textarea className={input} rows={2} maxLength={500} value={note}
                      onChange={(e) => setNote(e.target.value)} />
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving || (!!task && !!error?.includes('editando'))}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? 'Salvando…' : needsApproval ? 'Solicitar ajuste' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
