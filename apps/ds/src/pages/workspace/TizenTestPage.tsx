import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bug,
  Monitor,
  TerminalSquare,
} from 'lucide-react';
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
  requestedValueHex: 'Requested Value (Hex)',
  subCommand: 'Sub-command',
  powerState: 'Power',
  volumePercent: 'Volume',
  muteState: 'Mute',
  inputSource: 'Input Source',
  aspectMode: 'Aspect',
  nTimeText: 'N Time',
  fTimeText: 'F Time',
  lampStatus: 'Lamp Status',
  temperatureStatus: 'Temperature Status',
  brightnessSensorStatus: 'Brightness Sensor',
  syncStatus: 'Sync Status',
  currentTemperatureC: 'Current Temperature',
  fanStatus: 'Fan Status',
  version: 'Software Version',
  slot: 'Slot',
  timerCmd: 'MDC Command',
  onTime: 'On Time',
  offTime: 'Off Time',
  onEnabled: 'On Timer',
  offEnabled: 'Off Timer',
  timerVolume: 'Volume',
  source: 'Source',
  repeat: 'Repeat',
  manualDays: 'Manual Days',
};
const ORIENTATION_LABELS: Record<number, string> = {
  0: 'Landscape (0°)', 1: 'Portrait (270°)', 2: 'Portrait (180°)', 3: 'Portrait (90°)',
};
const POWER_STATE_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'On',
};
const MUTE_LABELS: Record<number, string> = {
  0: 'Unmuted',
  1: 'Muted',
  255: 'Not supported on this model',
};
const INPUT_LABELS: Record<number, string> = {
  0x08: 'AV',
  0x0C: 'Component',
  0x14: 'PC',
  0x18: 'DVI',
  0x21: 'HDMI1',
  0x23: 'HDMI2',
  0x25: 'DisplayPort',
  0x31: 'HDMI3',
  0x33: 'HDMI4',
};
const ASPECT_LABELS: Record<number, string> = {
  0x00: 'PC 16:9',
  0x01: 'PC 4:3',
  0x0B: 'Video 16:9',
  0x0C: 'Video Zoom',
  0x0D: 'Video Wide Zoom',
  0x0E: 'Video 4:3',
  0x1F: 'Screen Fit',
  0x20: 'Smart View 1',
  0x21: 'Smart View 2',
};
const STANDBY_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'On',
  2: 'Auto',
};
const OSD_TYPE_LABELS: Record<number, string> = {
  0: 'Source OSD',
  1: 'Not Optimum Mode OSD',
  2: 'No Signal OSD',
  3: 'MDC OSD',
  4: 'Schedule Channel Info',
};
const OSD_STATUS_BITS = ['Source', 'Not Optimum Mode', 'No Signal', 'MDC', 'Schedule Channel Info'];
const NETWORK_STANDBY_LABELS: Record<number, string> = {
  0: 'Off',
  1: 'On',
};
const POWER_BUTTON_LABELS: Record<number, string> = {
  0: 'Power-On Only',
  1: 'Power-On/Off Toggle',
};
const MDC_CONNECTION_LABELS: Record<number, string> = {
  0: 'RS232C',
  1: 'RJ45',
};
const SOURCE_BYTE_TO_LABEL: Record<number, string> = {
  0x01: 'URL Launcher',
  0x08: 'AV',
  0x0C: 'Component',
  0x14: 'PC',
  0x18: 'DVI',
  0x21: 'HDMI1',
  0x23: 'HDMI2',
  0x25: 'DisplayPort',
  0x31: 'HDMI3',
  0x33: 'HDMI4',
  0x62: 'Internal/USB',
};
const REPEAT_LABELS: Record<number, string> = {
  0: 'Once', 1: 'Every Day', 2: 'Mon–Fri', 3: 'Mon–Sat', 4: 'Sat–Sun', 5: 'Manual Weekday',
};
function decodeAscii(data: number[]) {
  return data
    .filter((value) => value >= 0x20 && value <= 0x7e)
    .map((value) => String.fromCharCode(value))
    .join('')
    .trim();
}

function statusFlagLabel(value: number | undefined, okText = 'Normal', badText = 'Error') {
  if (value == null) return 'Unknown';
  return value === 0 ? okText : badText;
}

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

function decodeMdcResult(action: string, result: MdcResult, payload: Record<string, unknown> = {}): MdcResult {
  const data = Array.isArray(result.data) ? result.data : [];
  const resultWithId = withDisplayId(result);
  if (!result.ok) {
    return resultWithId;
  }

  switch (action) {
    case 'status_get': {
      if (data.length < 7) return resultWithId;
      const power = data[0] ?? -1;
      const volume = data[1] ?? -1;
      const mute = data[2] ?? -1;
      const input = data[3] ?? -1;
      const aspect = data[4] ?? -1;
      const nTime = data[5] ?? -1;
      const fTime = data[6] ?? -1;
      return {
        ...resultWithId,
        label: 'Status Control',
        powerState: POWER_STATE_LABELS[power] ?? `Unknown (${byteHex(power)})`,
        volumePercent: volume >= 0 ? `${volume}%` : 'Unknown',
        muteState: MUTE_LABELS[mute] ?? `Unknown (${byteHex(mute)})`,
        inputSource: INPUT_LABELS[input] ?? `Unknown (${byteHex(input)})`,
        aspectMode: ASPECT_LABELS[aspect] ?? `Unknown (${byteHex(aspect)})`,
        nTimeText: nTime === 0 ? '0 (unused on newer timer models)' : `${nTime}`,
        fTimeText: fTime === 0 ? '0 (unused on newer timer models)' : `${fTime}`,
        meaning: `Power ${POWER_STATE_LABELS[power] ?? byteHex(power)}, volume ${volume}%, ${MUTE_LABELS[mute]?.toLowerCase() ?? 'unknown mute state'}, input ${INPUT_LABELS[input] ?? byteHex(input)}.`,
      };
    }
    case 'standby_set': {
      const value = Number(payload.value ?? -1);
      return {
        ...resultWithId,
        requestedValue: value,
        requestedValueHex: value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(2, '0')}` : 'Unknown',
        meaning: STANDBY_LABELS[value] ? `Set standby to ${STANDBY_LABELS[value]}.` : 'Standby updated.',
      };
    }
    case 'standby_get': {
      if (data.length === 0) return resultWithId;
      const value = data[0] ?? -1;
      return {
        ...resultWithId,
        value,
        valueHex: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
        label: 'Standby',
        meaning: STANDBY_LABELS[value] ?? 'Unknown standby value.',
      };
    }
    case 'osd_display_set': {
      const osdType  = Number(payload.osdType ?? -1);
      const osdOnOff = Number(payload.osdOnOff ?? -1);
      return {
        ...resultWithId,
        osdType: OSD_TYPE_LABELS[osdType] ?? `0x${osdType.toString(16).toUpperCase().padStart(2, '0')}`,
        osdOnOff: osdOnOff === 1 ? 'On' : osdOnOff === 0 ? 'Off' : 'Unknown',
        meaning: `Set ${OSD_TYPE_LABELS[osdType] ?? 'OSD type'} to ${osdOnOff === 1 ? 'On' : 'Off'}.`,
      };
    }
    case 'osd_display_get': {
      if (data.length === 0) return resultWithId;
      const bitmask = data[0] ?? 0;
      const active = OSD_STATUS_BITS.filter((_, i) => (bitmask >> i) & 1);
      return {
        ...resultWithId,
        value: bitmask,
        valueHex: `0x${bitmask.toString(16).toUpperCase().padStart(2, '0')}`,
        activeOSDs: active.length > 0 ? active.join(', ') : 'None',
        meaning: active.length > 0 ? `Currently showing: ${active.join(', ')}.` : 'All OSD types are off.',
      };
    }
    case 'network_standby_set': {
      const value = Number(payload.value ?? -1);
      return {
        ...resultWithId,
        requestedValue: value,
        requestedValueHex: value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(2, '0')}` : 'Unknown',
        meaning: NETWORK_STANDBY_LABELS[value] ? `Set network standby to ${NETWORK_STANDBY_LABELS[value]}.` : 'Network standby updated.',
      };
    }
    case 'network_standby_get': {
      if (data.length === 0) return resultWithId;
      const value = data[0] ?? -1;
      return {
        ...resultWithId,
        value,
        valueHex: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
        label: 'Network Standby',
        meaning: value === 1
          ? 'On - network standby is enabled.'
          : value === 0
            ? 'Off - network standby is disabled.'
            : 'Unknown network standby value.',
      };
    }
    case 'menu_orientation_set':
    case 'src_orientation_set': {
      const value = Number(payload.value ?? -1);
      return {
        ...resultWithId,
        requestedValue: value,
        requestedValueHex: value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(2, '0')}` : 'Unknown',
        meaning: `Set ${action === 'menu_orientation_set' ? 'menu' : 'source content'} orientation to ${ORIENTATION_LABELS[value] ?? 'Unknown'}.`,
      };
    }
    case 'menu_orientation_get':
    case 'src_orientation_get': {
      if (data.length < 2) return resultWithId;
      const value = data[1] ?? -1;
      return {
        ...resultWithId,
        subCommand: data[0] != null ? `0x${data[0].toString(16).toUpperCase().padStart(2, '0')}` : undefined,
        value,
        valueHex: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
        label: action === 'menu_orientation_get' ? 'Menu Orientation' : 'Source Content Orientation',
        meaning: ORIENTATION_LABELS[value] ?? 'Unknown orientation',
      };
    }
    case 'power_button_set': {
      const value = Number(payload.value ?? -1);
      return {
        ...resultWithId,
        requestedValue: value,
        requestedValueHex: value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(2, '0')}` : 'Unknown',
        meaning: `Set power button mode to ${POWER_BUTTON_LABELS[value] ?? 'Unknown'}.`,
      };
    }
    case 'power_button_get': {
      if (data.length < 2) return resultWithId;
      const value = data[1] ?? -1;
      return {
        ...resultWithId,
        subCommand: data[0] != null ? `0x${data[0].toString(16).toUpperCase().padStart(2, '0')}` : undefined,
        value,
        valueHex: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
        label: 'Power Button Mode',
        meaning: POWER_BUTTON_LABELS[value] ?? 'Unknown power button mode',
      };
    }
    case 'display_status_get': {
      if (data.length < 6) return resultWithId;
      return {
        ...resultWithId,
        lampStatus: statusFlagLabel(data[0]),
        temperatureStatus: statusFlagLabel(data[1]),
        brightnessSensorStatus: statusFlagLabel(data[2]),
        syncStatus: statusFlagLabel(data[3]),
        currentTemperatureC: data[4],
        fanStatus: statusFlagLabel(data[5]),
        meaning: data.slice(0, 4).every((value) => value === 0) && data[5] === 0
          ? `Display status normal. Current temperature is ${data[4]}°C.`
          : 'One or more display status flags report an error.',
      };
    }
    case 'mdc_conn_type_get': {
      if (data.length === 0) return resultWithId;
      const value = data[0] ?? -1;
      return {
        ...resultWithId,
        value,
        valueHex: `0x${value.toString(16).toUpperCase().padStart(2, '0')}`,
        label: 'MDC Connection Type',
        meaning: MDC_CONNECTION_LABELS[value] ?? 'Unknown connection type',
      };
    }
    case 'mdc_conn_type_set': {
      const value = Number(payload.value ?? -1);
      return {
        ...resultWithId,
        requestedValue: value,
        requestedValueHex: value >= 0 ? `0x${value.toString(16).toUpperCase().padStart(2, '0')}` : 'Unknown',
        meaning: `Set MDC connection type to ${MDC_CONNECTION_LABELS[value] ?? 'Unknown'}.`,
      };
    }
    case 'sw_version_get':
      return {
        ...resultWithId,
        version: decodeAscii(data),
        meaning: decodeAscii(data) ? `Software version is ${decodeAscii(data)}.` : 'Software version returned non-ASCII bytes only.',
      };
    case 'on_timer_get':
    case 'on_timer_set': {
      // 15-byte payload layout (confirmed from MDC packet capture):
      // [0]=onHour, [1]=onMin, [2]=source, [3]=onEnable,
      // [4]=offHour, [5]=offMin, [6]=repeat, [7]=offEnable,
      // [8-11]=manualDayBits, [12]=volume, [13-14]=model constants
      if (data.length < 13) return { ...resultWithId, meaning: `Only ${data.length} bytes returned — expected 15.` };
      const onHour   = data[0] ?? 0;
      const onMin    = data[1] ?? 0;
      const src      = data[2] ?? 0;
      const onEnable = data[3] ?? 0;
      const offHour  = data[4] ?? 0;
      const offMin   = data[5] ?? 0;
      const repeat   = data[6] ?? 0;
      const offEnable = data[7] ?? 0;
      const vol      = data[12] ?? 0;
      const REPEAT_DECODE: Record<number, string> = {
        0: 'Once', 1: 'Every Day', 2: 'Mon–Fri', 3: 'Mon–Sat', 4: 'Sat–Sun', 5: 'Manual',
      };
      const DAY_FLAGS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const manualDayBits = (data[8] ?? 0) | ((data[9] ?? 0) << 8) | ((data[10] ?? 0) << 16) | ((data[11] ?? 0) << 24);
      const manualDays = DAY_FLAGS.filter((_, i) => (manualDayBits >> i) & 1).join(' ') || '—';
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const slotLabel = result.slot ?? payload.slot ?? '?';
      return {
        ...resultWithId,
        slot: String(slotLabel),
        timerCmd: result.cmd != null ? `0x${Number(result.cmd).toString(16).toUpperCase().padStart(2, '0')}` : '?',
        onTime:  `${pad2(onHour)}:${pad2(onMin)}`,
        offTime: `${pad2(offHour)}:${pad2(offMin)}`,
        timerVolume: `${vol}%`,
        source: SOURCE_BYTE_TO_LABEL[src] ?? `0x${src.toString(16).toUpperCase().padStart(2, '0')}`,
        repeat: REPEAT_DECODE[repeat] ?? `0x${repeat.toString(16).toUpperCase().padStart(2, '0')}`,
        onEnabled:  onEnable  === 0x01 ? 'Enabled' : 'Disabled',
        offEnabled: offEnable === 0x01 ? 'Enabled' : 'Disabled',
        ...(repeat === 5 ? { manualDays } : {}),
        meaning: `Slot ${slotLabel}: On ${onEnable ? 'ENABLED' : 'disabled'} at ${pad2(onHour)}:${pad2(onMin)}, Off ${offEnable ? 'ENABLED' : 'disabled'} at ${pad2(offHour)}:${pad2(offMin)}, repeat: ${REPEAT_DECODE[repeat] ?? repeat}, vol: ${vol}%.`,
      };
    }
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
        {result.ok ? '✓ OK' : '✗ Error'}
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

  // Per-section set values
  const [standbyValue, setStandbyValue] = useState(0);   // standby: 0=off 1=on 2=auto
  const [osdType, setOsdType] = useState(0);              // OSD type: 0=Source 1=Not Optimum 2=No Signal 3=MDC 4=Schedule
  const [osdOnOff, setOsdOnOff] = useState(0);            // OSD on/off: 0=off 1=on
  const [nsValue, setNsValue] = useState(0);             // network standby: 0=off 1=on
  const [menuOrientValue, setMenuOrientValue] = useState(0);
  const [srcOrientValue, setSrcOrientValue] = useState(0);
  const [pwrBtnValue, setPwrBtnValue] = useState(0);     // 0=power-on-only 1=toggle
  const [mdcConnValue, setMdcConnValue] = useState(1);   // 0=RS232C 1=RJ45
  const [timerSlot, setTimerSlot] = useState(1);
  const [timerOnHour, setTimerOnHour] = useState(7);
  const [timerOnMin, setTimerOnMin] = useState(0);
  const [timerOnEnable, setTimerOnEnable] = useState(true);
  const [timerOffHour, setTimerOffHour] = useState(10);
  const [timerOffMin, setTimerOffMin] = useState(0);
  const [timerOffEnable, setTimerOffEnable] = useState(true);
  const [timerRepeat, setTimerRepeat] = useState(1);
  const [timerVolume, setTimerVolume] = useState(20);
  const [timerSource, setTimerSource] = useState(0x01);
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
        title="MDC Test"
        subtitle="Send MDC commands to paired Samsung displays for testing and verification."
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
                <option key={d.id} value={d.id}>{d.name}{d.modelName ? ` · ${d.modelName}` : ''}</option>
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
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Status Control</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0x00 — power, volume, mute, input source, aspect, and legacy timer bytes from the panel.</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <ActionButton onClick={() => runMdc('status', 'status_get')} disabled={busy('status')}>
                GET
              </ActionButton>
              {results['status'] ? (
                <>
                  <ResultPanel result={results['status'] as MdcResult} />
                  {results['status'].ok ? (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      {(
                        [
                          ['Power', String(results['status']['powerState'] ?? '-')],
                          ['Volume', String(results['status']['volumePercent'] ?? '-')],
                          ['Mute', String(results['status']['muteState'] ?? '-')],
                          ['Input', String(results['status']['inputSource'] ?? '-')],
                          ['Aspect', String(results['status']['aspectMode'] ?? '-')],
                          ['Display ID', String(results['status']['displayId'] ?? '-')],
                        ] as [string, string][]
                      ).map(([label, val]) => (
                        <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
                          <div className="mt-1 font-semibold text-[var(--text)]">{val}</div>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── On Timer GET ───────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">On/Off Timer (MDC)</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xA4–0xAE — read and write on/off timer slots 1–7. Each slot stores both an on-time and off-time with a shared repeat schedule. Hours use <strong>12-hour format (0–12)</strong>; PM support is TBD.</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              {/* Slot + GET controls */}
              <div className="flex flex-wrap gap-3 items-center">
                <select value={timerSlot} onChange={(e) => setTimerSlot(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                  {[1,2,3,4,5,6,7].map((s) => (
                    <option key={s} value={s}>Slot {s}</option>
                  ))}
                </select>
                <ActionButton onClick={() => runMdc('onTimer', 'on_timer_get', { slot: timerSlot })} disabled={busy('onTimer') || busy('onTimerSet')}>
                  GET
                </ActionButton>
                <ActionButton onClick={() => { for (let s = 1; s <= 7; s++) runMdc(`onTimer${s}`, 'on_timer_get', { slot: s }); }} disabled={!!(pending)}>
                  GET ALL (1–7)
                </ActionButton>
              </div>
              {results['onTimer'] ? <ResultPanel result={results['onTimer'] as MdcResult} /> : null}
              {[1,2,3,4,5,6,7].some((s) => results[`onTimer${s}`]) ? (
                <div className="space-y-2">
                  {[1,2,3,4,5,6,7].map((s) => results[`onTimer${s}`] ? (
                    <div key={s}>
                      <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">Slot {s}</div>
                      <ResultPanel result={results[`onTimer${s}`] as MdcResult} />
                    </div>
                  ) : null)}
                </div>
              ) : null}

              {/* SET controls */}
              <div className="border-t border-[var(--border)] pt-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Set Timer</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="space-y-1 text-sm text-[var(--text-muted)]">
                    <span>Repeat</span>
                    <select value={timerRepeat} onChange={(e) => setTimerRepeat(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                      <option value={0}>Once</option>
                      <option value={1}>Every Day</option>
                      <option value={2}>Mon–Fri</option>
                      <option value={3}>Mon–Sat</option>
                      <option value={4}>Sat–Sun</option>
                      <option value={5}>Manual</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm text-[var(--text-muted)]">
                    <span>Source</span>
                    <select value={timerSource} onChange={(e) => setTimerSource(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                      <option value={0x01}>URL Launcher (0x01)</option>
                      <option value={0x21}>HDMI1 (0x21)</option>
                      <option value={0x23}>HDMI2 (0x23)</option>
                      <option value={0x62}>Internal/USB (0x62)</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm text-[var(--text-muted)]">
                    <span>Volume</span>
                    <input type="number" min={0} max={100} value={timerVolume} onChange={(e) => setTimerVolume(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* On Timer */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text)]">On Timer</span>
                      <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                        <input type="checkbox" checked={timerOnEnable} onChange={(e) => setTimerOnEnable(e.target.checked)} />
                        Enable
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <label className="flex-1 space-y-1 text-xs text-[var(--text-muted)]">
                        <span>Hour (0–12)</span>
                        <input type="number" min={0} max={12} value={timerOnHour} onChange={(e) => setTimerOnHour(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--text)]" />
                      </label>
                      <label className="flex-1 space-y-1 text-xs text-[var(--text-muted)]">
                        <span>Minute</span>
                        <input type="number" min={0} max={59} step={5} value={timerOnMin} onChange={(e) => setTimerOnMin(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--text)]" />
                      </label>
                    </div>
                  </div>
                  {/* Off Timer */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--text)]">Off Timer</span>
                      <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer">
                        <input type="checkbox" checked={timerOffEnable} onChange={(e) => setTimerOffEnable(e.target.checked)} />
                        Enable
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <label className="flex-1 space-y-1 text-xs text-[var(--text-muted)]">
                        <span>Hour (0–12)</span>
                        <input type="number" min={0} max={12} value={timerOffHour} onChange={(e) => setTimerOffHour(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--text)]" />
                      </label>
                      <label className="flex-1 space-y-1 text-xs text-[var(--text-muted)]">
                        <span>Minute</span>
                        <input type="number" min={0} max={59} step={5} value={timerOffMin} onChange={(e) => setTimerOffMin(Number(e.target.value))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--text)]" />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <ActionButton
                    tone="primary"
                    onClick={() => runMdc('onTimerSet', 'on_timer_set', {
                      slot: timerSlot,
                      onHour: timerOnHour, onMin: timerOnMin, onEnable: timerOnEnable,
                      offHour: timerOffHour, offMin: timerOffMin, offEnable: timerOffEnable,
                      repeat: timerRepeat, volume: timerVolume, source: timerSource,
                    })}
                    disabled={busy('onTimerSet') || busy('onTimer')}
                  >
                    SET Slot {timerSlot}
                  </ActionButton>
                  <ActionButton
                    tone="danger"
                    onClick={() => runMdc('onTimerSet', 'on_timer_set', {
                      slot: timerSlot,
                      onHour: timerOnHour, onMin: timerOnMin, onEnable: false,
                      offHour: timerOffHour, offMin: timerOffMin, offEnable: false,
                      repeat: timerRepeat, volume: timerVolume, source: timerSource,
                    })}
                    disabled={busy('onTimerSet') || busy('onTimer')}
                  >
                    DISABLE Slot {timerSlot}
                  </ActionButton>
                </div>
                {results['onTimerSet'] ? <ResultPanel result={results['onTimerSet'] as MdcResult} /> : null}
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── Standby Control ───────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Standby Control</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0x4A — DPMS sleep mode (Off / On / Auto). Note: works only under external input source.</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('standby', 'standby_get')} disabled={busy('standby')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={standbyValue} onChange={(e) => setStandbyValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>Off (0x00)</option>
                    <option value={1}>On (0x01)</option>
                    <option value={2}>Auto (0x02)</option>
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('standby', 'standby_set', { value: standbyValue })} disabled={busy('standby')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['standby'] ? <ResultPanel result={results['standby'] as MdcResult} /> : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── OSD Display Type On/Off ───────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">OSD Display Type On/Off</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xA3 — enable/disable individual OSD overlays (Source, No Signal, MDC, etc.).</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('osd', 'osd_display_get')} disabled={busy('osd')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={osdType} onChange={(e) => setOsdType(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>Source OSD (0x00)</option>
                    <option value={1}>Not Optimum Mode (0x01)</option>
                    <option value={2}>No Signal OSD (0x02)</option>
                    <option value={3}>MDC OSD (0x03)</option>
                    <option value={4}>Schedule Channel Info (0x04)</option>
                  </select>
                  <select value={osdOnOff} onChange={(e) => setOsdOnOff(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>Off (0x00)</option>
                    <option value={1}>On (0x01)</option>
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('osd', 'osd_display_set', { osdType, osdOnOff })} disabled={busy('osd')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['osd'] ? <ResultPanel result={results['osd'] as MdcResult} /> : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Network Standby ────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Network Standby</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xB5 — control standby over network (on = display keeps LAN alive in standby)</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('ns', 'network_standby_get')} disabled={busy('ns')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={nsValue} onChange={(e) => setNsValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>Off (0x00)</option>
                    <option value={1}>On (0x01)</option>
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('ns', 'network_standby_set', { value: nsValue })} disabled={busy('ns')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['ns'] ? (
                <ResultPanel result={results['ns'] as MdcResult & { value?: number }} />
              ) : null}
              {results['ns']?.ok && typeof results['ns']?.['value'] === 'number' ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Current: <span className="font-semibold text-[var(--text)]">{results['ns']['value'] === 1 ? 'On' : 'Off'}</span>
                </p>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Menu Orientation ───────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Menu Orientation</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xC8 sub 0x81 — OSD/menu rotation angle</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('menuOrient', 'menu_orientation_get')} disabled={busy('menuOrient')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={menuOrientValue} onChange={(e) => setMenuOrientValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    {Object.entries(ORIENTATION_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label} (0x0{v})</option>
                    ))}
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('menuOrient', 'menu_orientation_set', { value: menuOrientValue })} disabled={busy('menuOrient')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['menuOrient'] ? (
                <ResultPanel result={results['menuOrient'] as MdcResult} />
              ) : null}
              {results['menuOrient']?.ok && typeof results['menuOrient']?.['value'] === 'number' ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Current: <span className="font-semibold text-[var(--text)]">{ORIENTATION_LABELS[results['menuOrient']['value'] as number] ?? `0x${(results['menuOrient']['value'] as number).toString(16)}`}</span>
                </p>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Source Content Orientation ──────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Source Content Orientation</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xC8 sub 0x82 — display content rotation angle</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('srcOrient', 'src_orientation_get')} disabled={busy('srcOrient')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={srcOrientValue} onChange={(e) => setSrcOrientValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    {Object.entries(ORIENTATION_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label} (0x0{v})</option>
                    ))}
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('srcOrient', 'src_orientation_set', { value: srcOrientValue })} disabled={busy('srcOrient')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['srcOrient'] ? (
                <ResultPanel result={results['srcOrient'] as MdcResult} />
              ) : null}
              {results['srcOrient']?.ok && typeof results['srcOrient']?.['value'] === 'number' ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Current: <span className="font-semibold text-[var(--text)]">{ORIENTATION_LABELS[results['srcOrient']['value'] as number] ?? `0x${(results['srcOrient']['value'] as number).toString(16)}`}</span>
                </p>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Power Button ───────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Power Button Mode</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0xCA sub 0x91 — 0x00 = power-on only; 0x01 = power-on/off toggle</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('pwrBtn', 'power_button_get')} disabled={busy('pwrBtn')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={pwrBtnValue} onChange={(e) => setPwrBtnValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>Power-On Only (0x00)</option>
                    <option value={1}>Power-On/Off Toggle (0x01)</option>
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('pwrBtn', 'power_button_set', { value: pwrBtnValue })} disabled={busy('pwrBtn')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['pwrBtn'] ? (
                <ResultPanel result={results['pwrBtn'] as MdcResult} />
              ) : null}
              {results['pwrBtn']?.ok && typeof results['pwrBtn']?.['value'] === 'number' ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Current: <span className="font-semibold text-[var(--text)]">{results['pwrBtn']['value'] === 1 ? 'Power-On/Off Toggle' : 'Power-On Only'}</span>
                </p>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Display Status ─────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Display Status</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0x0D — lamp error, temp error, brightness sensor, sync error, current temp (°C), fan error</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <ActionButton onClick={() => runMdc('dispStatus', 'display_status_get')} disabled={busy('dispStatus')}>
                GET
              </ActionButton>
              {results['dispStatus'] ? (
                <>
                  <ResultPanel result={results['dispStatus'] as MdcResult} />
                  {results['dispStatus'].ok && Array.isArray(results['dispStatus'].data) && results['dispStatus'].data.length >= 6 ? (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      {(
                        [
                          ['Lamp', String(results['dispStatus']['lampStatus'] ?? '-')],
                          ['Temperature', String(results['dispStatus']['temperatureStatus'] ?? '-')],
                          ['Brightness Sensor', String(results['dispStatus']['brightnessSensorStatus'] ?? '-')],
                          ['Sync', String(results['dispStatus']['syncStatus'] ?? '-')],
                          ['Current Temp', `${String(results['dispStatus']['currentTemperatureC'] ?? '-')}°C`],
                          ['Fan', String(results['dispStatus']['fanStatus'] ?? '-')],
                        ] as [string, string][]
                      ).map(([label, val]) => (
                        <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
                          <div className={`mt-1 font-semibold ${val === 'Error' ? 'text-red-400' : 'text-[var(--text)]'}`}>{val}</div>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── SW Version ─────────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Software Version</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0x0E — read firmware/software version string from display</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <ActionButton onClick={() => runMdc('swVersion', 'sw_version_get')} disabled={busy('swVersion')}>
                GET
              </ActionButton>
              {results['swVersion'] ? (
                <>
                  <ResultPanel result={results['swVersion'] as MdcResult} />
                  {results['swVersion'].ok && results['swVersion']['version'] ? (
                    <p className="text-sm text-[var(--text-muted)]">
                      Version: <span className="font-mono font-semibold text-[var(--text)]">{String(results['swVersion']['version'])}</span>
                    </p>
                  ) : null}
                </>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── Auto ID ───────────────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">Auto ID (MDC 0xB8)</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Assigns sequential MDC IDs starting at 1. A single device on the chain will receive ID=1.
                  Click <strong>START</strong>, wait a moment, then click <strong>STOP</strong>.
                  STOP will automatically scan to confirm the assigned ID.
                </p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton
                  tone="primary"
                  onClick={() => runMdc('autoIdStart', 'auto_id_start')}
                  disabled={busy('autoIdStart') || busy('autoIdStop')}
                >
                  START Auto ID
                </ActionButton>
                <ActionButton
                  onClick={() => runMdc('autoIdStop', 'auto_id_stop')}
                  disabled={busy('autoIdStop') || busy('autoIdStart')}
                >
                  STOP Auto ID + Scan
                </ActionButton>
              </div>

              {/* START result */}
              {results['autoIdStart'] ? (
                <div className="space-y-1">
                  <ResultPanel result={results['autoIdStart'] as MdcResult} />
                  {results['autoIdStart']?.ok ? (
                    <p className="text-sm text-green-500 font-semibold">
                      ✓ Auto ID START sent — now click STOP Auto ID + Scan
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* STOP + scan result */}
              {results['autoIdStop'] ? (
                <div className="space-y-1">
                  <ResultPanel result={results['autoIdStop'] as MdcResult} />
                  {results['autoIdStop']?.ok ? (
                    <p className="text-sm text-[var(--text-muted)]">
                      Device MDC ID after Auto ID:{' '}
                      <span className={`font-semibold ${results['autoIdStop']['idOk'] ? 'text-green-500' : 'text-yellow-500'}`}>
                        {String(results['autoIdStop']['displayId'])}
                        {results['autoIdStop']['idOk']
                          ? ' ✓ — ID is now 1, all MDC commands will work'
                          : ' ✗ — Auto ID did not assign ID=1 (unexpected)'}
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-yellow-500 font-semibold">
                      {String(results['autoIdStop']['error'] ?? 'Auto ID STOP sent but no device responded to scan')}
                    </p>
                  )}
                </div>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── B2B PC Connection ──────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">B2B PC Connection</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  b2bapis.b2bcontrol.getPCConnection() — returns the MDC connection type and device ID
                  as seen by the Tizen firmware (not via MDC). Useful for diagnosing why MDC commands may not work.
                </p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('b2bPcConn', 'b2b_pc_connection_get')} disabled={busy('b2bPcConn')}>
                  GET PC Connection
                </ActionButton>
              </div>
              {results['b2bPcConn'] ? (
                <ResultPanel result={results['b2bPcConn'] as MdcResult} />
              ) : null}
              {results['b2bPcConn']?.ok ? (
                <pre className="rounded-lg bg-[var(--surface-raised)] p-3 text-xs font-mono text-[var(--text)] overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(results['b2bPcConn']['value'] ?? results['b2bPcConn']['raw'], null, 2)}
                </pre>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── MDC Connection Type ────────────────────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">MDC Connection Type</h2>
                <p className="text-sm text-[var(--text-muted)]">MDC 0x1D — 0x00 = RS232C serial; 0x01 = RJ45 Ethernet</p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton onClick={() => runMdc('mdcConn', 'mdc_conn_type_get')} disabled={busy('mdcConn')}>
                  GET
                </ActionButton>
                <div className="flex items-center gap-2">
                  <select value={mdcConnValue} onChange={(e) => setMdcConnValue(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]">
                    <option value={0}>RS232C (0x00)</option>
                    <option value={1}>RJ45 (0x01)</option>
                  </select>
                  <ActionButton tone="primary" onClick={() => runMdc('mdcConn', 'mdc_conn_type_set', { value: mdcConnValue })} disabled={busy('mdcConn')}>
                    SET
                  </ActionButton>
                </div>
              </div>
              {results['mdcConn'] ? (
                <ResultPanel result={results['mdcConn'] as MdcResult} />
              ) : null}
              {results['mdcConn']?.ok ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Current: <span className="font-semibold text-[var(--text)]">{results['mdcConn']['value'] === 1 ? 'RJ45' : 'RS232C'}</span>{' '}
                  {results['mdcConn']['displayId'] ? (
                    <span>· Panel ID <span className="font-semibold text-[var(--text)]">{String(results['mdcConn']['displayId'])}</span></span>
                  ) : null}
                </p>
              ) : null}
            </SectionCardBody>
          </SectionCard>

          {/* ── MDC Fix: Apply Required Settings ──────────────────────────── */}
          <SectionCard>
            <SectionCardHeader>
              <div>
                <h2 className="text-base font-semibold text-[var(--text)]">MDC Fix — Apply Required Settings</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  MDC commands require: connection type = RJ45 <em>and</em> device MDC ID = 1.
                  There is no MDC command to change the device ID — it must be changed via the display OSD.
                  Use <strong>Scan MDC ID</strong> to find the current ID. Once found, click{' '}
                  <strong>Save as Active MDC ID</strong> so all future commands use the correct ID automatically.
                </p>
              </div>
            </SectionCardHeader>
            <SectionCardBody className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <ActionButton
                  onClick={() => runMdc('mdcIdScan', 'mdc_id_scan')}
                  disabled={busy('mdcIdScan') || busy('mdcFix')}
                >
                  Scan MDC ID (1–9)
                </ActionButton>
                <ActionButton
                  tone="danger"
                  onClick={() => runMdc('mdcFix', 'mdc_conn_type_fix')}
                  disabled={busy('mdcFix') || busy('mdcIdScan')}
                >
                  Fix: Force RJ45 + Scan ID
                </ActionButton>
              </div>

              {/* Scan-only result */}
              {results['mdcIdScan'] ? (
                <div className="space-y-2">
                  <ResultPanel result={results['mdcIdScan'] as MdcResult} />
                  {results['mdcIdScan']?.ok ? (
                    <>
                      <p className="text-sm text-[var(--text-muted)]">
                        Device MDC ID:{' '}
                        <span className={`font-semibold ${results['mdcIdScan']['idOk'] ? 'text-green-500' : 'text-yellow-500'}`}>
                          {String(results['mdcIdScan']['displayId'])}
                          {results['mdcIdScan']['idOk']
                            ? ' ✓ — MDC ID is correct'
                            : ' ✗ — change via display OSD: Menu → System → MDC → Network ID → 1, then re-scan'}
                        </span>
                      </p>
                      <ActionButton
                        tone="primary"
                        onClick={() => runMdc('saveMdcId', 'save_mdc_id', { id: results['mdcIdScan']!['displayId'] as number })}
                        disabled={busy('saveMdcId')}
                      >
                        Save ID {String(results['mdcIdScan']['displayId'])} as Active MDC ID
                      </ActionButton>
                    </>
                  ) : (
                    <p className="text-sm text-yellow-500 font-semibold">
                      No device responded to IDs 1–9. Check MDC TCP connection.
                    </p>
                  )}
                </div>
              ) : null}

              {/* Save result */}
              {results['saveMdcId'] ? (
                <p className="text-sm">
                  {results['saveMdcId']?.ok
                    ? <span className="text-green-500 font-semibold">✓ MDC ID {String(results['saveMdcId']['mdcId'])} saved — all MDC commands will now use this ID.</span>
                    : <span className="text-red-500 font-semibold">✗ Save failed: {String(results['saveMdcId']['error'] ?? 'unknown error')}</span>
                  }
                </p>
              ) : null}

              {/* Fix result */}
              {results['mdcFix'] ? (
                <div className="space-y-2">
                  <ResultPanel result={results['mdcFix'] as MdcResult} />
                  <p className="text-sm text-[var(--text-muted)]">
                    RJ45 broadcast SET:{' '}
                    <span className="font-semibold text-green-500">✓ Sent</span>
                    <span className="text-[var(--text-muted)]"> (0xFE broadcast — no ACK expected)</span>
                  </p>
                  {results['mdcFix']?.ok ? (
                    <>
                      <p className="text-sm text-[var(--text-muted)]">
                        Device MDC ID:{' '}
                        <span className={`font-semibold ${results['mdcFix']['idOk'] ? 'text-green-500' : 'text-yellow-500'}`}>
                          {String(results['mdcFix']['displayId'])}
                          {results['mdcFix']['idOk']
                            ? ' ✓ — all MDC commands will work'
                            : ' ✗ — RJ45 was set but ID must be changed to 1 via display OSD: Menu → System → MDC → Network ID → 1'}
                        </span>
                      </p>
                      <ActionButton
                        tone="primary"
                        onClick={() => runMdc('saveMdcId', 'save_mdc_id', { id: results['mdcFix']!['displayId'] as number })}
                        disabled={busy('saveMdcId')}
                      >
                        Save ID {String(results['mdcFix']['displayId'])} as Active MDC ID
                      </ActionButton>
                    </>
                  ) : (
                    <p className="text-sm text-yellow-500 font-semibold">
                      RJ45 SET sent but no device responded to IDs 1–9.
                    </p>
                  )}
                </div>
              ) : null}
            </SectionCardBody>
          </SectionCard>

        </>
      )}
    </div>
  );
}
