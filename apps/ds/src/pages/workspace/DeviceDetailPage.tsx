import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { useAuthStore } from '../../lib/auth.js';
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
  Trash2,
  Volume2,
  VolumeX,
  RotateCcw,
  Tv2,
  Maximize2,
  ScanLine,
  Save,
  Minimize2,
  PowerOff,
  Home,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  AlarmClock,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { formatDistanceToNow } from '../utils/time.js';
import WorkspaceTagPicker from '../../components/WorkspaceTagPicker.js';
import ZoneLayoutEditor, { type ZoneConfig } from '../../components/ZoneLayoutEditor.js';
import {
  ActionButton,
  Badge,
  Callout,
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
  Skeleton,
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

const MDC_ORIENTATION_LABELS: Record<number, string> = {
  0: 'Landscape (0°)', 1: 'Portrait (90°)', 2: 'Landscape (180°)', 3: 'Portrait (270°)',
};
const OSD_BIT_LABELS = ['Source', 'Not Optimum', 'No Signal', 'MDC', 'Schedule'] as const;

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
  powerState: 'on' | 'off' | 'standby' | null;
  irLock: boolean;
  buttonLock: boolean;
  autoPowerOn: boolean;
  // MDC state (DB columns, auto-updated 30s/5min)
  mdcId: number | null;
  mdcVolume: number | null;
  mdcMute: boolean | null;
  mdcInput: number | null;
  mdcStandby: number | null;
  mdcNetworkStandby: number | null;
  mdcRemoteControl: number | null;
  mdcSafetyLock: number | null;
  mdcSoftwareVersion: string | null;
  mdcOsdStatus: number | null;
  mdcMenuOrientation: number | null;
  mdcSrcOrientation: number | null;
  mdcTemperatureC: number | null;
  mdcLastPoll: string | null;
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
  publishedTarget: {
    id: string;
    type: 'content' | 'playlist' | 'schedule';
    name: string;
  } | null;
}

interface DeviceLogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  line: string;
  createdAt: string;
}

interface DeviceLogsResponse {
  deviceId: string;
  online: boolean;
  logs: DeviceLogEntry[];
}

interface ObservedSystemInfo {
  macAddress?: string | null;
  resolution?: string | null;
  ipAddress?: string | null;
  networkType?: string | null;
  wifiSsid?: string | null;
  timezone?: string | null;
  firmwareVersion?: string | null;
  realModel?: string | null;
  panelType?: string | null;
  tvName?: string | null;
}

interface TzEntry { tz: string; offsetMin: number; label: string; }

const MDC_SOURCES = [
  { key: 'HDMI1',     label: 'HDMI 1',        byte: 0x21 },
  { key: 'HDMI2',     label: 'HDMI 2',        byte: 0x23 },
  { key: 'HDMI3',     label: 'HDMI 3',        byte: 0x31 },
  { key: 'HDMI4',     label: 'HDMI 4',        byte: 0x33 },
  { key: 'PC',        label: 'PC/VGA',        byte: 0x14 },
  { key: 'DVI',       label: 'DVI',           byte: 0x18 },
  { key: 'DP',        label: 'DisplayPort',   byte: 0x25 },
  { key: 'AV',        label: 'AV/Composite',  byte: 0x08 },
  { key: 'COMPONENT', label: 'Component',     byte: 0x0C },
] as const;
const MDC_SOURCE_BY_BYTE: Record<number, string> = Object.fromEntries(MDC_SOURCES.map((s) => [s.byte, s.key]));

const TIMER_SOURCES = [
  { label: 'URL Launcher', byte: 0x01 },
  { label: 'HDMI 1',       byte: 0x21 },
  { label: 'HDMI 2',       byte: 0x23 },
  { label: 'HDMI 3',       byte: 0x31 },
  { label: 'HDMI 4',       byte: 0x33 },
  { label: 'DisplayPort',  byte: 0x25 },
  { label: 'Internal/USB', byte: 0x62 },
] as const;

const TIMER_REPEAT_OPTIONS = [
  { value: 0, label: 'Once' },
  { value: 1, label: 'Every day' },
  { value: 2, label: 'Mon – Fri' },
  { value: 3, label: 'Mon – Sat' },
  { value: 4, label: 'Sat – Sun' },
  { value: 5, label: 'Custom days' },
] as const;

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type TimerSlotState = {
  onHour: number; onMin: number; onEnable: boolean;
  offHour: number; offMin: number; offEnable: boolean;
  repeat: number; manualDays: number; volume: number; source: number; busy: boolean;
};
const DEFAULT_TIMER_SLOT: TimerSlotState = {
  onHour: 8, onMin: 0, onEnable: true,
  offHour: 22, offMin: 0, offEnable: true,
  repeat: 1, manualDays: 0, volume: 20, source: 0x01, busy: false,
};

const ALL_TIMEZONE_ENTRIES: TzEntry[] = (() => {
  const now = Date.now();
  const fmt = (tz: string) => {
    try {
      // Get the UTC offset by formatting a date in the tz and comparing
      const parts = new Intl.DateTimeFormat('en', {
        timeZone: tz, timeZoneName: 'shortOffset', hour: 'numeric',
      }).formatToParts(now);
      const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
      // offsetStr is like "GMT+9", "GMT-5:30", "GMT"
      const match = offsetStr.match(/GMT([+-])(\d+)(?::(\d+))?/);
      let offsetMin = 0;
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        offsetMin = sign * (parseInt(match[2] ?? '0', 10) * 60 + parseInt(match[3] ?? '0', 10)) as number;
      }
      const hh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
      const mm = String(Math.abs(offsetMin) % 60).padStart(2, '0');
      const sign = offsetMin >= 0 ? '+' : '-';
      return { tz, offsetMin, label: `(UTC${sign}${hh}:${mm}) ${tz}` };
    } catch {
      return { tz, offsetMin: 0, label: `(UTC+00:00) ${tz}` };
    }
  };
  return Intl.supportedValuesOf('timeZone').map(fmt).sort((a, b) => a.offsetMin - b.offsetMin || a.tz.localeCompare(b.tz));
})();

function TimezoneCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const currentEntry = ALL_TIMEZONE_ENTRIES.find((e) => e.tz === value);
  const displayValue = currentEntry?.label ?? value;

  const [query, setQuery] = useState(displayValue);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(currentEntry?.label ?? value); }, [value, currentEntry?.label]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    // If query matches the current label exactly, show all (user hasn't started typing)
    if (!q || q === displayValue.toLowerCase()) return ALL_TIMEZONE_ENTRIES.slice(0, 80);
    return ALL_TIMEZONE_ENTRIES.filter(
      (e) => e.tz.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [query, displayValue]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(currentEntry?.label ?? value);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [value, currentEntry?.label]);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={(e) => { e.target.select(); setOpen(true); }}
        placeholder="(UTC+00:00) UTC"
        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl">
          {filtered.map((entry) => (
            <li
              key={entry.tz}
              onMouseDown={(e) => { e.preventDefault(); onChange(entry.tz); setQuery(entry.label); setOpen(false); }}
              className={`px-3 py-1.5 text-xs font-mono cursor-pointer hover:bg-[var(--surface-raised)] ${
                entry.tz === value ? 'text-[var(--blue)] font-semibold' : 'text-[var(--text)]'
              }`}
            >
              <span className="text-[var(--text-muted)]">{entry.label.split(')')[0]})</span>
              {' '}{entry.tz}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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

// ── LiveViewOverlay ───────────────────────────────────────────────────────────
function LiveViewOverlay({ deviceId, isOnline, onClose, onPowerChange }: { deviceId: string; isOnline: boolean; onClose: () => void; onPowerChange?: (state: 'on' | 'off') => void }) {
  type LiveStatus = 'idle' | 'buffering' | 'playing';
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [sseError, setSseError] = useState<string | null>(null);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [measuredCadenceMs, setMeasuredCadenceMs] = useState(0);
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [mdcStatusResponse, setMdcStatusResponse] = useState<{
    ok: boolean; nodeRunning?: boolean; serial?: string; rawHex?: string; error?: string;
    status?: { displayId: number; ack: 'A'|'N'; rCmd: number; power?: number; volume?: number; mute?: number; input?: number; aspect?: number; nTime?: number; fTime?: number };
  } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const statusRef = useRef<LiveStatus>('idle');
  const staleFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameAtRef = useRef<number>(0);
  const measuredCadenceRef = useRef<number>(0);
  const remoteStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, Math.round((window.innerWidth - 1280) / 2)),
    y: Math.max(0, Math.round((window.innerHeight - 760) / 2)),
  }));
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  function onDragStart(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button,select,a')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.originX + ev.clientX - dragRef.current.startX)),
        y: Math.max(0, Math.min(window.innerHeight - 48,  dragRef.current.originY + ev.clientY - dragRef.current.startY)),
      });
    }
    function onUp() { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => { onCloseRef.current = onClose; });
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
  useEffect(() => { void fetchRemoteStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function doCleanup() {
    esRef.current?.close(); esRef.current = null;
    if (staleFrameTimerRef.current) { clearTimeout(staleFrameTimerRef.current); staleFrameTimerRef.current = null; }
    if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    lastFrameAtRef.current = 0; measuredCadenceRef.current = 0;
    setWaitingElapsed(0); setIsStale(false); setMeasuredCadenceMs(0);
    statusRef.current = 'idle'; setStatus('idle');
  }

  function armStaleFrameTimer() {
    if (staleFrameTimerRef.current) clearTimeout(staleFrameTimerRef.current);
    const grace = measuredCadenceRef.current > 0 ? Math.max(measuredCadenceRef.current * 2.5 + 3000, 15000) : 20000;
    staleFrameTimerRef.current = setTimeout(() => { if (statusRef.current === 'playing') setIsStale(true); }, grace);
  }

  function handleStart(ms?: number) {
    if (!isOnline) return;
    const interval = ms ?? intervalMs;
    doCleanup(); setImgSrc(null); setSseError(null);
    statusRef.current = 'buffering'; setStatus('buffering');
    setWaitingElapsed(0);
    elapsedTimerRef.current = setInterval(() => setWaitingElapsed(s => s + 1), 1000);
    const es = new EventSource(`/api/devices/${deviceId}/screenshot/stream?intervalMs=${interval}`);
    esRef.current = es;
    es.onmessage = (e) => {
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
      if (hardTimeoutRef.current) { clearTimeout(hardTimeoutRef.current); hardTimeoutRef.current = null; }
      const now = Date.now();
      if (lastFrameAtRef.current > 0) {
        const delta = now - lastFrameAtRef.current;
        measuredCadenceRef.current = measuredCadenceRef.current > 0 ? Math.round(measuredCadenceRef.current * 0.7 + delta * 0.3) : delta;
        setMeasuredCadenceMs(measuredCadenceRef.current);
      }
      lastFrameAtRef.current = now;
      setIsStale(false); setImgSrc(`data:image/jpeg;base64,${e.data}`);
      if (statusRef.current !== 'playing') { statusRef.current = 'playing'; setStatus('playing'); }
      armStaleFrameTimer();
    };
    es.onerror = () => { setSseError('Stream connection failed. Is the device online?'); doCleanup(); };
    hardTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'buffering') { setSseError('No frames received after 30s.'); doCleanup(); }
    }, 30000);
  }

  async function sendRemoteKey(key: string) {
    if (remoteStatusTimerRef.current) clearTimeout(remoteStatusTimerRef.current);
    try {
      await api.post(`/devices/${deviceId}/remote-key`, { key });
      setRemoteStatus(`✓ ${key.replace('_', ' ').toLowerCase()}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let label = msg; try { label = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /**/ }
      setRemoteStatus(`✗ ${label}`);
    }
    remoteStatusTimerRef.current = setTimeout(() => setRemoteStatus(null), 2500);
  }

  async function fetchRemoteStatus() {
    if (remoteStatusTimerRef.current) clearTimeout(remoteStatusTimerRef.current);
    try {
      const result = await api.get(`/devices/${deviceId}/remote-status`) as typeof mdcStatusResponse;
      setMdcStatusResponse(result);
      setRemoteStatus(result?.ok ? '✓ status read' : `✗ ${result?.error ?? 'failed'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let label = msg; try { label = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /**/ }
      setMdcStatusResponse({ ok: false, error: label });
      setRemoteStatus(`✗ ${label}`);
    }
    remoteStatusTimerRef.current = setTimeout(() => setRemoteStatus(null), 3000);
  }

  const isLive = status !== 'idle';
  const cadenceLabel = measuredCadenceMs > 0 ? `~${(measuredCadenceMs/1000).toFixed(1)}s` : `~${Math.ceil(intervalMs/1000)}s`;

  return (
    <div className="fixed inset-0 z-50" style={{ pointerEvents: 'none' }}>
      <div
        className="absolute flex flex-col bg-[#0d0d0d] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        style={fullscreen
          ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0, pointerEvents: 'all' }
          : { left: pos.x, top: pos.y, width: 1280, height: 760, pointerEvents: 'all' }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-black/80 border-b border-white/10 cursor-grab active:cursor-grabbing select-none" onMouseDown={onDragStart}>
          <Tv2 className="w-5 h-5 text-white/70" />
          <span className="text-white font-semibold text-sm">Live View</span>
          {status === 'buffering' && <span className="flex items-center gap-1.5 text-xs text-yellow-300"><span className="w-1.5 h-1.5 rounded-full bg-yellow-300 animate-pulse" />Waiting for first frame…</span>}
          {status === 'playing' && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold text-white uppercase tracking-widest"
              style={isStale ? { backgroundColor: 'rgb(161,98,7)' } : undefined}>
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />LIVE
            </span>
          )}
          {isLive && <span className="text-[11px] text-white/30">{cadenceLabel} cadence</span>}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-white/60">Interval
              <select value={intervalMs} onChange={(e) => { const ms = Number(e.target.value); setIntervalMs(ms); if (isLive) handleStart(ms); }}
                className="rounded bg-white/10 px-2 py-1 text-white text-xs border border-white/20">
                <option value={1000}>1s</option><option value={2000}>2s</option><option value={3000}>3s</option>
              </select>
            </label>
            {!isLive
              ? <button onClick={() => handleStart()} disabled={!isOnline} className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 transition-colors">Start Live</button>
              : <button onClick={doCleanup} className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors">Stop</button>
            }
            <button onClick={() => setFullscreen(f => !f)} className="rounded-lg p-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors">
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={() => onCloseRef.current()} className="rounded-lg p-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Image area */}
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative"
            style={{ background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 50%, transparent 100%)' }}>
            {status === 'buffering' && (
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-16 h-16">
                  <svg className="absolute inset-0 -rotate-90 w-full h-full" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(253,224,71,0.15)" strokeWidth="3" />
                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgb(253,224,71)" strokeWidth="3"
                      strokeDasharray="175.9" strokeDashoffset={175.9 - (175.9 * Math.min(waitingElapsed / 30, 1))}
                      style={{ transition: 'stroke-dashoffset 0.9s linear' }} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-yellow-300 text-sm font-mono">{waitingElapsed}s</span>
                </div>
                <p className="text-white/70 text-sm">{waitingElapsed >= 10 ? 'Still waiting…' : 'Waiting for first frame…'}</p>
                <p className="text-white/30 text-xs">{cadenceLabel} capture · 30s timeout</p>
              </div>
            )}
            {status === 'playing' && imgSrc && <img src={imgSrc} alt="Live view" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />}
            {sseError && (
              <div className="flex flex-col items-center gap-3 text-center max-w-sm">
                <p className="text-red-400 text-sm">{sseError}</p>
                <button onClick={() => { setSseError(null); handleStart(); }} disabled={!isOnline}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white disabled:opacity-40 transition-colors">Retry</button>
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
              <div className="text-white/40 text-sm">{isOnline ? 'Press Start Live to begin streaming' : 'Device is offline'}</div>
            )}
          </div>

          {/* Remote panel */}
          <div className="w-56 flex-shrink-0 border-l border-white/10 flex flex-col items-center gap-4 p-4 bg-black/40 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Remote</p>
            <div className="flex gap-1.5 w-full">
              <button onClick={() => { onPowerChange?.('on'); void sendRemoteKey('POWER_ON'); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-400 text-xs font-medium transition-colors"><Power className="w-3 h-3" /> On</button>
              <button onClick={() => { onPowerChange?.('off'); void sendRemoteKey('POWER_OFF'); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-medium transition-colors"><PowerOff className="w-3 h-3" /> Off</button>
            </div>
            <button onClick={() => sendRemoteKey('REBOOT')} className="flex items-center justify-center gap-1 w-full py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 text-xs font-medium transition-colors"><RefreshCw className="w-3 h-3" /> Reboot</button>
            <button onClick={fetchRemoteStatus} className="flex items-center justify-center gap-1 w-full py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 text-xs font-medium transition-colors"><Monitor className="w-3 h-3" /> Status</button>
            <div className="w-full border-t border-white/10" />
            <div className="grid grid-cols-3 gap-1.5">
              <div />
              <button onClick={() => sendRemoteKey('ARROW_UP')} className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronUp className="w-5 h-5" /></button>
              <div />
              <button onClick={() => sendRemoteKey('ARROW_LEFT')} className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => sendRemoteKey('ENTER')} className="flex items-center justify-center w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors">OK</button>
              <button onClick={() => sendRemoteKey('ARROW_RIGHT')} className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronRight className="w-5 h-5" /></button>
              <div />
              <button onClick={() => sendRemoteKey('ARROW_DOWN')} className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><ChevronDown className="w-5 h-5" /></button>
              <div />
            </div>
            <div className="flex gap-2">
              <button onClick={() => sendRemoteKey('MENU')} className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors">Menu</button>
              <button onClick={() => sendRemoteKey('RETURN')} className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors">Back</button>
            </div>
            <button onClick={() => sendRemoteKey('HOME')} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors w-full justify-center"><Home className="w-3.5 h-3.5" />Home</button>
            <div className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-[10px] leading-5">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold uppercase tracking-widest text-white/30 text-[9px]">Device Status</span>
                <button onClick={() => void fetchRemoteStatus()} className="text-white/30 hover:text-sky-300 transition-colors"><RefreshCw className="w-2.5 h-2.5" /></button>
              </div>
              {mdcStatusResponse === null ? <span className="text-white/20">fetching…</span> : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${mdcStatusResponse.nodeRunning ? 'bg-green-400' : 'bg-red-400'}`} />
                    <span className={mdcStatusResponse.nodeRunning ? 'text-green-400' : 'text-red-400'}>Node {mdcStatusResponse.nodeRunning ? 'running' : 'offline'}</span>
                  </div>
                  {mdcStatusResponse.serial && <div className="font-mono text-white mt-0.5">S/N: {mdcStatusResponse.serial}</div>}
                  {mdcStatusResponse.status && (
                    <div className="text-white/60 mt-0.5 space-y-0.5">
                      <div>Power: <span className={mdcStatusResponse.status.power === 1 ? 'text-green-400' : 'text-white/40'}>{mdcStatusResponse.status.power === 1 ? 'ON' : mdcStatusResponse.status.power === 0 ? 'OFF' : '—'}</span></div>
                      <div>Vol: {mdcStatusResponse.status.volume ?? '—'}{'  '}Mute: {mdcStatusResponse.status.mute === 1 ? 'ON' : 'off'}</div>
                      <div>Input: {mdcStatusResponse.status.input != null ? `0x${mdcStatusResponse.status.input.toString(16).toUpperCase()}` : '—'}</div>
                    </div>
                  )}
                  {mdcStatusResponse.error && <div className="text-red-300 mt-0.5">{mdcStatusResponse.error}</div>}
                </>
              )}
            </div>
            {remoteStatus && (
              <span className={`text-[11px] text-center leading-tight ${remoteStatus.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{remoteStatus}</span>
            )}
            {!isOnline && <p className="text-[10px] text-white/20 text-center">Device offline — MDC may still work</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeviceDetailPage() {
  const { wsId, deviceId } = useParams<{ wsId: string; deviceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, bootstrapped } = useAuthStore();

  const [volumeInput, setVolumeInput] = useState(50);
  const [selectedSource, setSelectedSource] = useState('HDMI1');
  const [optimisticMute, setOptimisticMute] = useState<boolean | null>(null);
  const [optimisticStandby, setOptimisticStandby] = useState<number | null>(null);
  const [optimisticNetStandby, setOptimisticNetStandby] = useState<boolean | null>(null);
  const [optimisticRemoteCtrl, setOptimisticRemoteCtrl] = useState<boolean | null>(null);
  const [optimisticSafetyLock, setOptimisticSafetyLock] = useState<boolean | null>(null);
  const [optimisticOsdBits, setOptimisticOsdBits] = useState<number | null>(null);
  const [optimisticMenuOrientation, setOptimisticMenuOrientation] = useState<number | null>(null);
  const [optimisticSrcOrientation, setOptimisticSrcOrientation] = useState<number | null>(null);
  const [optimisticPowerState, setOptimisticPowerState] = useState<'on' | 'off' | null>(null);
  const [liveViewOpen, setLiveViewOpen] = useState(false);
  // NTP form
  const [ntpServer,      setNtpServer]      = useState('');
  const [ntpInitialised, setNtpInitialised] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceCode, setReplaceCode] = useState('');
  const [mdcScanBusy, setMdcScanBusy] = useState(false);
  const [mdcScanResult, setMdcScanResult] = useState<{ found: true; displayId: number } | { found: false } | null>(null);
  const [mdcSaveBusy, setMdcSaveBusy] = useState(false);
  const [selectedTimerSlot, setSelectedTimerSlot] = useState(1);
  const [timerSlots, setTimerSlots] = useState<Record<number, TimerSlotState>>({});

  const { data, isLoading } = useQuery<{
    device: Device;
    screenshots: Screenshot[];
    latestHeartbeat: DeviceHeartbeat | null;
  }>({
    queryKey: ['device', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}`),
    enabled: bootstrapped && !!user && !!deviceId,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 15_000),
    retry: false,
  });

  type PlayerRelease = { id: string; version: string; downloadUrl: string; releaseNotes: string | null; isLatest: boolean; publishedAt: string };
  const { data: latestRelease } = useQuery<PlayerRelease | null>({
    queryKey: ['player-releases-latest'],
    queryFn: () => api.get('/player-releases/latest'),
    enabled: bootstrapped && !!user,
    staleTime: 60_000,
    retry: false,
  });

  type MdcControl = {
    ok: boolean;
    nodeRunning?: boolean;
    serial?: string;
    tvName?: string;
    deviceTime?: string; // ISO string from MDC §2.1.A7 clock GET
    status?: { power?: number; volume?: number; mute?: number; input?: number };
  };
  // Reset optimistic MDC states when a fresh poll arrives from the device
  useEffect(() => {
    setOptimisticStandby(null);
    setOptimisticNetStandby(null);
    setOptimisticRemoteCtrl(null);
    setOptimisticSafetyLock(null);
    setOptimisticOsdBits(null);
    setOptimisticMenuOrientation(null);
    setOptimisticSrcOrientation(null);
  }, [data?.device?.mdcLastPoll]);

  // Reset optimistic power state when the DB value is confirmed
  useEffect(() => {
    setOptimisticPowerState(null);
  }, [data?.device?.powerState]);

  // Sync volume/source/mute inputs from latest DB heartbeat values
  useEffect(() => {
    if (data?.device == null) return;
    const d = data.device;
    if (d.mdcVolume != null) setVolumeInput(d.mdcVolume);
    if (d.mdcInput != null) {
      const src = MDC_SOURCE_BY_BYTE[d.mdcInput];
      if (src) setSelectedSource(src);
    }
    if (d.mdcMute != null) setOptimisticMute(null);
  }, [data?.device?.mdcVolume, data?.device?.mdcInput, data?.device?.mdcMute]);

  const { data: logData } = useQuery<DeviceLogsResponse>({
    queryKey: ['device-logs', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/logs?limit=1000`),
    enabled: bootstrapped && !!user && !!deviceId,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 2_000),
    retry: false,
  });

  const observedSystemInfo = useMemo(() => parseObservedSystemInfo(logData?.logs ?? []), [logData?.logs]);

  type LogLevel = 'all' | 'debug' | 'info' | 'warn' | 'error';
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logAreaRef = useRef<HTMLTextAreaElement>(null);

  const logs = logData?.logs ?? [];
  const filteredLogs = useMemo(
    () => (logFilter === 'all' ? logs : logs.filter((l) => l.level === logFilter)),
    [logs, logFilter],
  );
  const logText = useMemo(() => buildLogText(filteredLogs), [filteredLogs]);

  useEffect(() => {
    if (autoScroll && logAreaRef.current) {
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
    }
  }, [logText, autoScroll]);

  const handleLogScroll = useCallback(() => {
    const el = logAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const clearLogs = useMutation({
    mutationFn: () => api.delete(`/devices/${deviceId}/logs`),
    onSuccess: () => {
      toast.success('Logs cleared');
      void queryClient.invalidateQueries({ queryKey: ['device-logs', deviceId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to clear logs'),
  });

  function downloadLogs() {
    if (!logText) {
      toast.error('No logs to download');
      return;
    }
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `device-logs-${deviceId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const resolvedTimezone = useMemo(
    () => preferObservedValue(data?.device.timezone, observedSystemInfo?.timezone),
    [data?.device.timezone, observedSystemInfo?.timezone],
  );
  const resolvedResolution = useMemo(
    () => data?.device.resolution || observedSystemInfo?.resolution || null,
    [data?.device.resolution, observedSystemInfo?.resolution],
  );
  const resolvedWifiSsid = useMemo(
    () => data?.device.wifiSsid || observedSystemInfo?.wifiSsid || null,
    [data?.device.wifiSsid, observedSystemInfo?.wifiSsid],
  );
  const resolvedIpAddress = useMemo(
    () => data?.device.ipAddress || observedSystemInfo?.ipAddress || null,
    [data?.device.ipAddress, observedSystemInfo?.ipAddress],
  );
  const resolvedMacAddress = useMemo(
    () => data?.device.macAddress || observedSystemInfo?.macAddress || null,
    [data?.device.macAddress, observedSystemInfo?.macAddress],
  );
  const resolvedConnectionType = useMemo(() => {
    if (data?.device.connectionType) return data.device.connectionType;
    if (observedSystemInfo?.networkType?.toUpperCase().includes('WIFI')) return 'wifi';
    if (observedSystemInfo?.networkType?.toUpperCase().includes('ETH')) return 'ethernet';
    return null;
  }, [data?.device.connectionType, observedSystemInfo?.networkType]);

  const observedOnlyFields = useMemo(() => {
    if (!data?.device || !observedSystemInfo) return [] as string[];

    const items: string[] = [];
    if ((!data.device.timezone || data.device.timezone === 'UTC') && observedSystemInfo.timezone) items.push(`timezone=${observedSystemInfo.timezone}`);
    if (!data.device.resolution && observedSystemInfo.resolution) items.push(`resolution=${observedSystemInfo.resolution}`);
    if (!data.device.wifiSsid && observedSystemInfo.wifiSsid) items.push(`ssid=${observedSystemInfo.wifiSsid}`);
    return items;
  }, [data?.device, observedSystemInfo]);

  useEffect(() => {
    if (!data?.device || ntpInitialised) return;
    setNtpServer(data.device.ntpServer ?? 'pool.ntp.org');
    setNtpInitialised(true);
  }, [data?.device, ntpInitialised, observedSystemInfo?.timezone]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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
        power_on:           'Power-on sent',
        clear_cache:        'Cache clear sent',
        dump_logs:          'Log dump requested — check device OSD',
        mdc_control:        'MDC command sent',
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
      if (cmd.command === 'power_off') {
        setOptimisticPowerState('off');
        void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
        void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
      } else if (cmd.command === 'power_on') {
        setOptimisticPowerState('on');
        void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
        void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
      } else if (cmd.command === 'screenshot') {
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

  const unpublishDevice = useMutation({
    mutationFn: () => api.post('/devices/unpublish', { workspaceId: wsId, deviceIds: [deviceId] }),
    onSuccess: () => {
      toast.success('Device returned to workspace scheduling');
      void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
      void queryClient.invalidateQueries({ queryKey: ['devices', wsId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to unpublish device'),
  });

  const sendCmd = (cmd: DeviceCommandInput) => cmdMutation.mutate(cmd);

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-10 w-40 rounded-xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
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
  const fallbackNowPlaying = device.publishedTarget?.name ?? null;
  const fallbackNowPlayingType = device.publishedTarget?.type ?? null;
  const nowPlayingLabel = hb?.currentContentName
    ?? (hb?.currentContentId ? '(unknown)' : null)
    ?? fallbackNowPlaying
    ?? 'Nothing';
  const showPublishedTargetBadge = !hb?.currentContentName && !hb?.currentContentId && !!fallbackNowPlayingType;

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
          trailing={
            <div className="flex items-center gap-2">
              <StatusBadge status={device.status} />
              {(optimisticPowerState ?? device.powerState) != null && (
                <Badge tone={(optimisticPowerState ?? device.powerState) === 'on' ? 'success' : (optimisticPowerState ?? device.powerState) === 'standby' ? 'warning' : 'neutral'}>
                  Power {optimisticPowerState ?? device.powerState}
                </Badge>
              )}
            </div>
          }
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

      {observedOnlyFields.length > 0 && (
        <Callout tone="accent" icon={<AlertTriangle className="w-4 h-4" />}>
          Recent device logs already report values not fully reflected in the stored device state: {observedOnlyFields.join(', ')}.
        </Callout>
      )}

      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Published Target</h2>
          {device.publishedTarget ? <Badge tone="accent">{device.publishedTarget.type}</Badge> : <Badge tone="neutral">Workspace</Badge>}
        </SectionCardHeader>
        <SectionCardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {device.publishedTarget ? (
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text)] truncate">{device.publishedTarget.name}</p>
              <p className="text-xs text-[var(--text-muted)]">
                This device is currently pinned to a published {device.publishedTarget.type}. Unpublish to resume normal workspace schedule and fallback behavior.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--text)]">No device-level publish override</p>
              <p className="text-xs text-[var(--text-muted)]">This device is following workspace schedules and default playlist fallbacks.</p>
            </div>
          )}
          {device.publishedTarget && (
            <ActionButton
              onClick={() => unpublishDevice.mutate()}
              disabled={unpublishDevice.isPending}
              tone="warning"
              className="px-4 py-2 text-sm shrink-0"
            >
              <RefreshCw className="w-4 h-4" />{unpublishDevice.isPending ? 'Unpublishing…' : 'Unpublish'}
            </ActionButton>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* ── #14 Hardware identity  +  #15 Network ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Fingerprint className="w-3.5 h-3.5" />Hardware Identity
            </h2>
          </SectionCardHeader>
          <SectionCardBody className="space-y-3">
            <InfoRow icon={Monitor}     label="Model"          value={[device.modelName, device.modelCode, observedSystemInfo?.realModel].filter(Boolean).join(' / ') || null} />
            <InfoRow icon={Fingerprint} label="DUID"           value={device.duid} />
            <InfoRow icon={Settings2}   label="Serial Number"  value={device.serialNumber} />
            <InfoRow icon={Cpu}         label="Firmware"       value={device.firmwareVersion ?? observedSystemInfo?.firmwareVersion} />
            <InfoRow icon={Cpu}         label="Player version" value={device.playerVersion ? `v${device.playerVersion}` : null} />
            <InfoRow icon={Settings2}   label="Software Ver"   value={device.mdcSoftwareVersion ?? null} />
            <InfoRow icon={Monitor}     label="Resolution"     value={resolvedResolution} />
            <InfoRow icon={Globe}       label="Timezone"       value={resolvedTimezone} />
          </SectionCardBody>
        </SectionCard>

        <SectionCard>
          <SectionCardHeader>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
              <Network className="w-3.5 h-3.5" />Network
            </h2>
          </SectionCardHeader>
          <SectionCardBody className="space-y-3">
            <InfoRow icon={Globe}   label="IP Address"  value={resolvedIpAddress} />
            <InfoRow icon={Network} label="MAC Address" value={resolvedMacAddress} />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-[var(--text-muted)]">
                <Wifi className="w-3.5 h-3.5" />Connection
              </span>
              {resolvedConnectionType
                ? <Badge tone={resolvedConnectionType === 'wifi' ? 'accent' : 'neutral'}>
                    {resolvedConnectionType.toUpperCase()}
                  </Badge>
                : <span className="text-[var(--text-muted)] text-xs">—</span>}
            </div>
            {resolvedConnectionType === 'wifi' && (
              <>
                <InfoRow icon={Wifi} label="SSID" value={resolvedWifiSsid} />
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
                {(device.mdcTemperatureC != null || hb.temperatureC != null) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Thermometer className="w-3.5 h-3.5" />Temperature
                    </span>
                    <Badge tone={(device.mdcTemperatureC ?? hb.temperatureC ?? 0) > 70 ? 'danger' : (device.mdcTemperatureC ?? hb.temperatureC ?? 0) > 55 ? 'warning' : 'neutral'}>
                      {(device.mdcTemperatureC ?? hb.temperatureC)!.toFixed(1)} °C
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
                {/* Power state from MDC heartbeat (DB column) */}
                {(optimisticPowerState ?? device.powerState) != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Power className="w-3.5 h-3.5" />Power state
                    </span>
                    <Badge tone={(optimisticPowerState ?? device.powerState) === 'on' ? 'success' : (optimisticPowerState ?? device.powerState) === 'standby' ? 'warning' : 'neutral'}>
                      {optimisticPowerState ?? device.powerState}
                    </Badge>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No heartbeat data yet.</p>
            )}
            {/* MDC live state (volume, mute, source) — auto-updated from 30s heartbeat */}
            {(device.mdcVolume != null || device.mdcMute != null || device.mdcInput != null) && (
              <>
                <div className="h-px bg-[var(--border)]" />
                {device.mdcVolume != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Volume2 className="w-3.5 h-3.5" />Volume
                    </span>
                    <span className="font-mono text-xs text-[var(--text)]">{device.mdcVolume}</span>
                  </div>
                )}
                {device.mdcMute != null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-[var(--text-muted)]">
                      {device.mdcMute ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      Mute
                    </span>
                    <Badge tone={device.mdcMute ? 'warning' : 'neutral'}>
                      {device.mdcMute ? 'muted' : 'unmuted'}
                    </Badge>
                  </div>
                )}
                {device.mdcInput != null && (
                  <InfoRow icon={Monitor} label="Source"
                    value={MDC_SOURCES.find(s => s.key === MDC_SOURCE_BY_BYTE[device.mdcInput!])?.label
                      ?? `0x${device.mdcInput.toString(16).toUpperCase()}`} />
                )}
              </>
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
                    {showPublishedTargetBadge && fallbackNowPlayingType && (
                      <span className="ml-auto">
                        <Badge tone="accent">{fallbackNowPlayingType}</Badge>
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--text)] font-medium truncate">
                    {nowPlayingLabel}
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

      {/* ── Power & Controls ─────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-[var(--text)]">
            <Power className="w-3.5 h-3.5" />Power &amp; Controls
          </h2>
          {(optimisticPowerState ?? device.powerState) != null && (
            <Badge tone={(optimisticPowerState ?? device.powerState) === 'on' ? 'success' : (optimisticPowerState ?? device.powerState) === 'standby' ? 'warning' : 'neutral'}>
              {optimisticPowerState ?? device.powerState}
            </Badge>
          )}
        </SectionCardHeader>
        <SectionCardBody className="space-y-4">

          {/* ── Power ───────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">Power</span>
            <button
              type="button"
              onClick={() => sendCmd({ command: 'power_on' })}
              disabled={cmdDisabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors text-xs font-medium text-emerald-400"
            >
              <Power className="w-3 h-3" />On
            </button>
            <button
              type="button"
              onClick={() => sendCmd({ command: 'power_off' })}
              disabled={cmdDisabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 transition-colors text-xs font-medium text-red-400"
            >
              <Power className="w-3 h-3" />Off
            </button>
            <button
              type="button"
              onClick={() => sendCmd({ command: 'reboot' })}
              disabled={cmdDisabled}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 transition-colors text-xs font-medium text-amber-400"
            >
              <RotateCcw className="w-3 h-3" />Reboot
            </button>
          </div>

          <div className="h-px bg-[var(--border)]" />

          {/* ── Display controls (expandable: add brightness/contrast rows here) */}
          <div className="space-y-3">

            {/* Volume + Mute */}
            <div className="flex items-center gap-3 flex-wrap">
              <Volume2 className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <span className="text-xs text-[var(--text-muted)] w-12 shrink-0">Volume</span>
              <input
                type="number" min={0} max={100} value={volumeInput}
                onChange={(e) => setVolumeInput(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
                className="w-16 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]"
              />
              <ActionButton
                type="button"
                disabled={cmdDisabled}
                onClick={() => sendCmd({ command: 'mdc_control', payload: { action: 'set_volume', level: volumeInput } })}
                tone="primary" className="px-3 py-1.5 text-xs"
              >Set</ActionButton>
              {device.mdcVolume != null && (
                <span className="text-xs text-[var(--text-muted)]">current: {device.mdcVolume}</span>
              )}
              <span className="w-px h-4 bg-[var(--border)] mx-1 shrink-0" />
              {(optimisticMute !== null ? optimisticMute : !!(device.mdcMute))
                ? <VolumeX className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                : <Volume2 className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              }
              <span className="text-xs text-[var(--text-muted)]">Mute</span>
              <ToggleSwitch
                label={(optimisticMute !== null ? optimisticMute : !!(device.mdcMute)) ? 'Muted' : 'Unmuted'}
                checked={optimisticMute !== null ? optimisticMute : !!(device.mdcMute)}
                onChange={() => {
                  const next = !(optimisticMute !== null ? optimisticMute : !!(device.mdcMute));
                  setOptimisticMute(next);
                  sendCmd({ command: 'mdc_control', payload: { action: 'set_mute', mute: next } });
                }}
                labelClassName="text-xs"
              />
            </div>

            {/* Source */}
            <div className="flex items-center gap-3 flex-wrap">
              <Monitor className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <span className="text-xs text-[var(--text-muted)] w-12 shrink-0">Source</span>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="w-36 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
              >
                {MDC_SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <ActionButton
                type="button"
                disabled={cmdDisabled}
                onClick={() => sendCmd({ command: 'mdc_control', payload: { action: 'set_source', source: selectedSource } })}
                tone="primary" className="px-3 py-1.5 text-xs shrink-0"
              >Set</ActionButton>
              {device.mdcInput != null && MDC_SOURCE_BY_BYTE[device.mdcInput] && (
                <span className="text-xs text-[var(--text-muted)]">
                  current: {MDC_SOURCES.find((s) => s.key === MDC_SOURCE_BY_BYTE[device.mdcInput!])?.label
                    ?? `0x${device.mdcInput.toString(16).toUpperCase()}`}
                </span>
              )}
            </div>

          </div>

          <div className="h-px bg-[var(--border)]" />

          {/* ── App actions + MDC ID ─────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">
            <ActionButton type="button" disabled={cmdDisabled} onClick={() => sendCmd({ command: 'clear_cache' })}>
              <HardDrive className="w-3.5 h-3.5" /> Clear Cache
            </ActionButton>
            <ActionButton type="button" disabled={cmdDisabled} onClick={() => sendCmd({ command: 'relaunch_app' })}>
              <RefreshCw className="w-3.5 h-3.5" /> Relaunch App
            </ActionButton>
            <ActionButton type="button" disabled={!isOnline} onClick={() => setLiveViewOpen(true)} tone="primary">
              <Tv2 className="w-3.5 h-3.5" /> Live View
            </ActionButton>
            <span className="w-px h-4 bg-[var(--border)] mx-1 shrink-0" />
            <span className="text-xs text-[var(--text-muted)]">MDC ID:</span>
            <span className="text-xs font-mono font-semibold text-[var(--text)]">{device.mdcId ?? '—'}</span>
            <ActionButton
              type="button"
              disabled={!isOnline || mdcScanBusy}
              onClick={async () => {
                setMdcScanBusy(true);
                setMdcScanResult(null);
                try {
                  const r = await api.post(`/devices/${deviceId}/mdc-control`, { action: 'mdc_id_scan' }) as { ok: boolean; displayId?: number };
                  const found = r.ok && r.displayId != null;
                  setMdcScanResult(found && r.displayId != null ? { found: true, displayId: r.displayId } : { found: false });
                  if (!found) toast.error('No MDC device responded (IDs 1–9)');
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Scan failed');
                } finally {
                  setMdcScanBusy(false);
                }
              }}
            >
              <ScanLine className="w-3.5 h-3.5" />{mdcScanBusy ? 'Scanning…' : 'Scan'}
            </ActionButton>
            {mdcScanResult?.found && mdcScanResult.displayId != null && (
              <>
                <span className="text-xs text-[var(--text-muted)]">Found: <span className="font-mono font-semibold text-[var(--text)]">{mdcScanResult.displayId}</span></span>
                <ActionButton
                  type="button"
                  tone="primary"
                  disabled={mdcSaveBusy}
                  onClick={async () => {
                    setMdcSaveBusy(true);
                    try {
                      await api.post(`/devices/${deviceId}/mdc-control`, { action: 'save_mdc_id', id: mdcScanResult.displayId });
                      toast.success(`MDC ID ${mdcScanResult.displayId} saved`);
                      setMdcScanResult(null);
                      void queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Save failed');
                    } finally {
                      setMdcSaveBusy(false);
                    }
                  }}
                >
                  <Save className="w-3.5 h-3.5" /> Save
                </ActionButton>
              </>
            )}
          </div>

        </SectionCardBody>
      </SectionCard>

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-sm font-semibold text-[var(--text)]">Settings</h2>
          {device.mdcLastPoll && (
            <span className="text-xs text-[var(--text-muted)]">MDC polled {formatDistanceToNow(device.mdcLastPoll)}</span>
          )}
        </SectionCardHeader>
        <SectionCardBody>
          <form onSubmit={handleSubmit((d) => {
            updateDevice.mutate(d);
            if (isOnline && ntpServer) {
              sendCmd({ command: 'set_ntp', payload: { server: ntpServer, timezone: d.timezone ?? 'UTC' } });
            }
            if (isOnline && d.name) {
              sendCmd({ command: 'mdc_control', payload: { action: 'set_device_name', name: d.name.slice(0, 15) } });
            }
          })}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Display Name</label>
              <input {...register('name')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]" />
            </div>

            {/* ── Display Settings (MDC) ───────────────────────────────── */}
            <div className="sm:col-span-2 space-y-5">

              {/* 2×2 toggle grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">

                {/* Standby (DPMS) */}
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                    <Power className="w-3 h-3" />Standby
                  </span>
                  <select
                    value={optimisticStandby ?? device.mdcStandby ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setOptimisticStandby(v);
                      sendCmd({ command: 'mdc_control', payload: { action: 'standby_set', value: v } });
                    }}
                    disabled={cmdDisabled}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)] disabled:opacity-40"
                  >
                    <option value={0}>Off</option>
                    <option value={1}>On</option>
                    <option value={2}>Auto</option>
                  </select>
                </div>

                {/* Network Standby */}
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                    <Wifi className="w-3 h-3" />Net Standby
                  </span>
                  <ToggleSwitch
                    label={(optimisticNetStandby !== null ? optimisticNetStandby : device.mdcNetworkStandby === 1) ? 'On' : 'Off'}
                    checked={optimisticNetStandby !== null ? optimisticNetStandby : device.mdcNetworkStandby === 1}
                    onChange={() => {
                      const next = !(optimisticNetStandby !== null ? optimisticNetStandby : device.mdcNetworkStandby === 1);
                      setOptimisticNetStandby(next);
                      sendCmd({ command: 'mdc_control', payload: { action: 'network_standby_set', value: next ? 1 : 0 } });
                    }}
                    labelClassName="text-xs"
                  />
                </div>

                {/* Remote Control */}
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                    <Radio className="w-3 h-3" />Remote Ctrl
                  </span>
                  <ToggleSwitch
                    label={(optimisticRemoteCtrl !== null ? optimisticRemoteCtrl : device.mdcRemoteControl === 1) ? 'On' : 'Off'}
                    checked={optimisticRemoteCtrl !== null ? optimisticRemoteCtrl : device.mdcRemoteControl === 1}
                    onChange={() => {
                      const next = !(optimisticRemoteCtrl !== null ? optimisticRemoteCtrl : device.mdcRemoteControl === 1);
                      setOptimisticRemoteCtrl(next);
                      sendCmd({ command: 'mdc_control', payload: { action: 'remote_control_set', value: next ? 1 : 0 } });
                    }}
                    labelClassName="text-xs"
                  />
                </div>

                {/* Safety Lock */}
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                    <Lock className="w-3 h-3" />Safety Lock
                  </span>
                  <ToggleSwitch
                    label={(optimisticSafetyLock !== null ? optimisticSafetyLock : device.mdcSafetyLock === 1) ? 'On' : 'Off'}
                    checked={optimisticSafetyLock !== null ? optimisticSafetyLock : device.mdcSafetyLock === 1}
                    onChange={() => {
                      const next = !(optimisticSafetyLock !== null ? optimisticSafetyLock : device.mdcSafetyLock === 1);
                      setOptimisticSafetyLock(next);
                      sendCmd({ command: 'mdc_control', payload: { action: 'safety_lock_set', value: next ? 1 : 0 } });
                    }}
                    labelClassName="text-xs"
                  />
                </div>

              </div>

              {/* OSD + Orientation controls */}
              <div className="space-y-4 pt-3 border-t border-[var(--border)]">

                {/* OSD toggles — one per OSD type (bits 0–4) */}
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] mb-2">
                    <Monitor className="w-3 h-3" />OSD Notifications
                  </span>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                    {OSD_BIT_LABELS.map((label, i) => {
                      const bits = optimisticOsdBits !== null ? optimisticOsdBits : (device.mdcOsdStatus ?? 0);
                      const isOn = !!((bits >> i) & 1);
                      return (
                        <div key={label} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-xs text-[var(--text-muted)] shrink-0">{label}</span>
                          <ToggleSwitch
                            label={isOn ? 'On' : 'Off'}
                            checked={isOn}
                            onChange={() => {
                              const newBits = bits ^ (1 << i);
                              setOptimisticOsdBits(newBits);
                              sendCmd({ command: 'mdc_control', payload: { action: 'osd_display_set', osdType: i, osdOnOff: (newBits >> i) & 1 } });
                            }}
                            labelClassName="text-xs"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Orientation toggle — Landscape (0) ↔ Portrait 270° (3) */}
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                      <RotateCcw className="w-3 h-3" />Menu Orient.
                    </span>
                    <ToggleSwitch
                      label={(optimisticMenuOrientation !== null ? optimisticMenuOrientation : (device.mdcMenuOrientation ?? 0)) === 3 ? 'Portrait' : 'Landscape'}
                      checked={(optimisticMenuOrientation !== null ? optimisticMenuOrientation : (device.mdcMenuOrientation ?? 0)) === 3}
                      onChange={() => {
                        const next = (optimisticMenuOrientation !== null ? optimisticMenuOrientation : (device.mdcMenuOrientation ?? 0)) === 3 ? 0 : 3;
                        setOptimisticMenuOrientation(next);
                        sendCmd({ command: 'mdc_control', payload: { action: 'menu_orientation_set', value: next } });
                      }}
                      labelClassName="text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] shrink-0">
                      <RotateCcw className="w-3 h-3" />Src Orient.
                    </span>
                    <ToggleSwitch
                      label={(optimisticSrcOrientation !== null ? optimisticSrcOrientation : (device.mdcSrcOrientation ?? 0)) === 3 ? 'Portrait' : 'Landscape'}
                      checked={(optimisticSrcOrientation !== null ? optimisticSrcOrientation : (device.mdcSrcOrientation ?? 0)) === 3}
                      onChange={() => {
                        const next = (optimisticSrcOrientation !== null ? optimisticSrcOrientation : (device.mdcSrcOrientation ?? 0)) === 3 ? 0 : 3;
                        setOptimisticSrcOrientation(next);
                        sendCmd({ command: 'mdc_control', payload: { action: 'src_orientation_set', value: next } });
                      }}
                      labelClassName="text-xs"
                    />
                  </div>
                </div>

              </div>

              {device.mdcLastPoll == null && isOnline && (
                <p className="text-xs text-[var(--text-muted)]">Waiting for first MDC poll (runs every 5 min while device is online).</p>
              )}

            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />NTP Server
              </label>
              <input value={ntpServer} onChange={(e) => setNtpServer(e.target.value)}
                placeholder="pool.ntp.org"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]" />
              {device.ntpEnabled != null && (
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  NTP{' '}<span className={device.ntpEnabled ? 'text-emerald-400' : 'text-[var(--text-muted)]'}>{device.ntpEnabled ? 'enabled' : 'disabled'}</span>
                  {device.clockDriftMs != null && <span> &middot; Drift: {device.clockDriftMs} ms</span>}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Timezone</label>
              <TimezoneCombobox
                value={watch('timezone') ?? ''}
                onChange={(v) => setValue('timezone', v, { shouldDirty: true })}
              />
              {resolvedTimezone && (
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  Detected on device: <span className="font-mono text-[var(--text)]">{resolvedTimezone}</span>
                  {resolvedTimezone !== watch('timezone') && (
                    <button type="button" onClick={() => setValue('timezone', resolvedTimezone, { shouldDirty: true })}
                      className="ml-2 text-blue-400 underline hover:text-blue-300">
                      Use this
                    </button>
                  )}
                </p>
              )}
            </div>

            {/* ── On/Off Timers ────────────────────────────────────────── */}
            <div className="sm:col-span-2 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
                  <AlarmClock className="w-3 h-3" />On/Off Timers
                </p>
                <span className="text-xs text-[var(--text-muted)]">Controls when the display wakes and sleeps &middot; 12-hr format</span>
              </div>

              {/* Timer selector pills */}
              <div className="flex gap-1.5 flex-wrap">
                {([1,2,3,4,5,6,7] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSelectedTimerSlot(n)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      selectedTimerSlot === n
                        ? 'bg-[var(--blue)] text-white'
                        : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Timer {n}
                  </button>
                ))}
              </div>

              {/* Active timer panel */}
              {((): React.ReactNode => {
                const slot = timerSlots[selectedTimerSlot] ?? DEFAULT_TIMER_SLOT;
                const update = (patch: Partial<TimerSlotState>) =>
                  setTimerSlots(prev => ({ ...prev, [selectedTimerSlot]: { ...(prev[selectedTimerSlot] ?? DEFAULT_TIMER_SLOT), ...patch } }));
                return (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">

                    {/* Repeat / Source / Volume */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-[var(--text-muted)]">Repeat</label>
                        <select
                          value={slot.repeat}
                          onChange={(e) => update({ repeat: Number(e.target.value), manualDays: 0 })}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                        >
                          {TIMER_REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-[var(--text-muted)]">Source</label>
                        <select
                          value={slot.source}
                          onChange={(e) => update({ source: Number(e.target.value) })}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                        >
                          {TIMER_SOURCES.map(s => <option key={s.byte} value={s.byte}>{s.label}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-[var(--text-muted)]">Volume</label>
                        <input
                          type="number" min={0} max={100}
                          value={slot.volume}
                          onChange={(e) => update({ volume: Math.max(0, Math.min(100, Number(e.target.value))) })}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--text)] text-sm font-mono focus:outline-none focus:border-[var(--blue)]"
                        />
                      </div>
                    </div>

                    {/* Custom day checkboxes */}
                    {slot.repeat === 5 && (
                      <div className="flex flex-wrap gap-1.5">
                        {WEEK_DAYS.map((day, i) => {
                          const active = !!((slot.manualDays >> i) & 1);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => update({ manualDays: slot.manualDays ^ (1 << i) })}
                              className={`w-11 h-8 rounded-md text-xs font-medium border transition-colors ${
                                active
                                  ? 'bg-[var(--blue)] border-[var(--blue)] text-white'
                                  : 'bg-[var(--card)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Wake / Sleep time cards */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Wake On */}
                      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />Wake
                          </span>
                          <ToggleSwitch
                            label={slot.onEnable ? 'On' : 'Off'}
                            checked={slot.onEnable}
                            onChange={() => update({ onEnable: !slot.onEnable })}
                            labelClassName="text-xs"
                          />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="block text-[11px] text-[var(--text-muted)]">Hour</label>
                            <select
                              value={slot.onHour}
                              onChange={(e) => update({ onHour: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                            >
                              {Array.from({length: 13}, (_, h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="block text-[11px] text-[var(--text-muted)]">Minute</label>
                            <select
                              value={slot.onMin}
                              onChange={(e) => update({ onMin: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                            >
                              {Array.from({length: 12}, (_, i) => i * 5).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Sleep Off */}
                      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />Sleep
                          </span>
                          <ToggleSwitch
                            label={slot.offEnable ? 'On' : 'Off'}
                            checked={slot.offEnable}
                            onChange={() => update({ offEnable: !slot.offEnable })}
                            labelClassName="text-xs"
                          />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="block text-[11px] text-[var(--text-muted)]">Hour</label>
                            <select
                              value={slot.offHour}
                              onChange={(e) => update({ offHour: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                            >
                              {Array.from({length: 13}, (_, h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="block text-[11px] text-[var(--text-muted)]">Minute</label>
                            <select
                              value={slot.offMin}
                              onChange={(e) => update({ offMin: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--blue)]"
                            >
                              {Array.from({length: 12}, (_, i) => i * 5).map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[var(--border)]">
                      <ActionButton
                        type="button"
                        disabled={!isOnline || slot.busy}
                        onClick={async () => {
                          update({ busy: true });
                          try {
                            const r = await api.post(`/devices/${deviceId}/mdc-control`, { action: 'on_timer_get', slot: selectedTimerSlot }) as Record<string,unknown>;
                            if (r['ok']) {
                              update({
                                onHour: Number(r['onHour'] ?? 0), onMin: Number(r['onMin'] ?? 0), onEnable: !!r['onEnable'],
                                offHour: Number(r['offHour'] ?? 0), offMin: Number(r['offMin'] ?? 0), offEnable: !!r['offEnable'],
                                repeat: Number(r['repeat'] ?? 1), volume: Number(r['volume'] ?? 20), source: Number(r['source'] ?? 0x01),
                                manualDays: Number(r['manualDays'] ?? 0),
                              });
                              toast.success(`Timer ${selectedTimerSlot} loaded from display`);
                            } else {
                              toast.error(String(r['error'] ?? `Timer ${selectedTimerSlot} read failed`));
                            }
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Read failed');
                          } finally {
                            update({ busy: false });
                          }
                        }}
                      >
                        <ArrowDown className="w-3 h-3" />Read from display
                      </ActionButton>
                      <ActionButton
                        type="button"
                        tone="primary"
                        disabled={!isOnline || slot.busy}
                        onClick={async () => {
                          update({ busy: true });
                          try {
                            const r = await api.post(`/devices/${deviceId}/mdc-control`, {
                              action: 'on_timer_set', slot: selectedTimerSlot,
                              onHour: slot.onHour, onMin: slot.onMin, onEnable: slot.onEnable,
                              offHour: slot.offHour, offMin: slot.offMin, offEnable: slot.offEnable,
                              repeat: slot.repeat, volume: slot.volume, source: slot.source,
                              ...(slot.repeat === 5 ? { manualDays: slot.manualDays } : {}),
                            }) as Record<string,unknown>;
                            if (r['ok']) {
                              toast.success(`Timer ${selectedTimerSlot} saved to display`);
                            } else {
                              toast.error(String(r['error'] ?? 'Save failed'));
                            }
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Save failed');
                          } finally {
                            update({ busy: false });
                          }
                        }}
                      >
                        <ArrowUp className="w-3 h-3" />Save to display
                      </ActionButton>
                      <ActionButton
                        type="button"
                        tone="danger"
                        disabled={!isOnline || slot.busy}
                        onClick={async () => {
                          update({ busy: true });
                          try {
                            const r = await api.post(`/devices/${deviceId}/mdc-control`, {
                              action: 'on_timer_set', slot: selectedTimerSlot,
                              onHour: slot.onHour, onMin: slot.onMin, onEnable: false,
                              offHour: slot.offHour, offMin: slot.offMin, offEnable: false,
                              repeat: slot.repeat, volume: slot.volume, source: slot.source,
                            }) as Record<string,unknown>;
                            if (r['ok']) {
                              update({ onEnable: false, offEnable: false });
                              toast.success(`Timer ${selectedTimerSlot} disabled`);
                            } else {
                              toast.error(String(r['error'] ?? 'Disable failed'));
                            }
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Disable failed');
                          } finally {
                            update({ busy: false });
                          }
                        }}
                      >
                        Disable Timer {selectedTimerSlot}
                      </ActionButton>
                    </div>

                  </div>
                );
              })()}
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

            {/* Player App */}
            <div className="sm:col-span-2 h-px bg-[var(--border)]" />
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Download className="w-3 h-3" />Player App
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-[var(--text-muted)]">Installed:</span>
                <span className="font-mono text-xs text-[var(--text)]">{device.playerVersion ? `v${device.playerVersion}` : '—'}</span>
                {latestRelease && device.playerVersion && latestRelease.version !== device.playerVersion && (
                  <>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      Update available: v{latestRelease.version}
                    </span>
                    <ActionButton
                      type="button"
                      onClick={() => sendCmd({ command: 'update_player', payload: { version: latestRelease.version, downloadUrl: latestRelease.downloadUrl } })}
                      disabled={cmdDisabled}
                      tone="primary" className="px-3 py-1 text-xs shrink-0"
                    >Apply Update</ActionButton>
                  </>
                )}
                {latestRelease && device.playerVersion === latestRelease.version && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                    Up to date
                  </span>
                )}
              </div>
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

      {/* ── #24 Device Logs ──────────────────────────────────────────────── */}
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
            <Badge tone="accent">{filteredLogs.length}{logFilter !== 'all' ? ` / ${logs.length}` : ''} lines</Badge>
            <span className="text-sm text-[var(--text-muted)]">Use Dump Logs to ask the device to flush the recent local ring buffer.</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Level filter */}
            {(['all', 'debug', 'info', 'warn', 'error'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setLogFilter(level)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  logFilter === level
                    ? level === 'error'  ? 'bg-red-500/20 border-red-500 text-red-400'
                    : level === 'warn'   ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : level === 'info'   ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                    : level === 'debug'  ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                    : 'bg-[var(--surface-raised)] border-[var(--border-strong)] text-[var(--text)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
                }`}
              >
                {level.toUpperCase()}
              </button>
            ))}

            {/* Auto-scroll toggle */}
            <button
              onClick={() => setAutoScroll((v) => !v)}
              className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                autoScroll
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'
              }`}
            >
              Auto-scroll {autoScroll ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={downloadLogs} disabled={!filteredLogs.length}>
              <Download className="w-4 h-4" /> Download
            </ActionButton>
            <ActionButton disabled={cmdDisabled} onClick={() => sendCmd({ command: 'dump_logs' })}>
              <FileText className="w-4 h-4" /> Request Log Dump
            </ActionButton>
            <ActionButton tone="danger" onClick={() => clearLogs.mutate()} disabled={!logs.length || clearLogs.isPending}>
              <Trash2 className="w-4 h-4" /> Clear
            </ActionButton>
          </div>

          <textarea
            ref={logAreaRef}
            value={logText}
            readOnly
            onScroll={handleLogScroll}
            className="min-h-[420px] w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs leading-6 text-[var(--text)]"
            placeholder="No remote logs received yet. If the device is online, send Dump Logs first."
          />
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
                  <img src={`/api/devices/${device.id}/screenshots/${s.id}`} alt={`Screenshot ${s.takenAt}`}
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

      {liveViewOpen && deviceId && (
        <LiveViewOverlay
          deviceId={deviceId}
          isOnline={isOnline}
          onClose={() => setLiveViewOpen(false)}
          onPowerChange={setOptimisticPowerState}
        />
      )}
    </div>
  );
}
