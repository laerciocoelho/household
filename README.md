# Household App (Casal)

Gestão colaborativa de tarefas domésticas para casais. Next.js (App Router) + TypeScript + Tailwind + Supabase.

## Estrutura de diretórios

```
household-app/
├── README.md
├── package.json
├── .env.local.example
├── supabase/
│   └── migrations/
│       └── 0001_init.sql            # tabelas, RLS, funções RPC, triggers, realtime
├── types/
│   └── database.ts                  # tipos TypeScript do banco
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # client de browser
│   │   └── server.ts                # client de servidor (SSR)
│   ├── constants.ts                 # turnos, ícones, cores
│   └── utils.ts                     # cn(), helpers de data
├── hooks/
│   ├── useHousehold.tsx             # contexto: lar, membros, membro atual
│   ├── usePresenceLock.ts           # presença + soft lock (heartbeat 45s)
│   ├── useRealtimeTasks.ts          # CRUD + realtime + versão otimista
│   └── useRealtimeFeeds.ts          # aprovações + feed de atividades (realtime)
├── components/
│   ├── Providers.tsx                # React Query
│   ├── Modal.tsx
│   ├── RedirectTo.tsx
│   ├── TaskActionsProvider.tsx      # diálogo, toasts, toggle/excluir/mover
│   ├── AppShell.tsx                 # sidebar (desktop) + bottom nav (mobile)
│   ├── MemberAvatar.tsx
│   ├── TaskCard.tsx
│   ├── TaskFormDialog.tsx           # criar/editar (com lock)
│   ├── DailyView.tsx
│   ├── WeeklyView.tsx               # 7 colunas + drag-and-drop
│   ├── MonthlyView.tsx              # calendário mensal
│   ├── MutualApprovalModal.tsx
│   └── ActivityFeed.tsx
├── middleware.ts                    # proteção de rotas por sessão
└── app/
    ├── layout.tsx
    ├── globals.css
    ├── manifest.ts                  # PWA
    ├── page.tsx                     # redireciona para /hoje
    ├── login/page.tsx
    ├── onboarding/page.tsx
    └── (app)/
        ├── layout.tsx
        ├── hoje/page.tsx
        ├── planejador/page.tsx
        ├── aprovacoes/page.tsx
        └── atividades/page.tsx
```

## Como rodar

```bash
# o projeto já traz package.json, tailwind, tsconfig e next.config
cd household-app
npm install
npm i @supabase/supabase-js @supabase/ssr @tanstack/react-query date-fns lucide-react clsx tailwind-merge
```

1. Crie um projeto no Supabase e execute `supabase/migrations/0001_init.sql` no SQL Editor.
2. Copie `.env.local.example` para `.env.local` e preencha.
3. `npm run dev`.

## Decisões de arquitetura

- **Mutações sensíveis via RPC (`SECURITY DEFINER`)**: criar/entrar no lar, solicitar/decidir exclusão e atualizar tarefa com checagem de `version`. Assim o limite de 2 membros, a aprovação mútua e o log de auditoria não dependem do cliente.
- **Aprovação mútua**: quem solicita não pode aprovar; a decisão vem sempre do parceiro (validado no banco).
- **Presence Lock**: canal Realtime `household:{id}` com Presence (online/edição) + Broadcast (`TASK_LOCK`/`TASK_UNLOCK`/heartbeat). Lock expira em 45 s sem heartbeat.
- **Concorrência otimista**: `update_task` só grava se `version` bater; caso contrário retorna conflito e a UI recarrega.
- **Exclusão aprovada**: a tarefa é removida fisicamente e o log mantém o resumo (título gravado no `summary`).

- **UI sem dependências extras**: modal e formulários em Tailwind puro (sem shadcn), mantendo a base enxuta; Radix/shadcn pode substituir `Modal.tsx` depois.
- **Auditoria imutável**: `activity_logs` só recebe INSERT via RPCs/triggers; `tasks` só é alterada via RPC (versão) ou INSERT direto.
- **Ícones PWA**: adicione `public/icons/icon-192.png` e `icon-512.png`.
