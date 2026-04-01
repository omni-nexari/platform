import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bug, Monitor, TerminalSquare } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';
import {
  ActionButton,
  EmptyState,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';

type Workspace = { id: string; name: string };
type DeviceSummary = { id: string; name: string; status: string; modelName: string | null };
type MdcResult = { ok: boolean; rawHex?: string; data?: number[]; error?: string } & Record<string, unknown>;

const RESULT_LABELS: Record<string, string> = {
  displayId: 'Display ID',
  label: 'Label',
  meaning: 'Meaning',
  value: 'Value',
  valueHex: 'Value (Hex)',
  requestedValue: 'Requested Value',
  contrast: 'Contrast',
  brightness: 'Brightness',
  sharpness: 'Sharpness',
  color: 'Color',
  tint: 'Tint',
  colorTone: 'Color Tone',
  colorTemp: 'Color Temp',
  redGain: 'Red Gain',
  greenGain: 'Green Gain',
  blueGain: 'Blue Gain',
  modelName: 'Model Name',
  brightnessSensor: 'Brightness Sensor',
  mdcIdDisplay: 'MDC ID Display',
  urlAddress: 'URL Address',
  ssid: 'SSID',
  macAddress: 'MAC Address',
  pin: 'PIN',
  panelOnOff: 'Panel On/Off',
  source: 'Source',
  videoWallOnOff: 'Video Wall On/Off',
  videoWallPosition: 'Video Wall Position',
  videoWallDivision: 'Video Wall Division',
  videoWallMode: 'Video Wall Mode',
  rotation: 'Rotation',
  swVersion: 'SW Version',
  modelCode: 'Model Code',
  serialNumber: 'Serial Number',
  screenSize: 'Screen Size (inch)',
  ipAddress: 'IP Address',
  subnetMask: 'Subnet Mask',
  gateway: 'Gateway',
  dns: 'DNS',
  weekDay: 'Weekday Bitmask',
  weekDayText: 'Weekday',
  timeHour: 'Hour',
  timeMinute: 'Minute',
  safetyScreenType: 'Safety Screen Type',
  tickerOnOff: 'Ticker On/Off',
  tickerMessage: 'Ticker Message',
  tickerStart: 'Ticker Start',
  tickerEnd: 'Ticker End',
  dataLength: 'Data Length',
};

const SAFETY_SCREEN_TYPES: Array<{ value: number; label: string }> = [
  { value: 0x00, label: 'Off (0x00)' },
  { value: 0x01, label: 'Signal Pattern (0x01)' },
  { value: 0x02, label: 'All White (0x02)' },
  { value: 0x03, label: 'Scroll (0x03)' },
  { value: 0x04, label: 'Bar (0x04)' },
  { value: 0x06, label: 'Eraser (0x06)' },
  { value: 0x07, label: 'Pixel (0x07)' },
  { value: 0x10, label: 'Rolling Bar (0x10)' },
  { value: 0x11, label: 'Fading Screen (0x11)' },
];

function byteHex(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return 'Unknown';
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

function extractDisplayId(result: MdcResult) {
  if (typeof result.displayId === 'number') return result.displayId;
  const rawHex = typeof result.rawHex === 'string' ? result.rawHex : '';
  const parts = rawHex.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const value = Number.parseInt(parts[2] ?? '', 16);
  return Number.isNaN(value) ? undefined : value;
}

function withDisplayId(result: MdcResult) {
  const displayId = extractDisplayId(result);
  if (displayId == null) return result;
  return {
    ...result,
    displayId: `${displayId} (${byteHex(displayId)})`,
  };
}

function decodeAscii(data: number[]) {
  return data
    .filter((value) => value >= 0x20 && value <= 0x7e)
    .map((value) => String.fromCharCode(value))
    .join('')
    .trim();
}

function decodeWeekdayMask(mask: number | undefined) {
  if (mask == null) return 'Unknown';
  const names = ['Sunday', 'Saturday', 'Friday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday'];
  const active = names.filter((_, i) => ((mask >> i) & 1) === 1);
  return active.length ? active.join(', ') : 'No restart day selected';
}

function ipFromBytes(data: number[], start: number) {
  if (data.length < start + 4) return 'Unknown';
  return `${data[start]}.${data[start + 1]}.${data[start + 2]}.${data[start + 3]}`;
}

function decodeMdcResult(action: string, result: MdcResult, payload: Record<string, unknown> = {}): MdcResult {
  const data = Array.isArray(result.data) ? result.data : [];
  const resultWithId = withDisplayId(result);
  if (!result.ok) return resultWithId;

  switch (action) {
    case 'video_control_get':
      return {
        ...resultWithId,
        label: 'Video Control (0x04)',
        contrast: data[0],
        brightness: data[1],
        sharpness: data[2],
        color: data[3],
        tint: data[4],
        colorTone: data[5],
        colorTemp: data[6],
      };
    case 'rgb_control_get':
      return {
        ...resultWithId,
        label: 'RGB Control (0x06)',
        contrast: data[0],
        brightness: data[1],
        colorTone: data[2],
        colorTemp: data[3],
        redGain: data[4],
        greenGain: data[5],
        blueGain: data[6],
      };
    case 'maintenance_get':
      return {
        ...resultWithId,
        label: 'Maintenance Control (0x08)',
        dataLength: data.length,
      };
    case 'serial_number_get':
      return {
        ...resultWithId,
        label: 'Serial Number (0x0B)',
        serialNumber: decodeAscii(data),
      };
    case 'model_name_get':
      return {
        ...resultWithId,
        label: 'Model Name (0x8A)',
        modelName: decodeAscii(data),
      };
    case 'screen_size_get':
      return {
        ...resultWithId,
        label: 'Screen Size (0x19)',
        screenSize: data[0],
      };
    case 'network_config_get': {
      const offset = data[0] === 0x82 ? 1 : 0;
      return {
        ...resultWithId,
        label: 'Network Config (0x1B, sub 0x82)',
        ipAddress: ipFromBytes(data, offset),
        subnetMask: ipFromBytes(data, offset + 4),
        gateway: ipFromBytes(data, offset + 8),
        dns: ipFromBytes(data, offset + 12),
      };
    }
    case 'network_config_set':
      return {
        ...resultWithId,
        label: 'Network Config Set',
        ipAddress: String(payload.ipAddress ?? ''),
        subnetMask: String(payload.subnetMask ?? ''),
        gateway: String(payload.gateway ?? ''),
        dns: String(payload.dns ?? ''),
      };
    case 'weekly_restart_get': {
      const offset = data[0] === 0xa2 ? 1 : 0;
      const weekDay = data[offset];
      const hour = data[offset + 1];
      const minute = data[offset + 2];
      return {
        ...resultWithId,
        label: 'Weekly Restart (0x1B, sub 0xA2)',
        weekDay,
        weekDayText: decodeWeekdayMask(weekDay),
        timeHour: hour,
        timeMinute: minute,
      };
    }
    case 'weekly_restart_set': {
      const weekDay = Number(payload.weekDay ?? 0);
      const hour = Number(payload.timeHour ?? 0);
      const minute = Number(payload.timeMinute ?? 0);
      return {
        ...resultWithId,
        label: 'Weekly Restart Set',
        weekDay,
        weekDayText: decodeWeekdayMask(weekDay),
        timeHour: hour,
        timeMinute: minute,
      };
    }
    case 'brightness_get':
    case 'sharpness_get':
    case 'color_get':
      return {
        ...resultWithId,
        value: data[0],
        valueHex: byteHex(data[0]),
      };
    case 'brightness_set':
    case 'sharpness_set':
    case 'color_set':
      return {
        ...resultWithId,
        requestedValue: Number(payload.value ?? 0),
      };
    case 'brightness_sensor_get':
      return {
        ...resultWithId,
        label: 'Brightness Sensor (0x86)',
        value: data[0],
        brightnessSensor: data[0] === 1 ? 'On' : 'Off',
      };
    case 'brightness_sensor_set':
      return {
        ...resultWithId,
        label: 'Brightness Sensor Set',
        requestedValue: Number(payload.value ?? 0),
        brightnessSensor: Number(payload.value ?? 0) === 1 ? 'On' : 'Off',
      };
    case 'mdc_id_display_set':
      return {
        ...resultWithId,
        label: 'MDC ID Display (0xB9)',
        requestedValue: Number(payload.value ?? 0),
        mdcIdDisplay: Number(payload.value ?? 0) === 1 ? 'Show' : 'Hide',
      };
    case 'url_launcher_address_get': {
      const offset = data[0] === 0x82 ? 1 : 0;
      return {
        ...resultWithId,
        label: 'URL Launcher Address (0xC7, sub 0x82)',
        urlAddress: decodeAscii(data.slice(offset)),
      };
    }
    case 'url_launcher_address_set':
      return {
        ...resultWithId,
        label: 'URL Launcher Address Set',
        urlAddress: String(payload.urlAddress ?? ''),
      };
    case 'safety_screen_run_get': {
      const value = data[0];
      const label = SAFETY_SCREEN_TYPES.find((item) => item.value === value)?.label ?? `Unknown (${byteHex(value)})`;
      return {
        ...resultWithId,
        value,
        safetyScreenType: label,
      };
    }
    case 'safety_screen_run_set': {
      const value = Number(payload.value ?? 0);
      const label = SAFETY_SCREEN_TYPES.find((item) => item.value === value)?.label ?? `Unknown (${byteHex(value)})`;
      return {
        ...resultWithId,
        requestedValue: value,
        safetyScreenType: label,
      };
    }
    case 'ticker_get': {
      // 15-byte header: [onOff, startH, startM, endH, endM, posH, posV, motionOO, motionDir, motionSpeed, fontSize, fgCol, bgCol, fgOp, bgOp], then message
      const text = decodeAscii(data.slice(15));
      return {
        ...resultWithId,
        label: 'Ticker (0x63)',
        tickerOnOff: data[0] === 1 ? 'On' : 'Off',
        tickerStart: `${String(data[1] ?? 0).padStart(2, '0')}:${String(data[2] ?? 0).padStart(2, '0')}`,
        tickerEnd: `${String(data[3] ?? 0).padStart(2, '0')}:${String(data[4] ?? 0).padStart(2, '0')}`,
        tickerMessage: text || '(empty)',
      };
    }
    case 'ticker_set':
      return {
        ...resultWithId,
        label: 'Ticker Set',
        tickerOnOff: Number(payload.onOff ?? 0) === 1 ? 'On' : 'Off',
        tickerMessage: String(payload.message ?? ''),
      };
    case 'network_wifi_set':
      return {
        ...resultWithId,
        label: 'WiFi AP Config Set (0x1B.0x8A)',
        ssid: String(payload.ssid ?? ''),
      };
    case 'child_device_get':
      return {
        ...resultWithId,
        label: 'Child Device Info (0x0A.0x81)',
        panelOnOff: data[1] === 0 ? 'On' : 'Off',
        source: byteHex(data[2]),
        videoWallOnOff: data[3] === 0 ? 'Off' : 'On',
        videoWallPosition: data[4],
        videoWallDivision: data[5],
        videoWallMode: data[6] === 0 ? 'Natural' : 'Full',
        rotation: byteHex(data[7]),
        screenSize: data[8],
        modelCode: byteHex(data[9]),
        swVersion: String(result.swVersion ?? ''),
        modelName: String(result.modelName ?? ''),
      };
    case 'mac_address_get': {
      const offset = data[0] === 0x81 ? 1 : 0;
      const macRaw = decodeAscii(data.slice(offset, offset + 12));
      const macAddress = macRaw.length === 12
        ? macRaw.replace(/(.{2})/g, '$1:').slice(0, 17)
        : (macRaw || String(result.macAddress ?? ''));
      return {
        ...resultWithId,
        label: 'MAC Address (0x1B.0x81)',
        macAddress,
      };
    }
    case 'device_pin_get':
      return {
        ...resultWithId,
        label: 'Device PIN (0x1B.0x87)',
        pin: String(result.pin ?? ''),
      };
    case 'device_pin_set':
      return {
        ...resultWithId,
        label: 'Device PIN Set',
        pin: String(payload.pin ?? ''),
      };
    default:
      return resultWithId;
  }
}

function ResultPanel({ result }: { result: MdcResult | null | undefined }) {
  if (!result) return null;
  const skip = new Set(['ok', 'rawHex', 'data', 'error']);
  const parsed = Object.entries(result).filter(([k]) => !skip.has(k));
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs space-y-1.5">
      <div className={`font-semibold ${result.ok ? 'text-green-500' : 'text-red-400'}`}>
        {result.ok ? 'OK' : 'Error'}
      </div>
      {result.error ? <div className="text-red-400">{String(result.error)}</div> : null}
      {parsed.length > 0 ? (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-0.5">
          {parsed.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[var(--text-muted)]">{RESULT_LABELS[k] ?? k}</dt>
              <dd className="font-mono text-[var(--text)]">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.rawHex ? (
        <div className="font-mono text-[10px] text-[var(--text-muted)] break-all pt-1 border-t border-[var(--border)]">
          Raw ACK: {String(result.rawHex)}
        </div>
      ) : null}
    </div>
  );
}

export default function TizenTestPage() {
  const { user, bootstrapped } = useAuthStore();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, MdcResult | null>>({});

  const [ipAddress, setIpAddress] = useState('192.168.0.100');
  const [subnetMask, setSubnetMask] = useState('255.255.255.0');
  const [gateway, setGateway] = useState('192.168.0.1');
  const [dns, setDns] = useState('8.8.8.8');

  const [weekDay, setWeekDay] = useState(0);
  const [timeHour, setTimeHour] = useState(3);
  const [timeMinute, setTimeMinute] = useState(0);

  const [brightness, setBrightness] = useState(50);
  const [sharpness, setSharpness] = useState(50);
  const [color, setColor] = useState(50);
  const [brightnessSensor, setBrightnessSensor] = useState(0);
  const [mdcIdDisplay, setMdcIdDisplay] = useState(0);
  const [urlLauncherAddress, setUrlLauncherAddress] = useState('https://example.com');
  const [safetyScreenType, setSafetyScreenType] = useState(0x00);

  const [tickerOnOff, setTickerOnOff] = useState(1);
  const [tickerMessage, setTickerMessage] = useState('PLATFORM TEST TICKER');
  const [tickerStartHour, setTickerStartHour] = useState(9);
  const [tickerStartMinute, setTickerStartMinute] = useState(0);
  const [tickerEndHour, setTickerEndHour] = useState(6);
  const [tickerEndMinute, setTickerEndMinute] = useState(0);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [devicePin, setDevicePin] = useState('');

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
    enabled: bootstrapped && !!user,
    retry: false,
  });

  const { data: devices = [] } = useQuery<DeviceSummary[]>({
    queryKey: ['mdc-test-devices', selectedWorkspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${selectedWorkspaceId}`),
    enabled: bootstrapped && !!user && !!selectedWorkspaceId,
    retry: false,
  });

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) ?? null;

  async function runMdc(key: string, action: string, payload: Record<string, unknown> = {}) {
    if (!selectedDeviceId) return;
    setPending(key);
    try {
      const result = await api.post(`/devices/${selectedDeviceId}/mdc-control`, { action, ...payload }) as MdcResult;
      setResults((prev) => ({ ...prev, [key]: decodeMdcResult(action, result, payload) }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setResults((prev) => ({ ...prev, [key]: { ok: false, error: msg } }));
      toast.error(msg);
    } finally {
      setPending(null);
    }
  }

  const busy = (key: string) => pending === key;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <PageHeader
        icon={<Bug className="w-6 h-6" />}
        title="Tizen MDC Test"
        subtitle="Testing page for extended MDC command coverage."
        trailing={
          <div className="flex flex-wrap gap-3">
            <select
              value={selectedWorkspaceId}
              onChange={(e) => { setSelectedWorkspaceId(e.target.value); setSelectedDeviceId(''); }}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] min-w-48"
            >
              <option value="">Select workspace</option>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={!selectedWorkspaceId}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] min-w-64"
            >
              <option value="">Select device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.modelName ? ` - ${d.modelName}` : ''}</option>
              ))}
            </select>
          </div>
        }
      />

      {!selectedWorkspaceId ? (
        <EmptyState icon={<Monitor className="w-6 h-6" />} title="Select a workspace" description="Choose the workspace containing the Samsung display you want to test." />
      ) : !selectedDeviceId ? (
        <EmptyState
          icon={<TerminalSquare className="w-6 h-6" />}
          title={devices.length ? 'Select a device' : 'No devices found'}
          description={devices.length
            ? `Workspace "${selectedWorkspace?.name ?? ''}" has ${devices.length} device${devices.length === 1 ? '' : 's'}.`
            : 'This workspace has no paired devices yet.'}
        />
      ) : (
        <>
          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Video Control (0x04)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('video', 'video_control_get')} disabled={busy('video')}>GET</ActionButton>
              <ResultPanel result={results['video'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">RGB Control (0x06)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('rgb', 'rgb_control_get')} disabled={busy('rgb')}>GET</ActionButton>
              <ResultPanel result={results['rgb'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Maintenance Control (0x08)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('maintenance', 'maintenance_get')} disabled={busy('maintenance')}>GET</ActionButton>
              <ResultPanel result={results['maintenance'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Serial Number (0x0B)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('serial', 'serial_number_get')} disabled={busy('serial')}>GET</ActionButton>
              <ResultPanel result={results['serial'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Model Name (0x8A)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('modelName', 'model_name_get')} disabled={busy('modelName')}>GET</ActionButton>
              <ResultPanel result={results['modelName'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Screen Size (0x19)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('screenSize', 'screen_size_get')} disabled={busy('screenSize')}>GET</ActionButton>
              <ResultPanel result={results['screenSize'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Child Device Info (0x0A.0x81)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('childDevice', 'child_device_get')} disabled={busy('childDevice')}>GET</ActionButton>
              <ResultPanel result={results['childDevice'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">MAC Address (0x1B.0x81)</h2></SectionCardHeader>
            <SectionCardBody>
              <ActionButton onClick={() => runMdc('macAddress', 'mac_address_get')} disabled={busy('macAddress')}>GET</ActionButton>
              <ResultPanel result={results['macAddress'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Device PIN (0x1B.0x87)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">Note: spec states this will not work via Ethernet — RS232C only.</p>
              <input
                value={devicePin}
                onChange={(e) => setDevicePin(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full sm:w-56"
                placeholder="PIN"
              />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('devicePin', 'device_pin_get')} disabled={busy('devicePin')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('devicePin', 'device_pin_set', { pin: devicePin })} disabled={busy('devicePin') || !devicePin}>SET</ActionButton>
              </div>
              <ResultPanel result={results['devicePin'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Network Config (0x1B.0x82)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="IP Address" />
                <input value={subnetMask} onChange={(e) => setSubnetMask(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Subnet Mask" />
                <input value={gateway} onChange={(e) => setGateway(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Gateway" />
                <input value={dns} onChange={(e) => setDns(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="DNS" />
              </div>
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('network', 'network_config_get')} disabled={busy('network')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('network', 'network_config_set', { ipAddress, subnetMask, gateway, dns })} disabled={busy('network')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['network'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">URL Launcher Address (0xC7.0x82)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <input
                value={urlLauncherAddress}
                onChange={(e) => setUrlLauncherAddress(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full"
                placeholder="https://example.com"
              />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('urlLauncher', 'url_launcher_address_get')} disabled={busy('urlLauncher')}>GET</ActionButton>
                <ActionButton
                  tone="primary"
                  onClick={() => runMdc('urlLauncher', 'url_launcher_address_set', { urlAddress: urlLauncherAddress })}
                  disabled={busy('urlLauncher')}
                >
                  SET
                </ActionButton>
              </div>
              <ResultPanel result={results['urlLauncher'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Weekly Reboot (0x1B.0xA2)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <input type="number" min={0} max={127} value={weekDay} onChange={(e) => setWeekDay(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Weekday bitmask" />
                <input type="number" min={0} max={23} value={timeHour} onChange={(e) => setTimeHour(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Hour" />
                <input type="number" min={0} max={59} value={timeMinute} onChange={(e) => setTimeMinute(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Minute" />
              </div>
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('weekly', 'weekly_restart_get')} disabled={busy('weekly')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('weekly', 'weekly_restart_set', { weekDay, timeHour, timeMinute })} disabled={busy('weekly')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['weekly'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Brightness (0x25)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <input type="number" min={0} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-40" />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('brightness', 'brightness_get')} disabled={busy('brightness')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('brightness', 'brightness_set', { value: brightness })} disabled={busy('brightness')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['brightness'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Sharpness (0x26)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <input type="number" min={0} max={100} value={sharpness} onChange={(e) => setSharpness(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-40" />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('sharpness', 'sharpness_get')} disabled={busy('sharpness')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('sharpness', 'sharpness_set', { value: sharpness })} disabled={busy('sharpness')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['sharpness'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Color (0x27)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <input type="number" min={0} max={100} value={color} onChange={(e) => setColor(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-40" />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('color', 'color_get')} disabled={busy('color')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('color', 'color_set', { value: color })} disabled={busy('color')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['color'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Brightness Sensor (0x86)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <select
                value={brightnessSensor}
                onChange={(e) => setBrightnessSensor(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full sm:w-80"
              >
                <option value={0}>Off (0x00)</option>
                <option value={1}>On (0x01)</option>
              </select>
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('brightnessSensor', 'brightness_sensor_get')} disabled={busy('brightnessSensor')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('brightnessSensor', 'brightness_sensor_set', { value: brightnessSensor })} disabled={busy('brightnessSensor')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['brightnessSensor'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">MDC ID Hide/Show (0xB9)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <select
                value={mdcIdDisplay}
                onChange={(e) => setMdcIdDisplay(Number(e.target.value))}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full sm:w-80"
              >
                <option value={0}>Hide ID Display (0x00)</option>
                <option value={1}>Show ID Display (0x01)</option>
              </select>
              <div className="flex gap-3 flex-wrap">
                <ActionButton tone="primary" onClick={() => runMdc('mdcIdDisplay', 'mdc_id_display_set', { value: mdcIdDisplay })} disabled={busy('mdcIdDisplay')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['mdcIdDisplay'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Safety Screen Run (0x59)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <select value={safetyScreenType} onChange={(e) => setSafetyScreenType(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full sm:w-80">
                {SAFETY_SCREEN_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('safetyRun', 'safety_screen_run_get')} disabled={busy('safetyRun')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('safetyRun', 'safety_screen_run_set', { value: safetyScreenType })} disabled={busy('safetyRun')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['safetyRun'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">Ticker (0x63)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <select value={tickerOnOff} onChange={(e) => setTickerOnOff(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <option value={0}>Off (0x00)</option>
                  <option value={1}>On (0x01)</option>
                </select>
                <input type="number" min={1} max={12} value={tickerStartHour} onChange={(e) => setTickerStartHour(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Start Hour (1-12)" />
                <input type="number" min={0} max={59} value={tickerStartMinute} onChange={(e) => setTickerStartMinute(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="Start Minute" />
                <input type="number" min={1} max={12} value={tickerEndHour} onChange={(e) => setTickerEndHour(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="End Hour (1-12)" />
                <input type="number" min={0} max={59} value={tickerEndMinute} onChange={(e) => setTickerEndMinute(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" placeholder="End Minute" />
              </div>
              <input value={tickerMessage} onChange={(e) => setTickerMessage(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full" placeholder="Ticker message (max 240 chars)" />
              <div className="flex gap-3 flex-wrap">
                <ActionButton onClick={() => runMdc('ticker', 'ticker_get')} disabled={busy('ticker')}>GET</ActionButton>
                <ActionButton tone="primary" onClick={() => runMdc('ticker', 'ticker_set', {
                  onOff: tickerOnOff,
                  message: tickerMessage,
                  startHour: tickerStartHour,
                  startMinute: tickerStartMinute,
                  endHour: tickerEndHour,
                  endMinute: tickerEndMinute,
                })} disabled={busy('ticker')}>SET</ActionButton>
              </div>
              <ResultPanel result={results['ticker'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>

          <SectionCard>
            <SectionCardHeader><h2 className="text-base font-semibold text-[var(--text)]">WiFi AP Config (0x1B.0x8A)</h2></SectionCardHeader>
            <SectionCardBody className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">SET only — adds SSID to device connection history. Device may change network; response may not return.</p>
              <input
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full"
                placeholder="SSID"
              />
              <input
                type="password"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm w-full"
                placeholder="Password"
              />
              <div className="flex gap-3 flex-wrap">
                <ActionButton
                  tone="primary"
                  onClick={() => runMdc('wifiAp', 'network_wifi_set', { ssid: wifiSsid, password: wifiPassword })}
                  disabled={busy('wifiAp') || !wifiSsid}
                >
                  SET
                </ActionButton>
              </div>
              <ResultPanel result={results['wifiAp'] as MdcResult} />
            </SectionCardBody>
          </SectionCard>
        </>
      )}
    </div>
  );
}
