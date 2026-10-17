import { HouseholdProvider } from '@/hooks/useHousehold';
import { TaskActionsProvider } from '@/components/TaskActionsProvider';
import { AppShell } from '@/components/AppShell';
import { RedirectTo } from '@/components/RedirectTo';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HouseholdProvider
      loading={<div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">Carregando…</div>}
      empty={<RedirectTo href="/onboarding" />}
    >
      <TaskActionsProvider>
        <AppShell>{children}</AppShell>
      </TaskActionsProvider>
    </HouseholdProvider>
  );
}
