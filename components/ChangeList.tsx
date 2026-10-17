'use client';

import { format, parseISO } from 'date-fns';
import { useHousehold } from '@/hooks/useHousehold';
import { PRIORITY_LABEL, RECURRENCE_LABEL, SHIFT_LABEL } from '@/lib/constants';
import { formatTime } from '@/lib/utils';
import type { FieldChange, PeriodShift, RecurrenceRule, TaskPriority } from '@/types/database';

const FIELD_LABEL: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  assigned_to: 'Responsável',
  period_shift: 'Turno',
  due_date: 'Data',
  due_time: 'Horário',
  recurrence_rule: 'Recorrência',
  priority: 'Prioridade',
  requires_approval: 'Aprovação mútua',
};

/** Mostra "como era → como ficou" para cada campo alterado. */
export function ChangeList({ changes }: { changes: FieldChange[] | null | undefined }) {
  const { memberById } = useHousehold();
  if (!changes || changes.length === 0) return null;

  const show = (field: string, v: unknown): string => {
    switch (field) {
      case 'assigned_to':
        return v ? memberById(v as string)?.display_name ?? 'Membro removido' : 'Ambos';
      case 'period_shift':
        return SHIFT_LABEL[v as PeriodShift] ?? String(v);
      case 'due_date':
        return v ? format(parseISO(v as string), 'dd/MM/yyyy') : '—';
      case 'due_time':
        return v ? formatTime(v as string) : 'Sem horário';
      case 'recurrence_rule':
        return RECURRENCE_LABEL[v as RecurrenceRule] ?? String(v);
      case 'priority':
        return PRIORITY_LABEL[v as TaskPriority] ?? String(v);
      case 'requires_approval':
        return v ? 'Ativada' : 'Desativada';
      default:
        return v === null || v === undefined || v === '' ? '—' : String(v);
    }
  };

  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
      {changes.map((c) => (
        <li key={c.field} className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-slate-700">{FIELD_LABEL[c.field] ?? c.field}:</span>
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300">
            {show(c.field, c.from)}
          </span>
          <span aria-hidden>→</span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{show(c.field, c.to)}</span>
        </li>
      ))}
    </ul>
  );
}
