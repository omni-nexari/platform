import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Power,
  Tv,
  Volume2,
  VolumeX,
  Sun,
  Info,
  RotateCcw,
  Play,
  Square,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronDown,
  FlaskConical,
} from 'lucide-react';
import {
  ActionButton,
  Badge,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';
import { api } from '../../lib/api.js';

type Device = { id: string; name: string; status?: string | null };
type CmdResult = { ok: boolean; value?: unknown; error?: string } | null;

const INPUT_SOURCES = ['HDMI1', 'HDMI2', 'HDMI3', 'DisplayPort', 'DVI', 'MagicInfo', 'PC', 'AV'] as const;

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

function ResultBlock({ result }: { result: CmdResult }) {
  if (result === undefined) return null;
  if (result === null) return <span className="text-xs text-[var(--text-muted)]">Running…</span>;
  if (!result.ok) {
    return (
      <div className="rounded-lg bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-red-400">
        {result.error ?? 'Unknown error'}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-[rgba(16,185,129,0.08)] px-3 py-2 text-sm text-green-400">
      {result.value !== undefined ? <ValueBlock value={result.value} /> : 'OK'}
    </div>
  );
}

export default function B2BTestPage() {
  const { wsId } = useParams<{ wsId: string }>();

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cmdBusy, setCmdBusy] = useState<string | null>(null);
  const [cmdResults, setCmdResults] = useState<Record<string, CmdResult | undefined>>({});

  // Power
  const [powerTarget, setPowerTarget] = useState<'on' | 'off'>('on');
  // Input
  const [inputSource, setInputSource] = useState<string>('HDMI1');
  // Volume
  const [volume, setVolume] = useState(30);
  // Brightness
  const [brightness, setBrightness] = useState(70);
  // App launch
  const [appId, setAppId] = useState('');

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const deviceIsOnline = selectedDevice?.status === 'online';

  async function runCmd(action: string, params?: unknown) {
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
      setCmdResults((prev) => ({
        ...prev,
        [action]: { ok: false, error: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setCmdBusy(null);
    }
  }

  function Btn({
    action,
    label,
    busyLabel,
    tone = 'default',
    params,
    disabled,
  }: {
    action: string;
    label: string;
    busyLabel?: string;
    tone?: 'default' | 'primary' | 'danger' | 'warning';
    params?: unknown;
    disabled?: boolean;
  }) {
    const isBusy = cmdBusy === action;
    return (
      <ActionButton
        tone={tone}
        onClick={() => void runCmd(action, params)}
        disabled={!deviceIsOnline || isBusy || (disabled ?? false)}
      >
        {isBusy ? (busyLabel ?? 'Sending…') : label}
      </ActionButton>
    );
  }

  function Res({ action }: { action: string }) {
    const r = cmdResults[action];
    if (r === undefined) return null;
    return <ResultBlock result={r} />;
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="B2BControl API Test"
        description="Test Samsung B2BControl hardware-level commands on a paired Tizen signage device"
      />

      {/* ── Device selector ── */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-base font-semibold text-[var(--text)]">Select Device</h2>
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Choose a device to target. Only online devices can receive commands.
          </p>
        </SectionCardHeader>
        <SectionCardBody>
          {isLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading devices…</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No devices in this workspace.</p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative min-w-64">
                <select
                  className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-9 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                  value={selectedDeviceId}
                  onChange={(e) => {
                    setSelectedDeviceId(e.target.value);
                    setCmdResults({});
                  }}
                >
                  <option value="">— Select a device —</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.status ? `(${d.status})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              </div>
              {selectedDevice && (
                <Badge tone={deviceIsOnline ? 'success' : 'neutral'}>
                  {selectedDevice.status ?? 'unknown'}
                </Badge>
              )}
              {selectedDevice && !deviceIsOnline && (
                <span className="text-xs text-[var(--text-muted)]">Device must be online to send commands.</span>
              )}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {selectedDeviceId && (
        <>
          {/* ── 1. Power Control ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Power Control</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.setPower</code> / <code>b2b.getPower</code> — Turn display on or off, query current state.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                {/* Set Power */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setPower</span>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
                      {(['on', 'off'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setPowerTarget(v)}
                          className={`px-4 py-2 text-sm font-medium transition-colors ${
                            powerTarget === v
                              ? 'bg-[var(--blue)] text-white'
                              : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
                          }`}
                        >
                          {v.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <Btn
                      action="b2b.setPower"
                      label={`Power ${powerTarget.toUpperCase()}`}
                      tone={powerTarget === 'off' ? 'danger' : 'primary'}
                      params={powerTarget}
                    />
                  </div>
                  <Res action="b2b.setPower" />
                </div>
                {/* Get Power */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">getPower</span>
                  <p className="text-xs text-[var(--text-muted)]">Query current power state.</p>
                  <Btn action="b2b.getPower" label="Get Power State" />
                  <Res action="b2b.getPower" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 2. Input Source ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Input Source</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.setInputSource</code> / <code>b2b.getInputSource</code> — Switch HDMI, DP, DVI, MagicInfo, etc.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setInputSource</span>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <select
                        className="appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-9 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                        value={inputSource}
                        onChange={(e) => setInputSource(e.target.value)}
                      >
                        {INPUT_SOURCES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    </div>
                    <Btn action="b2b.setInputSource" label="Set Input" tone="primary" params={inputSource} />
                  </div>
                  <Res action="b2b.setInputSource" />
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">getInputSource</span>
                  <p className="text-xs text-[var(--text-muted)]">Query current active input.</p>
                  <Btn action="b2b.getInputSource" label="Get Input Source" />
                  <Res action="b2b.getInputSource" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 3. Volume & Audio ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Volume &amp; Audio</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.setVolume</code> / <code>b2b.setMute</code> / <code>b2b.getVolume</code>
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                {/* Set Volume */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setVolume</span>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-48">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="font-mono text-sm text-[var(--text)] w-8 text-right">{volume}</span>
                    </div>
                    <Btn action="b2b.setVolume" label={`Set Volume (${volume})`} tone="primary" params={volume} />
                  </div>
                  <Res action="b2b.setVolume" />
                </div>
                {/* Mute / Unmute */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setMute</span>
                  <div className="flex gap-3 flex-wrap">
                    <Btn
                      action="b2b.setMute"
                      label="Mute"
                      tone="warning"
                      params={true}
                    />
                    <Btn
                      action="b2b.setMute"
                      label="Unmute"
                      params={false}
                    />
                  </div>
                  <Res action="b2b.setMute" />
                </div>
                {/* Get Volume */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">getVolume</span>
                  <p className="text-xs text-[var(--text-muted)]">Query current volume level and mute state.</p>
                  <Btn action="b2b.getVolume" label="Get Volume" />
                  <Res action="b2b.getVolume" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 4. Display / Panel Settings ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Display &amp; Panel Settings</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.setBrightness</code> / <code>b2b.getBrightness</code> — Backlight / brightness control.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setBrightness</span>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-48">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="font-mono text-sm text-[var(--text)] w-8 text-right">{brightness}</span>
                    </div>
                    <Btn action="b2b.setBrightness" label={`Set Brightness (${brightness})`} tone="primary" params={brightness} />
                  </div>
                  <Res action="b2b.setBrightness" />
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">getBrightness</span>
                  <p className="text-xs text-[var(--text-muted)]">Query current brightness value.</p>
                  <Btn action="b2b.getBrightness" label="Get Brightness" />
                  <Res action="b2b.getBrightness" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 5. Device Information ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Device Information</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.getDeviceInfo</code> — Model, serial, firmware, MAC, network info.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                <span className="text-sm font-semibold text-[var(--text)]">getDeviceInfo</span>
                <p className="text-xs text-[var(--text-muted)]">
                  Retrieve model name, serial number, firmware version, panel size, MAC address, and network details.
                </p>
                <Btn action="b2b.getDeviceInfo" label="Get Device Info" />
                <Res action="b2b.getDeviceInfo" />
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 6. Reboot ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Reboot</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.reboot</code> — Soft reboot the signage device.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                <span className="text-sm font-semibold text-[var(--text)]">reboot</span>
                <p className="text-xs text-[var(--text-muted)]">
                  Initiates a soft reboot. The device will go offline briefly and reconnect.
                </p>
                <Btn action="b2b.reboot" label="Reboot Device" tone="danger" />
                <Res action="b2b.reboot" />
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 7. Application Control ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">Application Control</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.launchApp</code> / <code>b2b.stopApp</code> / <code>b2b.getRunningApp</code>
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                {/* Launch App */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">launchApp</span>
                  <p className="text-xs text-[var(--text-muted)]">Launch an installed app by its app ID.</p>
                  <div className="flex gap-3 flex-wrap items-end">
                    <div className="space-y-1 flex-1 min-w-48">
                      <label className="text-xs text-[var(--text-muted)]">App ID</label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                        placeholder="e.g. 3201606009684.EBDSignage"
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                      />
                    </div>
                    <Btn
                      action="b2b.launchApp"
                      label="Launch App"
                      tone="primary"
                      params={appId}
                      disabled={!appId.trim()}
                    />
                  </div>
                  <Res action="b2b.launchApp" />
                </div>
                {/* Stop App */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">stopApp</span>
                  <p className="text-xs text-[var(--text-muted)]">Stop the currently running app.</p>
                  <Btn action="b2b.stopApp" label="Stop App" tone="danger" />
                  <Res action="b2b.stopApp" />
                </div>
                {/* Get Running App */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <span className="text-sm font-semibold text-[var(--text)]">getRunningApp</span>
                  <p className="text-xs text-[var(--text-muted)]">Query which app is currently running.</p>
                  <Btn action="b2b.getRunningApp" label="Get Running App" />
                  <Res action="b2b.getRunningApp" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>

          {/* ── 8. OSD / Screen Overlay & Kiosk Controls ── */}
          <SectionCard>
            <SectionCardHeader>
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[var(--text-muted)]" />
                <h2 className="text-base font-semibold text-[var(--text)]">OSD &amp; Kiosk Controls</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                <code>b2b.setOsdDisplay</code> / <code>b2b.setKeyLock</code> / <code>b2b.setButtonLock</code> — OSD visibility, remote lock, button lock.
              </p>
            </SectionCardHeader>
            <SectionCardBody>
              <div className="space-y-4">
                {/* OSD Display */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setOsdDisplay</span>
                  <p className="text-xs text-[var(--text-muted)]">Show or hide the on-screen display overlay.</p>
                  <div className="flex gap-3 flex-wrap">
                    <Btn action="b2b.setOsdDisplay.show" label="Show OSD" params={true} />
                    <Btn action="b2b.setOsdDisplay.hide" label="Hide OSD" tone="warning" params={false} />
                  </div>
                  <Res action="b2b.setOsdDisplay.show" />
                  <Res action="b2b.setOsdDisplay.hide" />
                </div>
                {/* Key Lock (remote) */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setKeyLock (Remote Control)</span>
                  <p className="text-xs text-[var(--text-muted)]">Lock or unlock remote control input. Useful for kiosk deployments.</p>
                  <div className="flex gap-3 flex-wrap">
                    <Btn action="b2b.setKeyLock.on" label="Lock Remote" tone="warning" params={true} />
                    <Btn action="b2b.setKeyLock.off" label="Unlock Remote" params={false} />
                  </div>
                  <Res action="b2b.setKeyLock.on" />
                  <Res action="b2b.setKeyLock.off" />
                </div>
                {/* Button Lock */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
                  <span className="text-sm font-semibold text-[var(--text)]">setButtonLock (Panel Buttons)</span>
                  <p className="text-xs text-[var(--text-muted)]">Lock or unlock physical buttons on the display panel.</p>
                  <div className="flex gap-3 flex-wrap">
                    <Btn action="b2b.setButtonLock.on" label="Lock Buttons" tone="warning" params={true} />
                    <Btn action="b2b.setButtonLock.off" label="Unlock Buttons" params={false} />
                  </div>
                  <Res action="b2b.setButtonLock.on" />
                  <Res action="b2b.setButtonLock.off" />
                </div>
              </div>
            </SectionCardBody>
          </SectionCard>
        </>
      )}
    </div>
  );
}
