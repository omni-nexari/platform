import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ImageOff, Loader2 } from 'lucide-react';
import { api, buildApiUrl } from '../../lib/api.js';
import { createImageElement } from '../../lib/canvasTypes.js';
import type { ImageElement } from '../../lib/canvasTypes.js';
import AuthImg from '../AuthImg.js';

interface ContentItem {
  id: string;
  name: string;
  type: string;
  mimeType?: string | null;
}

interface ContentListResponse {
  items: ContentItem[];
  total: number;
  page: number;
  limit: number;
}

interface Props {
  workspaceId: string;
  /** Called when the user clicks an image to add it to the canvas. */
  onSelect: (element: ImageElement) => void;
}

export default function MediaLibraryPanel({ workspaceId, onSelect }: Props) {
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery<ContentItem[]>({
    queryKey: ['canvas-media', workspaceId],
    queryFn: async () => {
      const res = await api.get<ContentListResponse | ContentItem[]>(
        `/content?workspaceId=${workspaceId}&type=image&limit=200`,
      );
      // API returns paginated { items, total, ... }; handle both shapes defensively
      if (res && !Array.isArray(res) && Array.isArray((res as ContentListResponse).items)) {
        return (res as ContentListResponse).items;
      }
      return Array.isArray(res) ? res : [];
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((item) => item.name.toLowerCase().includes(q));
  }, [data, search]);

  function handleSelect(item: ContentItem) {
    const src = buildApiUrl(`/content/${item.id}/thumbnail`);
    onSelect(
      createImageElement({
        contentItemId: item.id,
        src,
        name: item.name,
      }),
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search */}
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search images…"
          className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]"
        />
      </div>

      {/* Grid */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400 text-center py-4">
          Could not load media library
        </p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--text-muted)]">
          <ImageOff size={24} />
          <p className="text-xs">
            {search ? 'No results' : 'No images in this workspace'}
          </p>
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-2 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item)}
              title={item.name}
              className="group relative aspect-video rounded-lg overflow-hidden border border-[var(--border)] hover:border-[var(--blue)] bg-[var(--surface)] transition-colors"
            >
              <AuthImg
                itemId={item.id}
                alt={item.name}
                className="absolute inset-0 w-full h-full object-cover"
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <ImageOff size={16} className="text-[var(--text-muted)]" />
                  </div>
                }
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[9px] text-white truncate leading-tight">{item.name}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
