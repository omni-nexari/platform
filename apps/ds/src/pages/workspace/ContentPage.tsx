import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  Plus, Grid3X3, Grid2X2, List, Image, Video,
  Globe, Code2, FileText, Presentation, Clock, Trash2,
  MoreVertical, Film, AlertTriangle, Check, Paintbrush, Monitor,
  LayoutGrid, ListVideo, CalendarDays, Scan,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import UploadModal from '../../components/UploadModal.js';

import AssignedTagPills, { type AssignedTag } from '../../components/AssignedTagPills.js';
import AuthImg from '../../components/AuthImg.js';
import ContentDetailPanel from '../../components/ContentDetailPanel.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import PublishWizardModal from '../../components/PublishWizardModal.js';
import BulkTagModal from '../../components/BulkTagModal.js';
import SmartViewsBar from '../../components/SmartViewsBar.js';
import TagFilterBar from '../../components/TagFilterBar.js';
import { Badge, EmptyState, FilterChip, Modal, ModalBody, ModalFooter, ModalHeader, ModalPrimaryButton, ModalSecondaryButton, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ContentItem {
  id: string;
  name: string;
  type: string;
  mimeType: string | null;
  fileSize: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  status: string;
  assignedTags?: AssignedTag[];
  webUrl: string | null;
  refreshInterval: number | null;
  createdAt: string;
  updatedAt: string;
  filePath: string | null;
  approvalState: string;
  validFrom: string | null;
  validUntil: string | null;
  orientation: string;
  folderId?: string | null;
  playlistCount?: number;
  scheduleCount?: number;
  metadata?: string | null;
}

interface ContentFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface ContentList {
  items: ContentItem[];
  total: number;
  page: number;
  limit: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
type FilterType = 'all' | ContentItem['type'];
type ViewMode = 'grid-lg' | 'grid-sm' | 'list';
type KnownContentType = 'image' | 'video' | 'html5' | 'pdf' | 'presentation' | 'web_url' | 'zone_layout' | 'calendar' | 'live_link_face' | 'canvas';

const TYPE_FILTERS: { id: FilterType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'html5', label: 'HTML5' },
  { id: 'web_url', label: 'Web URL' },
  { id: 'pdf', label: 'PDF' },
  { id: 'presentation', label: 'PPTX' },
  { id: 'zone_layout',    label: 'Zone Layout' },
  { id: 'calendar',       label: 'Calendar' },
  { id: 'live_link_face', label: 'Live Link' },
  { id: 'canvas',         label: 'Canvas' },
];

const TYPE_META: Record<KnownContentType, { label: string; color: string; icon: React.ReactNode }> = {
  image:       { label: 'Image',      color: 'bg-sky-500/80',      icon: <Image size={10} /> },
  video:       { label: 'Video',      color: 'bg-violet-500/80',   icon: <Video size={10} /> },
  html5:       { label: 'HTML5',      color: 'bg-amber-500/80',    icon: <Code2 size={10} /> },
  pdf:         { label: 'PDF',        color: 'bg-red-500/80',      icon: <FileText size={10} /> },
  presentation:{ label: 'PPTX',       color: 'bg-orange-500/80',   icon: <Presentation size={10} /> },
  web_url:     { label: 'Web URL',    color: 'bg-emerald-500/80',  icon: <Globe size={10} /> },
  zone_layout:    { label: 'Zone Layout', color: 'bg-teal-500/80',     icon: <LayoutGrid size={10} /> },
  calendar:        { label: 'Calendar',   color: 'bg-indigo-500/80',   icon: <CalendarDays size={10} /> },
  live_link_face:  { label: 'Live Link',  color: 'bg-pink-500/80',     icon: <Scan size={10} /> },
  canvas:          { label: 'Canvas',     color: 'bg-blue-500/80',     icon: <Paintbrush size={10} /> },
};

const UNKNOWN_TYPE_META = {
  label: 'Unknown',
  color: 'bg-slate-500/80',
  icon: <FileText size={10} />,
};

function getTypeMeta(type: string) {
  return TYPE_META[type as KnownContentType] ?? UNKNOWN_TYPE_META;
}

const attemptedThumbnailRegenerationIds = new Set<string>();
const missingThumbnailSourceIds = new Set<string>();

// ── Calendar Card Preview ─────────────────────────────────────────────────────
interface CalCardEvent {
  id: string; title: string; start: string; end: string;
  allDay: boolean; isPrivate: boolean; status?: string; location?: string | null;
}

function CalendarCardPreview({ item, large = false }: { item: ContentItem; large?: boolean }) {
  const size = large ? 'h-40' : 'h-28';
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }

  const view      = (meta.view as string) || 'week';
  const tz        = (meta.timezone as string) || undefined;
  const isDark    = (meta.theme as Record<string, unknown>)?.background === 'dark';
  const accent    = ((meta.theme as Record<string, unknown>)?.accentColor as string) || '#4f46e5';
  const rmeta     = (meta.roomMeta as Record<string, unknown>) || {};
  const roomName  = (rmeta.name as string) || item.name || 'Meeting Room';
  const bg        = isDark ? '#1e1e2e' : '#f8fafc';
  const surf      = isDark ? '#2a2a3e' : '#ffffff';
  const textC     = isDark ? '#e2e8f0' : '#1e293b';
  const mutedC    = isDark ? '#64748b' : '#94a3b8';
  const bordC     = isDark ? '#3a3a50' : '#e2e8f0';
  const today     = new Date();
  const dayLetters = ['S','M','T','W','T','F','S'];

  // Time window for the query, keyed by view type
  const from = new Date(today); from.setHours(0, 0, 0, 0);
  if (view === 'week') from.setDate(today.getDate() - today.getDay());
  else if (view === 'month') from.setDate(1);
  const to = new Date(from);
  if (view === 'meeting_room' || view === 'day') {
    to.setDate(to.getDate() + 1);
  } else if (view === 'week') {
    to.setDate(to.getDate() + 7);
  } else { // month
    to.setMonth(to.getMonth() + 1); to.setDate(0); to.setHours(23, 59, 59, 999);
  }

  const evQ = useQuery<{ events: CalCardEvent[] }>({
    queryKey: ['cal-card', item.id, view, from.toDateString()],
    enabled: !!(meta.connectionId),
    staleTime: 5 * 60 * 1000,
    queryFn: () => {
      const p = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      return api.get(`/content/${item.id}/calendar/events?${p}`);
    },
  });

  const events: CalCardEvent[] = evQ.data?.events ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });

  if (view === 'meeting_room') {
    const currentEvent = events.find(e => !e.allDay && new Date(e.start) <= today && new Date(e.end) > today);
    const upcoming = events.filter(e => !e.allDay && new Date(e.start) > today);
    const shown = currentEvent ? [currentEvent, ...upcoming].slice(0, 2) : upcoming.slice(0, 2);
    const isBusy = !!currentEvent;
    const railColor = isBusy ? '#dc2626' : accent;
    const statusLabel = isBusy ? 'IN USE' : 'AVAILABLE';
    const nowTime = today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
    return (
      <div className={`ui-media-frame w-full ${size} relative rounded-t-[0.95rem] overflow-hidden`}
        style={{ background: bg, fontFamily: 'system-ui,sans-serif' }}>
        <div className="absolute inset-0" style={{ right: 80 }}>
          <div style={{ padding: '8px 10px 4px', borderBottom: `1px solid ${bordC}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: accent, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{roomName}</div>
            <div style={{ fontSize: 7, color: mutedC, marginTop: 1 }}>Today &middot; {today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
          </div>
          <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {evQ.isLoading && <div style={{ fontSize: 7, color: mutedC }}>Loading…</div>}
            {!evQ.isLoading && shown.length === 0 && (
              <div style={{ fontSize: 7, color: mutedC, fontStyle: 'italic' }}>No events today</div>
            )}
            {shown.map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                <div style={{ width: 2, height: 16, borderRadius: 1, background: accent, flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 7.5, fontWeight: 600, color: textC, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                    {e.isPrivate ? 'Private' : e.title}
                  </div>
                  <div style={{ fontSize: 6.5, color: mutedC }}>{fmt(e.start)}&ndash;{fmt(e.end)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute top-0 right-0 bottom-0" style={{ width: 80, background: railColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>{statusLabel}</div>
          {isBusy && currentEvent && (
            <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.8)', textAlign: 'center', padding: '0 4px' }}>until {fmt(currentEvent.end)}</div>
          )}
          <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.4)', margin: '2px 0' }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{nowTime}</div>
        </div>
      </div>
    );
  }

  if (view === 'month') {
    const firstDow   = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
    const daysInMon  = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = [
      ...Array(firstDow).fill(null),
      ...Array.from({ length: daysInMon }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

    // Group real events by day-of-month
    const byDay = new Map<number, CalCardEvent[]>();
    for (const e of events) {
      const d = new Date(e.start);
      if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) {
        const day = d.getDate();
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(e);
      }
    }

    return (
      <div className={`ui-media-frame w-full ${size} relative rounded-t-[0.95rem] overflow-hidden`}
        style={{ background: bg, fontFamily: 'system-ui,sans-serif', padding: '6px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex' }}>
          {dayLetters.map((d, i) => <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 6, fontWeight: 600, color: mutedC }}>{d}</div>)}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: 'flex', flex: 1, gap: 1 }}>
            {w.map((d, di) => {
              const isToday = d === today.getDate();
              const dayEvs  = d != null ? (byDay.get(d) ?? []) : [];
              return (
                <div key={di} style={{ flex: 1, borderRadius: 2, background: d ? surf : 'transparent', border: `1px solid ${d ? bordC : 'transparent'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1px 0', overflow: 'hidden' }}>
                  {d != null && (
                    <span style={{ fontSize: 6.5, fontWeight: isToday ? 700 : 400, color: isToday ? '#fff' : textC, background: isToday ? accent : 'transparent', borderRadius: '50%', width: 10, height: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {d}
                    </span>
                  )}
                  {dayEvs.slice(0, 2).map(e => (
                    <div key={e.id} style={{ width: '90%', height: 3, borderRadius: 1, background: accent, marginTop: 1, opacity: 0.8 }} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // day / week — time grid (9am–2pm window)
  const GRID_START = 9;
  const GRID_END   = 14;
  const numCols    = view === 'day' ? 1 : 7;
  const colDates   = view === 'day'
    ? [today]
    : Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() - today.getDay() + i); return d; });

  const toDecHour = (iso: string) => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };

  // Bucket events into their day column
  const evByCol: CalCardEvent[][] = colDates.map(cd =>
    events.filter(e => !e.allDay && new Date(e.start).toDateString() === cd.toDateString()),
  );

  return (
    <div className={`ui-media-frame w-full ${size} relative rounded-t-[0.95rem] overflow-hidden`}
      style={{ background: bg, fontFamily: 'system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Day header row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${bordC}`, flexShrink: 0 }}>
        <div style={{ width: 18, flexShrink: 0, borderRight: `1px solid ${bordC}` }} />
        {colDates.map((d, i) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div key={i} style={{ flex: 1, textAlign: 'center', padding: '2px 1px', borderRight: `1px solid ${bordC}` }}>
              <div style={{ fontSize: 6, color: mutedC }}>{dayLetters[d.getDay()]}</div>
              <div style={{
                fontSize: 7.5, fontWeight: isToday ? 700 : 400,
                color: isToday ? '#fff' : textC,
                background: isToday ? accent : 'transparent',
                borderRadius: '50%', width: 11, height: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '1px auto 0',
              }}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      {/* Time grid body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 18, flexShrink: 0, borderRight: `1px solid ${bordC}` }}>
          {['9','10','11','12','1'].map((h, i) => (
            <div key={i} style={{ height: '20%', fontSize: 5, color: mutedC, textAlign: 'right', paddingRight: 2, paddingTop: 1 }}>{h}</div>
          ))}
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          {/* Hour lines */}
          {[0,1,2,3,4].map(h => (
            <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: `${h * 20}%`, borderTop: `1px solid ${bordC}` }} />
          ))}
          {/* Real event blocks */}
          {colDates.map((_, ci) =>
            (evByCol[ci] ?? []).map(e => {
              const startH = Math.max(toDecHour(e.start), GRID_START);
              const endH   = Math.min(toDecHour(e.end),   GRID_END);
              if (startH >= GRID_END || endH <= GRID_START) return null;
              const top    = (startH - GRID_START) / (GRID_END - GRID_START) * 100;
              const height = Math.max((endH - startH) / (GRID_END - GRID_START) * 100, 6);
              const colW   = 1 / numCols;
              return (
                <div key={e.id} style={{
                  position: 'absolute',
                  left: `${(ci * colW + colW * 0.05) * 100}%`,
                  width: `${colW * 0.9 * 100}%`,
                  top: `${top}%`, height: `${height}%`,
                  background: accent, borderRadius: 2, padding: '1px 2px', overflow: 'hidden',
                }}>
                  <div style={{ fontSize: 5.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.isPrivate ? 'Private' : e.title}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Zone Layout Preview ───────────────────────────────────────────────────────
const DEVICE_W = 1920;
const DEVICE_H = 1080;
const DEFAULT_IMAGE_SECS = 10;

type ZoneMeta = {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  source?: { type: string; contentId?: string; contentName?: string; contentType?: string; playlistId?: string; playlistName?: string; sourceDuration?: number | null } | null;
};

function parseZones(metadata?: string | null): ZoneMeta[] {
  try { return JSON.parse(metadata ?? '{}').zones ?? []; } catch { return []; }
}

function computeZoneDuration(zones: ZoneMeta[]): number | null {
  let max: number | null = null;
  for (const z of zones) {
    const src = z.source;
    if (!src || src.type === 'empty') continue;
    let d: number | null = src.sourceDuration ?? null;
    if (d == null && src.type === 'content') {
      const t = (src.contentType ?? '').toLowerCase();
      if (t === 'image') d = DEFAULT_IMAGE_SECS;
    }
    if (d != null && (max == null || d > max)) max = d;
  }
  return max;
}

function ZoneLayoutPreview({ item, large = false }: { item: ContentItem; large?: boolean }) {
  const size = large ? 'h-40' : 'h-28';
  const zones = parseZones(item.metadata);
  const autoDur = computeZoneDuration(zones);
  const displayDur = item.duration ?? autoDur;

  if (zones.length === 0) {
    return (
      <div className={`ui-media-frame w-full ${size} flex items-center justify-center rounded-t-[0.95rem]`}>
        <LayoutGrid size={28} className="text-teal-400" />
      </div>
    );
  }
  return (
    <div className={`ui-media-frame w-full ${size} relative rounded-t-[0.95rem] bg-[#0d1117]`}>
      <div className="absolute inset-0 overflow-hidden rounded-t-[0.95rem]">
        {zones.map((zone) => {
          const left   = `${(zone.rect.x / DEVICE_W) * 100}%`;
          const top    = `${(zone.rect.y / DEVICE_H) * 100}%`;
          const width  = `${(zone.rect.width / DEVICE_W) * 100}%`;
          const height = `${(zone.rect.height / DEVICE_H) * 100}%`;
          const isContent = zone.source?.type === 'content' && zone.source.contentId;
          const isPlaylist = zone.source?.type === 'playlist';
          const label = isContent
            ? (zone.source?.contentName ?? '')
            : isPlaylist ? (zone.source?.playlistName ?? 'Playlist') : 'Empty';

          return (
            <div
              key={zone.id}
              className="absolute overflow-hidden"
              style={{ left, top, width, height, border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {isContent && zone.source?.contentId ? (
                <AuthImg
                  itemId={zone.source.contentId}
                  alt={label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-[#1a2234]">
                  {isPlaylist
                    ? <ListVideo size={10} className="text-sky-400 shrink-0" />
                    : <LayoutGrid size={10} className="text-slate-500 shrink-0" />}
                  <span className="text-[7px] leading-tight text-slate-400 text-center px-0.5 truncate max-w-full">{label}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {displayDur != null && (
        <div className="ui-media-badge absolute bottom-2 right-2 z-20">
          <Clock size={9} />
          {formatDuration(displayDur)}
          {item.duration == null && <span className="opacity-60 ml-0.5">auto</span>}
        </div>
      )}
    </div>
  );
}

function formatDuration(s: number) {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
}

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ContentStatusBadge({ status, className }: { status: string; className?: string }) {
  if (status === 'processing') {
    return <Badge tone="accent" className={className}>Processing</Badge>;
  }

  if (status === 'error') {
    return <Badge tone="danger" className={className}>Error</Badge>;
  }

  return null;
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────
function Thumb({ item, large = false }: { item: ContentItem; large?: boolean }) {
  if (item.type === 'zone_layout') return <ZoneLayoutPreview item={item} large={large} />;
  if (item.type === 'calendar') return <CalendarCardPreview item={item} large={large} />;

  const [imgFailed, setImgFailed] = useState(false);
  const [thumbRev, setThumbRev] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const size = large ? 'h-40' : 'h-28';

  const PlaceholderIcon = () => {
    if (item.type === 'html5') {
      return (
        <div className="flex flex-col items-center justify-center gap-2">
          <Code2 size={22} className="text-amber-400/60" />
          <span
            className="text-amber-400 font-bold tracking-widest uppercase"
            style={{ fontSize: '1.15rem', letterSpacing: '0.18em', textShadow: '0 0 18px rgba(251,191,36,0.35)' }}
          >
            HTML5
          </span>
        </div>
      );
    }
    const iconMeta = getTypeMeta(item.type);
    if (item.type === 'image') return <Image size={28} className="text-sky-400" />;
    if (item.type === 'video') return <Film size={28} className="text-violet-400" />;
    if (item.type === 'pdf') return <FileText size={28} className="text-red-400" />;
    if (item.type === 'presentation') return <Presentation size={28} className="text-orange-400" />;
    if (item.type === 'web_url') return <Globe size={28} className="text-emerald-400" />;
    if (item.type === 'zone_layout') return null; // handled by ZoneLayoutPreview
    if (item.type === 'calendar') return <CalendarDays size={28} className="text-indigo-400" />;
    return <span className="text-slate-300">{iconMeta.icon}</span>;
  };

  const hasThumbnail =
    (item.type === 'image' || item.type === 'video' || item.type === 'pdf' || item.type === 'presentation' || item.type === 'html5') &&
    !imgFailed &&
    !missingThumbnailSourceIds.has(item.id);

  async function handleThumbError(status: number) {
    // 404 = no thumbnail generated yet (e.g. uploaded before this feature)
    // Auto-regenerate once, then retry the AuthImg
    if (status === 404 && !regenerating && !attemptedThumbnailRegenerationIds.has(item.id)) {
      attemptedThumbnailRegenerationIds.add(item.id);
      setRegenerating(true);
      try {
        await api.post(`/content/${item.id}/regenerate-thumbnail`);
        setThumbRev((r) => r + 1); // triggers AuthImg re-fetch
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('Source file not found on disk') || message.includes('"error":"Source file not found on disk"')) {
          missingThumbnailSourceIds.add(item.id);
        }
        setImgFailed(true); // regeneration failed too, show placeholder
      } finally {
        setRegenerating(false);
      }
    } else {
      setImgFailed(true);
    }
  }

  return (
    <div
      className={`ui-media-frame w-full ${size} flex items-center justify-center rounded-t-[0.95rem]`}
      style={item.type === 'html5' ? { background: 'linear-gradient(135deg, #1f1a10 0%, #0c0a06 100%)' } : undefined}
    >      {hasThumbnail ? (
        <>
          {/* Skeleton shimmer while AuthImg loads / regenerates */}
          <div className="absolute inset-0 animate-pulse bg-[var(--surface-raised)]" />
          <AuthImg
            itemId={item.id}
            alt={item.name}
            className={`absolute inset-0 w-full h-full ${item.orientation === 'portrait' ? 'object-contain' : 'object-cover'}`}
            onError={handleThumbError}
            revision={thumbRev}
          />
        </>
      ) : (
        <PlaceholderIcon />
      )}
    </div>
  );
}

// ── Grid Card ─────────────────────────────────────────────────────────────────
function GridCard({
  item, large = false, selected, onSelect, onDelete, checked, onCheck,
}: {
  item: ContentItem; large?: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  checked: boolean;
  onCheck: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const meta = getTypeMeta(item.type);

  const isExpired = item.validUntil ? new Date(item.validUntil).getTime() < Date.now() : false;
  const isExpiringSoon = item.validUntil && !isExpired
    ? new Date(item.validUntil).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    : false;

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      className={`group ui-entity-card cursor-pointer bg-[var(--surface)]
        ${selected ? 'ui-entity-card-selected' : ''}`}
    >
      <Thumb item={item} large={large} />

      {/* Type badge or selection checkbox */}
      {(hovered || checked) ? (
        <div
          className="absolute top-2 left-2 z-20 w-5 h-5 rounded-md flex items-center justify-center cursor-pointer transition-colors"
          style={{ background: checked ? 'var(--accent)' : 'rgba(0,0,0,0.55)', border: '1.5px solid rgba(255,255,255,0.3)' }}
          onClick={(e) => { e.stopPropagation(); onCheck(); }}
        >
          {checked && <Check size={11} className="text-white" />}
        </div>
      ) : (
        <div className={`ui-media-badge absolute top-2 left-2 z-20 ${meta.color.replace('/80', '/92')}`}>
          {meta.icon}{meta.label}
        </div>
      )}

      {/* Expiry badge */}
      {(isExpired || isExpiringSoon) && (
        <div className={`ui-media-badge absolute bottom-2 left-2 z-20 ${isExpired ? 'ui-media-badge-danger' : 'ui-media-badge-warning'}`}>
          <AlertTriangle size={9} />
          {isExpired ? 'Expired' : 'Expires soon'}
        </div>
      )}

      {/* Portrait badge */}
      {item.orientation === 'portrait' && (
        <div className="ui-media-badge absolute top-2 right-2 z-20">
          Portrait
        </div>
      )}

      {/* Duration overlay (video only — zone_layout renders its own inside ZoneLayoutPreview) */}
      {item.duration != null && item.type === 'video' && (
        <div className="ui-media-badge absolute bottom-2 right-2 z-20">
          <Clock size={9} />
          {formatDuration(item.duration)}
        </div>
      )}

      {/* ⋮ menu */}
      {hovered && (
        <div className="absolute top-2 right-2 z-20">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="ui-media-icon-btn"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-30 w-36 rounded-lg shadow-xl border border-[var(--border)] bg-[var(--surface)] py-1">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-[var(--surface-raised)]"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}
        </div>
      )}

      {/* Info row */}
      <div className="ui-entity-card-body px-3 py-2.5">
        <div className="flex items-center gap-1 mb-0.5">
          <p className="ui-entity-card-title text-xs truncate flex-1" title={item.name}>{item.name}</p>
          <ContentStatusBadge status={item.status} className="shrink-0 text-[9px]" />
        </div>
        {item.type === 'zone_layout' ? (() => {
          const zones = parseZones(item.metadata);
          const autoDur = computeZoneDuration(zones);
          const displayDur = item.duration ?? autoDur;
          return (
            <div className="mt-1 space-y-0.5">
              {zones.slice(0, 4).map((z, i) => {
                const src = z.source;
                const name = src?.playlistName ?? src?.contentName ?? (src?.type === 'playlist' ? 'Playlist' : 'Empty');
                const dur = src?.sourceDuration ?? (src?.contentType === 'image' ? DEFAULT_IMAGE_SECS : null);
                const isDoc = src?.contentType != null && ['pdf', 'presentation', 'html5'].includes(src.contentType);
                return (
                  <div key={z.id} className="flex items-center justify-between gap-1">
                    <span className="text-[9px] text-[var(--text-muted)] truncate">Z{i + 1}: {name}</span>
                    <span className="text-[9px] text-[var(--text-muted)] shrink-0">
                      {dur != null ? formatDuration(dur) : isDoc ? '—' : ''}
                    </span>
                  </div>
                );
              })}
              {zones.length > 4 && <span className="text-[9px] text-[var(--text-muted)]">+{zones.length - 4} more</span>}
              <div className="flex items-center gap-1 pt-0.5 border-t border-[var(--border)]">
                <Clock size={8} className="text-[var(--text-muted)]" />
                {displayDur != null
                  ? <><span className="text-[9px] font-semibold text-[var(--text)]">{formatDuration(displayDur)}</span>
                      {item.duration == null && <span className="text-[9px] text-[var(--text-muted)]">auto</span>}</>
                  : <span className="text-[9px] text-[var(--text-muted)] italic">re-save to calc</span>
                }
              </div>
            </div>
          );
        })() : (
          <div className="ui-entity-card-meta mt-1 justify-between">
            <p className="text-[10px] text-[var(--text-muted)]">{formatSize(item.fileSize)}</p>
          </div>
        )}
        <div className="mt-2">
          <AssignedTagPills tags={item.assignedTags} />
        </div>
      </div>

      {/* Hover overlay — usage info */}
      <div
        className="absolute inset-0 flex flex-col justify-end pointer-events-none transition-opacity duration-150"
        style={{ opacity: hovered ? 1 : 0, background: 'rgba(0,0,0,0.76)', zIndex: 10 }}
      >
        <div className="px-3 pb-3 pt-2 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1">Used In</p>
          {([
            { label: 'Playlists',  value: item.playlistCount ?? 0,  icon: '\u25B6' },
            { label: 'Schedules', value: item.scheduleCount ?? 0, icon: '\uD83D\uDCC5' },
            { label: 'Published', value: item.approvalState === 'approved' ? 1 : 0, icon: '\u2022' },
          ] as { label: string; value: number; icon: string }[]).map(({ label, value, icon }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[11px] text-white/60">{icon} {label}</span>
              <span className={`text-[11px] font-bold ${ value > 0 ? 'text-white' : 'text-white/30' }`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── List Row ──────────────────────────────────────────────────────────────────
function ListRow({ item, selected, onSelect, onDelete, checked, onCheck }: {
  item: ContentItem; selected: boolean; onSelect: () => void; onDelete: () => void;
  checked: boolean; onCheck: () => void;
}) {
  const meta = getTypeMeta(item.type);
  const isExpired = item.validUntil ? new Date(item.validUntil).getTime() < Date.now() : false;
  const isExpiringSoon = item.validUntil && !isExpired
    ? new Date(item.validUntil).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    : false;
  return (
    <div
      onClick={onSelect}
      className={`ui-row-card flex items-center gap-4 px-4 py-3 cursor-pointer group
        ${selected ? 'border-[var(--accent)]' : ''}`}
    >
      {/* Checkbox */}
      <div
        className="shrink-0 w-4 h-4 rounded flex items-center justify-center cursor-pointer transition-colors border"
        style={{ background: checked ? 'var(--accent)' : 'transparent', borderColor: checked ? 'var(--accent)' : 'var(--border)' }}
        onClick={(e) => { e.stopPropagation(); onCheck(); }}
      >
        {checked && <Check size={10} className="text-white" />}
      </div>

      {/* Icon */}
      <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--surface-raised)]">
        {meta.icon}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate">{item.name}</p>
        {item.webUrl && (
          <p className="text-xs text-[var(--text-muted)] truncate">{item.webUrl}</p>
        )}
        <div className="mt-1">
          <AssignedTagPills tags={item.assignedTags} />
        </div>
      </div>

      {/* Type badge */}
      <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded text-white ${meta.color}`}>
        {meta.label}
      </span>

      {/* Status badge */}
      <ContentStatusBadge status={item.status} className="shrink-0 text-[10px]" />

      {/* Expiry badge */}
      {(isExpired || isExpiringSoon) && (
        <Badge tone={isExpired ? 'danger' : 'warning'} className="shrink-0 text-[10px] font-medium">
          <AlertTriangle size={9} />
          {isExpired ? 'Expired' : 'Expires soon'}
        </Badge>
      )}

      {/* Duration */}
      <span className="shrink-0 text-xs text-[var(--text-muted)] w-14 text-right">
        {item.duration != null ? formatDuration(item.duration) : '—'}
      </span>

      {/* Size */}
      <span className="shrink-0 text-xs text-[var(--text-muted)] w-20 text-right">
        {formatSize(item.fileSize)}
      </span>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-red-400"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen]         = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState(false);
  const [moveFolderId, setMoveFolderId] = useState<string>('root');
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);

  const filterType = (searchParams.get('type') as FilterType | null) ?? 'all';
  const selectedTagIds = (searchParams.get('tagIds') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const sort = (searchParams.get('sort') as 'created_at' | 'name' | 'size' | null) ?? 'created_at';
  const view = (searchParams.get('view') as ViewMode | null) ?? 'grid-lg';
  const page = Math.max(Number(searchParams.get('page') ?? '1') || 1, 1);
  const selectedFolderId = (searchParams.get('folderId') ?? 'all') as 'all' | 'root' | string;
  const orientation = (searchParams.get('orientation') ?? 'all') as 'all' | 'portrait' | 'landscape';

  const updateBrowseParams = (updater: (params: URLSearchParams) => void) => {
    const nextParams = new URLSearchParams(searchParams);
    updater(nextParams);
    if (nextParams.get('type') === 'all') nextParams.delete('type');
    if (!nextParams.get('tagIds')) nextParams.delete('tagIds');
    if (nextParams.get('sort') === 'created_at') nextParams.delete('sort');
    if (nextParams.get('view') === 'grid-lg') nextParams.delete('view');
    if (nextParams.get('page') === '1') nextParams.delete('page');
    if (nextParams.get('folderId') === 'all') nextParams.delete('folderId');
    if (nextParams.get('orientation') === 'all') nextParams.delete('orientation');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  };

  // Canvas items navigate to the canvas editor instead of opening the detail panel.
  const handleCardSelect = async (item: ContentItem) => {
    if (item.type === 'canvas') {
      let canvasProjectId: string | null = null;
      try {
        const meta = JSON.parse(item.metadata ?? '{}') as Record<string, unknown>;
        canvasProjectId = (meta.canvasProjectId as string) ?? null;
      } catch { /* ignore */ }
      if (!canvasProjectId) {
        // Fallback: look up by contentItemId (pre-fix canvas items won't have it in metadata)
        try {
          const project = await api.get<{ id: string }>(`/canvas?contentItemId=${item.id}`);
          canvasProjectId = project?.id ?? null;
        } catch { /* ignore */ }
      }
      if (canvasProjectId) {
        navigate(`/workspaces/${wsId}/canvas/${canvasProjectId}`);
      }
      return;
    }
    setSelectedId(selectedId === item.id ? null : item.id);
  };

  const currentFilters = {
    filterType,
    selectedTagIds,
    sort,
    view,
    selectedFolderId,
    orientation,
  };

  const typeParam = filterType === 'all' ? '' : `&type=${filterType}`;
  const tagIdsParam = selectedTagIds.length > 0 ? `&tagIds=${selectedTagIds.join(',')}` : '';
  const folderParam = selectedFolderId === 'all' ? '' : `&folderId=${selectedFolderId}`;
  const orientationParam = orientation === 'all' ? '' : `&orientation=${orientation}`;

  const { data, isLoading } = useQuery<ContentList>({
    queryKey: ['content', wsId, filterType, selectedTagIds, selectedFolderId, sort, page, orientation],
    queryFn: () => api.get(`/content?workspaceId=${wsId}${typeParam}${tagIdsParam}${folderParam}${orientationParam}&sort=${sort}&page=${page}&limit=50`),
    enabled: !!wsId,
    placeholderData: (prev) => prev,
  });

  const { data: folders = [] } = useQuery<ContentFolder[]>({
    queryKey: ['content-folders', wsId],
    queryFn: () => api.get(`/content/folders?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/content/${id}`),
    onSuccess: () => {
      toast.success('Content removed');
      setConfirmDeleteId(null);
      setConfirmDeleteName('');
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-content', wsId] });
      setSelectedId(null);
    },
    onError: () => toast.error('Failed to delete'),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.delete(`/content/${id}`))),
    onSuccess: (_data, ids) => {
      toast.success(`Deleted ${ids.length} item(s)`);
      setConfirmBulkDelete(false);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
      void queryClient.invalidateQueries({ queryKey: ['picker-content', wsId] });
    },
    onError: () => toast.error('Failed to delete some items'),
  });

  const moveFolderMut = useMutation({
    mutationFn: (folderId: string | null) => api.post('/content/move-to-folder', {
      workspaceId: wsId,
      contentIds: [...selectedItems],
      folderId,
    }),
    onSuccess: () => {
      toast.success('Content moved');
      setMoveFolderOpen(false);
      setSelectedItems(new Set());
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to move content'),
  });

  const createFolderMut = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) => api.post('/content/folders', {
      workspaceId: wsId,
      name,
      parentId,
    }),
    onSuccess: () => {
      toast.success('Folder created');
      void queryClient.invalidateQueries({ queryKey: ['content-folders', wsId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create folder'),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const publishSelection = items.filter((item) => selectedItems.has(item.id));
  const publishCandidate = publishSelection.length === 1 ? publishSelection[0] : null;
  const quickActions = wsId
    ? [
        {
          id: 'add-content',
          label: 'Add Content',
          description: 'Upload files and media',
          icon: <Plus size={18} />,
          iconClassName: 'bg-[var(--blue)]/15 text-[var(--blue)]',
          onClick: () => setUploadOpen(true),
        },
        {
          id: 'create-design',
          label: 'Create Design',
          description: 'Build a new canvas layout',
          icon: <Paintbrush size={18} />,
          iconClassName: 'bg-violet-500/15 text-violet-400',
          onClick: () => navigate(`/workspaces/${wsId}/canvas/new`),
        },
        {
          id: 'zone-layout',
          label: 'Zone Layout',
          description: 'Compose multi-zone signage',
          icon: <LayoutGrid size={18} />,
          iconClassName: 'bg-teal-500/15 text-teal-400',
          onClick: () => navigate(`/workspaces/${wsId}/zone-layout/new`),
        },
        {
          id: 'calendar',
          label: 'Calendar',
          description: 'Show upcoming events or a meeting room',
          icon: <CalendarDays size={18} />,
          iconClassName: 'bg-indigo-500/15 text-indigo-400',
          onClick: () => navigate(`/workspaces/${wsId}/calendar/new`),
        },
        {
          id: 'live-link-face',
          label: 'Live Link Face',
          description: 'Stream face data from Epic Live Link iOS app',
          icon: <Scan size={18} />,
          iconClassName: 'bg-pink-500/15 text-pink-400',
          onClick: () => navigate(`/workspaces/${wsId}/live-link-face/new`),
        },
      ]
    : [];

  function renderFolderTree(parentId: string | null = null, depth = 0): React.ReactNode {
    const children = folders.filter((folder) => folder.parentId === parentId);
    if (children.length === 0) return null;
    return children.map((folder) => (
      <div key={folder.id}>
        <button
          onClick={() => updateBrowseParams((params) => {
            params.set('folderId', folder.id);
            params.set('page', '1');
          })}
          className={`w-full flex items-center rounded-lg px-3 py-2 text-sm text-left transition-colors ${selectedFolderId === folder.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {folder.name}
        </button>
        {renderFolderTree(folder.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* ── Header ── */}
      <PageHeader
        icon={<Image size={22} />}
        title="Content"
        subtitle={`${total} item${total !== 1 ? 's' : ''}`}
      />

      {quickActions.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-left transition-colors hover:bg-[var(--surface)]"
            >
              <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${action.iconClassName}`}>
                {action.icon}
              </div>
              <p className="text-sm font-semibold text-[var(--text)]">{action.label}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{action.description}</p>
            </button>
          ))}
        </div>
      )}

      {wsId && (
        <div className="mb-5">
          <SmartViewsBar
            workspaceId={wsId}
            entityType="content"
            currentFilters={currentFilters}
            onApplyFilters={(filters) => {
              const next = filters as Partial<typeof currentFilters>;
              updateBrowseParams((params) => {
                params.set('type', next.filterType === undefined ? 'all' : next.filterType as FilterType);
                params.set('tagIds', Array.isArray(next.selectedTagIds) ? next.selectedTagIds.filter((value): value is string => typeof value === 'string').join(',') : '');
                params.set('sort', next.sort === 'name' || next.sort === 'size' ? next.sort : 'created_at');
                params.set('view', next.view === 'grid-sm' || next.view === 'list' ? next.view : 'grid-lg');
                params.set('folderId', typeof next.selectedFolderId === 'string' ? next.selectedFolderId : 'all');
                params.set('page', '1');
              });
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 h-fit">
          <div className="flex items-center justify-between mb-3 px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Folders</p>
            <button
              onClick={() => {
                const name = window.prompt('Folder name');
                if (name?.trim()) createFolderMut.mutate({ name: name.trim(), parentId: selectedFolderId === 'all' || selectedFolderId === 'root' ? null : selectedFolderId });
              }}
              className="text-xs text-[var(--accent)] hover:opacity-80"
            >
              New
            </button>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => updateBrowseParams((params) => {
                params.set('folderId', 'all');
                params.set('page', '1');
              })}
              className={`w-full flex items-center rounded-lg px-3 py-2 text-sm text-left transition-colors ${selectedFolderId === 'all' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'}`}
            >
              All Content
            </button>
            <button
              onClick={() => updateBrowseParams((params) => {
                params.set('folderId', 'root');
                params.set('page', '1');
              })}
              className={`w-full flex items-center rounded-lg px-3 py-2 text-sm text-left transition-colors ${selectedFolderId === 'root' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'}`}
            >
              Unfiled
            </button>
            {renderFolderTree()}
          </div>
        </aside>

        <div>
          {/* ── Toolbar ── */}
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="flex flex-wrap gap-1.5">
              {TYPE_FILTERS.map((f) => (
                <FilterChip
                  key={f.id}
                  onClick={() => updateBrowseParams((params) => {
                    params.set('type', f.id);
                    params.set('page', '1');
                  })}
                  active={filterType === f.id}
                >
                  {f.label}
                </FilterChip>
              ))}
            </div>

            {/* Orientation filter */}
            <div className="flex gap-1">
              {(['all', 'landscape', 'portrait'] as const).map((o) => (
                <FilterChip
                  key={o}
                  onClick={() => updateBrowseParams((params) => {
                    params.set('orientation', o);
                    params.set('page', '1');
                  })}
                  active={orientation === o}
                >
                  {o === 'all' ? 'All Orientations' : o.charAt(0).toUpperCase() + o.slice(1)}
                </FilterChip>
              ))}
            </div>

            {wsId && (
              <TagFilterBar
                workspaceId={wsId}
                selectedTagIds={selectedTagIds}
                onTagIdsChange={(ids) => {
                  updateBrowseParams((params) => {
                    params.set('tagIds', ids.join(','));
                    params.set('page', '1');
                  });
                }}
              />
            )}

            <select
              value={sort}
              onChange={(e) => updateBrowseParams((params) => {
                params.set('sort', e.target.value as typeof sort);
              })}
              className="input px-3 py-1.5 text-xs text-[var(--text-muted)]"
            >
              <option value="created_at">Date Added</option>
              <option value="name">Name</option>
              <option value="size">File Size</option>
            </select>

            <div className="flex gap-1 ml-auto">
              {([ ['grid-lg', <Grid2X2 size={15} />], ['grid-sm', <Grid3X3 size={15} />], ['list', <List size={15} />] ] as const).map(([mode, icon]) => (
                <button
                  key={mode}
                  onClick={() => updateBrowseParams((params) => {
                    params.set('view', mode);
                  })}
                  className={`ui-icon-toggle ${view === mode ? 'ui-icon-toggle-active' : ''}`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Image size={40} />}
              title="No content yet"
              description="Add content to start building playlists and schedules."
              action={<button onClick={() => setUploadOpen(true)} className="workspace-page-action">Add Content</button>}
            />
          ) : view === 'list' ? (
            <div className="space-y-2">
              <div className="ui-list-header">
                <div className="w-4 shrink-0" />
                <div className="w-8 shrink-0" />
                <span className="flex-1">Name</span>
                <span className="w-16 text-center">Type</span>
                <span className="w-14 text-right">Duration</span>
                <span className="w-20 text-right">Size</span>
                <span className="w-6" />
              </div>
              {items.map((item) => (
                <ListRow
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={() => handleCardSelect(item)}
                  onDelete={() => {
                    setConfirmDeleteId(item.id);
                    setConfirmDeleteName(item.name);
                  }}
                  checked={selectedItems.has(item.id)}
                  onCheck={() => setSelectedItems((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                />
              ))}
            </div>
          ) : (
            <div className={`grid gap-4 ${view === 'grid-lg' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7'}`}>
              {items.map((item) => (
                <GridCard
                  key={item.id}
                  item={item}
                  large={view === 'grid-lg'}
                  selected={selectedId === item.id}
                  onSelect={() => handleCardSelect(item)}
                  onDelete={() => {
                    setConfirmDeleteId(item.id);
                    setConfirmDeleteName(item.name);
                  }}
                  checked={selectedItems.has(item.id)}
                  onCheck={() => setSelectedItems((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                />
              ))}
            </div>
          )}

          {total > 50 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                disabled={page <= 1}
                onClick={() => updateBrowseParams((params) => {
                  params.set('page', String(page - 1));
                })}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text)] transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-[var(--text-muted)]">
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button
                disabled={page >= Math.ceil(total / 50)}
                onClick={() => updateBrowseParams((params) => {
                  params.set('page', String(page + 1));
                })}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:text-[var(--text)] transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk action toolbar ── */}
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
            onClick={() => setMoveFolderOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--blue)]/15 border border-[var(--blue)]/30 text-[var(--blue)] text-xs font-semibold hover:bg-[var(--blue)]/25 transition-colors"
          >
            <Grid3X3 size={12} /> Move Folder
          </button>
          <button
            onClick={() => {
              setConfirmBulkDelete(true);
            }}
            disabled={bulkDeleteMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/25 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={12} /> Delete {selectedItems.size}
          </button>
        </div>
      )}

      {/* ── Upload modal ── */}
      {uploadOpen && wsId && (
        <UploadModal workspaceId={wsId} onClose={() => setUploadOpen(false)} />
      )}

      {bulkTagOpen && wsId && (
        <BulkTagModal
          workspaceId={wsId}
          entityType="content"
          entityIds={[...selectedItems]}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setSelectedItems(new Set());
            void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
          }}
        />
      )}

      {publishPickerOpen && wsId && publishCandidate && (
        <PublishWizardModal
          open={publishPickerOpen}
          contentId={publishCandidate.id}
          contentName={publishCandidate.name}
          workspaceId={wsId}
          onClose={() => setPublishPickerOpen(false)}
          onDone={() => setPublishPickerOpen(false)}
        />
      )}

      {moveFolderOpen && wsId && (
        <Modal onClose={() => setMoveFolderOpen(false)} size="sm">
          <ModalHeader
            title="Move to Folder"
            subtitle={`Move ${selectedItems.size} selected item${selectedItems.size === 1 ? '' : 's'} to a folder.`}
            onClose={() => setMoveFolderOpen(false)}
          />
          <ModalBody>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Destination</label>
            <select
              value={moveFolderId}
              onChange={(e) => setMoveFolderId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
            >
              <option value="root">Unfiled</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </ModalBody>
          <ModalFooter className="modal-footer-plain">
            <ModalSecondaryButton onClick={() => setMoveFolderOpen(false)}>Cancel</ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => moveFolderMut.mutate(moveFolderId === 'root' ? null : moveFolderId)}
              disabled={moveFolderMut.isPending}
            >
              {moveFolderMut.isPending ? 'Moving…' : 'Move'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}

      {/* ── Content detail panel ── */}
      {selectedId && wsId && (
        <ContentDetailPanel
          itemId={selectedId}
          workspaceId={wsId}
          onClose={() => setSelectedId(null)}
          onDeleted={() => setSelectedId(null)}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Content"
        message={`Delete "${confirmDeleteName}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={deleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (confirmDeleteId) deleteMut.mutate(confirmDeleteId);
        }}
        onClose={() => {
          setConfirmDeleteId(null);
          setConfirmDeleteName('');
        }}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Content"
        message={`Delete ${selectedItems.size} item(s)? This cannot be undone.`}
        confirmLabel="Delete"
        confirmPendingLabel="Deleting…"
        isConfirming={bulkDeleteMut.isPending}
        closeOnConfirm={false}
        onConfirm={() => bulkDeleteMut.mutate([...selectedItems])}
        onClose={() => setConfirmBulkDelete(false)}
      />
      </div>
    </div>
  );
}
