import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  ArrowLeft, Plus, Save, Trash2, ChevronUp, ChevronDown, Clock, Layers2,
} from 'lucide-react';
import ContentPickerModal, { type PickedItem } from '../../components/ContentPickerModal.js';
import AuthImg from '../../components/AuthImg.js';
import { Skeleton } from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncContent {
  id: string;
  name: string;
  type: string;
  duration: number | null;
}

interface SyncItem {
  localId: string;
  contentId: string;
  name: string;
  type: string;
  durationSeconds: number;
}

interface SyncPlaylistDetail {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    contentId: string | null;
    durationSeconds: number | null;
    sortOrder: number;
    content: SyncContent | null;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec === 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const TYPE_COLORS: Record<string, string> = {
  image: 'bg-blue-500',
  video: 'bg-purple-500',
  html5: 'bg-orange-500',
  pdf: 'bg-red-500',
  web_url: 'bg-teal-500',
};

// ── Editor ────────────────────────────────────────────────────────────────────

export default function SyncPlaylistEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [items, setItems] = useState<SyncItem[]>([]);
  const [editName, setEditName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: playlist, isLoading } = useQuery<SyncPlaylistDetail>({
    queryKey: ['sync-playlist-detail', id],
    queryFn: () => api.get(`/sync-playlists/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (playlist && !dirty) {
      setEditName(playlist.name);
      setItems(playlist.items
        .filter(i => i.contentId && i.content)
        .map(i => ({
          localId: crypto.randomUUID(),
          contentId: i.contentId!,
          name: i.content!.name,
          type: i.content!.type,
          durationSeconds: i.durationSeconds ?? i.content!.duration ?? 10,
        })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/sync-playlists/${id}/items`, items.map((item, idx) => ({
        contentId: item.contentId,
        durationSeconds: item.durationSeconds,
        sortOrder: idx,
      }))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
      void qc.invalidateQueries({ queryKey: ['sync-playlist-detail', id] });
      setDirty(false);
      toast.success('Saved');
    },
    onError: () => toast.error('Failed to save'),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.patch(`/sync-playlists/${id}`, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
      toast.success('Renamed');
    },
    onError: () => toast.error('Failed to rename'),
  });

  const addPicked = useCallback((picked: PickedItem[]) => {
    const newItems: SyncItem[] = picked
      .filter(p => p.type === 'content')
      .map(p => ({
        localId: crypto.randomUUID(),
        contentId: p.id,
        name: p.name,
        type: '',
        durationSeconds: Math.max(1, Math.round(p.duration ?? 10)),
      }));
    setItems(prev => [...prev, ...newItems]);
    setDirty(true);
    setPickerOpen(false);
  }, []);

  const removeItem = (localId: string) => {
    setItems(prev => prev.filter(i => i.localId !== localId));
    setDirty(true);
  };

  const moveItem = (localId: string, dir: -1 | 1) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.localId === localId);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      const tmp = arr[idx]!;
      arr[idx] = arr[next]!;
      arr[next] = tmp;
      return arr;
    });
    setDirty(true);
  };

  const setDuration = (localId: string, val: number) => {
    setItems(prev => prev.map(i => i.localId === localId ? { ...i, durationSeconds: val } : i));
    setDirty(true);
  };

  const totalDuration = items.reduce((s, i) => s + i.durationSeconds, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)] shrink-0">
        <button
          onClick={() => navigate(`/workspaces/${wsId}/playlist`)}
          className="p-1.5 rounded hover:bg-[var(--bg)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <input
          className="flex-1 bg-transparent text-lg font-semibold outline-none border-b border-transparent focus:border-[var(--blue)] transition-colors px-1 py-0.5"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={() => {
            const trimmed = editName.trim();
            if (trimmed && trimmed !== editName) setEditName(trimmed);
            if (trimmed) renameMutation.mutate(trimmed);
          }}
        />
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Clock className="w-3.5 h-3.5" />
          {formatDuration(totalDuration)} · {items.length} item{items.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm hover:border-[var(--blue)] transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Content
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-24">
            <Layers2 className="w-12 h-12 text-[var(--text-faint)]" />
            <div>
              <p className="font-medium text-[var(--text)]">No content yet</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Add content items that will play in lockstep across all screens in the sync group.</p>
            </div>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" /> Add Content
            </button>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl">
            {items.map((item, idx) => {
              const color = TYPE_COLORS[item.type] ?? 'bg-gray-500';
              return (
                <div
                  key={item.localId}
                  className="flex items-center gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl"
                >
                  {/* Thumbnail */}
                  <div className="shrink-0 w-20 h-12 rounded-lg overflow-hidden bg-[var(--bg)]">
                    {(['image','video','pdf','presentation','html5'].includes(item.type)) ? (
                      <AuthImg
                        itemId={item.contentId}
                        className="w-full h-full object-cover"
                        fallback={
                          <div className={`w-full h-full flex items-center justify-center ${color}`}>
                            <span className="text-[9px] font-bold uppercase text-white px-1">{item.type || '…'}</span>
                          </div>
                        }
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${color}`}>
                        <span className="text-[9px] font-bold uppercase text-white px-1">{item.type || '…'}</span>
                      </div>
                    )}
                  </div>

                  {/* Index */}
                  <span className="shrink-0 w-5 text-center text-xs text-[var(--text-faint)] font-mono">
                    {idx + 1}
                  </span>

                  {/* Name */}
                  <p className="flex-1 text-sm truncate">{item.name}</p>

                  {/* Duration */}
                  <label className="shrink-0 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <Clock className="w-3 h-3" />
                    <input
                      type="number"
                      min={1}
                      max={3600}
                      value={item.durationSeconds}
                      onChange={e => setDuration(item.localId, Math.max(1, Number(e.target.value)))}
                      className="w-14 px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-right"
                    />
                    <span>s</span>
                  </label>

                  {/* Controls */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => moveItem(item.localId, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-[var(--bg)] disabled:opacity-30 transition-colors"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => moveItem(item.localId, 1)}
                      disabled={idx === items.length - 1}
                      className="p-1 rounded hover:bg-[var(--bg)] disabled:opacity-30 transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeItem(item.localId)}
                      className="p-1 rounded hover:bg-[var(--bg)] text-red-400 transition-colors ml-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ContentPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addPicked}
        workspaceId={wsId!}
        multi
        allowedTypes={['content']}
        title="Add to Sync Playlist"
      />
    </div>
  );
}
