import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, buildApiUrl } from '../lib/api.js';
import { useAuthStore } from '../lib/auth.js';
import { useCmsEnabled, usePosEnabled } from '../lib/modules.js';
import { Skeleton } from '../components/UiPrimitives.js';
import {
  Monitor,
  ListVideo,
  CalendarDays,
  Plus,
  ChevronDown,
  HardDrive,
  Play,
  ShoppingCart,
  DollarSign,
  Clock,
  Receipt,
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

interface WsSummary {
  deviceTotal: number;
  deviceOnline: number;
  deviceOffline: number;
  deviceError: number;
  devicePowerOn: number;
  devicePowerOff: number;
  contentStats: { type: string; total: number; published: number }[];
  playlistTotal: number;
  playlistActive: number;
  playlistPublishedCount: number;
  scheduleTotal: number;
  scheduleActive: number;
  schedulePublishedCount: number;
}

interface SignageAnalytics {
  totalPlays: number;
  byDay: { date: string; plays: number; durationMs: number }[];
}

interface PosAnalytics {
  totalOrders: number;
  totalRevenue: number;
  avgTicket: number;
  byDay: { date: string; orders: number; revenue: number }[];
}

interface DeviceRow {
  id: string;
  name: string;
  status: string;
  latestScreenshotId: string | null;
  latestFrameAt: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeGreeting(name: string) {
  const h = new Date().getHours();
  const w = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${w}, ${name.split(' ')[0]}`;
}

// ── Compact stat card (matches marketing preview style) ───────────────────────

function StatCard({
  label, value, tone, icon: Icon, onClick,
}: {
  label: string;
  value: string | number;
  tone: string;
  icon: React.ElementType;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-4 flex flex-col gap-2 transition-colors duration-150 ${onClick ? 'cursor-pointer' : ''}`}
      style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.borderColor = tone + '66'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.borderColor = 'var(--card-border)'; }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: tone + '22' }}>
          <Icon size={13} style={{ color: tone }} />
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: tone }}>{value}</div>
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChart({
  data, color, label,
}: {
  data: number[];
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...data);
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
      <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-end gap-1 h-20">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t min-h-[2px] transition-all"
            style={{
              height: `${(v / max) * 100}%`,
              background: `linear-gradient(180deg, ${color}, ${color}33)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Live screens grid ─────────────────────────────────────────────────────────

function LiveScreensGrid({ devices }: { devices: DeviceRow[] }) {
  const slots = devices.slice(0, 9);
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}>
      <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Live screens</p>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 9 }).map((_, i) => {
          const device = slots[i];
          const isOnline = device?.status === 'online';
          const hasShot = !!device?.latestScreenshotId;
          return (
            <div
              key={i}
              className="aspect-video rounded overflow-hidden relative"
              style={{
                background: isOnline
                  ? 'rgba(58,123,255,0.15)'
                  : 'rgba(255,255,255,0.05)',
              }}
            >
              {device && hasShot && (
                <img
                  src={buildApiUrl(`/devices/${device.id}/screenshots/${device.latestScreenshotId}${device.latestFrameAt ? `?t=${device.latestFrameAt}` : ''}`)}
                  alt={device.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              {device && isOnline && !hasShot && (
                <div
                  className="absolute inset-0 rounded"
                  style={{ background: 'rgba(79,242,209,0.18)' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OrgDashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const cmsEnabled = useCmsEnabled();
  const posEnabled = usePosEnabled();
  const [searchParams, setSearchParams] = useSearchParams();
  const [wsOpen, setWsOpen] = useState(false);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(searchParams.get('workspaceId'));

  const { data: me } = useQuery<OrgInfo>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me'),
    enabled: !!user,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
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

  // Workspace summary (device / playlist / schedule counts)
  const { data: summary, isLoading: loadingSummary } = useQuery<WsSummary>({
    queryKey: ['ws-summary', selectedWsId],
    queryFn: () => api.get(`/workspaces/${selectedWsId}/summary`),
    enabled: !!selectedWsId,
    refetchInterval: 30_000,
  });

  // Signage analytics — 14 days for chart + today's play count
  const analyticsFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return d.toISOString().slice(0, 10);
  })();
  const analyticsTo = todayIso();

  const { data: signageAnalytics } = useQuery<SignageAnalytics>({
    queryKey: ['dash-signage-analytics', selectedWsId, analyticsFrom],
    queryFn: () =>
      api.get(
        `/analytics/summary?workspaceId=${selectedWsId}&from=${analyticsFrom}T00:00:00.000Z&to=${analyticsTo}T23:59:59.999Z`,
      ),
    enabled: !!selectedWsId && cmsEnabled,
    refetchInterval: 60_000,
    select: (d: any) => ({
      totalPlays: Number(d.totalPlays ?? 0),
      byDay: (d.byDay ?? []) as SignageAnalytics['byDay'],
    }),
  });

  // POS analytics — 14 days for chart + today's order/revenue totals
  const { data: posAnalytics } = useQuery<PosAnalytics>({
    queryKey: ['dash-pos-analytics', selectedWsId, analyticsFrom],
    queryFn: () =>
      api.get(
        `/pos/analytics/summary?workspaceId=${selectedWsId}&from=${analyticsFrom}T00:00:00.000Z&to=${analyticsTo}T23:59:59.999Z`,
      ),
    enabled: !!selectedWsId && posEnabled,
    refetchInterval: 60_000,
    select: (d: any) => ({
      totalOrders: Number(d.totalOrders ?? 0),
      totalRevenue: Number(d.totalRevenue ?? 0),
      avgTicket: Number(d.avgTicket ?? 0),
      byDay: (d.byDay ?? []) as PosAnalytics['byDay'],
    }),
  });

  // Devices list (for live screens thumbnails)
  const { data: devices = [] } = useQuery<DeviceRow[]>({
    queryKey: ['dash-devices', selectedWsId],
    queryFn: () => api.get(`/devices?workspaceId=${selectedWsId}`),
    enabled: !!selectedWsId && cmsEnabled,
    refetchInterval: 30_000,
    select: (list: any[]) =>
      list.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        latestScreenshotId: d.latestScreenshotId ?? null,
        latestFrameAt: d.latestFrameAt ?? null,
      })),
  });

  // Derived today stats
  const today = todayIso();
  const signageTodayEntry = signageAnalytics?.byDay.find((d) => d.date === today);
  const playsToday = signageTodayEntry?.plays ?? signageAnalytics?.totalPlays ?? 0;
  const signageChartData = (signageAnalytics?.byDay ?? []).map((d) => d.plays);

  const posTodayEntry = posAnalytics?.byDay.find((d) => d.date === today);
  const ordersToday = posTodayEntry?.orders ?? 0;
  const revenueToday = posTodayEntry?.revenue ?? 0; // already in dollars from pos analytics
  const posChartData = (posAnalytics?.byDay ?? []).map((d) => d.orders);

  // POS pending from live stats endpoint
  const { data: posLiveStats } = useQuery<{ pendingOrders: number; avgTicketCents: number }>({
    queryKey: ['dash-pos-live', selectedWsId],
    queryFn: () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const f = thirtyDaysAgo.toISOString();
      const t = new Date().toISOString();
      return api.get(`/pos/mgmt/orders/stats/summary?workspaceId=${selectedWsId}&from=${f}&to=${t}`);
    },
    enabled: !!selectedWsId && posEnabled,
    refetchInterval: 30_000,
  });

  const storage    = me?.storage;
  const storagePct = storage ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
  const storageUsed  = formatBytes(storage?.usedBytes ?? 0);
  const storageLimit = formatBytes(storage?.limitBytes ?? 0);
  const userName   = me?.user.name ?? '';

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
      <div className="p-6 max-w-6xl mx-auto w-full space-y-8">

        {/* ── Signage section ─────────────────────────────────────────────── */}
        {cmsEnabled && (
          <div>
            {posEnabled && (
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#3b82f6' }}>
                Signage
              </p>
            )}

            {/* Stat cards */}
            {loadingSummary ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <StatCard
                  label="Online Devices"
                  value={summary?.deviceOnline ?? 0}
                  tone="#22c55e"
                  icon={Monitor}
                  onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/devices`)}
                />
                <StatCard
                  label="Active Playlists"
                  value={summary?.playlistActive ?? 0}
                  tone="#3b82f6"
                  icon={ListVideo}
                  onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/playlist`)}
                />
                <StatCard
                  label="Active Schedules"
                  value={summary?.scheduleActive ?? 0}
                  tone="#2dd4bf"
                  icon={CalendarDays}
                  onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/schedule`)}
                />
                <StatCard
                  label="Plays Today"
                  value={playsToday >= 1000 ? `${(playsToday / 1000).toFixed(1)}k` : playsToday}
                  tone="#ff3ea5"
                  icon={Play}
                  onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/analytics`)}
                />
              </div>
            )}

            {/* Chart + Live screens */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                {signageChartData.length > 0 ? (
                  <BarChart data={signageChartData} color="#3b82f6" label="Playback activity (14 days)" />
                ) : (
                  <div
                    className="rounded-xl border p-4 flex items-center justify-center h-full"
                    style={{ background: 'var(--card)', borderColor: 'var(--card-border)', minHeight: 120 }}
                  >
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No playback data yet</span>
                  </div>
                )}
              </div>
              <LiveScreensGrid devices={devices} />
            </div>
          </div>
        )}

        {/* ── POS section ─────────────────────────────────────────────────── */}
        {posEnabled && (
          <div>
            {cmsEnabled && (
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#f59e0b' }}>
                Point of Sale
              </p>
            )}

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard
                label="Orders Today"
                value={ordersToday}
                tone="#f59e0b"
                icon={ShoppingCart}
                onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/pos/orders`)}
              />
              <StatCard
                label="Revenue Today"
                value={revenueToday >= 1000 ? `$${(revenueToday / 1000).toFixed(1)}k` : `$${revenueToday.toFixed(2)}`}
                tone="#22c55e"
                icon={DollarSign}
                onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/pos/analytics`)}
              />
              <StatCard
                label="Pending Orders"
                value={posLiveStats?.pendingOrders ?? 0}
                tone="#fbbf24"
                icon={Clock}
                onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/pos/orders`)}
              />
              <StatCard
                label="Avg Ticket"
                value={formatMoney(posLiveStats?.avgTicketCents ?? 0)}
                tone="#a78bfa"
                icon={Receipt}
                onClick={() => selectedWsId && navigate(`/workspaces/${selectedWsId}/pos/analytics`)}
              />
            </div>

            {/* POS chart */}
            {posChartData.length > 0 ? (
              <BarChart data={posChartData} color="#f59e0b" label="Orders (14 days)" />
            ) : (
              <div
                className="rounded-xl border p-4 flex items-center justify-center"
                style={{ background: 'var(--card)', borderColor: 'var(--card-border)', minHeight: 120 }}
              >
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No order data yet</span>
              </div>
            )}
          </div>
        )}

        {/* ── Storage ─────────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <HardDrive className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Storage</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{storagePct.toFixed(1)}% used</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
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
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold" style={{ color: 'var(--text)' }}>{storageUsed}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>of {storageLimit} total</span>
          </div>
        </div>

      </div>
    </div>
  );
}

            {/* POS chart */}
            {posChartData.length > 0 ? (
              <BarChart data={posChartData} color="#f59e0b" label="Orders (14 days)" />
            ) : (
              <div
                className="rounded-xl border p-4 flex items-center justify-center"
                style={{ background: 'var(--card)', borderColor: 'var(--card-border)', minHeight: 120 }}
              >
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No order data yet</span>
              </div>
            )}
          </div>
        )}

        {/* ── Storage ─────────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <HardDrive className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Storage</span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{storagePct.toFixed(1)}% used</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
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
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold" style={{ color: 'var(--text)' }}>{storageUsed}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>of {storageLimit} total</span>
          </div>
        </div>

      </div>
    </div>
  );
}
