import { ApprovalList } from '@/components/MutualApprovalModal';

export default function AprovacoesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Aprovações</h1>
      <ApprovalList showHistory />
    </div>
  );
}
