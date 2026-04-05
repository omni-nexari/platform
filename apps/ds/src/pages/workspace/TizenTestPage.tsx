import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bug, FileText, Monitor, Radio, Shield, Terminal } from 'lucide-react';
import {
  ActionButton,
  Badge,
  Callout,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';
import { api } from '../../lib/api.js';

type Workspace = { id: string; name: string };
type Device = { id: string; name: string; status?: string | null };

type DeviceHeartbeat = {
  id: string;
  playerVersion: string | null;
  firmwareVersion: string | null;
  powerState: string | null;
  clockDriftMs: number | null;
  irLock: boolean | null;
  buttonLock: boolean | null;
  cpuLoad: number | null;
  storageFreeBytes: number | null;
  memoryFreeBytes: number | null;
  memoryTotalBytes: number | null;
  deviceUptimeSec: number | null;
  temperatureC: number | null;
  createdAt: string;
};

type ProbeEntry = { label: string; value?: unknown; error?: string };
type ProbeResult = {
  requestId: string;
  sections: {
    productInfo?: ProbeEntry[];
    samsungSystemInfo?: ProbeEntry[];
    tizenSystemInfo?: ProbeEntry[];
    systemControl?: ProbeEntry[];
  };
};

type CommandResult = { ok: boolean; value?: unknown; error?: string } | null;

const SECTION_META: Array<{ key: keyof ProbeResult['sections']; title: string; description: string }> = [
  { key: 'productInfo',       title: 'ProductInfo',         description: 'Model, firmware, DUID, branding, and system config from webapis.productinfo.' },
  { key: 'samsungSystemInfo', title: 'Samsung SystemInfo',  description: 'Codec support from webapis.systeminfo.' },
  { key: 'tizenSystemInfo',   title: 'Tizen SystemInfo',    description: 'Memory, capabilities, and system properties from tizen.systeminfo.' },
  { key: 'systemControl',     title: 'SystemControl',       description: 'B2B display state from webapis.systemcontrol (requires partner privilege).' },
];

function ValueBlock({ value }: { value: unknown }) {
  if (value == null) return <span className="font-mono text-sm text-[var(--text-muted)]">null</span>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-sm text-[var(--text)]">{String(value)}</span>;
  }
  return (
    <pre className="overflow-x-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-xs text-[var(--text)] whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LiveClock({ driftMs = 0 }: { driftMs?: number }) {
  const [, setTick] = useState(0);
  const driftRef = useRef(driftMs);
  driftRef.current = driftMs;
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-sm font-medium text-[var(--text)]">{new Date(Date.now() + driftRef.current).toLocaleString()}</span>;
}

function ProbeSection({ title, description, entries }: { title: string; description: string; entries: ProbeEntry[] }) {
  const okCount = entries.filter((e) => !e.error).length;
  const errCount = entries.filter((e) => !!e.error).length;
  const badgeTone = errCount > 0 && okCount === 0 ? 'danger' : errCount > 0 ? 'warning' : 'success';
  const badgeLabel = errCount > 0 && okCount === 0 ? 'All errors' : errCount > 0 ? 'Partial' : 'OK';

  return (
    <SectionCard>
      <SectionCardHeader>
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>
          <Badge tone={badgeTone}>{badgeLabel}</Badge>
          <span className="text-xs text-[var(--text-muted)]">({okCount} ok, {errCount} errors)</span>
        </div>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      </SectionCardHeader>
      <SectionCardBody>
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text)]">{entry.label}</span>
                <Badge tone={entry.error ? 'danger' : 'success'}>{entry.error ? 'Error' : 'Value'}</Badge>
              </div>
              {entry.error
                ? <div className="rounded-lg bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-red-400">{entry.error}</div>
                : <ValueBlock value={entry.value} />}
            </div>
          ))}
        </div>
      </SectionCardBody>
    </SectionCard>
  );
}

export default function TizenTestPage() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId]       = useState<string>('');
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [cmdBusy, setCmdBusy]     = useState<string | null>(null);
  const [cmdResults, setCmdResults] = useState<Record<string, CommandResult>>({});

  // Document API inputs
  const [docPath, setDocPath]         = useState('file:///opt/usr/home/owner/apps_rw/EBDSignage/data/content/49f97527-f2fa-48b8-9bc8-6ea631236f46.pdf');
  const [docRectX, setDocRectX]       = useState('0');
  const [docRectY, setDocRectY]       = useState('0');
  const [docRectW, setDocRectW]       = useState('1920');
  const [docRectH, setDocRectH]       = useState('1080');
  const [docSlideTime, setDocSlideTime] = useState('10');
  const [docGotoPage, setDocGotoPage] = useState('1');

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices', selectedWorkspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${selectedWorkspaceId}`),
    enabled: !!selectedWorkspaceId,
  });

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  const { data: deviceDetail, refetch: refetchHeartbeat, isFetching: hbFetching } = useQuery<{ latestHeartbeat: DeviceHeartbeat | null }>(
    {
      queryKey: ['device-detail', selectedDeviceId],
      queryFn: () => api.get(`/devices/${selectedDeviceId}`),
      enabled: !!selectedDeviceId,
      refetchInterval: 30_000,
    },
  );
  const hb = deviceDetail?.latestHeartbeat ?? null;

  async function runProbe() {
    if (!selectedDeviceId) return;
    setBusy(true);
    setResult(null);
    setProbeError(null);
    try {
      const res = await api.post<ProbeResult>(`/devices/${selectedDeviceId}/tizen-probe`);
      setResult(res);
    } catch (err: unknown) {
      setProbeError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(action: string, params?: unknown) {
    if (!selectedDeviceId) return;
    setCmdBusy(action);
    setCmdResults((prev) => ({ ...prev, [action]: null }));
    try {
      const res = await api.post<{ ok: boolean; value?: unknown; error?: string }>(
        `/devices/${selectedDeviceId}/tizen-command`,
        { action, ...(params !== undefined ? { params } : {}) },
      );
      setCmdResults((prev) => ({ ...prev, [action]: res }));
    } catch (err: unknown) {
      setCmdResults((prev) => ({ ...prev, [action]: { ok: false, error: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setCmdBusy(null);
    }
  }

  const deviceIsOnline = selectedDevice?.status === 'online';

  function CmdResult({ action }: { action: string }) {
    const r = cmdResults[action];
    if (r === undefined) return null;
    if (r === null) return <span className="text-xs text-[var(--text-muted)]">Running…</span>;
    if (!r.ok) return <div className="rounded-lg bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-red-400">{r.error ?? 'Unknown error'}</div>;
    return (
      <div className="rounded-lg bg-[rgba(16,185,129,0.08)] px-3 py-2 text-sm text-green-400">
        {r.value !== undefined ? <ValueBlock value={r.value} /> : 'OK'}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        icon={<Bug className="w-6 h-6" />}
        title="Tizen / Samsung API Test"
        subtitle="Runs probes and commands on the paired Tizen device via WebSocket."
      />

      <Callout tone="accent" icon={<Terminal className="w-4 h-4" />}>
        <p className="text-sm text-[var(--text)] font-medium">How this works</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          The probe runs <strong>on the TV</strong> via the WebSocket connection. Action commands are sent separately
          and may change device settings. Document API requires a Samsung partner certificate
          (<code>samsung.com/privilege/documentplay</code>) — LFD only.
        </p>
      </Callout>

      {/* ── Device Selection ───────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold text-[var(--text)]">Device Selection</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Pick a workspace and device, then run the probe.</p>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="ws-select" className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Workspace</label>
              <select
                id="ws-select"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                value={selectedWorkspaceId}
                onChange={(e) => { setSelectedWorkspaceId(e.target.value); setSelectedDeviceId(''); setResult(null); setProbeError(null); setCmdResults({}); }}
              >
                <option value="">Select workspace…</option>
                {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <label htmlFor="dev-select" className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Device</label>
              <select
                id="dev-select"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)] disabled:opacity-50"
                value={selectedDeviceId}
                disabled={!selectedWorkspaceId}
                onChange={(e) => { setSelectedDeviceId(e.target.value); setResult(null); setProbeError(null); setCmdResults({}); }}
              >
                <option value="">Select device…</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.status === 'online' ? ' ✓' : ' (offline)'}</option>
                ))}
              </select>
            </div>
            <ActionButton tone="primary" onClick={() => void runProbe()} disabled={!selectedDeviceId || busy}>
              {busy ? 'Probing TV…' : 'Run Probe'}
            </ActionButton>
          </div>

          {selectedDevice && (
            <div className="mt-4 flex items-center gap-2">
              <Radio className="w-4 h-4 text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text-muted)]">{selectedDevice.name}</span>
              <Badge tone={deviceIsOnline ? 'success' : 'danger'}>{deviceIsOnline ? 'Online' : 'Offline'}</Badge>
              {!deviceIsOnline && (
                <span className="text-xs text-[var(--text-muted)]">Device must be online for commands to work.</span>
              )}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {probeError && (
        <Callout tone="danger" icon={<Shield className="w-4 h-4" />}>
          <p className="text-sm font-medium text-[var(--text)]">Probe failed</p>
          <p className="mt-1 text-sm text-red-400">{probeError}</p>
        </Callout>
      )}

      {/* ── Probe results ──────────────────────────────────────────────────── */}
      {result && SECTION_META.map(({ key, title, description }) => {
        const entries = result.sections[key];
        if (!entries?.length) return null;
        return <ProbeSection key={key} title={title} description={description} entries={entries} />;
      })}

      {/* ── Heartbeat Inspector ────────────────────────────────────────────── */}
      {selectedDeviceId && (
        <SectionCard>
          <SectionCardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text)]">Latest Heartbeat (DB)</h2>
              <ActionButton tone="default" onClick={() => void refetchHeartbeat()} disabled={hbFetching}>
                {hbFetching ? 'Refreshing…' : 'Refresh'}
              </ActionButton>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Live view of what's actually stored in <code>device_heartbeats</code>. Memory/CPU only appear here if the TV is sending them.
              {hb?.createdAt && <span className="ml-2 text-[var(--text-muted)]">Last: {new Date(hb.createdAt).toLocaleTimeString()}</span>}
            </p>
          </SectionCardHeader>
          <SectionCardBody>
            {hb ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Device Time — isolated ticking component so it re-renders independently */}
                <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                  <div className="text-xs text-[var(--text-muted)] mb-0.5">Device Time</div>
                  <LiveClock driftMs={hb.clockDriftMs ?? 0} />
                </div>
                {([
                  ['CPU Load', hb.cpuLoad != null ? `${hb.cpuLoad.toFixed(1)}%` : null],
                  ['Memory Free', hb.memoryFreeBytes != null ? `${(hb.memoryFreeBytes / 1_048_576).toFixed(0)} MB` : null],
                  ['Memory Total', hb.memoryTotalBytes != null ? `${(hb.memoryTotalBytes / 1_048_576).toFixed(0)} MB` : null],
                  ['Storage Free', hb.storageFreeBytes != null ? `${(hb.storageFreeBytes / 1_048_576).toFixed(0)} MB` : null],
                  ['Uptime', hb.deviceUptimeSec != null ? `${Math.floor(hb.deviceUptimeSec / 3600)}h ${Math.floor((hb.deviceUptimeSec % 3600) / 60)}m` : null],
                  ['Clock Drift', hb.clockDriftMs != null ? `${hb.clockDriftMs} ms` : null],
                  ['Power State', hb.powerState],
                  ['IR Lock', hb.irLock != null ? String(hb.irLock) : null],
                  ['Button Lock', hb.buttonLock != null ? String(hb.buttonLock) : null],
                  ['Temperature', hb.temperatureC != null ? `${hb.temperatureC.toFixed(1)} °C` : null],
                  ['Player Ver', hb.playerVersion],
                  ['Firmware', hb.firmwareVersion],
                ] as [string, string | null][]).map(([label, val]) => (
                  <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div className="text-xs text-[var(--text-muted)] mb-0.5">{label}</div>
                    <div className={`text-sm font-mono font-medium ${val == null ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                      {val ?? 'null'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No heartbeat stored yet for this device.</p>
            )}
          </SectionCardBody>
        </SectionCard>
      )}


      {selectedDeviceId && (
        <SectionCard>
          <SectionCardHeader>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--text-muted)]" />
              <h2 className="text-base font-semibold text-[var(--text)]">Document API</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              <code>webapis.document</code> — LFD only, requires partner certificate
              (<code>samsung.com/privilege/documentplay</code>, since Tizen 6.5).
              The API renders PDF/Office files natively in its own overlay on the display.
            </p>
          </SectionCardHeader>
          <SectionCardBody>
            <div className="space-y-5">

              {/* getVersion probe */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                <span className="text-sm font-semibold text-[var(--text)]">getVersion</span>
                <p className="text-xs text-[var(--text-muted)]">Check if Document API is available on this device.</p>
                <ActionButton tone="default" onClick={() => void runCommand('document.getVersion')} disabled={!deviceIsOnline || cmdBusy === 'document.getVersion'}>
                  {cmdBusy === 'document.getVersion' ? 'Sending…' : 'Get Version'}
                </ActionButton>
                <CmdResult action="document.getVersion" />
              </div>

              {/* open */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <span className="text-sm font-semibold text-[var(--text)]">open</span>
                <p className="text-xs text-[var(--text-muted)]">
                  Load a PDF or Office file. Use an HTTP URL or local Tizen path. Rect defaults to full screen (1920×1080).
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    placeholder="http://server/file.pdf  or  wgt-private/content/uuid.pdf"
                    value={docPath}
                    onChange={(e) => setDocPath(e.target.value)}
                  />
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'rectX', val: docRectX, set: setDocRectX },
                      { label: 'rectY', val: docRectY, set: setDocRectY },
                      { label: 'rectWidth', val: docRectW, set: setDocRectW },
                      { label: 'rectHeight', val: docRectH, set: setDocRectH },
                    ].map(({ label, val, set }) => (
                      <div key={label} className="space-y-1">
                        <label className="text-xs text-[var(--text-muted)]">{label}</label>
                        <input
                          type="number"
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                          value={val}
                          onChange={(e) => set(e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <ActionButton
                  tone="primary"
                  onClick={() => void runCommand('document.open', {
                    docpath: docPath,
                    rectX: Number(docRectX), rectY: Number(docRectY),
                    rectWidth: Number(docRectW), rectHeight: Number(docRectH),
                  })}
                  disabled={!deviceIsOnline || !docPath.trim() || cmdBusy === 'document.open'}
                >
                  {cmdBusy === 'document.open' ? 'Opening…' : 'Open Document'}
                </ActionButton>
                <CmdResult action="document.open" />
              </div>

              {/* play / stop / pause / resume */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <span className="text-sm font-semibold text-[var(--text)]">play / stop / pause / resume</span>
                <p className="text-xs text-[var(--text-muted)]">
                  <code>play(slideTime)</code> auto-advances pages every N seconds.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--text-muted)]">slideTime (s)</label>
                    <input
                      type="number"
                      className="w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                      value={docSlideTime}
                      min={1}
                      onChange={(e) => setDocSlideTime(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 flex-wrap pt-5">
                    {(['play', 'stop', 'pause', 'resume'] as const).map((cmd) => (
                      <div key={cmd} className="flex flex-col gap-1">
                        <ActionButton
                          tone={cmd === 'stop' ? 'danger' : 'default'}
                          onClick={() => void runCommand(`document.${cmd}`, cmd === 'play' ? Number(docSlideTime) : undefined)}
                          disabled={!deviceIsOnline || cmdBusy === `document.${cmd}`}
                        >
                          {cmdBusy === `document.${cmd}` ? '…' : cmd.charAt(0).toUpperCase() + cmd.slice(1)}
                        </ActionButton>
                        <CmdResult action={`document.${cmd}`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* page navigation */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <span className="text-sm font-semibold text-[var(--text)]">Page Navigation</span>
                <p className="text-xs text-[var(--text-muted)]">
                  Left/right remote key equivalents: <code>prevPage</code> / <code>nextPage</code>. Jump to any page with <code>gotoPage</code>.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="flex gap-2">
                    {(['prevPage', 'nextPage'] as const).map((cmd) => (
                      <div key={cmd} className="flex flex-col gap-1">
                        <ActionButton
                          tone="default"
                          onClick={() => void runCommand(`document.${cmd}`)}
                          disabled={!deviceIsOnline || cmdBusy === `document.${cmd}`}
                        >
                          {cmdBusy === `document.${cmd}` ? '…' : cmd === 'prevPage' ? '← Prev' : 'Next →'}
                        </ActionButton>
                        <CmdResult action={`document.${cmd}`} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--text-muted)]">Page number</label>
                      <input
                        type="number"
                        className="w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                        value={docGotoPage}
                        min={1}
                        onChange={(e) => setDocGotoPage(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <ActionButton
                        tone="default"
                        onClick={() => void runCommand('document.gotoPage', Number(docGotoPage))}
                        disabled={!deviceIsOnline || cmdBusy === 'document.gotoPage'}
                      >
                        {cmdBusy === 'document.gotoPage' ? '…' : 'Go to Page'}
                      </ActionButton>
                      <CmdResult action="document.gotoPage" />
                    </div>
                  </div>
                </div>
              </div>

              {/* orientation + close */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                <span className="text-sm font-semibold text-[var(--text)]">Orientation &amp; Close</span>
                <p className="text-xs text-[var(--text-muted)]">
                  <code>setDocumentOrientation</code> toggles vertical rendering. <code>close</code> stops and removes the document overlay.
                </p>
                <div className="flex gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <ActionButton
                      tone="default"
                      onClick={() => void runCommand('document.setDocumentOrientation')}
                      disabled={!deviceIsOnline || cmdBusy === 'document.setDocumentOrientation'}
                    >
                      {cmdBusy === 'document.setDocumentOrientation' ? '…' : 'Set Orientation (Vertical)'}
                    </ActionButton>
                    <CmdResult action="document.setDocumentOrientation" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <ActionButton
                      tone="danger"
                      onClick={() => void runCommand('document.close')}
                      disabled={!deviceIsOnline || cmdBusy === 'document.close'}
                    >
                      {cmdBusy === 'document.close' ? 'Closing…' : 'Close Document'}
                    </ActionButton>
                    <CmdResult action="document.close" />
                  </div>
                </div>
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* ── Screen Orientation ─────────────────────────────────────────────── */}
      {selectedDeviceId && (
        <SectionCard>
          <SectionCardHeader>
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[var(--text-muted)]" />
              <h2 className="text-base font-semibold text-[var(--text)]">Screen Orientation (MDC)</h2>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Set display orientation via MDC <code>src_orientation_set</code> and <code>menu_orientation_set</code>.
              These persist across reboots and are read back on the next MDC poll.
            </p>
          </SectionCardHeader>
          <SectionCardBody>
            <div className="space-y-4">
              {[
                { label: 'Source Orientation', action: 'src_orientation_set', note: 'Rotates the source/content display.' },
                { label: 'Menu Orientation',   action: 'menu_orientation_set', note: 'Rotates the OSD menu.' },
              ].map(({ label, action, note }) => (
                <div key={action} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
                  <p className="text-xs text-[var(--text-muted)]">{note}</p>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: 'Portrait (0°)',    value: 0 },
                      { label: 'Landscape (90°)',  value: 1 },
                      { label: 'Portrait (180°)',  value: 2 },
                      { label: 'Landscape (270°)', value: 3 },
                    ].map(({ label: btnLabel, value }) => {
                      const key = `${action}_${value}`;
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <ActionButton
                            tone="default"
                            onClick={() => void runCommand('mdc', { command: action, params: { value } })}
                            disabled={!deviceIsOnline || cmdBusy === key}
                          >
                            {cmdBusy === key ? '…' : btnLabel}
                          </ActionButton>
                          <CmdResult action={key} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SectionCardBody>
        </SectionCard>
      )}
    </div>
  );
}

