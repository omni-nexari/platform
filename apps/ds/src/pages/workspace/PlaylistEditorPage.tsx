import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  ArrowLeft, Plus, Save, Trash2, RefreshCw,
  ChevronUp, ChevronDown, X, Layers, Clock,
  Play, AlertTriangle, Settings2, Monitor, GripVertical,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AuthImg from '../../components/AuthImg.js';
import ContentPickerModal, { type PickedItem } from '../../components/ContentPickerModal.js';
import DevicePickerModal from '../../components/DevicePickerModal.js';
import PlaylistPreviewModal from '../../components/PlaylistPreviewModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import WorkspaceTagPicker from '../../components/WorkspaceTagPicker.js';
import { Skeleton, StatChip, ToggleSwitch } from '../../components/UiPrimitives.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ContentItem {
  id: string;
  name: string;
  type: string;
  duration: number | null;
  thumbnailPath: string | null;
  orientation: string; // 'landscape' | 'portrait' | 'any'
}

interface Playlist {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  loop: boolean;
  totalDuration: number;
  itemCount: number;
  thumbnailContentId: string | null;
}

interface PlaylistItemRow {
  id: string;
  position: number;
  contentId: string | null;
  nestedPlaylistId: string | null;
  duration: number | null;
  transitionEffect: string;
  conditions: string | null;
  content: ContentItem | null;
  nestedPlaylist: { id: string; name: string; totalDuration: number; thumbnailContentId: string | null } | null;
}

interface PlaylistDetail extends Playlist {
  items: PlaylistItemRow[];
}

// Local editor item
interface EditorItem {
  /** Stable react key (local UUID). */
  localId: string;
  contentId: string | null;
  nestedPlaylistId: string | null;
  name: string;
  duration: number;
  transitionEffect: string;
  thumbnailContentId: string | null;
  orientation: string; // 'landscape' | 'portrait' | 'any'
  /** JSON-serialised conditions: { timeStart?: string; timeEnd?: string; daysOfWeek?: number[] } */
  conditions: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec === 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

const TRANSITIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide_left', label: 'Slide Left' },
  { value: 'slide_right', label: 'Slide Right' },
  { value: 'zoom', label: 'Zoom' },
];

const TYPE_COLORS: Record<string, string> = {
  image: 'bg-blue-500',
  video: 'bg-purple-500',
  html5: 'bg-orange-500',
  pdf: 'bg-red-500',
  presentation: 'bg-green-500',
  web_url: 'bg-teal-500',
  playlist: 'bg-yellow-500',
};

// ── Conditions popover ────────────────────────────────────────────────────

interface ItemConditions {
  timeStart?: string | undefined;   // HH:MM
  timeEnd?: string | undefined;     // HH:MM
  daysOfWeek?: number[] | undefined; // 0=Sun … 6=Sat
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ConditionsPopover({
  conditions, onChange, onClose,
}: {
  conditions: ItemConditions;
  onChange: (c: ItemConditions) => void;
  onClose: () => void;
}) {
  const days = conditions.daysOfWeek ?? [];
  function toggleDay(d: number) {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b);
    onChange({ ...conditions, daysOfWeek: next.length ? next : undefined });
  }
  return (
    <div
      className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl shadow-2xl border p-4 space-y-3"
      style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[var(--text)]">Playback Conditions</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={12} /></button>
      </div>

      {/* Time window */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-[var(--text-muted)]">Active time</label>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={conditions.timeStart ?? ''}
            onChange={e => onChange({ ...conditions, timeStart: e.target.value || undefined })}
            className="flex-1 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <span className="text-[10px] text-[var(--text-muted)]">to</span>
          <input
            type="time"
            value={conditions.timeEnd ?? ''}
            onChange={e => onChange({ ...conditions, timeEnd: e.target.value || undefined })}
            className="flex-1 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      {/* Day of week */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-[var(--text-muted)]">Days of week <span className="font-normal">(empty = every day)</span></label>
        <div className="flex gap-1 flex-wrap">
          {DAY_LABELS.map((label, d) => (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={`text-[10px] px-2 py-1 rounded-full border font-semibold transition-colors ${
                days.includes(d)
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onChange({})}
        className="w-full text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors text-center"
      >
        Clear conditions
      </button>
    </div>
  );
}

// ── Item row component ────────────────────────────────────────────────────

function ItemRow({
  item, index, total, orientationMismatch,
  onMoveUp, onMoveDown, onRemove,
  onChangeDuration, onChangeTransition, onChangeConditions,
}: {
  item: EditorItem;
  index: number;
  total: number;
  orientationMismatch: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onChangeDuration: (d: number) => void;
  onChangeTransition: (t: string) => void;
  onChangeConditions: (c: string) => void;
}) {
  const [condOpen, setCondOpen] = useState(false);
  const isPlaylist = !!item.nestedPlaylistId;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.localId });

  const parsedConditions: ItemConditions = (() => {
    try { return JSON.parse(item.conditions) as ItemConditions; } catch { return {}; }
  })();
  const hasConditions = !!(parsedConditions.timeStart || parsedConditions.timeEnd || parsedConditions.daysOfWeek?.length);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-3 p-3 rounded-xl border border-[var(--card-border)] bg-[var(--card)] group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 w-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing transition-colors touch-none"
        title="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      {/* Index */}
      <div className="shrink-0 w-5 text-center text-xs font-semibold text-[var(--text-muted)]">
        {index + 1}
      </div>

      {/* Thumbnail */}
      <div
        className="shrink-0 relative rounded-lg overflow-hidden bg-[var(--surface-raised)]"
        style={{ width: item.orientation === 'portrait' ? 26 : 64, height: 40 }}
      >
        {item.thumbnailContentId ? (
          <AuthImg
            itemId={item.thumbnailContentId}
            className={`w-full h-full ${item.orientation === 'portrait' ? 'object-contain' : 'object-cover'}`}
            fallback={<div className="w-full h-full flex items-center justify-center"><Layers size={14} className="text-[var(--text-muted)]" /></div>}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers size={14} className="text-[var(--text-muted)]" />
          </div>
        )}
        {/* Orientation mismatch badge */}
        {orientationMismatch && (
          <div className="absolute top-0 right-0 bg-amber-500 rounded-bl-md px-1" title="Orientation mismatch">
            <AlertTriangle size={9} className="text-white" />
          </div>
        )}
      </div>

      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate leading-tight">{item.name}</p>
        <span className={`text-[9px] font-bold uppercase text-white px-1.5 py-0.5 rounded ${isPlaylist ? 'bg-yellow-500' : 'bg-[var(--accent)]/60'}`}>
          {isPlaylist ? 'Playlist' : 'Content'}
        </span>
      </div>

      {/* Duration input */}
      <div className="shrink-0 flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={3600}
          value={item.duration}
          onChange={e => onChangeDuration(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-14 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] text-center outline-none focus:border-[var(--accent)]"
          title="Duration (seconds)"
        />
        <span className="text-[10px] text-[var(--text-muted)]">s</span>
      </div>

      {/* Transition select */}
      <select
        value={item.transitionEffect}
        onChange={e => onChangeTransition(e.target.value)}
        className="shrink-0 w-24 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] cursor-pointer"
        title="Transition"
      >
        {TRANSITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      {/* Conditions button + Move + Remove */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity relative">
        {/* Conditions */}
        <button
          onClick={() => setCondOpen(v => !v)}
          title="Playback conditions"
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            hasConditions
              ? 'text-[var(--accent)] bg-[var(--accent)]/10 opacity-100 !important'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]'
          }`}
          style={hasConditions ? { opacity: 1 } : {}}
        >
          <Settings2 size={12} />
        </button>
        {condOpen && (
          <ConditionsPopover
            conditions={parsedConditions}
            onChange={c => onChangeConditions(JSON.stringify(c))}
            onClose={() => setCondOpen(false)}
          />
        )}
        <button onClick={onMoveUp} disabled={index === 0} title="Move up"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-raised)] disabled:opacity-30 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
          <ChevronUp size={12} />
        </button>
        <button onClick={onMoveDown} disabled={index === total - 1} title="Move down"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-raised)] disabled:opacity-30 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
          <ChevronDown size={12} />
        </button>
        <button onClick={onRemove} title="Remove"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────

export default function PlaylistEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === 'new';

  // Properties state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLoop, setEditLoop] = useState(true);

  // Items state
  const [items, setItems] = useState<EditorItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  // ── Unsaved changes guard ──
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Load existing playlist
  const { data: playlist, isLoading } = useQuery<PlaylistDetail>({
    queryKey: ['playlist', id],
    queryFn: () => api.get(`/playlists/${id!}`),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (playlist) {
      setEditName(playlist.name);
      setEditDescription(playlist.description ?? '');
      setEditLoop(playlist.loop);
      setItems(
        playlist.items.map(item => ({
          localId: item.id,
          contentId: item.contentId ?? null,
          nestedPlaylistId: item.nestedPlaylistId ?? null,
          name: item.content?.name ?? item.nestedPlaylist?.name ?? 'Unknown',
          duration: item.duration ?? item.content?.duration ?? item.nestedPlaylist?.totalDuration ?? 10,
          transitionEffect: item.transitionEffect,
          thumbnailContentId: (item.content?.thumbnailPath ? item.contentId : null) ?? item.nestedPlaylist?.thumbnailContentId ?? null,
          orientation: item.content?.orientation ?? 'any',
          conditions: item.conditions ?? '{}',
        })),
      );
    } else if (isNew) {
      setEditName('');
      setEditDescription('');
      setEditLoop(true);
      setItems([]);
    }
  }, [playlist, isNew]);

  function markDirty() { setIsDirty(true); }

  // ── Save ──
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editName.trim()) throw new Error('Name is required');

      let playlistId = id!;

      if (isNew) {
        const created = await api.post<Playlist>('/playlists', {
          workspaceId: wsId,
          name: editName.trim(),
          description: editDescription || null,
          loop: editLoop,
        });
        playlistId = created.id;
      } else {
        await api.patch(`/playlists/${playlistId}`, {
          name: editName.trim(),
          description: editDescription || null,
          loop: editLoop,
        });
      }

      await api.put(`/playlists/${playlistId}/items`, items.map(item => ({
        contentId: item.contentId ?? undefined,
        nestedPlaylistId: item.nestedPlaylistId ?? undefined,
        duration: item.duration,
        transitionEffect: item.transitionEffect,
        conditions: item.conditions,
      })));

      return playlistId;
    },
    onSuccess: (playlistId) => {
      toast.success('Playlist saved');
      setIsDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      if (isNew) navigate(`/workspaces/${wsId!}/playlist/${playlistId}`, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/playlists/${id!}`),
    onSuccess: () => {
      toast.success('Playlist deleted');
      setDeleteConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
      navigate(`/workspaces/${wsId!}/playlist`);
    },
    onError: () => toast.error('Failed to delete'),
  });

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!id) throw new Error('Save the playlist before publishing');
      return api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds,
        resourceType: 'playlist',
        resourceId: id,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setPublishConfirmOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish playlist'),
  });

  // ── Item helpers ──
  function addPickedItems(picked: PickedItem[]) {
    const newItems: EditorItem[] = picked.map(p => ({
      localId: crypto.randomUUID(),
      contentId: p.type === 'content' ? p.id : null,
      nestedPlaylistId: p.type === 'playlist' ? p.id : null,
      name: p.name,
      duration: p.duration ?? 10,
      transitionEffect: 'none',
      thumbnailContentId: p.thumbnailContentId ?? null,
      orientation: p.orientation ?? 'any',
      conditions: '{}',
    }));
    setItems(prev => [...prev, ...newItems]);
    markDirty();
  }

  function moveItem(from: number, to: number) {
    setItems(prev => arrayMove(prev, from, to));
    markDirty();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems(prev => {
        const oldIdx = prev.findIndex(i => i.localId === active.id);
        const newIdx = prev.findIndex(i => i.localId === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
      markDirty();
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
    markDirty();
  }

  function updateDuration(idx: number, d: number) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, duration: d } : it));
    markDirty();
  }

  function updateTransition(idx: number, t: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, transitionEffect: t } : it));
    markDirty();
  }

  function updateConditions(idx: number, c: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, conditions: c } : it));
    markDirty();
  }

  const totalDuration = items.reduce((sum, item) => sum + item.duration, 0);

  // Orientation mismatch: any content-only item that isn't 'any' while the set is mixed
  const contentOrientations = items
    .filter(i => !!i.contentId)
    .map(i => i.orientation)
    .filter(o => o !== 'any');
  const uniqueOrientations = new Set(contentOrientations);
  const hasMixedOrientations = uniqueOrientations.size > 1;

  function isOrientationMismatch(item: EditorItem) {
    return hasMixedOrientations && !!item.contentId && item.orientation !== 'any';
  }

  if (!isNew && isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-[var(--surface)] p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3 border-b border-[var(--border)] pb-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 flex-1 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="min-h-[18rem] rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
        <button
          onClick={() => {
            if (isDirty) {
              setLeaveConfirmOpen(true);
              return;
            }
            navigate(`/workspaces/${wsId!}/playlist`);
          }}
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
          title="Back to playlists"
        >
          <ArrowLeft size={20} />
          <span>Playlists</span>
        </button>

        <h1 className="text-base font-bold text-[var(--text)] truncate flex-1">
          {isNew ? 'New Playlist' : (editName || 'Untitled')}
        </h1>

        {/* Loop toggle */}
        <ToggleSwitch label="Loop" checked={editLoop} onChange={() => { setEditLoop(v => !v); markDirty(); }} />

        {/* Stats chip */}
        <div className="flex items-center gap-2">
          <StatChip><Layers size={10} />{items.length}</StatChip>
          <StatChip><Clock size={10} />{formatDuration(totalDuration)}</StatChip>
        </div>

        {/* Preview */}
        <button
          onClick={() => setPreviewOpen(true)}
          disabled={items.length === 0}
          title="Preview playlist"
          className="editor-toolbar-btn"
        >
          <Play size={12} />
          Preview
        </button>

        {/* Delete (existing only) */}
        {!isNew && (
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteMut.isPending}
            className="editor-toolbar-btn-danger"
          >
            <Trash2 size={13} />
          </button>
        )}

        {/* Publish */}
        <button
          onClick={() => setPublishConfirmOpen(true)}
          disabled={items.length === 0 || !id}
          className="editor-toolbar-btn"
        >
          <Monitor size={13} />
          Publish
        </button>

        {/* Save */}
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || (!isNew && !isDirty)}
          className="editor-toolbar-btn-primary"
        >
          <Save size={13} />
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* ── Body (items + properties) ── */}
      <div className="flex flex-1 min-h-0">

        {/* Left: Items timeline */}
        <div className="flex flex-col flex-1 min-w-0 p-4 gap-3 overflow-y-auto">
          {/* Orientation warning banner */}
          {hasMixedOrientations && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-400 text-xs">
              <AlertTriangle size={13} className="shrink-0" />
              <span>Mixed orientations detected — some items are landscape, others portrait. This may look incorrect on screens.</span>
            </div>
          )}

          {/* Items list */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 rounded-xl border-2 border-dashed border-[var(--border)]">
              <Layers size={32} className="text-[var(--text-muted)]/40" />
              <p className="text-sm text-[var(--text-muted)]">No items — add content using the button below</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map(i => i.localId)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {items.map((item, idx) => (
                    <ItemRow
                      key={item.localId}
                      item={item}
                      index={idx}
                      total={items.length}
                      orientationMismatch={isOrientationMismatch(item)}
                      onMoveUp={() => moveItem(idx, idx - 1)}
                      onMoveDown={() => moveItem(idx, idx + 1)}
                      onRemove={() => removeItem(idx)}
                      onChangeDuration={d => updateDuration(idx, d)}
                      onChangeTransition={t => updateTransition(idx, t)}
                      onChangeConditions={c => updateConditions(idx, c)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Add content button */}
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-colors"
          >
            <Plus size={15} />
            Add Content / Playlist
          </button>
        </div>

        {/* Right: Properties panel */}
        <div className="w-72 shrink-0 border-l border-[var(--border)] bg-[var(--card)] flex flex-col overflow-y-auto p-4 gap-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Properties</h2>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">Name *</label>
            <input
              type="text"
              value={editName}
              onChange={e => { setEditName(e.target.value); markDirty(); }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              placeholder="Playlist name…"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">Description</label>
            <textarea
              value={editDescription}
              onChange={e => { setEditDescription(e.target.value); markDirty(); }}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] resize-none"
              placeholder="Optional description…"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">Tags</label>
            <WorkspaceTagPicker
              workspaceId={wsId!}
              entityId={isNew ? null : id ?? null}
              entityType="playlist"
            />
          </div>

          {/* Stats */}
          <div className="mt-auto pt-4 border-t border-[var(--border)] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Items</span>
              <span className="font-semibold text-[var(--text)]">{items.length}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Total duration</span>
              <span className="font-semibold text-[var(--text)]">{formatDuration(totalDuration)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Loop</span>
              <span className="font-semibold text-[var(--text)]">{editLoop ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content picker */}
      <ContentPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => { addPickedItems(picked); setPickerOpen(false); }}
        workspaceId={wsId!}
        {...(!isNew && id ? { currentPlaylistId: id } : {})}
        multi
        title="Add to Playlist"
      />

      {/* Preview */}
      <PlaylistPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        items={items}
        playlistName={editName}
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Discard Changes"
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        variant="warning"
        onConfirm={() => navigate(`/workspaces/${wsId!}/playlist`)}
        onClose={() => setLeaveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Playlist"
        message="Delete this playlist? This cannot be undone."
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => deleteMut.mutate()}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      <DevicePickerModal
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        onSelect={(devices) => publishMut.mutate(devices.map((device) => device.id))}
        workspaceId={wsId!}
        title={`Publish ${editName || 'Playlist'}`}
        confirmLabel={publishMut.isPending ? 'Publishing…' : 'Publish'}
      />
    </div>
  );
}
