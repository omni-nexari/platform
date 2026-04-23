import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import BulkTagModal from '../../components/BulkTagModal.js';
import DevicePickerModal from '../../components/DevicePickerModal.js';
import {
  Plus, Layers, Clock, MoreVertical,
  Copy, Trash2, Play, Check, Monitor,
} from 'lucide-react';
import AuthImg from '../../components/AuthImg.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import SmartViewsBar from '../../components/SmartViewsBar.js';
import TagFilterBar from '../../components/TagFilterBar.js';
import {
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

// ── Types ──────────────────────────────────────────────────────────────────

interface Playlist {
  id: string;
  name: string;
  description: string | null;
  assignedTags?: AssignedTag[];
  loop: boolean;
  totalDuration: number;
  itemCount: number;
  thumbnailContentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec === 0) return '0s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// ── Playlist card ──────────────────────────────────────────────────────────

function PlaylistCard({
  pl, onEdit, onClone, onDelete, checked, onCheck,
}: {
  pl: Playlist;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  checked: boolean;
  onCheck: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      onKeyDown={e => e.key === 'Enter' && onEdit()}
      className="ui-entity-card relative flex flex-col cursor-pointer group"
    >
      {/* Selection checkbox — outside ui-media-frame so overflow:hidden doesn't interfere */}
      {(hovered || checked) && (
        <div
          onClick={(e) => { e.stopPropagation(); onCheck(); }}
          className="absolute top-2 left-2 z-30 w-5 h-5 rounded-md flex items-center justify-center cursor-pointer transition-colors"
          style={{ background: checked ? 'var(--accent)' : 'rgba(0,0,0,0.55)', border: '1.5px solid rgba(255,255,255,0.3)' }}
        >
          {checked && <Check size={11} className="text-white" />}
        </div>
      )}

      {/* Thumbnail */}
      <div className="ui-media-frame aspect-video">
        {pl.thumbnailContentId ? (
          <AuthImg
            itemId={pl.thumbnailContentId}
            className="w-full h-full object-cover"
            fallback={<div className="w-full h-full flex items-center justify-center"><Layers size={28} className="text-[var(--text-muted)]" /></div>}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers size={28} className="text-[var(--text-muted)]" />
          </div>
        )}

        {/* Duration overlay */}
        {pl.totalDuration > 0 && (
          <span className="ui-media-badge absolute bottom-2 right-2 z-20">
            {formatDuration(pl.totalDuration)}
          </span>
        )}

        {/* Loop badge */}
        {pl.loop && (
          <span className="ui-media-badge ui-media-badge-accent absolute top-2 left-2 z-20">
            Loop
          </span>
        )}

        {/* Play hover overlay */}
        {hovered && (
          <div className="ui-media-hover-overlay">
            <div className="ui-media-hover-play">
              <Play size={16} className="text-white translate-x-0.5" />
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="ui-entity-card-body px-3 py-3">
        <p className="ui-entity-card-title text-sm truncate" title={pl.name}>
          {pl.name}
        </p>
        <div className="ui-entity-card-meta mt-1">
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Layers size={10} />
            {pl.itemCount} {pl.itemCount === 1 ? 'item' : 'items'}
          </span>
          {pl.totalDuration > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Clock size={10} />
              {formatDuration(pl.totalDuration)}
            </span>
          )}
        </div>
        <div className="mt-2">
          <AssignedTagPills tags={pl.assignedTags} />
        </div>
      </div>

      {/* Context menu button */}
      <button
        onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
        className={`ui-media-icon-btn absolute top-2 right-2 z-20 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}
      >
        <MoreVertical size={12} />
      </button>

      {menuOpen && (
        <div
          className="absolute top-11 right-2 z-20 rounded-xl shadow-lg border py-1 min-w-[130px]"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { setMenuOpen(false); onEdit(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]">
            Edit
          </button>
          <button onClick={() => { setMenuOpen(false); onClone(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] flex items-center gap-2">
            <Copy size={10} /> Duplicate
          </button>
          <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          <button onClick={() => { setMenuOpen(false); onDelete(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2">
            <Trash2 size={10} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PlaylistPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [confirmDuplicateId, setConfirmDuplicateId] = useState<string | null>(null);
  const [confirmDuplicateName, setConfirmDuplicateName] = useState('');
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);

  const currentFilters = { selectedTagIds };

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: playlistData, isLoading } = useQuery<{ items: Playlist[]; total: number }>({
    queryKey: ['playlists', wsId, selectedTagIds],
    queryFn: () => api.get(`/playlists?workspaceId=${wsId!}${tagIdsParam}`),
    enabled: !!wsId,
  });
  const items = playlistData?.items ?? [];

  const createMut = useMutation({
    mutationFn: (name: string) => api.post<Playlist>('/playlists', { workspaceId: wsId, name }),
    onSuccess: (pl) => {
      toast.success('Playlist created');
      setCreateOpen(false);
      setNewName('');
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
      navigate(`/workspaces/${wsId!}/playlist/${pl.id}`);
    },
    onError: () => toast.error('Failed to create playlist'),
  });

  const cloneMut = useMutation({
    mutationFn: (id: string) => api.post<Playlist>(`/playlists/${id}/clone`),
    onSuccess: () => {
      toast.success('Playlist duplicated');
      setConfirmDuplicateId(null);
      setConfirmDuplicateName('');
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
    },
    onError: () => toast.error('Failed to duplicate'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}`),
    onSuccess: () => {
      toast.success('Playlist deleted');
      setConfirmId(null);
      setConfirmName('');
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
    },
    onError: () => toast.error('Failed to delete'),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.delete(`/playlists/${id}`))),
    onSuccess: (_data, ids) => {
      toast.success(`Deleted ${ids.length} playlist(s)`);
      setConfirmBulkDelete(false);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
    },
    onError: () => toast.error('Failed to delete some playlists'),
  });

  const publishSelection = items.filter((item) => selectedItems.has(item.id));
  const publishCandidate = publishSelection.length === 1 ? publishSelection[0] : null;

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!publishCandidate) throw new Error('Select exactly one playlist to publish');
      return api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds,
        resourceType: 'playlist',
        resourceId: publishCandidate.id,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setPublishPickerOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to publish playlist'),
  });

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        <PageHeader
          icon={<Layers size={22} />}
          title="Playlists"
          subtitle={`${items.length} playlist${items.length !== 1 ? 's' : ''}`}
          action={(
            <button onClick={() => setCreateOpen(true)} className="workspace-page-action">
              <Plus size={14} />
              New Playlist
            </button>
          )}
        />

        {wsId && (
          <div className="mb-5">
            <SmartViewsBar
              workspaceId={wsId}
              entityType="playlist"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Layers size={40} />}
            title="No playlists yet"
            description="Create a playlist to start arranging content rotations."
            action={<button onClick={() => setCreateOpen(true)} className="workspace-page-action"><Plus size={14} /> New Playlist</button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {items.map(pl => (
              <PlaylistCard
                key={pl.id}
                pl={pl}
                onEdit={() => navigate(`/workspaces/${wsId!}/playlist/${pl.id}`)}
                onClone={() => {
                  setConfirmDuplicateId(pl.id);
                  setConfirmDuplicateName(pl.name);
                }}
                onDelete={() => {
                  setConfirmName(pl.name);
                  setConfirmId(pl.id);
                }}
                checked={selectedItems.has(pl.id)}
                onCheck={() => setSelectedItems((prev) => { const next = new Set(prev); next.has(pl.id) ? next.delete(pl.id) : next.add(pl.id); return next; })}
              />
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
              <Check size={12} /> Apply Tags
            </button>
            <button
              onClick={() => setPublishPickerOpen(true)}
              disabled={selectedItems.size !== 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--blue)]/15 border border-[var(--blue)]/30 text-[var(--blue)] text-xs font-semibold hover:bg-[var(--blue)]/25 disabled:opacity-40 transition-colors"
            >
              <Monitor size={12} /> Publish
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
      </div>

      {bulkTagOpen && wsId && (
        <BulkTagModal
          workspaceId={wsId}
          entityType="playlist"
          entityIds={[...selectedItems]}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setSelectedItems(new Set());
            void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
          }}
        />
      )}

      {publishPickerOpen && wsId && publishCandidate && (
        <DevicePickerModal
          open={publishPickerOpen}
          onClose={() => setPublishPickerOpen(false)}
          onSelect={(devices) => publishMut.mutate(devices.map((device) => device.id))}
          workspaceId={wsId}
          title={`Publish ${publishCandidate.name}`}
          confirmLabel={publishMut.isPending ? 'Publishing…' : 'Publish'}
        />
      )}

      {/* Create dialog */}
      {createOpen && (
        <Modal onClose={() => setCreateOpen(false)} size="sm">
          <ModalHeader title="New Playlist" onClose={() => setCreateOpen(false)} />
          <ModalBody>
              <input
              autoFocus
              type="text"
              placeholder="Playlist name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(newName.trim()); }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
          </ModalBody>
          <ModalFooter className="modal-footer-plain">
              <ModalSecondaryButton onClick={() => setCreateOpen(false)}>
                Cancel
              </ModalSecondaryButton>
              <ModalPrimaryButton
                onClick={() => createMut.mutate(newName.trim())}
                disabled={!newName.trim() || createMut.isPending}
              >
                Create
              </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Playlists"
        message={`Delete ${selectedItems.size} playlist(s)? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={bulkDeleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => bulkDeleteMut.mutate([...selectedItems])}
        onClose={() => setConfirmBulkDelete(false)}
      />

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete Playlist"
        message={`Delete "${confirmName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmId) deleteMut.mutate(confirmId);
        }}
        onClose={() => {
          setConfirmId(null);
          setConfirmName('');
        }}
      />

      <ConfirmDialog
        open={confirmDuplicateId !== null}
        title="Duplicate Playlist"
        message={`Create a copy of "${confirmDuplicateName}"?`}
        confirmLabel="Duplicate"
        confirmPendingLabel="Duplicating…"
        variant="primary"
        icon={<Copy size={16} />}
        isConfirming={cloneMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmDuplicateId) cloneMut.mutate(confirmDuplicateId);
        }}
        onClose={() => {
          setConfirmDuplicateId(null);
          setConfirmDuplicateName('');
        }}
      />
    </div>
  );
}
