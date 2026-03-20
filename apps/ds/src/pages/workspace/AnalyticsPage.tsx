import { useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BarChart2,
  Download,
  FileText,
  Play,
  Clock,
  Monitor,
  Image,
  ChevronLeft,
  ChevronRight,
  Layers,
  Wifi,
  HardDrive,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';
import { PageHeader, Skeleton } from '../../components/UiPrimitives.js';

interface Summary {
  totalPlays: number;
  totalDurationMs: number;
  uniqueDevices: number;
  uniqueContents: number;
  byDay: { date: string; plays: number; durationMs: number }[];
  byContent: {
    contentId: string | null;
    contentName: string | null;
    contentType: string | null;
    plays: number;
    durationMs: number;
  }[];
  deviceUptime: {
    deviceId: string;
    deviceName: string;
    workspaceName: string;
    heartbeatCount: number;
    uptimePct: number;
    lastHeartbeatAt: string | null;
    avgCpuLoad: number | null;
  }[];
  connectivityEvents: {
    deviceId: string | null;
    deviceName: string | null;
    workspaceName: string | null;
    type: string;
    total: number;
  }[];
  playlistStats: {
    playlistId: string | null;
    playlistName: string | null;
    plays: number;
    completedPlays: number;
    completionRatePct: number;
  }[];
  orgSummary: {
    storageUsedBytes: number;
    storageLimitBytes: number;
    deviceCount: number;
    scheduleCount: number;
    activeScheduleCount: number;
  };
}

interface PlayEvent {
  id: string;
  deviceName: string | null;
  workspaceName: string | null;
  contentName: string | null;
  contentType: string | null;
  playlistName?: string | null;
  zoneId: string | null;
  startedAt: string;
  durationMs: number;
  completedFull: boolean;
  source: string;
}

interface PlayEventsResponse {
  events: PlayEvent[];
  total: number;
  page: number;
  limit: number;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const token = useAuthStore((s) => s.accessToken);

  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 30 * 86_400_000);

  const [from, setFrom] = useState(toDateInput(defaultFrom));
  const [to, setTo] = useState(toDateInput(defaultTo));
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const params = new URLSearchParams({
    workspaceId: wsId ?? '',
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
  });

  const { data: summary, isLoading: loadingSummary } = useQuery<Summary>({
    queryKey: ['analytics-summary', wsId, from, to],
    queryFn: () => api.get(`/analytics/summary?${params}`),
    enabled: !!wsId,
  });

  const eventParams = new URLSearchParams(params);
  eventParams.set('page', String(page));
  eventParams.set('limit', String(LIMIT));

  const { data: eventsData, isLoading: loadingEvents } = useQuery<PlayEventsResponse>({
    queryKey: ['analytics-events', wsId, from, to, page],
    queryFn: () => api.get(`/analytics/play-events?${eventParams}`),
    enabled: !!wsId,
  });

  const exportReport = useCallback(async (kind: 'csv' | 'pdf') => {
    try {
      const url = `/api/analytics/export.${kind}?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `proof-of-play-${from}-to-${to}.${kind}`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Export ${kind.toUpperCase()} failed`);
    }
  }, [from, to, token, params]);

  const maxDayPlays = Math.max(1, ...(summary?.byDay.map((d) => d.plays) ?? [1]));
  const totalEvents = eventsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalEvents / LIMIT));

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <PageHeader
          icon={<BarChart2 size={22} />}
          title="Analytics"
          subtitle="Proof of Play, uptime, connectivity, and playlist completion"
          action={(
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="input text-sm h-8 px-2"
              />
              <span className="text-[var(--text-muted)] text-sm">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="input text-sm h-8 px-2"
              />
              <button onClick={() => void exportReport('csv')} className="workspace-page-action">
                <Download size={14} />
                Export CSV
              </button>
              <button onClick={() => void exportReport('pdf')} className="workspace-page-action">
                <FileText size={14} />
                Export PDF
              </button>
            </div>
          )}
        />

        {loadingSummary ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Plays', value: summary?.totalPlays.toLocaleString() ?? '0', icon: <Play size={16} className="text-[var(--blue)]" /> },
              { label: 'Total Duration', value: formatDuration(summary?.totalDurationMs ?? 0), icon: <Clock size={16} className="text-[var(--blue)]" /> },
              { label: 'Unique Devices', value: String(summary?.uniqueDevices ?? 0), icon: <Monitor size={16} className="text-[var(--blue)]" /> },
              { label: 'Unique Content', value: String(summary?.uniqueContents ?? 0), icon: <Image size={16} className="text-[var(--blue)]" /> },
            ].map(({ label, value, icon }) => (
              <div
                key={label}
                className="rounded-2xl border p-4"
                style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
              >
                <div className="flex items-center gap-2 mb-2 text-[var(--text-muted)]">
                  {icon}
                  <span className="text-xs font-medium">{label}</span>
                </div>
                <p className="text-2xl font-bold tabular-nums text-[var(--text)]">{value}</p>
              </div>
            ))}
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div
              className="rounded-2xl border p-5"
              style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
            >
              <div className="flex items-center gap-2 mb-3 text-[var(--text-muted)]">
                <HardDrive size={16} />
                <span className="text-sm font-semibold text-[var(--text)]">Org Summary</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Storage</span>
                  <span className="font-medium">{formatBytes(summary.orgSummary.storageUsedBytes)} / {formatBytes(summary.orgSummary.storageLimitBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Devices</span>
                  <span className="font-medium tabular-nums">{summary.orgSummary.deviceCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Schedules</span>
                  <span className="font-medium tabular-nums">{summary.orgSummary.scheduleCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-muted)]">Active schedules</span>
                  <span className="font-medium tabular-nums">{summary.orgSummary.activeScheduleCount}</span>
                </div>
              </div>
            </div>

            <div
              className="rounded-2xl border p-5 lg:col-span-2"
              style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
            >
              <p className="text-sm font-semibold text-[var(--text)] mb-4">Plays per day</p>
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {summary.byDay.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-muted)] w-24 shrink-0 tabular-nums">{day.date}</span>
                    <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'var(--surface)' }}>
                      <div
                        className="h-4 rounded-full transition-all"
                        style={{
                          width: `${((day.plays / maxDayPlays) * 100).toFixed(1)}%`,
                          background: 'var(--blue)',
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-[var(--text-muted)] w-10 text-right">{day.plays}</span>
                    <span className="text-xs tabular-nums text-[var(--text-muted)] w-16 text-right">{formatDuration(day.durationMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {summary && summary.playlistStats.length > 0 && (
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
          >
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
              <Layers size={16} className="text-[var(--text-muted)]" />
              <p className="text-sm font-semibold text-[var(--text)]">Playlist Completion</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Playlist</th>
                  <th>Plays</th>
                  <th>Completed</th>
                  <th>Completion Rate</th>
                </tr>
              </thead>
              <tbody>
                {summary.playlistStats.map((playlist, index) => (
                  <tr key={playlist.playlistId ?? index}>
                    <td className="font-medium">{playlist.playlistName ?? '(deleted)'}</td>
                    <td className="tabular-nums">{playlist.plays.toLocaleString()}</td>
                    <td className="tabular-nums">{playlist.completedPlays.toLocaleString()}</td>
                    <td className="tabular-nums">{playlist.completionRatePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
            >
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-semibold text-[var(--text)]">Device Uptime</p>
              </div>
              <table className="ui-data-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Workspace</th>
                    <th>Uptime</th>
                    <th>Avg CPU</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.deviceUptime.map((device) => (
                    <tr key={device.deviceId}>
                      <td className="font-medium">{device.deviceName}</td>
                      <td className="text-[var(--text-muted)]">{device.workspaceName}</td>
                      <td className="tabular-nums">{device.uptimePct.toFixed(1)}%</td>
                      <td className="tabular-nums">{device.avgCpuLoad != null ? `${device.avgCpuLoad.toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="rounded-2xl border overflow-hidden"
              style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
            >
              <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                <Wifi size={16} className="text-[var(--text-muted)]" />
                <p className="text-sm font-semibold text-[var(--text)]">Connectivity Events</p>
              </div>
              {summary.connectivityEvents.length === 0 ? (
                <div className="p-6 text-sm text-[var(--text-muted)]">No offline/online events in this range.</div>
              ) : (
                <table className="ui-data-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Workspace</th>
                      <th>Event</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.connectivityEvents.map((event, index) => (
                      <tr key={`${event.deviceId ?? 'none'}-${event.type}-${index}`}>
                        <td className="font-medium">{event.deviceName ?? 'Unknown device'}</td>
                        <td className="text-[var(--text-muted)]">{event.workspaceName ?? '—'}</td>
                        <td className="capitalize text-[var(--text-muted)]">{event.type.replace('_', ' ')}</td>
                        <td className="tabular-nums">{event.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {summary && summary.byContent.length > 0 && (
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
          >
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold text-[var(--text)]">Top Content</p>
            </div>
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Type</th>
                  <th>Plays</th>
                  <th>Total Duration</th>
                </tr>
              </thead>
              <tbody>
                {summary.byContent.map((content, index) => (
                  <tr key={content.contentId ?? index}>
                    <td className="font-medium">{content.contentName ?? '(deleted)'}</td>
                    <td className="capitalize text-[var(--text-muted)]">{content.contentType ?? '—'}</td>
                    <td className="tabular-nums">{content.plays.toLocaleString()}</td>
                    <td className="tabular-nums">{formatDuration(content.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        >
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold text-[var(--text)]">
              Play Events
              {totalEvents > 0 && (
                <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                  {totalEvents.toLocaleString()} total
                </span>
              )}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <button
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="p-1 rounded hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-1 tabular-nums">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="p-1 rounded hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {loadingEvents ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : !eventsData || eventsData.events.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-muted)] text-sm">
              No play events for the selected period
            </div>
          ) : (
            <table className="ui-data-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Device</th>
                  <th>Content</th>
                  <th>Playlist</th>
                  <th>Duration</th>
                  <th>Completed</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {eventsData.events.map((event) => (
                  <tr key={event.id}>
                    <td className="tabular-nums text-[var(--text-muted)]">{new Date(event.startedAt).toLocaleString()}</td>
                    <td className="font-medium">{event.deviceName ?? '—'}</td>
                    <td>
                      <span>{event.contentName ?? <em className="text-[var(--text-muted)]">deleted</em>}</span>
                      {event.contentType && (
                        <span className="ml-1.5 text-xs text-[var(--text-muted)] capitalize">{event.contentType}</span>
                      )}
                    </td>
                    <td className="text-[var(--text-muted)]">{event.playlistName ?? '—'}</td>
                    <td className="tabular-nums">{formatDuration(event.durationMs)}</td>
                    <td>
                      <span className={`text-xs font-medium ${event.completedFull ? 'text-[var(--success,#10b981)]' : 'text-amber-400'}`}>
                        {event.completedFull ? 'Yes' : 'Partial'}
                      </span>
                    </td>
                    <td className="capitalize text-[var(--text-muted)]">{event.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
