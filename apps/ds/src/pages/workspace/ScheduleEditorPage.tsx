import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  ArrowLeft, Plus, Save, ChevronLeft, ChevronRight,
  X, List, CalendarDays, CalendarRange,
  Trash2, Pencil, Monitor, ImageOff, Clock,
} from 'lucide-react';
import AuthImg from '../../components/AuthImg.js';
import ContentPickerModal, { type PickedItem } from '../../components/ContentPickerModal.js';
import DevicePickerModal from '../../components/DevicePickerModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import WorkspaceTagPicker from '../../components/WorkspaceTagPicker.js';
import { Skeleton, ToggleSwitch } from '../../components/UiPrimitives.js';

// -- Constants ----------------------------------------------------------------

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#f97316', '#a855f7', '#84cc16',
];

// -- Types --------------------------------------------------------------------

interface LocalSlot {
  localId: string;
  playlistId: string | null;
  contentId: string | null;
  label: string;
  thumbnailContentId: string | null;
  startTime: string;
  endTime: string;
  recurrenceType: 'once' | 'weekly';
  date: string;
  daysOfWeek: number[];
  color: string;
}

interface SlotDraft {
  playlistId: string | null;
  contentId: string | null;
  label: string;
  thumbnailContentId: string | null;
  startTime: string;
  endTime: string;
  recurrenceType: 'once' | 'weekly';
  date: string;
  daysOfWeek: number[];
  color: string;
}

interface DefaultContentState {
  playlistId: string | null;
  contentId: string | null;
  label: string;
  thumbnailContentId: string | null;
}

interface Schedule {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  type: string;
  isActive: boolean;
  defaultPlaylistId: string | null;
  defaultContentId: string | null;
  defaultPlaylist: { id: string; name: string; thumbnailContentId: string | null } | null;
  defaultContent: { id: string; name: string } | null;
}

interface SlotRow {
  id: string;
  scheduleId: string;
  playlistId: string | null;
  contentId: string | null;
  startTime: string;
  endTime: string;
  recurrenceType: string;
  date: string | null;
  daysOfWeek: number[] | null;
  label: string | null;
  color: string;
  priority: number;
  playlist: { id: string; name: string; thumbnailContentId: string | null } | null;
  content: { id: string; name: string; thumbnailPath: string | null } | null;
}

interface ScheduleDetail extends Schedule {
  slots: SlotRow[];
}

type ViewMode = 'week' | 'list';
type PickerTarget = 'slot' | 'default';

// -- Date helpers -------------------------------------------------------------

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function toYMD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatRecurrenceLabel(slot: LocalSlot): string {
  if (slot.recurrenceType === 'once') {
    if (!slot.date) return 'One-time';
    const d = new Date(slot.date + 'T00:00:00');
    return `Once — ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (slot.daysOfWeek.length === 0) return 'No days selected';
  if (slot.daysOfWeek.length === 7) return 'Every day';
  return `Every ${slot.daysOfWeek.map(d => DAY_LABELS[d]).join(', ')}`;
}

// -- Conflict detection -------------------------------------------------------

function slotsOverlap(
  a: { startTime: string; endTime: string; recurrenceType: 'once' | 'weekly'; date: string; daysOfWeek: number[] },
  b: LocalSlot,
): boolean {
  if (!a.startTime || !a.endTime || a.startTime >= a.endTime) return false;
  if (a.startTime >= b.endTime || b.startTime >= a.endTime) return false;
  if (a.recurrenceType === 'weekly' && b.recurrenceType === 'weekly') {
    return a.daysOfWeek.some(d => b.daysOfWeek.includes(d));
  }
  if (a.recurrenceType === 'once' && b.recurrenceType === 'once') {
    return !!a.date && a.date === b.date;
  }
  const onceDate = a.recurrenceType === 'once' ? a.date : b.date;
  const weeklyDays = a.recurrenceType === 'weekly' ? a.daysOfWeek : b.daysOfWeek;
  if (!onceDate || weeklyDays.length === 0) return false;
  const jsDay = new Date(onceDate + 'T00:00:00').getDay();
  const appDay = jsDay === 0 ? 6 : jsDay - 1;
  return weeklyDays.includes(appDay);
}

// -- SlotBlock ----------------------------------------------------------------

function SlotBlock({
  slot, onClick, onDelete,
}: {
  slot: LocalSlot; onClick: () => void; onDelete: (e: React.MouseEvent) => void;
}) {
  const startMin = timeToMinutes(slot.startTime);
  const endMin = timeToMinutes(slot.endTime);
  const durationMin = Math.max(endMin - startMin, 15);
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 20);

  return (
    <div
      style={{
        position: 'absolute',
        top: `${top}px`,
        height: `${height}px`,
        left: '2px',
        right: '2px',
        background: slot.color + '22',
        borderLeft: `3px solid ${slot.color}`,
        borderRadius: '4px',
        zIndex: 10,
      }}
      className="flex flex-col overflow-hidden px-1.5 py-0.5 cursor-pointer group/slot select-none"
      onClick={onClick}
    >
      <span style={{ color: slot.color }} className="text-[10px] font-semibold truncate leading-tight">
        {slot.label}
      </span>
      {height >= 26 && (
        <span className="text-[9px] text-gray-400 leading-tight">
          {slot.startTime}&#8211;{slot.endTime}
        </span>
      )}
      <button
        onClick={onDelete}
        style={{ color: slot.color }}
        className="absolute top-0.5 right-0.5 opacity-0 group-hover/slot:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded hover:bg-black/10"
        title="Remove slot"
      >
        <X size={9} />
      </button>
    </div>
  );
}

// -- Slot dialog --------------------------------------------------------------

function SlotDialog({
  draft, onDraftChange, editingId, onConfirm, onClose, onOpenPicker, existingSlots,
}: {
  draft: SlotDraft;
  onDraftChange: (d: SlotDraft) => void;
  editingId: string | null;
  onConfirm: () => void;
  onClose: () => void;
  onOpenPicker: () => void;
  existingSlots: LocalSlot[];
}) {
  function toggleDay(d: number) {
    const next = draft.daysOfWeek.includes(d)
      ? draft.daysOfWeek.filter(x => x !== d)
      : [...draft.daysOfWeek, d].sort((a, b) => a - b);
    onDraftChange({ ...draft, daysOfWeek: next });
  }

  const conflictingSlots = (draft.startTime && draft.endTime && draft.startTime < draft.endTime)
    ? existingSlots
        .filter(s => s.localId !== editingId)
        .filter(s => slotsOverlap(draft as { startTime: string; endTime: string; recurrenceType: 'once' | 'weekly'; date: string; daysOfWeek: number[] }, s))
    : [];

  const canConfirm = !!(
    draft.label &&
    draft.startTime &&
    draft.endTime &&
    draft.startTime < draft.endTime &&
    (draft.recurrenceType === 'weekly' ? draft.daysOfWeek.length > 0 : !!draft.date)
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-sm">
        <div className="modal-header">
          <h2 className="modal-title">{editingId ? 'Edit Slot' : 'Add Slot'}</h2>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <div className="modal-body space-y-4">

          {/* Content / Playlist picker */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Content or Playlist</label>
            {draft.label ? (
              <div className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                {draft.thumbnailContentId ? (
                  <AuthImg
                    itemId={draft.thumbnailContentId}
                    className="w-14 h-9 object-cover rounded shrink-0"
                    fallback={<div className="w-14 h-9 rounded bg-[var(--surface-raised)] shrink-0 flex items-center justify-center text-[var(--text-muted)]"><ImageOff size={14} /></div>}
                  />
                ) : (
                  <div className="w-14 h-9 rounded bg-[var(--surface-raised)] shrink-0 flex items-center justify-center text-[var(--text-muted)]">
                    <CalendarDays size={14} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] truncate">{draft.label}</p>
                </div>
                <button onClick={onOpenPicker} className="text-xs text-[var(--accent)] hover:underline shrink-0">
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenPicker}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--text)] transition-colors"
              >
                <Plus size={15} />
                Pick Content or Playlist
              </button>
            )}
          </div>

          {/* Playing Time */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
              Playing Time
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">Start</label>
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={e => onDraftChange({ ...draft, startTime: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">End</label>
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={e => onDraftChange({ ...draft, endTime: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
            {draft.startTime && draft.endTime && draft.startTime >= draft.endTime && (
              <p className="text-xs text-red-400 mt-1">End time must be after start time</p>
            )}
          </div>

          {conflictingSlots.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              <strong>Overlap with:</strong>{' '}
              {conflictingSlots.map(s => s.label).join(', ')}.
              {' '}Higher-priority slot will take precedence at playback.
            </div>
          )}

          {/* Repeat */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Repeat</label>
            <div className="flex gap-2">
              {(['weekly', 'once'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => onDraftChange({ ...draft, recurrenceType: r })}
                  className={`flex-1 ui-filter-chip ${draft.recurrenceType === r ? 'ui-filter-chip-active' : ''}`}
                >
                  {r === 'weekly' ? 'Weekly' : 'One-time'}
                </button>
              ))}
            </div>
          </div>

          {draft.recurrenceType === 'weekly' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Days of week</label>
              <div className="flex gap-1 flex-wrap">
                {DAY_LABELS.map((label, d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    className={`ui-filter-chip text-[11px] ${draft.daysOfWeek.includes(d) ? 'ui-filter-chip-active' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.recurrenceType === 'once' && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">Date</label>
              <input
                type="date"
                value={draft.date}
                onChange={e => onDraftChange({ ...draft, date: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          )}

        </div>

        <div className="modal-footer modal-footer-plain">
          <button onClick={onClose} className="modal-secondary-btn flex-1">Cancel</button>
          <button onClick={onConfirm} disabled={!canConfirm} className="modal-primary-btn flex-1">
            {editingId ? 'Update Slot' : 'Add Slot'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Helpers ------------------------------------------------------------------

function emptyDraft(hour?: number, dayDate?: Date): SlotDraft {
  const h = hour ?? 9;
  return {
    playlistId: null,
    contentId: null,
    label: '',
    thumbnailContentId: null,
    startTime: minutesToTime(h * 60),
    endTime: minutesToTime(h * 60 + 60),
    recurrenceType: 'weekly',
    date: dayDate ? toYMD(dayDate) : toYMD(new Date()),
    daysOfWeek: [],
    color: SLOT_PALETTE[0]!,
  };
}

// -- Main editor --------------------------------------------------------------

export default function ScheduleEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === 'new';

  const [editName, setEditName] = useState('');
  const [editType] = useState('general');
  const [editIsActive, setEditIsActive] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  const [defaultContent, setDefaultContent] = useState<DefaultContentState>({
    playlistId: null, contentId: null, label: '', thumbnailContentId: null,
  });

  const [slots, setSlots] = useState<LocalSlot[]>([]);
  const colorIndexRef = useRef(0);

  const [view, setView] = useState<ViewMode>('week');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [slotDraft, setSlotDraft] = useState<SlotDraft>(() => emptyDraft());

  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('slot');
  const [pickerOpen, setPickerOpen] = useState(false);

  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  // -- Load --
  const { data: schedule, isLoading } = useQuery<ScheduleDetail>({
    queryKey: ['schedule', id],
    queryFn: () => api.get(`/schedules/${id!}`),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (schedule) {
      setEditName(schedule.name);
      setEditIsActive(schedule.isActive);
      setDefaultContent({
        playlistId: schedule.defaultPlaylistId ?? null,
        contentId: schedule.defaultContentId ?? null,
        label: schedule.defaultPlaylist?.name ?? schedule.defaultContent?.name ?? '',
        thumbnailContentId: schedule.defaultPlaylist?.thumbnailContentId ?? schedule.defaultContentId ?? null,
      });
      setSlots(schedule.slots.map(s => ({
        localId: s.id,
        playlistId: s.playlistId,
        contentId: s.contentId,
        label: s.label ?? s.playlist?.name ?? s.content?.name ?? 'Unnamed',
        thumbnailContentId: s.playlist?.thumbnailContentId ?? s.contentId ?? null,
        startTime: s.startTime,
        endTime: s.endTime,
        recurrenceType: s.recurrenceType === 'once' ? 'once' : 'weekly',
        date: s.date ?? '',
        daysOfWeek: s.daysOfWeek ?? [],
        color: s.color,
      })));
    } else if (isNew) {
      setEditName('');
      setEditIsActive(true);
      setDefaultContent({ playlistId: null, contentId: null, label: '', thumbnailContentId: null });
      setSlots([]);
    }
  }, [schedule, isNew]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  function markDirty() { setIsDirty(true); }

  // -- Week navigation --
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(currentWeekStart);
      date.setDate(currentWeekStart.getDate() + i);
      const today = new Date();
      return { date, label: DAY_LABELS[i]!, dayNum: date.getDate(), isToday: toYMD(date) === toYMD(today) };
    });
  }, [currentWeekStart]);

  const monthLabel = useMemo(() =>
    currentWeekStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  [currentWeekStart]);

  const weekNum = useMemo(() => getISOWeekNumber(currentWeekStart), [currentWeekStart]);

  function prevWeek() { setCurrentWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; }); }
  function nextWeek() { setCurrentWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; }); }
  function goToday() { setCurrentWeekStart(getWeekStart(new Date())); }

  // -- Slots helpers --
  function slotsForDay(dayIndex: number, dayDate: Date): LocalSlot[] {
    const dateStr = toYMD(dayDate);
    return slots.filter(s =>
      s.recurrenceType === 'weekly' ? s.daysOfWeek.includes(dayIndex) : s.date === dateStr,
    );
  }

  function nextColor(): string {
    const c = SLOT_PALETTE[colorIndexRef.current % SLOT_PALETTE.length]!;
    colorIndexRef.current += 1;
    return c;
  }

  function openAddSlot(hour?: number, dayDate?: Date) {
    const draft = emptyDraft(hour, dayDate);
    draft.color = nextColor();
    setSlotDraft(draft);
    setEditingSlotId(null);
    setSlotDialogOpen(true);
  }

  function openEditSlot(slot: LocalSlot) {
    setSlotDraft({
      playlistId: slot.playlistId,
      contentId: slot.contentId,
      label: slot.label,
      thumbnailContentId: slot.thumbnailContentId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      recurrenceType: slot.recurrenceType,
      date: slot.date,
      daysOfWeek: [...slot.daysOfWeek],
      color: slot.color,
    });
    setEditingSlotId(slot.localId);
    setSlotDialogOpen(true);
  }

  function confirmSlot() {
    if (editingSlotId) {
      setSlots(prev => prev.map(s =>
        s.localId === editingSlotId ? { ...s, ...slotDraft, localId: s.localId } : s,
      ));
    } else {
      setSlots(prev => [...prev, { ...slotDraft, localId: crypto.randomUUID() }]);
    }
    setSlotDialogOpen(false);
    setEditingSlotId(null);
    markDirty();
  }

  function removeSlot(localId: string) {
    setSlots(prev => prev.filter(s => s.localId !== localId));
    markDirty();
  }

  // -- Picker handlers --
  function openPickerForSlot() {
    setPickerTarget('slot');
    setPickerOpen(true);
    setSlotDialogOpen(false);
  }

  function openPickerForDefault() {
    setPickerTarget('default');
    setPickerOpen(true);
  }

  function handlePickerSelect(picked: PickedItem[]) {
    const item = picked[0];
    if (!item) { setPickerOpen(false); return; }
    if (pickerTarget === 'default') {
      setDefaultContent({
        playlistId: item.type === 'playlist' ? item.id : null,
        contentId: item.type === 'content' ? item.id : null,
        label: item.name,
        thumbnailContentId: item.thumbnailContentId ?? null,
      });
      markDirty();
    } else {
      setSlotDraft(d => ({
        ...d,
        playlistId: item.type === 'playlist' ? item.id : null,
        contentId: item.type === 'content' ? item.id : null,
        label: item.name,
        thumbnailContentId: item.thumbnailContentId ?? null,
      }));
      setSlotDialogOpen(true);
    }
    setPickerOpen(false);
  }

  function handlePickerClose() {
    setPickerOpen(false);
    if (pickerTarget === 'slot') setSlotDialogOpen(true);
  }

  // -- Save --
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editName.trim()) throw new Error('Name is required');
      let scheduleId = id!;

      if (isNew) {
        const created = await api.post<Schedule>('/schedules', {
          workspaceId: wsId,
          name: editName.trim(),
          type: editType,
          isActive: editIsActive,
        });
        scheduleId = created.id;
      } else {
        await api.patch(`/schedules/${scheduleId}`, {
          name: editName.trim(),
          type: editType,
          isActive: editIsActive,
          defaultPlaylistId: defaultContent.playlistId ?? null,
          defaultContentId: defaultContent.contentId ?? null,
        });
      }

      await api.put(`/schedules/${scheduleId}/slots`, slots.map(s => ({
        playlistId: s.playlistId ?? undefined,
        contentId: s.contentId ?? undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        recurrenceType: s.recurrenceType,
        date: s.date || undefined,
        daysOfWeek: s.daysOfWeek.length ? s.daysOfWeek : undefined,
        label: s.label,
        color: s.color,
        priority: 0,
      })));

      if (isNew && (defaultContent.playlistId || defaultContent.contentId)) {
        await api.patch(`/schedules/${scheduleId}`, {
          defaultPlaylistId: defaultContent.playlistId ?? null,
          defaultContentId: defaultContent.contentId ?? null,
        });
      }

      return scheduleId;
    },
    onSuccess: (scheduleId) => {
      toast.success('Schedule saved');
      setIsDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['schedules', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['schedule', scheduleId] });
      if (isNew) navigate(`/workspaces/${wsId!}/schedule/${scheduleId}`, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to save'),
  });

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!id) throw new Error('Save the schedule before publishing');
      return api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds,
        resourceType: 'schedule',
        resourceId: id,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setPublishConfirmOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish schedule'),
  });

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col h-full bg-[var(--surface)] overflow-hidden">
        <div className="h-14 border-b border-[var(--border)] bg-[var(--card)] shrink-0 flex items-center gap-3 px-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-7 w-24 ml-auto" />
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] overflow-hidden">

      {/* -- Top toolbar -- */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
        <button
          onClick={() => { if (isDirty) { setLeaveConfirmOpen(true); return; } navigate(`/workspaces/${wsId!}/schedule`); }}
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors shrink-0"
          title="Back to schedules"
        >
          <ArrowLeft size={20} />
          <span>Schedules</span>
        </button>

        <input
          value={editName}
          onChange={e => { setEditName(e.target.value); markDirty(); }}
          placeholder="Schedule name..."
          className="flex-1 min-w-0 bg-transparent text-base font-bold text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] border-b border-transparent focus:border-[var(--accent)]"
        />

        <ToggleSwitch
          label="Active"
          checked={editIsActive}
          onChange={() => { setEditIsActive(v => !v); markDirty(); }}
          className="shrink-0"
        />

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => openAddSlot()} className="editor-toolbar-btn-primary">
            <Plus size={13} />
            Add Slot
          </button>
          <button onClick={() => setPublishConfirmOpen(true)} disabled={!id} className="editor-toolbar-btn">
            <Monitor size={13} />
            Publish
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || (!isNew && !isDirty)}
            className="editor-toolbar-btn-primary"
          >
            <Save size={13} />
            {saveMut.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* -- Settings bar: Default Content + Tags -- */}
      <div className="flex items-center gap-4 px-6 py-2.5 border-b border-[var(--border)] bg-[var(--card)] shrink-0 flex-wrap">

        {/* Default Content */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0 whitespace-nowrap">Default Content</span>
          {defaultContent.label ? (
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {defaultContent.thumbnailContentId ? (
                <AuthImg
                  itemId={defaultContent.thumbnailContentId}
                  className="w-9 h-6 object-cover rounded shrink-0"
                  fallback={<div className="w-9 h-6 rounded bg-[var(--surface-raised)] shrink-0" />}
                />
              ) : (
                <div className="w-9 h-6 rounded bg-[var(--surface-raised)] shrink-0 flex items-center justify-center">
                  <ImageOff size={11} className="text-[var(--text-muted)]" />
                </div>
              )}
              <span className="text-xs font-medium text-[var(--text)] truncate max-w-[120px]">
                {defaultContent.label}
              </span>
              <button
                onClick={openPickerForDefault}
                className="text-[10px] text-[var(--accent)] hover:underline shrink-0"
              >
                Change
              </button>
              <button
                onClick={() => { setDefaultContent({ playlistId: null, contentId: null, label: '', thumbnailContentId: null }); markDirty(); }}
                className="text-[var(--text-muted)] hover:text-red-400 transition-colors shrink-0"
                title="Remove default content"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={openPickerForDefault}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--text)] transition-colors"
            >
              <Plus size={12} />
              Set default
            </button>
          )}
          <span className="text-[10px] text-[var(--text-muted)] hidden lg:block whitespace-nowrap">
            Plays when no slot is scheduled
          </span>
        </div>

        <div className="h-4 w-px bg-[var(--border)] shrink-0 hidden sm:block" />

        {/* Tags */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-semibold text-[var(--text-muted)] shrink-0">Tags</span>
          <WorkspaceTagPicker
            workspaceId={wsId!}
            entityId={isNew ? null : id ?? null}
            entityType="schedule"
          />
        </div>
      </div>

      {/* -- Calendar wrapper -- */}
      <div className="flex-1 overflow-hidden p-4">
        <div
          className="h-full rounded-2xl flex flex-col overflow-hidden"
          style={{ background: 'var(--card)', border: '1px solid var(--card-border)', boxShadow: '0 1px 12px rgba(0,0,0,.06)' }}
        >
          {/* Calendar control bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => openAddSlot()}
              className="w-7 h-7 flex items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
              title="Add slot"
            >
              <Plus size={14} />
            </button>
            <button onClick={prevWeek} className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-[var(--text)] select-none">
              {monthLabel} &middot; Week {weekNum}
            </span>
            <button onClick={nextWeek} className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors">
              <ChevronRight size={16} />
            </button>
            <div className="flex-1" />
            <button onClick={goToday} className="editor-toolbar-btn-primary">Today</button>
            <div className="flex border border-[var(--border)] rounded-lg overflow-hidden">
              {([
                { mode: 'week' as ViewMode, icon: <CalendarRange size={14} /> },
                { mode: 'list' as ViewMode, icon: <List size={14} /> },
              ]).map(({ mode, icon }) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={`w-8 h-7 flex items-center justify-center transition-colors ${
                    view === mode
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]'
                  }`}
                  title={mode === 'week' ? 'Week view' : 'List view'}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* -- Week view -- */}
          {view === 'week' && (
            <>
              <div className="flex border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                <div className="w-14 shrink-0" />
                {weekDays.map((day, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center py-2 border-l" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{day.label}</span>
                    <span className={`text-lg font-bold leading-tight mt-0.5 w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                      day.isToday ? 'bg-[var(--accent)] text-white' : 'text-[var(--text)]'
                    }`}>
                      {day.dayNum}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="flex" style={{ minHeight: `${HOUR_HEIGHT * 24}px` }}>
                  <div className="w-14 shrink-0 select-none">
                    {HOURS.map(h => (
                      <div key={h} style={{ height: `${HOUR_HEIGHT}px` }} className="flex items-start justify-end pr-2 pt-1">
                        <span className="text-[10px] text-[var(--text-muted)]">{String(h).padStart(2, '0')}:00</span>
                      </div>
                    ))}
                  </div>
                  {weekDays.map((day, dayIdx) => (
                    <div
                      key={dayIdx}
                      className="flex-1 relative border-l"
                      style={{
                        borderColor: 'var(--border)',
                        background: day.isToday ? 'color-mix(in srgb, var(--accent) 3%, transparent)' : undefined,
                      }}
                    >
                      {HOURS.map(h => (
                        <div
                          key={h}
                          style={{ height: `${HOUR_HEIGHT}px`, borderColor: 'var(--border)' }}
                          className="border-b border-dashed cursor-pointer hover:bg-[var(--accent)]/5 transition-colors"
                          onClick={() => openAddSlot(h, day.date)}
                        />
                      ))}
                      {slotsForDay(dayIdx, day.date).map(slot => (
                        <SlotBlock
                          key={slot.localId + '-' + dayIdx}
                          slot={slot}
                          onClick={() => openEditSlot(slot)}
                          onDelete={(e) => { e.stopPropagation(); removeSlot(slot.localId); }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* -- List view -- */}
          {view === 'list' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {slots.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
                  <CalendarDays size={32} className="text-[var(--text-muted)]" />
                  <p className="text-sm text-[var(--text-muted)]">No slots yet. Click "Add Slot" to schedule content.</p>
                </div>
              ) : (
                [...slots]
                  .sort((a, b) => a.startTime.localeCompare(b.startTime))
                  .map(slot => (
                    <div
                      key={slot.localId}
                      className="flex items-center gap-3 p-3 rounded-xl border border-[var(--card-border)] bg-[var(--card)] group"
                    >
                      <div style={{ background: slot.color }} className="w-1.5 h-10 rounded-full shrink-0" />
                      {slot.thumbnailContentId ? (
                        <div className="shrink-0 w-16 h-10 rounded-lg overflow-hidden bg-[var(--surface-raised)]">
                          <AuthImg
                            itemId={slot.thumbnailContentId}
                            className="w-full h-full object-cover"
                            fallback={<div className="w-full h-full flex items-center justify-center"><ImageOff size={14} className="text-[var(--text-muted)]" /></div>}
                          />
                        </div>
                      ) : (
                        <div className="shrink-0 w-16 h-10 rounded-lg bg-[var(--surface-raised)] flex items-center justify-center">
                          <CalendarDays size={16} className="text-[var(--text-muted)]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text)] truncate">{slot.label}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {slot.startTime}&#8211;{slot.endTime} &middot; {formatRecurrenceLabel(slot)}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditSlot(slot)}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => removeSlot(slot.localId)}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                          title="Remove"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* -- Slot dialog -- */}
      {slotDialogOpen && !pickerOpen && (
        <SlotDialog
          draft={slotDraft}
          onDraftChange={setSlotDraft}
          editingId={editingSlotId}
          onConfirm={confirmSlot}
          onClose={() => setSlotDialogOpen(false)}
          onOpenPicker={openPickerForSlot}
          existingSlots={slots}
        />
      )}

      {/* -- Content picker (shared for slot + default content) -- */}
      <ContentPickerModal
        open={pickerOpen}
        onClose={handlePickerClose}
        onSelect={handlePickerSelect}
        workspaceId={wsId!}
        multi={false}
        allowedTypes={['content', 'playlist']}
        title={pickerTarget === 'default' ? 'Set Default Content' : 'Pick Content or Playlist'}
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Discard Changes"
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        variant="warning"
        onConfirm={() => navigate(`/workspaces/${wsId!}/schedule`)}
        onClose={() => setLeaveConfirmOpen(false)}
      />

      <DevicePickerModal
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        onSelect={(devices) => publishMut.mutate(devices.map((device) => device.id))}
        workspaceId={wsId!}
        title={`Publish ${editName || 'Schedule'}`}
        confirmLabel={publishMut.isPending ? 'Publishing...' : 'Publish'}
      />
    </div>
  );
}
