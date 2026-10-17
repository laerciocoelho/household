import {
  Coffee, Cat, Sparkles, Heart, Star, Moon, Sun, Flower2, Leaf, Flame, Rocket, Smile,
  type LucideIcon,
} from 'lucide-react';
import type { PeriodShift, RecurrenceRule, TaskPriority } from '@/types/database';

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
