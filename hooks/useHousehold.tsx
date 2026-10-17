'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase, uniqueTopic } from '@/lib/supabase/client';
import { usePresenceLock, type PresenceLockApi } from '@/hooks/usePresenceLock';
import type { Household, HouseholdMember } from '@/types/database';

interface HouseholdContextValue extends PresenceLockApi {
  household: Household;
  members: HouseholdMember[];
  me: HouseholdMember;
  partner: HouseholdMember | undefined;
  memberById: (id: string | null | undefined) => HouseholdMember | undefined;
}

const Ctx = createContext<HouseholdContextValue | null>(null);

export function useHousehold() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHousehold deve ser usado dentro de <HouseholdProvider>');
  return v;
}

async function fetchContext() {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: mine } = await supabase
    .from('household_members').select('*').eq('user_id', auth.user.id).maybeSingle();
  if (!mine) return null;
  const [{ data: household }, { data: members }] = await Promise.all([
    supabase.from('households').select('*').eq('id', mine.household_id).single(),
    supabase.from('household_members').select('*').eq('household_id', mine.household_id).order('created_at'),
  ]);
  return { household: household as Household, members: (members ?? []) as HouseholdMember[], meId: mine.id as string };
}

/**
 * Carrega lar + membros e abre o canal de presença.
 * Renderiza `fallback` (ex.: redirect para /onboarding) quando o usuário ainda não tem lar.
 */
export function HouseholdProvider({
  children, loading, empty,
}: { children: ReactNode; loading?: ReactNode; empty?: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['household-context'], queryFn: fetchContext });

  const presence = usePresenceLock(data?.household.id, data?.meId);

  // realtime de membros e configurações do lar
  useEffect(() => {
    if (!data) return;
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`household-meta:${data.household.id}`))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${data.household.id}` },
        () => qc.invalidateQueries({ queryKey: ['household-context'] }))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${data.household.id}` },
        () => qc.invalidateQueries({ queryKey: ['household-context'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [data, qc]);

  const value = useMemo<HouseholdContextValue | null>(() => {
    if (!data) return null;
    const me = data.members.find((m) => m.id === data.meId)!;
    return {
      household: data.household,
      members: data.members,
      me,
      partner: data.members.find((m) => m.id !== data.meId),
      memberById: (id) => data.members.find((m) => m.id === id),
      ...presence,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, presence.onlineMemberIds, presence.editingMemberIds, presence.lockOwner, presence.isLockedByOther,
      presence.acquireLock, presence.releaseLock]);

  if (isLoading) return <>{loading ?? null}</>;
  if (!value) return <>{empty ?? null}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
