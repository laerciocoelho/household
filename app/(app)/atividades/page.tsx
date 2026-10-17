import { ActivityFeed } from '@/components/ActivityFeed';

export default function AtividadesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pl-10">
      <h1 className="-ml-6 text-xl font-semibold">Atividades</h1>
      <ActivityFeed />
    </div>
  );
}
