import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.js';

export type SmartViewEntityType = 'content' | 'playlist' | 'schedule' | 'device';

export interface SmartViewRecord {
  id: string;
  workspaceId: string;
  entityType: SmartViewEntityType;
  name: string;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  workspaceId: string;
  entityType: SmartViewEntityType;
  currentFilters: Record<string, unknown>;
  onApplyFilters: (filters: Record<string, unknown>) => void;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export default function SmartViewsBar({ workspaceId, entityType, currentFilters, onApplyFilters }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState('');

  const { data: smartViews = [] } = useQuery<SmartViewRecord[]>({
    queryKey: ['smart-views', workspaceId, entityType],
    queryFn: () => api.get(`/smart-views?workspaceId=${workspaceId}&entityType=${entityType}`),
    enabled: !!workspaceId,
  });

  const saveMut = useMutation({
    mutationFn: (name: string) => api.post('/smart-views', {
      workspaceId,
      entityType,
      name,
      filters: currentFilters,
    }),
    onSuccess: () => {
      toast.success('Smart view saved');
      setCreateOpen(false);
      setDraftName('');
      void queryClient.invalidateQueries({ queryKey: ['smart-views', workspaceId, entityType] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to save smart view'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/smart-views/${id}`),
    onSuccess: () => {
      toast.success('Smart view removed');
      void queryClient.invalidateQueries({ queryKey: ['smart-views', workspaceId, entityType] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete smart view'),
  });

  const activeKey = stableStringify(currentFilters);
  const hasViews = smartViews.length > 0;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[var(--text)]">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <p className="text-sm font-semibold">Smart Views</p>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Save the current filters for this page and reapply them in one click.</p>
        </div>

        {!createOpen ? (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <BookmarkPlus size={14} />
            Save Current View
          </button>
        ) : (
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <input
              autoFocus
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCreateOpen(false);
                  setDraftName('');
                }
                if (e.key === 'Enter' && draftName.trim()) {
                  saveMut.mutate(draftName.trim());
                }
              }}
              placeholder="e.g. Approved video tags"
              className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] lg:w-64"
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveMut.mutate(draftName.trim())}
                disabled={!draftName.trim() || saveMut.isPending}
                className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
              >
                {saveMut.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setCreateOpen(false);
                  setDraftName('');
                }}
                className="inline-flex items-center justify-center rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasViews ? smartViews.map((view) => {
          const isActive = stableStringify(view.filters) === activeKey;
          return (
            <div key={view.id} className="inline-flex items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)]">
              <button
                onClick={() => onApplyFilters(view.filters)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${isActive ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
              >
                {view.name}
              </button>
              <button
                onClick={() => deleteMut.mutate(view.id)}
                disabled={deleteMut.isPending}
                className={`border-l border-[var(--border)] px-2 py-1.5 transition-colors ${isActive ? 'bg-[var(--accent)] text-white/80 hover:text-white' : 'text-[var(--text-muted)] hover:text-red-400'}`}
                aria-label={`Delete ${view.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        }) : (
          <span className="text-xs text-[var(--text-muted)]">No saved views yet.</span>
        )}

        {hasViews ? (
          <button
            onClick={() => onApplyFilters({})}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <X size={12} />
            Clear View
          </button>
        ) : null}
      </div>
    </div>
  );
}
