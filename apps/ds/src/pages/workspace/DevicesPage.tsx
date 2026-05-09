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
import { Grid2x2, Monitor, Plus, WifiOff, Clock, ChevronRight, Cpu, Check, RotateCcw, Layers, Utensils, ShoppingBag, Trash2, Eye, X as XIcon, Copy, CheckCheck, Battery, Play, CalendarDays, Image } from 'lucide-react';

// Shows the device thumbnail using the DB-backed screenshot record.
// Re-renders automatically when the device list poll returns a new latestScreenshotId.
function isPortrait(resolution: string | null | undefined): boolean {
  if (!resolution) return false;
  const parts = resolution.toLowerCase().split('x').map(Number);
  return parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!) && parts[1]! > parts[0]!;
}

function DeviceScreenshot({ deviceId, screenshotId, latestFrameAt, status, powerState, resolution, kind }: {
  deviceId: string;
  screenshotId: string | null;
  latestFrameAt: number | null;
  status: Device['status'];
  powerState: Device['powerState'];
  resolution?: string | null;
  kind?: string | null | undefined;(false);
  // Reset error state whenever a fresh screenshot id or frame timestamp arrives.
  useEffect(() => { setErrored(false); }, [screenshotId, latestFrameAt]);

  const isOffline = status !== 'online';
  const isPoweredOff = powerState === 'off' || powerState === 'standby';

  const portrait = isPortrait(resolution);
  // Tizen/SSSP framebuffer captures come out as landscape JPEG even for portrait displays.
  // E-paper screenshots are captured from the DOM canvas and are already portrait-correct.
  const needsRotate = portrait && kind !== 'epaper';

  // When device is offline or powered off, show a state overlay instead of the thumbnail.
  if (isOffline || isPoweredOff) {
    const label = isPoweredOff && !isOffline ? 'Powered Off' : status === 'offline' ? 'Offline' : status === 'error' ? 'Error' : 'Unclaimed';
    const Icon = isPoweredOff && !isOffline ? Monitor : WifiOff;
    return (
      <div className="w-full aspect-video rounded-lg border border-[var(--card-border)] flex flex-col items-center justify-center gap-2 bg-[var(--surface)] overflow-hidden">
        <Icon className="w-6 h-6 text-[var(--text-muted)] opacity-40" />
        <span className="text-[11px] text-[var(--text-muted)] opacity-60 font-medium">{label}</span>
      </div>
    );
  }

  const showImg = !!screenshotId && !errored;
  // Append ?t= cache-buster so the browser re-fetches the image file whenever
  // latestFrameAt changes — even if the DB row UUID hasn't changed yet.
  const src = buildApiUrl(`/devices/${deviceId}/screenshots/${screenshotId}${latestFrameAt ? `?t=${latestFrameAt}` : ''}`);
  return (
    // Always aspect-video height so portrait devices don't make the card taller.
    // Portrait thumbnails are pillar-boxed inside a narrow centred column.
    <div className={`w-full aspect-video rounded-lg border border-[var(--card-border)] flex items-center justify-center overflow-hidden ${showImg ? '' : 'bg-[var(--surface)]'}`}>
      {showImg
        ? needsRotate
          ? <div className="h-full aspect-[9/16] overflow-hidden shrink-0 relative">
              <img
                key={`${screenshotId}-${latestFrameAt ?? 0}`}
                src={src}
                alt="Latest screenshot"
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: '177.78%', height: '56.25%',
                  transform: 'translate(-50%, -50%) rotate(90deg)',
                  objectFit: 'cover',
                }}
                onError={() => setErrored(true)}
              />
            </div>
          : portrait
          ? <div className="h-full aspect-[9/16] overflow-hidden shrink-0">
              <img
                key={`${screenshotId}-${latestFrameAt ?? 0}`}
                src={src}
                alt="Latest screenshot"
                className="w-full h-full object-contain"
                onError={() => setErrored(true)}
              />
            </div>
          : <img
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
function LiveViewInCard({ deviceId, onStop, resolution, kind }: { deviceId: string; onStop: () => void; resolution?: string | null | undefined; kind?: string | null | undefined }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const portrait = isPortrait(resolution);
  const needsRotate = portrait && kind !== 'epaper';

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
    // Always aspect-video so portrait live view doesn't make the card taller.
    <div className="relative w-full aspect-video rounded-lg border border-[var(--blue)]/60 overflow-hidden bg-black flex items-center justify-center">
      {imgSrc
        ? needsRotate
          ? <div className="h-full aspect-[9/16] overflow-hidden shrink-0 relative">
              <img src={imgSrc} alt="Live" style={{ position: 'absolute', top: '50%', left: '50%', width: '177.78%', height: '56.25%', transform: 'translate(-50%, -50%) rotate(90deg)', objectFit: 'cover' }} />
            </div>
          : portrait
          ? <div className="h-full aspect-[9/16] overflow-hidden shrink-0">
              <img src={imgSrc} alt="Live" className="w-full h-full object-contain" />
            </div>
          : <img src={imgSrc} alt="Live" className="w-full h-full object-contain" />
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
import ContentPickerModal, { type PickedItem } from '../../components/ContentPickerModal.js';
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
  kind?: 'tv' | 'epaper' | null;
  batteryPct?: number | null;
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

interface DeviceGroupListItem {
  id: string;
  name: string;
  type: string;
  description: string | null;
  videoWallCols: number | null;
  videoWallRows: number | null;
  memberDeviceIds: string[];
}

function VideowallGroupCard({
  group,
  devices,
  onClick,
}: {
  group: DeviceGroupListItem;
  devices: Device[];
  onClick: () => void;
}) {
  const onlineCount = devices.filter((d) => d.status === 'online').length;
  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 flex flex-col gap-3 cursor-pointer hover:border-[var(--blue)]/60 transition-colors"
    >
      {/* Mini preview grid — up to 4 thumbnails */}
      <div className="grid grid-cols-2 gap-1">
        {devices.slice(0, 4).map((d) => (
          <div key={d.id} className="relative">
            <DeviceScreenshot
              deviceId={d.id}
              screenshotId={d.latestScreenshotId}
              latestFrameAt={d.latestFrameAt}
              status={d.status}
              powerState={d.powerState}
            />
            <div className="absolute bottom-0 left-0 right-0 rounded-b-lg px-1 py-0.5 text-[9px] text-white bg-black/50 truncate">
              {d.name}
            </div>
          </div>
        ))}
        {devices.length > 4 && (
          <div className="aspect-video rounded-lg bg-[var(--surface)] flex items-center justify-center text-xs text-[var(--text-muted)]">
            +{devices.length - 4} more
          </div>
        )}
      </div>

      {/* Icon + name */}
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-lg bg-[var(--blue)]/15 text-[var(--blue)] flex items-center justify-center shrink-0">
          <Grid2x2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text)] truncate">{group.name}</p>
          {group.videoWallCols != null && group.videoWallRows != null && (
            <p className="text-xs text-[var(--text-muted)]">
              {group.videoWallCols}&times;{group.videoWallRows} wall
            </p>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="info">Video Wall</Badge>
        <Badge
          tone={
            onlineCount === devices.length
              ? 'success'
              : onlineCount > 0
              ? 'warning'
              : 'neutral'
          }
        >
          {onlineCount}/{devices.length} online
        </Badge>
      </div>

      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] self-end" />
    </div>
  );
}

function SyncGroupCard({
  group,
  devices,
  onClick,
}: {
  group: DeviceGroupListItem;
  devices: Device[];
  onClick: () => void;
}) {
  const onlineCount = devices.filter((d) => d.status === 'online').length;
  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 flex flex-col gap-3 cursor-pointer hover:border-[var(--blue)]/60 transition-colors"
    >
      {/* Mini preview grid — up to 4 thumbnails */}
      <div className="grid grid-cols-2 gap-1">
        {devices.slice(0, 4).map((d) => (
          <div key={d.id} className="relative">
            <DeviceScreenshot
              deviceId={d.id}
              screenshotId={d.latestScreenshotId}
              latestFrameAt={d.latestFrameAt}
              status={d.status}
              powerState={d.powerState}
            />
            <div className="absolute bottom-0 left-0 right-0 rounded-b-lg px-1 py-0.5 text-[9px] text-white bg-black/50 truncate">
              {d.name}
            </div>
          </div>
        ))}
        {devices.length > 4 && (
          <div className="aspect-video rounded-lg bg-[var(--surface)] flex items-center justify-center text-xs text-[var(--text-muted)]">
            +{devices.length - 4} more
          </div>
        )}
      </div>

      {/* Icon + name */}
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center shrink-0">
          <RotateCcw className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text)] truncate">{group.name}</p>
          <p className="text-xs text-[var(--text-muted)]">{devices.length} device{devices.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral" className="text-purple-400 border-purple-500/30 bg-purple-500/10">Sync Group</Badge>
        <Badge
          tone={
            onlineCount === devices.length
              ? 'success'
              : onlineCount > 0
              ? 'warning'
              : 'neutral'
          }
        >
          {onlineCount}/{devices.length} online
        </Badge>
      </div>

      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] self-end" />
    </div>
  );
}

function PairInstructions() {
  const [copied, setCopied] = useState(false);
  const playerUrl = `${window.location.origin}/tizen`;

  function copy() {
    navigator.clipboard.writeText(playerUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Player URL (Tizen / URL Launcher)</p>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <span className="flex-1 font-mono text-xs text-[var(--text)] truncate select-all">{playerUrl}</span>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors text-xs"
            title="Copy URL"
          >
            {copied ? <CheckCheck size={14} className="text-emerald-400" /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [bulkPublishOpen, setBulkPublishOpen] = useState(false);

  const bulkPublishMut = useMutation({
    mutationFn: (item: PickedItem) =>
      api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds: [...selectedItems],
        resourceType: item.type,
        resourceId: item.id,
      }),
    onSuccess: (_data, item) => {
      toast.success(`Published "${item.name}" to ${selectedItems.size} device${selectedItems.size === 1 ? '' : 's'}`);
      setBulkPublishOpen(false);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to publish'),
  });

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices', wsId, selectedTagIds],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}${tagIdsParam}`),
    refetchInterval: 15_000,
  });

  const { data: groups = [] } = useQuery<DeviceGroupListItem[]>({
    queryKey: ['device-groups', wsId],
    queryFn: () => api.get(`/device-groups?workspaceId=${wsId}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
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

            // Split into videowall group cards + sync group cards + ungrouped individual cards
            const groupedDeviceIds = new Set<string>();
            const videowallGroupsHere: Array<{ group: DeviceGroupListItem; members: Device[] }> = [];
            for (const g of groups) {
              if (g.type !== 'videowall') continue;
              const members = sectionDevices.filter((d) => g.memberDeviceIds.includes(d.id));
              if (members.length === 0) continue;
              members.forEach((d) => groupedDeviceIds.add(d.id));
              videowallGroupsHere.push({ group: g, members });
            }
            const syncGroupsHere: Array<{ group: DeviceGroupListItem; members: Device[] }> = [];
            for (const g of groups) {
              if (g.type !== 'sync') continue;
              const members = sectionDevices.filter((d) => g.memberDeviceIds.includes(d.id));
              if (members.length === 0) continue;
              members.forEach((d) => groupedDeviceIds.add(d.id));
              syncGroupsHere.push({ group: g, members });
            }
            const ungroupedDevices = sectionDevices.filter((d) => !groupedDeviceIds.has(d.id));

            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--text)]">
                  {icon}
                  {label}
                  <span className="ml-1 text-[var(--text-muted)] font-normal">({sectionDevices.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {videowallGroupsHere.map(({ group, members }) => (
                    <VideowallGroupCard
                      key={`group-${group.id}`}
                      group={group}
                      devices={members}
                      onClick={() => navigate(`/workspaces/${wsId}/devices/groups/${group.id}`)}
                    />
                  ))}
                  {syncGroupsHere.map(({ group, members }) => (
                    <SyncGroupCard
                      key={`group-${group.id}`}
                      group={group}
                      devices={members}
                      onClick={() => navigate(`/workspaces/${wsId}/devices/groups/${group.id}`)}
                    />
                  ))}
                  {ungroupedDevices.map((device) => (
                    <div
                      key={device.id}
                      className={`group rounded-xl border p-3 flex flex-col gap-2 cursor-pointer transition-colors relative bg-[var(--card)] ${
                        selectedItems.has(device.id)
                          ? 'border-[var(--blue)]'
                          : 'border-[var(--card-border)] hover:border-[var(--blue)]/60'
                      }`}
                      onClick={() => navigate(`/workspaces/${wsId}/devices/${device.id}`)}
                    >
                      {/* Screenshot thumbnail or live view */}
                      {liveViewDeviceId === device.id
                        ? <LiveViewInCard deviceId={device.id} resolution={device.resolution} kind={device.kind} onStop={() => setLiveViewDeviceId(null)} />
                        : <DeviceScreenshot
                            deviceId={device.id}
                            screenshotId={device.latestScreenshotId}
                            latestFrameAt={device.latestFrameAt}
                            status={device.status}
                            powerState={device.powerState}
                            resolution={device.resolution}
                            kind={device.kind}
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
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
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
                        {device.kind === 'epaper' && (
                          <Badge tone="info">E-Paper</Badge>
                        )}
                        {device.kind === 'epaper' && device.batteryPct != null && (
                          <Badge tone={device.batteryPct > 50 ? 'success' : device.batteryPct > 20 ? 'warning' : 'danger'}>
                            <Battery className="w-3 h-3" />{device.batteryPct}%
                          </Badge>
                        )}
                        {isPortrait(device.resolution) && (
                          <Badge tone="neutral">Portrait</Badge>
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
                            {device.publishedTarget.type === 'playlist' ? <Play className="w-3 h-3 text-[var(--success)]" /> : device.publishedTarget.type === 'schedule' ? <CalendarDays className="w-3 h-3 text-[var(--success)]" /> : <Image className="w-3 h-3 text-[var(--success)]" />}
                            <span className="truncate">{device.publishedTarget.name}</span>
                          </div>
                        )}
                        {device.resolution && (
                          <span className="font-mono text-[10px]">{device.resolution}</span>
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
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/40 text-[var(--text-muted)] hover:text-[var(--accent)] text-[10px] font-semibold transition-all"
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
          {/* How-to instructions */}
          <PairInstructions />

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
            onClick={() => setBulkPublishOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold hover:bg-purple-500/25 transition-colors"
          >
            <Play size={12} /> Publish
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

      {bulkPublishOpen && wsId && (
        <ContentPickerModal
          open={bulkPublishOpen}
          onClose={() => setBulkPublishOpen(false)}
          onSelect={(items) => { if (items[0]) bulkPublishMut.mutate(items[0]); }}
          workspaceId={wsId}
          multi={false}
          title={`Publish to ${selectedItems.size} device${selectedItems.size === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}
