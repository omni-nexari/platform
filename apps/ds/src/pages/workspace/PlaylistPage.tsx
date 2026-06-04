import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { useIsProPlan } from '../../lib/modules.js';
import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import BulkTagModal from '../../components/BulkTagModal.js';
import DevicePickerModal from '../../components/DevicePickerModal.js';
import {
  Plus, Layers, Layers2, LayoutGrid, Clock, MoreVertical,
  Copy, Trash2, Play, Check, Monitor, AlertTriangle, Send,
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
  previewContentIds: string[];
  hasExpiredContent: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SyncPlaylist {
  id: string;
  name: string;
  itemCount: number;
  totalDuration: number;
  previewContentIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface VideoWallPlaylist {
  id: string;
  name: string;
  groupId: string | null;
  group: { id: string; name: string; videoWallCols: number | null; videoWallRows: number | null } | null;
  slotCount: number;
  previewContentIds: string[];
  createdAt: string;
  updatedAt: string;
}

type UnifiedPlaylist =
  | (Playlist & { _type: 'general' })
  | (SyncPlaylist & { _type: 'sync' })
  | (VideoWallPlaylist & { _type: 'videowall' });

type TypeFilter = 'all' | 'general' | 'sync' | 'videowall';

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
        {/* Cascade thumbnail strip — up to 4 content thumbnails */}
        {pl.previewContentIds.length > 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-raised)]">
            <div className="flex items-center">
              {pl.previewContentIds.slice(0, 4).map((cid, idx) => (
                <div
                  key={cid}
                  className="relative shrink-0 h-16 w-[72px] rounded-lg overflow-hidden border-2 border-[var(--card)] shadow-md"
                  style={{ marginLeft: idx === 0 ? 0 : -18, zIndex: idx }}
                >
                  <AuthImg
                    itemId={cid}
                    className="w-full h-full object-cover"
                    fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--surface)]"><Layers size={16} className="text-[var(--text-muted)]" /></div>}
                  />
                </div>
              ))}
              {pl.itemCount > 4 && (
                <div
                  className="shrink-0 h-16 w-[42px] rounded-lg flex items-center justify-center bg-[var(--surface)] border-2 border-[var(--card)] shadow-md text-xs font-semibold text-[var(--text-muted)]"
                  style={{ marginLeft: -18, zIndex: 4 }}
                >
                  +{pl.itemCount - 4}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers size={28} className="text-[var(--text-muted)]" />
          </div>
        )}

        {/* Expired content warning */}
        {pl.hasExpiredContent && (
          <div className="ui-media-badge ui-media-badge-warning absolute top-2 left-2 z-20">
            <AlertTriangle size={9} /> Expired
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
          <span className="ui-media-badge ui-media-badge-accent absolute top-2 right-2 z-20">
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

// ── Sync playlist card ─────────────────────────────────────────────────────

function SyncPlaylistCard({ sp, onEdit, onDelete, onPublish }: {
  sp: SyncPlaylist;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
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
      onKeyDown={(e) => e.key === 'Enter' && onEdit()}
      className="ui-entity-card relative flex flex-col cursor-pointer group"
    >
      {/* Thumbnail */}
      <div className="ui-media-frame aspect-video">
        {sp.previewContentIds.length > 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-raised)]">
            <div className="flex items-center">
              {sp.previewContentIds.slice(0, 4).map((cid, idx) => (
                <div
                  key={cid}
                  className="relative shrink-0 h-16 w-[72px] rounded-lg overflow-hidden border-2 border-[var(--card)] shadow-md"
                  style={{ marginLeft: idx === 0 ? 0 : -18, zIndex: idx }}
                >
                  <AuthImg
                    itemId={cid}
                    className="w-full h-full object-cover"
                    fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--surface)]"><Layers2 size={16} className="text-[var(--text-muted)]" /></div>}
                  />
                </div>
              ))}
              {sp.itemCount > 4 && (
                <div
                  className="shrink-0 h-16 w-[42px] rounded-lg flex items-center justify-center bg-[var(--surface)] border-2 border-[var(--card)] shadow-md text-xs font-semibold text-[var(--text-muted)]"
                  style={{ marginLeft: -18, zIndex: 4 }}
                >
                  +{sp.itemCount - 4}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers2 size={28} className="text-[var(--text-muted)]" />
          </div>
        )}

        {/* Sync badge */}
        <span
          className="ui-media-badge absolute top-2 left-2 z-20"
          style={{ background: 'rgba(168,85,247,0.85)', color: 'white' }}
        >
          Sync
        </span>

        {/* Duration overlay */}
        {sp.totalDuration > 0 && (
          <span className="ui-media-badge absolute bottom-2 right-2 z-20">
            {formatDuration(sp.totalDuration)}
          </span>
        )}

        {hovered && (
          <div className="ui-media-hover-overlay">
            <div className="ui-media-hover-play">
              <Play size={16} className="text-white translate-x-0.5" />
            </div>
          </div>
        )}
      </div>

      <div className="ui-entity-card-body px-3 py-3">
        <p className="ui-entity-card-title text-sm truncate" title={sp.name}>
          {sp.name}
        </p>
        <div className="ui-entity-card-meta mt-1">
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Layers2 size={10} />
            {sp.itemCount} {sp.itemCount === 1 ? 'item' : 'items'}
          </span>
          {sp.totalDuration > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Clock size={10} />
              {formatDuration(sp.totalDuration)}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        className={`ui-media-icon-btn absolute top-2 right-2 z-20 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}
      >
        <MoreVertical size={12} />
      </button>

      {menuOpen && (
        <div
          className="absolute top-11 right-2 z-20 rounded-xl shadow-lg border py-1 min-w-[130px]"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { setMenuOpen(false); onEdit(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]">
            Edit
          </button>
          <button onClick={() => { setMenuOpen(false); onPublish(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] flex items-center gap-2">
            <Monitor size={10} /> Publish
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

// ── VideoWall playlist card ───────────────────────────────────────────────

function VideoWallPlaylistCard({ vwp, onEdit, onDelete }: {
  vwp: VideoWallPlaylist;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const cols = vwp.group?.videoWallCols ?? '?';
  const rows = vwp.group?.videoWallRows ?? '?';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      onKeyDown={(e) => e.key === 'Enter' && onEdit()}
      className="ui-entity-card relative flex flex-col cursor-pointer group"
    >
      {/* Thumbnail */}
      <div className="ui-media-frame aspect-video">
        {vwp.previewContentIds.length > 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-raised)]">
            <div className="flex items-center">
              {vwp.previewContentIds.slice(0, 4).map((cid, idx) => (
                <div
                  key={cid}
                  className="relative shrink-0 h-16 w-[72px] rounded-lg overflow-hidden border-2 border-[var(--card)] shadow-md"
                  style={{ marginLeft: idx === 0 ? 0 : -18, zIndex: idx }}
                >
                  <AuthImg
                    itemId={cid}
                    className="w-full h-full object-cover"
                    fallback={<div className="w-full h-full flex items-center justify-center bg-[var(--surface)]"><LayoutGrid size={16} className="text-[var(--text-muted)]" /></div>}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <LayoutGrid size={28} className="text-[var(--text-muted)]" />
          </div>
        )}

        {/* Video Wall badge */}
        <span
          className="ui-media-badge absolute top-2 left-2 z-20"
          style={{ background: 'rgba(20,184,166,0.9)', color: 'white' }}
        >
          Video Wall
        </span>

        {hovered && (
          <div className="ui-media-hover-overlay">
            <div className="ui-media-hover-play">
              <LayoutGrid size={16} className="text-white" />
            </div>
          </div>
        )}
      </div>

      <div className="ui-entity-card-body px-3 py-3">
        <p className="ui-entity-card-title text-sm truncate" title={vwp.name}>
          {vwp.name}
        </p>
        <div className="ui-entity-card-meta mt-1">
          {vwp.group ? (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <LayoutGrid size={10} />
              {vwp.group.name} · {cols}×{rows}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <AlertTriangle size={10} />
              No wall group
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            {vwp.slotCount} cell{vwp.slotCount !== 1 ? 's' : ''} assigned
          </span>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        className={`ui-media-icon-btn absolute top-2 right-2 z-20 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}
      >
        <MoreVertical size={12} />
      </button>

      {menuOpen && (
        <div
          className="absolute top-11 right-2 z-20 rounded-xl shadow-lg border py-1 min-w-[130px]"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { setMenuOpen(false); onEdit(); }}
            className="w-full text-left px-4 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]">
            Edit
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
  const isProPlan = useIsProPlan();

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [confirmDuplicateId, setConfirmDuplicateId] = useState<string | null>(null);
  const [confirmDuplicateName, setConfirmDuplicateName] = useState('');
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'general' | 'sync' | 'videowall' | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [confirmSyncDeleteId, setConfirmSyncDeleteId] = useState<string | null>(null);
  const [confirmSyncDeleteName, setConfirmSyncDeleteName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [syncPublishTarget, setSyncPublishTarget] = useState<SyncPlaylist | null>(null);

  const currentFilters = { selectedTagIds };

  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';

  const { data: playlistData, isLoading } = useQuery<{ items: Playlist[]; total: number }>({
    queryKey: ['playlists', wsId, selectedTagIds],
    queryFn: () => api.get(`/playlists?workspaceId=${wsId!}${tagIdsParam}`),
    enabled: !!wsId,
  });
  const generalItems = playlistData?.items ?? [];

  const { data: syncPlaylistData, isLoading: isLoadingSync } = useQuery<SyncPlaylist[]>({
    queryKey: ['sync-playlists', wsId],
    queryFn: () => api.get<SyncPlaylist[]>(`/sync-playlists?workspaceId=${wsId!}`),
    enabled: !!wsId && isProPlan,
  });
  const syncItems = syncPlaylistData ?? [];

  const { data: videowallPlaylistData, isLoading: isLoadingVideowall } = useQuery<VideoWallPlaylist[]>({
    queryKey: ['videowall-playlists', wsId],
    queryFn: () => api.get<VideoWallPlaylist[]>(`/videowall-playlists?workspaceId=${wsId!}`),
    enabled: !!wsId && isProPlan,
  });
  const videowallItems = videowallPlaylistData ?? [];

  // Merge into a single, type-aware list — sorted by updatedAt desc so the most
  // recently touched playlist always lands at the top.
  const items: UnifiedPlaylist[] = (() => {
    const merged: UnifiedPlaylist[] = [
      ...generalItems.map((p) => ({ ...p, _type: 'general' as const })),
      ...syncItems.map((p) => ({ ...p, _type: 'sync' as const })),
      ...videowallItems.map((p) => ({ ...p, _type: 'videowall' as const })),
    ];
    if (typeFilter !== 'all') {
      return merged.filter((it) => it._type === typeFilter);
    }
    merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return merged;
  })();

  const createMut = useMutation({
    mutationFn: (name: string) => api.post<Playlist>('/playlists', { workspaceId: wsId, name }),
    onSuccess: (pl) => {
      toast.success('Playlist created');
      setCreateOpen(false);
      setCreateKind(null);
      setNewName('');
      void queryClient.invalidateQueries({ queryKey: ['playlists', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-playlists', wsId] });
      navigate(`/workspaces/${wsId!}/playlist/${pl.id}`);
    },
    onError: () => toast.error('Failed to create playlist'),
  });

  const createSyncMut = useMutation({
    mutationFn: (name: string) =>
      api.post<SyncPlaylist>('/sync-playlists', { workspaceId: wsId, name }),
    onSuccess: (sp) => {
      toast.success('Sync playlist created');
      setCreateOpen(false);
      setCreateKind(null);
      setNewName('');
      void queryClient.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
      navigate(`/workspaces/${wsId!}/playlist/sync/${sp.id}`);
    },
    onError: () => toast.error('Failed to create sync playlist'),
  });

  const deleteSyncMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sync-playlists/${id}`),
    onSuccess: () => {
      toast.success('Sync playlist deleted');
      setConfirmSyncDeleteId(null);
      setConfirmSyncDeleteName('');
      void queryClient.invalidateQueries({ queryKey: ['sync-playlists', wsId] });
    },
    onError: () => toast.error('Failed to delete sync playlist'),
  });

  const [confirmVideowallDeleteId, setConfirmVideowallDeleteId] = useState<string | null>(null);
  const [confirmVideowallDeleteName, setConfirmVideowallDeleteName] = useState('');

  const deleteVideowallMut = useMutation({
    mutationFn: (id: string) => api.delete(`/videowall-playlists/${id}`),
    onSuccess: () => {
      toast.success('Video wall playlist deleted');
      setConfirmVideowallDeleteId(null);
      setConfirmVideowallDeleteName('');
      void queryClient.invalidateQueries({ queryKey: ['videowall-playlists', wsId] });
    },
    onError: () => toast.error('Failed to delete video wall playlist'),
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

  const publishSelection = items.filter((item) => item._type === 'general' && selectedItems.has(item.id)) as Array<Playlist & { _type: 'general' }>;
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

  interface SyncGroup { id: string; name: string; syncPlaylist?: { id: string; name: string } | null; }
  const { data: syncGroups = [] } = useQuery<SyncGroup[]>({
    queryKey: ['sync-groups', wsId],
    queryFn: () => api.get<SyncGroup[]>(`/sync-groups?workspaceId=${wsId!}`),
    enabled: !!wsId && !!syncPublishTarget,
  });

  const [selectedSyncGroupId, setSelectedSyncGroupId] = useState<string | null>(null);

  const publishSyncMut = useMutation({
    mutationFn: ({ groupId, syncPlaylistId }: { groupId: string; syncPlaylistId: string }) =>
      api.patch(`/sync-groups/${groupId}`, { syncPlaylistId }),
    onSuccess: () => {
      toast.success('Sync playlist published to group');
      setSyncPublishTarget(null);
      setSelectedSyncGroupId(null);
      void queryClient.invalidateQueries({ queryKey: ['sync-groups', wsId] });
    },
    onError: () => toast.error('Failed to publish sync playlist'),
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

        {/* Type filter — All / General / Sync / Video Wall (Sync + VideoWall only for Pro) */}
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {(['all', 'general', ...(isProPlan ? ['sync', 'videowall'] : [])] as TypeFilter[]).map((t) => {
            const label = t === 'all' ? 'All' : t === 'general' ? 'General' : t === 'sync' ? 'Sync' : 'Video Wall';
            const count = t === 'all'
              ? generalItems.length + syncItems.length + videowallItems.length
              : t === 'general' ? generalItems.length
              : t === 'sync' ? syncItems.length
              : videowallItems.length;
            const active = typeFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: active ? 'var(--accent)' : 'var(--surface-raised)',
                  color: active ? 'white' : 'var(--text-muted)',
                  border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                }}
              >
                {label}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {(isLoading || isLoadingSync || isLoadingVideowall) ? (
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
            {items.map((it) => it._type === 'videowall' ? (
              <VideoWallPlaylistCard
                key={`videowall-${it.id}`}
                vwp={it}
                onEdit={() => navigate(`/workspaces/${wsId!}/playlist/videowall/${it.id}`)}
                onDelete={() => {
                  setConfirmVideowallDeleteId(it.id);
                  setConfirmVideowallDeleteName(it.name);
                }}
              />
            ) : it._type === 'sync' ? (
              <SyncPlaylistCard
                key={`sync-${it.id}`}
                sp={it}
                onEdit={() => navigate(`/workspaces/${wsId!}/playlist/sync/${it.id}`)}
                onDelete={() => {
                  setConfirmSyncDeleteId(it.id);
                  setConfirmSyncDeleteName(it.name);
                }}
                onPublish={() => {
                  setSelectedSyncGroupId(null);
                  setSyncPublishTarget(it);
                }}
              />
            ) : (
              <PlaylistCard
                key={`general-${it.id}`}
                pl={it}
                onEdit={() => navigate(`/workspaces/${wsId!}/playlist/${it.id}`)}
                onClone={() => {
                  setConfirmDuplicateId(it.id);
                  setConfirmDuplicateName(it.name);
                }}
                onDelete={() => {
                  setConfirmName(it.name);
                  setConfirmId(it.id);
                }}
                checked={selectedItems.has(it.id)}
                onCheck={() => setSelectedItems((prev) => { const next = new Set(prev); next.has(it.id) ? next.delete(it.id) : next.add(it.id); return next; })}
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

      {/* Sync playlist → publish to sync group picker */}
      {syncPublishTarget && (
        <Modal onClose={() => { setSyncPublishTarget(null); setSelectedSyncGroupId(null); }} size="sm">
          <ModalHeader
            title={`Publish "${syncPublishTarget.name}"`}
            onClose={() => { setSyncPublishTarget(null); setSelectedSyncGroupId(null); }}
          />
          <ModalBody>
            <p className="text-sm text-[var(--text-muted)] mb-3">
              Select the sync group to publish this playlist to. All screens in the group will play it in lockstep.
            </p>
            {syncGroups.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] italic">No sync groups found. Create one from the Device Groups page.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {syncGroups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedSyncGroupId(g.id)}
                    className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${selectedSyncGroupId === g.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}
                  >
                    <p className="text-sm font-medium text-[var(--text)]">{g.name}</p>
                    {g.syncPlaylist && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Current: {g.syncPlaylist.name}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => { setSyncPublishTarget(null); setSelectedSyncGroupId(null); }}>
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => {
                if (syncPublishTarget && selectedSyncGroupId) {
                  publishSyncMut.mutate({ groupId: selectedSyncGroupId, syncPlaylistId: syncPublishTarget.id });
                }
              }}
              disabled={!selectedSyncGroupId || publishSyncMut.isPending}
            >
              {publishSyncMut.isPending ? 'Publishing…' : 'Publish'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      {/* Create dialog — step 1: pick type, step 2: enter name */}
      {createOpen && createKind === null && (
        <Modal onClose={() => setCreateOpen(false)} size="md">
          <ModalHeader title="New Playlist" onClose={() => setCreateOpen(false)} />
          <ModalBody>
            <p className="text-sm text-[var(--text-muted)] mb-4">Choose the playlist type.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setCreateKind('general')}
                className="text-left rounded-xl border p-4 transition-colors hover:border-[var(--accent)]"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <Layers size={22} className="text-[var(--accent)] mb-2" />
                <div className="text-sm font-semibold text-[var(--text)]">General Playlist</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  Standard rotation with images, video, and webpages.
                </div>
              </button>
              <button
                onClick={() => setCreateKind('sync')}
                disabled={!isProPlan}
                className="text-left rounded-xl border p-4 transition-colors hover:border-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                title={!isProPlan ? 'Upgrade to Pro to use Sync Playlists' : undefined}
              >
                <Layers2 size={22} className="mb-2" style={{ color: isProPlan ? 'rgb(168,85,247)' : 'var(--text-muted)' }} />
                <div className="text-sm font-semibold text-[var(--text)]">Sync Playlist</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {isProPlan ? 'Frame-aligned playback across multiple screens.' : 'Pro plan required.'}
                </div>
              </button>
              <button
                onClick={() => {
                  if (!isProPlan) return;
                  setCreateOpen(false);
                  navigate(`/workspaces/${wsId!}/playlist/videowall/new`);
                }}
                disabled={!isProPlan}
                className="text-left rounded-xl border p-4 transition-colors hover:border-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                title={!isProPlan ? 'Upgrade to Pro to use Video Wall Playlists' : undefined}
              >
                <LayoutGrid size={22} className="mb-2" style={{ color: isProPlan ? 'rgb(20,184,166)' : 'var(--text-muted)' }} />
                <div className="text-sm font-semibold text-[var(--text)]">Video Wall Playlist</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {isProPlan ? 'Assign different content to each screen in a video wall.' : 'Pro plan required.'}
                </div>
              </button>
            </div>
          </ModalBody>
          <ModalFooter className="modal-footer-plain">
            <ModalSecondaryButton onClick={() => setCreateOpen(false)}>
              Cancel
            </ModalSecondaryButton>
          </ModalFooter>
        </Modal>
      )}

      {createOpen && createKind !== null && (
        <Modal onClose={() => { setCreateOpen(false); setCreateKind(null); }} size="sm">
          <ModalHeader
            title={createKind === 'sync' ? 'New Sync Playlist' : 'New Playlist'}
            onClose={() => { setCreateOpen(false); setCreateKind(null); }}
          />
          <ModalBody>
            <input
              autoFocus
              type="text"
              placeholder={createKind === 'sync' ? 'Sync playlist name…' : 'Playlist name…'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  if (createKind === 'sync') createSyncMut.mutate(newName.trim());
                  else createMut.mutate(newName.trim());
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
          </ModalBody>
          <ModalFooter className="modal-footer-plain">
            <ModalSecondaryButton onClick={() => setCreateKind(null)}>
              Back
            </ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => {
                if (createKind === 'sync') createSyncMut.mutate(newName.trim());
                else createMut.mutate(newName.trim());
              }}
              disabled={!newName.trim() || createMut.isPending || createSyncMut.isPending}
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

      <ConfirmDialog
        open={confirmSyncDeleteId !== null}
        title="Delete Sync Playlist"
        message={`Delete "${confirmSyncDeleteName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteSyncMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmSyncDeleteId) deleteSyncMut.mutate(confirmSyncDeleteId);
        }}
        onClose={() => {
          setConfirmSyncDeleteId(null);
          setConfirmSyncDeleteName('');
        }}
      />

      <ConfirmDialog
        open={confirmVideowallDeleteId !== null}
        title="Delete Video Wall Playlist"
        message={`Delete "${confirmVideowallDeleteName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteVideowallMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmVideowallDeleteId) deleteVideowallMut.mutate(confirmVideowallDeleteId);
        }}
        onClose={() => {
          setConfirmVideowallDeleteId(null);
          setConfirmVideowallDeleteName('');
        }}
      />
    </div>
  );
}
