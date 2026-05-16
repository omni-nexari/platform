import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, ImageOff, Loader2, Image as ImageIcon,
  Video, FileText, Code2, Globe,
} from 'lucide-react';
import { api, buildApiUrl } from '../../lib/api.js';
import { createImageElement } from '../../lib/canvasTypes.js';
import type { ImageElement } from '../../lib/canvasTypes.js';
import AuthImg from '../AuthImg.js';

interface ContentItem {
  id: string;
  name: string;
  type: string;
  mimeType?: string | null;
  webUrl?: string | null;
}

interface ContentListResponse {
  items: ContentItem[];
  total: number;
  page: number;
  limit: number;
}

interface Props {
  workspaceId: string;
  /** Called when the user clicks a media item to add it to the canvas. */
  onSelect: (element: ImageElement) => void;
}

type MediaTab = 'all' | 'image' | 'video' | 'pdf' | 'html5' | 'web_url';

const MEDIA_TABS: { id: MediaTab; label: string; icon: React.ReactNode }[] = [
  { id: 'all',     label: 'All',   icon: null },
  { id: 'image',   label: 'Image', icon: <ImageIcon size={10} /> },
  { id: 'video',   label: 'Video', icon: <Video size={10} /> },
  { id: 'pdf',     label: 'PDF',   icon: <FileText size={10} /> },
  { id: 'html5',   label: 'HTML5', icon: <Code2 size={10} /> },
  { id: 'web_url', label: 'Web',   icon: <Globe size={10} /> },
];

const SUPPORTED_TYPES = 'image,video,pdf,html5,web_url';

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'video':   return <Video size={14} className="text-violet-400" />;
    case 'pdf':     return <FileText size={14} className="text-red-400" />;
    case 'html5':   return <Code2 size={14} className="text-amber-400" />;
    case 'web_url': return <Globe size={14} className="text-emerald-400" />;
    default:        return <ImageIcon size={14} className="text-sky-400" />;
  }
}

export default function MediaLibraryPanel({ workspaceId, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<MediaTab>('all');

  const { data, isLoading, isError } = useQuery<ContentItem[]>({
    queryKey: ['canvas-media', workspaceId],
    queryFn: async () => {
      const res = await api.get<ContentListResponse | ContentItem[]>(
        `/content?workspaceId=${workspaceId}&type=${SUPPORTED_TYPES}&limit=500`,
      );
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
    let result = data;
    if (activeTab !== 'all') result = result.filter((item) => item.type === activeTab);
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((item) => item.name.toLowerCase().includes(q));
    return result;
  }, [data, activeTab, search]);

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
    <div className="flex flex-col h-full gap-2">
      {/* Type filter tabs */}
      <div className="flex gap-0.5 overflow-x-auto scrollbar-none -mx-1 px-1">
        {MEDIA_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--blue)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search media…"
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
            {search ? 'No results' : `No ${activeTab === 'all' ? 'media' : activeTab} in this workspace`}
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
              {item.type === 'web_url' ? (
                /* Web URLs have no thumbnail — show a placeholder */
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[var(--text-muted)]">
                  <Globe size={20} />
                  <span className="text-[9px] px-1 truncate w-full text-center">{item.webUrl ?? item.name}</span>
                </div>
              ) : (
                <AuthImg
                  itemId={item.id}
                  alt={item.name}
                  className="absolute inset-0 w-full h-full object-cover"
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center">
                      <TypeIcon type={item.type} />
                    </div>
                  }
                />
              )}

              {/* Type badge */}
              <div className="absolute top-1 right-1 z-10">
                <TypeIcon type={item.type} />
              </div>

              {/* Name tooltip on hover */}
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
