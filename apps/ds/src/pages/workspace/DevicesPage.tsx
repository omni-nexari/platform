import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { api, buildApiUrl } from '../../lib/api.js';
import { ClaimDeviceSchema } from '@signage/shared';
import type { ClaimDeviceInput } from '@signage/shared';

type PairFormInput = Omit<ClaimDeviceInput, 'workspaceId'>;
import { Monitor, Plus, WifiOff, Clock, ChevronRight, Cpu, Check, RotateCcw, Layers, Utensils, ShoppingBag, Trash2, Eye, X as XIcon } from 'lucide-react';

// Shows the device thumbnail using the DB-backed screenshot record.
// Re-renders automatically when the device list poll returns a new latestScreenshotId.
function DeviceScreenshot({ deviceId, screenshotId, latestFrameAt }: {
  deviceId: string;
  screenshotId: string | null;
  latestFrameAt: number | null;
}) {
  const [errored, setErrored] = useState(false);
  // Reset error state whenever a fresh screenshot id or frame timestamp arrives.
  useEffect(() => { setErrored(false); }, [screenshotId, latestFrameAt]);
  const showImg = !!screenshotId && !errored;
  // Append ?t= cache-buster so the browser re-fetches the image file whenever
  // latestFrameAt changes — even if the DB row UUID hasn't changed yet.
  const src = buildApiUrl(`/devices/${deviceId}/screenshots/${screenshotId}${latestFrameAt ? `?t=${latestFrameAt}` : ''}`);
  return (
    <div className={`w-full aspect-video rounded-lg border border-[var(--card-border)] flex items-center justify-center overflow-hidden ${showImg ? '' : 'bg-[var(--surface)]'}`}>
      {showImg
        ? <img
            key={`${screenshotId}-${latestFrameAt ?? 0}`}
            src={src}
            alt="Latest screenshot"
            className="w-full h-full object-cover"
            onError={() => setErrored(true)}
          />
        : <Monitor className="w-6 h-6 text-[var(--text-muted)] opacity-30" />
      }
    </div>
  );
}

// ── LiveViewInCard — replaces the thumbnail with a live SSE stream ─────────────
function LiveViewInCard({ deviceId, onStop }: { deviceId: string; onStop: () => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  useEffect(() => {
    const es = new EventSource(`/api/devices/${deviceId}/screenshot/stream?intervalMs=1000`);
    es.onmessage = (e) => {
      setStatus('live');
      setImgSrc(`data:image/jpeg;base64,${e.data as string}`);
    };
    es.onerror = () => setStatus('error');
    return () => es.close();
  }, [deviceId]);

  return (
    <div className="relative w-full aspect-video rounded-lg border border-[var(--blue)]/60 overflow-hidden bg-black flex items-center justify-center">
      {imgSrc
        ? <img src={imgSrc} alt="Live" className="w-full h-full object-contain" />
        : <div className="flex flex-col items-center gap-2 text-white/40">
            <Monitor className="w-6 h-6" />
            <span className="text-[10px]">{status === 'error' ? 'No signal' : 'Connecting…'}</span>
          </div>
      }
      {/* Status pip */}
      <span className={`absolute top-2 left-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
        status === 'live' ? 'bg-emerald-500/80 text-white' : 'bg-black/60 text-white/60'
      }`}>{status === 'live' ? 'Live' : status === 'error' ? 'No signal' : 'Connecting'}</span>
      {/* Stop button */}
      <button
        onClick={(e) => { e.stopPropagation(); onStop(); }}
        className="absolute top-2 right-2 p-1 rounded bg-black/60 hover:bg-black/90 text-white/80 hover:text-white transition-colors"
        title="Stop live view"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}
import { formatDistanceToNow } from '../utils/time.js';
import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import BulkTagModal from '../../components/BulkTagModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import SmartViewsBar from '../../components/SmartViewsBar.js';
import TagFilterBar from '../../components/TagFilterBar.js';
import {
  Badge,
  Modal,
  ModalBody,
  EmptyState,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

interface Device {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  powerState: 'on' | 'off' | 'standby' | null;
  type: 'signage' | 'kiosk' | 'kitchen';
  platform: string;
  manufacturer: string | null;
  modelName: string | null;
  assignedTags?: AssignedTag[];
  lastSeen: string | null;
  playerVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  serialNumber: string | null;
  timezone: string;
  latestScreenshotId: string | null;
  latestFrameAt: number | null;
  publishedTarget: {
    id: string;
    type: 'content' | 'playlist' | 'schedule';
    name: string;
  } | null;
}

function StatusBadge({ status }: { status: Device['status'] }) {
  const map = {
    online: { label: 'Online', tone: 'success' },
    offline: { label: 'Offline', tone: 'neutral' },
    unclaimed: { label: 'Unclaimed', tone: 'warning' },
    error: { label: 'Error', tone: 'danger' },
  } as const;
  const s = map[status] ?? map.offline;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function TypeBadge({ type }: { type: Device['type'] }) {
  const map: Record<Device['type'], { label: string; tone: 'neutral' | 'info' | 'warning' }> = {
    signage: { label: 'Signage', tone: 'neutral' },
    kiosk: { label: 'Kiosk', tone: 'info' },
    kitchen: { label: 'Kitchen', tone: 'warning' },
  };
  const t = map[type] ?? map.signage;
  return <Badge tone={t.tone}>{t.label}</Badge>;
}

const STATUS_FILTERS = ['all', 'online', 'offline', 'unclaimed', 'error'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function DevicesPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [pairOpen, setPairOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    (searchParams.get('tagIds') ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  );
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>(
    (searchParams.get('status') as StatusFilter | null) ?? 'all',
  );
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices', wsId, selectedTagIds],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}${tagIdsParam}`),
    refetchInterval: 15_000,
  });

  const [liveViewDeviceId, setLiveViewDeviceId] = useState<string | null>(null);

  const filteredDevices = devices.filter((d) => {
    if (selectedStatus !== 'all' && d.status !== selectedStatus) return false;
    return true;
  });

  // Sync URL params ↔ state
  useEffect(() => {
    const urlTagIds = (searchParams.get('tagIds') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    const urlStatus = (searchParams.get('status') as StatusFilter | null) ?? 'all';
    if (urlTagIds.join(',') !== selectedTagIds.join(',')) setSelectedTagIds(urlTagIds);
    if (urlStatus !== selectedStatus) setSelectedStatus(urlStatus);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (selectedTagIds.length > 0) nextParams.set('tagIds', selectedTagIds.join(','));
    else nextParams.delete('tagIds');
    if (selectedStatus !== 'all') nextParams.set('status', selectedStatus);
    else nextParams.delete('status');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [selectedTagIds, selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PairFormInput>({
    resolver: zodResolver(ClaimDeviceSchema.omit({ workspaceId: true })),
  });

  const claimMutation = useMutation({
    mutationFn: (data: PairFormInput) =>
      api.post<{ device: Device }>('/devices/pair/claim', { ...data, workspaceId: wsId }),
    onSuccess: ({ device }: { device: Device }) => {
      toast.success('Device claimed');
      setPairOpen(false);
      reset();
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
      navigate(`/workspaces/${wsId}/devices/${device.id}`);
    },
    onError: () => toast.error('Failed to claim device — check the pairing code'),
  });

  const toggleItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.delete(`/devices/${id}`))),
    onSuccess: (_data, ids) => {
      toast.success(`Deleted ${ids.length} device(s)`);
      setConfirmBulkDelete(false);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: () => toast.error('Failed to delete some devices'),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Devices"
        description={`${devices.length} device${devices.length !== 1 ? 's' : ''} in this workspace`}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="ui-btn-primary flex items-center gap-1.5"
              onClick={() => setPairOpen(true)}
            >
              <Plus className="w-4 h-4" />
              Pair Device
            </button>
            <button
              className="ui-btn-secondary flex items-center gap-1.5"
              onClick={() => navigate(`/workspaces/${wsId}/devices/groups`)}
            >
              <Layers className="w-4 h-4" />
              Groups
            </button>
          </div>
        }
      />

      <SmartViewsBar
        workspaceId={wsId!}
        entityType="device"
        currentFilters={{ tagIds: selectedTagIds, status: selectedStatus }}
        onApplyFilters={(filters) => {
          const next = filters as { tagIds?: string[]; status?: StatusFilter };
          setSelectedTagIds(Array.isArray(next.tagIds) ? next.tagIds : []);
          setSelectedStatus(next.status ?? 'all');
        }}
      />

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] overflow-hidden text-xs">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setSelectedStatus(s)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                selectedStatus === s
                  ? 'bg-[var(--blue)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              }`}
            >
              {s === 'all' ? 'All Status' : s}
            </button>
          ))}
        </div>

        <TagFilterBar
          workspaceId={wsId!}
          selectedTagIds={selectedTagIds}
          onTagIdsChange={setSelectedTagIds}
        />
      </div>

      {/* Device sections */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : filteredDevices.length === 0 ? (
        <EmptyState
          icon={<Monitor className="w-8 h-8" />}
          title="No devices"
          description="Pair your first device to get started."
          action={
            <button className="ui-btn-primary" onClick={() => setPairOpen(true)}>
              Pair Device
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {(
            [
              { key: 'signage', label: 'Signage Displays', icon: <Monitor className="w-4 h-4" /> },
              { key: 'kitchen', label: 'Kitchen Monitor', icon: <Utensils className="w-4 h-4" /> },
              { key: 'kiosk',   label: 'Kiosk Ops',       icon: <ShoppingBag className="w-4 h-4" /> },
            ] as const
          ).map(({ key, label, icon }) => {
            const sectionDevices = filteredDevices.filter((d) => (d.type ?? 'signage') === key);
            if (sectionDevices.length === 0) return null;
            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--text)]">
                  {icon}
                  {label}
                  <span className="ml-1 text-[var(--text-muted)] font-normal">({sectionDevices.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sectionDevices.map((device) => (
                    <div
                      key={device.id}
                      className={`group rounded-xl border p-4 flex flex-col gap-3 cursor-pointer transition-colors relative bg-[var(--card)] ${
                        selectedItems.has(device.id)
                          ? 'border-[var(--blue)]'
                          : 'border-[var(--card-border)] hover:border-[var(--blue)]/60'
                      }`}
                      onClick={() => navigate(`/workspaces/${wsId}/devices/${device.id}`)}
                    >
                      {/* Screenshot thumbnail or live view */}
                      {liveViewDeviceId === device.id
                        ? <LiveViewInCard deviceId={device.id} onStop={() => setLiveViewDeviceId(null)} />
                        : <DeviceScreenshot
                            deviceId={device.id}
                            screenshotId={device.latestScreenshotId}
                            latestFrameAt={device.latestFrameAt}
                          />
                      }

                      {/* Header: checkbox + name */}
                      <div className="flex items-start gap-2">
                        {/* Checkbox — outside thumbnail, always clickable */}
                        <input
                          type="checkbox"
                          checked={selectedItems.has(device.id)}
                          onChange={(e) => { e.stopPropagation(); toggleItem(device.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 shrink-0 w-4 h-4 accent-[var(--blue)]"
                        />
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            device.status === 'online'
                              ? 'bg-[var(--success)]/15 text-[var(--success)]'
                              : device.status === 'error'
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-[var(--surface)] text-[var(--text-muted)]'
                          }`}>
                            <Monitor className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text)] truncate">{device.name}</p>
                            {device.modelName && (
                              <p className="text-xs text-[var(--text-muted)] truncate">
                                {device.manufacturer ? `${device.manufacturer} ` : ''}{device.modelName}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge status={device.status} />
                        {device.platform && device.platform !== 'tizen' && (
                          <Badge tone="neutral">{device.platform}</Badge>
                        )}
                      </div>

                      {/* Meta */}
                      <div className="space-y-1 text-xs text-[var(--text-muted)]">
                        {device.status === 'online' && device.lastSeen && (
                          <div className="flex items-center gap-1">
                            <Cpu className="w-3 h-3" />
                            <span>Online</span>
                          </div>
                        )}
                        {device.status !== 'online' && device.lastSeen && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{formatDistanceToNow(device.lastSeen)}</span>
                          </div>
                        )}
                        {device.status !== 'online' && !device.lastSeen && device.status !== 'unclaimed' && (
                          <div className="flex items-center gap-1">
                            <WifiOff className="w-3 h-3" />
                            <span>Never seen</span>
                          </div>
                        )}
                        {device.publishedTarget && (
                          <div className="flex items-center gap-1">
                            <Check className="w-3 h-3 text-[var(--success)]" />
                            <span className="truncate">{device.publishedTarget.name}</span>
                          </div>
                        )}
                        {device.ipAddress && (
                          <span className="font-mono">{device.ipAddress}</span>
                        )}
                      </div>

                      {/* Tags + Live button row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(device.assignedTags?.length ?? 0) > 0 && (
                          <AssignedTagPills tags={device.assignedTags!} />
                        )}
                        {device.status === 'online' && liveViewDeviceId !== device.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setLiveViewDeviceId(device.id); }}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/40 text-[var(--text-muted)] hover:text-[var(--accent)] text-[10px] font-semibold transition-all"
                          >
                            <Eye className="w-3 h-3" />
                            Live
                          </button>
                        )}
                      </div>

                      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] self-end" />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pair Device Modal */}
      <Modal open={pairOpen} onClose={() => { setPairOpen(false); reset(); }}>
        <ModalHeader>Pair a Device</ModalHeader>
        <ModalBody>
          <form id="pair-form" onSubmit={handleSubmit((d) => claimMutation.mutate(d))} className="space-y-4">
            <div>
              <label className="ui-label">Pairing Code</label>
              <input
                {...register('code')}
                className="ui-input w-full font-mono uppercase"
                placeholder="ABC123"
                autoFocus
              />
              {errors.code && (
                <p className="text-xs text-red-400 mt-1">{errors.code.message}</p>
              )}
            </div>
            <div>
              <label className="ui-label">Device Name</label>
              <input
                {...register('name')}
                className="ui-input w-full"
                placeholder="e.g. Lobby Display"
              />
              {errors.name && (
                <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>
              )}
            </div>
            <input type="hidden" {...register('type')} value="signage" />
          </form>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={() => { setPairOpen(false); reset(); }}>Cancel</ModalSecondaryButton>
          <ModalPrimaryButton form="pair-form" type="submit" disabled={isSubmitting || claimMutation.isPending}>
            {claimMutation.isPending ? (
              <><RotateCcw className="w-3.5 h-3.5 animate-spin" /> Pairing…</>
            ) : 'Pair Device'}
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>

      {/* Bulk tag modal */}
      {bulkTagOpen && (
        <BulkTagModal
          workspaceId={wsId!}
          entityType="device"
          entityIds={Array.from(selectedItems)}
          onClose={() => { setBulkTagOpen(false); setSelectedItems(new Set()); }}
          onApplied={() => {
            setBulkTagOpen(false);
            setSelectedItems(new Set());
            void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
          }}
        />
      )}

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
            onClick={() => setConfirmBulkDelete(true)}
            disabled={bulkDeleteMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/25 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={12} /> Delete {selectedItems.size}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Devices"
        message={`Delete ${selectedItems.size} device(s)? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={bulkDeleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => bulkDeleteMut.mutate([...selectedItems])}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
