import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import DevicePickerModal, { type PickedDevice } from '../../components/DevicePickerModal.js';
import {
  Plus, Tv2, Users, Trash2, MoreVertical, UserPlus, UserMinus, Link2,
} from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import {
  EmptyState,
  PageHeader,
  Skeleton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from '../../components/UiPrimitives.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncGroupMember {
  deviceId: string;
  leaderPriority: number;
  device: {
    id: string;
    name: string;
    status: string;
    lastSeen: string | null;
  };
}

interface SyncGroup {
  id: string;
  name: string;
  groupId: number;
  mode: string;
  syncPlaylistId: string | null;
  syncPlaylist: { id: string; name: string } | null;
  members: SyncGroupMember[];
  createdAt: string;
  updatedAt: string;
}

interface SyncPlaylistBrief {
  id: string;
  name: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function modeBadge(mode: string) {
  if (mode === 'native-samsung') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
        Samsung Native
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
      Custom Sync
    </span>
  );
}

function deviceStatusDot(status: string) {
  if (status === 'online') return 'bg-emerald-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-white/20';
}

// ── Group card ────────────────────────────────────────────────────────────────

function SyncGroupCard({
  group,
  onDelete,
  onAddDevices,
  onRemoveDevice,
  onAssignPlaylist,
}: {
  group: SyncGroup;
  onDelete: () => void;
  onAddDevices: () => void;
  onRemoveDevice: (deviceId: string) => void;
  onAssignPlaylist: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate">{group.name}</h3>
            {modeBadge(group.mode)}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Group ID: <span className="font-mono">{group.groupId}</span>
            {' · '}
            {group.members.length} screen{group.members.length !== 1 ? 's' : ''}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
            {group.syncPlaylist ? (
              <span className="text-xs text-[var(--text-muted)] truncate">{group.syncPlaylist.name}</span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignPlaylist(); }}
                className="text-xs text-[var(--blue)] hover:underline"
              >
                Assign sync playlist…
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onAddDevices}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add Screens
          </button>
          <div className="relative">
            <button
              className="p-1.5 rounded hover:bg-[var(--bg)] transition-colors"
              onClick={() => setMenuOpen(o => !o)}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg z-10 min-w-[140px]">
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg)] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onAssignPlaylist(); }}
                >
                  <Link2 className="w-4 h-4" /> Assign Playlist
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg)] transition-colors flex items-center gap-2 text-red-400"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                >
                  <Trash2 className="w-4 h-4" /> Delete Group
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Members list (collapsible) */}
      {group.members.length > 0 && (
        <>
          <button
            className="w-full px-4 pb-2 text-left text-xs text-[var(--text-muted)] flex items-center gap-1 hover:text-[var(--text)] transition-colors"
            onClick={() => setExpanded(o => !o)}
          >
            <Users className="w-3 h-3" />
            {expanded ? 'Hide screens' : `Show ${group.members.length} screen${group.members.length !== 1 ? 's' : ''}`}
          </button>
          {expanded && (
            <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
              {group.members.map(m => (
                <div key={m.deviceId} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${deviceStatusDot(m.device.status)}`} />
                    <span className="truncate">{m.device.name}</span>
                  </div>
                  <button
                    onClick={() => onRemoveDevice(m.deviceId)}
                    className="p-1 rounded hover:bg-red-500/10 text-[var(--text-faint)] hover:text-red-400 transition-colors shrink-0"
                    title="Remove from group"
                  >
                    <UserMinus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SyncGroupsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SyncGroup | null>(null);
  const [addDevicesTarget, setAddDevicesTarget] = useState<SyncGroup | null>(null);
  const [assignPlaylistTarget, setAssignPlaylistTarget] = useState<SyncGroup | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');

  const { data: groups = [], isLoading } = useQuery<SyncGroup[]>({
    queryKey: ['sync-groups', wsId],
    queryFn: () => api.get(`/sync-groups?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const { data: syncPlaylists = [] } = useQuery<SyncPlaylistBrief[]>({
    queryKey: ['sync-playlists', wsId],
    queryFn: () => api.get(`/sync-playlists?workspaceId=${wsId}`),
    enabled: !!wsId && assignPlaylistTarget != null,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post('/sync-groups', { workspaceId: wsId, name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      setCreateOpen(false);
      setNewName('');
      toast.success('Sync group created');
    },
    onError: () => toast.error('Failed to create sync group'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sync-groups/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      toast.success('Deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const addDevicesMutation = useMutation({
    mutationFn: ({ groupId, deviceIds }: { groupId: string; deviceIds: string[] }) =>
      api.post(`/sync-groups/${groupId}/members`, { deviceIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      setAddDevicesTarget(null);
      toast.success('Screens added to group');
    },
    onError: () => toast.error('Failed to add screens'),
  });

  const removeDeviceMutation = useMutation({
    mutationFn: ({ groupId, deviceId }: { groupId: string; deviceId: string }) =>
      api.delete(`/sync-groups/${groupId}/members/${deviceId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      toast.success('Screen removed from group');
    },
    onError: () => toast.error('Failed to remove screen'),
  });

  const assignPlaylistMutation = useMutation({
    mutationFn: ({ groupId, syncPlaylistId }: { groupId: string; syncPlaylistId: string | null }) =>
      api.patch(`/sync-groups/${groupId}`, { syncPlaylistId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      setAssignPlaylistTarget(null);
      toast.success('Sync playlist assigned');
    },
    onError: () => toast.error('Failed to assign playlist'),
  });

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-6">
      <PageHeader
        title="Sync Groups"
        subtitle="Groups of screens that play content in lockstep"
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> New Group
          </button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Tv2 className="w-10 h-10" />}
          title="No sync groups yet"
          description="Create a sync group to keep multiple screens playing in perfect sync."
          action={
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--blue)] text-white rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" /> New Group
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {groups.map(group => (
            <SyncGroupCard
              key={group.id}
              group={group}
              onDelete={() => setDeleteTarget(group)}
              onAddDevices={() => setAddDevicesTarget(group)}
              onRemoveDevice={(deviceId) =>
                removeDeviceMutation.mutate({ groupId: group.id, deviceId })
              }
              onAssignPlaylist={() => {
                setSelectedPlaylistId(group.syncPlaylistId ?? '');
                setAssignPlaylistTarget(group);
              }}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)}>
          <ModalHeader title="New Sync Group" />
          <ModalBody>
            <label className="block text-sm font-medium mb-1">Group name</label>
            <input
              autoFocus
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              placeholder="e.g. Lobby Left Wall"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName); }}
            />
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => setCreateOpen(false)}>Cancel</ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => createMutation.mutate(newName)}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This sync group and all its member assignments will be removed."
        confirmLabel="Delete"
        onConfirm={() => { if (deleteTarget) { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
        onClose={() => setDeleteTarget(null)}
      />

      {/* Add screens to group */}
      {addDevicesTarget && (
        <DevicePickerModal
          open
          title={`Add screens to "${addDevicesTarget.name}"`}
          confirmLabel="Add to Group"
          workspaceId={wsId ?? ''}
          multi
          onClose={() => setAddDevicesTarget(null)}
          onSelect={(devices: PickedDevice[]) =>
            addDevicesMutation.mutate({
              groupId: addDevicesTarget.id,
              deviceIds: devices.map(d => d.id),
            })
          }
        />
      )}

      {/* Assign sync playlist */}
      {assignPlaylistTarget && (
        <Modal onClose={() => setAssignPlaylistTarget(null)}>
          <ModalHeader title="Assign Sync Playlist" />
          <ModalBody>
            <label className="block text-sm font-medium mb-1">Sync playlist</label>
            <select
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              value={selectedPlaylistId}
              onChange={e => setSelectedPlaylistId(e.target.value)}
            >
              <option value="">— None —</option>
              {syncPlaylists.map(sp => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => setAssignPlaylistTarget(null)}>Cancel</ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => {
                if (assignPlaylistTarget) {
                  assignPlaylistMutation.mutate({
                    groupId: assignPlaylistTarget.id,
                    syncPlaylistId: selectedPlaylistId || null,
                  });
                }
              }}
              disabled={assignPlaylistMutation.isPending}
            >
              {assignPlaylistMutation.isPending ? 'Saving…' : 'Save'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
