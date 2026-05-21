import { useState, useRef } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  UploadCloud, Search, Image, Film, Trash2, Copy, Check,
  MoreVertical, RefreshCw, ImageIcon,
} from 'lucide-react';
import { api } from '../../lib/api.js';


interface MediaItem {
  id: string;
  name: string;
  type: string;
  mimeType: string | null;
  fileSize: number | null;
  webUrl: string | null;
  filePath: string | null;
  createdAt: string;
}

interface MediaList {
  items: MediaItem[];
  total: number;
  page: number;
  limit: number;
}

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FilterTab = 'all' | 'image' | 'video';

export default function PosMediaPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const typeParam = tab === 'all' ? 'image,video' : tab;
  const searchParam = search ? `&q=${encodeURIComponent(search)}` : '';

  const { data, isLoading, refetch } = useQuery<MediaList>({
    queryKey: ['pos-media', wsId, tab, search],
    queryFn: () => api.get(`/content?workspaceId=${wsId}&type=${typeParam}${searchParam}&sort=created_at&limit=96`),
    enabled: !!wsId,
  });

  const items = data?.items ?? [];

  const uploadMut = useMutation({
    mutationFn: async (files: FileList) => {
      const results = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('name', file.name.replace(/\.[^.]+$/, ''));
        const result = await api.postForm(`/content/upload?workspaceId=${wsId}`, fd);
        results.push(result);
      }
      return results;
    },
    onSuccess: (results) => {
      toast.success(`${results.length} file${results.length > 1 ? 's' : ''} uploaded`);
      qc.invalidateQueries({ queryKey: ['pos-media', wsId] });
    },
    onError: () => toast.error('Upload failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/content/${id}`),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['pos-media', wsId] });
    },
    onError: () => toast.error('Delete failed'),
  });

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    uploadMut.mutate(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  async function copyUrl(item: MediaItem) {
    const url = item.webUrl ?? (item.filePath ? `/api/v1/content/${item.id}/file` : null);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(item.id);
    setTimeout(() => setCopied((p) => (p === item.id ? null : p)), 2000);
  }

  const TABS: { id: FilterTab; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Media', icon: <ImageIcon size={14} /> },
    { id: 'image', label: 'Images', icon: <Image size={14} /> },
    { id: 'video', label: 'Videos', icon: <Film size={14} /> },
  ];

  return (
    <div className="workspace-page-root flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="workspace-page-title">Media Library</h1>
          <p className="workspace-page-subtitle">Images and videos for menu boards and signage content</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="workspace-page-icon-btn"
            title="Refresh"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMut.isPending}
            className="workspace-page-action flex items-center gap-2"
          >
            <UploadCloud size={15} />
            {uploadMut.isPending ? 'Uploading…' : 'Upload'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-[var(--blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-40 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search media…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
          />
        </div>
        {data && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {data.total} file{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Drop zone / grid */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex-1 min-h-0"
      >
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-xl bg-[var(--surface)] animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-4 h-64 border-2 border-dashed border-[var(--border)] rounded-2xl cursor-pointer hover:border-[var(--blue)] hover:bg-[var(--surface)] transition-colors"
          >
            <UploadCloud size={32} className="text-[var(--text-muted)]" />
            <div className="text-center">
              <p className="font-medium text-[var(--text)]">
                {search || tab !== 'all' ? 'No media found' : 'No media yet'}
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {search || tab !== 'all' ? 'Try a different search or filter' : 'Click or drag images/videos here to upload'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                copied={copied === item.id}
                onCopy={() => copyUrl(item)}
                onDelete={() => deleteMut.mutate(item.id)}
                deleting={deleteMut.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaCard({
  item, copied, onCopy, onDelete, deleting,
}: {
  item: MediaItem;
  copied: boolean;
  onCopy: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isVideo = item.type === 'video';
  const thumbUrl = item.webUrl ? item.webUrl + '?w=320' : `/api/v1/content/${item.id}/thumbnail`;

  return (
    <div className="group relative flex flex-col rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--blue)] transition-colors">
      {/* Thumbnail */}
      <div className="aspect-video bg-[var(--surface-hover)] relative overflow-hidden">
        {isVideo ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
            <Film size={28} />
          </div>
        ) : (
          <img
            src={thumbUrl}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Type badge */}
        <span className={`absolute top-1.5 left-1.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
          isVideo ? 'bg-purple-900/80 text-purple-200' : 'bg-blue-900/80 text-blue-200'
        }`}>
          {item.type}
        </span>
      </div>

      {/* Info */}
      <div className="p-2 flex flex-col gap-1 min-w-0">
        <p className="text-xs font-medium text-[var(--text)] truncate" title={item.name}>
          {item.name}
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">{formatSize(item.fileSize)}</p>
      </div>

      {/* Hover actions */}
      <div className="absolute inset-0 flex items-end justify-end p-2 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onCopy}
          className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-[var(--blue)] transition-colors"
          title="Copy URL"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
          >
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 bottom-full mb-1 z-20 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-32">
                <button
                  onClick={() => { setMenuOpen(false); onCopy(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-hover)]"
                >
                  <Copy size={13} /> Copy URL
                </button>
                <button
                  disabled={deleting}
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--surface-hover)]"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
