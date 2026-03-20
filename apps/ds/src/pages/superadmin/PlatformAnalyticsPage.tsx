import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart2,
  Building2,
  Download,
  HardDrive,
  Layers,
  Monitor,
  Play,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { saApi, saDownloadBlob, saImpersonateOrg } from '../../lib/superadmin-auth.js';
import {
  buildPortalAnalyticsAlerts,
  buildWorkspaceViewPath,
  type PortalAnalyticsResponse,
  formatBytes,
  formatDelta,
  formatDuration,
  getDeltaTone,
  toDateInput,
  type WorkspaceDrilldownView,
} from '../../lib/portal-analytics.js';
import PortalTrendChart from '../../components/PortalTrendChart.js';
import { Badge, Callout, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

function StatCard({
  label,
  value,
  detail,
  delta,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  delta?: { change: number; percentChange: number | null } | null;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <Icon size={16} />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        {delta ? <Badge tone={getDeltaTone(delta.change)}>{formatDelta(delta.change, delta.percentChange)}</Badge> : null}
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {detail ? <p className="mt-2 text-xs text-[var(--text-muted)]">{detail}</p> : null}
    </div>
  );
}

function setRangeDays(setFrom: (value: string) => void, setTo: (value: string) => void, days: number) {
  const nextTo = new Date();
  const nextFrom = new Date(nextTo.getTime() - days * 86_400_000);
  setFrom(toDateInput(nextFrom));
  setTo(toDateInput(nextTo));
}

export default function PlatformAnalyticsPage() {
  const navigate = useNavigate();
  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 30 * 86_400_000);

  const [from, setFrom] = useState(toDateInput(defaultFrom));
  const [to, setTo] = useState(toDateInput(defaultTo));
  const [compareMode, setCompareMode] = useState<'none' | 'previous_period'>('previous_period');
  const [openingDrilldownId, setOpeningDrilldownId] = useState<string | null>(null);

  const params = new URLSearchParams({
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
    compare: compareMode,
  });

  const { data, isLoading } = useQuery<PortalAnalyticsResponse>({
    queryKey: ['platform-analytics', from, to, compareMode],
    queryFn: () => saApi.get(`/superadmin/analytics?${params}`),
  });

  const exportCsv = async () => {
    try {
      const blob = await saDownloadBlob(`/superadmin/analytics/export.csv?${params}`);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `platform-analytics-${from}-to-${to}.csv`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'CSV export failed');
    }
  };

  const openWorkspaceDrilldown = async (
    id: string,
    orgId: string,
    workspaceId: string,
    view: WorkspaceDrilldownView,
    searchParams?: Record<string, string>,
  ) => {
    setOpeningDrilldownId(id);
    try {
      await saImpersonateOrg(orgId);
      navigate(buildWorkspaceViewPath(workspaceId, view, searchParams));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open drilldown');
    } finally {
      setOpeningDrilldownId(null);
    }
  };

  const alerts = data ? buildPortalAnalyticsAlerts(data) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <PageHeader
        icon={<BarChart2 size={22} />}
        title="Platform Analytics"
        subtitle="Cross-platform visibility across resellers, client organizations, usage, and growth."
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setRangeDays(setFrom, setTo, 7)} className="workspace-page-action">Last 7</button>
            <button onClick={() => setRangeDays(setFrom, setTo, 30)} className="workspace-page-action">Last 30</button>
            <button onClick={() => setRangeDays(setFrom, setTo, 90)} className="workspace-page-action">Last 90</button>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="input h-9 px-3 text-sm" />
            <span className="text-sm text-[var(--text-muted)]">to</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="input h-9 px-3 text-sm" />
            <select value={compareMode} onChange={(event) => setCompareMode(event.target.value as 'none' | 'previous_period')} className="input h-9 px-3 text-sm">
              <option value="previous_period">vs previous period</option>
              <option value="none">no comparison</option>
            </select>
            <button onClick={() => void exportCsv()} className="workspace-page-action">
              <Download size={14} />
              Export CSV
            </button>
          </div>
        )}
      />

      {data?.comparison ? (
        <div className="rounded-2xl border px-5 py-4 text-sm text-[var(--text-muted)]" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
          Comparing {new Date(data.from).toLocaleDateString()} - {new Date(data.to).toLocaleDateString()} against {new Date(data.comparison.previousFrom).toLocaleDateString()} - {new Date(data.comparison.previousTo).toLocaleDateString()}.
        </div>
      ) : null}

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {alerts.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {alerts.map((alert) => {
                const drilldown = alert.drilldown;
                return (
                  <Callout key={alert.id} tone={alert.tone} className="flex items-start justify-between gap-4 rounded-2xl px-5 py-4">
                    <div>
                      <p className="text-sm font-semibold">{alert.title}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{alert.description}</p>
                    </div>
                    {drilldown ? (
                      <button
                        type="button"
                        onClick={() => void openWorkspaceDrilldown(alert.id, drilldown.orgId, drilldown.workspaceId, drilldown.view, drilldown.searchParams)}
                        disabled={openingDrilldownId === alert.id}
                        className="workspace-page-action whitespace-nowrap"
                      >
                        <ArrowRight size={14} />
                        {openingDrilldownId === alert.id ? 'Opening...' : (alert.drilldownLabel ?? 'Review')}
                      </button>
                    ) : null}
                  </Callout>
                );
              })}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Resellers" value={data.summary.totalResellers.toLocaleString()} detail={`${data.summary.totalPendingResellerInvites} pending admin invites`} delta={data.comparison?.deltas.totalResellers ?? null} icon={Layers} />
            <StatCard label="Client Organizations" value={data.summary.totalOrganizations.toLocaleString()} detail={`${data.summary.suspendedOrganizations} suspended`} delta={data.comparison?.deltas.totalOrganizations ?? null} icon={Building2} />
            <StatCard label="Total Users" value={data.summary.totalUsers.toLocaleString()} detail={`${data.summary.totalWorkspaces.toLocaleString()} workspaces`} delta={data.comparison?.deltas.totalUsers ?? null} icon={Users} />
            <StatCard label="Devices" value={data.summary.totalDevices.toLocaleString()} detail={`${data.summary.onlineDevices.toLocaleString()} online`} delta={data.comparison?.deltas.totalDevices ?? null} icon={Monitor} />
            <StatCard label="Plays In Range" value={data.summary.totalPlays.toLocaleString()} detail={formatDuration(data.summary.totalPlayDurationMs)} delta={data.comparison?.deltas.totalPlays ?? null} icon={Play} />
            <StatCard label="Storage" value={formatBytes(data.summary.totalStorageUsedBytes)} detail={`${formatBytes(data.summary.totalStorageLimitBytes)} provisioned`} delta={data.comparison?.deltas.totalStorageUsedBytes ?? null} icon={HardDrive} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <PortalTrendChart
              title="Organization Growth"
              subtitle="Monthly client organization creation volume in the selected scope."
              color="var(--blue)"
              points={data.organizationsByMonth.map((entry) => ({
                label: new Date(`${entry.month}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
                value: entry.organizations,
                secondary: `${entry.organizations.toLocaleString()} organizations`,
              }))}
            />
            <PortalTrendChart
              title="Proof Of Play Trend"
              subtitle="Daily play counts with hover detail for playback volume and duration."
              color="var(--aqua)"
              points={data.playsByDay.map((entry) => ({
                label: new Date(`${entry.date}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                value: entry.plays,
                secondary: formatDuration(entry.durationMs),
              }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
              <p className="mb-4 text-sm font-semibold">Organization Plans</p>
              <div className="flex flex-wrap gap-2">
                {data.planBreakdown.map((entry) => (
                  <Badge key={entry.plan} tone="neutral">{entry.plan}: {entry.count}</Badge>
                ))}
              </div>
              <div className="mt-5 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Content Items</span>
                  <span className="font-medium tabular-nums">{data.summary.totalContentItems.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Playlists</span>
                  <span className="font-medium tabular-nums">{data.summary.totalPlaylists.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Schedules</span>
                  <span className="font-medium tabular-nums">{data.summary.totalSchedules.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Active Schedules</span>
                  <span className="font-medium tabular-nums">{data.summary.activeSchedules.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Screenshots</span>
                  <span className="font-medium tabular-nums">{data.summary.totalScreenshots.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
              <div className="border-b px-5 py-4" style={{ borderColor: 'var(--card-border)' }}>
                <p className="text-sm font-semibold">Top Resellers</p>
              </div>
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th>Reseller</th>
                    <th>Organizations</th>
                    <th>Devices</th>
                    <th>Users</th>
                    <th>Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topResellers.map((entry) => (
                    <tr key={entry.companyId}>
                      <td>
                        <Link to={`/superadmin/companies/${entry.companyId}`} className="font-medium transition-colors hover:text-[var(--blue)]">{entry.name}</Link>
                        <p className="text-xs text-[var(--text-muted)]">{entry.suspendedOrgCount} suspended orgs</p>
                      </td>
                      <td className="tabular-nums">{entry.orgCount}</td>
                      <td className="tabular-nums">{entry.deviceCount}</td>
                      <td className="tabular-nums">{entry.userCount}</td>
                      <td className="tabular-nums">{formatBytes(entry.storageUsedBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="border-b px-5 py-4" style={{ borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold">Workspace Drilldowns</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Jump straight into live org workspace views with filters applied.</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Organization</th>
                  <th>Devices</th>
                  <th>Content</th>
                  <th>Plays</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.topWorkspaces.map((entry) => (
                  <tr key={entry.workspaceId}>
                    <td>
                      <div className="font-medium">{entry.name}</div>
                      <p className="text-xs text-[var(--text-muted)]">{entry.slug}</p>
                    </td>
                    <td>
                      <Link to={`/superadmin/orgs/${entry.orgId}`} className="font-medium transition-colors hover:text-[var(--blue)]">{entry.orgName}</Link>
                      <p className="text-xs text-[var(--text-muted)]">{entry.resellerName ?? 'Direct'}</p>
                    </td>
                    <td className="tabular-nums">{entry.onlineDeviceCount}/{entry.deviceCount}</td>
                    <td className="tabular-nums">{entry.contentCount}</td>
                    <td className="tabular-nums">{entry.playCount.toLocaleString()}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void openWorkspaceDrilldown(`workspace-${entry.workspaceId}`, entry.orgId, entry.workspaceId, 'workspace')}
                          disabled={openingDrilldownId === `workspace-${entry.workspaceId}`}
                          className="workspace-page-action"
                        >
                          Overview
                        </button>
                        <button
                          type="button"
                          onClick={() => void openWorkspaceDrilldown(`devices-${entry.workspaceId}`, entry.orgId, entry.workspaceId, 'devices', entry.offlineDeviceCount > 0 ? { status: 'offline' } : undefined)}
                          disabled={openingDrilldownId === `devices-${entry.workspaceId}`}
                          className="workspace-page-action"
                        >
                          Devices
                        </button>
                        <button
                          type="button"
                          onClick={() => void openWorkspaceDrilldown(`content-${entry.workspaceId}`, entry.orgId, entry.workspaceId, 'content', { sort: 'size' })}
                          disabled={openingDrilldownId === `content-${entry.workspaceId}`}
                          className="workspace-page-action"
                        >
                          Content
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="border-b px-5 py-4" style={{ borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold">Top Client Organizations</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Reseller</th>
                  <th>Workspaces</th>
                  <th>Devices</th>
                  <th>Users</th>
                  <th>Plays</th>
                  <th>Storage</th>
                </tr>
              </thead>
              <tbody>
                {data.topOrganizations.map((entry) => (
                  <tr key={entry.orgId}>
                    <td>
                      <Link to={`/superadmin/orgs/${entry.orgId}`} className="font-medium transition-colors hover:text-[var(--blue)]">{entry.name}</Link>
                      <p className="text-xs text-[var(--text-muted)]">{entry.slug}</p>
                    </td>
                    <td>{entry.resellerName ?? 'Direct'}</td>
                    <td className="tabular-nums">{entry.workspaceCount}</td>
                    <td className="tabular-nums">{entry.deviceCount}</td>
                    <td className="tabular-nums">{entry.userCount}</td>
                    <td className="tabular-nums">{entry.playCount.toLocaleString()}</td>
                    <td className="tabular-nums">{formatBytes(entry.storageUsedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-2xl border" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="border-b px-5 py-4" style={{ borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold">Recent Organizations</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Reseller</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrganizations.map((entry) => (
                  <tr key={entry.orgId}>
                    <td>
                      <Link to={`/superadmin/orgs/${entry.orgId}`} className="font-medium transition-colors hover:text-[var(--blue)]">{entry.name}</Link>
                      <p className="text-xs text-[var(--text-muted)]">{entry.slug}</p>
                    </td>
                    <td>{entry.resellerName ?? 'Direct'}</td>
                    <td>
                      <Badge tone={entry.status === 'active' ? 'success' : 'warning'}>
                        {entry.status === 'active' ? 'Active' : 'Suspended'}
                      </Badge>
                    </td>
                    <td className="text-[var(--text-muted)]">{new Date(entry.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}