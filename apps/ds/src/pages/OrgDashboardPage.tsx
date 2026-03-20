import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Skeleton } from '../components/UiPrimitives.js';
import {
  Monitor,
  Image,
  ListVideo,
  CalendarDays,
  Plus,
  ChevronDown,
  HardDrive,
  Lock,
} from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

interface OrgInfo {
  user: { id: string; name: string; email: string; orgRole: string };
  org: { id: string; name: string; plan: string };
  storage: { usedBytes: number; limitBytes: number };
}

interface ContentTypeStat {
  type: string;
  total: number;
  published: number;
}

interface WsSummary {
  deviceTotal: number;
  deviceOnline: number;
  deviceOffline: number;
  deviceError: number;
  contentStats: ContentTypeStat[];
  playlistTotal: number;
  playlistActive: number;
  scheduleTotal: number;
  scheduleActive: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function timeGreeting(name: string) {
  const h = new Date().getHours();
  const w = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${w}, ${name.split(' ')[0]}`;
}

// ── Device Card ────────────────────────────────────────────────────────────────

function DeviceCard({
  total, online, offline, error, onClick, onAdd,
}: {
  total: number; online: number; offline: number; error: number;
  onClick?: () => void; onAdd?: () => void;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div
      className="rounded-2xl border flex flex-col overflow-hidden transition-colors duration-200 cursor-pointer"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--card-border)')}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #3b82f6, #38bdf8)' }} />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
              style={{ background: 'rgba(59,130,246,0.15)' }}
            >
              <Monitor className="w-5 h-5" style={{ color: '#60a5fa' }} />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Total Devices
            </p>
            <div className="text-4xl font-bold tracking-tight mt-0.5" style={{ color: 'var(--text)' }}>
              {total}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onAdd?.(); }}
            className="w-8 h-8 rounded-xl border flex items-center justify-center transition-all"
            style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)', background: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(59,130,246,0.6)';
              e.currentTarget.style.color = '#60a5fa';
              e.currentTarget.style.background = 'rgba(59,130,246,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--card-border)';
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-auto">
          <div className="flex h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {pct(online)  > 0 && <div style={{ width: `${pct(online)}%`,  background: '#34d399', transition: 'width 0.7s ease' }} />}
            {pct(error)   > 0 && <div style={{ width: `${pct(error)}%`,   marginLeft: 2, background: '#fbbf24', transition: 'width 0.7s ease' }} />}
            {pct(offline) > 0 && <div style={{ width: `${pct(offline)}%`, marginLeft: 2, background: '#475569', transition: 'width 0.7s ease' }} />}
            {total === 0  && <div className="w-full" style={{ background: 'rgba(255,255,255,0.07)' }} />}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {([
              { label: 'Online',  count: online,  color: '#34d399' },
              { label: 'Error',   count: error,   color: '#fbbf24' },
              { label: 'Offline', count: offline, color: '#475569' },
            ] as const).map(({ label, count, color }) => (
              <div key={label}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
                </div>
                <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Content Card ──────────────────────────────────────────────────────────────

const CONTENT_TYPE_META: Record<string, { label: string; color: string }> = {
  image:        { label: 'Image',   color: '#f59e0b' },
  video:        { label: 'Video',   color: '#38bdf8' },
  html5:        { label: 'HTML5',   color: '#4ade80' },
  pdf:          { label: 'PDF',     color: '#f87171' },
  presentation: { label: 'PPTX',   color: '#c084fc' },
  web_url:      { label: 'Web URL', color: '#60a5fa' },
};

const TYPE_ORDER = ['image', 'video', 'html5', 'pdf', 'presentation', 'web_url'];

function ContentCard({
  stats,
  onClick,
}: {
  stats: ContentTypeStat[];
  onClick?: () => void;
}) {
  const ordered = TYPE_ORDER
    .map(t => stats.find(s => s.type === t))
    .filter((s): s is ContentTypeStat => !!s && s.total > 0);
  const totalAll     = stats.reduce((s, r) => s + r.total, 0);
  const publishedAll = stats.reduce((s, r) => s + r.published, 0);

  return (
    <div
      onClick={onClick}
      className="rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} />
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.15)' }}>
            <Image className="w-4 h-4" style={{ color: '#fbbf24' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Content</span>
        </div>
        {totalAll > 0 && (
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: '#f59e0b' }}>{publishedAll}</span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}> / </span>
            {totalAll}
          </span>
        )}
      </div>

      <div
        className="mx-3 rounded-xl overflow-hidden relative px-3 py-3 flex flex-col justify-center"
        style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg, #1f1a10 0%, #0c0a06 100%)' }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, #f59e0b 0%, transparent 65%)', opacity: 0.12 }}
        />
        {ordered.length === 0 ? (
          <div className="relative flex flex-col items-center justify-center gap-1.5">
            <div style={{ opacity: 0.2, transform: 'scale(2.8)' }}>
              <Image className="w-4 h-4" style={{ color: '#fbbf24' }} />
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col gap-1.5">
            {ordered.map(s => {
              const meta = CONTENT_TYPE_META[s.type] ?? { label: s.type, color: '#94a3b8' };
              return (
                <div key={s.type} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                  <span className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{meta.label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: meta.color }}>{s.published}</span>
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
                  <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.total}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Upload images, videos &amp; HTML5 packages.</p>
      </div>
    </div>
  );
}

// ── Playlist Card ─────────────────────────────────────────────────────────────

function PlaylistCard({
  total,
  active,
  onClick,
}: {
  total: number;
  active: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #8b5cf6, #a855f7)' }} />
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}>
            <ListVideo className="w-4 h-4" style={{ color: '#a78bfa' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Playlists</span>
        </div>
        {total > 0 && (
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: '#a78bfa' }}>{active}</span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}> / </span>
            {total}
          </span>
        )}
      </div>

      <div
        className="mx-3 rounded-xl overflow-hidden relative flex flex-col items-center justify-center gap-2"
        style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg, #130e1e 0%, #0a0810 100%)' }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, #8b5cf6 0%, transparent 65%)', opacity: 0.14 }}
        />
        {total === 0 ? (
          <div className="relative flex flex-col items-center justify-center gap-1.5">
            <div style={{ opacity: 0.2, transform: 'scale(2.8)' }}>
              <ListVideo className="w-4 h-4" style={{ color: '#a78bfa' }} />
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col gap-1.5 w-full px-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#a78bfa' }} />
              <span className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Published</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: '#a78bfa' }}>{active}</span>
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#475569' }} />
              <span className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Draft</span>
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{total - active}</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sequence content &amp; control playback durations.</p>
      </div>
    </div>
  );
}

// ── Schedule Card ────────────────────────────────────────────────────────────

function ScheduleCard({
  total,
  active,
  onClick,
}: {
  total: number;
  active: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30"
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #14b8a6, #10b981)' }} />
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(20,184,166,0.15)' }}>
            <CalendarDays className="w-4 h-4" style={{ color: '#2dd4bf' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Schedule</span>
        </div>
        {total > 0 && (
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: '#2dd4bf' }}>{active}</span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}> / </span>
            {total}
          </span>
        )}
      </div>

      <div
        className="mx-3 rounded-xl overflow-hidden relative flex flex-col items-center justify-center"
        style={{ aspectRatio: '16/9', background: 'linear-gradient(135deg, #0a1614 0%, #060e0c 100%)' }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, #14b8a6 0%, transparent 65%)', opacity: 0.14 }}
        />
        {total === 0 ? (
          <div className="relative flex flex-col items-center justify-center gap-1.5">
            <div style={{ opacity: 0.2, transform: 'scale(2.8)' }}>
              <CalendarDays className="w-4 h-4" style={{ color: '#2dd4bf' }} />
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col gap-1.5 w-full px-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#2dd4bf' }} />
              <span className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Active</span>
              <span className="text-xs font-bold tabular-nums" style={{ color: '#2dd4bf' }}>{active}</span>
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>/</span>
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#475569' }} />
              <span className="text-xs flex-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Inactive</span>
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>{total - active}</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Time-based playback scheduling across devices.</p>
      </div>
    </div>
  );
}

// ── Module (Coming Soon) Card ──────────────────────────────────────────────────

function ModuleCard({
  label, icon, topGradient, iconBg, glowColor, previewBg, description, onClick, live,
}: {
  label: string;
  icon: React.ReactNode;
  topGradient: string;
  iconBg: string;
  glowColor: string;
  previewBg: string;
  description: string;
  onClick?: () => void;
  live?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border flex flex-col overflow-hidden transition-all duration-200
        ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/30' : ''}`}
      style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
    >
      <div className="h-0.5 w-full" style={{ background: topGradient }} />
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: iconBg }}>
            {icon}
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
        </div>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border
            ${live
              ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
              : ''}`}
          style={live ? {} : { borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
        >
          {live ? 'Live' : 'Soon'}
        </span>
      </div>
      <div
        className="mx-3 rounded-xl overflow-hidden relative flex items-center justify-center"
        style={{ aspectRatio: '16/9', background: previewBg }}
      >
        <div className="absolute inset-0"
          style={{ backgroundImage: `radial-gradient(circle at 50% 50%, ${glowColor} 0%, transparent 65%)`, opacity: 0.28 }}
        />
        <div className="relative" style={{ opacity: 0.2, transform: 'scale(2.8)' }}>{icon}</div>
        {!live && (
          <div
            className="absolute bottom-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Lock className="w-2.5 h-2.5" style={{ color: 'rgba(255,255,255,0.45)' }} />
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OrgDashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [wsOpen, setWsOpen] = useState(false);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(searchParams.get('workspaceId'));

  const { data: me } = useQuery<OrgInfo>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me'),
  });

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
  });

  useEffect(() => {
    if (!selectedWsId && workspaces.length > 0) {
      setSelectedWsId(workspaces[0]!.id);
    }
  }, [workspaces, selectedWsId]);

  useEffect(() => {
    const requestedWorkspaceId = searchParams.get('workspaceId');
    if (requestedWorkspaceId && requestedWorkspaceId !== selectedWsId) {
      setSelectedWsId(requestedWorkspaceId);
    }
  }, [searchParams, selectedWsId]);

  useEffect(() => {
    if (!selectedWsId) return;
    const next = new URLSearchParams(searchParams);
    if (next.get('workspaceId') === selectedWsId) return;
    next.set('workspaceId', selectedWsId);
    setSearchParams(next, { replace: true });
  }, [searchParams, selectedWsId, setSearchParams]);

  const selectedWs = workspaces.find((w) => w.id === selectedWsId);

  const { data: summary, isLoading: loadingSummary } = useQuery<WsSummary>({
    queryKey: ['ws-summary', selectedWsId],
    queryFn: () => api.get(`/workspaces/${selectedWsId}/summary`),
    enabled: !!selectedWsId,
    refetchInterval: 30_000,
  });

  const storage      = me?.storage;
  const storagePct   = storage ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
  const storageUsed  = formatBytes(storage?.usedBytes ?? 0);
  const storageLimit = formatBytes(storage?.limitBytes ?? 0);
  const userName     = me?.user.name ?? '';

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero header */}
      <div
        className="border-b px-8 py-6"
        style={{
          borderColor: 'var(--card-border)',
          background: 'linear-gradient(135deg, var(--bg) 0%, color-mix(in srgb, #3b82f6 5%, var(--bg)) 100%)',
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            {userName && (
              <p className="text-sm mb-0.5" style={{ color: 'var(--text-muted)' }}>
                {timeGreeting(userName)}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              {me?.org.name ?? '—'}
            </h1>
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mt-1.5 border"
              style={{ background: 'var(--card)', borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
            >
              {me?.org.plan ?? 'starter'} plan
            </span>
          </div>

          {workspaces.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setWsOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors"
                style={{ borderColor: 'var(--card-border)', background: 'var(--card)', color: 'var(--text)' }}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: '#34d399', boxShadow: '0 0 6px #34d399' }}
                />
                <span>{selectedWs?.name ?? 'Select workspace'}</span>
                <ChevronDown
                  className="w-3.5 h-3.5 transition-transform"
                  style={{ color: 'var(--text-muted)', transform: wsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              {wsOpen && (
                <div
                  className="absolute top-full mt-1 right-0 z-20 min-w-48 rounded-xl border shadow-xl overflow-hidden"
                  style={{ borderColor: 'var(--card-border)', background: 'var(--bg)' }}
                >
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => { setSelectedWsId(ws.id); setWsOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-[var(--card)]"
                      style={{ color: ws.id === selectedWsId ? 'var(--blue)' : 'var(--text)', fontWeight: ws.id === selectedWsId ? 600 : 400 }}
                    >
                      {ws.name}
                    </button>
                  ))}
                  <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--card-border)' }}>
                    <button
                      onClick={() => setWsOpen(false)}
                      className="flex items-center gap-2 text-xs transition-colors hover:text-[var(--blue)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Plus className="w-3 h-3" /> New workspace
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {workspaces.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No workspaces yet.</p>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="p-8 max-w-6xl mx-auto w-full">
        {/* Module cards */}
        {loadingSummary ? (
          <div className="grid grid-cols-4 gap-4 mb-5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4 mb-5">
            <DeviceCard
              total={summary?.deviceTotal ?? 0}
              online={summary?.deviceOnline ?? 0}
              offline={summary?.deviceOffline ?? 0}
              error={summary?.deviceError ?? 0}
              onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}`)}
              onAdd={() => selectedWsId && navigate(`/workspaces/${selectedWsId}`)}
            />
            <ContentCard
              stats={summary?.contentStats ?? []}
              onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/content`)}
            />
            <PlaylistCard
              total={summary?.playlistTotal ?? 0}
              active={summary?.playlistActive ?? 0}
              onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/playlist`)}
            />
            <ScheduleCard
              total={summary?.scheduleTotal ?? 0}
              active={summary?.scheduleActive ?? 0}
              onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/schedule`)}
            />
          </div>
        )}

        {/* Storage */}
        <div className="grid grid-cols-1 gap-4">
          <div
            className="rounded-2xl border p-5 flex flex-col justify-between"
            style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <HardDrive className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Storage</span>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                {storagePct.toFixed(1)}% used
              </p>
            </div>
            <div>
              <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${storagePct}%`,
                    transition: 'width 0.7s ease',
                    background: storagePct > 80
                      ? 'linear-gradient(90deg, #f97316, #ef4444)'
                      : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                  }}
                />
              </div>
              <div className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{storageUsed}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>of {storageLimit} total</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
