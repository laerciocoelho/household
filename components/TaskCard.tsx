'use client';

import { AlarmClock, Calendar, Check, Clock, Flag, Lock, Pencil, Repeat, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { MemberAvatar } from '@/components/MemberAvatar';
import { BOTH_COLOR, RECURRENCE_LABEL, SHIFT_LABEL } from '@/lib/constants';
import { cn, formatTime, isOverdue } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import type { Task } from '@/types/database';

interface Props {
  task: Task;
  compact?: boolean;
  draggable?: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
}

export function TaskCard({ task, compact, draggable, onToggle, onEdit, onDelete }: Props) {
  const { memberById, lockOwner, isLockedByOther, me } = useHousehold();
  const { cancel } = useTaskActions();
  const assignee = memberById(task.assigned_to);
  const accent = assignee?.color_hex ?? BOTH_COLOR;

  const lockedByOther = isLockedByOther(task.id);
  const locker = lockedByOther ? memberById(lockOwner(task.id)) : undefined;
  const pendingApproval = task.status === 'pending_approval';
  const mineRequest = pendingApproval && task.pending_by === me.id;
  const done = task.status === 'completed';
  const overdue = isOverdue(task.due_date, task.status);
  const disabled = lockedByOther || pendingApproval;

  // Data de atribuição formatada
  const formattedDueDate = task.due_date
    ? format(parseISO(task.due_date), 'dd/MM/yyyy')
    : null;

  return (
    <div
      draggable={draggable && !disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'group relative flex items-start gap-3 rounded-xl border bg-white p-3 shadow-sm transition',
        'border-l-4',
        draggable && !disabled && 'cursor-grab active:cursor-grabbing',
        done && 'opacity-60',
        pendingApproval && 'bg-amber-50',
        lockedByOther && 'ring-2'
      )}
      style={{
        borderLeftColor: accent,
        ...(lockedByOther && locker ? { ['--tw-ring-color' as string]: locker.color_hex } : {}),
      }}
    >
      {/* Checkbox com microanimação */}
      <button
        type="button"
        aria-label={done ? 'Reabrir tarefa' : 'Concluir tarefa'}
        disabled={disabled}
        onClick={() => onToggle(task)}
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200',
          'active:scale-75 disabled:cursor-not-allowed',
          lockedByOther && 'blur-[1.5px] select-none',
          done ? 'scale-100 border-transparent text-white' : 'border-slate-300 hover:border-slate-400'
        )}
        style={done ? { backgroundColor: accent } : undefined}
      >
        <Check className={cn('h-4 w-4 transition-transform duration-200', done ? 'scale-100' : 'scale-0')} />
      </button>

      <div className={cn('min-w-0 flex-1', lockedByOther && 'blur-[1.5px] select-none')}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className={cn('text-sm font-medium leading-snug', done && 'line-through text-slate-500')}>
            {task.title}
          </p>
          {formattedDueDate && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-normal">
              <Calendar className="h-3 w-3" /> {formattedDueDate}
            </span>
          )}
        </div>

        {!compact && task.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{task.description}</p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {task.due_time && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 font-medium text-white">
              <AlarmClock className="h-3 w-3" /> {formatTime(task.due_time)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            <Clock className="h-3 w-3" /> {SHIFT_LABEL[task.period_shift]}
          </span>
          {task.recurrence_rule !== 'none' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              <Repeat className="h-3 w-3" /> {RECURRENCE_LABEL[task.recurrence_rule]}
            </span>
          )}
          {task.requires_approval && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700"
              title="Ajustes e exclusão exigem aprovação do parceiro(a)"
            >
              <ShieldCheck className="h-3 w-3" /> Aprovação mútua
            </span>
          )}
          {task.priority === 'high' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
              <Flag className="h-3 w-3" /> Alta
            </span>
          )}
          {task.is_personal && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">
              <Lock className="h-3 w-3" /> Pessoal
            </span>
          )}
          {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">Atrasada</span>}
          {pendingApproval && (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-amber-900">
              {task.pending_action === 'edit' ? 'Ajuste aguardando aprovação' : 'Exclusão aguardando aprovação'}
            </span>
          )}
        </div>

        {mineRequest && (
          <button
            type="button"
            onClick={() => cancel(task)}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            <Undo2 className="h-3 w-3" /> Cancelar solicitação
          </button>
        )}

      </div>

      <div className={cn('flex shrink-0 flex-col items-end gap-1', lockedByOther && 'blur-[1.5px] select-none')}>
        <MemberAvatar member={assignee} size="xs" />
        <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
          <button
            type="button"
            aria-label="Editar"
            disabled={disabled}
            onClick={() => onEdit(task)}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Excluir"
            disabled={disabled}
            onClick={() => onDelete(task)}
            className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {lockedByOther && locker && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-white/30 px-3">
          <p className="flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-center text-xs font-bold text-red-600 shadow-sm">
            <Lock className="h-3.5 w-3.5 shrink-0" /> {locker.display_name} está editando esta tarefa agora
          </p>
        </div>
      )}
    </div>
  );
}