'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, CalendarDays, Map, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useHousehold } from '@/hooks/useHousehold';
import { useApprovals } from '@/hooks/useRealtimeFeeds';
import { useTaskActions } from '@/components/TaskActionsProvider';
import { MemberAvatar } from '@/components/MemberAvatar';
import { SettingsMenu } from '@/components/SettingsMenu';
import { MutualApprovalModal } from '@/components/MutualApprovalModal';
import { RejectionModal } from '@/components/RejectionModal';
import { cn, toISODate } from '@/lib/utils';

const NAV: { href: string; label: string; icon: LucideIcon; badge?: boolean }[] = [
  { href: '/planejador', label: 'Planejamento', icon: CalendarDays },
  { href: '/planos', label: 'Planos', icon: Map },
  { href: '/aprovacoes', label: 'Aprovações', icon: ShieldCheck, badge: true },
  { href: '/atividades', label: 'Atividades', icon: Activity },
];

/**
 * Layout por orientação da tela:
 * - paisagem: barra lateral com tudo (nome do lar, parceiro, usuário, navegação, nova tarefa);
 * - retrato: sem barra lateral; tudo na barra superior.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { household, partner, onlineMemberIds, editingMemberIds } = useHousehold();
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

  const NavLink = ({ item, top }: { item: (typeof NAV)[number]; top?: boolean }) => {
    const active = pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        onClick={() => {
          if (item.href === '/planejador') window.dispatchEvent(new Event('planner:reset'));
        }}
        title={item.label}
        className={cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
          top && 'min-w-0 flex-1 flex-col gap-0.5 px-0.5 py-1.5 text-[10px]',
          active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
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
        {(top || !collapsed) && <span className={cn(top && 'max-w-full truncate')}>{item.label}</span>}
      </Link>
    );
  };

  const partnerPresence = partner && (
    <div className={cn('flex items-center gap-1.5 text-xs text-slate-600', collapsed && 'landscape:justify-center')}>
      <MemberAvatar
        member={partner}
        online={onlineMemberIds.has(partner.id)}
        editing={editingMemberIds.has(partner.id)}
      />
      <span className={cn(collapsed && 'landscape:hidden')}>
        {partner.display_name}
        {editingMemberIds.has(partner.id) && <em className="ml-1 text-slate-400">editando…</em>}
      </span>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-slate-50 text-slate-900">
      {/* Paisagem: barra lateral */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-3 overflow-y-auto border-r bg-white p-3 transition-all landscape:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="self-end rounded p-1.5 hover:bg-slate-100"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>

        {!collapsed && (
          <h1 className="break-words text-center text-base font-semibold">{household.name}</h1>
        )}
        <div className={cn('flex flex-col gap-2', collapsed ? 'items-center' : 'items-stretch')}>
          {partnerPresence}
          <SettingsMenu compact={collapsed} />
        </div>

        <nav className="flex flex-col gap-1 border-t pt-3">
          {NAV.map((item) => <NavLink key={item.href} item={item} />)}
        </nav>
        <button
          onClick={() => openCreate(toISODate(new Date()))}
          className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> {!collapsed && 'Nova tarefa'}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Retrato: barra superior com tudo */}
        <header className="sticky top-0 z-30 space-y-2 border-b bg-white/95 px-4 py-2 backdrop-blur landscape:hidden">
          <h1 className="truncate text-center text-base font-semibold">{household.name}</h1>
          <div className="flex items-center justify-between gap-3">
            {partnerPresence ?? <span />}
            <SettingsMenu />
          </div>
          <div className="flex items-stretch gap-1">
            {NAV.map((item) => <NavLink key={item.href} item={item} top />)}
            <button
              onClick={() => openCreate(toISODate(new Date()))}
              aria-label="Adicionar tarefa"
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-slate-900 px-0.5 py-1.5 text-[10px] text-white"
            >
              <Plus className="h-5 w-5" /> Nova
            </button>
          </div>
        </header>

        <main className="flex-1 pb-6">{children}</main>
      </div>

      <MutualApprovalModal open={approvalOpen} onClose={() => setApprovalOpen(false)} />
      <RejectionModal />
    </div>
  );
}
