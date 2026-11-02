'use client';

import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay } from 'date-fns';
import { getSupabase, uniqueTopic } from '@/lib/supabase/client';
import { useHousehold } from '@/hooks/useHousehold';
import type { ActivityLog, ApprovalRequest } from '@/types/database';

const PAGE_SIZE = 50;

/**
 * Solicitações PENDENTES (tempo real) + recusas ainda não vistas pelo autor.
 * O histórico fica em useApprovalHistory e só é buscado quando solicitado.
 */
export function useApprovals() {
  const { household, me } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;
  const key = ['approvals', hid];

  const pendingQuery = useQuery({
    queryKey: [...key, 'pending'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('approval_requests').select('*').eq('household_id', hid).eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ApprovalRequest[];
    },
  });

  // Recusas das minhas solicitações que ainda não vi
  const rejectedQuery = useQuery({
    queryKey: [...key, 'rejected-unseen', me.id],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('approval_requests').select('*').eq('household_id', hid)
        .eq('status', 'rejected').eq('requested_by', me.id).is('requester_ack_at', null)
        .order('reviewed_at', { ascending: false });
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['tasks', hid] });
  };

  const decide = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => {
      const { error } = await getSupabase().rpc('decide_approval', {
        p_request_id: id, p_approve: approve, p_note: note ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSettled: refresh,
  });

  /** O autor cancela a própria solicitação (some para o parceiro em tempo real). */
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().rpc('cancel_approval', { p_request_id: id });
      if (error) throw new Error(error.message);
    },
    onSettled: refresh,
  });

  /** O autor marca as recusas como vistas. */
  const ackRejections = useMutation({
    mutationFn: async (ids: string[]) => {
      const supabase = getSupabase();
      for (const id of ids) {
        const { error } = await supabase.rpc('ack_rejection', { p_request_id: id });
        if (error) throw new Error(error.message);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const pending = pendingQuery.data ?? [];
  return {
    pending,
    /** pendências que EU posso decidir (criadas pelo parceiro) */
    pendingForMe: pending.filter((r) => r.requested_by !== me.id),
    /** pendências que eu criei e aguardam o parceiro */
    pendingByMe: pending.filter((r) => r.requested_by === me.id),
    /** minhas solicitações recusadas que eu ainda não vi */
    rejectedUnseen: rejectedQuery.data ?? [],
    decide,
    cancel,
    ackRejections,
    isLoading: pendingQuery.isLoading,
  };
}

/**
 * Histórico de aprovações (já resolvidas), buscado sob demanda:
 * - `full = false`: somente a mais recente (1 linha);
 * - `full = true`: histórico completo, paginado de 50 em 50.
 */
export function useApprovalHistory(full: boolean) {
  const { household } = useHousehold();
  const hid = household.id;
  const base = ['approvals', hid, 'history'];

  const latest = useQuery({
    queryKey: [...base, 'latest'],
    enabled: !full,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('approval_requests').select('*').eq('household_id', hid).neq('status', 'pending')
        .order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      return data as ApprovalRequest[];
    },
  });

  const all = useInfiniteQuery({
    queryKey: [...base, 'full'],
    enabled: full,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = getSupabase()
        .from('approval_requests').select('*').eq('household_id', hid).neq('status', 'pending')
        .order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data as ApprovalRequest[];
    },
    getNextPageParam: (last) => (last.length === PAGE_SIZE ? last[last.length - 1].created_at : undefined),
  });

  return full
    ? {
        items: all.data?.pages.flat() ?? [],
        isLoading: all.isLoading,
        hasMore: !!all.hasNextPage,
        loadMore: () => all.fetchNextPage(),
        loadingMore: all.isFetchingNextPage,
      }
    : {
        items: latest.data ?? [],
        isLoading: latest.isLoading,
        hasMore: false,
        loadMore: () => {},
        loadingMore: false,
      };
}

/**
 * Feed de atividades sob demanda:
 * - `full = false`: apenas as atividades do dia atual (com INSERT em tempo real);
 * - `full = true`: histórico completo, paginado de 50 em 50.
 */
export function useActivityLogs(full: boolean) {
  const { household } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;
  const todayKey = ['activity', hid, 'today'];
  const fullKey = ['activity', hid, 'full'];

  const today = useQuery({
    queryKey: todayKey,
    enabled: !full,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('activity_logs').select('*').eq('household_id', hid)
        .gte('created_at', startOfDay(new Date()).toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ActivityLog[];
    },
  });

  const all = useInfiniteQuery({
    queryKey: fullKey,
    enabled: full,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = getSupabase()
        .from('activity_logs').select('*').eq('household_id', hid)
        .order('created_at', { ascending: false }).limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data as ActivityLog[];
    },
    getNextPageParam: (last) => (last.length === PAGE_SIZE ? last[last.length - 1].created_at : undefined),
  });

  useEffect(() => {
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`activity:${hid}`))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `household_id=eq.${hid}` },
        (payload) => {
          const row = payload.new as ActivityLog;
          qc.setQueryData<ActivityLog[]>(todayKey, (old) =>
            old === undefined || old.some((l) => l.id === row.id) ? old : [row, ...old]);
          qc.invalidateQueries({ queryKey: fullKey });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hid, qc]);

  return full
    ? {
        logs: all.data?.pages.flat() ?? [],
        isLoading: all.isLoading,
        hasMore: !!all.hasNextPage,
        loadMore: () => all.fetchNextPage(),
        loadingMore: all.isFetchingNextPage,
      }
    : {
        logs: today.data ?? [],
        isLoading: today.isLoading,
        hasMore: false,
        loadMore: () => {},
        loadingMore: false,
      };
}
