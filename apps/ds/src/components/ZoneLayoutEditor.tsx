import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Plus, Trash2, Film, Image, ListVideo, X } from 'lucide-react';
import { ActionButton } from './UiPrimitives.js';
import ContentPickerModal, { type PickedItem } from './ContentPickerModal.js';

export type ZoneSource =
  | { type: 'playlist'; playlistId: string; playlistName?: string }
  | { type: 'content'; contentId: string; contentName?: string; contentType?: string }
  | { type: 'empty' };

export interface ZoneConfig {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  label?: string | null;
  playlistId?: string | null; // backward compat
  source?: ZoneSource | null;
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
const DEVICE_W = 1920;
const DEVICE_H = 1080;
const MAX_ZONES = 8;

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

function SourceIcon({ source }: { source?: ZoneSource | null }) {
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
        ? { type: 'playlist', playlistId: item.id, playlistName: item.name }
        : { type: 'content', contentId: item.id, contentName: item.name };
    setZones((prev) =>
      prev.map((zone) =>
        zone.id === pickerZoneId
          ? {
              ...zone,
              source,
              // keep backward-compat playlistId in sync
              playlistId: source.type === 'playlist' ? source.playlistId : zone.playlistId,
            }
          : zone,
      ),
    );
    setPickerZoneId(null);
  }

  function clearZoneSource(zoneId: string) {
    setZones((prev) =>
      prev.map((zone) =>
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
                  borderColor: 'rgba(96,165,250,0.9)',
                  background: 'rgba(59,130,246,0.18)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
                }}
              >
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDrag({ zoneId: zone.id, mode: 'move', startX: e.clientX, startY: e.clientY, rect: zone.rect });
                  }}
                  className="absolute inset-0 text-left p-3"
                >
                  <span className="inline-flex px-2 py-1 rounded-full text-[10px] font-semibold text-white bg-black/35">
                    Zone {index + 1}
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