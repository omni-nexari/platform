import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bug,
  Command,
  Copy,
  Download,
  Monitor,
  RefreshCw,
  Send,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
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
  screenshots: Array<{ id: string }>;
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
  });

  const { data: devices = [] } = useQuery<DeviceSummary[]>({
    queryKey: ['tizen-test-devices', selectedWorkspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${selectedWorkspaceId}`),
    enabled: !!selectedWorkspaceId,
    refetchInterval: 15_000,
  });

  const { data: detail } = useQuery<DeviceDetailResponse>({
    queryKey: ['tizen-test-detail', selectedDeviceId],
    queryFn: () => api.get(`/devices/${selectedDeviceId}`),
    enabled: !!selectedDeviceId,
    refetchInterval: 5_000,
  });

  const { data: logData } = useQuery<DeviceLogsResponse>({
    queryKey: ['tizen-test-logs', selectedDeviceId],
    queryFn: () => api.get(`/devices/${selectedDeviceId}/logs?limit=1000`),
    enabled: !!selectedDeviceId,
    refetchInterval: 2_000,
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
                      tone={command.key === 'dump_logs' ? 'warning' : 'default'}
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
