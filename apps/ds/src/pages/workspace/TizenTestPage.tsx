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
  if (!result.ok) return resultWithId;

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
              <dd className="font-mono text-[var(--text)]">{String(v)}</dd>
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
  const [nsValue, setNsValue] = useState(0);             // network standby: 0=off 1=on
  const [menuOrientValue, setMenuOrientValue] = useState(0);
  const [srcOrientValue, setSrcOrientValue] = useState(0);
  const [pwrBtnValue, setPwrBtnValue] = useState(0);     // 0=power-on-only 1=toggle
  const [mdcConnValue, setMdcConnValue] = useState(1);   // 0=RS232C 1=RJ45

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

        </>
      )}
    </div>
  );
}
