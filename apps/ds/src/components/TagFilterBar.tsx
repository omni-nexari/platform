/**
 * TagFilterBar – workspace tag filter row for list pages.
 *
 * Loads workspace tag categories and renders clickable tag pills.
 * Supports multi-select; selected tag IDs are passed back via `onTagIdsChange`.
 * Renders nothing when the workspace has no tag categories.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface WorkspaceTag {
  id: string;
  name: string;
  color: string | null;
}

interface TagCategory {
  id: string;
  name: string;
  color: string;
  tags: WorkspaceTag[];
}

interface Props {
  workspaceId: string;
  selectedTagIds: string[];
  onTagIdsChange: (ids: string[]) => void;
}

export default function TagFilterBar({ workspaceId, selectedTagIds, onTagIdsChange }: Props) {
  const { data: categories = [] } = useQuery<TagCategory[]>({
    queryKey: ['workspace-tags', workspaceId],
    queryFn: () => api.get(`/tags?workspaceId=${workspaceId}`),
    staleTime: 60_000,
  });

  const allTags = categories.flatMap((c) =>
    c.tags.map((t) => ({ ...t, categoryColor: t.color ?? c.color })),
  );

  if (allTags.length === 0) return null;

  function toggle(id: string) {
    onTagIdsChange(
      selectedTagIds.includes(id)
        ? selectedTagIds.filter((x) => x !== id)
        : [...selectedTagIds, id],
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTagIds.length > 0 && (
        <button
          onClick={() => onTagIdsChange([])}
          className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-2 py-1 rounded-full border border-[var(--border)] hover:border-[var(--accent)]"
        >
          Clear
        </button>
      )}
      {categories.map((cat) =>
        cat.tags.map((tag) => {
          const active = selectedTagIds.includes(tag.id);
          const color = tag.color ?? cat.color;
          return (
            <button
              key={tag.id}
              onClick={() => toggle(tag.id)}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all border"
              style={
                active
                  ? { background: color, color: '#fff', borderColor: color }
                  : { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border)' }
              }
            >
              {cat.name} / {tag.name}
            </button>
          );
        }),
      )}
    </div>
  );
}
