import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, HardDrive, Server, RefreshCw, Database } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import { PageHeader, SectionCard, SectionCardBody, SectionCardHeader } from '../../components/UiPrimitives.js';

interface SystemHealth {
  process: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    uptime: number;
    nodeVersion: string;
  };
  os: {
    platform: string;
    arch: string;
    totalMem: number;
    freeMem: number;
    usedMem: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    uptime: number;
    cpus: number;
  };
  db: {
    totalOrgs: number;
    totalUsers: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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
        <div className="p-12 text-center text-[var(--text-muted)]">Loading metrics…</div>
      )}

      {data && (
        <>
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
          <div className="grid grid-cols-2 gap-6">
            <SectionCard>
              <SectionCardHeader>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Cpu size={16} /> CPU &amp; OS
                </h2>
              </SectionCardHeader>
              <SectionCardBody>
                <MetricRow label="Platform" value={`${data.os.platform} (${data.os.arch})`} />
                <MetricRow label="CPU cores" value={data.os.cpus} />
                <MetricRow label="Load avg (1m)" value={data.os.loadAvg1.toFixed(2)} />
                <MetricRow label="Load avg (5m)" value={data.os.loadAvg5.toFixed(2)} />
                <MetricRow label="Load avg (15m)" value={data.os.loadAvg15.toFixed(2)} />
                <MetricRow label="OS uptime" value={formatUptime(data.os.uptime)} />
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
                <MetricRow label="Process uptime" value={formatUptime(data.process.uptime)} />
                <MetricRow label="Heap used" value={formatBytes(data.process.heapUsed)} />
                <MetricRow label="Heap total" value={formatBytes(data.process.heapTotal)} />
                <MetricRow label="Heap utilization" value={`${((data.process.heapUsed / data.process.heapTotal) * 100).toFixed(1)}%`} />
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
              <div className="grid grid-cols-2 gap-6">
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
              </div>
            </SectionCardBody>
          </SectionCard>
        </>
      )}
    </div>
  );
}
