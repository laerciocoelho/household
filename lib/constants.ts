import {
  Coffee, Cat, Sparkles, Heart, Star, Moon, Sun, Flower2, Leaf, Flame, Rocket, Smile,
  type LucideIcon,
} from 'lucide-react';
import type { PeriodShift, PreferredView, RecurrenceRule, TaskPriority } from '@/types/database';

export const MEMBER_ICONS: Record<string, LucideIcon> = {
  coffee: Coffee, cat: Cat, sparkles: Sparkles, heart: Heart, star: Star, moon: Moon,
  sun: Sun, flower: Flower2, leaf: Leaf, flame: Flame, rocket: Rocket, smile: Smile,
};

export const MEMBER_COLORS = [
  '#3B82F6', '#EC4899', '#10B981', '#F59E0B', '#EF4444', '#14B8A6', '#6366F1', '#F97316',
];

export const BOTH_COLOR = '#8B5CF6'; // lilás/roxo para "Ambos"

export const SHIFTS: { key: PeriodShift; label: string }[] = [
  { key: 'morning', label: 'Manhã' },
  { key: 'afternoon', label: 'Tarde' },
  { key: 'night', label: 'Noite' },
  { key: 'anytime', label: 'A qualquer hora' },
];

export const SHIFT_LABEL: Record<PeriodShift, string> = {
  morning: 'Manhã', afternoon: 'Tarde', night: 'Noite', anytime: 'Qualquer hora',
};

export const RECURRENCE_LABEL: Record<RecurrenceRule, string> = {
  none: 'Não repete', daily: 'Diária', weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Baixa', normal: 'Normal', high: 'Alta',
};

export const LOCK_TIMEOUT_MS = 45_000;
export const HEARTBEAT_MS = 15_000;

export const VIEW_LABEL: Record<PreferredView, string> = {
  today: 'Hoje', week: 'Semanal', month: 'Mensal',
};

/** Intervalo de horários (passo de 5 min) permitido em cada turno */
export const SHIFT_TIME_RANGE: Record<PeriodShift, { min: string; max: string }> = {
  morning: { min: '00:00', max: '11:55' },
  afternoon: { min: '12:00', max: '17:55' },
  night: { min: '18:00', max: '23:55' },
  anytime: { min: '00:00', max: '23:55' },
};

/** Turno correspondente a um horário 'HH:mm' ('' => anytime) */
export function shiftForTime(time: string): PeriodShift {
  if (!time) return 'anytime';
  if (time < '12:00') return 'morning';
  if (time < '18:00') return 'afternoon';
  return 'night';
}

/** Horários 'HH:mm' (de 5 em 5 min) dentro do turno */
export function timesForShift(shift: PeriodShift): string[] {
  const { min, max } = SHIFT_TIME_RANGE[shift];
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let m = toMin(min); m <= toMin(max); m += 5) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** Horário compatível com o turno? ('anytime' exige horário vazio) */
export function timeMatchesShift(shift: PeriodShift, time: string): boolean {
  if (shift === 'anytime') return !time;
  if (!time) return true;
  const { min, max } = SHIFT_TIME_RANGE[shift];
  return time >= min && time <= max;
}
