import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, buildApiUrl } from '../../lib/api.js';
import {
  ArrowLeft, Monitor, Tv, LayoutGrid, MapPin, Tag, UserPlus, UserMinus,
  Trash2, Link2, Edit2, Check, X, Settings2,
} from 'lucide-react';
import {
  Badge,
  Skeleton,
} from '../../components/UiPrimitives.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import DevicePickerModal, { type PickedDevice } from '../../components/DevicePickerModal.js';
import { DeviceDetailContent } from './DeviceDetailPage.js';
import VideowallGridEditor from '../../components/VideowallGridEditor.js';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type GroupType = 'sync' | 'videowall' | 'location' | 'tag';

interface DeviceLite {
  id: string;
  name: string;
  status: string;
  lastSeen: string | null;
  latestScreenshotId: string | null;
  latestFrameAt: number | null;
  modelName: string | null;
  ipAddress: string | null;
}

// â”€â”€ Full-width device tile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DeviceTile({
  device,
  selected,
  onClick,
}: {
  device: DeviceLite;
  selected: boolean;
  onClick: () => void;
}) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [device.latestScreenshotId, device.latestFrameAt]);

  const showImg = !!device.latestScreenshotId && !errored;
  const src = showImg
    ? buildApiUrl(
        `/devices/${device.id}/screenshots/${device.latestScreenshotId}` +
        (device.latestFrameAt ? `?t=${device.latestFrameAt}` : ''),
      )
    : '';

  const dot =
    device.status === 'online' ? 'bg-emerald-400'
    : device.status === 'error' ? 'bg-red-400'
    : 'bg-white/20';

  return (
    <button
      onClick={onClick}
      className={[
        'flex flex-col rounded-xl border overflow-hidden transition-all text-left min-w-0 w-full',
        selected
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
          : 'border-[var(--border)] hover:border-[var(--accent)]/60',
      ].join(' ')}
      style={{ background: 'var(--surface)' }}
    >
      {/* Screenshot */}
      <div
        className={[
          'w-full aspect-video flex items-center justify-center overflow-hidden',
          showImg ? '' : 'bg-[var(--bg)]',
        ].join(' ')}
      >
        {showImg ? (
          <img
            key={`${device.latestScreenshotId}-${device.latestFrameAt ?? 0}`}
            src={src}
            alt="Screenshot"
            className="w-full h-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <Monitor className="w-8 h-8 text-[var(--text-muted)] opacity-20" />
        )}
      </div>
      {/* Label */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs font-medium text-[var(--text)] truncate">{device.name}</span>
      </div>
    </button>
  );
}

interface DeviceGroupMember {
  groupId: string;
  deviceId: string;
  position: number;
  positionCol: number | null;
  positionRow: number | null;
  colSpan: number | null;
  rowSpan: number | null;
  tileRotation: string | null;
  nativeWidthPx: number | null;
  nativeHeightPx: number | null;
  device: DeviceLite | null;
}

interface SyncMember {
  deviceId: string;
  leaderPriority: number;
  tileCol: number;
  tileRow: number;
  device: DeviceLite | null;
}

interface SyncGroupHydrated {
  id: string;
  groupId: number;
  mode: string;
  syncPlaylistId: string | null;
  syncPlaylistName: string | null;
}

interface DeviceGroupDetail {
  id: string;
  name: string;
  type: GroupType;
  description: string | null;
  workspaceId: string | null;
  syncGroupId: string | null;
  videoWallCols: number | null;
  videoWallRows: number | null;
  bezelTopMm: number | null;
  bezelRightMm: number | null;
  bezelBottomMm: number | null;
  bezelLeftMm: number | null;
  members: DeviceGroupMember[];
  syncGroup: SyncGroupHydrated | null;
  syncMembers: SyncMember[];
}

const TYPE_META: Record<GroupType, { label: string; icon: React.ReactNode; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
  sync: { label: 'Sync', icon: <Monitor className="w-4 h-4" />, tone: 'info' },
  videowall: { label: 'Video Wall', icon: <LayoutGrid className="w-4 h-4" />, tone: 'success' },
  location: { label: 'Location', icon: <MapPin className="w-4 h-4" />, tone: 'neutral' },
  tag: { label: 'Tag Group', icon: <Tag className="w-4 h-4" />, tone: 'warning' },
};

function statusDot(status: string) {
  if (status === 'online') return 'bg-emerald-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-white/20';
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function DeviceGroupDetailPage() {
  const { wsId, groupId } = useParams<{ wsId: string; groupId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const { data: group, isLoading } = useQuery<DeviceGroupDetail>({
    queryKey: ['device-group', groupId],
    queryFn: () => api.get(`/device-groups/${groupId}`),
    enabled: !!groupId,
  });

  const isSync = group?.type === 'sync';
  const isVideowall = group?.type === 'videowall';
  const syncGroupId = group?.syncGroup?.id ?? null;

  // For videowall grid editor: load all workspace devices as assignment options
  const { data: allDevices = [] } = useQuery<DeviceLite[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const renameMut = useMutation({
    mutationFn: (name: string) => api.patch(`/device-groups/${groupId}`, { name }),
    onSuccess: () => {
      toast.success('Group renamed');
      setEditingName(false);
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
      void qc.invalidateQueries({ queryKey: ['device-groups', wsId] });
    },
    onError: () => toast.error('Failed to rename'),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/device-groups/${groupId}`),
    onSuccess: () => {
      toast.success('Group deleted');
      void qc.invalidateQueries({ queryKey: ['device-groups', wsId] });
      navigate(`/workspaces/${wsId}/devices/groups`);
    },
    onError: () => toast.error('Failed to delete'),
  });

  // For non-sync groups: PUT replaces the full member list
  const replaceMembersMut = useMutation({
    mutationFn: (members: Array<{ deviceId: string; position?: number }>) =>
      api.put(`/device-groups/${groupId}/members`, members),
    onSuccess: () => {
      toast.success('Members updated');
      setAddPickerOpen(false);
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
      void qc.invalidateQueries({ queryKey: ['device-groups', wsId] });
    },
    onError: () => toast.error('Failed to update members'),
  });

  // For sync groups: dedicated /sync-groups endpoints
  const addSyncMembersMut = useMutation({
    mutationFn: (deviceIds: string[]) =>
      api.post(`/sync-groups/${syncGroupId}/members`, { deviceIds }),
    onSuccess: () => {
      toast.success('Screens added');
      setAddPickerOpen(false);
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
    },
    onError: () => toast.error('Failed to add screens'),
  });

  const removeSyncMemberMut = useMutation({
    mutationFn: (deviceId: string) =>
      api.delete(`/sync-groups/${syncGroupId}/members/${deviceId}`),
    onSuccess: () => {
      toast.success('Screen removed');
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
    },
    onError: () => toast.error('Failed to remove'),
  });

  if (isLoading || !group) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const meta = TYPE_META[group.type];
  const memberList = isSync ? group.syncMembers : group.members;
  const memberIds = new Set(memberList.map((m) => m.deviceId));
  const memberDevices = allDevices.filter((d) => memberIds.has(d.id));

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">

      {/* â”€â”€ Back nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <button
        onClick={() => navigate(`/workspaces/${wsId}/devices/groups`)}
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Device Groups
      </button>

      {/* â”€â”€ Group header card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="rounded-xl border px-5 py-4 flex items-center gap-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <span className="text-[var(--text-muted)] shrink-0">{meta.icon}</span>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameDraft.trim()) renameMut.mutate(nameDraft.trim());
                  if (e.key === 'Escape') setEditingName(false);
                }}
                className="px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg)] text-sm font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <button onClick={() => renameMut.mutate(nameDraft.trim())} disabled={!nameDraft.trim()} className="text-emerald-400 p-0.5">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setEditingName(false)} className="text-[var(--text-muted)] p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-semibold text-[var(--text)] truncate">{group.name}</span>
              <button
                onClick={() => { setNameDraft(group.name); setEditingName(true); }}
                className="p-0.5 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors shrink-0"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAddPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add Screen
          </button>
          <button
            onClick={() => setConfigOpen((v) => !v)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
              configOpen
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]',
            ].join(' ')}
          >
            <Settings2 className="w-3.5 h-3.5" /> Configure
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete group"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* â”€â”€ Device tile grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {memberDevices.length === 0 ? (
        <div
          className="rounded-xl border border-dashed flex items-center justify-center gap-3 py-12"
          style={{ borderColor: 'var(--border)' }}
        >
          <Monitor className="w-8 h-8 text-[var(--text-muted)] opacity-20" />
          <div className="text-center">
            <p className="text-sm text-[var(--text-muted)]">No screens in this group</p>
            <button onClick={() => setAddPickerOpen(true)} className="mt-1 text-xs text-[var(--accent)] hover:underline">
              Add screens â†’
            </button>
          </div>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 220px))' }}
        >
          {memberDevices.map((d) => (
            <DeviceTile
              key={d.id}
              device={d}
              selected={selectedDeviceId === d.id}
              onClick={() => setSelectedDeviceId(selectedDeviceId === d.id ? null : d.id)}
            />
          ))}
        </div>
      )}

      {/* â”€â”€ Configure panel (inline collapsible) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {configOpen && (
        <div className="rounded-xl border flex flex-col gap-4 p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>

          {isVideowall && (
            <VideowallGridEditor
              group={group}
              workspaceId={wsId ?? ''}
              availableDevices={allDevices}
            />
          )}

          {isSync && group.syncGroup && (
            <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                  <Tv className="w-4 h-4 text-[var(--text-muted)]" /> SyncPlay Settings
                </h3>
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  ID: <span className="font-mono px-1 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]">{group.syncGroup.groupId}</span>
                </span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <Link2 className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="text-[var(--text-muted)]">Playlist: </span>
                  {group.syncGroup.syncPlaylistName
                    ? <span className="text-[var(--text)] font-medium">{group.syncGroup.syncPlaylistName}</span>
                    : <span className="text-[var(--text-faint)] italic">None â€” publish from Playlists</span>
                  }
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Mode: <span className="text-[var(--text)]">{group.syncGroup.mode === 'native-samsung' ? 'Samsung Native SyncPlay' : group.syncGroup.mode}</span>
              </p>
            </div>
          )}

          {!isVideowall && (
            <div className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
              <div className="p-3 flex items-center justify-between gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  Screens <span className="text-[var(--text-muted)] font-normal">({memberList.length})</span>
                </h3>
              </div>
              {memberList.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-muted)] text-center">No screens yet.</p>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {memberList.map((m) => (
                    <div key={m.deviceId} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(m.device?.status ?? 'offline')}`} />
                        <span className="truncate text-[var(--text)] text-xs">{m.device?.name ?? m.deviceId}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (isSync) {
                            removeSyncMemberMut.mutate(m.deviceId);
                          } else {
                            const remaining = group.members.filter((x) => x.deviceId !== m.deviceId);
                            replaceMembersMut.mutate(remaining.map((x, idx) => ({ deviceId: x.deviceId, position: idx })));
                          }
                        }}
                        className="p-1 rounded hover:bg-red-500/10 text-[var(--text-faint)] hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-red-500/20 p-4" style={{ background: 'var(--bg)' }}>
            <h3 className="text-xs font-semibold text-red-400 mb-2">Danger Zone</h3>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Group
            </button>
          </div>
        </div>
      )}

      {/* â”€â”€ Device detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {selectedDeviceId ? (
        <DeviceDetailContent deviceId={selectedDeviceId} wsId={wsId} embedded />
      ) : (
        <div
          className="rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 py-16 text-center"
          style={{ borderColor: 'var(--border)' }}
        >
          <Monitor className="w-10 h-10 text-[var(--text-muted)] opacity-20" />
          <p className="text-sm text-[var(--text-muted)]">Click a screen above to view its details</p>
        </div>
      )}

      {/* â”€â”€ Modals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {addPickerOpen && wsId && (
        <DevicePickerModal
          open
          title={`Add screens to "${group.name}"`}
          confirmLabel="Add to Group"
          workspaceId={wsId}
          multi
          onClose={() => setAddPickerOpen(false)}
          onSelect={(picked: PickedDevice[]) => {
            if (isSync) {
              addSyncMembersMut.mutate(picked.map((d) => d.id));
            } else {
              const existing = group.members.map((m) => ({ deviceId: m.deviceId, position: m.position }));
              const existingIds = new Set(existing.map((m) => m.deviceId));
              const merged = [
                ...existing,
                ...picked.filter((d) => !existingIds.has(d.id)).map((d, idx) => ({
                  deviceId: d.id,
                  position: existing.length + idx,
                })),
              ];
              replaceMembersMut.mutate(merged);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${group.name}"?`}
        message={isSync
          ? 'This sync group, all its screens, and any in-progress SyncPlay sessions will be removed.'
          : 'This group and all its screen assignments will be removed.'}
        confirmLabel="Delete"
        confirmPendingLabel="Deletingâ€¦"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => deleteMut.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
