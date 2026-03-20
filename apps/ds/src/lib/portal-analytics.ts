export interface PortalAnalyticsSummary {
  totalResellers: number;
  totalOrganizations: number;
  suspendedOrganizations: number;
  totalUsers: number;
  totalWorkspaces: number;
  totalDevices: number;
  onlineDevices: number;
  totalContentItems: number;
  totalPlaylists: number;
  totalSchedules: number;
  activeSchedules: number;
  totalStorageUsedBytes: number;
  totalStorageLimitBytes: number;
  totalScreenshots: number;
  totalPendingClientInvites: number;
  totalPendingResellerInvites: number;
  resellerAdminCount: number;
  totalPlays: number;
  totalPlayDurationMs: number;
}

export interface PortalAnalyticsDelta {
  current: number;
  previous: number;
  change: number;
  percentChange: number | null;
}

export interface PortalAnalyticsComparison {
  mode: 'previous_period';
  previousFrom: string;
  previousTo: string;
  previousSummary: PortalAnalyticsSummary;
  deltas: Record<string, PortalAnalyticsDelta>;
}

export type WorkspaceDrilldownView = 'workspace' | 'devices' | 'content' | 'analytics';

export interface PortalWorkspaceDrilldown {
  workspaceId: string;
  name: string;
  slug: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  resellerName: string | null;
  deviceCount: number;
  onlineDeviceCount: number;
  offlineDeviceCount: number;
  contentCount: number;
  playCount: number;
  createdAt: string;
}

export interface PortalAnalyticsAlert {
  id: string;
  tone: 'accent' | 'warning' | 'danger';
  title: string;
  description: string;
  drilldownLabel?: string | undefined;
  drilldown?: {
    orgId: string;
    workspaceId: string;
    view: WorkspaceDrilldownView;
    searchParams?: Record<string, string>;
  } | undefined;
}

export interface PortalAnalyticsSettings {
  thresholds: {
    storageUsagePct: number;
    storageGrowthPct: number;
    storageSevereUsagePct: number;
    onlineDeviceDropCount: number;
    severeOnlineDeviceDropCount: number;
    playDropPct: number;
    severePlayDropPct: number;
  };
  notifications: {
    storageGrowth: boolean;
    deviceDrop: boolean;
    playAnomaly: boolean;
  };
  repeatHours: number;
}

export interface PortalAnalyticsPreset {
  id: string;
  name: string;
  actorType: 'platform_owner' | 'management_company';
  actorId: string;
  orgId: string;
  workspaceId: string;
  view: WorkspaceDrilldownView;
  searchParams: Record<string, string>;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformAdminNotification {
  id: string;
  actorType: 'platform_owner' | 'management_company';
  actorId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  dismissed: boolean;
  createdAt: string;
}

export interface PlatformAdminNotificationResponse {
  notifications: PlatformAdminNotification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

export interface PortalAnalyticsResponse {
  scope: 'platform_owner' | 'reseller';
  from: string;
  to: string;
  settings: PortalAnalyticsSettings;
  alerts: PortalAnalyticsAlert[];
  summary: PortalAnalyticsSummary;
  totalManagementCompanies: number;
  totalResellers: number;
  totalOrgs: number;
  totalOrganizations: number;
  suspendedOrgs: number;
  suspendedOrganizations: number;
  totalUsers: number;
  playsByDay: Array<{ date: string; plays: number; durationMs: number }>;
  organizationsByMonth: Array<{ month: string; organizations: number }>;
  planBreakdown: Array<{ plan: string; count: number }>;
  topOrganizations: Array<{
    orgId: string;
    name: string;
    slug: string;
    resellerName: string | null;
    workspaceCount: number;
    deviceCount: number;
    userCount: number;
    storageUsedBytes: number;
    playCount: number;
    createdAt: string;
    status: string;
  }>;
  recentOrganizations: Array<{
    orgId: string;
    name: string;
    slug: string;
    resellerName: string | null;
    createdAt: string;
    status: string;
  }>;
  topWorkspaces: PortalWorkspaceDrilldown[];
  topResellers: Array<{
    companyId: string;
    name: string;
    orgCount: number;
    suspendedOrgCount: number;
    userCount: number;
    workspaceCount: number;
    deviceCount: number;
    storageUsedBytes: number;
  }>;
  comparison: PortalAnalyticsComparison | null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
}

export function toDateInput(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function formatDelta(change: number, percentChange: number | null) {
  const sign = change > 0 ? '+' : '';
  if (percentChange == null) return `${sign}${change.toLocaleString()}`;
  return `${sign}${change.toLocaleString()} (${sign}${percentChange}%)`;
}

export function getDeltaTone(change: number): 'success' | 'warning' | 'neutral' {
  if (change > 0) return 'success';
  if (change < 0) return 'warning';
  return 'neutral';
}

export function buildWorkspaceViewPath(
  workspaceId: string,
  view: WorkspaceDrilldownView,
  searchParams?: Record<string, string>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value) params.set(key, value);
  }

  const search = params.toString();
  const suffix = search ? `?${search}` : '';

  if (view === 'workspace') return `/dashboard?workspaceId=${workspaceId}`;
  if (view === 'content') return `/workspaces/${workspaceId}/content${suffix}`;
  if (view === 'analytics') return `/workspaces/${workspaceId}/analytics${suffix}`;
  return `/workspaces/${workspaceId}${suffix}`;
}

export function buildPortalAnalyticsAlerts(data: PortalAnalyticsResponse): PortalAnalyticsAlert[] {
  const alerts: PortalAnalyticsAlert[] = [];
  const comparison = data.comparison;
  const topWorkspaceByContent = [...data.topWorkspaces].sort((left, right) => right.contentCount - left.contentCount)[0];
  const topWorkspaceByOffline = [...data.topWorkspaces].sort((left, right) => right.offlineDeviceCount - left.offlineDeviceCount)[0];
  const topWorkspaceByPlays = [...data.topWorkspaces].sort((left, right) => right.playCount - left.playCount)[0];
  const storageUsagePct = data.summary.totalStorageLimitBytes > 0
    ? (data.summary.totalStorageUsedBytes / data.summary.totalStorageLimitBytes) * 100
    : 0;
  const storageDelta = comparison?.deltas.totalStorageUsedBytes;

  if (
    storageUsagePct >= 80
    || (storageDelta?.percentChange != null && storageDelta.percentChange >= 15)
  ) {
    alerts.push({
      id: 'storage-growth',
      tone: storageUsagePct >= 90 ? 'danger' : 'warning',
      title: 'Storage pressure is rising',
      description: storageDelta?.percentChange != null
        ? `${formatBytes(data.summary.totalStorageUsedBytes)} is in use, up ${storageDelta.percentChange}% versus the previous period.`
        : `${formatBytes(data.summary.totalStorageUsedBytes)} is in use across the selected scope.`,
      drilldownLabel: topWorkspaceByContent ? 'Inspect content-heavy workspace' : undefined,
      drilldown: topWorkspaceByContent ? {
        orgId: topWorkspaceByContent.orgId,
        workspaceId: topWorkspaceByContent.workspaceId,
        view: 'content',
        searchParams: { sort: 'size' },
      } : undefined,
    });
  }

  const onlineDeviceDelta = comparison?.deltas.onlineDevices;
  if (
    data.topWorkspaces.some((workspace) => workspace.offlineDeviceCount > 0)
    || (onlineDeviceDelta != null && onlineDeviceDelta.change < 0)
  ) {
    alerts.push({
      id: 'device-drop',
      tone: onlineDeviceDelta != null && onlineDeviceDelta.change < -3 ? 'danger' : 'warning',
      title: 'Device availability dropped',
      description: onlineDeviceDelta?.change != null && onlineDeviceDelta.change !== 0
        ? `${Math.abs(onlineDeviceDelta.change).toLocaleString()} fewer devices are online than in the previous period.`
        : 'At least one workspace currently has offline or errored devices.' ,
      drilldownLabel: topWorkspaceByOffline ? 'Open affected devices' : undefined,
      drilldown: topWorkspaceByOffline ? {
        orgId: topWorkspaceByOffline.orgId,
        workspaceId: topWorkspaceByOffline.workspaceId,
        view: 'devices',
        searchParams: { status: 'offline' },
      } : undefined,
    });
  }

  const playDelta = comparison?.deltas.totalPlays;
  if (playDelta?.percentChange != null && playDelta.percentChange <= -20) {
    alerts.push({
      id: 'play-anomaly',
      tone: playDelta.percentChange <= -35 ? 'danger' : 'accent',
      title: 'Play volume is below baseline',
      description: `Proof-of-play is down ${Math.abs(playDelta.percentChange)}% versus the previous period. Review the busiest workspace first.`,
      drilldownLabel: topWorkspaceByPlays ? 'Open workspace analytics' : undefined,
      drilldown: topWorkspaceByPlays ? {
        orgId: topWorkspaceByPlays.orgId,
        workspaceId: topWorkspaceByPlays.workspaceId,
        view: 'analytics',
      } : undefined,
    });
  }

  return alerts.slice(0, 3);
}

export function buildPresetSearchParams(
  view: WorkspaceDrilldownView,
  workspace: Pick<PortalWorkspaceDrilldown, 'offlineDeviceCount'>,
) {
  if (view === 'devices' && workspace.offlineDeviceCount > 0) return { status: 'offline' };
  if (view === 'content') return { sort: 'size' };
  return {};
}