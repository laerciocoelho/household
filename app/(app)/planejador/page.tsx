'use client';

import { useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('today');
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
