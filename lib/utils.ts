import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Task, PeriodShift } from '@/types/database';

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

const SHIFT_WEIGHT: Record<PeriodShift, number> = {
  morning: 1,
  afternoon: 2,
  night: 3,
  anytime: 4,
};

/**
 * Ordena por:
 * 1. Data de vencimento
 * 2. Turno: Manhã -> Tarde -> Noite -> Qualquer hora
 * 3. Tarefas com horário vêm antes das sem horário (horário crescente; sem horário por último no turno)
 * 4. Data de criação
 */
export function sortTasks<T extends Pick<Task, 'due_date' | 'due_time' | 'created_at' | 'period_shift'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    // 1. Data
    const dateCmp = a.due_date.localeCompare(b.due_date);
    if (dateCmp !== 0) return dateCmp;

    // 2. Ordem dos Turnos: morning (1) < afternoon (2) < night (3) < anytime (4)
    const shiftA = SHIFT_WEIGHT[a.period_shift] ?? 99;
    const shiftB = SHIFT_WEIGHT[b.period_shift] ?? 99;
    if (shiftA !== shiftB) return shiftA - shiftB;

    // 3. Dentro do mesmo turno: com horário vem antes de sem horário ('99:99')
    const timeA = a.due_time ?? '99:99';
    const timeB = b.due_time ?? '99:99';
    const timeCmp = timeA.localeCompare(timeB);
    if (timeCmp !== 0) return timeCmp;

    // 4. Critério de desempate por criação
    return a.created_at.localeCompare(b.created_at);
  });
}

export function groupByDay(tasks: Task[]) {
  const map = new Map<string, Task[]>();
  tasks.forEach((t) => map.set(t.due_date, [...(map.get(t.due_date) ?? []), t]));
  return map;
}