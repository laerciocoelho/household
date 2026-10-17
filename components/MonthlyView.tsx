'use client';

import { useMemo, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRealtimeTasks } from '@/hooks/useRealtimeTasks';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { AssignTargets, DayCell, DayTasks, PeriodNav, usePlannerDnD } from '@/components/PlannerParts';
import { groupByDay, toISODate } from '@/lib/utils';

// Ponto 6: Semana iniciando no domingo
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function MonthlyView() {
  const { tasks } = useRealtimeTasks();
  const { openCreate } = useTaskActions();
  const dnd = usePlannerDnD(tasks);
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(new Date());

  // Ponto 6: weekStartsOn: 0 para o calendário mensal
  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }),
  }), [cursor]);

  const byDay = useMemo(() => groupByDay(tasks), [tasks]);

  return (
    <div className="space-y-4">
      <PeriodNav
        label={format(cursor, 'MMMM yyyy', { locale: ptBR })}
        onPrev={() => setCursor((c) => addMonths(c, -1))}
        onNext={() => setCursor((c) => addMonths(c, 1))}
        prevLabel="Mês anterior"
        nextLabel="Próximo mês"
        capitalize
      />

      <AssignTargets dnd={dnd} />

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            label={format(day, 'd')}
            items={byDay.get(toISODate(day)) ?? []}
            isSelected={isSameDay(day, selected)}
            isToday={isSameDay(day, new Date())}
            dimmed={!isSameMonth(day, cursor)}
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