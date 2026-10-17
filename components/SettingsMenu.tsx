'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Home, LogOut } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { MemberAvatar } from '@/components/MemberAvatar';
import { useHousehold } from '@/hooks/useHousehold';
import { getSupabase } from '@/lib/supabase/client';
import { MEMBER_COLORS, MEMBER_ICONS, VIEW_LABEL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { HouseholdMember, PreferredView } from '@/types/database';

/** Chip "Logado como" que abre o menu de configurações do usuário */
export function SettingsMenu() {
  const { me, partner, onlineMemberIds, editingMemberIds } = useHousehold();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.display_name);
  const [color, setColor] = useState(me.color_hex);
  const [icon, setIcon] = useState(me.icon_name);
  const [view, setView] = useState<PreferredView>(me.preferred_view ?? 'today');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  function openMenu() {
    setName(me.display_name); setColor(me.color_hex); setIcon(me.icon_name);
    setView(me.preferred_view ?? 'today');
    setError(null); setConfirmLeave(false);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Informe seu nome.');
    setSaving(true); setError(null);
    const { error: err } = await getSupabase().rpc('update_my_profile', {
      p_display_name: name.trim(), p_color: color, p_icon: icon, p_preferred_view: view,
    });
    setSaving(false);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ['household-context'] });
    setOpen(false);
  }

  async function logout() {
    await getSupabase().auth.signOut();
    qc.clear();
    window.location.assign('/login');
  }

  async function leave() {
    setSaving(true); setError(null);
    const { error: err } = await getSupabase().rpc('leave_household');
    if (err) { setSaving(false); return setError(err.message); }
    qc.clear();
    window.location.assign('/onboarding');
  }

  const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
  const preview: HouseholdMember = { ...me, display_name: name, color_hex: color, icon_name: icon };

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        className="flex items-center gap-2 rounded-full border bg-slate-50 py-1 pl-1 pr-2.5 hover:bg-slate-100"
        title={`Você está logado como ${me.display_name} — abrir configurações`}
        aria-label="Abrir configurações do usuário"
      >
        <MemberAvatar member={me} online={onlineMemberIds.has(me.id)} editing={editingMemberIds.has(me.id)} />
        <span className="text-left leading-tight">
          <span className="block text-[10px] text-slate-500">Logado como</span>
          <span className="block max-w-28 truncate text-xs font-semibold">{me.display_name}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Configurações">
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-3">
            <MemberAvatar member={preview} size="md" />
            <input className={field} value={name} maxLength={50} placeholder="Seu nome"
                   onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Cor de destaque</p>
            <div className="flex flex-wrap gap-2">
              {MEMBER_COLORS.map((c) => (
                <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Cor ${c}`}
                        className={cn('h-8 w-8 rounded-full border-2', color === c ? 'border-slate-900' : 'border-transparent')}
                        style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Ícone</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(MEMBER_ICONS).map(([key, Icon]) => (
                <button type="button" key={key} onClick={() => setIcon(key)} aria-label={key}
                        className={cn('flex h-10 w-10 items-center justify-center rounded-full border-2 text-white',
                          icon === key ? 'border-slate-900' : 'border-transparent')}
                        style={{ backgroundColor: color }}>
                  <Icon className="h-5 w-5" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Visão preferida em Planejamento</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg border bg-slate-50 p-1 text-sm">
              {(Object.keys(VIEW_LABEL) as PreferredView[]).map((v) => (
                <button type="button" key={v} onClick={() => setView(v)}
                        className={cn('rounded-md py-1.5', view === v ? 'bg-white font-medium shadow' : 'text-slate-600')}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button disabled={saving} className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>

          <div className="space-y-2 border-t pt-3">
            {confirmLeave ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p>
                  Você sairá deste lar e poderá criar outro ou entrar com um código. Suas tarefas pessoais serão
                  excluídas{partner ? '' : ' e, como você é o único membro, o lar e todo o histórico também'}.
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={saving} onClick={leave}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setConfirmLeave(false)} className="rounded-lg px-3 py-1.5 hover:bg-amber-100">
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmLeave(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm hover:bg-slate-50">
                <Home className="h-4 w-4" /> Alterar casa
              </button>
            )}
            <button type="button" onClick={logout}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2 text-sm text-red-700 hover:bg-red-50">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
