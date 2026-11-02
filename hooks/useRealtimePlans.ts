'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase, uniqueTopic } from '@/lib/supabase/client';
import { useHousehold } from '@/hooks/useHousehold';
import type { Plan, PlanColumn, PlanInput, PlanItem } from '@/types/database';

const PLANS = (hid: string) => ['plans', hid];
const ITEMS = (hid: string) => ['plan-items', hid];
const COLUMNS = (hid: string) => ['plan-columns', hid];

/** Planos futuros + etapas, com atualização em tempo real (RLS já filtra os planos pessoais). */
export function useRealtimePlans() {
  const { household, me } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;

  const plansQuery = useQuery({
    queryKey: PLANS(hid),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('plans').select('*').eq('household_id', hid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Plan[];
    },
  });

  const itemsQuery = useQuery({
    queryKey: ITEMS(hid),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('plan_items').select('*').eq('household_id', hid)
        .order('created_at');
      if (error) throw error;
      return data as PlanItem[];
    },
  });

  const columnsQuery = useQuery({
    queryKey: COLUMNS(hid),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('plan_columns').select('*').eq('household_id', hid)
        .order('position').order('created_at');
      if (error) throw error;
      return data as PlanColumn[];
    },
  });

  useEffect(() => {
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`plans:${hid}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plans', filter: `household_id=eq.${hid}` },
        () => qc.invalidateQueries({ queryKey: PLANS(hid) }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items', filter: `household_id=eq.${hid}` },
        () => qc.invalidateQueries({ queryKey: ITEMS(hid) }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_columns', filter: `household_id=eq.${hid}` },
        () => { qc.invalidateQueries({ queryKey: COLUMNS(hid) }); qc.invalidateQueries({ queryKey: PLANS(hid) }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hid, qc]);

  const refreshColumns = () => {
    qc.invalidateQueries({ queryKey: COLUMNS(hid) });
    qc.invalidateQueries({ queryKey: PLANS(hid) });
  };
  const refreshPlans = () => qc.invalidateQueries({ queryKey: PLANS(hid) });
  const refreshItems = () => qc.invalidateQueries({ queryKey: ITEMS(hid) });

  const createPlan = useMutation({
    mutationFn: async (input: PlanInput) => {
      const { data, error } = await getSupabase().from('plans')
        .insert({ ...input, household_id: hid, created_by: me.id }).select().single();
      if (error) throw new Error(error.message);
      return data as Plan;
    },
    onSettled: refreshPlans,
  });

  /** Atualiza só se ninguém alterou o plano antes (concorrência otimista via version). */
  const updatePlan = useMutation({
    mutationFn: async ({ plan, patch }: { plan: Plan; patch: Partial<PlanInput> }) => {
      const { data, error } = await getSupabase().from('plans').update(patch)
        .eq('id', plan.id).eq('version', plan.version).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('O plano foi alterado por outra pessoa. Os dados foram recarregados.');
      }
      return data[0] as Plan;
    },
    onSettled: refreshPlans,
  });

  /** Move o plano de coluna (drag-and-drop) com atualização otimista. */
  const movePlan = useMutation({
    mutationFn: async ({ plan, columnId }: { plan: Plan; columnId: string }) => {
      const { data, error } = await getSupabase().from('plans').update({ column_id: columnId })
        .eq('id', plan.id).eq('version', plan.version).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('O plano foi alterado por outra pessoa. Os dados foram recarregados.');
      }
      return data[0] as Plan;
    },
    onMutate: async ({ plan, columnId }) => {
      await qc.cancelQueries({ queryKey: PLANS(hid) });
      qc.setQueryData<Plan[]>(PLANS(hid), (old = []) =>
        old.map((p) => (p.id === plan.id ? { ...p, column_id: columnId, version: p.version + 1 } : p)));
    },
    onSettled: refreshPlans,
  });

  const addColumn = useMutation({
    mutationFn: async (name: string) => {
      const position = (columnsQuery.data ?? []).reduce((m, c) => Math.max(m, c.position + 1), 0);
      const { error } = await getSupabase().from('plan_columns').insert({ household_id: hid, name, position });
      if (error) throw new Error(error.message);
    },
    onSettled: refreshColumns,
  });

  const renameColumn = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await getSupabase().from('plan_columns').update({ name }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSettled: refreshColumns,
  });

  const reorderColumns = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await getSupabase().rpc('reorder_plan_columns', { p_ids: ids });
      if (error) throw new Error(error.message);
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: COLUMNS(hid) });
      qc.setQueryData<PlanColumn[]>(COLUMNS(hid), (old = []) =>
        ids.map((id, i) => ({ ...old.find((c) => c.id === id)!, position: i })));
    },
    onSettled: refreshColumns,
  });

  const deleteColumn = useMutation({
    mutationFn: async ({ id, moveTo }: { id: string; moveTo: string | null }) => {
      const { error } = await getSupabase().rpc('delete_plan_column', { p_column_id: id, p_move_to: moveTo });
      if (error) throw new Error(error.message);
    },
    onSettled: refreshColumns,
  });

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().from('plans').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSettled: () => { refreshPlans(); refreshItems(); },
  });

  const addItem = useMutation({
    mutationFn: async (v: { plan: Plan; title: string; assigned_to?: string | null; due_date?: string | null }) => {
      const { error } = await getSupabase().from('plan_items').insert({
        plan_id: v.plan.id, household_id: hid, title: v.title,
        assigned_to: v.assigned_to ?? null, due_date: v.due_date ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSettled: refreshItems,
  });

  const toggleItem = useMutation({
    mutationFn: async (item: PlanItem) => {
      const { error } = await getSupabase().from('plan_items').update({ done: !item.done }).eq('id', item.id);
      if (error) throw new Error(error.message);
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: ITEMS(hid) });
      qc.setQueryData<PlanItem[]>(ITEMS(hid), (old = []) =>
        old.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    },
    onSettled: refreshItems,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().from('plan_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSettled: refreshItems,
  });

  return {
    plans: plansQuery.data ?? [],
    items: itemsQuery.data ?? [],
    columns: columnsQuery.data ?? [],
    isLoading: plansQuery.isLoading || itemsQuery.isLoading || columnsQuery.isLoading,
    movePlan, addColumn, renameColumn, reorderColumns, deleteColumn,
    createPlan, updatePlan, deletePlan, addItem, toggleItem, deleteItem,
  };
}
