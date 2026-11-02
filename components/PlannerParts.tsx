'use client';

import { useState, type DragEvent } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { TaskCard } from '@/components/TaskCard';
import { MemberAvatar } from '@/components/MemberAvatar';
import { BOTH_COLOR } from '@/lib/constants';
import { cn, sortTasks, toISODate } from '@/lib/utils';
import type { Task } from '@/types/database';

const MIME = 'text/task-id';

/** Drag-and-drop compartilhado entre as visões Semanal e Mensal. */
export function usePlannerDnD(tasks: Task[]) {
  const { patch } = useTaskActions();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const find = (e: DragEvent) => tasks.find((t) => t.id === e.dataTransfer.getData(MIME));

  const dropOnDay = (e: DragEvent, day: Date) => {
    e.preventDefault();
    setHoverKey(null);
    const t = find(e);
    if (t && t.due_date !== toISODate(day)) patch(t, { due_date: toISODate(day) });
  };

  const dropOnMember = (e: DragEvent, memberId: string | null) => {
    e.preventDefault();
    setHoverKey(null);
    const t = find(e);
    if (t && t.assigned_to !== memberId) patch(t, { assigned_to: memberId });
  };

  return { hoverKey, setHoverKey, dropOnDay, dropOnMember };
}
export type PlannerDnD = ReturnType<typeof usePlannerDnD>;

const circleBtn =
  'flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100';

/** Navegação de período: descritivo centralizado com as setas (em círculo) logo ao lado. */
export function PeriodNav({
  label, onPrev, onNext, prevLabel, nextLabel, capitalize,
}: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; capitalize?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button onClick={onPrev} className={circleBtn} aria-label={prevLabel}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <h2 className={cn('min-w-36 text-center text-base font-semibold', capitalize && 'capitalize')}>{label}</h2>
      <button onClick={onNext} className={circleBtn} aria-label={nextLabel}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Alvos para reatribuir a tarefa arrastando (membros e "Ambos"). */
export function AssignTargets({ dnd }: { dnd: PlannerDnD }) {
  const { members } = useHousehold();
  const targets = [
    ...members.map((m) => ({ key: m.id, id: m.id as string | null, label: m.display_name, member: m })),
    { key: 'both', id: null as string | null, label: 'Ambos', member: undefined },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>Arraste uma tarefa para reatribuir:</span>
      {targets.map((t) => (
        <div
          key={t.key}
          onDragOver={(e) => { e.preventDefault(); dnd.setHoverKey(`m-${t.key}`); }}
          onDragLeave={() => dnd.setHoverKey(null)}
          onDrop={(e) => dnd.dropOnMember(e, t.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition',
            dnd.hoverKey === `m-${t.key}` ? 'border-slate-900 bg-slate-100' : 'border-slate-200'
          )}
        >
          <MemberAvatar member={t.member} size="xs" /> {t.label}
        </div>
      ))}
    </div>
  );
}

interface DayCellProps {
  day: Date;
  label: string;
  items: Task[];
  isSelected: boolean;
  isToday: boolean;
  dimmed?: boolean;
  maxChips?: number;
  className?: string;
  dnd: PlannerDnD;
  onSelect: (d: Date) => void;
  onCreate: (iso: string) => void;
}

/** Célula de dia: chips coloridos e contador de tarefas concluídas/total. */
export function DayCell({
  day, label, items, isSelected, isToday, dimmed, maxChips = 3, className, dnd, onSelect, onCreate,
}: DayCellProps) {
  const { memberById, isLockedByOther } = useHousehold();
  const iso = toISODate(day);
  const sorted = sortTasks(items);
  // Ponto 2: Lógica corrigida para tarefas concluídas de tarefas existentes (1/3)
  const completed = sorted.filter((t) => t.status === 'completed').length;
  const colorOf = (t: Task) => memberById(t.assigned_to)?.color_hex ?? BOTH_COLOR;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(day)}
      onDoubleClick={() => onCreate(iso)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(day); }}
      onDragOver={(e) => { e.preventDefault(); dnd.setHoverKey(`d-${iso}`); }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) dnd.setHoverKey(null);
      }}
      onDrop={(e) => dnd.dropOnDay(e, day)}
      className={cn(
        'flex min-h-16 cursor-pointer flex-col rounded-lg border bg-white p-1 text-left transition hover:bg-slate-50 sm:min-h-24',
        dimmed && 'opacity-40',
        isSelected && 'border-slate-900 bg-slate-50',
        isToday && 'ring-1 ring-slate-400',
        dnd.hoverKey === `d-${iso}` && 'bg-slate-200',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium capitalize">{label}</span>
        {items.length > 0 && (
          <span className="rounded-full bg-slate-200 px-1.5 text-[10px]">{completed}/{items.length}</span>
        )}
      </div>

      <div className="mt-1 hidden flex-col gap-0.5 sm:flex">
        {sorted.slice(0, maxChips).map((t) => {
          const locked = isLockedByOther(t.id) || t.status === 'pending_approval';
          return (
            <span
              key={t.id}
              draggable={!locked}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(MIME, t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title={t.title}
              className={cn(
                'truncate rounded px-1 text-[10px] text-white',
                !locked && 'cursor-grab active:cursor-grabbing',
                t.status === 'completed' && 'line-through opacity-60',
                t.status === 'pending_approval' && 'opacity-70 outline outline-1 outline-dashed outline-amber-400'
              )}
              style={{ backgroundColor: colorOf(t) }}
            >
              {t.title}
            </span>
          );
        })}
        {items.length > maxChips && <span className="text-[10px] text-slate-500">+{items.length - maxChips}</span>}
      </div>

      {/* mobile: pontinhos coloridos */}
      <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
        {sorted.slice(0, 6).map((t) => (
          <span key={t.id} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(t) }} />
        ))}
      </div>
    </div>
  );
}

/** Lista do dia selecionado, com todas as opções de interação. */
export function DayTasks({ day, tasks }: { day: Date; tasks: Task[] }) {
  const { toggle, openEdit, remove, openCreate } = useTaskActions();
  const sorted = sortTasks(tasks);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">{format(day, "EEEE, d 'de' MMMM", { locale: ptBR })}</h3>
        <button onClick={() => openCreate(toISODate(day))} className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white">
          Adicionar
        </button>
      </div>
      <div className="space-y-2">
        {sorted.length === 0 && <p className="text-sm text-slate-500">Sem tarefas neste dia.</p>}
        {sorted.map((t) => (
          <TaskCard key={t.id} task={t} draggable onToggle={toggle} onEdit={openEdit} onDelete={remove} />
        ))}
      </div>
    </section>
  );
}