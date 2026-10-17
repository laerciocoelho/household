'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { HEARTBEAT_MS, LOCK_TIMEOUT_MS } from '@/lib/constants';
import type { LockPayload, PresenceState } from '@/types/database';

interface LockEntry {
  memberId: string;
  lastBeat: number; // epoch ms do último heartbeat recebido
}

export interface PresenceLockApi {
  /** ids dos membros atualmente online */
  onlineMemberIds: Set<string>;
  /** ids dos membros que estão com algum modal de edição aberto */
  editingMemberIds: Set<string>;
  /** retorna o id do membro que detém o lock (se ativo e não-expirado) */
  lockOwner: (taskId: string) => string | null;
  /** true se outro membro (não eu) está editando */
  isLockedByOther: (taskId: string) => boolean;
  acquireLock: (taskId: string) => boolean;
  releaseLock: (taskId: string) => void;
}

/**
 * Presença + Soft Lock via Supabase Realtime.
 * - Presence: online/offline e "editando".
 * - Broadcast: TASK_LOCK (também usado como heartbeat) e TASK_UNLOCK.
 * - Expiração: sem heartbeat por LOCK_TIMEOUT_MS (45s) o lock é descartado localmente.
 */
export function usePresenceLock(householdId: string | undefined, myMemberId: string | undefined): PresenceLockApi {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myLockRef = useRef<string | null>(null); // taskId que eu travei
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subscribedRef = useRef(false);

  const [locks, setLocks] = useState<Map<string, LockEntry>>(new Map());
  const [presence, setPresence] = useState<Record<string, PresenceState>>({});
  const [, forceTick] = useState(0);

  const trackPresence = useCallback((editingTaskId: string | null) => {
    if (!channelRef.current || !subscribedRef.current || !myMemberId) return;
    channelRef.current.track({
      memberId: myMemberId,
      editingTaskId,
      onlineAt: Date.now(),
    } satisfies PresenceState);
  }, [myMemberId]);

  const sendLock = useCallback((taskId: string) => {
    if (!channelRef.current || !subscribedRef.current || !myMemberId) return;
    const payload: LockPayload = { taskId, memberId: myMemberId, lockedAt: Date.now() };
    channelRef.current.send({ type: 'broadcast', event: 'TASK_LOCK', payload });
  }, [myMemberId]);

  const stopHeartbeat = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  };

  const releaseLock = useCallback((taskId: string) => {
    if (myLockRef.current !== taskId) return;
    myLockRef.current = null;
    stopHeartbeat();
    if (channelRef.current && subscribedRef.current && myMemberId) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'TASK_UNLOCK',
        payload: { taskId, memberId: myMemberId, lockedAt: Date.now() } satisfies LockPayload,
      });
    }
    trackPresence(null);
  }, [myMemberId, trackPresence]);

  const acquireLock = useCallback((taskId: string) => {
    if (!myMemberId) return false;
    const existing = locks.get(taskId);
    if (existing && existing.memberId !== myMemberId && Date.now() - existing.lastBeat < LOCK_TIMEOUT_MS) {
      return false; // outro membro já está editando
    }
    if (myLockRef.current && myLockRef.current !== taskId) releaseLock(myLockRef.current);
    myLockRef.current = taskId;
    sendLock(taskId);
    trackPresence(taskId);
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => sendLock(taskId), HEARTBEAT_MS);
    return true;
  }, [locks, myMemberId, releaseLock, sendLock, trackPresence]);

  // Canal
  useEffect(() => {
    if (!householdId || !myMemberId) return;
    const supabase = getSupabase();
    const channel = supabase.channel(`household:${householdId}`, {
      config: { presence: { key: myMemberId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceState>();
        const next: Record<string, PresenceState> = {};
        Object.entries(state).forEach(([key, metas]) => {
          const last = metas[metas.length - 1];
          if (last) next[key] = last;
        });
        setPresence(next);
        // remove locks de quem saiu
        setLocks((prev) => {
          const copy = new Map(prev);
          copy.forEach((entry, taskId) => {
            if (!next[entry.memberId]) copy.delete(taskId);
          });
          return copy;
        });
      })
      .on('broadcast', { event: 'TASK_LOCK' }, ({ payload }) => {
        const p = payload as LockPayload;
        if (p.memberId === myMemberId) return;
        setLocks((prev) => new Map(prev).set(p.taskId, { memberId: p.memberId, lastBeat: Date.now() }));
      })
      .on('broadcast', { event: 'TASK_UNLOCK' }, ({ payload }) => {
        const p = payload as LockPayload;
        setLocks((prev) => {
          const copy = new Map(prev);
          if (copy.get(p.taskId)?.memberId === p.memberId) copy.delete(p.taskId);
          return copy;
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true;
          channel.track({ memberId: myMemberId, editingTaskId: null, onlineAt: Date.now() } satisfies PresenceState);
        }
      });

    // limpeza periódica de locks expirados + re-render para a UI refletir
    const sweep = setInterval(() => {
      setLocks((prev) => {
        let changed = false;
        const copy = new Map(prev);
        const now = Date.now();
        copy.forEach((entry, taskId) => {
          if (now - entry.lastBeat >= LOCK_TIMEOUT_MS) {
            copy.delete(taskId);
            changed = true;
          }
        });
        return changed ? copy : prev;
      });
      forceTick((n) => n + 1);
    }, 5_000);

    const onUnload = () => {
      if (myLockRef.current) releaseLock(myLockRef.current);
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      clearInterval(sweep);
      stopHeartbeat();
      if (myLockRef.current) releaseLock(myLockRef.current);
      subscribedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, myMemberId]);

  const lockOwner = useCallback((taskId: string) => {
    const entry = locks.get(taskId);
    if (!entry) return null;
    if (Date.now() - entry.lastBeat >= LOCK_TIMEOUT_MS) return null;
    return entry.memberId;
  }, [locks]);

  const isLockedByOther = useCallback((taskId: string) => {
    const owner = lockOwner(taskId);
    return !!owner && owner !== myMemberId;
  }, [lockOwner, myMemberId]);

  const onlineMemberIds = useMemo(() => new Set(Object.keys(presence)), [presence]);
  const editingMemberIds = useMemo(
    () => new Set(Object.values(presence).filter((p) => p.editingTaskId).map((p) => p.memberId)),
    [presence]
  );

  return { onlineMemberIds, editingMemberIds, lockOwner, isLockedByOther, acquireLock, releaseLock };
}
