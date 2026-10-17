'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { MEMBER_COLORS, MEMBER_ICONS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Household } from '@/types/database';

type Mode = 'create' | 'join';

function OnboardingForm() {
  const router = useRouter();
  const params = useSearchParams();
  const codeFromLink = params.get('code') ?? '';

  const [mode, setMode] = useState<Mode>(codeFromLink ? 'join' : 'create');
  const [houseName, setHouseName] = useState('');
  const [code, setCode] = useState(codeFromLink);
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState(MEMBER_COLORS[0]);
  const [icon, setIcon] = useState('heart');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Household | null>(null);
  const [copied, setCopied] = useState(false);

  // Se já tem lar, vai direto para /hoje
  useEffect(() => {
    getSupabase().from('household_members').select('id').maybeSingle().then(({ data }) => {
      if (data && !created) router.replace('/hoje');
    });
  }, [created, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) return setError('Informe seu nome de exibição.');
    setLoading(true);
    const supabase = getSupabase();
    if (mode === 'create') {
      if (!houseName.trim()) { setLoading(false); return setError('Dê um nome ao lar.'); }
      const { data, error } = await supabase.rpc('create_household', {
        p_name: houseName.trim(), p_display_name: displayName.trim(), p_color: color, p_icon: icon,
      });
      if (error) setError(error.message);
      else setCreated(data as Household);
    } else {
      const { error } = await supabase.rpc('join_household', {
        p_code: code, p_display_name: displayName.trim(), p_color: color, p_icon: icon,
      });
      if (error) setError(error.message);
      else { router.replace('/hoje'); router.refresh(); }
    }
    setLoading(false);
  }

  const inviteLink = created && typeof window !== 'undefined'
    ? `${window.location.origin}/onboarding?code=${created.invite_code}` : '';

  async function copy() {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';

  if (created) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">Lar criado! 🎉</h1>
        <p className="text-sm text-slate-600">Compartilhe o código com seu parceiro(a):</p>
        <p className="rounded-xl bg-slate-100 py-4 text-3xl font-bold tracking-widest">{created.invite_code}</p>
        <div className="flex items-center gap-2 rounded-lg border p-2 text-left text-xs">
          <span className="min-w-0 flex-1 truncate">{inviteLink}</span>
          <button onClick={copy} className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-white">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <button onClick={() => { router.replace('/hoje'); router.refresh(); }}
                className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white">
          Continuar
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-xl font-semibold">Bem-vindo(a)!</h1>

      <div className="grid grid-cols-2 gap-1 rounded-lg border bg-slate-50 p-1 text-sm">
        {(['create', 'join'] as Mode[]).map((m) => (
          <button type="button" key={m} onClick={() => setMode(m)}
                  className={cn('rounded-md py-1.5', mode === m ? 'bg-white font-medium shadow' : 'text-slate-600')}>
            {m === 'create' ? 'Criar um lar' : 'Entrar com código'}
          </button>
        ))}
      </div>

      {mode === 'create' ? (
        <input className={input} placeholder="Nome do lar (ex.: Nosso Cantinho)" value={houseName}
               maxLength={100} onChange={(e) => setHouseName(e.target.value)} />
      ) : (
        <input className={cn(input, 'uppercase tracking-widest')} placeholder="Código de convite" value={code}
               maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-600">Seu perfil</h2>
        <input className={input} placeholder="Nome de exibição" value={displayName}
               maxLength={50} onChange={(e) => setDisplayName(e.target.value)} />
        <div>
          <p className="mb-1 text-xs text-slate-500">Cor de destaque</p>
          <div className="flex flex-wrap gap-2">
            {MEMBER_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Cor ${c}`}
                      className={cn('h-8 w-8 rounded-full border-2', color === c ? 'border-slate-900' : 'border-transparent')}
                      style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-slate-500">Ícone</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(MEMBER_ICONS).map(([name, Icon]) => (
              <button type="button" key={name} onClick={() => setIcon(name)} aria-label={name}
                      className={cn('flex h-10 w-10 items-center justify-center rounded-full border-2 text-white',
                        icon === name ? 'border-slate-900' : 'border-transparent')}
                      style={{ backgroundColor: color }}>
                <Icon className="h-5 w-5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={loading} className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
        {loading ? 'Aguarde…' : mode === 'create' ? 'Criar lar' : 'Entrar no lar'}
      </button>
    </form>
  );
}

export default function OnboardingPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow">
        <Suspense fallback={null}><OnboardingForm /></Suspense>
      </div>
    </main>
  );
}
