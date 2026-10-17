'use client';

import { Users } from 'lucide-react';
import { BOTH_COLOR, MEMBER_ICONS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { HouseholdMember } from '@/types/database';

interface Props {
  member?: HouseholdMember | null; // null/undefined = Ambos
  size?: 'xs' | 'sm' | 'md';
  online?: boolean;
  editing?: boolean; // anel pulsante
  className?: string;
}

const SIZES = { xs: 'h-5 w-5', sm: 'h-8 w-8', md: 'h-10 w-10' };
const ICON_SIZES = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5' };

export function MemberAvatar({ member, size = 'sm', online, editing, className }: Props) {
  const Icon = member ? MEMBER_ICONS[member.icon_name] ?? MEMBER_ICONS.smile : Users;
  const color = member?.color_hex ?? BOTH_COLOR;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} title={member?.display_name ?? 'Ambos'}>
      {editing && (
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />
      )}
      <span
        className={cn('relative inline-flex items-center justify-center rounded-full text-white', SIZES[size])}
        style={{ backgroundColor: color }}
      >
        <Icon className={ICON_SIZES[size]} />
      </span>
      {online !== undefined && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white',
            online ? 'bg-emerald-500' : 'bg-slate-300'
          )}
        />
      )}
    </span>
  );
}
