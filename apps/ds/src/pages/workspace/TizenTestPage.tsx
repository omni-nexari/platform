import { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Command,
  Copy,
  Download,
  Home,
  Monitor,
  RefreshCw,
  Send,
  TerminalSquare,
  Trash2,
  Tv2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';
import {
  ActionButton,
  Badge,
  Callout,
  EmptyState,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';

type Workspace = {
  id: string;
  name: string;
  slug: string;
};

type DeviceSummary = {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  workspaceId: string | null;
  modelName: string | null;
  ipAddress: string | null;
  updatedAt: string;
};

type DeviceHeartbeat = {
  playerVersion: string | null;
  firmwareVersion: string | null;
  cpuLoad: number | null;
  storageFreeBytes: number | null;
  createdAt: string;
  currentContentName: string | null;
  nextContentName: string | null;
};

type DeviceDetail = {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  lastSeen: string | null;
  playerVersion: string | null;
  firmwareVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  timezone: string;
  duid: string | null;
  modelName: string | null;
  modelCode: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  wifiSsid: string | null;
  wifiStrength: number | null;
  powerState: 'on' | 'off' | 'standby';
  irLock: boolean;
  buttonLock: boolean;
  screenshotIntervalMin: number | null;
  ntpServer: string | null;
  ntpTimezone: string | null;
};

type DeviceLogEntry = {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  line: string;
  createdAt: string;
};

type DeviceDetailResponse = {
  device: DeviceDetail;
  latestHeartbeat: DeviceHeartbeat | null;
  screenshots: Array<{ id: string; takenAt: string; trigger: string | null }>;
};

type DeviceLogsResponse = {
  deviceId: string;
  online: boolean;
  logs: DeviceLogEntry[];
};

type ObservedSystemInfo = {
  duid?: string | null;
  macAddress?: string | null;
  resolution?: string | null;
  ipAddress?: string | null;
  networkType?: string | null;
  wifiSsid?: string | null;
  gateway?: string | null;
  timezone?: string | null;
  firmwareVersion?: string | null;
  realModel?: string | null;
  panelType?: string | null;
  tvName?: string | null;
};

const QUICK_COMMANDS = [
  { key: 'refresh_schedule', label: 'Refresh Schedule' },
  { key: 'dump_logs', label: 'Dump Logs' },
  { key: 'screenshot', label: 'Screenshot' },
  { key: 'clear_cache', label: 'Clear Cache' },
  { key: 'reboot', label: 'Reboot' },
  { key: 'relaunch_app', label: 'Relaunch App' },
  { key: 'power_on', label: 'Power On' },
  { key: 'power_off', label: 'Power Off' },
] as const;

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildLogText(logs: DeviceLogEntry[]) {
  return logs
    .map((entry) => `[${new Date(entry.createdAt).toLocaleTimeString()}] [${entry.level.toUpperCase()}] ${entry.line}`)
    .join('\n');
}

function parseObservedSystemInfo(logs: DeviceLogEntry[]): ObservedSystemInfo | null {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const line = logs[index]?.line;
    if (!line || !line.includes('System info collected:')) continue;

    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) continue;

    try {
      return JSON.parse(line.slice(jsonStart)) as ObservedSystemInfo;
    } catch {
      continue;
    }
  }

  return null;
}

function preferObservedValue(deviceValue: string | null | undefined, observedValue: string | null | undefined) {
  if (deviceValue && deviceValue !== 'UTC') return deviceValue;
  if (observedValue) return observedValue;
  return deviceValue ?? null;
}

export default function TizenTestPage() {
  const { user, bootstrapped } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [ntpServer, setNtpServer] = useState('pool.ntp.org');
  const [ntpTimezone, setNtpTimezone] = useState('UTC');
  const [screenshotInterval, setScreenshotInterval] = useState('5');
  const [formSeedDeviceId, setFormSeedDeviceId] = useState('');

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
    enabled: bootstrapped && !!user,
    retry: false,
  });

  const { data: devices = [] } = useQuery<DeviceSummary[]>({
    queryKey: ['tizen-test-devices', selectedWorkspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${selectedWorkspaceId}`),
    enabled: bootstrapped && !!user && !!selectedWorkspaceId,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 15_000),
    retry: false,
  });

  const { data: detail } = useQuery<DeviceDetailResponse>({
    queryKey: ['tizen-test-detail', selectedDeviceId],
    queryFn: () => api.get(`/devices/${selectedDeviceId}`),
    enabled: bootstrapped && !!user && !!selectedDeviceId,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 5_000),
    retry: false,
  });

  const { data: logData } = useQuery<DeviceLogsResponse>({
    queryKey: ['tizen-test-logs', selectedDeviceId],
    queryFn: () => api.get(`/devices/${selectedDeviceId}/logs?limit=1000`),
    enabled: bootstrapped && !!user && !!selectedDeviceId,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 2_000),
    retry: false,
  });

  const sendCommand = useMutation({
    mutationFn: (body: unknown) => api.post(`/devices/${selectedDeviceId}/command`, body),
    onSuccess: () => {
      toast.success('Command sent');
      void queryClient.invalidateQueries({ queryKey: ['tizen-test-detail', selectedDeviceId] });
      void queryClient.invalidateQueries({ queryKey: ['tizen-test-logs', selectedDeviceId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Command failed'),
  });

  const clearLogs = useMutation({
    mutationFn: () => api.delete(`/devices/${selectedDeviceId}/logs`),
    onSuccess: () => {
      toast.success('Logs cleared');
      void queryClient.invalidateQueries({ queryKey: ['tizen-test-logs', selectedDeviceId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to clear logs'),
  });

  const deleteScreenshot = useMutation({
    mutationFn: (screenshotId: string) => api.delete(`/devices/${selectedDeviceId}/screenshots/${screenshotId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tizen-test-detail', selectedDeviceId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete screenshot'),
  });

  const [liveViewOpen, setLiveViewOpen] = useState(false);

  const device = detail?.device ?? null;
  const latestHeartbeat = detail?.latestHeartbeat ?? null;
  const logs = logData?.logs ?? [];
  const logText = useMemo(() => buildLogText(logs), [logs]);
  const observedSystemInfo = useMemo(() => parseObservedSystemInfo(logs), [logs]);
  const isOnline = device?.status === 'online';

  const resolvedTimezone = useMemo(
    () => preferObservedValue(device?.timezone, observedSystemInfo?.timezone),
    [device?.timezone, observedSystemInfo?.timezone],
  );
  const resolvedResolution = useMemo(
    () => device?.resolution || observedSystemInfo?.resolution || null,
    [device?.resolution, observedSystemInfo?.resolution],
  );
  const resolvedWifiSsid = useMemo(
    () => device?.wifiSsid || observedSystemInfo?.wifiSsid || null,
    [device?.wifiSsid, observedSystemInfo?.wifiSsid],
  );
  const resolvedIpAddress = useMemo(
    () => device?.ipAddress || observedSystemInfo?.ipAddress || null,
    [device?.ipAddress, observedSystemInfo?.ipAddress],
  );
  const resolvedMacAddress = useMemo(
    () => device?.macAddress || observedSystemInfo?.macAddress || null,
    [device?.macAddress, observedSystemInfo?.macAddress],
  );

  const observedOnlyFields = useMemo(() => {
    if (!device || !observedSystemInfo) return [] as string[];

    const items: string[] = [];
    if ((!device.timezone || device.timezone === 'UTC') && observedSystemInfo.timezone) items.push(`timezone=${observedSystemInfo.timezone}`);
    if (!device.resolution && observedSystemInfo.resolution) items.push(`resolution=${observedSystemInfo.resolution}`);
    if (!device.wifiSsid && observedSystemInfo.wifiSsid) items.push(`ssid=${observedSystemInfo.wifiSsid}`);
    if (!device.ipAddress && observedSystemInfo.ipAddress) items.push(`ip=${observedSystemInfo.ipAddress}`);
    if (!device.macAddress && observedSystemInfo.macAddress) items.push(`mac=${observedSystemInfo.macAddress}`);
    return items;
  }, [device, observedSystemInfo]);

  useEffect(() => {
    if (!device?.id) return;
    if (formSeedDeviceId === device.id) return;

    setNtpServer(device.ntpServer ?? 'pool.ntp.org');
    setNtpTimezone(preferObservedValue(device.timezone, observedSystemInfo?.timezone) ?? device.ntpTimezone ?? 'UTC');
    setScreenshotInterval(String(device.screenshotIntervalMin ?? 5));
    setFormSeedDeviceId(device.id);
  }, [device?.id, device?.ntpServer, device?.ntpTimezone, device?.timezone, device?.screenshotIntervalMin, observedSystemInfo?.timezone, formSeedDeviceId]);

  const missingFields = useMemo(() => {
    if (!device) return [] as string[];
    const items: string[] = [];
    if (!resolvedTimezone) items.push('timezone');
    if (!resolvedResolution) items.push('resolution');
    if (!resolvedWifiSsid && device.connectionType === 'wifi') items.push('wifi ssid');
    if (!resolvedMacAddress) items.push('mac address');
    if (!resolvedIpAddress) items.push('ip address');
    return items;
  }, [device, resolvedTimezone, resolvedResolution, resolvedWifiSsid, resolvedMacAddress, resolvedIpAddress]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;

  function handleWorkspaceChange(value: string) {
    setSelectedWorkspaceId(value);
    setSelectedDeviceId('');
  }

  async function copyLogs() {
    if (!logText) {
      toast.error('No logs to copy');
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(logText);
      toast.success('Logs copied');
      return;
    }

    toast.error('Clipboard API not available in this browser');
  }

  function downloadLogs() {
    if (!logText) {
      toast.error('No logs to download');
      return;
    }

    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${device?.name ?? 'tizen-device'}-logs.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={<Bug className="w-6 h-6" />}
        title="Tizen Test"
        subtitle="Remote bug-fixing workspace for a paired Tizen player. Inspect device fields, send commands, and capture console logs without using the TV UI."
        trailing={
          <div className="flex flex-wrap gap-3">
            <select
              value={selectedWorkspaceId}
              onChange={(event) => handleWorkspaceChange(event.target.value)}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] min-w-56"
            >
              <option value="">Select workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <select
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              disabled={!selectedWorkspaceId}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] min-w-72"
            >
              <option value="">Select device</option>
              {devices.map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.modelName ? ` · ${item.modelName}` : ''}</option>
              ))}
            </select>
          </div>
        }
      />

      {!selectedWorkspaceId ? (
        <EmptyState
          icon={<Monitor className="w-6 h-6" />}
          title="Select a workspace"
          description="Choose the workspace that contains the Samsung player you want to debug."
        />
      ) : null}

      {selectedWorkspaceId && !selectedDeviceId ? (
        <EmptyState
          icon={<TerminalSquare className="w-6 h-6" />}
          title={devices.length ? 'Select a device' : 'No devices found'}
          description={devices.length ? `Workspace ${selectedWorkspace?.name ?? ''} has ${devices.length} device${devices.length === 1 ? '' : 's'}.` : 'This workspace does not have a paired device yet.'}
        />
      ) : null}

      {device ? (
        <>
          {missingFields.length > 0 ? (
            <Callout tone="warning" icon={<AlertTriangle className="w-4 h-4" />}>
              Missing device fields detected: {missingFields.join(', ')}. Use Dump Logs and Refresh Schedule below to verify whether telemetry is reaching the backend.
            </Callout>
          ) : null}

          {observedOnlyFields.length > 0 ? (
            <Callout tone="accent" icon={<Bug className="w-4 h-4" />}>
              Device logs already contain values not fully reflected in persisted device state: {observedOnlyFields.join(', ')}.
            </Callout>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[1.25fr,0.9fr]">
            <SectionCard>
              <SectionCardHeader>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text)]">Device State</h2>
                  <p className="text-sm text-[var(--text-muted)]">Latest device columns and most recent heartbeat</p>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={isOnline ? 'success' : 'neutral'}>{device.status.toUpperCase()}</Badge>
                  <Badge tone="accent">{device.connectionType ? device.connectionType.toUpperCase() : 'NO LINK TYPE'}</Badge>
                  <span className="text-sm text-[var(--text-muted)]">Last seen {formatTimestamp(device.lastSeen)}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 text-sm">
                  <InfoItem label="Device Name" value={device.name} />
                  <InfoItem label="Model" value={device.modelName ?? device.modelCode ?? observedSystemInfo?.realModel} />
                  <InfoItem label="DUID" value={device.duid} mono />
                  <InfoItem label="IP Address" value={resolvedIpAddress} mono />
                  <InfoItem label="MAC Address" value={resolvedMacAddress} mono />
                  <InfoItem label="SSID" value={resolvedWifiSsid} mono />
                  <InfoItem label="Timezone" value={resolvedTimezone} mono />
                  <InfoItem label="Resolution" value={resolvedResolution} mono />
                  <InfoItem label="Player Version" value={device.playerVersion ?? latestHeartbeat?.playerVersion} mono />
                  <InfoItem label="Firmware" value={device.firmwareVersion ?? latestHeartbeat?.firmwareVersion ?? observedSystemInfo?.firmwareVersion} mono />
                  <InfoItem label="Heartbeat CPU" value={latestHeartbeat?.cpuLoad != null ? `${latestHeartbeat.cpuLoad.toFixed(1)}%` : '—'} />
                  <InfoItem label="Heartbeat Storage Free" value={latestHeartbeat?.storageFreeBytes != null ? `${Math.round(latestHeartbeat.storageFreeBytes / 1048576)} MB` : '—'} />
                </div>

                {observedSystemInfo ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 text-sm border-t border-[var(--border)] pt-5">
                    <InfoItem label="Observed TV Name" value={observedSystemInfo.tvName} />
                    <InfoItem label="Observed Panel Type" value={observedSystemInfo.panelType} />
                    <InfoItem label="Observed Network" value={observedSystemInfo.networkType} />
                    <InfoItem label="Observed Gateway" value={observedSystemInfo.gateway} mono />
                    <InfoItem label="Observed Real Model" value={observedSystemInfo.realModel} mono />
                    <InfoItem label="Observed From Logs" value={logs.length ? formatTimestamp(logs[logs.length - 1]?.createdAt) : '—'} />
                  </div>
                ) : null}
              </SectionCardBody>
            </SectionCard>

            <SectionCard>
              <SectionCardHeader>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text)]">Command Test</h2>
                  <p className="text-sm text-[var(--text-muted)]">Send commands directly to the player</p>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {QUICK_COMMANDS.map((command) => (
                    <ActionButton
                      key={command.key}
                      tone={command.key === 'dump_logs' ? 'warning' : command.key === 'power_off' ? 'danger' : command.key === 'power_on' ? 'success' : 'default'}
                      disabled={!isOnline || sendCommand.isPending}
                      onClick={() => sendCommand.mutate({ command: command.key })}
                    >
                      <Send className="w-4 h-4" /> {command.label}
                    </ActionButton>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--text-muted)]">NTP Server</span>
                    <input value={ntpServer} onChange={(event) => setNtpServer(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Timezone</span>
                    <input value={ntpTimezone} onChange={(event) => setNtpTimezone(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
                  </label>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Detected device timezone: <span className="font-mono text-[var(--text)]">{resolvedTimezone ?? '—'}</span>
                </div>
                <ActionButton
                  tone="primary"
                  disabled={!isOnline || sendCommand.isPending || !ntpServer || !ntpTimezone}
                  onClick={() => sendCommand.mutate({ command: 'set_ntp', payload: { server: ntpServer, timezone: ntpTimezone } })}
                >
                  <Command className="w-4 h-4" /> Send NTP Settings
                </ActionButton>

                <div className="grid gap-3 md:grid-cols-[1fr,auto] md:items-end">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Screenshot Interval Minutes</span>
                    <input value={screenshotInterval} onChange={(event) => setScreenshotInterval(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]" />
                  </label>
                  <ActionButton
                    disabled={!isOnline || sendCommand.isPending || !Number.isFinite(Number(screenshotInterval)) || Number(screenshotInterval) < 1}
                    onClick={() => sendCommand.mutate({ command: 'set_screenshot_interval', payload: { minutes: Number(screenshotInterval) } })}
                  >
                    <Command className="w-4 h-4" /> Set Interval
                  </ActionButton>
                </div>
              </SectionCardBody>
            </SectionCard>
          </div>

          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text)]">Screenshots</h2>
                <p className="text-sm text-[var(--text-muted)]">Captured screenshots from the device. Use the Screenshot button above to capture.</p>
              </div>
              <div className="flex gap-2">
                <ActionButton tone="primary" disabled={!isOnline} onClick={() => setLiveViewOpen(true)}>
                  <Tv2 className="w-4 h-4" /> Live View
                </ActionButton>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              {detail?.screenshots && detail.screenshots.length > 0 ? (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.screenshots.map((shot) => (
                    <div key={shot.id} className="group relative rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                      <a href={`/api/devices/${selectedDeviceId}/screenshots/${shot.id}`} target="_blank" rel="noreferrer">
                        <img
                          src={`/api/devices/${selectedDeviceId}/screenshots/${shot.id}`}
                          alt={`Screenshot ${shot.takenAt}`}
                          className="w-full object-cover aspect-video bg-black"
                        />
                      </a>
                      <button
                        onClick={() => deleteScreenshot.mutate(shot.id)}
                        className="absolute top-2 right-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Delete screenshot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                        <span>{formatTimestamp(shot.takenAt)}</span>
                        {shot.trigger ? <span className="ml-2 opacity-60">{shot.trigger}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">No screenshots yet. Send the Screenshot command to capture one.</p>
              )}
            </SectionCardBody>
          </SectionCard>

          {liveViewOpen ? (
            <LiveViewOverlay
              deviceId={selectedDeviceId}
              isOnline={isOnline}
              onClose={() => setLiveViewOpen(false)}
            />
          ) : null}

          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text)]">Remote Console Logs</h2>
                <p className="text-sm text-[var(--text-muted)]">Recent Tizen console output received from the device WebSocket</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={logData?.online ? 'success' : 'neutral'}>{logData?.online ? 'LIVE WS' : 'DEVICE OFFLINE'}</Badge>
                <Badge tone="accent">{logs.length} lines</Badge>
                <span className="text-sm text-[var(--text-muted)]">Use Dump Logs to ask the device to flush the recent local ring buffer.</span>
              </div>

              <div className="flex flex-wrap gap-3">
                <ActionButton onClick={() => void queryClient.invalidateQueries({ queryKey: ['tizen-test-logs', selectedDeviceId] })}>
                  <RefreshCw className="w-4 h-4" /> Refresh
                </ActionButton>
                <ActionButton onClick={() => void copyLogs()} disabled={!logs.length}>
                  <Copy className="w-4 h-4" /> Copy
                </ActionButton>
                <ActionButton onClick={downloadLogs} disabled={!logs.length}>
                  <Download className="w-4 h-4" /> Download
                </ActionButton>
                <ActionButton tone="danger" onClick={() => clearLogs.mutate()} disabled={!logs.length || clearLogs.isPending}>
                  <Trash2 className="w-4 h-4" /> Clear
                </ActionButton>
              </div>

              <textarea
                value={logText}
                readOnly
                className="min-h-[420px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs leading-6 text-[var(--text)]"
                placeholder="No remote logs received yet. If the device is online, send Dump Logs first."
              />
            </SectionCardBody>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}

function InfoItem({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-2 text-sm text-[var(--text)] ${mono ? 'font-mono break-all' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}

function LiveViewOverlay({
  deviceId,
  isOnline,
  onClose,
}: {
  deviceId: string;
  isOnline: boolean;
  onClose: () => void;
}) {
  type LiveStatus = 'idle' | 'buffering' | 'playing';

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [sseError, setSseError] = useState<string | null>(null);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [measuredCadenceMs, setMeasuredCadenceMs] = useState(0);
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const statusRef = useRef<LiveStatus>('idle');
  const staleFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef<number>(0);
  const measuredCadenceRef = useRef<number>(0);
  const remoteStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; });

  function doCleanup() {
    esRef.current?.close();
    esRef.current = null;
    if (staleFrameTimerRef.current) { clearTimeout(staleFrameTimerRef.current); staleFrameTimerRef.current = null; }
    if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    lastFrameAtRef.current = 0;
    measuredCadenceRef.current = 0;
    setWaitingElapsed(0);
    setIsStale(false);
    setMeasuredCadenceMs(0);
    statusRef.current = 'idle';
    setStatus('idle');
  }

  function armStaleFrameTimer() {
    if (staleFrameTimerRef.current) clearTimeout(staleFrameTimerRef.current);
    // Grace period: 2.5× measured cadence + 3s, minimum 15s. Never nag between normal frames.
    const gracePeriod = measuredCadenceRef.current > 0
      ? Math.max(measuredCadenceRef.current * 2.5 + 3000, 15000)
      : 20000;
    staleFrameTimerRef.current = setTimeout(() => {
      if (statusRef.current === 'playing') setIsStale(true);
    }, gracePeriod);
  }

  function handleStart() {
    if (!isOnline) return;
    doCleanup();
    setImgSrc(null);
    setSseError(null);
    statusRef.current = 'buffering';
    setStatus('buffering');

    setWaitingElapsed(0);
    elapsedTimerRef.current = setInterval(() => setWaitingElapsed(s => s + 1), 1000);

    const es = new EventSource(`/api/devices/${deviceId}/screenshot/stream?intervalMs=${intervalMs}`);
    esRef.current = es;

    es.onmessage = (e) => {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
      // Measure actual frame cadence via exponential moving average
      const now = Date.now();
      if (lastFrameAtRef.current > 0) {
        const delta = now - lastFrameAtRef.current;
        measuredCadenceRef.current = measuredCadenceRef.current > 0
          ? Math.round(measuredCadenceRef.current * 0.7 + delta * 0.3)
          : delta;
        setMeasuredCadenceMs(measuredCadenceRef.current);
      }
      lastFrameAtRef.current = now;
      setIsStale(false);
      setImgSrc(`data:image/jpeg;base64,${e.data}`);
      if (statusRef.current !== 'playing') {
        statusRef.current = 'playing';
        setStatus('playing');
      }
      armStaleFrameTimer();
    };
    es.onerror = () => {
      setSseError('Stream connection failed. Is the device online?');
      doCleanup();
    };

    // Hard timeout: if no first frame after 30s, give up
    hardTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'buffering') {
        setSseError('No frames received after 30s. The device may be unresponsive.');
        doCleanup();
      }
    }, 30000);
  }

  useEffect(() => () => {
    esRef.current?.close();
    if (staleFrameTimerRef.current) clearTimeout(staleFrameTimerRef.current);
    if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (remoteStatusTimerRef.current) clearTimeout(remoteStatusTimerRef.current);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const isLive = status !== 'idle';
  const cadenceLabel = measuredCadenceMs > 0
    ? `~${(measuredCadenceMs / 1000).toFixed(1)}s`
    : `~${Math.ceil(intervalMs / 1000)}s`;

  async function sendRemoteKey(key: string) {
    if (remoteStatusTimerRef.current) clearTimeout(remoteStatusTimerRef.current);
    try {
      await api.post(`/devices/${deviceId}/remote-key`, { key });
      setRemoteStatus(`✓ ${key.replace('_', ' ').toLowerCase()}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let label = msg;
      try { label = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /* raw text */ }
      setRemoteStatus(`✗ ${label}`);
    }
    remoteStatusTimerRef.current = setTimeout(() => setRemoteStatus(null), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={(e) => { if (e.target === e.currentTarget) onCloseRef.current(); }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-black/80 border-b border-white/10">
        <Tv2 className="w-5 h-5 text-white/70" />
        <span className="text-white font-semibold text-sm">Live View</span>

        {status === 'buffering' && (
          <span className="flex items-center gap-1.5 text-xs text-yellow-300">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-300 animate-pulse" />
            Waiting for first frame…
          </span>
        )}
        {status === 'playing' && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold text-white uppercase tracking-widest"
            style={isStale ? { backgroundColor: 'rgb(161,98,7)' } : undefined}>
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
        )}
        {isLive ? <span className="text-[11px] text-white/30">{cadenceLabel} cadence</span> : null}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-white/60">
            Interval
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              disabled={isLive}
              className="rounded bg-white/10 px-2 py-1 text-white text-xs border border-white/20 disabled:opacity-40"
            >
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={3000}>3s</option>
            </select>
          </label>
          {!isLive ? (
            <button
              onClick={handleStart}
              disabled={!isOnline}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 transition-colors"
            >
              Start Live
            </button>
          ) : (
            <button
              onClick={doCleanup}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              Stop
            </button>
          )}
          <button onClick={() => onCloseRef.current()} className="rounded-lg p-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main content: image + remote panel */}
      <div className="flex-1 flex overflow-hidden">

        {/* Image / status area */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
        {status === 'buffering' && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              <svg className="absolute inset-0 -rotate-90 w-full h-full" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(253,224,71,0.15)" strokeWidth="3" />
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgb(253,224,71)" strokeWidth="3"
                  strokeDasharray="175.9"
                  strokeDashoffset={175.9 - (175.9 * Math.min(waitingElapsed / 30, 1))}
                  style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-yellow-300 text-sm font-mono">
                {waitingElapsed}s
              </span>
            </div>
            <p className="text-white/70 text-sm">
              {waitingElapsed >= 10 ? 'Still waiting — device is warming up…' : 'Waiting for first frame…'}
            </p>
            <p className="text-white/30 text-xs">{cadenceLabel} capture cycle · 30s timeout</p>
          </div>
        )}

        {status === 'playing' && imgSrc && (
          <img
            src={imgSrc}
            alt="Live view"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        )}

        {sseError && (
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <p className="text-red-400 text-sm">{sseError}</p>
            <button
              onClick={() => { setSseError(null); handleStart(); }}
              disabled={!isOnline}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {status === 'idle' && !sseError && imgSrc && (
          <>
            <img src={imgSrc} alt="Last frame" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl opacity-30" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-black/70 text-white/50 text-xs font-medium px-3 py-1.5 rounded-full">Stream stopped · last frame</span>
            </div>
          </>
        )}
        {status === 'idle' && !sseError && !imgSrc && (
          <div className="text-white/40 text-sm">
            {isOnline ? 'Press Start Live to begin streaming' : 'Device is offline'}
          </div>
        )}
        </div>

        {/* Remote control panel */}
        <div className="w-48 flex-shrink-0 border-l border-white/10 flex flex-col items-center justify-center gap-5 p-4 bg-black/40">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Remote</p>

          {/* D-pad */}
          <div className="grid grid-cols-3 gap-1.5">
            <div />
            <button onClick={() => sendRemoteKey('ARROW_UP')} title="Up"
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors">
              <ChevronUp className="w-5 h-5" />
            </button>
            <div />
            <button onClick={() => sendRemoteKey('ARROW_LEFT')} title="Left"
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => sendRemoteKey('ENTER')} title="Enter / OK"
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 text-white text-xs font-bold transition-colors">
              OK
            </button>
            <button onClick={() => sendRemoteKey('ARROW_RIGHT')} title="Right"
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
            <div />
            <button onClick={() => sendRemoteKey('ARROW_DOWN')} title="Down"
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors">
              <ChevronDown className="w-5 h-5" />
            </button>
            <div />
          </div>

          {/* Function buttons */}
          <div className="flex gap-2">
            <button onClick={() => sendRemoteKey('MENU')} title="Menu"
              className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-medium transition-colors">
              Menu
            </button>
            <button onClick={() => sendRemoteKey('RETURN')} title="Back / Return"
              className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-medium transition-colors">
              Back
            </button>
          </div>
          <button onClick={() => sendRemoteKey('HOME')} title="Home"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-medium transition-colors w-full justify-center">
            <Home className="w-3.5 h-3.5" />
            Home
          </button>

          {/* Status feedback */}
          {remoteStatus && (
            <span className={`text-[11px] text-center leading-tight ${
              remoteStatus.startsWith('✓') ? 'text-green-400' : 'text-red-400'
            }`}>{remoteStatus}</span>
          )}

          {!isOnline && (
            <p className="text-[10px] text-white/20 text-center">Device offline — MDC may still work over LAN</p>
          )}
        </div>

      </div>
    </div>
  );
}
