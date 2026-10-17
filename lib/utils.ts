import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Task } from '@/types/database';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const toISODate = (d: Date) => format(d, 'yyyy-MM-dd');
export const fromISODate = (s: string) => parseISO(s);

export function isOverdue(dueDate: string, status: string) {
  return status === 'pending' && isBefore(parseISO(dueDate), startOfDay(new Date()));
}

export const formatLong = (d: Date) => format(d, "EEEE, d 'de' MMMM", { locale: ptBR });
export const formatDateTime = (iso: string) =>
  format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

/** 'HH:mm:ss' -> 'HH:mm' ('' quando não há horário) */
export const formatTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** Ordena por data, depois horário (sem horário por último) e criação. */
export function sortTasks<T extends Pick<Task, 'due_date' | 'due_time' | 'created_at'>>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      a.due_date.localeCompare(b.due_date) ||
      (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99') ||
      a.created_at.localeCompare(b.created_at)
  );
}

export function groupByDay(tasks: Task[]) {
  const map = new Map<string, Task[]>();
  tasks.forEach((t) => map.set(t.due_date, [...(map.get(t.due_date) ?? []), t]));
  return map;
}
