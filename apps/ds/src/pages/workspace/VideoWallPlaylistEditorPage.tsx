import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  ArrowLeft, ArrowRight, Save, Loader2,
  Check, X, Plus, LayoutGrid, Send,
} from 'lucide-react';
import { computeColWidths, computeRowHeights, type WallMember } from '@signage/shared';
import { Badge, ActionButton } from '../../components/UiPrimitives.js';
import AuthImg from '../../components/AuthImg.js';
import ContentPickerModal from '../../components/ContentPickerModal.js';
import type { PickedItem } from '../../components/ContentPickerModal.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlotState {
  contentId: string;
  contentName: string;
  contentType: string;
  thumbnailContentId: string;
  objectFit: 'cover' | 'contain' | 'fill';
}

interface WallGroupListItem {
  id: string;
  name: string;
  type: string;
  videoWallCols: number | null;
  videoWallRows: number | null;
  memberDeviceIds: string[];
}

interface WallGroupMember {
  id: string;
  deviceId: string;
  positionCol: number | null;
  positionRow: number | null;
  nativeWidthPx: number | null;
  nativeHeightPx: number | null;
}

interface WallGroupDetail {
  id: string;
  name: string;
  type: string;
  videoWallCols: number | null;
  videoWallRows: number | null;
  members: WallGroupMember[];
}

interface ExistingPlaylist {
  id: string;
  name: string;
  groupId: string | null;
  slots: Array<{
    positionCol: number;
    positionRow: number;
    contentId: string | null;
    objectFit: string;
    content: { id: string; name: string; type: string } | null;
  }>;
}

const stepNames = ['Select Wall', 'Assign Content'];
const FIT_CYCLE: Array<SlotState['objectFit']> = ['cover', 'contain', 'fill'];

// ── Wall cell subcomponent ─────────────────────────────────────────────────────

function WallCell({
  slot,
  onPickContent,
  onClear,
  onCycleObjectFit,
}: {
  slot: SlotState | null;
  onPickContent: () => void;
  onClear: () => void;
  onCycleObjectFit: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  if (!slot) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onPickContent}
        onKeyDown={(e) => e.key === 'Enter' && onPickContent()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative flex items-center justify-center cursor-pointer select-none"
        style={{
          border: '2px dashed',
          borderColor: hovered ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.04)',
          transition: 'border-color 0.15s',
        }}
      >
        <Plus
          size={20}
          style={{ color: hovered ? 'var(--accent)' : 'rgba(255,255,255,0.35)' }}
        />
      </div>
    );
  }

  const fitClass =
    slot.objectFit === 'contain' ? 'object-contain' :
    slot.objectFit === 'fill'    ? 'object-fill'    : 'object-cover';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPickContent}
      onKeyDown={(e) => e.key === 'Enter' && onPickContent()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative overflow-hidden cursor-pointer select-none"
      style={{ background: '#1a1a1a' }}
    >
      {/* Thumbnail */}
      <AuthImg
        itemId={slot.thumbnailContentId}
        alt={slot.contentName}
        className={`absolute inset-0 w-full h-full ${fitClass}`}
      />

      {/* Hover overlay */}
      {hovered && (
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      )}

      {/* Content name – bottom strip */}
      {hovered && (
        <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-black/75 text-[9px] text-white truncate pointer-events-none">
          {slot.contentName}
        </div>
      )}

      {/* Clear button – top right */}
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors z-10"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        >
          <X size={10} />
        </button>
      )}

      {/* Object-fit toggle – bottom right */}
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onCycleObjectFit(); }}
          className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[8px] font-semibold text-white transition-colors z-10"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          title="Cycle fit mode: cover → contain → fill"
        >
          {slot.objectFit}
        </button>
      )}
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function VideoWallPlaylistEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const [step, setStep] = useState(0);
  const [name, setName] = useState('New Video Wall Playlist');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : (id ?? null));
  const [pickerCell, setPickerCell] = useState<{ col: number; row: number } | null>(null);

  // ── Load existing playlist ────────────────────────────────────────────────

  const { data: existingPlaylist } = useQuery<ExistingPlaylist>({
    queryKey: ['videowall-playlist', id],
    queryFn: () => api.get<ExistingPlaylist>(`/videowall-playlists/${id}`),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (!existingPlaylist) return;
    setName(existingPlaylist.name);
    setSelectedGroupId(existingPlaylist.groupId);
    const slotMap: Record<string, SlotState> = {};
    for (const s of existingPlaylist.slots) {
      if (s.contentId && s.content) {
        slotMap[`${s.positionCol},${s.positionRow}`] = {
          contentId: s.contentId,
          contentName: s.content.name,
          contentType: s.content.type,
          thumbnailContentId: s.contentId,
          objectFit: (s.objectFit as SlotState['objectFit']) ?? 'cover',
        };
      }
    }
    setSlots(slotMap);
    if (existingPlaylist.groupId) setStep(1);
  }, [existingPlaylist]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: allGroups = [] } = useQuery<WallGroupListItem[]>({
    queryKey: ['device-groups', wsId],
    queryFn: () => api.get<WallGroupListItem[]>(`/device-groups?workspaceId=${wsId}`),
    enabled: !!wsId,
  });
  const wallGroups = allGroups.filter((g) => g.type === 'videowall');

  const { data: groupDetail } = useQuery<WallGroupDetail>({
    queryKey: ['device-group-detail', selectedGroupId],
    queryFn: () => api.get<WallGroupDetail>(`/device-groups/${selectedGroupId}`),
    enabled: !!selectedGroupId,
  });

  // ── Canvas geometry ───────────────────────────────────────────────────────

  const cols = groupDetail?.videoWallCols ?? 2;
  const rows = groupDetail?.videoWallRows ?? 2;

  const wallMembersForLayout: WallMember[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = groupDetail?.members.find(
        (mem) => mem.positionCol === c && mem.positionRow === r,
      );
      wallMembersForLayout.push({
        positionCol: c,
        positionRow: r,
        nativeWidthPx:  m?.nativeWidthPx  ?? 1920,
        nativeHeightPx: m?.nativeHeightPx ?? 1080,
      });
    }
  }
  const colWidths  = computeColWidths(wallMembersForLayout, cols);
  const rowHeights = computeRowHeights(wallMembersForLayout, rows);
  const totalW = colWidths.reduce((s, w)  => s + w, 0) || 1;
  const totalH = rowHeights.reduce((s, h) => s + h, 0) || 1;
  const colFrs = colWidths.map((w)  => ((w / totalW) * 100).toFixed(1) + '%').join(' ');
  const rowFrs = rowHeights.map((h) => ((h / totalH) * 100).toFixed(1) + '%').join(' ');

  const filledCount = Object.keys(slots).length;
  const totalCells  = cols * rows;
  const canAdvance  = step === 0 ? !!selectedGroupId : true;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async () => {
      let plId = savedId;
      const slotPayload = Object.entries(slots).map(([key, s]) => {
        const [col, row] = key.split(',').map(Number);
        return {
          positionCol: col,
          positionRow: row,
          contentId:   s.contentId,
          objectFit:   s.objectFit,
        };
      });

      if (!plId) {
        const created = await api.post<{ id: string }>('/videowall-playlists', {
          workspaceId: wsId,
          name,
          groupId: selectedGroupId,
        });
        plId = created.id;
      } else {
        await api.patch(`/videowall-playlists/${plId}`, {
          name,
          groupId: selectedGroupId,
        });
      }

      await api.put(`/videowall-playlists/${plId}/slots`, slotPayload);
      return plId;
    },
    onSuccess: (plId) => {
      setSavedId(plId);
      qc.invalidateQueries({ queryKey: ['videowall-playlists', wsId] });
      toast.success('Saved');
      if (isNew) {
        navigate(`/workspaces/${wsId}/playlist/videowall/${plId}`, { replace: true });
      }
    },
    onError: () => toast.error('Save failed'),
  });

  const publishMut = useMutation({
    mutationFn: () =>
      api.post<{ updated: number; pushed: number; skipped: number }>(
        `/videowall-playlists/${savedId}/publish`,
      ),
    onSuccess: ({ pushed, skipped }) => {
      const msg = `Published — ${pushed} device${pushed !== 1 ? 's' : ''} notified` +
        (skipped > 0 ? `, ${skipped} offline` : '');
      toast.success(msg);
    },
    onError: () => toast.error('Publish failed'),
  });

  // ── Slot helpers ──────────────────────────────────────────────────────────

  function handleContentPicked(items: PickedItem[]) {
    const item = items[0];
    if (!item || !pickerCell) return;
    const key = `${pickerCell.col},${pickerCell.row}`;
    setSlots((prev) => ({
      ...prev,
      [key]: {
        contentId:          item.id,
        contentName:        item.name,
        contentType:        item.contentType ?? item.type,
        thumbnailContentId: item.thumbnailContentId ?? item.id,
        objectFit:          prev[key]?.objectFit ?? 'cover',
      },
    }));
    setPickerCell(null);
  }

  function clearCell(col: number, row: number) {
    setSlots((prev) => {
      const next = { ...prev };
      delete next[`${col},${row}`];
      return next;
    });
  }

  function cycleObjectFit(col: number, row: number) {
    setSlots((prev) => {
      const key = `${col},${row}`;
      const s = prev[key];
      if (!s) return prev;
      const nextFit: SlotState['objectFit'] = FIT_CYCLE[(FIT_CYCLE.indexOf(s.objectFit) + 1) % FIT_CYCLE.length] ?? 'cover';
      return { ...prev, [key]: { ...s, objectFit: nextFit } };
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg)]">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/playlist`)}
            className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold bg-transparent text-[var(--text)] focus:outline-none focus:bg-[var(--surface)] px-2 py-1 rounded min-w-0 max-w-xs"
          />
          <Badge tone="info">Video Wall</Badge>
        </div>

        {/* Step pills */}
        <div className="flex items-center gap-1 shrink-0">
          {stepNames.map((n, i) => (
            <button
              key={n}
              onClick={() => { if (i === 1 && !selectedGroupId) return; setStep(i); }}
              disabled={i === 1 && !selectedGroupId}
              className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 ${
                i === step
                  ? 'bg-sky-500 text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
              }`}
            >
              {i + 1}. {n}
            </button>
          ))}
        </div>

        {/* Nav buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {step > 0 && (
            <ActionButton onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={14} /> Back
            </ActionButton>
          )}

          {step === 0 ? (
            <ActionButton onClick={() => setStep(1)} disabled={!canAdvance}>
              Next <ArrowRight size={14} />
            </ActionButton>
          ) : (
            <>
              <ActionButton
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Save size={14} />}
                Save
              </ActionButton>

              {savedId && (
                <ActionButton
                  tone="primary"
                  onClick={() => publishMut.mutate()}
                  disabled={publishMut.isPending || !selectedGroupId}
                >
                  {publishMut.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Send size={14} />}
                  Publish to Wall
                </ActionButton>
              )}
            </>
          )}
        </div>
      </header>

      {/* ── Step 0: Select Wall Group ────────────────────────────────────── */}
      {step === 0 && (
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-[var(--text-muted)] mb-6">
            Select the video wall device group this playlist is designed for.
          </p>

          {wallGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <LayoutGrid size={40} className="opacity-30" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm text-[var(--text-muted)]">No video wall device groups found.</p>
              <p className="text-xs text-[var(--text-muted)]">
                Create a <strong>videowall</strong> type device group first, then return here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
              {wallGroups.map((g) => {
                const isSelected = selectedGroupId === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className="text-left rounded-xl transition-all relative"
                    style={{
                      background: 'var(--surface)',
                      border: `${isSelected ? 2 : 1}px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      padding: isSelected ? '15px' : '16px', // compensate 1px border diff
                    }}
                  >
                    {isSelected && (
                      <span
                        className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--accent)' }}
                      >
                        <Check size={11} className="text-white" />
                      </span>
                    )}
                    <LayoutGrid size={20} className="mb-2" style={{ color: 'var(--accent)' }} />
                    <div className="text-sm font-semibold text-[var(--text)] pr-7">{g.name}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {g.videoWallCols ?? '?'}×{g.videoWallRows ?? '?'} wall
                      {' · '}
                      {g.memberDeviceIds.length} device{g.memberDeviceIds.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: Assign Content ────────────────────────────────────────── */}
      {step === 1 && (
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-[var(--text-muted)] mb-4">
            Click a cell to assign content.{' '}
            <span className="font-medium text-[var(--text)]">{filledCount}</span>
            {' '}of{' '}
            <span className="font-medium text-[var(--text)]">{totalCells}</span>
            {' '}cells assigned.
          </p>

          {/* Proportional canvas */}
          <div
            className="mx-auto overflow-hidden rounded-lg"
            style={{
              maxWidth: 900,
              aspectRatio: `${totalW} / ${totalH}`,
              background: '#0e0e0e',
              border: '2px solid var(--border)',
            }}
          >
            <div
              className="grid w-full h-full"
              style={{ gridTemplateColumns: colFrs, gridTemplateRows: rowFrs, gap: '2px' }}
            >
              {Array.from({ length: rows }, (_, r) =>
                Array.from({ length: cols }, (_, c) => (
                  <WallCell
                    key={`${c},${r}`}
                    slot={slots[`${c},${r}`] ?? null}
                    onPickContent={() => setPickerCell({ col: c, row: r })}
                    onClear={() => clearCell(c, r)}
                    onCycleObjectFit={() => cycleObjectFit(c, r)}
                  />
                )),
              )}
            </div>
          </div>

          {/* Group hint */}
          {groupDetail && (
            <p className="text-xs text-[var(--text-muted)] text-center mt-3">
              Wall group: <span className="text-[var(--text)]">{groupDetail.name}</span>
              {' '}·{' '}
              {groupDetail.members.length} device{groupDetail.members.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* ── Content picker modal ──────────────────────────────────────────── */}
      {pickerCell && (
        <ContentPickerModal
          open
          onClose={() => setPickerCell(null)}
          onSelect={handleContentPicked}
          workspaceId={wsId!}
          multi={false}
          allowedTypes={['content']}
          title="Select Content for Cell"
        />
      )}
    </div>
  );
}
