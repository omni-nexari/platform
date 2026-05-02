import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  ArrowLeft, Monitor, Tv, LayoutGrid, MapPin, Tag, UserPlus, UserMinus,
  Trash2, Link2, Edit2, Check, X,
} from 'lucide-react';
import {
  Badge,
  Skeleton,
} from '../../components/UiPrimitives.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import DevicePickerModal, { type PickedDevice } from '../../components/DevicePickerModal.js';
import VideowallGridEditor from '../../components/VideowallGridEditor.js';

// ── Types ──────────────────────────────────────────────────────────────────

type GroupType = 'sync' | 'videowall' | 'location' | 'tag';

interface DeviceLite {
  id: string;
  name: string;
  status: string;
  lastSeen: string | null;
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function DeviceGroupDetailPage() {
  const { wsId, groupId } = useParams<{ wsId: string; groupId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

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
    enabled: isVideowall && !!wsId,
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
      <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const meta = TYPE_META[group.type];
  const memberList = isSync ? group.syncMembers : group.members;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Back nav */}
      <button
        onClick={() => navigate(`/workspaces/${wsId}/devices/groups`)}
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors w-fit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Device Groups
      </button>

      {/* Header card */}
      <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-lg bg-[var(--bg)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameDraft.trim()) renameMut.mutate(nameDraft.trim());
                      if (e.key === 'Escape') setEditingName(false);
                    }}
                    className="px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-base font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => renameMut.mutate(nameDraft.trim())}
                    disabled={!nameDraft.trim() || renameMut.isPending}
                    className="p-1 rounded hover:bg-[var(--bg)] text-emerald-400"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingName(false)} className="p-1 rounded hover:bg-[var(--bg)] text-[var(--text-muted)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold text-[var(--text)] truncate">{group.name}</h1>
                  <button
                    onClick={() => { setNameDraft(group.name); setEditingName(true); }}
                    className="p-1 rounded hover:bg-[var(--bg)] text-[var(--text-faint)] hover:text-[var(--text)]"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {group.description && (
                  <span className="text-xs text-[var(--text-muted)]">{group.description}</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Videowall grid editor (videowall only) */}
      {isVideowall && (
        <VideowallGridEditor
          group={group}
          workspaceId={wsId ?? ''}
          availableDevices={allDevices}
        />
      )}

      {/* SyncPlay settings (sync only) */}
      {isSync && group.syncGroup && (
        <div className="rounded-xl border p-5 flex flex-col gap-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
              <Tv className="w-4 h-4 text-[var(--text-muted)]" />
              SyncPlay Settings
            </h2>
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              <span>Group ID:</span>
              <span className="font-mono px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)]">
                {group.syncGroup.groupId}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link2 className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
            <div className="text-sm flex-1 min-w-0">
              <span className="text-[var(--text-muted)]">Published playlist: </span>
              {group.syncGroup.syncPlaylistName ? (
                <span className="text-[var(--text)] font-medium">{group.syncGroup.syncPlaylistName}</span>
              ) : (
                <span className="text-[var(--text-faint)] italic">None — publish from the Playlists page</span>
              )}
            </div>
          </div>

          <div className="text-xs text-[var(--text-muted)]">
            Mode: <span className="text-[var(--text)]">{group.syncGroup.mode === 'native-samsung' ? 'Samsung Native SyncPlay' : group.syncGroup.mode}</span>
          </div>
        </div>
      )}

      {/* Members panel — not shown for videowall (grid editor above handles it) */}
      {!isVideowall && (
      <div className="rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="p-5 flex items-center justify-between gap-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold text-[var(--text)]">
            Screens <span className="text-[var(--text-muted)] font-normal ml-1">({memberList.length})</span>
          </h2>
          <button
            onClick={() => setAddPickerOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add Screens
          </button>
        </div>

        {memberList.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            No screens in this group yet. Click <span className="text-[var(--text)]">Add Screens</span> to get started.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {memberList.map((m) => (
              <div key={m.deviceId} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(m.device?.status ?? 'offline')}`} />
                  <span className="truncate text-[var(--text)]">{m.device?.name ?? m.deviceId}</span>
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
                  className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-faint)] hover:text-red-400 transition-colors"
                  title="Remove from group"
                >
                  <UserMinus className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )} {/* end !isVideowall members panel */}

      {/* Modals */}
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
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => deleteMut.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
