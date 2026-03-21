import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Search, X, ChevronDown, Eye, EyeOff } from 'lucide-react';
import AssignedTagPills, { type AssignedTag } from './AssignedTagPills.js';
import AuthImg from './AuthImg.js';
import { ToggleSwitch } from './UiPrimitives.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface PickerContent {
  id: string;
  name: string;
  type: string;
  thumbnailPath: string | null;
  duration: number | null;
  fileSize: number | null;
  assignedTags?: AssignedTag[];
  status: string;
  approvalState: string;
  validFrom: string | null;
  validUntil: string | null;
  updatedAt: string;
  orientation: string;
  playlistCount?: number;
}

interface PickerPlaylist {
  id: string;
  name: string;
  thumbnailContentId: string | null;
  itemCount: number;
  totalDuration: number;
  assignedTags?: AssignedTag[];
  updatedAt: string;
  hasNestedPlaylist: boolean;
}

export interface PickedItem {
  id: string;
  type: 'content' | 'playlist';
  name: string;
  duration?: number | null;
  thumbnailContentId?: string | null; // content→its own id, playlist→thumbnailContentId
  orientation?: string; // 'landscape' | 'portrait' | 'any'
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatPickerDuration(sec: number | null | undefined): string {
  if (sec == null) return '';
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  image: { label: 'Image', color: 'bg-blue-500' },
  video: { label: 'Video', color: 'bg-purple-500' },
  html5: { label: 'HTML5', color: 'bg-orange-500' },
  pdf: { label: 'PDF', color: 'bg-red-500' },
  presentation: { label: 'PPT', color: 'bg-green-500' },
  web_url: { label: 'Web', color: 'bg-teal-500' },
  playlist: { label: 'Playlist', color: 'bg-yellow-500' },
};

function isUnavailable(item: PickerContent): boolean {
  if (item.status !== 'ready') return true;
  if (item.approvalState !== 'approved') return true;
  const now = Date.now();
  if (item.validFrom && new Date(item.validFrom).getTime() > now) return true;
  if (item.validUntil && new Date(item.validUntil).getTime() < now) return true;
  return false;
}

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';

function sortLabel(k: SortKey) {
  return { 'date-desc': 'Date ↓', 'date-asc': 'Date ↑', 'name-asc': 'Name A-Z', 'name-desc': 'Name Z-A' }[k];
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ContentCard({
  item, selected, onToggle
}: {
  item: PickerContent; selected: boolean; onToggle: () => void;
}) {
  const meta = TYPE_META[item.type] ?? { label: item.type, color: 'bg-gray-500' };
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]/8'
          : 'border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)]'
      }`}
    >
      {/* Radio / check circle */}
      <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)]'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>

      {/* Thumbnail */}
      <div className="relative shrink-0 w-[90px] h-[54px] rounded-lg overflow-hidden bg-[var(--surface-raised)]">
        {(item.type === 'image' || item.type === 'video') ? (
          <AuthImg
            itemId={item.id}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full flex items-center justify-center"><span className={`text-[9px] font-bold uppercase text-white px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span></div>}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className={`text-[9px] font-bold uppercase text-white px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
          </div>
        )}
        {item.duration != null && (
          <span className="absolute bottom-0 left-0 text-white text-[9px] font-mono bg-black/60 px-1 py-0.5 leading-none">
            {formatPickerDuration(item.duration)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text)] truncate leading-tight">{item.name}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className={`text-[9px] font-bold uppercase text-white px-1.5 py-0.5 rounded ${meta.color}`}>
            {meta.label}
          </span>
        </div>
        <div className="mt-1">
          <AssignedTagPills tags={item.assignedTags} />
        </div>
      </div>
    </div>
  );
}

function PlaylistCard({
  item, selected, onToggle, disabled, disabledReason,
}: {
  item: PickerPlaylist; selected: boolean; onToggle: () => void;
  disabled?: boolean | undefined; disabledReason?: string | undefined;
}) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      title={disabled ? disabledReason : undefined}
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors select-none ${
        disabled
          ? 'border-[var(--card-border)] bg-[var(--card)] opacity-40 cursor-not-allowed'
          : selected
          ? 'border-[var(--accent)] bg-[var(--accent)]/8 cursor-pointer'
          : 'border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)] cursor-pointer'
      }`}
    >
      {/* Radio */}
      <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)]'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>

      {/* Thumbnail */}
      <div className="relative shrink-0 w-[90px] h-[54px] rounded-lg overflow-hidden bg-[var(--surface-raised)]">
        {item.thumbnailContentId ? (
          <AuthImg
            itemId={item.thumbnailContentId}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">No preview</div>}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-xs">
            No preview
          </div>
        )}
        {item.totalDuration > 0 && (
          <span className="absolute bottom-0 left-0 text-white text-[9px] font-mono bg-black/60 px-1 py-0.5 leading-none">
            {formatPickerDuration(item.totalDuration)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--text)] truncate leading-tight">{item.name}</p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="text-[9px] font-bold uppercase text-white px-1.5 py-0.5 rounded bg-yellow-500">
            Playlist
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">{item.itemCount} items</span>
        </div>
        <div className="mt-1">
          <AssignedTagPills tags={item.assignedTags} />
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface ContentPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when user confirms selection. */
  onSelect: (items: PickedItem[]) => void;
  workspaceId: string;
  /** Allow multi-select (default true). */
  multi?: boolean;
  /** Which resource types to offer (default: both). */
  allowedTypes?: Array<'content' | 'playlist'>;
  /** If set, this playlist's own ID is excluded from the playlists tab
   *  and playlists that already contain nested playlists are disabled. */
  currentPlaylistId?: string | undefined;
  title?: string | undefined;
}

type Tab = 'recent' | 'content' | 'playlist';

export default function ContentPickerModal({
  open, onClose, onSelect, workspaceId,
  multi = true,
  allowedTypes = ['content', 'playlist'],
  currentPlaylistId,
  title = 'Select Content',
}: ContentPickerModalProps) {
  const [tab, setTab] = useState<Tab>('recent');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [hideUnavailable, setHideUnavailable] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: contentResponse, isLoading: contentLoading } = useQuery<{ items: PickerContent[]; total: number }>({
    queryKey: ['picker-content', workspaceId],
    queryFn: () => api.get(`/content?workspaceId=${workspaceId}&limit=500`),
    enabled: open && allowedTypes.includes('content'),
    staleTime: 60_000,
  });
  const contentItems = contentResponse?.items ?? [];

  const { data: playlistItems = [], isLoading: playlistLoading } = useQuery<PickerPlaylist[]>({
    queryKey: ['picker-playlists', workspaceId],
    queryFn: () => api.get(`/playlists?workspaceId=${workspaceId}`),
    enabled: open && allowedTypes.includes('playlist'),
    staleTime: 60_000,
  });

  const filteredContent = useMemo(() => {
    let list = contentItems;
    if (hideUnavailable) list = list.filter(i => !isUnavailable(i));
    if (search) list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [contentItems, hideUnavailable, search]);

  const filteredPlaylists = useMemo(() => {
    let list = playlistItems;
    // Exclude the current playlist (can't nest a playlist inside itself)
    if (currentPlaylistId) list = list.filter(i => i.id !== currentPlaylistId);
    if (search) list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [playlistItems, search, currentPlaylistId]);

  // For RECENT: merge + sort
  const recentItems = useMemo(() => {
    const mixed: Array<{ id: string; type: 'content' | 'playlist'; updatedAt: string; name: string }> = [
      ...filteredContent.map(i => ({ id: i.id, type: 'content' as const, updatedAt: i.updatedAt, name: i.name })),
      ...filteredPlaylists.map(i => ({ id: i.id, type: 'playlist' as const, updatedAt: i.updatedAt, name: i.name })),
    ];
    return mixed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 30);
  }, [filteredContent, filteredPlaylists]);

  const sortItems = <T extends { updatedAt: string; name: string }>(arr: T[]): T[] => {
    return [...arr].sort((a, b) => {
      if (sort === 'date-desc') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sort === 'date-asc') return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      if (sort === 'name-asc') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });
  };

  const sortedContent = useMemo(() => sortItems(filteredContent), [filteredContent, sort]);
  const sortedPlaylists = useMemo(() => sortItems(filteredPlaylists), [filteredPlaylists, sort]);

  const contentMap = useMemo(
    () => Object.fromEntries(contentItems.map(c => [c.id, c])),
    [contentItems],
  );
  const playlistMap = useMemo(
    () => Object.fromEntries(playlistItems.map(p => [p.id, p])),
    [playlistItems],
  );

  const totalCount = tab === 'recent' ? recentItems.length
    : tab === 'content' ? sortedContent.length
    : sortedPlaylists.length;

  const isLoading = (tab === 'content' || tab === 'recent') ? contentLoading
    : playlistLoading;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (!multi) next.clear();
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const picked: PickedItem[] = [...selected].map(id => {
      const c = contentMap[id];
      if (c) return {
        id, type: 'content', name: c.name, duration: c.duration,
        thumbnailContentId: c.id,
        orientation: c.orientation,
      };
      const p = playlistMap[id];
      if (p) return {
        id, type: 'playlist', name: p.name, duration: p.totalDuration,
        thumbnailContentId: p.thumbnailContentId,
      };
      return { id, type: 'content', name: id };
    });
    onSelect(picked);
    setSelected(new Set());
  }

  function handleClose() {
    setSelected(new Set());
    setSearch('');
    onClose();
  }

  if (!open) return null;

  const showContent = allowedTypes.includes('content');
  const showPlaylist = allowedTypes.includes('playlist');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="modal-backdrop" onClick={handleClose} />

      {/* Modal */}
      <div className="modal-shell modal-shell-lg" style={{ minHeight: '520px', maxHeight: '90vh' }}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button onClick={handleClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {(['recent', ...(showContent ? ['content'] : []), ...(showPlaylist ? ['playlist'] : [])] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`modal-tab ${tab === t ? 'modal-tab-active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          {/* Search + Sort */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <Search size={14} className="text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={`Search ${tab}`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
              >
                {sortLabel(sort)}
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {sortOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 rounded-xl shadow-lg border py-1 min-w-[130px]"
                  style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
                >
                  {(['date-desc', 'date-asc', 'name-asc', 'name-desc'] as SortKey[]).map(k => (
                    <button key={k} onClick={() => { setSort(k); setSortOpen(false); }}
                      className={`w-full text-left px-4 py-1.5 text-xs ${sort === k ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                      {sortLabel(k)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Count + Hide unavailable */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">
              {isLoading ? 'Loading…' : <><span className="font-semibold text-[var(--accent)]">{totalCount}</span> items</>}
            </p>
            {tab !== 'playlist' && (
              <ToggleSwitch label="Hide unavailable" checked={hideUnavailable} onChange={() => setHideUnavailable(v => !v)} />
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">Loading…</div>
          ) : totalCount === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">No items found</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {tab === 'recent' && recentItems.map(item => {
                if (item.type === 'content') {
                  const c = contentMap[item.id];
                  if (!c) return null;
                  return <ContentCard key={item.id} item={c} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />;
                }
                const p = playlistMap[item.id];
                if (!p) return null;
                return <PlaylistCard key={item.id} item={p} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />;
              })}

              {tab === 'content' && sortedContent.map(item => (
                <ContentCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />
              ))}

              {tab === 'playlist' && sortedPlaylists.map(item => {
                const isNested = item.hasNestedPlaylist;
                return (
                  <PlaylistCard
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    onToggle={() => toggle(item.id)}
                    disabled={isNested}
                    disabledReason={isNested ? 'Cannot nest: this playlist already contains nested playlists (max depth 1)' : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button onClick={handleClose}
            className="modal-secondary-btn">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className="modal-primary-btn"
          >
            {selected.size > 0 ? `Select ${multi && selected.size > 1 ? `(${selected.size})` : ''}` : 'Select'}
          </button>
        </div>
      </div>
    </div>
  );
}
