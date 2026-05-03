import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { Layers, Plus, ChevronRight, Monitor, LayoutGrid, MapPin, Tag, Search, Check } from 'lucide-react';
import {
  Badge,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeviceGroup {
  id: string;
  name: string;
  type: 'sync' | 'videowall' | 'location' | 'tag';
  description: string | null;
  memberCount: number;
  createdAt: string;
}

interface CreatedGroup {
  id: string;
  name: string;
  type: DeviceGroup['type'];
  syncGroupId: string | null;
}

interface DeviceLite {
  id: string;
  name: string;
  status: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<DeviceGroup['type'], { label: string; icon: React.ReactNode; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
  sync:      { label: 'Sync',       icon: <Monitor    className="w-4 h-4" />, tone: 'info'    },
  videowall: { label: 'Video Wall', icon: <LayoutGrid className="w-4 h-4" />, tone: 'success' },
  location:  { label: 'Location',   icon: <MapPin     className="w-4 h-4" />, tone: 'neutral' },
  tag:       { label: 'Tag Group',  icon: <Tag        className="w-4 h-4" />, tone: 'warning' },
};

const GROUP_TYPES = ['sync', 'videowall', 'location', 'tag'] as const;

// ── Wizard state ──────────────────────────────────────────────────────────────

interface WizardState {
  open: boolean;
  step: 1 | 2;
  name: string;
  type: DeviceGroup['type'];
  description: string;
  cols: number;
  rows: number;
  createdGroupId: string | null;
  createdSyncGroupId: string | null;
}

const INITIAL_WIZARD: WizardState = {
  open: false, step: 1, name: '', type: 'location', description: '',
  cols: 2, rows: 2, createdGroupId: null, createdSyncGroupId: null,
};

// ── Stepper ───────────────────────────────────────────────────────────────────

function GridStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-[var(--text-muted)] w-16">{label}</span>
      <button
        type="button"
        onClick={() => value > 1 && onChange(value - 1)}
        disabled={value <= 1}
        className="w-6 h-6 rounded border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40"
      >−</button>
      <span className="w-5 text-center text-sm font-mono text-[var(--text)]">{value}</span>
      <button
        type="button"
        onClick={() => value < 8 && onChange(value + 1)}
        disabled={value >= 8}
        className="w-6 h-6 rounded border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40"
      >+</button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeviceGroupsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [wizard, setWizard] = useState<WizardState>(INITIAL_WIZARD);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deviceSearch, setDeviceSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') ?? 'groups') as 'groups' | 'singles';

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: groups = [], isLoading } = useQuery<DeviceGroup[]>({
    queryKey: ['device-groups', wsId],
    queryFn: () => api.get(`/device-groups?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const { data: allDevices = [], isLoading: devicesLoading } = useQuery<DeviceLite[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    enabled: !!wsId,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return allDevices;
    return allDevices.filter((d) => d.name.toLowerCase().includes(q));
  }, [allDevices, deviceSearch]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function openWizard() {
    setWizard({ ...INITIAL_WIZARD, open: true });
    setSelectedIds(new Set());
    setDeviceSearch('');
  }

  function closeWizard() {
    setWizard(INITIAL_WIZARD);
    setSelectedIds(new Set());
    setDeviceSearch('');
  }

  function skipAndNavigate() {
    const groupId = wizard.createdGroupId;
    closeWizard();
    if (groupId) navigate(`/workspaces/${wsId}/devices/groups/${groupId}`);
  }

  function toggleDevice(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: () =>
      api.post<CreatedGroup>('/device-groups', {
        workspaceId: wsId,
        name: wizard.name.trim(),
        type: wizard.type,
        description: wizard.description.trim() || null,
        ...(wizard.type === 'videowall' ? { videoWallCols: wizard.cols, videoWallRows: wizard.rows } : {}),
      }),
    onSuccess: (group: CreatedGroup) => {
      void queryClient.invalidateQueries({ queryKey: ['device-groups', wsId] });
      setWizard((w) => ({ ...w, step: 2, createdGroupId: group.id, createdSyncGroupId: group.syncGroupId }));
      setSelectedIds(new Set());
    },
    onError: () => toast.error('Failed to create group'),
  });

  const addMembersMut = useMutation({
    mutationFn: () => {
      const deviceIds = [...selectedIds];
      if (wizard.type === 'sync' && wizard.createdSyncGroupId) {
        return api.post(`/sync-groups/${wizard.createdSyncGroupId}/members`, { deviceIds });
      }
      return api.put(
        `/device-groups/${wizard.createdGroupId}/members`,
        deviceIds.map((id, idx) => ({ deviceId: id, position: idx })),
      );
    },
    onSuccess: () => {
      const count = selectedIds.size;
      toast.success(`${count} screen${count !== 1 ? 's' : ''} added`);
      skipAndNavigate();
    },
    onError: () => toast.error('Failed to add screens'),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Device Groups"
        description="Organise devices into sync groups, video walls, and locations"
        actions={
          <button className="ui-btn-primary flex items-center gap-1.5" onClick={openWizard}>
            <Plus className="w-4 h-4" /> New Group
          </button>
        }
      />

      {/* Singles / Groups filter */}
      <div className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] overflow-hidden text-xs self-start">
        {(['groups', 'singles'] as const).map((v) => (
          <button
            key={v}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (v === 'groups') next.delete('view'); else next.set('view', v);
              setSearchParams(next, { replace: true });
            }}
            className={`px-3 py-1.5 capitalize transition-colors ${
              view === v
                ? 'bg-[var(--blue)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {v === 'groups' ? 'Groups' : 'Singles'}
          </button>
        ))}
      </div>

      {/* Singles view */}
      {view === 'singles' && (
        devicesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : allDevices.length === 0 ? (
          <EmptyState
            icon={<Monitor className="w-8 h-8" />}
            title="No devices"
            description="Pair your first device to get started."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allDevices.map((d) => {
              const dot = d.status === 'online' ? 'bg-emerald-400' : d.status === 'error' ? 'bg-red-400' : 'bg-white/20';
              return (
                <div
                  key={d.id}
                  className="ui-card p-4 flex items-center gap-3 cursor-pointer hover:border-[var(--blue)] transition-colors"
                  onClick={() => navigate(`/workspaces/${wsId}/devices/${d.id}`)}
                >
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{d.name}</p>
                    <p className="text-xs text-[var(--text-muted)] capitalize">{d.status}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Groups view */}
      {view === 'groups' && (
        isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-8 h-8" />}
            title="No device groups"
            description="Create groups to organise devices for sync playback, video walls, or physical locations."
            action={<button className="ui-btn-primary" onClick={openWizard}>New Group</button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group) => {
              const meta = TYPE_META[group.type] ?? TYPE_META.location;
              return (
                <div
                  key={group.id}
                  className="ui-card p-4 flex flex-col gap-3 cursor-pointer hover:border-[var(--blue)] transition-colors"
                  onClick={() => navigate(`/workspaces/${wsId}/devices/groups/${group.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[var(--surface)] flex items-center justify-center text-[var(--text-muted)]">
                        {meta.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{group.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {group.memberCount} device{group.memberCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  </div>
                  {group.description && (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">{group.description}</p>
                  )}
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Creation wizard ─────────────────────────────────────────────────── */}
      <Modal
        open={wizard.open}
        size={wizard.step === 2 ? 'md' : 'sm'}
        onClose={() => wizard.step === 2 ? skipAndNavigate() : closeWizard()}
      >
        {/* Step indicators */}
        <div className="px-5 pt-5 flex items-center gap-1.5">
          {([1, 2] as const).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              {s > 1 && <div className="h-px w-5 bg-[var(--border)]" />}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
                wizard.step > s
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : wizard.step === s
                  ? 'bg-[var(--blue)] text-white'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
              }`}>
                {wizard.step > s ? <Check className="w-3 h-3" /> : s}
              </div>
              <span className={`text-xs ${wizard.step === s ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                {s === 1 ? 'Group details' : 'Add screens'}
              </span>
            </div>
          ))}
        </div>

        {/* ── Step 1: group details ─────────────────────────────────────────── */}
        {wizard.step === 1 && (
          <>
            <ModalHeader>New Device Group</ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <div>
                  <label className="ui-label">Group Name</label>
                  <input
                    className="ui-input w-full"
                    value={wizard.name}
                    onChange={(e) => setWizard((w) => ({ ...w, name: e.target.value }))}
                    placeholder="e.g. Lobby Videowall"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && wizard.name.trim() && !createMut.isPending) createMut.mutate();
                    }}
                  />
                </div>

                <div>
                  <label className="ui-label">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {GROUP_TYPES.map((t) => {
                      const m = TYPE_META[t];
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setWizard((w) => ({ ...w, type: t }))}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                            wizard.type === t
                              ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--text)]'
                              : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                          }`}
                        >
                          {m.icon} {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Videowall grid dimensions */}
                {wizard.type === 'videowall' && (
                  <div>
                    <label className="ui-label">Grid Size</label>
                    <div className="flex items-center gap-5">
                      <GridStepper
                        label="Columns"
                        value={wizard.cols}
                        onChange={(v) => setWizard((w) => ({ ...w, cols: v }))}
                      />
                      <span className="text-[var(--text-faint)] text-sm">×</span>
                      <GridStepper
                        label="Rows"
                        value={wizard.rows}
                        onChange={(v) => setWizard((w) => ({ ...w, rows: v }))}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="ui-label">
                    Description <span className="text-[var(--text-faint)] font-normal">(optional)</span>
                  </label>
                  <input
                    className="ui-input w-full"
                    value={wizard.description}
                    onChange={(e) => setWizard((w) => ({ ...w, description: e.target.value }))}
                    placeholder="What is this group used for?"
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <ModalSecondaryButton onClick={closeWizard}>Cancel</ModalSecondaryButton>
              <ModalPrimaryButton
                onClick={() => createMut.mutate()}
                disabled={!wizard.name.trim() || createMut.isPending}
              >
                {createMut.isPending ? 'Creating…' : 'Continue →'}
              </ModalPrimaryButton>
            </ModalFooter>
          </>
        )}

        {/* ── Step 2: add screens ───────────────────────────────────────────── */}
        {wizard.step === 2 && (
          <>
            <ModalHeader>Add screens to &ldquo;{wizard.name}&rdquo;</ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
                  <input
                    className="ui-input w-full pl-8"
                    placeholder="Search screens…"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Device list */}
                <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {devicesLoading ? (
                      <div className="p-5 text-center text-sm text-[var(--text-muted)]">Loading screens…</div>
                    ) : filteredDevices.length === 0 ? (
                      <div className="p-5 text-center text-sm text-[var(--text-muted)]">
                        {deviceSearch ? 'No screens match your search' : 'No screens in this workspace'}
                      </div>
                    ) : (
                      <div className="divide-y divide-[var(--border)]">
                        {filteredDevices.map((d) => {
                          const checked = selectedIds.has(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleDevice(d.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                checked ? 'bg-[var(--blue)]/8' : 'hover:bg-[var(--bg)]'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                checked ? 'border-[var(--blue)] bg-[var(--blue)]' : 'border-[var(--border)]'
                              }`}>
                                {checked && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                d.status === 'online' ? 'bg-emerald-400' : 'bg-white/20'
                              }`} />
                              <span className="text-sm text-[var(--text)] truncate flex-1">{d.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                                d.status === 'online'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-white/5 text-[var(--text-faint)] border-[var(--border)]'
                              }`}>
                                {d.status}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {selectedIds.size > 0 && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {selectedIds.size} screen{selectedIds.size !== 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <ModalSecondaryButton onClick={skipAndNavigate}>Skip</ModalSecondaryButton>
              <ModalPrimaryButton
                onClick={() => addMembersMut.mutate()}
                disabled={selectedIds.size === 0 || addMembersMut.isPending}
              >
                {addMembersMut.isPending
                  ? 'Adding…'
                  : selectedIds.size > 0
                  ? `Add ${selectedIds.size} Screen${selectedIds.size !== 1 ? 's' : ''}`
                  : 'Add Screens'}
              </ModalPrimaryButton>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
