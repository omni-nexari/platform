import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, HardDrive, Server, RefreshCw, Database, Wifi, FolderKanban } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import { Badge, PageHeader, SectionCard, SectionCardBody, SectionCardHeader, Skeleton } from '../../components/UiPrimitives.js';

interface SystemHealth {
  process: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    uptime: number;
    nodeVersion: string;
    pid: number;
  };
  os: {
    hostname: string;
    platform: string;
    arch: string;
    release: string;
    totalMem: number;
    freeMem: number;
    usedMem: number;
    cpuUsagePercent: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    uptime: number;
    cpus: number;
  };
  db: {
    totalOrgs: number;
    totalUsers: number;
    totalWorkspaces: number;
    totalDevices: number;
    totalManagementCompanies: number;
  };
  storage: {
    rootPath: string;
    statsPath: string;
    exactPathExists: boolean;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    workspaceUploads: Array<{
      workspaceId: string;
      workspaceName: string;
      orgId: string | null;
      orgName: string | null;
      bytes: number;
    }>;
    managementBranding: Array<{
      managementCompanyId: string;
      companyName: string;
      companySlug: string | null;
      bytes: number;
    }>;
  };
  services: {
    postgres: {
      ok: boolean;
      latencyMs: number;
      host: string | null;
      database: string | null;
      error: string | null;
    };
    redis: {
      configured: boolean;
      ok: boolean;
      latencyMs: number | null;
      host: string | null;
      error: string | null;
    };
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return 'N/A';
  return `${ms} ms`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--card-border)' }}>
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      <span className="text-sm font-mono font-medium">{value}</span>
    </div>
  );
}

function ServiceStatus({ ok, label }: { ok: boolean; label: string }) {
  return <Badge tone={ok ? 'success' : 'danger'}>{label}</Badge>;
}

function UsageTable({
  rows,
  emptyMessage,
}: {
  rows: Array<{ label: string; sublabel?: string | null; bytes: number }>;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={`${row.label}-${row.sublabel ?? ''}`} className="rounded-xl border p-3" style={{ borderColor: 'var(--card-border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.label}</p>
              {row.sublabel ? <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{row.sublabel}</p> : null}
            </div>
            <span className="text-sm font-mono shrink-0">{formatBytes(row.bytes)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--blue)';
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
        <span>{label}</span>
        <span>{formatBytes(used)} / {formatBytes(total)} ({pct.toFixed(1)}%)</span>
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

export default function SystemHealthPage() {
  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['sa-system-health'],
    queryFn: () => saApi.get<SystemHealth>('/superadmin/system/health'),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <PageHeader
        className="workspace-page-header mb-0"
        title="System Health"
        subtitle="Real-time server metrics — auto-refreshes every 30 seconds"
        trailing={
          dataUpdatedAt ? (
            <span className="text-xs text-[var(--text-muted)]">
              Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          ) : null
        }
        action={
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Server size={16} /> Host Machine
                </h2>
              </SectionCardHeader>
              <SectionCardBody>
                <MetricRow label="Hostname" value={data.os.hostname} />
                <MetricRow label="Platform" value={`${data.os.platform} (${data.os.arch})`} />
                <MetricRow label="OS release" value={data.os.release} />
                <MetricRow label="OS uptime" value={formatUptime(data.os.uptime)} />
                <MetricRow label="CPU cores" value={data.os.cpus} />
              </SectionCardBody>
            </SectionCard>

            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Wifi size={16} /> Service Connectivity
                </h2>
              </SectionCardHeader>
              <SectionCardBody className="space-y-4">
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)' }}>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div>
                      <p className="text-sm font-semibold">PostgreSQL</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {data.services.postgres.host ?? 'Unknown host'}
                        {data.services.postgres.database ? ` / ${data.services.postgres.database}` : ''}
                      </p>
                    </div>
                    <ServiceStatus ok={data.services.postgres.ok} label={data.services.postgres.ok ? 'Connected' : 'Error'} />
                  </div>
                  <MetricRow label="Latency" value={formatLatency(data.services.postgres.latencyMs)} />
                  {data.services.postgres.error ? (
                    <p className="text-xs text-[var(--danger)] mt-2">{data.services.postgres.error}</p>
                  ) : null}
                </div>

                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)' }}>
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div>
                      <p className="text-sm font-semibold">Redis</p>
                      <p className="text-xs text-[var(--text-muted)]">{data.services.redis.host ?? 'Not configured'}</p>
                    </div>
                    <ServiceStatus
                      ok={data.services.redis.configured && data.services.redis.ok}
                      label={!data.services.redis.configured ? 'Not configured' : data.services.redis.ok ? 'Connected' : 'Error'}
                    />
                  </div>
                  <MetricRow label="Latency" value={formatLatency(data.services.redis.latencyMs)} />
                  {data.services.redis.error ? (
                    <p className="text-xs text-[var(--danger)] mt-2">{data.services.redis.error}</p>
                  ) : null}
                </div>
              </SectionCardBody>
            </SectionCard>
          </div>

          {/* Memory usage bars */}
          <SectionCard>
            <SectionCardHeader>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <HardDrive size={16} /> Memory
              </h2>
            </SectionCardHeader>
            <SectionCardBody>
              <UsageBar used={data.os.usedMem} total={data.os.totalMem} label="System RAM" />
              <UsageBar used={data.process.heapUsed} total={data.process.heapTotal} label="Node.js Heap" />
              <MetricRow label="Process RSS" value={formatBytes(data.process.rss)} />
              <MetricRow label="External memory" value={formatBytes(data.process.external)} />
            </SectionCardBody>
          </SectionCard>

          {/* OS metrics */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Cpu size={16} /> CPU &amp; OS
                </h2>
              </SectionCardHeader>
              <SectionCardBody>
                <MetricRow label="CPU usage" value={`${data.os.cpuUsagePercent.toFixed(1)}%`} />
                <MetricRow label="Load avg (1m)" value={data.os.loadAvg1.toFixed(2)} />
                <MetricRow label="Load avg (5m)" value={data.os.loadAvg5.toFixed(2)} />
                <MetricRow label="Load avg (15m)" value={data.os.loadAvg15.toFixed(2)} />
                <MetricRow label="System RAM used" value={formatBytes(data.os.usedMem)} />
                <MetricRow label="System RAM free" value={formatBytes(data.os.freeMem)} />
              </SectionCardBody>
            </SectionCard>

            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Server size={16} /> Node.js Process
                </h2>
              </SectionCardHeader>
              <SectionCardBody>
                <MetricRow label="Version" value={data.process.nodeVersion} />
                <MetricRow label="PID" value={data.process.pid} />
                <MetricRow label="Process uptime" value={formatUptime(data.process.uptime)} />
                <MetricRow label="Heap used" value={formatBytes(data.process.heapUsed)} />
                <MetricRow label="Heap total" value={formatBytes(data.process.heapTotal)} />
                <MetricRow label="Heap utilization" value={`${((data.process.heapUsed / data.process.heapTotal) * 100).toFixed(1)}%`} />
              </SectionCardBody>
            </SectionCard>
          </div>

          <SectionCard>
            <SectionCardHeader>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <FolderKanban size={16} /> Storage
              </h2>
            </SectionCardHeader>
            <SectionCardBody>
              <UsageBar used={data.storage.usedBytes} total={data.storage.totalBytes} label="Filesystem usage" />
              <MetricRow label="Configured root" value={data.storage.rootPath} />
              <MetricRow label="Stats collected from" value={data.storage.statsPath} />
              <MetricRow label="Exact storage path exists" value={data.storage.exactPathExists ? 'Yes' : 'No'} />
              <MetricRow label="Free space" value={formatBytes(data.storage.freeBytes)} />
            </SectionCardBody>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold">Workspace Upload Usage</h2>
              </SectionCardHeader>
              <SectionCardBody>
                <UsageTable
                  rows={data.storage.workspaceUploads.map((row) => ({
                    label: row.workspaceName,
                    sublabel: row.orgName ? `${row.orgName} · ${row.workspaceId}` : row.workspaceId,
                    bytes: row.bytes,
                  }))}
                  emptyMessage="No workspace upload folders found under the configured storage root."
                />
              </SectionCardBody>
            </SectionCard>

            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold">Management Company Branding Usage</h2>
              </SectionCardHeader>
              <SectionCardBody>
                <UsageTable
                  rows={data.storage.managementBranding.map((row) => ({
                    label: row.companyName,
                    sublabel: row.companySlug ? `${row.companySlug} · ${row.managementCompanyId}` : row.managementCompanyId,
                    bytes: row.bytes,
                  }))}
                  emptyMessage="No management-company branding upload folders found."
                />
              </SectionCardBody>
            </SectionCard>
          </div>

          {/* DB stats */}
          <SectionCard>
            <SectionCardHeader>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Database size={16} /> Database
              </h2>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--blue)', opacity: 0.8 }}>
                    <Activity size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.db.totalOrgs.toLocaleString()}</p>
                    <p className="text-xs text-[var(--text-muted)]">Active Organizations</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--green)', opacity: 0.8 }}>
                    <Activity size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.db.totalUsers.toLocaleString()}</p>
                    <p className="text-xs text-[var(--text-muted)]">Total Users</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--warning)', opacity: 0.85 }}>
                    <Activity size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.db.totalManagementCompanies.toLocaleString()}</p>
                    <p className="text-xs text-[var(--text-muted)]">Management Companies</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--aqua)', opacity: 0.85 }}>
                    <Activity size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.db.totalWorkspaces.toLocaleString()}</p>
                    <p className="text-xs text-[var(--text-muted)]">Workspaces</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--danger)', opacity: 0.85 }}>
                    <Activity size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.db.totalDevices.toLocaleString()}</p>
                    <p className="text-xs text-[var(--text-muted)]">Devices</p>
                  </div>
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>
        </>
      )}
    </div>
  );
}
