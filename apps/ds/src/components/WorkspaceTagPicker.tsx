import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Tag } from 'lucide-react';
import { api } from '../lib/api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkspaceTag {
  id: string;
  name: string;
  color: string | null;
}

interface TagCategory {
  id: string;
  name: string;
  color: string;
  availableFor: string[];
  tags: WorkspaceTag[];
}

export type EntityType = 'device' | 'content' | 'playlist' | 'schedule';

interface Props {
  workspaceId: string;
  entityId: string | null; // null when creating a new entity (pre-save)
  entityType: EntityType;
  /** Called after any assign / unassign so the parent can invalidate queries */
  onAssignmentChange?: () => void;
}

// ── WorkspaceTagPicker ────────────────────────────────────────────────────────

export default function WorkspaceTagPicker({
  workspaceId,
  entityId,
  entityType,
  onAssignmentChange,
}: Props) {
  const qc = useQueryClient();
  const [createCategoryId, setCreateCategoryId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  // ── Fetch workspace tag categories + their tags ───────────────────────────
  const { data: categories = [] } = useQuery<TagCategory[]>({
    queryKey: ['workspace-tags', workspaceId],
    queryFn: () => api.get(`/tags?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  // ── Fetch current tag assignments for this entity ─────────────────────────
  const { data: assignedIds = [] } = useQuery<string[]>({
    queryKey: ['tag-assignments', entityType, entityId],
    queryFn: () =>
      api.get(`/tags/assignments?workspaceId=${workspaceId}&entityId=${entityId}&entityType=${entityType}`),
    enabled: !!entityId,
  });

  // ── Assign ────────────────────────────────────────────────────────────────
  const assignMut = useMutation({
    mutationFn: (tagId: string) =>
      api.post(`/tags/${tagId}/assign`, { entityId, entityType }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tag-assignments', entityType, entityId] });
      onAssignmentChange?.();
    },
  });

  // ── Unassign ──────────────────────────────────────────────────────────────
  const unassignMut = useMutation({
    mutationFn: (tagId: string) =>
      api.delete(`/tags/${tagId}/assign/${entityId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tag-assignments', entityType, entityId] });
      onAssignmentChange?.();
    },
  });

  // ── Create a new tag in a category ───────────────────────────────────────
  const createTagMut = useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) =>
      api.post<WorkspaceTag>(`/tags/categories/${categoryId}/tags`, { name }),
    onSuccess: async (newTag) => {
      void qc.invalidateQueries({ queryKey: ['workspace-tags', workspaceId] });
      setCreateCategoryId(null);
      setNewTagName('');
      // Auto-assign the just-created tag if we have an entity
      if (entityId) {
        assignMut.mutate(newTag.id);
      }
    },
  });

  // ── Filter to categories relevant to this entityType ─────────────────────
  const visibleCategories = categories.filter(
    (c) => c.availableFor.length === 0 || c.availableFor.includes(entityType),
  );


  const pending = assignMut.isPending || unassignMut.isPending;

  return (
    <div className="space-y-4">
      {/* ── Workspace tags from tag system ── */}
      {visibleCategories.length > 0 && (
        <div className="space-y-3">
          {visibleCategories.map((cat) => (
            <div key={cat.id}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: cat.color }}
                  />
                  {cat.name}
                </p>
                {/* Quick-create tag in this category */}
                {createCategoryId === cat.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (newTagName.trim()) createTagMut.mutate({ categoryId: cat.id, name: newTagName.trim() });
                        }
                        if (e.key === 'Escape') { setCreateCategoryId(null); setNewTagName(''); }
                      }}
                      placeholder="Tag name…"
                      className="w-28 px-2 py-0.5 text-xs rounded border border-[var(--accent)] bg-[var(--surface)] text-[var(--text)] outline-none"
                    />
                    <button
                      onClick={() => { if (newTagName.trim()) createTagMut.mutate({ categoryId: cat.id, name: newTagName.trim() }); }}
                      disabled={!newTagName.trim() || createTagMut.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent)] text-white disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setCreateCategoryId(null); setNewTagName(''); }}
                      className="text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreateCategoryId(cat.id)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex items-center gap-0.5 transition-colors"
                    title="Create new tag"
                  >
                    <Plus size={11} />
                    New
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {cat.tags.length === 0 && createCategoryId !== cat.id && (
                  <span className="text-[11px] text-[var(--text-muted)] italic">No tags yet</span>
                )}
                {cat.tags.map((tag) => {
                  const isAssigned = assignedIds.includes(tag.id);
                  const tagColor = tag.color ?? cat.color;
                  return (
                    <button
                      key={tag.id}
                      disabled={pending || !entityId}
                      onClick={() => {
                        if (!entityId) return;
                        if (isAssigned) unassignMut.mutate(tag.id);
                        else assignMut.mutate(tag.id);
                      }}
                      title={entityId ? (isAssigned ? 'Remove tag' : 'Apply tag') : 'Save the item first to apply tags'}
                      className={[
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border',
                        isAssigned
                          ? 'text-white border-transparent'
                          : 'bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--text)]',
                        pending ? 'opacity-60 cursor-wait' : 'cursor-pointer',
                        !entityId ? 'opacity-40 cursor-not-allowed' : '',
                      ].join(' ')}
                      style={isAssigned ? { background: tagColor } : undefined}
                    >
                      {tag.name}
                      {isAssigned && <X size={10} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* ── No categories fallback ── */}
      {visibleCategories.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
          <Tag size={13} />
          <span>No tag categories configured for this workspace.</span>
        </div>
      )}
    </div>
  );
}
