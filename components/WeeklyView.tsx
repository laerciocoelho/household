'use client';

import { useMemo, useState } from 'react';
import { addDays, addWeeks, endOfWeek, format, isSameDay, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { AssignTargets, DayCell, DayTasks, PeriodNav, usePlannerDnD } from '@/components/PlannerParts';
import { groupByDay, toISODate } from '@/lib/utils';

export function WeeklyView() {
  const { tasks } = useRealtimeTasks();
  const { openCreate } = useTaskActions();
  const dnd = usePlannerDnD(tasks);
  const [selected, setSelected] = useState(new Date());

  // Ponto 6: Semana iniciando no domingo (weekStartsOn: 0)
  const weekStart = startOfWeek(selected, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(selected, { weekStartsOn: 0 });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => groupByDay(tasks), [tasks]);

  const label = `${format(weekStart, 'd MMM', { locale: ptBR })} – ${format(weekEnd, 'd MMM', { locale: ptBR })}`;

  return (
    <div className="space-y-4">
      <PeriodNav
        label={label}
        onPrev={() => setSelected((d) => addWeeks(d, -1))}
        onNext={() => setSelected((d) => addWeeks(d, 1))}
        prevLabel="Semana anterior"
        nextLabel="Próxima semana"
      />

      <AssignTargets dnd={dnd} />

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            label={format(day, 'EEE d', { locale: ptBR })}
            items={byDay.get(toISODate(day)) ?? []}
            isSelected={isSameDay(day, selected)}
            isToday={isSameDay(day, new Date())}
            maxChips={5}
            className="sm:min-h-32"
            dnd={dnd}
            onSelect={setSelected}
            onCreate={openCreate}
          />
        ))}
      </div>

      <DayTasks day={selected} tasks={byDay.get(toISODate(selected)) ?? []} />
    </div>
  );
}