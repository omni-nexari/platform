import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import DevicePickerModal, { type PickedDevice } from '../../components/DevicePickerModal.js';
import {
  Plus, RefreshCw, Trash2, MoreVertical, Clock, Layers2,
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

interface SyncPlaylist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── Card ─────────────────────────────────────────────────────────────────────

function SyncPlaylistCard({
  sp,
  onEdit,
  onDelete,
  onPublish,
}: {
  sp: SyncPlaylist;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden cursor-pointer hover:border-[var(--blue)] transition-colors group"
      onClick={onEdit}
    >
      {/* Thumbnail placeholder */}
      <div className="h-36 bg-[var(--bg)] flex items-center justify-center">
        <Layers2 className="w-12 h-12 text-[var(--text-faint)]" />
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{sp.name}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Updated {new Date(sp.updatedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="px-2 py-1 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onPublish(); }}
            >
              Publish
            </button>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                className="p-1.5 rounded hover:bg-[var(--bg)] transition-colors"
                onClick={() => setMenuOpen(o => !o)}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg z-10 min-w-[120px]">
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg)] transition-colors flex items-center gap-2 text-red-400"
                    onClick={() => { setMenuOpen(false); onDelete(); }}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SyncPlaylistsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SyncPlaylist | null>(null);
  const [publishTarget, setPublishTarget] = useState<SyncPlaylist | null>(null);

  const { data: items = [], isLoading } = useQuery<SyncPlaylist[]>({
    queryKey: ['sync-playlists', wsId],
    queryFn: () => api.get(`/sync-playlists?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post('/sync-playlists', { workspaceId: wsId, name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
      setCreateOpen(false);
      setNewName('');
      toast.success('Sync playlist created');
    },
    onError: () => toast.error('Failed to create sync playlist'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/sync-playlists/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
      toast.success('Deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const publishMutation = useMutation({
    mutationFn: async ({ syncPlaylistId, deviceIds }: { syncPlaylistId: string; deviceIds: string[] }) => {
      const group = await api.post<{ id: string }>('/sync-groups', {
        workspaceId: wsId,
        name: publishTarget?.name ?? 'Group',
        syncPlaylistId,
      });
      return api.post(`/sync-groups/${group.id}/members`, { deviceIds });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-groups', wsId] });
      setPublishTarget(null);
      toast.success('Published to devices');
    },
    onError: () => toast.error('Failed to publish'),
  });

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-6">
      <PageHeader
        title="Sync Playlists"
        subtitle="Playlists that play in lockstep across a group of screens"
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> New Sync Playlist
          </button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Layers2 className="w-10 h-10" />}
          title="No sync playlists yet"
          description="Create a sync playlist to play content in lockstep across multiple screens."
          action={
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--blue)] text-white rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" /> New Sync Playlist
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mt-6">
          {items.map(sp => (
            <SyncPlaylistCard
              key={sp.id}
              sp={sp}
              onEdit={() => navigate(`/workspaces/${wsId}/sync-playlists/${sp.id}`)}
              onDelete={() => setDeleteTarget(sp)}
              onPublish={() => setPublishTarget(sp)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)}>
          <ModalHeader title="New Sync Playlist" />
          <ModalBody>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              autoFocus
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm"
              placeholder="e.g. Lobby Loop"
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
        message="This sync playlist will be permanently deleted. Sync groups using it will lose their playlist assignment."
        confirmLabel="Delete"
        onConfirm={() => { if (deleteTarget) { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
        onClose={() => setDeleteTarget(null)}
      />

      {/* Publish — pick devices to form a sync group */}
      {publishTarget && (
        <DevicePickerModal
          open
          title={`Publish "${publishTarget.name}" to screens`}
          confirmLabel="Publish"
          workspaceId={wsId ?? ''}
          multi
          onClose={() => setPublishTarget(null)}
          onSelect={(devices: PickedDevice[]) =>
            publishMutation.mutate({ syncPlaylistId: publishTarget.id, deviceIds: devices.map(d => d.id) })
          }
        />
      )}
    </div>
  );
}
