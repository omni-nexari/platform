import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import BulkTagModal from '../../components/BulkTagModal.js';
import DevicePickerModal from '../../components/DevicePickerModal.js';
import {
  Plus, CalendarDays, MoreVertical, Copy, Trash2,
  CheckCircle2, Clock, ChevronLeft, ChevronRight, Check, Monitor,
} from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import SmartViewsBar from '../../components/SmartViewsBar.js';
import TagFilterBar from '../../components/TagFilterBar.js';
import {
  Badge,
  FilterChip,
  Modal,
  EmptyState,
  ModalFooter,
  ModalHeader,
  ModalBody,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
  StatChip,
} from '../../components/UiPrimitives.js';

// ── Palette ──────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#f97316',
  '#a855f7', '#84cc16', '#14b8a6', '#f43f5e',
];

// ── Calendar helpers ─────────────────────────────────────────────────────────

function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

/** 0 = Mon … 6 = Sun */
function firstDowOfMonth(y: number, m: number): number {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function toYMD(d: Date) { return d.toISOString().slice(0, 10); }

// ── Mini calendar ────────────────────────────────────────────────────────────

function MiniCalendar({
  year, month, onPrev, onNext,
  selectedDay, onSelectDay,
  activeDots,
}: {
  year: number; month: number;
  onPrev: () => void; onNext: () => void;
  selectedDay: string | null;
  onSelectDay: (ymd: string | null) => void;
  activeDots: Map<string, string[]>;
}) {
  const todayYMD = toYMD(new Date());
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = firstDowOfMonth(year, month);
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4 px-1">
        <button onClick={onPrev} className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-bold text-[var(--text)]">{monthLabel}</span>
        <button onClick={onNext} className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors">
          <ChevronRight size={14} />
        </button>
      </div>

      {/* DOW headers */}
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d, i) => (
          <div key={i} className="flex items-center justify-center">
            <span className="text-[9px] font-bold uppercase text-[var(--text-muted)]">{d}</span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - firstDow + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} className="h-9" />;
          const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const isToday = ymd === todayYMD;
          const isSelected = ymd === selectedDay;
          const dots = activeDots.get(ymd) ?? [];
          return (
            <button
              key={i}
              onClick={() => onSelectDay(ymd === selectedDay ? null : ymd)}
              className="flex flex-col items-center py-0.5 rounded-lg hover:bg-[var(--surface)] transition-colors group"
            >
              <span className={`w-6 h-6 flex items-center justify-center text-[11px] rounded-full font-medium transition-colors ${
                isSelected
                  ? 'bg-[var(--accent)] text-white'
                  : isToday
                  ? 'bg-[var(--accent)]/20 text-[var(--accent)] font-bold'
                  : 'text-[var(--text)]'
              }`}>
                {dayNum}
              </span>
              <div className="flex justify-center gap-[2px] mt-0.5 h-[7px]">
                {dots.slice(0, 4).map((color, ci) => (
                  <div key={ci} style={{ background: color }} className="w-[5px] h-[5px] rounded-full" />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Schedule {
  id: string;
  name: string;
  description: string | null;
  type: string;
  assignedTags?: AssignedTag[];
  isActive: boolean;
  slotCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; tone: 'warning' | 'danger' }> = {
  general:  { label: 'General', tone: 'warning' },
  override: { label: 'Override', tone: 'danger' },
};

// ── Schedule row ─────────────────────────────────────────────────────────────

function ScheduleRow({
  sch, color, onEdit, onClone, onDelete, checked, onCheck,
}: {
  sch: Schedule;
  color: string;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  checked: boolean;
  onCheck: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = TYPE_META[sch.type] ?? TYPE_META['general']!;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={e => e.key === 'Enter' && onEdit()}
      onMouseLeave={() => setMenuOpen(false)}
      className="ui-row-card relative flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors group"
    >
      <button
        onClick={e => { e.stopPropagation(); onCheck(); }}
        className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'rgba(0,0,0,0.18)', border: '1px solid var(--border)' }}
      >
        {checked && <Check size={11} className="text-white" />}
      </button>

      {/* Color stripe */}
      <div style={{ background: color }} className="w-1 h-10 rounded-full shrink-0" />

      {/* Icon */}
      <div style={{ background: color + '22', color }} className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
        <CalendarDays size={16} />
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="ui-entity-card-title text-sm truncate leading-tight">{sch.name}</p>
        <div className="ui-entity-card-meta mt-0.5 flex-wrap">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Clock size={9} />
            {sch.slotCount} slot{sch.slotCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="mt-1.5">
          <AssignedTagPills tags={sch.assignedTags} />
        </div>
      </div>

      {/* Active badge */}
      {sch.isActive ? (
        <Badge tone="success" className="shrink-0">
          <CheckCircle2 size={10} /> Active
        </Badge>
      ) : (
        <span className="text-[10px] font-semibold px-2 py-1 rounded-full border text-[var(--text-muted)] shrink-0" style={{ borderColor: 'var(--border)' }}>
          Inactive
        </span>
      )}

      {/* Context menu */}
      <div className="relative shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-20 rounded-xl shadow-xl border py-1 w-36"
            style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => { setMenuOpen(false); onClone(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors">
              <Copy size={12} /> Clone
            </button>
            <button onClick={() => { setMenuOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:text-red-500 hover:bg-red-500/5 transition-colors">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Calendar state
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Schedule state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'general' | 'override'>('general');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [confirmCloneId, setConfirmCloneId] = useState<string | null>(null);
  const [confirmCloneName, setConfirmCloneName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);

  const currentFilters = { selectedTagIds };

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: scheduleList = [], isLoading } = useQuery<Schedule[]>({
    queryKey: ['schedules', wsId, selectedTagIds],
    queryFn: () => api.get(`/schedules?workspaceId=${wsId!}${tagIdsParam}`),
    enabled: !!wsId,
  });

  const createMut = useMutation({
    mutationFn: () => api.post<Schedule>('/schedules', {
      workspaceId: wsId,
      name: newName.trim(),
      type: newType,
    }),
    onSuccess: (schedule) => {
      toast.success('Schedule created');
      setCreateOpen(false);
      setNewName('');
      void queryClient.invalidateQueries({ queryKey: ['schedules', wsId] });
      navigate(`/workspaces/${wsId!}/schedule/${schedule.id}`);
    },
    onError: () => toast.error('Failed to create schedule'),
  });

  const cloneMut = useMutation({
    mutationFn: (id: string) => api.post(`/schedules/${id}/clone`),
    onSuccess: () => {
      toast.success('Schedule cloned');
      setConfirmCloneId(null);
      setConfirmCloneName('');
      void queryClient.invalidateQueries({ queryKey: ['schedules', wsId] });
    },
    onError: () => toast.error('Failed to clone'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`),
    onSuccess: () => {
      toast.success('Schedule deleted');
      setConfirmDeleteId(null);
      setConfirmDeleteName('');
      void queryClient.invalidateQueries({ queryKey: ['schedules', wsId] });
    },
    onError: () => toast.error('Failed to delete'),
  });

  const publishSelection = scheduleList.filter((item) => selectedItems.has(item.id));
  const publishCandidate = publishSelection.length === 1 ? publishSelection[0] : null;

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!publishCandidate) throw new Error('Select exactly one schedule to publish');
      return api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds,
        resourceType: 'schedule',
        resourceId: publishCandidate.id,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setPublishPickerOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish schedule'),
  });

  // Assign a stable color per schedule by list index
  const scheduleColors = useMemo(() => {
    const map = new Map<string, string>();
    scheduleList.forEach((s, i) => map.set(s.id, PALETTE[i % PALETTE.length]!));
    return map;
  }, [scheduleList]);

  // Build active-dots map: every day of visible month gets dots for active schedules
  const activeDots = useMemo(() => {
    const map = new Map<string, string[]>();
    const activeSchedules = scheduleList.filter(s => s.isActive);
    if (activeSchedules.length === 0) return map;
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map.set(ymd, activeSchedules.map(s => scheduleColors.get(s.id)!));
    }
    return map;
  }, [calYear, calMonth, scheduleList, scheduleColors]);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1);
    setSelectedDay(null);
  }

  const activeSchedules = scheduleList.filter(s => s.isActive);
  const filtered = scheduleList;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface)] lg:flex-row">

      {/* ── Left: mini calendar panel ── */}
      <div
        className="w-full shrink-0 border-b flex flex-col overflow-y-auto lg:w-64 lg:border-b-0 lg:border-r"
        style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
      >
        <div className="p-4 pb-2">
          <MiniCalendar
            year={calYear}
            month={calMonth}
            onPrev={prevMonth}
            onNext={nextMonth}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            activeDots={activeDots}
          />
        </div>

        {/* Legend */}
        {activeSchedules.length > 0 && (
          <div className="px-4 pt-3 pb-4 border-t mt-2 space-y-1.5" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Active Schedules</p>
            {activeSchedules.map(s => (
              <div key={s.id} className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(`/workspaces/${wsId!}/schedule/${s.id}`)}>
                <div style={{ background: scheduleColors.get(s.id) }} className="w-2 h-2 rounded-full shrink-0" />
                <span className="text-[11px] text-[var(--text)] truncate hover:text-[var(--accent)] transition-colors">{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: schedule list ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 pb-2 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
          <PageHeader
            title="Schedules"
            subtitle={`${scheduleList.length} schedule${scheduleList.length !== 1 ? 's' : ''}`}
            trailing={selectedDay ? (
              <StatChip>
                {new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </StatChip>
            ) : undefined}
            action={(
              <button onClick={() => setCreateOpen(true)} className="workspace-page-action">
                <Plus size={15} />
                New Schedule
              </button>
            )}
          />

          {wsId && (
            <div className="mt-4">
              <SmartViewsBar
                workspaceId={wsId}
                entityType="schedule"
                currentFilters={currentFilters}
                onApplyFilters={(filters) => {
                  const next = filters as Partial<typeof currentFilters>;
                  setSelectedTagIds(Array.isArray(next.selectedTagIds) ? next.selectedTagIds.filter((value): value is string => typeof value === 'string') : []);
                }}
              />
            </div>
          )}

          {wsId && (
            <div className="mt-4">
              <TagFilterBar
                workspaceId={wsId}
                selectedTagIds={selectedTagIds}
                onTagIdsChange={setSelectedTagIds}
              />
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8 pt-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-8 pb-8">
              <EmptyState
                icon={<CalendarDays size={40} />}
                title="No schedules yet"
                description="Create a schedule to control when playlists and content are shown."
                action={<button onClick={() => setCreateOpen(true)} className="workspace-page-action"><Plus size={14} /> New Schedule</button>}
                className="min-h-[14rem]"
              />
            </div>
          ) : (
            <div className="space-y-3 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8">
              {filtered.map(sch => (
                <ScheduleRow
                  key={sch.id}
                  sch={sch}
                  color={scheduleColors.get(sch.id) ?? PALETTE[0]!}
                  onEdit={() => navigate(`/workspaces/${wsId!}/schedule/${sch.id}`)}
                  onClone={() => {
                    setConfirmCloneId(sch.id);
                    setConfirmCloneName(sch.name);
                  }}
                  onDelete={() => {
                    setConfirmDeleteId(sch.id);
                    setConfirmDeleteName(sch.name);
                  }}
                  checked={selectedItems.has(sch.id)}
                  onCheck={() => setSelectedItems((prev) => { const next = new Set(prev); next.has(sch.id) ? next.delete(sch.id) : next.add(sch.id); return next; })}
                />
              ))}
            </div>
          )}
        </div>

        {selectedItems.size > 0 && (
          <div
            className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl sm:bottom-6 sm:px-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--card-border)' }}
          >
            <span className="text-sm font-semibold text-[var(--text)]">{selectedItems.size} selected</span>
            <div className="w-px h-5 bg-[var(--border)]" />
            <button
              onClick={() => setSelectedItems(new Set())}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Deselect all
            </button>
            <button
              onClick={() => setBulkTagOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--accent)] text-xs font-semibold hover:bg-[var(--accent)]/25 transition-colors"
            >
              <Check size={12} /> Apply Tags
            </button>
            <button
              onClick={() => setPublishPickerOpen(true)}
              disabled={selectedItems.size !== 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--blue)]/15 border border-[var(--blue)]/30 text-[var(--blue)] text-xs font-semibold hover:bg-[var(--blue)]/25 disabled:opacity-40 transition-colors"
            >
              <Monitor size={12} /> Publish
            </button>
          </div>
        )}
      </div>

      {bulkTagOpen && wsId && (
        <BulkTagModal
          workspaceId={wsId}
          entityType="schedule"
          entityIds={[...selectedItems]}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setSelectedItems(new Set());
            void queryClient.invalidateQueries({ queryKey: ['schedules', wsId] });
          }}
        />
      )}

      {publishPickerOpen && wsId && publishCandidate && (
        <DevicePickerModal
          open={publishPickerOpen}
          onClose={() => setPublishPickerOpen(false)}
          onSelect={(devices) => publishMut.mutate(devices.map((device) => device.id))}
          workspaceId={wsId}
          title={`Publish ${publishCandidate.name}`}
          confirmLabel={publishMut.isPending ? 'Publishing…' : 'Publish'}
        />
      )}

      {/* ── Create dialog ── */}
      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)} size="sm">
          <ModalHeader title="New Schedule" onClose={() => setCreateOpen(false)} />

          <ModalBody className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--text-muted)]">Name</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. Weekday Morning Rotation"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && newName.trim() && createMut.mutate()}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--text-muted)]">Type</label>
                <div className="flex gap-2">
                  {(['general', 'override'] as const).map(t => (
                    <FilterChip
                      key={t}
                      onClick={() => setNewType(t)}
                      active={newType === t}
                      tone={t === 'override' ? 'danger' : 'warning'}
                      className="flex-1 capitalize"
                    >
                      {t}
                    </FilterChip>
                  ))}
                </div>
              </div>
          </ModalBody>

            <ModalFooter className="modal-footer-plain">
              <ModalSecondaryButton
                onClick={() => { setCreateOpen(false); setNewName(''); }}
                className="flex-1"
              >
                Cancel
              </ModalSecondaryButton>
              <ModalPrimaryButton
                onClick={() => createMut.mutate()}
                disabled={!newName.trim() || createMut.isPending}
                className="flex-1"
              >
                {createMut.isPending ? 'Creating…' : 'Create'}
              </ModalPrimaryButton>
            </ModalFooter>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Schedule"
        message={`Delete "${confirmDeleteName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmDeleteId) deleteMut.mutate(confirmDeleteId);
        }}
        onClose={() => {
          setConfirmDeleteId(null);
          setConfirmDeleteName('');
        }}
      />

      <ConfirmDialog
        open={confirmCloneId !== null}
        title="Clone Schedule"
        message={`Create a copy of "${confirmCloneName}"?`}
        confirmLabel="Clone"
        confirmPendingLabel="Cloning…"
        variant="primary"
        icon={<Copy size={16} />}
        isConfirming={cloneMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmCloneId) cloneMut.mutate(confirmCloneId);
        }}
        onClose={() => {
          setConfirmCloneId(null);
          setConfirmCloneName('');
        }}
      />
    </div>
  );
}
