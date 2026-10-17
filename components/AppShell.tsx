'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, CalendarDays, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useApprovals } from '@/hooks/useRealtimeFeeds';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { MemberAvatar } from '@/components/MemberAvatar';
import { SettingsMenu } from '@/components/SettingsMenu';
import { MutualApprovalModal } from '@/components/MutualApprovalModal';
import { cn, toISODate } from '@/lib/utils';

const NAV: { href: string; label: string; icon: LucideIcon; badge?: boolean }[] = [
  { href: '/planejador', label: 'Planejamento', icon: CalendarDays },
  { href: '/aprovacoes', label: 'Aprovações', icon: ShieldCheck, badge: true },
  { href: '/atividades', label: 'Atividades', icon: Activity },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { household, me, partner, onlineMemberIds, editingMemberIds } = useHousehold();
  const { pendingForMe } = useApprovals();
  const { openCreate } = useTaskActions();
  const [collapsed, setCollapsed] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);

  // Abre o modal quando chega uma nova solicitação do parceiro e fecha quando não restar nenhuma
  // (ex.: o autor cancelou a solicitação).
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (prevCount.current !== null && pendingForMe.length > prevCount.current) setApprovalOpen(true);
    if (pendingForMe.length === 0) setApprovalOpen(false);
    prevCount.current = pendingForMe.length;
  }, [pendingForMe.length]);

  const badge = pendingForMe.length;

  const NavLink = ({ item, mobile }: { item: (typeof NAV)[number]; mobile?: boolean }) => {
    const active = pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        onClick={() => {
          if (item.href === '/planejador') window.dispatchEvent(new Event('planner:reset'));
        }}
        className={cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
          mobile && 'flex-col gap-0.5 px-2 py-1 text-[10px]',
          active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          mobile && active && 'bg-transparent text-slate-900 font-semibold'
        )}
      >
        <span className="relative">
          <Icon className="h-5 w-5" />
          {item.badge && badge > 0 && (
            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        {(mobile || !collapsed) && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <div className="flex min-h-dvh bg-slate-50 text-slate-900">
      {/* Sidebar desktop */}
      <aside className={cn('hidden shrink-0 flex-col border-r bg-white p-3 transition-all md:flex', collapsed ? 'w-16' : 'w-60')}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mb-4 self-end rounded p-1.5 hover:bg-slate-100"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => <NavLink key={item.href} item={item} />)}
        </nav>
        <button
          onClick={() => openCreate(toISODate(new Date()))}
          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> {!collapsed && 'Nova tarefa'}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header fixo: nome do lar, presença do parceiro e quem está logado */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-white/90 px-4 py-3 backdrop-blur">
          <h1 className="truncate text-base font-semibold">{household.name}</h1>
          <div className="flex shrink-0 items-center gap-3">
            {partner && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <MemberAvatar
                  member={partner}
                  online={onlineMemberIds.has(partner.id)}
                  editing={editingMemberIds.has(partner.id)}
                />
                <span className="hidden sm:inline">
                  {partner.display_name}
                  {editingMemberIds.has(partner.id) && <em className="ml-1 text-slate-400">editando…</em>}
                </span>
              </div>
            )}
            <SettingsMenu />
          </div>
        </header>

        <main className="flex-1 pb-24 md:pb-6">{children}</main>
      </div>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 items-center border-t bg-white px-1 pb-[env(safe-area-inset-bottom)] md:hidden">
        <NavLink item={NAV[0]} mobile />
        <NavLink item={NAV[1]} mobile />
        <div className="flex justify-center">
          <button
            onClick={() => openCreate(toISODate(new Date()))}
            aria-label="Adicionar tarefa"
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg active:scale-95"
          >
            <Plus className="h-7 w-7" />
          </button>
        </div>
        <NavLink item={NAV[2]} mobile />
      </nav>

      <MutualApprovalModal open={approvalOpen} onClose={() => setApprovalOpen(false)} />
    </div>
  );
}
