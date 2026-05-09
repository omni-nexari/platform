import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Download, RefreshCw, Trash2, ChevronDown, Filter,
  Radio, RadioTower, X, BarChart2,
} from 'lucide-react';
import { saApi } from '../lib/superadmin-auth.js';
import { PageHeader, SectionCard, SectionCardBody, SectionCardHeader, Skeleton } from './UiPrimitives.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LogEntry {
  id:         number;
  source:     string;
  level:      string;
  message:    string;
  meta:       Record<string, unknown> | null;
  orgId:      string | null;
  deviceId:   string | null;
  userId:     string | null;
  appVersion: string | null;
  createdAt:  string;
  _isNew?:    boolean;
}

interface LogStats {
  total:    number;
  byLevel:  Record<string, number>;
  bySource: Record<string, number>;
  oldestAt: string | null;
  newestAt: string | null;
}

interface DeviceTimeline {
  deviceId: string;
  last24h: Array<{ hour: string; errors: number; warns: number; infos: number }>;
}

interface OrgOption    { id: string; name: string; }
interface DeviceOption { id: string; name: string; status: string; }

export interface LogViewerProps {
  apiPath:        string;
  showOrgFilter?: boolean;
  showPurge?:     boolean;
  title?:         string;
  subtitle?:      string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  info:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warn:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const SOURCE_LABELS: Record<string, string> = {
  api:    'API',
  ds:     'Dashboard',
  tizen:  'Tizen',
};

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${LEVEL_STYLES[level] ?? LEVEL_STYLES['info']}`}>
      {level}
    </span>
  );
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ── Searchable combobox ────────────────────────────────────────────────────

interface ComboOption { id: string; label: string; sub?: string; }

function Combobox({
  label, placeholder, options, value, displayValue,
  onSearch, onSelect, onClear, disabled, loading,
}: {
  label:        string;
  placeholder:  string;
  options:      ComboOption[];
  value:        string;
  displayValue: string;
  onSearch:     (q: string) => void;
  onSelect:     (id: string, label: string) => void;
  onClear:      () => void;
  disabled?:    boolean;
  loading?:     boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative flex flex-col gap-1" ref={ref}>
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5">
        <input
          type="text"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-[160px] flex-1 bg-transparent text-sm outline-none"
          onChange={(e) => { onSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {value ? (
          <button type="button" onClick={onClear} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <X size={12} />
          </button>
        ) : loading ? (
          <span className="text-xs text-[var(--text-muted)]">…</span>
        ) : null}
      </div>
      {open && options.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-60 w-72 overflow-y-auto rounded-lg border border-[var(--card-border)] bg-[var(--bg)] shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-[var(--bg2)]"
              onMouseDown={(e) => { e.preventDefault(); onSelect(opt.id, opt.label); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.sub && <span className="font-mono text-[10px] text-[var(--text-muted)]">{opt.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Device 24h timeline sparkline ──────────────────────────────────────────

function DeviceTimelineBar({ data }: { data: DeviceTimeline['last24h'] }) {
  if (data.length === 0) return null;
  const maxVal = Math.max(1, ...data.map((d) => d.errors + d.warns + d.infos));

  return (
    <div className="flex items-end gap-0.5" style={{ height: 40 }}>
      {data.map((d) => {
        const totalH = ((d.errors + d.warns + d.infos) / maxVal) * 40;
        const errH   = (d.errors / maxVal) * 40;
        const warnH  = (d.warns  / maxVal) * 40;
        const label  = new Date(d.hour).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return (
          <div
            key={d.hour}
            className="relative flex-1 flex flex-col justify-end overflow-hidden rounded-sm"
            style={{ height: 40 }}
            title={`${label} — errors: ${d.errors}, warns: ${d.warns}, info: ${d.infos}`}
          >
            <div style={{ height: Math.max(2, totalH) }} className="w-full flex flex-col justify-end">
              <div className="w-full bg-red-500"     style={{ height: errH  }} />
              <div className="w-full bg-yellow-400"  style={{ height: warnH }} />
              <div className="w-full bg-blue-400/50" style={{ height: Math.max(0, totalH - errH - warnH) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stats banner ───────────────────────────────────────────────────────────

function StatsBanner({ stats }: { stats: LogStats }) {
  const fmt = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
    : String(n);

  const items = [
    { label: 'Total',  value: fmt(stats.total),                   cls: 'text-[var(--text)]'       },
    { label: 'Errors', value: fmt(stats.byLevel['error']  ?? 0),  cls: 'text-red-600'             },
    { label: 'Warns',  value: fmt(stats.byLevel['warn']   ?? 0),  cls: 'text-yellow-600'          },
    { label: 'Tizen',  value: fmt(stats.bySource['tizen'] ?? 0),  cls: 'text-[var(--text-muted)]' },
    { label: 'API',    value: fmt(stats.bySource['api']   ?? 0),  cls: 'text-[var(--text-muted)]' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-[var(--card-border)] bg-[var(--bg2)] px-4 py-2.5 text-sm">
      <BarChart2 size={14} className="shrink-0 text-[var(--text-muted)]" />
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-1.5">
          <span className={`font-semibold tabular-nums ${item.cls}`}>{item.value}</span>
          <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
        </span>
      ))}
      {stats.oldestAt && (
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          oldest: {new Date(stats.oldestAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function LogViewer({
  apiPath,
  showOrgFilter = false,
  showPurge     = false,
  title         = 'Logs',
  subtitle,
}: LogViewerProps) {
  // ── Filters ───────────────────────────────────────────────────────────────
  const [source,   setSource]   = useState('');
  const [minLevel, setMinLevel] = useState('info');
  const [orgId,    setOrgId]    = useState('');
  const [deviceId, setDeviceId] = useState('');

  // API and Dashboard logs are server/frontend only — no device context applies
  const showDeviceFilters = source !== 'api' && source !== 'ds';

  // ── Org combobox ──────────────────────────────────────────────────────────
  const [orgOptions,  setOrgOptions]  = useState<OrgOption[]>([]);
  const [orgSearch,   setOrgSearch]   = useState('');
  const [orgLabel,    setOrgLabel]    = useState('');
  const [orgsLoading, setOrgsLoading] = useState(false);

  // ── Device combobox ───────────────────────────────────────────────────────
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [deviceSearch,  setDeviceSearch]  = useState('');
  const [deviceLabel,   setDeviceLabel]   = useState('');
  const [devsLoading,   setDevsLoading]   = useState(false);

  // ── Log results ───────────────────────────────────────────────────────────
  const [entries,    setEntries]    = useState<LogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());
  const [purging,    setPurging]    = useState(false);

  // ── Stats + device timeline ───────────────────────────────────────────────
  const [stats,          setStats]          = useState<LogStats | null>(null);
  const [deviceTimeline, setDeviceTimeline] = useState<DeviceTimeline | null>(null);

  // ── Live tail ─────────────────────────────────────────────────────────────
  const [tailing,    setTailing]    = useState(false);
  const [tailStatus, setTailStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const wsRef   = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load org list once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showOrgFilter) return;
    setOrgsLoading(true);
    void saApi.get<OrgOption[]>('/superadmin/orgs')
      .then(setOrgOptions)
      .catch(() => {})
      .finally(() => setOrgsLoading(false));
  }, [showOrgFilter]);

  // ── Load stats on mount ───────────────────────────────────────────────────
  useEffect(() => {
    void saApi.get<LogStats>('/logs/stats').then(setStats).catch(() => {});
  }, []);

  // ── Load devices when org changes ─────────────────────────────────────────
  useEffect(() => {
    if (!orgId) { setDeviceOptions([]); return; }
    setDevsLoading(true);
    void saApi.get<DeviceOption[]>(`/superadmin/orgs/${orgId}/devices`)
      .then(setDeviceOptions)
      .catch(() => setDeviceOptions([]))
      .finally(() => setDevsLoading(false));
  }, [orgId]);

  // ── Load device timeline when deviceId changes ────────────────────────────
  useEffect(() => {
    if (!deviceId) { setDeviceTimeline(null); return; }
    void saApi.get<DeviceTimeline>(`/logs/device-timeline?device_id=${deviceId}`)
      .then(setDeviceTimeline)
      .catch(() => {});
  }, [deviceId]);

  // ── Filtered combobox options ─────────────────────────────────────────────
  const filteredOrgs = useMemo(() =>
    orgSearch
      ? orgOptions.filter((o) =>
          o.name.toLowerCase().includes(orgSearch.toLowerCase()) || o.id.startsWith(orgSearch),
        )
      : orgOptions.slice(0, 20),
    [orgSearch, orgOptions],
  );

  const filteredDevices = useMemo(() =>
    deviceSearch
      ? deviceOptions.filter((d) =>
          d.name.toLowerCase().includes(deviceSearch.toLowerCase()) || d.id.startsWith(deviceSearch),
        )
      : deviceOptions.slice(0, 20),
    [deviceSearch, deviceOptions],
  );

  // ── Cascading clears ──────────────────────────────────────────────────────
  function clearOrg() {
    setOrgId(''); setOrgSearch(''); setOrgLabel('');
    setDeviceId(''); setDeviceSearch(''); setDeviceLabel('');
    setDeviceTimeline(null);
  }
  function clearDevice() {
    setDeviceId(''); setDeviceSearch(''); setDeviceLabel('');
    setDeviceTimeline(null);
  }
  function handleSourceChange(newSource: string) {
    setSource(newSource);
    if (newSource === 'api' || newSource === 'ds') clearOrg();
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const buildParams = useCallback((beforeId?: number) => {
    const p = new URLSearchParams();
    if (source)   p.set('source',    source);
    if (minLevel) p.set('min_level', minLevel);
    if (orgId)    p.set('org_id',    orgId);
    if (deviceId) p.set('device_id', deviceId);
    if (beforeId) p.set('before_id', String(beforeId));
    p.set('limit', '100');
    return p.toString();
  }, [source, minLevel, orgId, deviceId]);

  const fetchLogs = useCallback(async (beforeId?: number) => {
    setLoading(true); setError(null);
    try {
      const data = await saApi.get<{ entries: LogEntry[]; nextCursor: number | null }>(
        `${apiPath}?${buildParams(beforeId)}`,
      );
      setEntries((prev) => beforeId ? [...prev, ...data.entries] : data.entries);
      setNextCursor(data.nextCursor);
      setLoaded(true);
    } catch {
      setError('Failed to load logs. Check your connection or permissions.');
    } finally {
      setLoading(false);
    }
  }, [apiPath, buildParams]);

  const handleLoad     = () => { void fetchLogs(); };
  const handleLoadMore = () => { if (nextCursor) void fetchLogs(nextCursor); };

  // Auto-reload when filters change (only if logs were already loaded)
  const loadedRef = useRef(false);
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => {
    if (loadedRef.current && !tailing) void fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, minLevel, orgId, deviceId]);

  // ── Live tail ────────────────────────────────────────────────────────────

  const stopTail = useCallback(() => {
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
    if (wsRef.current)   { wsRef.current.close(); wsRef.current = null; }
    setTailing(false); setTailStatus('closed');
  }, []);

  const startTail = useCallback(async () => {
    stopTail();
    // Show connecting state immediately so the button reflects the pending state.
    setTailing(true); setTailStatus('connecting');

    const params = new URLSearchParams();
    if (source)   params.set('source',    source);
    if (minLevel) params.set('min_level', minLevel);
    if (orgId)    params.set('org_id',    orgId);
    if (deviceId) params.set('device_id', deviceId);

    // Fetch a short-lived WS auth token via a normal credentialed HTTP request.
    // The browser sends httpOnly cookies for fetch() but NOT reliably for WebSocket
    // (Secure cookies are blocked over ws://, and @fastify/websocket v11 may skip
    // the cookie-parsing lifecycle hook before calling the handler).
    try {
      const wsTokenPath = apiPath.replace(/\/logs$/, '/logs/ws-token');
      const { token } = await saApi.get<{ token: string | null }>(wsTokenPath);
      if (token) params.set('token', token);
    } catch { /* fall through — WS handler will close with 4001 */ }

    const proto    = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tailPath = apiPath.replace(/\/logs$/, '/logs/tail');
    const ws = new WebSocket(`${proto}//${window.location.host}/api/v1${tailPath}?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setTailStatus('open');
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as { type: string; data?: LogEntry };
        if (frame.type === 'entry' && frame.data) {
          const newEntry: LogEntry = { ...frame.data, _isNew: true };
          setEntries((prev) => [newEntry, ...prev].slice(0, 2_000));
          setLoaded(true);
          setTimeout(() => {
            setEntries((prev) =>
              prev.map((e) => (e.id === newEntry.id ? { ...e, _isNew: false } : e)),
            );
          }, 2_000);
        }
      } catch { /* ignore */ }
    };

    ws.onerror  = () => setTailStatus('closed');
    ws.onclose  = () => {
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      setTailing(false); setTailStatus('closed');
    };
  }, [apiPath, source, minLevel, orgId, deviceId, stopTail]);

  useEffect(() => () => stopTail(), [stopTail]);

  // ── CSV export ────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (entries.length === 0) return;
    const header = 'id,source,level,message,org_id,device_id,created_at\n';
    const rows = entries.map((e) =>
      [e.id, e.source, e.level, `"${e.message.replace(/"/g, '""')}"`, e.orgId ?? '', e.deviceId ?? '', e.createdAt].join(','),
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Purge ─────────────────────────────────────────────────────────────────

  const handlePurge = async () => {
    if (!window.confirm('Purge ALL log entries? This cannot be undone.')) return;
    setPurging(true);
    try {
      const data = await saApi.post<{ deleted: number }>('/logs/purge', {});
      setEntries([]); setNextCursor(null); setStats(null);
      alert(`Purged ${data.deleted} log entries.`);
    } catch {
      alert('Purge failed.');
    } finally {
      setPurging(false);
    }
  };

  // ── Level counts from loaded entries ─────────────────────────────────────
  const levelCounts = useMemo(
    () => entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.level] = (acc[e.level] ?? 0) + 1; return acc;
    }, {}),
    [entries],
  );

  // ── Active filter chips ───────────────────────────────────────────────────
  const chips = [
    ...(source                  ? [{ key: 'source', label: `Source: ${SOURCE_LABELS[source] ?? source}`, onRemove: () => setSource('')  }] : []),
    ...(orgId    && orgLabel    ? [{ key: 'org',    label: `Org: ${orgLabel}`,       onRemove: clearOrg    }] : []),
    ...(deviceId && deviceLabel ? [{ key: 'device', label: `Device: ${deviceLabel}`, onRemove: clearDevice }] : []),
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={title} subtitle={subtitle} />

      {/* Stats banner */}
      {stats && stats.total > 0 && <StatsBanner stats={stats} />}

      {/* Filters */}
      <SectionCard style={{ overflow: 'visible' }}>
        <SectionCardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter size={14} /> Filters
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-wrap gap-3 items-end">

            {/* Source */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Source</label>
              <select
                value={source}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="">All sources</option>
                <option value="api">API</option>
                <option value="ds">Dashboard</option>
                <option value="tizen">Tizen</option>
              </select>
            </div>

            {/* Min level */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Min level</label>
              <select
                value={minLevel}
                onChange={(e) => setMinLevel(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="">All levels</option>
                <option value="debug">Debug+</option>
                <option value="info">Info+</option>
                <option value="warn">Warn+</option>
                <option value="error">Error only</option>
              </select>
            </div>

            {/* Org + Device filters — hidden for server/frontend-only sources */}
            {showOrgFilter && showDeviceFilters && (
              <Combobox
                label="Organization"
                placeholder="Search by name…"
                options={filteredOrgs.map((o) => ({ id: o.id, label: o.name, sub: o.id.slice(0, 8) + '…' }))}
                value={orgId}
                displayValue={orgSearch}
                onSearch={(q) => setOrgSearch(q)}
                onSelect={(id, lbl) => { setOrgId(id); setOrgSearch(lbl); setOrgLabel(lbl); clearDevice(); }}
                onClear={clearOrg}
                loading={orgsLoading}
              />
            )}

            {showDeviceFilters && orgId && deviceOptions.length > 0 && (
              <Combobox
                label="Device"
                placeholder="Search device…"
                options={filteredDevices.map((d) => ({ id: d.id, label: d.name, sub: `${d.status} · ${d.id.slice(0, 8)}…` }))}
                value={deviceId}
                displayValue={deviceSearch}
                onSearch={(q) => setDeviceSearch(q)}
                onSelect={(id, lbl) => { setDeviceId(id); setDeviceSearch(lbl); setDeviceLabel(lbl); }}
                onClear={clearDevice}
                loading={devsLoading}
              />
            )}

            {/* Load / Refresh */}
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading || tailing}
              className="ml-auto flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loaded ? 'Refresh' : 'Load Logs'}
            </button>

            {/* Live tail */}
            <button
              type="button"
              onClick={tailing ? stopTail : startTail}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                tailing
                  ? 'border-green-600 bg-green-600 text-white'
                  : 'border-[var(--card-border)] text-[var(--text)]'
              }`}
              title={tailing ? 'Stop live tail' : 'Stream new entries in real time using current filters'}
            >
              {tailing ? <RadioTower size={14} className="animate-pulse" /> : <Radio size={14} />}
              {tailing ? (tailStatus === 'connecting' ? 'Connecting…' : 'Live') : 'Live Tail'}
            </button>

            {/* Export CSV */}
            {entries.length > 0 && (
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium"
              >
                <Download size={14} /> Export CSV
              </button>
            )}

            {/* Purge */}
            {showPurge && (
              <button
                type="button"
                onClick={() => void handlePurge()}
                disabled={purging}
                className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 disabled:opacity-60"
              >
                <Trash2 size={14} /> Purge All
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--card-border)' }}>
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                  {c.label}
                  <button type="button" onClick={c.onRemove} className="hover:opacity-70"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Device 24h error timeline */}
      {deviceId && deviceTimeline && deviceTimeline.last24h.length > 0 && (
        <SectionCard style={{ overflow: 'visible' }}>
          <SectionCardHeader>
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {deviceLabel || deviceId.slice(0, 8)} — activity last 24 h
            </span>
          </SectionCardHeader>
          <SectionCardBody>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <DeviceTimelineBar data={deviceTimeline.last24h} />
              </div>
              <div className="flex flex-col gap-1 text-[10px] shrink-0 text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500" />Error</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-yellow-400" />Warn</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-400/50" />Info</span>
              </div>
            </div>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* Level summary strip */}
      {loaded && entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[var(--text-muted)]">{entries.length}{nextCursor ? '+' : ''} entries</span>
          {(['error', 'warn', 'info', 'debug'] as const).map((lvl) =>
            levelCounts[lvl] ? (
              <button
                key={lvl}
                type="button"
                title={`Show ${lvl}+ only`}
                onClick={() => { setMinLevel(lvl); void fetchLogs(); }}
                className="inline-flex items-center gap-1"
              >
                <LevelBadge level={lvl} />
                <span className="text-[var(--text-muted)]">{levelCounts[lvl]}</span>
              </button>
            ) : null,
          )}
          {tailing && (
            <span className="inline-flex animate-pulse items-center gap-1.5 text-xs font-medium text-green-600">
              <RadioTower size={12} /> Live
            </span>
          )}
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {!loaded && !loading && (
        <div className="py-8 text-center text-sm text-[var(--text-muted)]">
          Set your filters and click <strong>Load Logs</strong> to fetch entries.
        </div>
      )}
      {loading && !entries.length && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      )}
      {loaded && entries.length === 0 && !loading && (
        <div className="py-8 text-center text-sm text-[var(--text-muted)]">
          No log entries match the current filters.
        </div>
      )}

      {/* Log table */}
      {entries.length > 0 && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-muted)]"
                  style={{ borderColor: 'var(--card-border)' }}
                >
                  <th className="w-32 px-3 py-2">Time</th>
                  <th className="w-20 px-3 py-2">Level</th>
                  <th className="w-24 px-3 py-2">Source</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isExpanded = expanded.has(entry.id);
                  const hasMeta    = entry.meta && Object.keys(entry.meta).length > 0;
                  return (
                    <>
                      <tr
                        key={entry.id}
                        className={`cursor-pointer border-b transition-colors hover:bg-[var(--bg2)] ${
                          entry._isNew ? 'log-row-flash' : ''
                        }`}
                        style={{ borderColor: 'var(--card-border)' }}
                        onClick={() => hasMeta && toggleExpand(entry.id)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--text-muted)]">
                          {formatTs(entry.createdAt)}
                        </td>
                        <td className="px-3 py-2"><LevelBadge level={entry.level} /></td>
                        <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                          {SOURCE_LABELS[entry.source] ?? entry.source}
                        </td>
                        <td className="max-w-[40vw] break-all px-3 py-2 font-mono text-xs">
                          {entry.message}
                        </td>
                        <td className="px-3 py-2">
                          {hasMeta && (
                            <ChevronDown
                              size={14}
                              className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasMeta && (
                        <tr
                          key={`${entry.id}-meta`}
                          className="border-b bg-[var(--bg2)]"
                          style={{ borderColor: 'var(--card-border)' }}
                        >
                          <td colSpan={5} className="px-4 py-3">
                            <pre className="whitespace-pre-wrap break-all text-xs text-[var(--text-muted)]">
                              {JSON.stringify(entry.meta, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor !== null && (
            <div className="flex justify-center border-t p-3" style={{ borderColor: 'var(--card-border)' }}>
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="text-sm text-[var(--accent)] disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
