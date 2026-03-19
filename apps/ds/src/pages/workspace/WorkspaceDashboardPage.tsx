import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { ClaimDeviceSchema } from '@signage/shared';
import type { ClaimDeviceInput } from '@signage/shared';
import { Monitor, Plus, Wifi, WifiOff, Clock, ChevronRight, Cpu, Check } from 'lucide-react';
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
} from '../../components/UiPrimitives.js';

interface Device {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  assignedTags?: AssignedTag[];
  lastSeen: string | null;
  playerVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  timezone: string;
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
  const queryClient = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);

  const currentFilters = { selectedTagIds };

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices', wsId, selectedTagIds],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}${tagIdsParam}`),
    refetchInterval: 30_000, // poll for live status
  });

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

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Devices"
        subtitle={`${devices.length} display${devices.length !== 1 ? 's' : ''} in this workspace`}
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

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-[var(--card)] border border-[var(--border)] animate-pulse" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={<Monitor className="w-12 h-12" />}
          title="No devices yet"
          description="Pair a Samsung display to start showing content"
          action={<button onClick={() => setPairOpen(true)} className="workspace-page-action">Pair first device</button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {devices.map((device) => (
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
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(58,123,255,0.24),_transparent_58%),linear-gradient(180deg,rgba(20,24,33,0.45),rgba(10,12,18,0.92))]" />
                <span className="ui-media-badge ui-media-badge-accent absolute top-9 left-2 z-20">Device</span>
                <span className={`ui-media-badge absolute top-2 right-2 z-20 ${currentStatusMeta.mediaTone}`}>
                  {currentStatusMeta.label}
                </span>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/8 border border-white/10 flex items-center justify-center backdrop-blur-sm">
                    {device.status === 'online' ? (
                      <Wifi className="w-8 h-8 text-emerald-400" />
                    ) : (
                      <WifiOff className="w-8 h-8 text-[var(--text-muted)]" />
                    )}
                  </div>
                </div>
                <div className="ui-media-badge absolute bottom-2 right-2 z-20">
                  <Clock size={9} />
                  {device.lastSeen ? formatDistanceToNow(device.lastSeen) : 'Never connected'}
                </div>
                <div className="ui-media-icon-btn absolute top-11 right-2 z-20">
                  <ChevronRight className="w-4 h-4" />
                </div>
                    </>
                  );
                })()}
              </div>

              <div className="ui-entity-card-body">
                <h3 className="ui-entity-card-title truncate mb-1">{device.name}</h3>
                <StatusBadge status={device.status} />

                <div className="ui-entity-card-meta mt-3">
                  {device.playerVersion ? (
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      v{device.playerVersion}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Monitor className="w-3 h-3" />
                      Display ready
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
