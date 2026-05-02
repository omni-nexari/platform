import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { api, buildApiUrl } from '../../lib/api.js';
import { ClaimDeviceSchema } from '@signage/shared';
import type { ClaimDeviceInput } from '@signage/shared';
import { Monitor, Plus, WifiOff, Clock, ChevronRight, Cpu, Check, RotateCcw } from 'lucide-react';
import { formatDistanceToNow } from '../utils/time.js';
import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import BulkTagModal from '../../components/BulkTagModal.js';
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
    online: { label: 'Online', tone: 'success', mediaTone: 'ui-media-badge-success' },
    offline: { label: 'Offline', tone: 'neutral', mediaTone: '' },
    unclaimed: { label: 'Unclaimed', tone: 'warning', mediaTone: 'ui-media-badge-warning' },
    error: { label: 'Error', tone: 'danger', mediaTone: 'ui-media-badge-danger' },
  } as const;
  const s = map[status] ?? map.offline;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export default function WorkspaceDashboardPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    (searchParams.get('tagIds') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  );
  const [selectedStatus, setSelectedStatus] = useState<'all' | Device['status']>(
    (searchParams.get('status') as 'all' | Device['status'] | null) ?? 'all',
  );
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);

  const currentFilters = { selectedTagIds };

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices', wsId, selectedTagIds],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}${tagIdsParam}`),
    refetchInterval: 30_000, // poll for live status
  });

  const filteredDevices = selectedStatus === 'all'
    ? devices
    : devices.filter((device) => device.status === selectedStatus);

  useEffect(() => {
    const requestedTagIds = (searchParams.get('tagIds') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const requestedStatus = (searchParams.get('status') as 'all' | Device['status'] | null) ?? 'all';

    if (requestedTagIds.join(',') !== selectedTagIds.join(',')) {
      setSelectedTagIds(requestedTagIds);
    }
    if (requestedStatus !== selectedStatus) {
      setSelectedStatus(requestedStatus);
    }
  }, [searchParams, selectedStatus, selectedTagIds]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (selectedTagIds.length > 0) nextParams.set('tagIds', selectedTagIds.join(','));
    else nextParams.delete('tagIds');
    if (selectedStatus !== 'all') nextParams.set('status', selectedStatus);
    else nextParams.delete('status');

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, selectedStatus, selectedTagIds, setSearchParams]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClaimDeviceInput>({
    resolver: zodResolver(ClaimDeviceSchema),
    defaultValues: { workspaceId: wsId ?? '' },
  });

  const claimDevice = useMutation({
    mutationFn: (data: ClaimDeviceInput) =>
      api.post('/devices/pair/claim', { ...data, code: data.code.toUpperCase() }),
    onSuccess: () => {
      toast.success('Device paired successfully');
      reset({ workspaceId: wsId ?? '' });
      setPairOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Pairing failed'),
  });

  const unpublishDevices = useMutation({
    mutationFn: (deviceIds: string[]) => api.post('/devices/unpublish', { workspaceId: wsId, deviceIds }),
    onSuccess: (_data, deviceIds) => {
      toast.success(`Removed published override from ${deviceIds.length} device${deviceIds.length === 1 ? '' : 's'}`);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to unpublish devices'),
  });

  const selectedDevices = filteredDevices.filter((device) => selectedItems.has(device.id));
  const hasSelectedPublishedTarget = selectedDevices.some((device) => !!device.publishedTarget);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Devices"
        subtitle={`${filteredDevices.length} display${filteredDevices.length !== 1 ? 's' : ''} in this workspace`}
        action={(
          <button onClick={() => setPairOpen(true)} className="workspace-page-action">
            <Plus className="w-4 h-4" />
            Pair Device
          </button>
        )}
      />

      {wsId && (
        <div className="mb-5">
          <SmartViewsBar
            workspaceId={wsId}
            entityType="device"
            currentFilters={currentFilters}
            onApplyFilters={(filters) => {
              const next = filters as Partial<typeof currentFilters>;
              setSelectedTagIds(Array.isArray(next.selectedTagIds) ? next.selectedTagIds.filter((value): value is string => typeof value === 'string') : []);
            }}
          />
        </div>
      )}

      {wsId && (
        <div className="mb-5">
          <TagFilterBar
            workspaceId={wsId}
            selectedTagIds={selectedTagIds}
            onTagIdsChange={setSelectedTagIds}
          />
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {(['all', 'online', 'offline', 'error', 'unclaimed'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setSelectedStatus(status)}
            className={`ui-filter-chip ${selectedStatus === status ? 'ui-filter-chip-active' : ''}`}
          >
            {status === 'all' ? 'All statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : filteredDevices.length === 0 ? (
        <EmptyState
          icon={<Monitor className="w-12 h-12" />}
          title={selectedStatus === 'all' ? 'No devices yet' : `No ${selectedStatus} devices`}
          description={selectedStatus === 'all' ? 'Pair a Samsung display to start showing content' : 'Adjust filters or choose another workspace status slice.'}
          action={<button onClick={() => setPairOpen(true)} className="workspace-page-action">Pair first device</button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDevices.map((device) => (
            <button
              key={device.id}
              onClick={() => navigate(`/workspaces/${wsId}/devices/${device.id}`)}
              className="ui-entity-card group text-left flex flex-col"
            >
              <div className="ui-media-frame aspect-video">
                {(() => {
                  const statusMeta = {
                    online: { label: 'Online', mediaTone: 'ui-media-badge-success' },
                    offline: { label: 'Offline', mediaTone: '' },
                    unclaimed: { label: 'Unclaimed', mediaTone: 'ui-media-badge-warning' },
                    error: { label: 'Error', mediaTone: 'ui-media-badge-danger' },
                  } as const;

                  const currentStatusMeta = statusMeta[device.status] ?? statusMeta.offline;

                  return (
                    <>
                <div
                  role="checkbox"
                  aria-checked={selectedItems.has(device.id)}
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItems((prev) => {
                      const next = new Set(prev);
                      next.has(device.id) ? next.delete(device.id) : next.add(device.id);
                      return next;
                    });
                  }}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.click(); } }}
                  className="absolute top-2 left-2 z-30 w-5 h-5 rounded-md flex items-center justify-center transition-colors cursor-pointer"
                  style={{ background: selectedItems.has(device.id) ? 'var(--accent)' : 'rgba(0,0,0,0.55)', border: '1.5px solid rgba(255,255,255,0.3)' }}
                >
                  {selectedItems.has(device.id) && <Check className="w-3 h-3 text-white" />}
                </div>
                {/* Thumbnail */}
                {device.latestScreenshotId && (
                  <img
                    key={`${device.latestScreenshotId}-${device.latestFrameAt ?? 0}`}
                    src={buildApiUrl(`/devices/${device.id}/screenshots/${device.latestScreenshotId}${device.latestFrameAt ? `?t=${device.latestFrameAt}` : ''}`)}
                    alt="Last screenshot"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                {/* Scrim over thumbnail */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/30" />
                <span className={`ui-media-badge absolute top-2 right-2 z-20 ${currentStatusMeta.mediaTone}`}>
                  {currentStatusMeta.label}
                </span>
                {/* Content/playlist badge + name over thumbnail */}
                {device.publishedTarget && (
                  <div className="absolute bottom-8 left-2 right-2 z-20 flex items-center gap-1.5 min-w-0">
                    <span className="ui-media-badge ui-media-badge-accent shrink-0">{device.publishedTarget.type}</span>
                    <span className="text-white text-[11px] font-medium truncate drop-shadow">{device.publishedTarget.name}</span>
                  </div>
                )}
                {!device.publishedTarget && (
                  <div className="absolute bottom-8 left-2 z-20">
                    <span className="text-white/40 text-[11px]">No content assigned</span>
                  </div>
                )}
                {device.status !== 'online' && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="w-16 h-16 rounded-2xl bg-white/8 border border-white/10 flex items-center justify-center backdrop-blur-sm">
                      <WifiOff className="w-8 h-8 text-[var(--text-muted)]" />
                    </div>
                  </div>
                )}
                <div className="ui-media-badge absolute bottom-2 right-2 z-20">
                  <Clock size={9} />
                  {device.lastSeen ? formatDistanceToNow(device.lastSeen) : 'Never connected'}
                </div>
                <div className="ui-media-icon-btn absolute top-2 left-10 z-20">
                  <ChevronRight className="w-4 h-4" />
                </div>
                    </>
                  );
                })()}
              </div>

              <div className="ui-entity-card-body">
                <h3 className="ui-entity-card-title truncate mb-1">{device.name}</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={device.status} />
                  {device.powerState != null && (
                    <Badge tone={device.powerState === 'on' ? 'success' : device.powerState === 'standby' ? 'warning' : 'neutral'}>
                      Power {device.powerState}
                    </Badge>
                  )}
                </div>

                <div className="ui-entity-card-meta mt-3 flex-wrap gap-y-1">
                  {device.playerVersion && (
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      v{device.playerVersion}
                    </span>
                  )}
                  {device.ipAddress && (
                    <span className="flex items-center gap-1 font-mono">
                      <Monitor className="w-3 h-3" />
                      {device.ipAddress}
                    </span>
                  )}
                  {device.macAddress && (
                    <span className="flex items-center gap-1 font-mono">
                      {device.macAddress}
                    </span>
                  )}
                  {device.serialNumber && (
                    <span className="flex items-center gap-1 font-mono">
                      S/N: {device.serialNumber}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <AssignedTagPills tags={device.assignedTags} />
                </div>
              </div>
            </button>
          ))}
        </div>
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
            <Check className="w-3 h-3" /> Apply Tags
          </button>
          <button
            onClick={() => unpublishDevices.mutate([...selectedItems])}
            disabled={!hasSelectedPublishedTarget || unpublishDevices.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Unpublish
          </button>
        </div>
      )}

      {bulkTagOpen && wsId && (
        <BulkTagModal
          workspaceId={wsId}
          entityType="device"
          entityIds={[...selectedItems]}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setSelectedItems(new Set());
            void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
          }}
        />
      )}

      {/* Pair Device Modal */}
      {pairOpen && (
        <Modal onClose={() => { setPairOpen(false); reset({ workspaceId: wsId ?? '' }); }} size="sm">
          <ModalHeader
            title="Pair a Device"
            subtitle="Turn on your Samsung display and enter the 6-character code shown on screen."
            onClose={() => { setPairOpen(false); reset({ workspaceId: wsId ?? '' }); }}
          />
          <ModalBody>
            <form onSubmit={handleSubmit((d) => claimDevice.mutate(d))} className="space-y-4">
              <input type="hidden" {...register('workspaceId')} />

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Pairing Code
                </label>
                <input
                  {...register('code')}
                  placeholder="AB3X7K"
                  maxLength={6}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono uppercase tracking-widest text-center focus:outline-none focus:border-[var(--blue)]"
                  style={{ letterSpacing: '0.3em' }}
                />
                {errors.code && (
                  <p className="text-red-400 text-xs mt-1">{errors.code.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Display Name <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                </label>
                <input
                  {...register('name')}
                  placeholder="Lobby Screen"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                />
              </div>

              <ModalFooter className="modal-footer-plain px-0 pb-0">
                <ModalSecondaryButton
                  type="button"
                  onClick={() => { setPairOpen(false); reset({ workspaceId: wsId ?? '' }); }}
                  className="flex-1"
                >
                  Cancel
                </ModalSecondaryButton>
                <ModalPrimaryButton
                  type="submit"
                  disabled={isSubmitting || claimDevice.isPending}
                  className="flex-1"
                >
                  {claimDevice.isPending ? 'Pairing…' : 'Pair Device'}
                </ModalPrimaryButton>
              </ModalFooter>
            </form>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
