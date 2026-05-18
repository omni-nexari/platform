import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, Grid2x2, Monitor, Search, Wifi, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import AssignedTagPills, { type AssignedTag } from './AssignedTagPills.js';
import { ToggleSwitch } from './UiPrimitives.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DeviceItem {
  id: string;
  name: string;
  type?: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  updatedAt: string;
  lastSeen: string | null;
  modelName: string | null;
  modelCode: string | null;
  resolution: string | null;
  timezone: string;
  ipAddress: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  wifiSsid: string | null;
  assignedTags?: AssignedTag[];
  latestScreenshotId: string | null;
  latestFrameAt?: number | null;
}

interface DeviceGroup {
  id: string;
  name: string;
  type: 'sync' | 'videowall' | 'location' | 'tag';
  description: string | null;
  videoWallCols: number | null;
  videoWallRows: number | null;
  memberCount?: number;
}

type PublishMode = 'videowall' | 'single';
type SingleTab = 'devices' | 'groups';
type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusMeta(status: DeviceItem['status']) {
  if (status === 'online') return { label: 'Online', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  if (status === 'error') return { label: 'Error', className: 'bg-red-500/15 text-red-300 border-red-500/30' };
  if (status === 'unclaimed') return { label: 'Unclaimed', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  return { label: 'Offline', className: 'bg-white/5 text-[var(--text-muted)] border-[var(--border)]' };
}

function sortLabel(k: SortKey) {
  return { 'date-desc': 'Date ↓', 'date-asc': 'Date ↑', 'name-asc': 'Name A-Z', 'name-desc': 'Name Z-A' }[k];
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function DeviceCard({
  item,
  selected,
  onToggle,
}: {
  item: DeviceItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const status = statusMeta(item.status);
  const subtitle = item.modelName || item.modelCode || item.ipAddress || 'Display';
  const [thumbErrored, setThumbErrored] = useState(false);
  const showThumb = !!item.latestScreenshotId && !thumbErrored;

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]/8'
          : 'border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)]'
      }`}
    >
      <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)]'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>

      <div className="relative shrink-0 w-[72px] h-[44px] rounded-lg overflow-hidden bg-[var(--surface-raised)] border border-[var(--border)]">
        {showThumb
          ? <img
              key={`${item.latestScreenshotId}-${item.latestFrameAt ?? 0}`}
              src={`/api/v1/devices/${item.id}/screenshots/${item.latestScreenshotId}${item.latestFrameAt ? `?t=${item.latestFrameAt}` : ''}`}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setThumbErrored(true)}
            />
          : <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
              <Monitor size={16} />
            </div>
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text)] truncate leading-tight">{item.name}</p>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${status.className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {status.label}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{subtitle}</p>
        <AssignedTagPills tags={item.assignedTags} />
      </div>
    </div>
  );
}

function GroupCard({
  group,
  selected,
  onToggle,
  single,
}: {
  group: DeviceGroup;
  selected: boolean;
  onToggle: () => void;
  single?: boolean;
}) {
  const isVideowall = group.type === 'videowall';
  const dims = isVideowall && group.videoWallCols && group.videoWallRows
    ? `${group.videoWallCols}×${group.videoWallRows}`
    : null;

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]/8'
          : 'border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)]'
      }`}
    >
      {/* Radio / checkbox dot */}
      <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)]'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>

      {/* Icon */}
      <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
        {isVideowall ? <Grid2x2 size={16} /> : <Monitor size={16} />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text)] truncate leading-tight">{group.name}</p>
          {dims && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border)]">
              {dims}
            </span>
          )}
          {/* In Single mode, videowall groups get a P2P Sync badge */}
          {single && isVideowall && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300 border-amber-500/30">
              P2P Sync
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 capitalize">{group.type} group</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishWizardModalProps {
  open: boolean;
  contentId: string;
  contentName: string;
  workspaceId: string;
  preSelectedDeviceIds?: string[];
  /** When true, skip the mode-selection step and go straight to device picker (Single mode). */
  skipModeStep?: boolean;
  /** When provided, only show devices of this type in the device picker. */
  deviceTypeFilter?: string;
  /** When true, hide signage-type devices (use in POS contexts where only POS devices are relevant). */
  excludeSignageDevices?: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function PublishWizardModal({
  open,
  contentId,
  contentName,
  workspaceId,
  preSelectedDeviceIds,
  skipModeStep,
  deviceTypeFilter,
  excludeSignageDevices,
  onClose,
  onDone,
}: PublishWizardModalProps) {
  const [step, setStep] = useState<1 | 2>(() => skipModeStep ? 2 : 1);
  const [mode, setMode] = useState<PublishMode | null>(() => skipModeStep ? 'single' : null);

  // Videowall target (step 2, videowall mode) — single-select
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Single target (step 2, single mode)
  const [singleTab, setSingleTab] = useState<SingleTab>('devices');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    () => new Set(preSelectedDeviceIds ?? []),
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Device list filters
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [hideOffline, setHideOffline] = useState(false);

  // Fetch devices (step 2 only)
  const { data: deviceItems = [], isLoading: devicesLoading } = useQuery<DeviceItem[]>({
    queryKey: ['wizard-devices', workspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${workspaceId}`),
    enabled: open && step === 2,
    staleTime: 30_000,
  });

  // Fetch device groups (step 2 only)
  const { data: allGroups = [], isLoading: groupsLoading } = useQuery<DeviceGroup[]>({
    queryKey: ['wizard-groups', workspaceId],
    queryFn: () => api.get(`/device-groups?workspaceId=${workspaceId}`),
    enabled: open && step === 2,
    staleTime: 30_000,
  });

  const videowallGroups = useMemo(() => allGroups.filter((g) => g.type === 'videowall'), [allGroups]);

  const sortDevices = (items: DeviceItem[]) => [...items].sort((a, b) => {
    if (sort === 'date-desc') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (sort === 'date-asc') return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    return b.name.localeCompare(a.name);
  });

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = deviceItems.filter((d) => {
      if (hideOffline && d.status !== 'online') return false;
      if (deviceTypeFilter && d.type !== deviceTypeFilter) return false;
      if (excludeSignageDevices && d.type === 'signage') return false;
      if (!q) return true;
      return [d.name, d.modelName, d.modelCode, d.ipAddress, d.wifiSsid, d.timezone]
        .some((v) => v?.toLowerCase().includes(q));
    });
    return sortDevices(items);
  }, [deviceItems, hideOffline, search, sort, deviceTypeFilter, excludeSignageDevices]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allGroups;
    return allGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [allGroups, search]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      if (mode === 'videowall') {
        if (!selectedGroupId) return;
        await api.post(`/device-groups/${selectedGroupId}/publish-videowall`, {
          contentId,
          mode: 'videowall',
        });
        toast.success('Published to videowall group');
        onDone();
        return;
      }

      // Single mode — fan out to groups and individual devices in parallel
      const calls: Promise<unknown>[] = [];

      for (const gid of selectedGroupIds) {
        const group = allGroups.find((g) => g.id === gid);
        if (group?.type === 'videowall') {
          // Videowall group in single mode → syncplay (full-screen + P2P sync, no crop)
          calls.push(api.post(`/device-groups/${gid}/publish-videowall`, {
            contentId,
            mode: 'syncplay',
          }));
        } else {
          calls.push(api.post(`/device-groups/${gid}/publish`, {
            resourceType: 'content',
            resourceId: contentId,
          }));
        }
      }

      if (selectedDeviceIds.size > 0) {
        calls.push(api.post('/devices/publish', {
          workspaceId,
          deviceIds: [...selectedDeviceIds],
          resourceType: 'content',
          resourceId: contentId,
        }));
      }

      await Promise.all(calls);

      const total = selectedDeviceIds.size + selectedGroupIds.size;
      toast.success(`Published to ${total} target${total === 1 ? '' : 's'}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setIsPending(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function toggleDevice(id: string) {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleClose() {
    onClose();
    // Reset after the modal animation finishes
    setTimeout(() => {
      setStep(skipModeStep ? 2 : 1);
      setMode(skipModeStep ? 'single' : null);
      setSelectedGroupId(null);
      setSelectedDeviceIds(new Set());
      setSelectedGroupIds(new Set());
      setSearch('');
    }, 200);
  }

  function handleBack() {
    if (skipModeStep) return; // no back when mode step is skipped
    setStep(1);
    setSelectedGroupId(null);
    setSelectedDeviceIds(new Set());
    setSelectedGroupIds(new Set());
    setSearch('');
  }

  function handleModeSelect(m: PublishMode) {
    setMode(m);
    setStep(2);
  }

  const confirmDisabled = isPending || (() => {
    if (mode === 'videowall') return !selectedGroupId;
    return selectedDeviceIds.size === 0 && selectedGroupIds.size === 0;
  })();

  const confirmLabel = isPending ? 'Publishing…' : (() => {
    if (mode === 'videowall') return selectedGroupId ? 'Publish to Videowall' : 'Select a group';
    const n = selectedDeviceIds.size + selectedGroupIds.size;
    return n > 0 ? `Publish (${n})` : 'Select targets';
  })();

  if (!open) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className="modal-shell modal-shell-lg" style={{ minHeight: '520px', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2">
            {step === 2 && !skipModeStep && (
              <button
                onClick={handleBack}
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--surface-raised)] text-[var(--text-muted)] transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div>
              <h2 className="modal-title">Publish — {contentName}</h2>
              {step === 2 && mode && (
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {mode === 'videowall' ? 'Videowall — select a group' : 'Single — select screens or groups'}
                </p>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="modal-close"><X size={20} /></button>
        </div>

        {/* Step indicator — hidden when mode step is skipped */}
        {!skipModeStep && <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {(['Mode', 'Target'] as const).map((label, idx) => {
            const stepNum = (idx + 1) as 1 | 2;
            const active = step === stepNum;
            const done = step > stepNum;
            return (
              <div
                key={label}
                className={`modal-tab ${active ? 'modal-tab-active' : ''} ${done ? 'text-[var(--accent)]' : ''}`}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold mr-1.5 ${
                  done ? 'bg-[var(--accent)] text-white' : active ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'
                }`}>{stepNum}</span>
                {label}
              </div>
            );
          })}
        </div>}

        {/* ── Step 1 — Mode selection ── */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-sm text-[var(--text-muted)] mb-4">How do you want to publish <strong className="text-[var(--text)]">{contentName}</strong>?</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

              {/* Videowall tile */}
              <button
                onClick={() => handleModeSelect('videowall')}
                className="flex flex-col items-start gap-3 p-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] group-hover:bg-[var(--accent)]/20 transition-colors">
                  <Grid2x2 size={20} />
                </div>
                <div>
                  <p className="font-semibold text-[var(--text)]">Videowall</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                    Each panel shows a cropped region of the full content. Requires a videowall group.
                  </p>
                </div>
              </button>

              {/* Single tile */}
              <button
                onClick={() => handleModeSelect('single')}
                className="flex flex-col items-start gap-3 p-5 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] group-hover:bg-[var(--accent)]/20 transition-colors">
                  <Monitor size={20} />
                </div>
                <div>
                  <p className="font-semibold text-[var(--text)]">Single</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                    Full-screen on selected devices or groups. Videowall groups play synchronized via P2P.
                  </p>
                </div>
              </button>

            </div>
          </div>
        )}

        {/* ── Step 2 — Target selection ── */}
        {step === 2 && (
          <>
            {/* Tabs — only in Single mode */}
            {mode === 'single' && (
              <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
                {(['devices', 'groups'] as SingleTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setSingleTab(t); setSearch(''); }}
                    className={`modal-tab ${singleTab === t ? 'modal-tab-active' : ''}`}
                  >
                    {t === 'devices' ? 'Devices' : 'Groups'}
                    {t === 'devices' && selectedDeviceIds.size > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold">{selectedDeviceIds.size}</span>
                    )}
                    {t === 'groups' && selectedGroupIds.size > 0 && (
                      <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold">{selectedGroupIds.size}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Search + sort bar */}
            <div className="px-4 pt-3 pb-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                  <Search size={14} className="text-[var(--text-muted)]" />
                  <input
                    type="text"
                    placeholder="Search…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
                {/* Sort only on device tab */}
                {(mode === 'videowall' || (mode === 'single' && singleTab === 'devices')) && (
                  <div className="relative">
                    <button
                      onClick={() => setSortOpen((v) => !v)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
                    >
                      {sortLabel(sort)}
                      <ChevronDown size={12} className="text-[var(--text-muted)]" />
                    </button>
                    {sortOpen && (
                      <div
                        className="absolute right-0 top-full mt-1 z-10 rounded-xl shadow-lg border py-1 min-w-[130px]"
                        style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
                      >
                        {(['date-desc', 'date-asc', 'name-asc', 'name-desc'] as SortKey[]).map((k) => (
                          <button
                            key={k}
                            onClick={() => { setSort(k); setSortOpen(false); }}
                            className={`w-full text-left px-4 py-1.5 text-xs ${sort === k ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                          >
                            {sortLabel(k)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Hide offline toggle on device tabs */}
                {mode === 'single' && singleTab === 'devices' && (
                  <ToggleSwitch label="Online" checked={hideOffline} onChange={() => setHideOffline((v) => !v)} />
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-4 pb-2">

              {/* Videowall mode — group cards, single-select */}
              {mode === 'videowall' && (
                <>
                  {groupsLoading ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">Loading…</div>
                  ) : videowallGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 h-40 text-sm text-[var(--text-muted)]">
                      <Grid2x2 size={20} />
                      <span>No videowall groups yet</span>
                      <p className="text-xs text-center max-w-[200px]">Create a videowall group in Devices → Groups first</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {videowallGroups
                        .filter((g) => !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase()))
                        .map((g) => (
                          <GroupCard
                            key={g.id}
                            group={g}
                            selected={selectedGroupId === g.id}
                            onToggle={() => setSelectedGroupId((prev) => prev === g.id ? null : g.id)}
                          />
                        ))}
                    </div>
                  )}
                </>
              )}

              {/* Single mode — Devices tab */}
              {mode === 'single' && singleTab === 'devices' && (
                <>
                  {devicesLoading ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">Loading…</div>
                  ) : filteredDevices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 h-40 text-sm text-[var(--text-muted)]">
                      <Wifi size={18} />
                      <span>No devices found</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {filteredDevices.map((d) => (
                        <DeviceCard
                          key={d.id}
                          item={d}
                          selected={selectedDeviceIds.has(d.id)}
                          onToggle={() => toggleDevice(d.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Single mode — Groups tab */}
              {mode === 'single' && singleTab === 'groups' && (
                <>
                  {groupsLoading ? (
                    <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">Loading…</div>
                  ) : filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 h-40 text-sm text-[var(--text-muted)]">
                      <Monitor size={18} />
                      <span>No groups found</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredGroups.map((g) => (
                        <GroupCard
                          key={g.id}
                          group={g}
                          selected={selectedGroupIds.has(g.id)}
                          onToggle={() => toggleGroup(g.id)}
                          single
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

            </div>
          </>
        )}

        {/* Footer */}
        <div className="modal-footer">
          <button onClick={handleClose} className="modal-secondary-btn">Cancel</button>
          {step === 1 ? null : (
            <button
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className="modal-primary-btn"
            >
              {confirmLabel}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
