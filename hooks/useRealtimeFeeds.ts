'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase, uniqueTopic } from '@/lib/supabase/client';
import { useHousehold } from '@/hooks/useHousehold';
import type { ActivityLog, ApprovalRequest } from '@/types/database';

/** Solicitações de aprovação (tempo real) + decisão via RPC */
export function useApprovals() {
  const { household, me } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;
  const key = ['approvals', hid];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('approval_requests').select('*').eq('household_id', hid)
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data as ApprovalRequest[];
    },
  });

  useEffect(() => {
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`approvals:${hid}`))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests', filter: `household_id=eq.${hid}` },
        () => qc.invalidateQueries({ queryKey: key }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, qc]);

  const decide = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => {
      const { error } = await getSupabase().rpc('decide_approval', {
        p_request_id: id, p_approve: approve, p_note: note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['tasks', hid] });
    },
  });

  /** O autor cancela a própria solicitação (some para o parceiro em tempo real). */
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().rpc('cancel_approval', { p_request_id: id });
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['tasks', hid] });
    },
  });

  const all = query.data ?? [];
  const pending = all.filter((r) => r.status === 'pending');
  return {
    all,
    pending,
    /** pendências que EU posso decidir (criadas pelo parceiro) */
    pendingForMe: pending.filter((r) => r.requested_by !== me.id),
    /** pendências que eu criei e aguardam o parceiro */
    pendingByMe: pending.filter((r) => r.requested_by === me.id),
    decide,
    cancel,
    isLoading: query.isLoading,
  };
}

/** Feed de atividades com subscrição de INSERT */
export function useActivityLogs() {
  const { household } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;
  const key = ['activity', hid];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs').select('*').eq('household_id', hid)
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as ActivityLog[];
    },
  });

  useEffect(() => {
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`activity:${hid}`))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `household_id=eq.${hid}` },
        (payload) => {
          qc.setQueryData<ActivityLog[]>(key, (old = []) =>
            old.some((l) => l.id === (payload.new as ActivityLog).id) ? old : [payload.new as ActivityLog, ...old]);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, qc]);

  return { logs: query.data ?? [], isLoading: query.isLoading };
}
