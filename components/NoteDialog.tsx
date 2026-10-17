'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';

export interface NoteDialogConfig {
  title: string;
  description?: string;
  label: string;
  confirmLabel: string;
  onConfirm: (note?: string) => void;
}

/** Pergunta um texto opcional (descritivo/justificativa) antes de confirmar. */
export function NoteDialog({ config, onClose }: { config: NoteDialogConfig | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  useEffect(() => { setNote(''); }, [config]);

  return (
    <Modal open={!!config} onClose={onClose} title={config?.title ?? ''}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          config?.onConfirm(note.trim() || undefined);
          onClose();
        }}
      >
        {config?.description && <p className="text-sm text-slate-600">{config.description}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">{config?.label}</label>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            rows={3}
            maxLength={500}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm hover:bg-slate-100">
            Voltar
          </button>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {config?.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
