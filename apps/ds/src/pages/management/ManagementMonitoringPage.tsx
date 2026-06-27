import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  DatabaseZap,
  Lock,
  Archive,
  Shield,
  Radio,
  Cpu,
  MemoryStick,
  Users,
  MessageSquareDot,
  RefreshCw,
} from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import { Badge, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type NetdataChartResponse = {
  labels: string[];
  data: Array<Array<number | null>>;
};

type SslStatus = { daysRemaining: number | null; error?: string };

type BackupStatus = {
  raw: string;
  timestamp: string | null;
  status: string | null;
  size: string | null;
  filename: string | null;
  error?: string;
};

type MqttStats = {
  broker: { version: string | null; uptimeSeconds: number };
  clients: { connected: number; active: number; total: number };
  messages: { received: number; sent: number; stored: number; storeCount: number };
  subscriptions: { count: number };
  load: {
    msgs: { received1m: number; received5m: number; sent1m: number; sent5m: number };
    bytes: { received1m: number; received5m: number; sent1m: number; sent5m: number };
    connections1m: number;
  };
  error?: string;
};

type CrowdSecDecision = { id: number; value: string; type: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B/s`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1048576).toFixed(1)} MB/s`;
}

/** Extract a single time series: (timestamp, value%) pairs */
function parseNetdataCpuChart(d: NetdataChartResponse): number[] {
  const idleIdx = d.labels.findIndex((l) => l === 'idle');
  if (idleIdx < 0) return [];
  return d.data.map((row) => {
    const idle = row[idleIdx] ?? 0;
    return Math.min(100, Math.max(0, +(100 - idle).toFixed(1)));
  });
}

function parseNetdataRamChart(d: NetdataChartResponse): { values: number[]; usedMb: number; totalMb: number } {
  const usedIdx = d.labels.findIndex((l) => l === 'used');
  const freeIdx = d.labels.findIndex((l) => l === 'free');
  const cachedIdx = d.labels.findIndex((l) => l === 'cached');
  const buffersIdx = d.labels.findIndex((l) => l === 'buffers');

  const lastRow = d.data.at(-1) ?? [];
  const usedMb = Math.round(((lastRow[usedIdx] ?? 0) as number) / 1024 / 1024);
  const freeMb = Math.round(((lastRow[freeIdx] ?? 0) as number) / 1024 / 1024);
  const cachedMb = Math.round(((lastRow[cachedIdx] ?? 0) as number) / 1024 / 1024);
  const buffersMb = Math.round(((lastRow[buffersIdx] ?? 0) as number) / 1024 / 1024);
  const totalMb = usedMb + freeMb + cachedMb + buffersMb;

  const values = d.data.map((row) => {
    const u = (row[usedIdx] ?? 0) as number;
    const f = (row[freeIdx] ?? 0) as number;
    const c = (row[cachedIdx] ?? 0) as number;
    const b = (row[buffersIdx] ?? 0) as number;
    const tot = u + f + c + b;
    return tot > 0 ? Math.min(100, Math.max(0, +((u / tot) * 100).toFixed(1))) : 0;
  });

  return { values, usedMb, totalMb };
}

// ── Sparkline (inline SVG, no dep) ────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="h-10" />;
  const H = 40;
  const W = 200;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - (v / max) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-10 mt-2">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ ok, okLabel, failLabel }: { ok: boolean; okLabel?: string; failLabel?: string }) {
  return (
    <Badge tone={ok ? 'success' : 'danger'}>
      {ok ? (okLabel ?? 'OK') : (failLabel ?? 'ERROR')}
    </Badge>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  pct,
  sparkValues,
  sparkColor,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  pct?: number;
  sparkValues?: number[] | undefined;
  sparkColor?: string | undefined;
  loading?: boolean | undefined;
}) {
  return (
    <div
      className="rounded-2xl border p-4 sm:p-5"
      style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
    >
      <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
        <Icon size={14} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20 mt-1" />
      ) : (
        <>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          {sub && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</div>}
          {typeof pct === 'number' && (
            <div className="mt-2 h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, pct)}%`, background: sparkColor ?? 'var(--blue)' }}
              />
            </div>
          )}
          {sparkValues && sparkValues.length > 1 && (
            <Sparkline values={sparkValues} color={sparkColor ?? 'var(--blue)'} />
          )}
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">
      {children}
    </h2>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManagementMonitoringPage() {
  const INTERVAL = 30_000;

  const cpuQ = useQuery({
    queryKey: ['monitoring-cpu'],
    queryFn: () => saApi.get<NetdataChartResponse>('/monitoring/netdata?chart=system.cpu&after=-300&points=30'),
    refetchInterval: INTERVAL,
    retry: 1,
  });

  const ramQ = useQuery({
    queryKey: ['monitoring-ram'],
    queryFn: () => saApi.get<NetdataChartResponse>('/monitoring/netdata?chart=system.ram&after=-300&points=30'),
    refetchInterval: INTERVAL,
    retry: 1,
  });

  const mqttQ = useQuery({
    queryKey: ['monitoring-mqtt'],
    queryFn: () => saApi.get<MqttStats>('/monitoring/mqtt'),
    refetchInterval: INTERVAL,
    retry: 1,
  });

  const sslQ = useQuery({
    queryKey: ['monitoring-ssl'],
    queryFn: () => saApi.get<SslStatus>('/monitoring/ssl-status'),
    refetchInterval: 5 * 60_000, // every 5 min
    retry: 1,
  });

  const backupQ = useQuery({
    queryKey: ['monitoring-backup'],
    queryFn: () => saApi.get<BackupStatus>('/monitoring/backup-status'),
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const securityQ = useQuery({
    queryKey: ['monitoring-security'],
    queryFn: () => saApi.get<CrowdSecDecision[] | null>('/monitoring/crowdsec/decisions'),
    refetchInterval: INTERVAL,
    retry: 1,
  });

  // ── Parse Netdata ──
  const cpuValues = cpuQ.data ? parseNetdataCpuChart(cpuQ.data) : [];
  const cpuPct = cpuValues.at(-1) ?? 0;

  const ramParsed = ramQ.data ? parseNetdataRamChart(ramQ.data) : null;
  const ramPct = ramParsed?.values.at(-1) ?? 0;

  // ── SSL ──
  const sslDays = sslQ.data?.daysRemaining ?? null;
  const sslOk = sslDays !== null && sslDays > 14;
  const sslTone: 'success' | 'warning' | 'danger' =
    sslDays === null ? 'danger' : sslDays > 30 ? 'success' : sslDays > 14 ? 'warning' : 'danger';

  // ── Backup ──
  const backupOk = backupQ.data?.status === 'OK';
  const backupDate = backupQ.data?.timestamp
    ? new Date(backupQ.data.timestamp).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  // ── Security ──
  const blockedCount = Array.isArray(securityQ.data) ? securityQ.data.length : null;

  // ── MQTT ──
  const mqtt = mqttQ.data;
  const mqttOk = !mqttQ.isError && mqtt != null && !mqtt.error;

  const lastRefreshed = new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Activity size={20} />}
        title="System Monitoring"
        subtitle={`Infrastructure health for this Platform installation · auto-refreshes every 30s`}
        trailing={
          <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
            <RefreshCw size={11} />
            {lastRefreshed}
          </span>
        }
      />

      {/* ── System Resources ─────────────────────────────────────── */}
      <section>
        <SectionTitle>System Resources</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={Cpu}
            label="CPU"
            value={`${cpuPct}%`}
            sub="averaged across all cores"
            pct={cpuPct}
            sparkValues={cpuValues}
            sparkColor="#38bdf8"
            loading={cpuQ.isLoading}
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={ramParsed ? `${(ramParsed.usedMb / 1024).toFixed(1)} GB` : '—'}
            sub={ramParsed ? `of ${(ramParsed.totalMb / 1024).toFixed(1)} GB total` : undefined}
            pct={ramPct}
            sparkValues={ramParsed?.values}
            sparkColor="#a78bfa"
            loading={ramQ.isLoading}
          />

          {/* SSL */}
          <div
            className="rounded-2xl border p-4 sm:p-5"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
              <Lock size={14} />
              <span className="text-[11px] font-medium uppercase tracking-wide">SSL Cert</span>
            </div>
            {sslQ.isLoading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <>
                <div className="text-2xl font-bold tabular-nums">
                  {sslDays !== null ? `${sslDays}d` : '—'}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={sslTone}>
                    {sslDays === null ? 'ERROR' : sslDays > 30 ? 'VALID' : sslDays > 14 ? 'EXPIRING' : 'CRITICAL'}
                  </Badge>
                  <span className="text-[11px] text-[var(--text-muted)]">remaining</span>
                </div>
              </>
            )}
          </div>

          {/* Backup */}
          <div
            className="rounded-2xl border p-4 sm:p-5"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
              <Archive size={14} />
              <span className="text-[11px] font-medium uppercase tracking-wide">Last Backup</span>
            </div>
            {backupQ.isLoading ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <>
                <div className="text-xl font-bold">
                  {backupQ.isError || backupQ.data?.error ? '—' : backupDate ?? '—'}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge ok={backupOk} okLabel="OK" failLabel="FAILED" />
                  {backupQ.data?.size && (
                    <span className="text-[11px] text-[var(--text-muted)]">{backupQ.data.size}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── MQTT Broker ──────────────────────────────────────────── */}
      <section>
        <SectionTitle>MQTT Broker (Mosquitto)</SectionTitle>
        {mqttQ.isError || mqtt?.error ? (
          <div
            className="rounded-2xl border p-5 text-sm text-[var(--text-muted)]"
            style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
          >
            <div className="flex items-center gap-2">
              <Badge tone="danger">UNAVAILABLE</Badge>
              <span>{mqtt?.error ?? 'Could not connect to MQTT broker'}</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              icon={Radio}
              label="Status"
              value={mqttOk ? 'UP' : '—'}
              sub={mqtt?.broker.version ?? undefined}
              loading={mqttQ.isLoading}
            />
            <MetricCard
              icon={Users}
              label="Connected"
              value={mqtt?.clients.connected ?? '—'}
              sub={`${mqtt?.clients.total ?? 0} ever connected`}
              loading={mqttQ.isLoading}
            />
            <MetricCard
              icon={MessageSquareDot}
              label="Msgs received"
              value={mqtt?.messages.received.toLocaleString() ?? '—'}
              sub={`${mqtt?.load.msgs.received1m.toFixed(1) ?? '0'}/s (1m avg)`}
              loading={mqttQ.isLoading}
            />
            <MetricCard
              icon={MessageSquareDot}
              label="Msgs sent"
              value={mqtt?.messages.sent.toLocaleString() ?? '—'}
              sub={`${mqtt?.load.msgs.sent1m.toFixed(1) ?? '0'}/s (1m avg)`}
              loading={mqttQ.isLoading}
            />
            <MetricCard
              icon={DatabaseZap}
              label="Stored msgs"
              value={mqtt?.messages.storeCount ?? '—'}
              sub={`${mqtt?.subscriptions.count ?? 0} subscriptions`}
              loading={mqttQ.isLoading}
            />
            <MetricCard
              icon={Activity}
              label="Uptime"
              value={mqtt ? fmtUptime(mqtt.broker.uptimeSeconds) : '—'}
              sub={mqtt ? `${fmtBytes(mqtt.load.bytes.received1m)} in · ${fmtBytes(mqtt.load.bytes.sent1m)} out` : undefined}
              loading={mqttQ.isLoading}
            />
          </div>
        )}
      </section>

      {/* ── Security ─────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Security (CrowdSec)</SectionTitle>
        <div
          className="rounded-2xl border p-4 sm:p-5"
          style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
        >
          {securityQ.isError ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
              <Shield size={16} />
              <span>CrowdSec not configured on this installation</span>
            </div>
          ) : (
            <div className="flex items-start gap-6">
              <div>
                <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
                  <Shield size={14} />
                  <span className="text-[11px] font-medium uppercase tracking-wide">Active Blocks</span>
                </div>
                {securityQ.isLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <div className="text-2xl font-bold tabular-nums">
                    {blockedCount ?? 0}
                  </div>
                )}
              </div>
              {Array.isArray(securityQ.data) && securityQ.data.length > 0 && (
                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-xs text-[var(--text-muted)]">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                        <th className="pb-1 text-left font-medium">IP</th>
                        <th className="pb-1 text-left font-medium pl-4">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {securityQ.data.slice(0, 10).map((d) => (
                        <tr key={d.id} className="border-b last:border-0" style={{ borderColor: 'var(--card-border)' }}>
                          <td className="py-1 font-mono">{d.value}</td>
                          <td className="py-1 pl-4">{d.type}</td>
                        </tr>
                      ))}
                      {securityQ.data.length > 10 && (
                        <tr>
                          <td colSpan={2} className="pt-1 text-[var(--text-muted)]">
                            +{securityQ.data.length - 10} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {!securityQ.isLoading && (blockedCount === null || blockedCount === 0) && (
                <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm self-center">
                  <Badge tone="success">CLEAN</Badge>
                  <span>No active blocks</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
