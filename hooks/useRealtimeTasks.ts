'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase, uniqueTopic } from '@/lib/supabase/client';
import { useHousehold } from '@/hooks/useHousehold';
import type { Task, TaskInput } from '@/types/database';

const KEY = (householdId: string) => ['tasks', householdId];

export class ConflictError extends Error {
  constructor() {
    super('A tarefa foi alterada por outra pessoa. Os dados foram recarregados.');
    this.name = 'ConflictError';
  }
}

function mapError(error: { message: string }): Error {
  return error.message.includes('CONFLICT') ? new ConflictError() : new Error(error.message);
}

/** Aplica um evento do Postgres Changes ao cache */
function applyChange(list: Task[], type: string, row: Task, oldRow?: Partial<Task>): Task[] {
  if (type === 'DELETE') return list.filter((t) => t.id !== (oldRow?.id ?? row?.id));
  const idx = list.findIndex((t) => t.id === row.id);
  if (idx === -1) return [...list, row];
  // ignora eventos defasados (version menor que a local)
  if (row.version < list[idx].version) return list;
  const copy = list.slice();
  copy[idx] = row;
  return copy;
}

export function useRealtimeTasks() {
  const { household, me } = useHousehold();
  const qc = useQueryClient();
  const hid = household.id;

  const query = useQuery({
    queryKey: KEY(hid),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('tasks').select('*').eq('household_id', hid)
        .order('due_date').order('created_at');
      if (error) throw error;
      return data as Task[];
    },
  });

  // Subscrição WebSocket
  useEffect(() => {
    const supabase = getSupabase();
    const ch = supabase
      .channel(uniqueTopic(`tasks:${hid}`))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `household_id=eq.${hid}` },
        (payload) => {
          qc.setQueryData<Task[]>(KEY(hid), (old = []) =>
            applyChange(old, payload.eventType, payload.new as Task, payload.old as Partial<Task>));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hid, qc]);

  const refetch = () => qc.invalidateQueries({ queryKey: KEY(hid) });
  const replace = (task: Task) =>
    qc.setQueryData<Task[]>(KEY(hid), (old = []) => applyChange(old, 'UPDATE', task));

  const createTask = useMutation({
    mutationFn: async (input: TaskInput) => {
      const { data, error } = await getSupabase()
        .from('tasks')
        .insert({ ...input, household_id: hid, created_by: me.id })
        .select().single();
      if (error) throw mapError(error);
      return data as Task;
    },
    onSuccess: replace,
  });

  const updateTask = useMutation({
    mutationFn: async ({ task, patch, reason }: { task: Task; patch: Partial<TaskInput>; reason?: string }) => {
      const { data, error } = await getSupabase().rpc('update_task', {
        p_task_id: task.id, p_expected_version: task.version, p_patch: patch, p_reason: reason ?? null,
      });
      if (error) throw mapError(error);
      return data as Task;
    },
    onSuccess: replace,
    onError: (e) => { if (e instanceof ConflictError) refetch(); },
  });

  const toggleComplete = useMutation({
    mutationFn: async (task: Task) => {
      const { data, error } = await getSupabase().rpc('toggle_task_complete', {
        p_task_id: task.id, p_expected_version: task.version,
      });
      if (error) throw mapError(error);
      return data as Task;
    },
    // atualização otimista instantânea para a microanimação do checkbox
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: KEY(hid) });
      const prev = qc.getQueryData<Task[]>(KEY(hid));
      qc.setQueryData<Task[]>(KEY(hid), (old = []) =>
        old.map((t): Task => {
          if (t.id !== task.id) return t;
          return t.status === 'completed'
            ? { ...t, status: 'pending', completed_at: null }
            : { ...t, status: 'completed', completed_at: new Date().toISOString() };
        }));
      return { prev };
    },
    onError: (e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY(hid), ctx.prev);
      if (e instanceof ConflictError) refetch();
    },
    onSuccess: replace,
    onSettled: refetch, // pega a próxima ocorrência recorrente
  });

  const requestDelete = useMutation({
    mutationFn: async ({ taskId, reason }: { taskId: string; reason?: string }) => {
      const { data, error } = await getSupabase().rpc('request_task_delete', {
        p_task_id: taskId, p_reason: reason ?? null,
      });
      if (error) throw mapError(error);
      return data as 'requested' | 'deleted';
    },
    onSettled: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ['approvals', hid] });
    },
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    createTask,
    updateTask,
    toggleComplete,
    requestDelete,
  };
}
