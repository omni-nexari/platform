import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { RefreshCw, Server, ShieldAlert, Wifi, HardDrive, Database, Radio, Globe, Lock } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  EmptyState,
  Modal,
  ModalBody,
  ModalHeader,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface NetdataPoint {
  labels: string[];
  data: number[][];
}

interface MqttStats {
  broker?: { version: string | null; uptimeSeconds: number };
  clients?: { connected: number; active: number; total: number };
  messages?: { received: number; sent: number; stored: number; storeCount: number };
  subscriptions?: { count: number };
  load?: {
    msgs: { received1m: number; received5m: number; sent1m: number; sent5m: number };
    bytes: { received1m: number; received5m: number; sent1m: number; sent5m: number };
    connections1m: number;
  };
}

interface GoAccessReport {
  visitors?: { data: Array<{ hits: { count: number }; visitors: { count: number } }> };
  requests?: { data: Array<{ data: string; hits: { count: number; percent: number }; bytes: { count: number } }> };
  not_found?: { data: Array<{ data: string; hits: { count: number } }> };
  status_codes?: { data: Array<{ data: string; hits: { count: number; percent: number } }> };
  avg_time?: { data: Array<{ data: string; hits: { count: number } }> };
}

interface SslStatus {
  daysRemaining: number | null;
}

interface BackupStatus {
  raw: string;
  timestamp: string | null;
  status: string | null;
  size: string | null;
  filename: string | null;
}

interface CrowdSecDecision {
  id: number;
  origin: string;
  type: string;
  scope: string;
  value: string;
  duration: string;
  scenario: string;
  until: string;
}

interface NetdataAlarms {
  alarms: Record<string, { status: string; name: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function netdataUrl(chart: string, after = -60, points = 1) {
  return `/monitoring/netdata?chart=${encodeURIComponent(chart)}&after=${after}&points=${points}&format=json`;
}

function extractFirstValue(data: NetdataPoint | null | undefined, labelHint?: string): number | null {
  if (!data?.data?.[0] || !data.labels) return null;
  if (labelHint) {
    const idx = data.labels.indexOf(labelHint);
    if (idx !== -1) return data.data[0][idx] ?? null;
  }
  // First non-time value
  const timeIdx = data.labels.indexOf('time');
  const valIdx = timeIdx === 0 ? 1 : 0;
  return data.data[0][valIdx] ?? null;
}

function sumValues(data: NetdataPoint | null | undefined): number {
  if (!data?.data?.[0]) return 0;
  const timeIdx = data.labels?.indexOf('time') ?? -1;
  return data.data[0].reduce((sum, v, i) => (i === timeIdx ? sum : sum + (v ?? 0)), 0);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function sslTone(days: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (days === null) return 'neutral';
  if (days >= 30) return 'success';
  if (days >= 10) return 'warning';
  return 'danger';
}

function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="flex items-center justify-between py-2 border-b last:border-0"
      style={{ borderColor: 'var(--card-border)' }}
    >
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      <span className="text-sm font-mono font-medium">{value}</span>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <Badge tone={ok ? 'success' : 'danger'}>{label}</Badge>;
}

// ── Page ─────────────────────────────────────────────────────────────────────

const CHARTS = [
  'system.cpu',
  'system.ram',
  'disk_space./',
  'net.eth0',
  'nginx_local.connections',
  'nginx_local.connections_statuses',
  'nginx_local.requests',
  'postgres_local.connections_state',
  'redis_local.clients',
  'redis_local.commands',
] as const;

type ChartId = (typeof CHARTS)[number];

export default function InfraMonitoringPage() {
  const [mqttOpen, setMqttOpen] = useState(false);
  const results = useQueries({
    queries: [
      ...CHARTS.map((chart) => ({
        queryKey: ['infra-netdata', chart],
        queryFn: () => saApi.get<NetdataPoint>(netdataUrl(chart)),
        refetchInterval: 60_000,
        retry: false,
      })),
      {
        queryKey: ['infra-traffic'],
        queryFn: () => saApi.get<GoAccessReport>('/monitoring/traffic'),
        refetchInterval: 60_000,
        retry: false,
      },
      {
        queryKey: ['infra-mqtt'],
        queryFn: () => saApi.get<MqttStats>('/monitoring/mqtt'),
        refetchInterval: 60_000,
        retry: false,
      },
      {
        queryKey: ['infra-ssl'],
        queryFn: () => saApi.get<SslStatus>('/monitoring/ssl-status'),
        refetchInterval: 300_000,
        retry: false,
      },
      {
        queryKey: ['infra-backup'],
        queryFn: () => saApi.get<BackupStatus>('/monitoring/backup-status'),
        refetchInterval: 300_000,
        retry: false,
      },
      {
        queryKey: ['infra-crowdsec'],
        queryFn: () => saApi.get<CrowdSecDecision[] | null>('/monitoring/crowdsec/decisions'),
        refetchInterval: 120_000,
        retry: false,
      },
      {
        queryKey: ['infra-alarms'],
        queryFn: () => saApi.get<NetdataAlarms>('/monitoring/netdata/alarms'),
        refetchInterval: 60_000,
        retry: false,
      },
    ],
  });

  const chartIndex = (chart: ChartId) => CHARTS.indexOf(chart);
  const nd = (chart: ChartId) => results[chartIndex(chart)]?.data as NetdataPoint | undefined;
  const ndLoading = (chart: ChartId) => results[chartIndex(chart)]?.isLoading ?? false;

  const offset = CHARTS.length;
  const traffic = results[offset]?.data as GoAccessReport | undefined;
  const mqtt = results[offset + 1]?.data as MqttStats | undefined;
  const mqttLoading = results[offset + 1]?.isLoading ?? false;
  const ssl = results[offset + 2]?.data as SslStatus | undefined;
  const backup = results[offset + 3]?.data as BackupStatus | undefined;
  const crowdsec = results[offset + 4]?.data as CrowdSecDecision[] | null | undefined;
  const alarms = results[offset + 5]?.data as NetdataAlarms | undefined;

  const anyLoading = results.some((r) => r.isLoading);
  const lastUpdated = results[0]?.dataUpdatedAt;

  const cpuPct = sumValues(nd('system.cpu'));
  const ramData = nd('system.ram');
  const ramUsed = extractFirstValue(ramData, 'used') ?? 0;
  const ramFree = extractFirstValue(ramData, 'free') ?? 0;
  const ramTotal = ramUsed + ramFree + (extractFirstValue(ramData, 'cached') ?? 0) + (extractFirstValue(ramData, 'buffers') ?? 0);
  const diskData = nd('disk_space./');
  const diskUsed = extractFirstValue(diskData, 'used') ?? 0;
  const diskAvail = extractFirstValue(diskData, 'avail') ?? 0;
  const diskTotal = diskUsed + diskAvail;
  const netIn = extractFirstValue(nd('net.eth0'), 'received') ?? 0;
  const netOut = extractFirstValue(nd('net.eth0'), 'sent') ?? 0;

  const nginxActive = extractFirstValue(nd('nginx_local.connections'), 'active') ?? 0;
  const nginxStatuses = nd('nginx_local.connections_statuses');
  const nginxReqSec = sumValues(nd('nginx_local.requests'));

  const pgConnections = sumValues(nd('postgres_local.connections_state'));
  const redisClients = sumValues(nd('redis_local.clients'));
  const redisCmds = sumValues(nd('redis_local.commands'));

  const activeAlarmCount = alarms
    ? Object.values(alarms.alarms).filter((a) => a.status !== 'CLEAR').length
    : 0;

  const decisionsArr = Array.isArray(crowdsec) ? crowdsec : [];
  const [showAllDecisions, setShowAllDecisions] = useState(false);
  const DECISIONS_PREVIEW = 5;
  const visibleDecisions = showAllDecisions ? decisionsArr : decisionsArr.slice(0, DECISIONS_PREVIEW);

  // GoAccess helpers
  const todayVisitors = traffic?.visitors?.data?.[0]?.visitors?.count ?? null;
  const topRequests = traffic?.requests?.data?.slice(0, 5) ?? [];
  const statusCodes = traffic?.status_codes?.data ?? [];

  function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
    const pct = total > 0 ? (used / total) * 100 : 0;
    const color = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--blue)';
    return (
      <div className="mb-4 last:mb-0">
        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
          <span>{label}</span>
          <span>
            {formatBytes(used * 1024 * 1024)} / {formatBytes(total * 1024 * 1024)} ({pct.toFixed(1)}%)
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, pct).toFixed(1)}%`, background: color }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <PageHeader
        className="workspace-page-header mb-0"
        title="Infrastructure"
        subtitle="Live monitoring from Netdata, GoAccess, Mosquitto, and CrowdSec — auto-refreshes every 60 seconds"
        trailing={
          lastUpdated ? (
            <span className="text-xs text-[var(--text-muted)]">
              Last updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          ) : null
        }
        action={
          anyLoading ? (
            <RefreshCw size={14} className="animate-spin text-[var(--text-muted)]" />
          ) : null
        }
      />

      {anyLoading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {/* ── Status Bar ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SectionCard>
          <SectionCardBody>
            <div className="flex items-start gap-3">
              <Lock size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)] mb-1">SSL Certificate</p>
                {ssl ? (
                  <>
                    <p className="text-2xl font-bold">{ssl.daysRemaining ?? '?'}</p>
                    <Badge tone={sslTone(ssl.daysRemaining)}>
                      {ssl.daysRemaining !== null ? `${ssl.daysRemaining} days` : 'Unknown'}
                    </Badge>
                  </>
                ) : (
                  <Skeleton className="h-8 w-16 rounded" />
                )}
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardBody>
            <div className="flex items-start gap-3">
              <Database size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)] mb-1">Last PG Backup</p>
                {backup ? (
                  <>
                    <p className="text-sm font-mono truncate">{backup.size ?? '—'}</p>
                    <Badge tone={backup.status === 'OK' ? 'success' : 'danger'}>
                      {backup.status ?? 'Unknown'}
                    </Badge>
                    <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
                      {formatDate(backup.timestamp)}
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-8 w-24 rounded" />
                )}
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardBody>
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)] mb-1">CrowdSec Bans</p>
                <p className="text-2xl font-bold">{decisionsArr.length}</p>
                <Badge tone={decisionsArr.length === 0 ? 'success' : 'danger'}>
                  {decisionsArr.length === 0 ? 'Clean' : 'Active bans'}
                </Badge>
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardBody>
            <div className="flex items-start gap-3">
              <Server size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)] mb-1">Netdata Alarms</p>
                <p className="text-2xl font-bold">{activeAlarmCount}</p>
                <Badge tone={activeAlarmCount === 0 ? 'success' : 'warning'}>
                  {activeAlarmCount === 0 ? 'All clear' : 'Active'}
                </Badge>
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* ── System Resources ────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <HardDrive size={16} /> System Resources
          </h2>
        </SectionCardHeader>
        <SectionCardBody>
          {ndLoading('system.cpu') ? (
            <Skeleton className="h-32 rounded" />
          ) : (
            <>
              <div className="mb-4 last:mb-0">
                <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                  <span>CPU Usage</span>
                  <span>{cpuPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--card-border)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, cpuPct).toFixed(1)}%`,
                      background: cpuPct > 90 ? 'var(--danger)' : cpuPct > 70 ? 'var(--warning)' : 'var(--blue)',
                    }}
                  />
                </div>
              </div>
              <UsageBar used={ramUsed} total={ramTotal} label="RAM" />
              <UsageBar used={diskUsed} total={diskTotal} label="Disk (root)" />
              <MetricRow label="Network in" value={`${Math.abs(netIn).toFixed(1)} KB/s`} />
              <MetricRow label="Network out" value={`${Math.abs(netOut).toFixed(1)} KB/s`} />
            </>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* ── Nginx & HTTP Traffic ─────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Wifi size={16} /> Nginx
            </h2>
          </SectionCardHeader>
          <SectionCardBody>
            {ndLoading('nginx_local.connections') ? (
              <Skeleton className="h-24 rounded" />
            ) : (
              <>
                <MetricRow label="Active connections" value={Math.round(nginxActive)} />
                <MetricRow
                  label="Reading"
                  value={Math.round(extractFirstValue(nginxStatuses, 'reading') ?? 0)}
                />
                <MetricRow
                  label="Writing"
                  value={Math.round(extractFirstValue(nginxStatuses, 'writing') ?? 0)}
                />
                <MetricRow
                  label="Idle"
                  value={Math.round(extractFirstValue(nginxStatuses, 'idle') ?? 0)}
                />
                <MetricRow label="Requests/sec" value={Math.abs(nginxReqSec).toFixed(1)} />
              </>
            )}
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Globe size={16} /> HTTP Traffic
            </h2>
          </SectionCardHeader>
          <SectionCardBody>
            {!traffic ? (
              <Skeleton className="h-24 rounded" />
            ) : (
              <>
                <MetricRow label="Unique visitors today" value={todayVisitors ?? '—'} />
                <div className="mt-3">
                  <p className="text-xs text-[var(--text-muted)] mb-2">Status codes</p>
                  <div className="flex flex-wrap gap-2">
                    {statusCodes.map((sc) => (
                      <Badge
                        key={sc.data}
                        tone={
                          sc.data.startsWith('2')
                            ? 'success'
                            : sc.data.startsWith('4')
                              ? 'warning'
                              : sc.data.startsWith('5')
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {sc.data} ({sc.hits.count})
                      </Badge>
                    ))}
                    {statusCodes.length === 0 && (
                      <span className="text-xs text-[var(--text-muted)]">No data</span>
                    )}
                  </div>
                </div>
                {topRequests.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-[var(--text-muted)] mb-2">Top endpoints</p>
                    <div className="space-y-1">
                      {topRequests.map((r) => (
                        <div
                          key={r.data}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-mono truncate text-[var(--text-muted)]">{r.data}</span>
                          <span className="shrink-0 font-semibold">{r.hits.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* ── MQTT & Databases ──────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          className="cursor-pointer hover:ring-2 hover:ring-[var(--accent)] transition-shadow"
          onClick={() => setMqttOpen(true)}
        >
          <SectionCardHeader>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Radio size={16} /> MQTT
            </h2>
            <span className="text-xs text-[var(--text-muted)]">click for details</span>
          </SectionCardHeader>
          <SectionCardBody>
            {mqttLoading ? (
              <Skeleton className="h-20 rounded" />
            ) : (
              <>
                <MetricRow label="Connected clients" value={mqtt?.clients?.connected ?? '—'} />
                <MetricRow label="Messages received" value={mqtt?.messages?.received ?? '—'} />
                <MetricRow label="Messages sent" value={mqtt?.messages?.sent ?? '—'} />
                <MetricRow label="Subscriptions" value={mqtt?.subscriptions?.count ?? '—'} />
              </>
            )}
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Database size={16} /> PostgreSQL
            </h2>
          </SectionCardHeader>
          <SectionCardBody>
            {ndLoading('postgres_local.connections_state') ? (
              <Skeleton className="h-20 rounded" />
            ) : (
              <MetricRow label="Connections" value={Math.round(pgConnections)} />
            )}
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Server size={16} /> Redis
            </h2>
          </SectionCardHeader>
          <SectionCardBody>
            {ndLoading('redis_local.clients') ? (
              <Skeleton className="h-20 rounded" />
            ) : (
              <>
                <MetricRow label="Connected clients" value={Math.round(redisClients)} />
                <MetricRow label="Commands/sec" value={Math.abs(redisCmds).toFixed(1)} />
              </>
            )}
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* ── CrowdSec Decisions ────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldAlert size={16} /> CrowdSec Active Decisions
          </h2>
        </SectionCardHeader>
        <SectionCardBody>
          {!crowdsec ? (
            <Skeleton className="h-20 rounded" />
          ) : decisionsArr.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert size={24} />}
              title="No active bans"
              description="CrowdSec has no active ban decisions at this time."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)] border-b" style={{ borderColor: 'var(--card-border)' }}>
                    <th className="pb-2 pr-4">IP / Scope</th>
                    <th className="pb-2 pr-4">Scenario</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2">Until</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDecisions.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b last:border-0"
                      style={{ borderColor: 'var(--card-border)' }}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{d.value}</td>
                      <td className="py-2 pr-4 text-xs text-[var(--text-muted)]">{d.scenario}</td>
                      <td className="py-2 pr-4">
                        <Badge tone="danger">{d.type}</Badge>
                      </td>
                      <td className="py-2 text-xs text-[var(--text-muted)]">{formatDate(d.until)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {decisionsArr.length > DECISIONS_PREVIEW && (
                <button
                  onClick={() => setShowAllDecisions((v) => !v)}
                  className="mt-3 text-xs text-[var(--accent)] hover:underline"
                >
                  {showAllDecisions
                    ? 'Show less'
                    : `Show ${decisionsArr.length - DECISIONS_PREVIEW} more…`}
                </button>
              )}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* ── MQTT Detail Modal ─────────────────────────────────────────────────── */}
      {mqttOpen && (
        <Modal open={mqttOpen} onClose={() => setMqttOpen(false)} size="md">
          <ModalHeader title="MQTT Broker Details" icon={<Radio size={18} />} onClose={() => setMqttOpen(false)} />
          <ModalBody>
            {mqttLoading ? (
              <Skeleton className="h-48 rounded" />
            ) : !mqtt ? (
              <p className="text-sm text-[var(--text-muted)]">No data available</p>
            ) : (
              <div className="space-y-5">
                {/* Broker info */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Broker</p>
                  <div className="rounded border divide-y" style={{ borderColor: 'var(--card-border)' }}>
                    <MetricRow label="Version" value={mqtt.broker?.version ?? '—'} />
                    <MetricRow label="Uptime" value={formatUptime(mqtt.broker?.uptimeSeconds ?? 0)} />
                  </div>
                </div>

                {/* Clients */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Clients</p>
                  <div className="rounded border divide-y" style={{ borderColor: 'var(--card-border)' }}>
                    <MetricRow label="Connected" value={mqtt.clients?.connected ?? 0} />
                    <MetricRow label="Active" value={mqtt.clients?.active ?? 0} />
                    <MetricRow label="Total (ever)" value={mqtt.clients?.total ?? 0} />
                  </div>
                </div>

                {/* Messages */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Messages (cumulative)</p>
                  <div className="rounded border divide-y" style={{ borderColor: 'var(--card-border)' }}>
                    <MetricRow label="Received" value={mqtt.messages?.received ?? 0} />
                    <MetricRow label="Sent" value={mqtt.messages?.sent ?? 0} />
                    <MetricRow label="Stored (retained)" value={mqtt.messages?.stored ?? 0} />
                  </div>
                </div>

                {/* Subscriptions */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Subscriptions</p>
                  <div className="rounded border divide-y" style={{ borderColor: 'var(--card-border)' }}>
                    <MetricRow label="Active subscriptions" value={mqtt.subscriptions?.count ?? 0} />
                    <MetricRow label="New connections/min (1m avg)" value={(mqtt.load?.connections1m ?? 0).toFixed(2)} />
                  </div>
                </div>

                {/* Load */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Load averages</p>
                  <div className="rounded border overflow-hidden" style={{ borderColor: 'var(--card-border)' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-[var(--text-muted)] border-b" style={{ borderColor: 'var(--card-border)' }}>
                          <th className="text-left py-2 px-3 font-medium">Metric</th>
                          <th className="text-right py-2 px-3 font-medium">1 min</th>
                          <th className="text-right py-2 px-3 font-medium">5 min</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                          <td className="py-2 px-3 text-[var(--text-muted)]">Msgs received/s</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.msgs.received1m ?? 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.msgs.received5m ?? 0).toFixed(2)}</td>
                        </tr>
                        <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                          <td className="py-2 px-3 text-[var(--text-muted)]">Msgs sent/s</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.msgs.sent1m ?? 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.msgs.sent5m ?? 0).toFixed(2)}</td>
                        </tr>
                        <tr className="border-b" style={{ borderColor: 'var(--card-border)' }}>
                          <td className="py-2 px-3 text-[var(--text-muted)]">Bytes received/s</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.bytes.received1m ?? 0).toFixed(1)}</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.bytes.received5m ?? 0).toFixed(1)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-3 text-[var(--text-muted)]">Bytes sent/s</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.bytes.sent1m ?? 0).toFixed(1)}</td>
                          <td className="py-2 px-3 text-right font-mono">{(mqtt.load?.bytes.sent5m ?? 0).toFixed(1)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
