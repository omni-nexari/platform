import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, Plus, Trash2, Film, Image, ListVideo, X, Clock } from 'lucide-react';
import AuthImg from './AuthImg.js';
import { ActionButton } from './UiPrimitives.js';
import ContentPickerModal, { type PickedItem } from './ContentPickerModal.js';
import { api } from '../lib/api.js';

export type ZoneSource =
  | { type: 'playlist'; playlistId: string; playlistName?: string | undefined; sourceDuration?: number | null | undefined }
  | { type: 'content'; contentId: string; contentName?: string | undefined; contentType?: string | undefined; sourceDuration?: number | null | undefined }
  | { type: 'empty' };

export interface ZoneConfig {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  label?: string | null;
  playlistId?: string | null; // backward compat
  source?: ZoneSource | null;
  syncGroup?: string | null; // intra-device sync group label (e.g. 'A', 'B')
  fitMode?: 'fill' | 'contain' | null; // fill = stretch to zone, contain = letterbox (default)
}

interface Props {
  initialZones: ZoneConfig[];
  workspaceId: string;
  saving: boolean;
  onSave: (zones: ZoneConfig[]) => void;
}

type DragState = {
  zoneId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  rect: ZoneConfig['rect'];
};

const CANVAS_W = 640;
const CANVAS_H = 360;
// DEVICE_W / DEVICE_H: the coordinate space zones are authored in.
// Exported so the editor page can include them in saved metadata.
export const DEVICE_W = 1920;
export const DEVICE_H = 1080;
const MAX_ZONES = 8;

const SYNC_GROUPS = [
  { id: 'A', label: 'A', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { id: 'B', label: 'B', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { id: 'C', label: 'C', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { id: 'D', label: 'D', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
] as const;

function syncGroupMeta(groupId?: string | null) {
  return SYNC_GROUPS.find((g) => g.id === groupId) ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeZone(index: number): ZoneConfig {
  const width = DEVICE_W / 2;
  const height = DEVICE_H / 2;
  const positions = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];
  const pos = positions[index % positions.length] ?? { x: 0, y: 0 };
  return {
    id: crypto.randomUUID(),
    rect: { x: pos.x, y: pos.y, width, height },
    playlistId: null,
    source: null,
  };
}

function sourceLabel(zone: ZoneConfig): string {
  if (zone.source?.type === 'playlist') return zone.source.playlistName ?? zone.source.playlistId;
  if (zone.source?.type === 'content') return zone.source.contentName ?? zone.source.contentId;
  if (zone.playlistId) return `Playlist (${zone.playlistId.slice(0, 8)}…)`;
  return 'No source';
}

function fmtDur(sec: number | null | undefined): string {
  if (sec == null) return '–';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s.toFixed(0)}s` : `${m}m`;
}

interface PlaylistItemRow {
  id: string;
  position: number;
  duration: number | null;
  content: { id: string; name: string; type: string; duration: number | null } | null;
  nestedPlaylist: { id: string; name: string; totalDuration: number } | null;
}
interface PlaylistDetailResponse {
  id: string;
  name: string;
  totalDuration: number;
  items: PlaylistItemRow[];
}

function PlaylistZoneDetail({ playlistId }: { playlistId: string }) {
  const { data, isLoading } = useQuery<PlaylistDetailResponse>({
    queryKey: ['playlist-detail-zone', playlistId],
    queryFn: () => api.get(`/playlists/${playlistId}`),
    enabled: !!playlistId,
  });

  if (isLoading) {
    return <p className="text-[10px] text-[var(--text-muted)] animate-pulse mt-1.5">Loading items…</p>;
  }
  if (!data) return null;

  const items = data.items ?? [];
  const total = items.reduce((acc, item) => acc + (item.duration ?? item.content?.duration ?? 0), 0);

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] overflow-hidden">
      {items.length === 0 ? (
        <p className="px-2 py-2 text-[10px] text-[var(--text-muted)]">No items in playlist</p>
      ) : (
        <>
          {items.map((item, i) => {
            const name = item.content?.name ?? item.nestedPlaylist?.name ?? `Item ${i + 1}`;
            const dur = item.duration ?? item.content?.duration ?? null;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] border-b border-[var(--border)] last:border-b-0 bg-[var(--surface)]"
              >
                <span className="text-[var(--text-muted)] shrink-0 font-mono w-4">{i + 1}.</span>
                <span className="flex-1 truncate text-[var(--text)]">{name}</span>
                <span className="shrink-0 text-[var(--text-muted)] font-mono tabular-nums">{fmtDur(dur)}</span>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] font-semibold bg-[var(--surface-raised)]">
            <span className="flex items-center gap-1 text-[var(--text)]">
              <Clock className="w-3 h-3" /> Total
            </span>
            <span className="font-mono tabular-nums text-[var(--text)]">{fmtDur(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function SourceIcon({ source }: { source?: ZoneSource | null | undefined }) {
  if (source?.type === 'playlist') return <ListVideo className="w-3.5 h-3.5 shrink-0" />;
  if (source?.type === 'content') {
    const t = source.contentType?.toUpperCase() ?? '';
    if (t === 'VIDEO') return <Film className="w-3.5 h-3.5 shrink-0" />;
    return <Image className="w-3.5 h-3.5 shrink-0" />;
  }
  return null;
}

export default function ZoneLayoutEditor({ initialZones, workspaceId, saving, onSave }: Props) {
  const [zones, setZones] = useState<ZoneConfig[]>(initialZones.length > 0 ? initialZones : [makeZone(0)]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pickerZoneId, setPickerZoneId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setZones(initialZones.length > 0 ? initialZones : [makeZone(0)]);
  }, [initialZones]);

  useEffect(() => {
    if (!drag) return;
    const dragState = drag;

    function onMove(e: MouseEvent) {
      const scaleX = DEVICE_W / CANVAS_W;
      const scaleY = DEVICE_H / CANVAS_H;
      const dx = (e.clientX - dragState.startX) * scaleX;
      const dy = (e.clientY - dragState.startY) * scaleY;

      setZones((prev) =>
        prev.map((zone) => {
          if (zone.id !== dragState.zoneId) return zone;
          if (dragState.mode === 'move') {
            const width = zone.rect.width;
            const height = zone.rect.height;
            return {
              ...zone,
              rect: {
                ...zone.rect,
                x: clamp(dragState.rect.x + dx, 0, DEVICE_W - width),
                y: clamp(dragState.rect.y + dy, 0, DEVICE_H - height),
              },
            };
          }
          return {
            ...zone,
            rect: {
              ...zone.rect,
              width: clamp(dragState.rect.width + dx, 120, DEVICE_W - dragState.rect.x),
              height: clamp(dragState.rect.height + dy, 120, DEVICE_H - dragState.rect.y),
            },
          };
        }),
      );
    }

    function onUp() {
      setDrag(null);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  const normalizedZones = useMemo(
    () => zones.map((zone) => ({
      ...zone,
      rect: {
        x: Math.round(zone.rect.x),
        y: Math.round(zone.rect.y),
        width: Math.round(zone.rect.width),
        height: Math.round(zone.rect.height),
      },
    })),
    [zones],
  );

  function handlePickerSelect(pickedItems: PickedItem[]) {
    const item = pickedItems[0];
    if (!item || !pickerZoneId) return;
    const source: ZoneSource =
      item.type === 'playlist'
        ? { type: 'playlist', playlistId: item.id, playlistName: item.name, sourceDuration: item.duration ?? null }
        : {
            type: 'content',
            contentId: item.id,
            contentName: item.name,
            ...(item.contentType ? { contentType: item.contentType } : {}),
            sourceDuration: item.duration ?? null,
          };
    setZones((prev) =>
      prev.map((zone) =>
        zone.id === pickerZoneId
          ? {
              ...zone,
              source,
              // keep backward-compat playlistId in sync
              playlistId: source.type === 'playlist' ? source.playlistId : (zone.playlistId ?? null),
            }
          : zone,
      ),
    );
    setPickerZoneId(null);
  }

  function clearZoneSource(zoneId: string) {
    setZones((prev) =>
      prev.map((zone): ZoneConfig =>
        zone.id === zoneId ? { ...zone, source: null, playlistId: null } : zone,
      ),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <LayoutGrid className="w-4 h-4" /> Multi-zone Layout
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Drag zones to reposition. Drag corner to resize. Up to {MAX_ZONES} zones.
            {normalizedZones.filter((z) => z.source?.type === 'content' || z.source?.type === 'playlist' || z.playlistId).length > 2 && (
              <span className="ml-1 text-amber-400">More than 2 active zones may reduce video performance.</span>
            )}
          </p>
        </div>
        <ActionButton
          onClick={() => setZones((prev) => (prev.length >= MAX_ZONES ? prev : [...prev, makeZone(prev.length)]))}
          disabled={zones.length >= MAX_ZONES}
          tone="default"
          className="px-3 py-2 text-sm"
        >
          <Plus className="w-4 h-4" /> Add Zone
        </ActionButton>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[640px_minmax(0,1fr)] gap-6">
        <div
          ref={canvasRef}
          className="relative rounded-2xl overflow-hidden border"
          style={{ width: CANVAS_W, height: CANVAS_H, borderColor: 'var(--border)', background: 'linear-gradient(180deg, rgba(18,24,37,0.95), rgba(12,16,26,0.95))' }}
        >
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
          {normalizedZones.map((zone, index) => {
            const left = (zone.rect.x / DEVICE_W) * CANVAS_W;
            const top = (zone.rect.y / DEVICE_H) * CANVAS_H;
            const width = (zone.rect.width / DEVICE_W) * CANVAS_W;
            const height = (zone.rect.height / DEVICE_H) * CANVAS_H;
            return (
              <div
                key={zone.id}
                className="absolute rounded-xl border-2 shadow-lg"
                style={{
                  left,
                  top,
                  width,
                  height,
                  borderColor: syncGroupMeta(zone.syncGroup)?.color ?? 'rgba(96,165,250,0.9)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
                  overflow: 'hidden',
                  background: 'transparent',
                }}
              >
                {/* Content thumbnail fill */}
                {zone.source?.type === 'content' && zone.source.contentId && (['image','video','pdf','presentation','html5'].includes(zone.source.contentType ?? '')) ? (
                  <div className="absolute inset-0 rounded-xl overflow-hidden">
                    <AuthImg
                      itemId={zone.source.contentId}
                      alt={zone.source.contentName ?? ''}
                      className="w-full h-full object-cover"
                      fallback={
                        <div className="w-full h-full flex items-center justify-center" style={{ background: syncGroupMeta(zone.syncGroup)?.bg ?? 'rgba(59,130,246,0.18)' }}>
                          <Image className="w-5 h-5 text-white/40" />
                        </div>
                      }
                    />
                    <div className="absolute inset-0 rounded-xl" style={{ border: `2px solid ${syncGroupMeta(zone.syncGroup)?.color ?? 'rgba(96,165,250,0.9)'}` }} />
                  </div>
                ) : zone.source?.type === 'playlist' ? (
                  <div className="absolute inset-0 rounded-xl flex flex-col items-center justify-center gap-1" style={{ background: syncGroupMeta(zone.syncGroup)?.bg ?? 'rgba(59,130,246,0.18)', border: `2px solid ${syncGroupMeta(zone.syncGroup)?.color ?? 'rgba(96,165,250,0.9)'}` }}>
                    <ListVideo className="w-5 h-5 text-white/60" />
                    <span className="text-[9px] text-white/70 text-center px-2 truncate max-w-full">{zone.source.playlistName ?? 'Playlist'}</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 rounded-xl" style={{ background: syncGroupMeta(zone.syncGroup)?.bg ?? 'rgba(59,130,246,0.18)', border: `2px solid ${syncGroupMeta(zone.syncGroup)?.color ?? 'rgba(96,165,250,0.9)'}` }} />
                )}
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDrag({ zoneId: zone.id, mode: 'move', startX: e.clientX, startY: e.clientY, rect: zone.rect });
                  }}
                  className="absolute inset-0 text-left p-3"
                >
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold text-white bg-black/50">
                    Zone {index + 1}
                    {zone.syncGroup && (
                      <span
                        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold text-white"
                        style={{ background: syncGroupMeta(zone.syncGroup)?.color ?? '#666' }}
                      >
                        {zone.syncGroup}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDrag({ zoneId: zone.id, mode: 'resize', startX: e.clientX, startY: e.clientY, rect: zone.rect });
                  }}
                  className="absolute right-1 bottom-1 w-4 h-4 rounded-sm bg-white/90"
                  title="Resize zone"
                />
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          {normalizedZones.map((zone, index) => (
            <div key={zone.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--text)]">Zone {index + 1}</p>
                <button
                  onClick={() => setZones((prev) => prev.filter((item) => item.id !== zone.id))}
                  disabled={zones.length === 1}
                  className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Content Source</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-sm min-w-0">
                    <SourceIcon source={zone.source} />
                    <span className={`truncate ${zone.source && zone.source.type !== 'empty' ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                      {sourceLabel(zone)}
                    </span>
                    {zone.source?.type === 'content' && zone.source.sourceDuration != null && (
                      <span className="shrink-0 ml-auto flex items-center gap-0.5 text-xs text-[var(--text-muted)] font-mono tabular-nums">
                        <Clock className="w-3 h-3" />{fmtDur(zone.source.sourceDuration)}
                      </span>
                    )}
                  </div>
                  <ActionButton
                    onClick={() => setPickerZoneId(zone.id)}
                    tone="default"
                    className="px-3 py-2 text-xs shrink-0"
                  >
                    Pick
                  </ActionButton>
                  {(zone.source || zone.playlistId) && (
                    <button
                      onClick={() => clearZoneSource(zone.id)}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10"
                      title="Clear source"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {zone.source?.type === 'playlist' && (
                  <PlaylistZoneDetail playlistId={zone.source.playlistId} />
                )}
              </div>

              {/* Fill mode toggle */}
              <div className="flex items-center gap-2">
                <button
                  role="checkbox"
                  aria-checked={zone.fitMode === 'fill'}
                  onClick={() =>
                    setZones((prev) =>
                      prev.map((item) =>
                        item.id === zone.id
                          ? { ...item, fitMode: item.fitMode === 'fill' ? 'contain' : 'fill' }
                          : item,
                      ),
                    )
                  }
                  className={`w-4 h-4 rounded border-2 shrink-0 transition-colors ${
                    zone.fitMode === 'fill'
                      ? 'bg-[var(--blue)] border-[var(--blue)]'
                      : 'bg-transparent border-[var(--border)]'
                  }`}
                  style={{ position: 'relative' }}
                >
                  {zone.fitMode === 'fill' && (
                    <svg viewBox="0 0 10 8" className="absolute inset-0 w-full h-full p-0.5" fill="none">
                      <polyline points="1,4 4,7 9,1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span className="text-xs text-[var(--text-muted)]">
                  Fill zone
                  <span className="ml-1 text-[var(--text-muted)] opacity-60">
                    {zone.fitMode === 'fill' ? '(stretch to fill entire zone)' : '(letterbox / contain, default)'}
                  </span>
                </span>
              </div>

              {/* Sync Group selector */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Sync Group</label>
                <div className="flex items-center gap-2">
                  {SYNC_GROUPS.map((sg) => {
                    const active = zone.syncGroup === sg.id;
                    // count how many OTHER zones share this sync group
                    const peers = zones.filter((z) => z.id !== zone.id && z.syncGroup === sg.id).length;
                    return (
                      <button
                        key={sg.id}
                        onClick={() =>
                          setZones((prev) =>
                            prev.map((item) =>
                              item.id === zone.id
                                ? { ...item, syncGroup: active ? null : sg.id }
                                : item,
                            ),
                          )
                        }
                        className="relative w-8 h-8 rounded-lg text-xs font-bold transition-all"
                        style={{
                          borderWidth: 2,
                          borderStyle: 'solid',
                          borderColor: active ? sg.color : 'var(--border)',
                          background: active ? sg.bg : 'transparent',
                          color: active ? sg.color : 'var(--text-muted)',
                          opacity: active ? 1 : 0.6,
                        }}
                        title={`Sync group ${sg.label}${peers > 0 ? ` (${peers} other zone${peers > 1 ? 's' : ''})` : ''}`}
                      >
                        {sg.label}
                        {active && peers > 0 && (
                          <span
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                            style={{ background: sg.color }}
                          >
                            {peers + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {zone.syncGroup && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-1">
                      Synced with {zones.filter((z) => z.id !== zone.id && z.syncGroup === zone.syncGroup).map((z, i) => `Zone ${zones.indexOf(z) + 1}`).join(', ') || 'none yet'}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([
                  ['x', 'X'],
                  ['y', 'Y'],
                  ['width', 'Width'],
                  ['height', 'Height'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">{label}</label>
                    <input
                      type="number"
                      value={zone.rect[key]}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setZones((prev) => prev.map((item) => item.id === zone.id ? { ...item, rect: { ...item.rect, [key]: Number.isFinite(value) ? value : 0 } } : item));
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <ActionButton onClick={() => onSave(normalizedZones)} disabled={saving} tone="primary" className="px-4 py-2 text-sm">
          {saving ? 'Saving…' : 'Save Zones'}
        </ActionButton>
      </div>

      <ContentPickerModal
        open={pickerZoneId != null}
        onClose={() => setPickerZoneId(null)}
        onSelect={handlePickerSelect}
        workspaceId={workspaceId}
        multi={false}
        allowedTypes={['content', 'playlist']}
        title="Pick Zone Content"
      />
    </div>
  );
}