'use client';

import { useEffect, useState } from 'react';
import { useHousehold } from '@/hooks/useHousehold';
import { DailyView } from '@/components/DailyView';
import { WeeklyView } from '@/components/WeeklyView';
import { MonthlyView } from '@/components/MonthlyView';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'today', label: 'Hoje' },
  { key: 'week', label: 'Semanal' },
  { key: 'month', label: 'Mensal' },
] as const;

type Tab = (typeof TABS)[number]['key'];

export default function PlanejadorPage() {
  const { me } = useHousehold();
  const preferred: Tab = me.preferred_view ?? 'today';
  const [tab, setTab] = useState<Tab>(preferred);

  // Clicar em "Planejamento" (já na tela) volta para a visão preferida
  useEffect(() => {
    const reset = () => setTab(preferred);
    window.addEventListener('planner:reset', reset);
    return () => window.removeEventListener('planner:reset', reset);
  }, [preferred]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="inline-flex rounded-lg border bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn('rounded-md px-4 py-1.5', tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'today' && <DailyView />}
      {tab === 'week' && <WeeklyView />}
      {tab === 'month' && <MonthlyView />}
    </div>
  );
}
