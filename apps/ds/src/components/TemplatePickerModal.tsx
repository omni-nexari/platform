import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, FileCode2 } from 'lucide-react';
import { api } from '../lib/api.js';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export default function TemplatePickerModal({ workspaceId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [tplId, setTplId] = useState<string | null>(null);

  const tplListQ = useQuery<{ templates: Array<{ id: string; name: string; description: string }> }>({
    queryKey: ['html5-templates'],
    queryFn: () => api.get('/content/html5/templates'),
    staleTime: 60_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/content/html5/create', { workspaceId, templateId: tplId, name: name.trim() }),
    onSuccess: () => {
      toast.success('HTML5 content created from template');
      void queryClient.invalidateQueries({ queryKey: ['content', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Create failed'),
  });

  const canSave = !!tplId && name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-md">

        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15">
              <FileCode2 size={18} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="modal-title">New from Template</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Pick a starter template for your HTML5 content</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-5">

          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Content Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My HTML5 Banner"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Choose a Template</span>
            <div className="mt-2 grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
              {tplListQ.isLoading && (
                <div className="text-xs text-[var(--text-muted)]">Loading templates…</div>
              )}
              {tplListQ.isError && (
                <div className="text-xs text-red-400">Failed to load templates</div>
              )}
              {tplListQ.data?.templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTplId(t.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    tplId === t.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'
                  }`}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{t.name}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-muted)]">
            The template ZIP is created in your library — open it from the Content list and click{' '}
            <strong>Edit</strong> to customise the HTML, CSS and JS.
          </p>

        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => createMut.mutate()}
            disabled={!canSave || createMut.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {createMut.isPending ? 'Creating…' : 'Create from Template'}
          </button>
        </div>

      </div>
    </div>
  );
}
