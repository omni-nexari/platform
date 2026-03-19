import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { UpdateDeviceSchema } from '@signage/shared';
import type { UpdateDeviceInput, DeviceCommandInput } from '@signage/shared';
import {
  ArrowLeft,
  Wifi,
  WifiOff,
  Power,
  Camera,
  RefreshCw,
  Clock,
  Monitor,
  Cpu,
  Globe,
  Fingerprint,
  Network,
  Thermometer,
  HardDrive,
  Play,
  SkipForward,
  Lock,
  Radio,
  MapPin,
  Download,
  FileText,
  AlertTriangle,
  Settings2,
  Timer,
} from 'lucide-react';
import { formatDistanceToNow } from '../utils/time.js';
import WorkspaceTagPicker from '../../components/WorkspaceTagPicker.js';
import ZoneLayoutEditor, { type ZoneConfig } from '../../components/ZoneLayoutEditor.js';
import {
  ActionButton,
  Badge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  ToggleSwitch,
} from '../../components/UiPrimitives.js';

interface Screenshot {
  id: string;
  storageKey: string;
  takenAt: string;
}

interface DeviceHeartbeat {
  id: string;
  playerVersion: string | null;
  firmwareVersion: string | null;
  powerState: string | null;
  clockDriftMs: number | null;
  irLock: boolean | null;
  buttonLock: boolean | null;
  cpuLoad: number | null;
  storageFreeBytes: number | null;
  temperatureC: number | null;
  currentContentId: string | null;
  nextContentId: string | null;
  nextStartsAt: string | null;
  createdAt: string;
  currentContentName: string | null;
  nextContentName: string | null;
}

interface Device {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  lastSeen: string | null;
  playerVersion: string | null;
  firmwareVersion: string | null;
  resolution: string | null;
  ipAddress: string | null;
  timezone: string;
  settings: string;
  pairingCode: string | null;
  createdAt: string;
  // Hardware identity
  duid: string | null;
  modelName: string | null;
  modelCode: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  // Network
  connectionType: 'wifi' | 'ethernet' | null;
  wifiSsid: string | null;
  wifiStrength: number | null;
  // Display / power
  screenOrientation: 'landscape' | 'portrait' | null;
  powerState: 'on' | 'off' | 'standby';
  irLock: boolean;
  buttonLock: boolean;
  autoPowerOn: boolean;
  // NTP
  ntpEnabled: boolean;
  ntpServer: string | null;
  ntpTimezone: string | null;
  clockDriftMs: number | null;
  // Location
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  // Config
  screenshotIntervalMin: number | null;
  defaultPlaylistId: string | null;
  zones: ZoneConfig[] | null;
}

// ── Small presentational helpers ─────────────────────────────────────────────

function StatusBadge({ status }: { status: Device['status'] }) {
  const map = {
    online:    { label: 'Online',    tone: 'success' },
    offline:   { label: 'Offline',   tone: 'neutral' },
    unclaimed: { label: 'Unclaimed', tone: 'warning' },
    error:     { label: 'Error',     tone: 'danger'  },
  } as const;
  const meta = map[status] ?? map.offline;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function InfoRow({ icon: Icon, label, value }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-[var(--text-muted)]">
        <Icon className="w-3.5 h-3.5 shrink-0" />{label}
      </span>
      <span className="text-[var(--text)] font-mono text-xs text-right max-w-[60%] truncate">
        {value ?? '—'}
      </span>
    </div>
  );
}

function SignalBars({ level }: { level: number }) {
  const filled = Math.min(5, Math.max(0, level));
  return (
    <span className="inline-flex items-end gap-0.5">
      {[1, 2, 3, 4, 5].map((bar) => (
        <span
          key={bar}
          className={`w-1 rounded-sm inline-block ${filled >= bar ? 'bg-emerald-400' : 'bg-[var(--border)]'}`}
          style={{ height: `${bar * 2 + 3}px` }}
        />
      ))}
    </span>
  );
}

function MiniBar({ value, max = 100, tone = 'default' }: {
  value: number; max?: number; tone?: 'default' | 'warning' | 'danger';
}) {
  const pct = Math.min(100, (value / max) * 100);
  const color = tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-400' : 'bg-blue-500';
  return (
    <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeviceDetailPage() {
  const { wsId, deviceId } = useParams<{ wsId: string; deviceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Timer slots
  const [onTimers,  setOnTimers]  = useState<Record<number, string>>({});
  const [offTimers, setOffTimers] = useState<Record<number, string>>({});
  // NTP form
  const [ntpServer,      setNtpServer]      = useState('');
  const [ntpTimezone,    setNtpTimezone]    = useState('');
  const [ntpInitialised, setNtpInitialised] = useState(false);
  // Firmware update form
  const [playerVersion, setPlayerVersion] = useState('');
  const [playerUrl,     setPlayerUrl]     = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceCode, setReplaceCode] = useState('');

  const { data, isLoading } = useQuery<{
    device: Device;
    screenshots: Screenshot[];
    latestHeartbeat: DeviceHeartbeat | null;
  }>({
    queryKey: ['device', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}`),
    refetchInterval: 15_000,
  });

  if (data?.device && !ntpInitialised) {
    setNtpServer(data.device.ntpServer ?? 'pool.ntp.org');
    setNtpTimezone(data.device.ntpTimezone ?? data.device.timezone ?? 'UTC');
    setNtpInitialised(true);
  }

  const {
    register,
    handleSubmit,
    formState: { isDirty, isSubmitting },
  } = useForm<UpdateDeviceInput>({
    resolver: zodResolver(UpdateDeviceSchema),
    ...(data?.device && {
      values: {
        name: data.device.name,
        timezone: data.device.timezone,
        screenshotIntervalMin: data.device.screenshotIntervalMin ?? undefined,
        locationLabel: data.device.locationLabel ?? null,
        latitude: data.device.latitude ?? null,
        longitude: data.device.longitude ?? null,
        defaultPlaylistId: data.device.defaultPlaylistId ?? null,
      },
    }),
  });

  const updateDevice = useMutation({
    mutationFn: (body: UpdateDeviceInput) => api.patch(`/devices/${deviceId}`, body),
    onSuccess: () => {
      toast.success('Device updated');
      void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: () => toast.error('Update failed'),
  });

  const { data: playlists = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['playlists-brief', wsId],
    queryFn: () => api.get(`/playlists?workspaceId=${wsId}`),
    enabled: !!wsId,
    staleTime: 60_000,
  });

  const saveZones = useMutation({
    mutationFn: async (zones: ZoneConfig[]) => {
      await api.patch(`/devices/${deviceId}`, { zones });
      if (isOnline) {
        await api.post(`/devices/${deviceId}/command`, { command: 'set_zones', payload: { zones } });
      }
    },
    onSuccess: () => {
      toast.success(isOnline ? 'Zones saved and pushed to device' : 'Zones saved');
      void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to save zones'),
  });

  const cmdMutation = useMutation({
    mutationFn: (cmd: DeviceCommandInput) =>
      api.post(`/devices/${deviceId}/command`, cmd),
    onSuccess: (_res, cmd) => {
      const labels: Partial<Record<DeviceCommandInput['command'], string>> = {
        reboot:             'Reboot command sent',
        screenshot:         'Screenshot requested',
        refresh_schedule:   'Schedule refresh sent',
        power_off:          'Power-off sent',
        clear_cache:        'Cache clear sent',
        dump_logs:          'Log dump requested — check device OSD',
        update_tv_firmware: 'TV firmware update started',
        update_player:      'Player update sent',
        set_ntp:            'NTP settings applied',
        set_ir_lock:        'IR lock updated',
        set_button_lock:    'Button lock updated',
        set_on_timer:       'ON-timer set',
        set_off_timer:      'OFF-timer set',
        clear_on_timer:     'ON-timer cleared',
        clear_off_timer:    'OFF-timer cleared',
        set_screenshot_interval: 'Screenshot interval updated',
      };
      toast.success(labels[cmd.command] ?? `Command sent: ${cmd.command}`);
      if (cmd.command === 'screenshot') {
        setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['device', deviceId] }), 5000);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Command failed'),
  });

  const replaceDevice = useMutation({
    mutationFn: (newDeviceCode: string) =>
      api.post(`/devices/${deviceId}/replace`, { newDeviceCode }),
    onSuccess: () => {
      toast.success('Device replaced successfully');
      setReplaceOpen(false);
      setReplaceCode('');
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
      navigate(`/workspaces/${wsId}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Device replacement failed'),
  });

  const sendCmd = (cmd: DeviceCommandInput) => cmdMutation.mutate(cmd);

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-[var(--card)] border border-[var(--border)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)]">
        Device not found.{' '}
        <button onClick={() => navigate(-1)} className="underline">Go back</button>
      </div>
    );
  }

  const { device, screenshots, latestHeartbeat: hb } = data;
  const isOnline    = device.status === 'online';
  const cmdDisabled = !isOnline || cmdMutation.isPending;

  const storageFreeMb  = hb?.storageFreeBytes != null ? hb.storageFreeBytes / 1_048_576 : null;
  const storageTotalMb = 8192;
  const storageUsedPct = storageFreeMb != null
    ? Math.max(0, 100 - (storageFreeMb / storageTotalMb) * 100)
    : null;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => navigate(`/workspaces/${wsId}`)}
          className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />Back to Devices
        </button>
        <PageHeader
          className="workspace-page-header mb-0"
          icon={isOnline
            ? <Wifi className="w-6 h-6 text-emerald-400" />
            : <WifiOff className="w-6 h-6 text-[var(--text-muted)]" />}
          title={device.name}
          subtitle={device.lastSeen
            ? <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <Clock className="w-3 h-3" />{formatDistanceToNow(device.lastSeen)}
              </span>
            : 'Never connected'}
          trailing={<StatusBadge status={device.status} />}
          action={(
            <ActionButton onClick={() => setReplaceOpen(true)} tone="default" className="px-4 py-2 text-sm">
              <RefreshCw className="w-4 h-4" />Replace Device
            </ActionButton>
          )}
        />
      </div>

      {/* ── Pairing code ─────────────────────────────────────────────────── */}
      {device.status === 'unclaimed' && device.pairingCode && (
        <SectionCard>
          <SectionCardHeader><Badge tone="warning">Pairing Code</Badge></SectionCardHeader>
          <SectionCardBody className="flex items-center gap-4">
            <p className="text-3xl font-mono font-bold tracking-widest text-amber-400">{device.pairingCode}</p>
            <p className="text-xs text-amber-300/80">Enter this code in the dashboard to pair the device.</p>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* ── #14 Hardware identity  +  #15 Network ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Fingerprint className="w-3.5 h-3.5" />Hardware Identity
            </h2>
          </SectionCardHeader>
          <SectionCardBody className="space-y-3">
            <InfoRow icon={Monitor}     label="Model"          value={[device.modelName, device.modelCode].filter(Boolean).join(' / ') || null} />
            <InfoRow icon={Fingerprint} label="DUID"           value={device.duid} />
            <InfoRow icon={Settings2}   label="Serial Number"  value={device.serialNumber} />
            <InfoRow icon={Cpu}         label="Firmware"       value={device.firmwareVersion} />
            <InfoRow icon={Cpu}         label="Player version" value={device.playerVersion ? `v${device.playerVersion}` : null} />
            <InfoRow icon={Monitor}     label="Resolution"     value={device.resolution} />
            <InfoRow icon={Globe}       label="Timezone"       value={device.timezone} />
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Network className="w-3.5 h-3.5" />Network
            </h2>
          </SectionCardHeader>
          <SectionCardBody className="space-y-3">
            <InfoRow icon={Globe}   label="IP Address"  value={device.ipAddress} />
            <InfoRow icon={Network} label="MAC Address" value={device.macAddress} />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[var(--text-muted)]">
                <Wifi className="w-3.5 h-3.5" />Connection
              </span>
              {device.connectionType
                ? <Badge tone={device.connectionType === 'wifi' ? 'accent' : 'neutral'}>
                    {device.connectionType.toUpperCase()}
                  </Badge>
                : <span className="text-[var(--text-muted)] text-xs">—</span>}
            </div>
            {device.connectionType === 'wifi' && (
              <>
                <InfoRow icon={Wifi} label="SSID" value={device.wifiSsid} />
                {device.wifiStrength != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Radio className="w-3.5 h-3.5" />Signal
                    </span>
                    <span className="flex items-center gap-2">
                      <SignalBars level={device.wifiStrength} />
                      <span className="text-[var(--text)] font-mono text-xs">{device.wifiStrength}/5</span>
                    </span>
                  </div>
                )}
              </>
            )}
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* ── #21 Telemetry  +  #23 Now Playing ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Thermometer className="w-3.5 h-3.5" />Telemetry
            </h2>
            {hb?.createdAt && (
              <span className="text-xs text-[var(--text-muted)]">{formatDistanceToNow(hb.createdAt)}</span>
            )}
          </SectionCardHeader>
          <SectionCardBody className="space-y-4">
            {hb ? (
              <>
                {hb.temperatureC != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Thermometer className="w-3.5 h-3.5" />Temperature
                    </span>
                    <Badge tone={hb.temperatureC > 70 ? 'danger' : hb.temperatureC > 55 ? 'warning' : 'neutral'}>
                      {hb.temperatureC.toFixed(1)} °C
                    </Badge>
                  </div>
                )}
                {hb.cpuLoad != null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                      <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3" />CPU</span>
                      <span className="font-mono">{hb.cpuLoad.toFixed(1)}%</span>
                    </div>
                    <MiniBar value={hb.cpuLoad} tone={hb.cpuLoad > 85 ? 'danger' : hb.cpuLoad > 65 ? 'warning' : 'default'} />
                  </div>
                )}
                {storageUsedPct != null && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                      <span className="flex items-center gap-1.5"><HardDrive className="w-3 h-3" />Storage used</span>
                      <span className="font-mono">
                        {storageFreeMb != null ? `${(storageFreeMb / 1024).toFixed(1)} GB free` : `${storageUsedPct.toFixed(0)}%`}
                      </span>
                    </div>
                    <MiniBar value={storageUsedPct} tone={storageUsedPct > 90 ? 'danger' : storageUsedPct > 75 ? 'warning' : 'default'} />
                  </div>
                )}
                {hb.clockDriftMs != null && (
                  <InfoRow icon={Clock} label="Clock drift"
                    value={`${hb.clockDriftMs > 0 ? '+' : ''}${hb.clockDriftMs} ms`} />
                )}
                {hb.powerState && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Power className="w-3.5 h-3.5" />Power state
                    </span>
                    <Badge tone={hb.powerState === 'on' ? 'success' : hb.powerState === 'standby' ? 'warning' : 'neutral'}>
                      {hb.powerState}
                    </Badge>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No heartbeat data yet.</p>
            )}
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Play className="w-3.5 h-3.5" />Now Playing
            </h2>
          </SectionCardHeader>
          <SectionCardBody className="space-y-3">
            {hb ? (
              <>
                <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3 space-y-1">
                  <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                    <Play className="w-3 h-3" />Now Playing
                  </p>
                  <p className="text-sm text-[var(--text)] font-medium truncate">
                    {hb.currentContentName ?? (hb.currentContentId ? '(unknown)' : 'Nothing')}
                  </p>
                </div>
                {hb.nextContentId && (
                  <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3 space-y-1">
                    <p className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
                      <SkipForward className="w-3 h-3" />Up Next
                      {hb.nextStartsAt && (
                        <span className="ml-auto font-mono">
                          {new Date(hb.nextStartsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-[var(--text)] truncate">
                      {hb.nextContentName ?? '(unknown)'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No playback data yet.</p>
            )}
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* ── #16 / #17 Power + lock toggles ──────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <Power className="w-3.5 h-3.5" />Power &amp; Controls
          </h2>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <p className="text-xs text-[var(--text-muted)]">Orientation</p>
              <Badge tone={device.screenOrientation === 'portrait' ? 'accent' : 'neutral'}>
                {device.screenOrientation ?? 'Unknown'}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <p className="text-xs text-[var(--text-muted)]">Power</p>
              <div className="flex items-center gap-2">
                <Badge tone={device.powerState === 'on' ? 'success' : device.powerState === 'standby' ? 'warning' : 'neutral'}>
                  {device.powerState}
                </Badge>
                {isOnline && device.powerState !== 'off' && (
                  <button onClick={() => sendCmd({ command: 'power_off' })} disabled={cmdDisabled}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40" title="Power off">
                    <Power className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                <Lock className="w-3 h-3" />IR Lock
              </p>
              <ToggleSwitch
                label={device.irLock ? 'Locked' : 'Unlocked'}
                checked={device.irLock}
                onChange={() => isOnline && sendCmd({ command: 'set_ir_lock', payload: { lock: !device.irLock } })}
                labelClassName="text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                <Lock className="w-3 h-3" />Button Lock
              </p>
              <ToggleSwitch
                label={device.buttonLock ? 'Locked' : 'Unlocked'}
                checked={device.buttonLock}
                onChange={() => isOnline && sendCmd({ command: 'set_button_lock', payload: { lock: !device.buttonLock } })}
                labelClassName="text-xs"
              />
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── #18 Timer Management ─────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <Timer className="w-3.5 h-3.5" />Timer Management
          </h2>
          <span className="text-xs text-[var(--text-muted)]">7 ON / 7 OFF power timers</span>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-emerald-400 mb-3 uppercase tracking-wide">ON Timers</p>
              <div className="space-y-2">
                {[1,2,3,4,5,6,7].map((slot) => (
                  <div key={slot} className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)] w-5 shrink-0">#{slot}</span>
                    <input type="time" value={onTimers[slot] ?? ''}
                      onChange={(e) => setOnTimers((p) => ({ ...p, [slot]: e.target.value }))}
                      className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs font-mono focus:outline-none focus:border-[var(--blue)]" />
                    <button disabled={cmdDisabled || !onTimers[slot]}
                      onClick={() => sendCmd({ command: 'set_on_timer', payload: { slot, time: onTimers[slot]! } })}
                      className="px-2 py-1 rounded text-xs bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-30">Set</button>
                    <button disabled={cmdDisabled}
                      onClick={() => sendCmd({ command: 'clear_on_timer', payload: { slot } })}
                      className="px-2 py-1 rounded text-xs bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30">×</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-400 mb-3 uppercase tracking-wide">OFF Timers</p>
              <div className="space-y-2">
                {[1,2,3,4,5,6,7].map((slot) => (
                  <div key={slot} className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)] w-5 shrink-0">#{slot}</span>
                    <input type="time" value={offTimers[slot] ?? ''}
                      onChange={(e) => setOffTimers((p) => ({ ...p, [slot]: e.target.value }))}
                      className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs font-mono focus:outline-none focus:border-[var(--blue)]" />
                    <button disabled={cmdDisabled || !offTimers[slot]}
                      onClick={() => sendCmd({ command: 'set_off_timer', payload: { slot, time: offTimers[slot]! } })}
                      className="px-2 py-1 rounded text-xs bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-30">Set</button>
                    <button disabled={cmdDisabled}
                      onClick={() => sendCmd({ command: 'clear_off_timer', payload: { slot } })}
                      className="px-2 py-1 rounded text-xs bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30">×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── #19 NTP ──────────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <Clock className="w-3.5 h-3.5" />NTP Configuration
          </h2>
          <div className="flex items-center gap-2">
            <Badge tone={device.ntpEnabled ? 'success' : 'neutral'}>
              {device.ntpEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {device.clockDriftMs != null && (
              <span className="text-xs text-[var(--text-muted)]">Drift: {device.clockDriftMs} ms</span>
            )}
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">NTP Server</label>
              <input value={ntpServer} onChange={(e) => setNtpServer(e.target.value)}
                placeholder="pool.ntp.org"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Timezone</label>
              <input value={ntpTimezone} onChange={(e) => setNtpTimezone(e.target.value)}
                placeholder="Asia/Seoul"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            <div className="flex items-end">
              <ActionButton
                onClick={() => sendCmd({ command: 'set_ntp', payload: { server: ntpServer, timezone: ntpTimezone } })}
                disabled={cmdDisabled || !ntpServer || !ntpTimezone}
                tone="primary" className="px-4 py-2 text-sm"
              >Apply NTP</ActionButton>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── #20 Firmware ─────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <Download className="w-3.5 h-3.5" />Firmware &amp; Updates
          </h2>
        </SectionCardHeader>
        <SectionCardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">TV Firmware</p>
              <p className="text-xs text-[var(--text-muted)]">Current: {device.firmwareVersion ?? 'Unknown'}</p>
            </div>
            <ActionButton onClick={() => sendCmd({ command: 'update_tv_firmware' })}
              disabled={cmdDisabled} tone="warning" className="px-4 py-2 text-sm">
              <Download className="w-4 h-4" />Update TV Firmware
            </ActionButton>
          </div>
          <div className="h-px bg-[var(--border)]" />
          <div className="space-y-3">
            <p className="text-sm font-medium text-[var(--text)]">Player App Update</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input value={playerVersion} onChange={(e) => setPlayerVersion(e.target.value)}
                placeholder="Version (e.g. 1.2.3)"
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
              <input value={playerUrl} onChange={(e) => setPlayerUrl(e.target.value)}
                placeholder="Download URL"
                className="flex-[2] px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
              <ActionButton
                onClick={() => sendCmd({ command: 'update_player', payload: { version: playerVersion, downloadUrl: playerUrl } })}
                disabled={cmdDisabled || !playerVersion || !playerUrl}
                tone="primary" className="px-4 py-2 text-sm shrink-0"
              >Push Update</ActionButton>
            </div>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── Settings (#25 screenshot interval + #26 location) ───────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Settings</h2>
        </SectionCardHeader>
        <SectionCardBody>
          <form onSubmit={handleSubmit((d) => updateDevice.mutate(d))}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Display Name</label>
              <input {...register('name')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Timezone</label>
              <input {...register('timezone')} placeholder="UTC"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            {/* Default playlist fallback */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                Default Playlist <span className="font-normal">(shown when no schedule slot is active)</span>
              </label>
              <select {...register('defaultPlaylistId')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]">
                <option value="">— Use workspace default —</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            {/* #25 Screenshot interval */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                <Camera className="w-3 h-3" />Auto-screenshot interval (min)
              </label>
              <input type="number" min={1} {...register('screenshotIntervalMin', { valueAsNumber: true })}
                placeholder="60"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            {/* #26 Location */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" />Location Label
              </label>
              <input {...register('locationLabel')} placeholder="e.g. Lobby Level 3"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Latitude</label>
              <input type="number" step="any" {...register('latitude', { valueAsNumber: true })}
                placeholder="37.5665"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Longitude</label>
              <input type="number" step="any" {...register('longitude', { valueAsNumber: true })}
                placeholder="126.9780"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
            </div>
            {device.latitude != null && device.longitude != null && (
              <div className="sm:col-span-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono">{device.latitude.toFixed(6)}, {device.longitude.toFixed(6)}</span>
                {device.locationLabel && <span className="text-[var(--text)]">— {device.locationLabel}</span>}
                <a href={`https://maps.google.com/?q=${device.latitude},${device.longitude}`}
                  target="_blank" rel="noopener noreferrer" className="text-blue-400 underline ml-1">
                  View map
                </a>
              </div>
            )}
            <div className="sm:col-span-2 flex justify-end">
              <ActionButton type="submit" disabled={!isDirty || isSubmitting || updateDevice.isPending}
                tone="primary" className="px-4 py-2 text-sm">
                Save Changes
              </ActionButton>
            </div>
          </form>
        </SectionCardBody>
      </SectionCard>

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Tags</h2>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="max-w-md space-y-3">
            <WorkspaceTagPicker workspaceId={wsId!} entityId={deviceId ?? null} entityType="device" />
          </div>
        </SectionCardBody>
      </SectionCard>

      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Zone Layout</h2>
          <span className="text-xs text-[var(--text-muted)]">1920 × 1080 coordinate space</span>
        </SectionCardHeader>
        <SectionCardBody>
          <ZoneLayoutEditor
            initialZones={device.zones ?? []}
            playlists={playlists}
            saving={saveZones.isPending}
            onSave={(zones) => saveZones.mutate(zones)}
          />
        </SectionCardBody>
      </SectionCard>

      {/* ── Remote Commands ──────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Remote Commands</h2>
        </SectionCardHeader>
        <SectionCardBody>
          {!isOnline && (
            <p className="text-xs text-[var(--text-muted)] mb-3 p-2 rounded-lg bg-[var(--surface)]">
              Device must be online to send commands.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(
              [
                { cmd: { command: 'screenshot' }         as DeviceCommandInput, label: 'Take Screenshot',    icon: Camera,    hint: 'Capture current display',      danger: false },
                { cmd: { command: 'refresh_schedule' }   as DeviceCommandInput, label: 'Refresh Schedule',   icon: RefreshCw, hint: 'Force pull latest schedule',   danger: false },
                { cmd: { command: 'clear_cache' }        as DeviceCommandInput, label: 'Clear Cache',        icon: HardDrive, hint: 'Delete all local media cache', danger: false },
                { cmd: { command: 'dump_logs' }          as DeviceCommandInput, label: 'Dump Logs',          icon: FileText,  hint: 'Output log to OSD overlay',    danger: false },
                { cmd: { command: 'reboot' }             as DeviceCommandInput, label: 'Reboot Device',      icon: Power,     hint: 'Restart the player app',       danger: true  },
                { cmd: { command: 'update_tv_firmware' } as DeviceCommandInput, label: 'Update TV Firmware', icon: Download,  hint: 'Trigger Samsung OTA update',   danger: false },
              ] as Array<{ cmd: DeviceCommandInput; label: string; icon: React.ElementType; hint: string; danger: boolean }>
            ).map(({ cmd, label, icon: Icon, hint, danger }) => (
              <ActionButton key={cmd.command} disabled={cmdDisabled} onClick={() => sendCmd(cmd)}
                tone={danger ? 'danger' : 'default'}
                className="justify-start px-4 py-3 text-sm disabled:cursor-not-allowed">
                <Icon className="w-4 h-4 shrink-0" />
                <div className="text-left">
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{hint}</p>
                </div>
              </ActionButton>
            ))}
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── #24 Device Logs ──────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <FileText className="w-3.5 h-3.5" />Device Logs
          </h2>
        </SectionCardHeader>
        <SectionCardBody className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface)] text-xs text-[var(--text-muted)]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <p>
              Use <strong className="text-[var(--text)]">Dump Logs</strong> to push the on-device log
              buffer to the player&rsquo;s OSD overlay. Logs are not persisted server-side in this release.
            </p>
          </div>
          <ActionButton disabled={cmdDisabled} onClick={() => sendCmd({ command: 'dump_logs' })}
            tone="default" className="px-4 py-2 text-sm">
            <FileText className="w-4 h-4" />Request Log Dump
          </ActionButton>
        </SectionCardBody>
      </SectionCard>

      {/* ── Screenshot gallery ───────────────────────────────────────────── */}
      {screenshots.length > 0 && (
        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold text-[var(--text)]">
              Screenshots <span className="text-[var(--text-muted)] font-normal">({screenshots.length})</span>
            </h2>
          </SectionCardHeader>
          <SectionCardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {screenshots.map((s) => (
                <div key={s.id} className="aspect-video rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden relative group">
                  <img src={`/api/media/${s.storageKey}`} alt={`Screenshot ${s.takenAt}`}
                    className="w-full h-full object-cover" loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="absolute inset-0 flex items-end justify-start p-1.5 bg-gradient-to-t from-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-white text-[10px]">{new Date(s.takenAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCardBody>
        </SectionCard>
      )}

      {replaceOpen && (
        <Modal onClose={() => { setReplaceOpen(false); setReplaceCode(''); }} size="sm">
          <ModalHeader
            title="Replace Device"
            subtitle="Enter the pairing code shown on the new display. Settings and tags from this device will be transferred."
            onClose={() => { setReplaceOpen(false); setReplaceCode(''); }}
          />
          <ModalBody className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                New Device Pairing Code
              </label>
              <input
                value={replaceCode}
                onChange={(e) => setReplaceCode(e.target.value.toUpperCase())}
                placeholder="AB3X7K"
                maxLength={12}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono uppercase tracking-widest text-center focus:outline-none focus:border-[var(--blue)]"
                style={{ letterSpacing: '0.3em' }}
              />
            </div>
            <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
              The old device will be retired after transfer. The new device will inherit the current workspace, player defaults, tags, location, timers, and other saved settings.
            </div>
          </ModalBody>
          <ModalFooter className="modal-footer-plain">
            <ModalSecondaryButton onClick={() => { setReplaceOpen(false); setReplaceCode(''); }}>
              Cancel
            </ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => replaceDevice.mutate(replaceCode.trim())}
              disabled={!replaceCode.trim() || replaceDevice.isPending}
            >
              {replaceDevice.isPending ? 'Replacing…' : 'Replace Device'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
