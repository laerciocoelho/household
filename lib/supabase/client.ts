import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

let channelSeq = 0;
/**
 * Nome único por subscrição. O Supabase reaproveita canais com o mesmo tópico;
 * como hooks como useRealtimeTasks rodam em vários componentes, cada efeito
 * precisa do seu próprio canal para poder registrar callbacks antes do subscribe().
 */
export const uniqueTopic = (base: string) => `${base}:${++channelSeq}`;
