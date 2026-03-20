import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart2,
  Building2,
  Clock3,
  Download,
  HardDrive,
  Image,
  Monitor,
  Play,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { saApi, saDownloadBlob, saImpersonateOrg } from '../../lib/superadmin-auth.js';
import {
  buildWorkspaceViewPath,
  type PortalAnalyticsPreset,
  type PortalAnalyticsResponse,
  formatBytes,
  formatDelta,
  formatDuration,
  getDeltaTone,
  toDateInput,
  type WorkspaceDrilldownView,
} from '../../lib/portal-analytics.js';
import PortalAnalyticsControls from '../../components/PortalAnalyticsControls.js';
import PortalTrendChart from '../../components/PortalTrendChart.js';
import { Badge, Callout, PageHeader, Skeleton } from '../../components/UiPrimitives.js';

function StatCard({
  label,
  value,
  detail,
  delta,
  icon: Icon,
}: {
  label: React.ReactNode;
  value: string;
  detail?: React.ReactNode;
  delta?: { change: number; percentChange: number | null } | null;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <Icon size={16} />
          <span className="text-[11px] font-medium uppercase tracking-wide sm:text-xs">{label}</span>
        </div>
        {delta ? <Badge tone={getDeltaTone(delta.change)}>{formatDelta(delta.change, delta.percentChange)}</Badge> : null}
      </div>
      <p className="text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      {detail ? <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)] sm:mt-2 sm:text-xs">{detail}</p> : null}
    </div>
  );
}

function setRangeDays(setFrom: (value: string) => void, setTo: (value: string) => void, days: number) {
  const nextTo = new Date();
  const nextFrom = new Date(nextTo.getTime() - days * 86_400_000);
  setFrom(toDateInput(nextFrom));
  setTo(toDateInput(nextTo));
}

export default function ManagementAnalyticsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
    queryKey: ['reseller-analytics', from, to, compareMode],
    queryFn: () => saApi.get(`/superadmin/analytics?${params}`),
  });

  const { data: presets = [] } = useQuery<PortalAnalyticsPreset[]>({
    queryKey: ['reseller-analytics-presets'],
    queryFn: () => saApi.get('/superadmin/analytics/presets'),
  });

  const saveSettings = useMutation({
    mutationFn: (settings: PortalAnalyticsResponse['settings']) => saApi.put('/superadmin/analytics/preferences', settings),
    onSuccess: async () => {
      toast.success('Alert settings saved');
      await qc.invalidateQueries({ queryKey: ['reseller-analytics'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    },
  });

  const createPreset = useMutation({
    mutationFn: (payload: { name: string; orgId: string; workspaceId: string; view: WorkspaceDrilldownView; searchParams?: Record<string, string> }) =>
      saApi.post('/superadmin/analytics/presets', payload),
    onSuccess: async () => {
      toast.success('Preset saved');
      await qc.invalidateQueries({ queryKey: ['reseller-analytics-presets'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save preset');
    },
  });

  const deletePreset = useMutation({
    mutationFn: (id: string) => saApi.delete(`/superadmin/analytics/presets/${id}`),
    onSuccess: async () => {
      toast.success('Preset removed');
      await qc.invalidateQueries({ queryKey: ['reseller-analytics-presets'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete preset');
    },
  });

  const exportCsv = async () => {
    try {
      const blob = await saDownloadBlob(`/superadmin/analytics/export.csv?${params}`);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `reseller-analytics-${from}-to-${to}.csv`;
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

  const alerts = data?.alerts ?? [];

  const openPreset = async (preset: PortalAnalyticsPreset) => {
    await openWorkspaceDrilldown(`preset-${preset.id}`, preset.orgId, preset.workspaceId, preset.view, preset.searchParams);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={<BarChart2 size={22} />}
        title="Analytics"
        subtitle="Performance across your reseller portfolio of client organizations."
      />

      <div
        className="rounded-2xl border p-4 sm:p-5"
        style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setRangeDays(setFrom, setTo, 7)} className="workspace-page-action">Last 7</button>
            <button onClick={() => setRangeDays(setFrom, setTo, 30)} className="workspace-page-action">Last 30</button>
            <button onClick={() => setRangeDays(setFrom, setTo, 90)} className="workspace-page-action">Last 90</button>
          </div>
          <label className="flex w-full flex-col gap-1 xl:max-w-[240px]">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Compare</span>
            <select value={compareMode} onChange={(event) => setCompareMode(event.target.value as 'none' | 'previous_period')} className="input h-10 w-full px-3 text-sm">
              <option value="previous_period">vs previous period</option>
              <option value="none">no comparison</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div
            className="rounded-2xl border p-3 sm:p-4"
            style={{
              borderColor: 'color-mix(in srgb, var(--blue) 22%, var(--card-border) 78%)',
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--blue) 7%, var(--bg2) 93%), var(--bg2))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Range</span>
              <span className="text-xs text-[var(--text-muted)]">Custom analytics window</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="input text-sm h-10 w-full px-3" />
              <span className="text-center text-sm text-[var(--text-muted)]">to</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="input text-sm h-10 w-full px-3" />
            </div>
          </div>
          <button onClick={() => void exportCsv()} className="workspace-page-action w-full justify-center lg:w-auto">
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {data?.comparison ? (
        <div className="rounded-2xl border px-5 py-4 text-sm text-[var(--text-muted)]" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
          Comparing {new Date(data.from).toLocaleDateString()} - {new Date(data.to).toLocaleDateString()} against {new Date(data.comparison.previousFrom).toLocaleDateString()} - {new Date(data.comparison.previousTo).toLocaleDateString()}.
        </div>
      ) : null}

      {isLoading || !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <PortalAnalyticsControls
            settings={data.settings}
            presets={presets}
            workspaces={data.topWorkspaces}
            scopeLabel="reseller"
            savingSettings={saveSettings.isPending}
            creatingPreset={createPreset.isPending}
            deletingPresetId={deletePreset.isPending ? deletePreset.variables ?? null : null}
            onSaveSettings={(settings) => saveSettings.mutate(settings)}
            onCreatePreset={(preset) => createPreset.mutate(preset)}
            onOpenPreset={(preset) => void openPreset(preset)}
            onDeletePreset={(id) => deletePreset.mutate(id)}
          />

          {alerts.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {alerts.map((alert) => {
                const drilldown = alert.drilldown;
                return (
                  <Callout key={alert.id} tone={alert.tone} className="flex items-start justify-between gap-3 rounded-2xl px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
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
            <StatCard
              label={
                <>
                  <span className="sm:hidden">Client Orgs</span>
                  <span className="hidden sm:inline">Client Organizations</span>
                </>
              }
              value={data.summary.totalOrganizations.toLocaleString()}
              detail={`${data.summary.suspendedOrganizations} suspended`}
              delta={data.comparison?.deltas.totalOrganizations ?? null}
              icon={Building2}
            />
            <StatCard
              label="Total Users"
              value={data.summary.totalUsers.toLocaleString()}
              detail={`${data.summary.resellerAdminCount} reseller admins`}
              delta={data.comparison?.deltas.totalUsers ?? null}
              icon={Users}
            />
            <StatCard
              label="Devices"
              value={data.summary.totalDevices.toLocaleString()}
              detail={`${data.summary.onlineDevices} online`}
              delta={data.comparison?.deltas.totalDevices ?? null}
              icon={Monitor}
            />
            <StatCard
              label={
                <>
                  <span className="sm:hidden">Plays</span>
                  <span className="hidden sm:inline">Plays In Range</span>
                </>
              }
              value={data.summary.totalPlays.toLocaleString()}
              detail={formatDuration(data.summary.totalPlayDurationMs)}
              delta={data.comparison?.deltas.totalPlays ?? null}
              icon={Play}
            />
            <StatCard
              label={
                <>
                  <span className="sm:hidden">Invites</span>
                  <span className="hidden sm:inline">Pending Invites</span>
                </>
              }
              value={data.summary.totalPendingClientInvites.toLocaleString()}
              detail={
                <>
                  <span className="sm:hidden">{data.summary.totalPendingResellerInvites} reseller admin invites</span>
                  <span className="hidden sm:inline">{data.summary.totalPendingResellerInvites} pending reseller admin invites</span>
                </>
              }
              delta={data.comparison?.deltas.totalPendingClientInvites ?? null}
              icon={Clock3}
            />
            <StatCard
              label="Storage"
              value={formatBytes(data.summary.totalStorageUsedBytes)}
              detail={
                <>
                  <span className="sm:hidden">{formatBytes(data.summary.totalStorageLimitBytes)} cap</span>
                  <span className="hidden sm:inline">{formatBytes(data.summary.totalStorageLimitBytes)} provisioned</span>
                </>
              }
              delta={data.comparison?.deltas.totalStorageUsedBytes ?? null}
              icon={HardDrive}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PortalTrendChart
              title="Client Organization Growth"
              subtitle="Monthly creation volume across your client portfolio."
              color="var(--blue)"
              points={data.organizationsByMonth.map((entry) => ({
                label: new Date(`${entry.month}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
                value: entry.organizations,
                secondary: `${entry.organizations.toLocaleString()} organizations`,
              }))}
            />
            <PortalTrendChart
              title="Proof Of Play Trend"
              subtitle="Daily playback trend with tooltip detail for each point."
              color="var(--aqua)"
              points={data.playsByDay.map((entry) => ({
                label: new Date(`${entry.date}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                value: entry.plays,
                secondary: formatDuration(entry.durationMs),
              }))}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
            <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold mb-4">Operational Summary</p>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Workspaces</span>
                  <span className="font-medium tabular-nums">{data.summary.totalWorkspaces.toLocaleString()}</span>
                </div>
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

              <p className="text-sm font-semibold mt-6 mb-3">Plan Mix</p>
              <div className="flex flex-wrap gap-2">
                {data.planBreakdown.map((entry) => (
                  <Badge key={entry.plan} tone="neutral">{entry.plan}: {entry.count}</Badge>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
              <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
                <p className="text-sm font-semibold">Top Client Organizations</p>
              </div>
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
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
                        <Link to={`/management/orgs/${entry.orgId}`} className="font-medium hover:text-[var(--blue)] transition-colors">{entry.name}</Link>
                        <p className="text-xs text-[var(--text-muted)]">{entry.slug}</p>
                      </td>
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
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold">Workspace Drilldowns</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Open the exact workspace device, content, or overview page behind the aggregate trend.</p>
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
                      <Link to={`/management/orgs/${entry.orgId}`} className="font-medium hover:text-[var(--blue)] transition-colors">{entry.orgName}</Link>
                      <p className="text-xs text-[var(--text-muted)]">{entry.orgSlug}</p>
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

          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--card-border)' }}>
              <p className="text-sm font-semibold">Recent Client Organizations</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrganizations.map((entry) => (
                  <tr key={entry.orgId}>
                    <td>
                        <Link to={`/management/orgs/${entry.orgId}`} className="font-medium hover:text-[var(--blue)] transition-colors">{entry.name}</Link>
                      <p className="text-xs text-[var(--text-muted)]">{entry.slug}</p>
                    </td>
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

          <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
                  <HardDrive size={15} />
                  <span className="text-xs font-medium uppercase tracking-wide">Storage Headroom</span>
                </div>
                <p className="text-xl font-bold">{formatBytes(Math.max(0, data.summary.totalStorageLimitBytes - data.summary.totalStorageUsedBytes))}</p>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
                  <Image size={15} />
                  <span className="text-xs font-medium uppercase tracking-wide">Screenshots</span>
                </div>
                <p className="text-xl font-bold tabular-nums">{data.summary.totalScreenshots.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex items-center gap-2 text-[var(--text-muted)] mb-2">
                  <Clock3 size={15} />
                  <span className="text-xs font-medium uppercase tracking-wide">Play Time</span>
                </div>
                <p className="text-xl font-bold">{formatDuration(data.summary.totalPlayDurationMs)}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}