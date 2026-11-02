'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase/client';
import { friendlyAuthError } from '@/lib/authErrors';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = getSupabase();
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(friendlyAuthError(error));
      else { router.replace('/hoje'); router.refresh(); }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(friendlyAuthError(error));
      else if (data.session) { router.replace('/onboarding'); router.refresh(); }
      else setInfo('Conta criada! Confirme o e-mail enviado e depois entre.');
    }
    setLoading(false);
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{mode === 'signin' ? 'Entrar' : 'Criar conta'}</h1>
        <input className={input} type="email" placeholder="E-mail" value={email}
               onChange={(e) => setEmail(e.target.value)} required />
        <input className={input} type="password" placeholder="Senha (mín. 6 caracteres)" value={password}
               onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
        </button>
        <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                className="w-full text-center text-sm text-slate-600 underline">
          {mode === 'signin' ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entrar'}
        </button>
      </form>
    </main>
  );
}
