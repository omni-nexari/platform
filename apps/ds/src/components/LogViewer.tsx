import { useState, useCallback, useEffect, useRef } from 'react';
import { Download, RefreshCw, Trash2, ChevronDown, Filter, Radio, RadioTower } from 'lucide-react';
import { saApi } from '../lib/superadmin-auth.js';
import { PageHeader, SectionCard, SectionCardBody, SectionCardHeader, Badge, Skeleton } from './UiPrimitives.js';

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
}

export interface LogViewerProps {
  /** API path for the log query endpoint (e.g. '/superadmin/logs' or '/management/logs') */
  apiPath: string;
  /** Whether to show the org_id filter (superadmin only) */
  showOrgFilter?: boolean;
  /** Whether to show the purge button (platform owner only) */
  showPurge?: boolean;
  title?: string;
  subtitle?: string;
}

// ── Level styling ──────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  info:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warn:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const SOURCE_LABELS: Record<string, string> = {
  api:        'API',
  ds:         'Dashboard',
  tizen:      'Tizen',
  'tizen-sbb': 'Tizen SBB',
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

// ── Main component ─────────────────────────────────────────────────────────

export default function LogViewer({
  apiPath,
  showOrgFilter = false,
  showPurge = false,
  title = 'Logs',
  subtitle,
}: LogViewerProps) {
  // Filters
  const [source,   setSource]   = useState('');
  const [minLevel, setMinLevel] = useState('info');
  const [orgId,    setOrgId]    = useState('');
  const [deviceId, setDeviceId] = useState('');

  // Results
  const [entries,    setEntries]    = useState<LogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Expanded row
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Purge dialog
  const [purging, setPurging] = useState(false);

  // Live tail
  const [tailing,     setTailing]     = useState(false);
  const [tailStatus,  setTailStatus]  = useState<'connecting' | 'open' | 'closed'>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

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
    setLoading(true);
    setError(null);
    try {
      const data = await saApi.get<{ entries: LogEntry[]; nextCursor: number | null }>(
        `${apiPath}?${buildParams(beforeId)}`,
      );
      if (beforeId) {
        setEntries((prev) => [...prev, ...data.entries]);
      } else {
        setEntries(data.entries);
      }
      setNextCursor(data.nextCursor);
      setLoaded(true);
    } catch {
      setError('Failed to load logs. Check your connection or permissions.');
    } finally {
      setLoading(false);
    }
  }, [apiPath, buildParams]);

  const handleLoad = () => void fetchLogs();
  const handleLoadMore = () => { if (nextCursor) void fetchLogs(nextCursor); };

  // ── Live tail ────────────────────────────────────────────────────────────

  const stopTail = useCallback(() => {
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setTailing(false);
    setTailStatus('closed');
  }, []);

  const startTail = useCallback(() => {
    stopTail();

    const params = new URLSearchParams();
    if (source)   params.set('source',    source);
    if (minLevel) params.set('min_level', minLevel);
    if (orgId)    params.set('org_id',    orgId);
    if (deviceId) params.set('device_id', deviceId);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tailPath = apiPath.replace(/^\/superadmin\/logs$/, '/logs/tail')
                            .replace(/^\/management\/logs$/, '/logs/tail');
    const url = `${proto}//${window.location.host}/api/v1${tailPath}?${params.toString()}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setTailing(true);
    setTailStatus('connecting');

    ws.onopen = () => {
      setTailStatus('open');
      // Heartbeat every 25 s to keep the connection alive through proxies
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as { type: string; data?: LogEntry };
        if (frame.type === 'entry' && frame.data) {
          setEntries((prev) => [frame.data!, ...prev].slice(0, 2_000));
          setLoaded(true);
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => setTailStatus('closed');
    ws.onclose = () => {
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      setTailing(false);
      setTailStatus('closed');
    };
  }, [apiPath, source, minLevel, orgId, deviceId, stopTail]);

  // Clean up WS on unmount
  useEffect(() => () => stopTail(), [stopTail]);

  // ── CSV export ───────────────────────────────────────────────────────────

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

  // ── Purge ────────────────────────────────────────────────────────────────

  const handlePurge = async () => {
    if (!window.confirm('Purge ALL log entries? This cannot be undone.')) return;
    setPurging(true);
    try {
      const data = await saApi.post<{ deleted: number }>('/logs/purge', {});
      setEntries([]);
      setNextCursor(null);
      alert(`Purged ${data.deleted} log entries.`);
    } catch {
      alert('Purge failed.');
    } finally {
      setPurging(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={title} subtitle={subtitle} />

      {/* Filters */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter size={14} />
            Filters
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-wrap gap-3 items-end">
            {/* Source */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="">All sources</option>
                <option value="api">API</option>
                <option value="ds">Dashboard</option>
                <option value="tizen">Tizen</option>
                <option value="tizen-sbb">Tizen SBB</option>
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
                <option value="debug">Debug+</option>
                <option value="info">Info+</option>
                <option value="warn">Warn+</option>
                <option value="error">Error only</option>
              </select>
            </div>

            {/* Org filter (superadmin only) */}
            {showOrgFilter && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Org ID</label>
                <input
                  type="text"
                  placeholder="uuid..."
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm w-60"
                />
              </div>
            )}

            {/* Device filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Device ID</label>
              <input
                type="text"
                placeholder="uuid..."
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-sm w-60"
              />
            </div>

            {/* Load button */}
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading || tailing}
              className="ml-auto flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loaded ? 'Refresh' : 'Load Logs'}
            </button>

            {/* Live tail toggle */}
            <button
              type="button"
              onClick={tailing ? stopTail : startTail}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border transition-colors ${
                tailing
                  ? 'bg-green-600 border-green-600 text-white'
                  : 'border-[var(--card-border)] text-[var(--text)]'
              }`}
              title={tailing ? 'Stop live tail' : 'Start live tail'}
            >
              {tailing ? <RadioTower size={14} className="animate-pulse" /> : <Radio size={14} />}
              {tailing ? (tailStatus === 'connecting' ? 'Connecting…' : 'Live') : 'Live Tail'}
            </button>

            {/* Export */}
            {entries.length > 0 && (
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium"
              >
                <Download size={14} />
                Export CSV
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
                <Trash2 size={14} />
                Purge All
              </button>
            )}
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* Results */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loaded && !loading && (
        <div className="text-sm text-[var(--text-muted)] text-center py-8">
          Set your filters and click <strong>Load Logs</strong> to fetch entries.
        </div>
      )}

      {loading && !entries.length && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      )}

      {loaded && entries.length === 0 && !loading && (
        <div className="text-sm text-[var(--text-muted)] text-center py-8">
          No log entries match the current filters.
        </div>
      )}

      {entries.length > 0 && (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-[var(--text-muted)] uppercase tracking-wide" style={{ borderColor: 'var(--card-border)' }}>
                  <th className="py-2 px-3 w-32">Time</th>
                  <th className="py-2 px-3 w-20">Level</th>
                  <th className="py-2 px-3 w-24">Source</th>
                  <th className="py-2 px-3">Message</th>
                  <th className="py-2 px-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isExpanded = expanded.has(entry.id);
                  const hasMeta = entry.meta && Object.keys(entry.meta).length > 0;
                  return (
                    <>
                      <tr
                        key={entry.id}
                        className="border-b hover:bg-[var(--bg2)] transition-colors cursor-pointer"
                        style={{ borderColor: 'var(--card-border)' }}
                        onClick={() => hasMeta && toggleExpand(entry.id)}
                      >
                        <td className="py-2 px-3 text-[var(--text-muted)] whitespace-nowrap text-xs">
                          {formatTs(entry.createdAt)}
                        </td>
                        <td className="py-2 px-3">
                          <LevelBadge level={entry.level} />
                        </td>
                        <td className="py-2 px-3 text-xs text-[var(--text-muted)]">
                          {SOURCE_LABELS[entry.source] ?? entry.source}
                        </td>
                        <td className="py-2 px-3 font-mono text-xs break-all max-w-[40vw]">
                          {entry.message}
                        </td>
                        <td className="py-2 px-3">
                          {hasMeta && (
                            <ChevronDown
                              size={14}
                              className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasMeta && (
                        <tr key={`${entry.id}-meta`} className="border-b bg-[var(--bg2)]" style={{ borderColor: 'var(--card-border)' }}>
                          <td colSpan={5} className="px-4 py-3">
                            <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap break-all">
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
