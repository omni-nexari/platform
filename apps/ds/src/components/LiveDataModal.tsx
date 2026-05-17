import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Activity, Database, Link2, Search, Loader2, CheckCircle2, AlertCircle, Check } from 'lucide-react';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

// ── Sync (poll-based) ─────────────────────────────────────────────────────────
const REFRESH_OPTIONS = [
  { value: 60,    label: '1 minute' },
  { value: 300,   label: '5 minutes' },
  { value: 900,   label: '15 minutes' },
  { value: 1800,  label: '30 minutes' },
  { value: 3600,  label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '24 hours' },
];

type PreviewState = 'idle' | 'loading' | 'ok' | 'error';

interface PreviewData {
  fields: string[];
  sample: Record<string, unknown>[];
}

interface ColumnConfig {
  key: string;
  label: string;
  enabled: boolean;
}

// ── Stream (push-based) ───────────────────────────────────────────────────────
type ConnectionType = 'websocket' | 'mqtt' | 'webhook';

const CONNECTION_TYPES: { id: ConnectionType; label: string; description: string; placeholder: string }[] = [
  {
    id: 'websocket',
    label: 'WebSocket',
    description: 'Receive real-time push updates over a persistent WS connection',
    placeholder: 'wss://realtime.example.com/feed',
  },
  {
    id: 'mqtt',
    label: 'MQTT',
    description: 'Subscribe to topics on an MQTT broker for IoT & sensor data',
    placeholder: 'mqtt://broker.example.com:1883',
  },
  {
    id: 'webhook',
    label: 'Webhook',
    description: 'Receive incoming HTTP POST payloads from external services',
    placeholder: 'https://platform.example.com/webhook/my-hook',
  },
];

type Tab = 'sync' | 'stream';

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? '/api/v1';

export default function LiveDataModal({ workspaceId, onClose }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('sync');

  // ── Sync state ──────────────────────────────────────────────────────────────
  const [syncName, setSyncName]     = useState('');
  const [sourceUrl, setSourceUrl]   = useState('');
  const [dataPath, setDataPath]     = useState('');
  const [refresh, setRefresh]       = useState(300);
  const [title, setTitle]           = useState('');
  const [subtitle, setSubtitle]     = useState('');

  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData]   = useState<PreviewData | null>(null);
  const [columns, setColumns]           = useState<ColumnConfig[]>([]);
  const [labelField, setLabelField]     = useState('');

  const abortRef = useRef<AbortController | null>(null);

  // ── Stream state ────────────────────────────────────────────────────────────
  const [streamName, setStreamName] = useState('');
  const [connType, setConnType]     = useState<ConnectionType>('websocket');
  const [endpoint, setEndpoint]     = useState('');
  const [topic, setTopic]           = useState('');
  const selectedConn = CONNECTION_TYPES.find((c) => c.id === connType)!;

  // ── Derived ─────────────────────────────────────────────────────────────────
  const enabledColumns = columns.filter((c) => c.enabled);

  const canSaveSync =
    syncName.trim().length > 0 &&
    sourceUrl.trim().length > 0 &&
    previewState === 'ok' &&
    enabledColumns.length > 0;

  const canSaveStream = streamName.trim().length > 0 && endpoint.trim().length > 0;

  // ── Test URL ─────────────────────────────────────────────────────────────────
  const handleTestUrl = async () => {
    if (!sourceUrl.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setPreviewState('loading');
    setPreviewError('');
    setPreviewData(null);
    try {
      const params = new URLSearchParams({ workspaceId, sourceUrl: sourceUrl.trim() });
      if (dataPath.trim()) params.set('dataPath', dataPath.trim());
      const res = await fetch(`${API_BASE}/content/datasync/preview?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') ?? ''}` },
        signal: abortRef.current.signal,
      });
      const body = await res.json();
      if (!res.ok) { setPreviewState('error'); setPreviewError(body.error ?? 'Preview failed'); return; }
      const data: PreviewData = body;
      setPreviewData(data);
      const cols: ColumnConfig[] = data.fields.map((f) => ({
        key: f,
        label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        enabled: true,
      }));
      setColumns(cols);
      setLabelField(data.fields[0] ?? '');
      setPreviewState('ok');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setPreviewState('error');
      setPreviewError(err?.message ?? 'Network error');
    }
  };

  // ── Create mutation ──────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/content/datasync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') ?? ''}`,
        },
        body: JSON.stringify({
          workspaceId,
          name:           syncName.trim(),
          sourceUrl:      sourceUrl.trim(),
          dataPath:       dataPath.trim(),
          labelField,
          columns:        enabledColumns.map(({ key, label }) => ({ key, label })),
          title:          title.trim() || syncName.trim(),
          subtitle:       subtitle.trim(),
          refreshSeconds: refresh,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to create');
      return body as { id: string };
    },
    onSuccess: (item) => {
      toast.success('LiveData feed created');
      onClose();
      navigate(`?openId=${item.id}`, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-md flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="modal-header shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15">
              <Activity size={18} className="text-sky-400" />
            </div>
            <div>
              <h2 className="modal-title">New LiveData</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Connect live data feeds or real-time streams to your content</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-[var(--border)] px-4 gap-1">
          <button
            onClick={() => setTab('sync')}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'sync' ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Database size={14} /> Sync
            <span className="text-[10px] text-[var(--text-muted)] ml-0.5">JSON · REST</span>
          </button>
          <button
            onClick={() => setTab('stream')}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'stream' ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <Link2 size={14} /> Stream
            <span className="text-[10px] text-[var(--text-muted)] ml-0.5">WS · MQTT · Webhook</span>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body overflow-y-auto space-y-4">

          {/* ── Sync tab ── */}
          {tab === 'sync' && (
            <>
              {/* Name */}
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Name</span>
                <input
                  value={syncName}
                  onChange={(e) => setSyncName(e.target.value)}
                  placeholder="Product Prices Feed"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              {/* Source URL + Test */}
              <div>
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">JSON Source URL</span>
                <div className="mt-1 flex gap-2">
                  <input
                    value={sourceUrl}
                    onChange={(e) => { setSourceUrl(e.target.value); setPreviewState('idle'); setPreviewData(null); }}
                    placeholder="https://api.example.com/data.json"
                    type="url"
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleTestUrl}
                    disabled={!sourceUrl.trim() || previewState === 'loading'}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 transition-colors"
                  >
                    {previewState === 'loading'
                      ? <Loader2 size={14} className="animate-spin" />
                      : previewState === 'ok'
                        ? <CheckCircle2 size={14} className="text-green-400" />
                        : previewState === 'error'
                          ? <AlertCircle size={14} className="text-red-400" />
                          : <Search size={14} />}
                    Test
                  </button>
                </div>
                <input
                  value={dataPath}
                  onChange={(e) => { setDataPath(e.target.value); setPreviewState('idle'); setPreviewData(null); }}
                  placeholder="Optional: nested path to array  e.g.  data.rows"
                  className="mt-2 w-full px-3 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] font-mono"
                />
                {previewState === 'error' && <p className="mt-2 text-xs text-red-400">{previewError}</p>}
              </div>

              {/* Preview + column picker */}
              {previewState === 'ok' && previewData && (
                <>
                  {/* Sample table */}
                  <div>
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                      Preview — {previewData.fields.length} fields · {previewData.sample.length} row{previewData.sample.length !== 1 ? 's' : ''} shown
                    </span>
                    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--surface-raised)]">
                            {previewData.fields.map((f) => (
                              <th key={f} className="px-3 py-1.5 text-left text-[var(--text-muted)] font-medium whitespace-nowrap border-r border-[var(--border)] last:border-r-0">{f}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.sample.slice(0, 3).map((row, i) => (
                            <tr key={i} className="border-t border-[var(--border)]">
                              {previewData.fields.map((f) => (
                                <td key={f} className="px-3 py-1.5 text-[var(--text)] whitespace-nowrap border-r border-[var(--border)] last:border-r-0 max-w-[160px] truncate">{String(row[f] ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Row label field */}
                  <div>
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Row Label Field</span>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Field shown as the row identifier in the leftmost column.</p>
                    <select
                      value={labelField}
                      onChange={(e) => setLabelField(e.target.value)}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="">(none — use row number)</option>
                      {previewData.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>

                  {/* Column picker */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Columns to Display</span>
                      <div className="flex gap-2 text-xs">
                        <button type="button" onClick={() => setColumns((c) => c.map((col) => ({ ...col, enabled: true })))} className="text-[var(--accent)] hover:underline">All</button>
                        <button type="button" onClick={() => setColumns((c) => c.map((col) => ({ ...col, enabled: false })))} className="text-[var(--text-muted)] hover:text-[var(--text)]">None</button>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {columns.map((col) => (
                        <div key={col.key} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setColumns((cs) => cs.map((c) => c.key === col.key ? { ...c, enabled: !c.enabled } : c))}
                            className={`shrink-0 flex h-5 w-5 items-center justify-center rounded border transition-colors ${col.enabled ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border)] bg-[var(--surface-raised)]'}`}
                          >
                            {col.enabled && <Check size={12} className="text-white" />}
                          </button>
                          <code className="w-32 shrink-0 text-xs text-[var(--text-muted)] truncate">{col.key}</code>
                          <input
                            value={col.label}
                            onChange={(e) => setColumns((cs) => cs.map((c) => c.key === col.key ? { ...c, label: e.target.value } : c))}
                            disabled={!col.enabled}
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface-raised)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-40"
                            placeholder="Column label"
                          />
                        </div>
                      ))}
                    </div>
                    {enabledColumns.length === 0 && (
                      <p className="mt-2 text-xs text-amber-400">Select at least one column to display.</p>
                    )}
                  </div>

                  {/* Display title + subtitle */}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Display Title</span>
                      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={syncName || 'Table title'}
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Subtitle</span>
                      <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional subtitle"
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    </label>
                  </div>
                </>
              )}

              {/* Refresh interval */}
              {sourceUrl.trim() && (
                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Refresh Interval</span>
                  <select value={refresh} onChange={(e) => setRefresh(Number(e.target.value))}
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]">
                    {REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </>
          )}

          {/* ── Stream tab ── */}
          {tab === 'stream' && (
            <>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                <p className="text-xs text-amber-300 font-medium">Coming soon</p>
                <p className="text-xs text-amber-200/70 mt-0.5">Real-time stream connections (WebSocket, MQTT, Webhook) are under development.</p>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Name</span>
                <input value={streamName} onChange={(e) => setStreamName(e.target.value)} placeholder="Store Sensor Feed"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
              </label>

              <div>
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Connection Type</span>
                <div className="mt-2 space-y-2">
                  {CONNECTION_TYPES.map((c) => (
                    <button key={c.id} type="button" onClick={() => setConnType(c.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${connType === c.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'}`}>
                      <div className="text-sm font-semibold text-[var(--text)]">{c.label}</div>
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">{c.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                  {connType === 'webhook' ? 'Webhook URL' : connType === 'mqtt' ? 'Broker URL' : 'WebSocket URL'}
                </span>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={selectedConn.placeholder}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono" />
              </label>

              {(connType === 'mqtt' || connType === 'websocket') && (
                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                    {connType === 'mqtt' ? 'Topic' : 'Path / Channel'}
                  </span>
                  <input value={topic} onChange={(e) => setTopic(e.target.value)}
                    placeholder={connType === 'mqtt' ? 'store/sensor/#' : '/live/prices'}
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] font-mono" />
                </label>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        <div className="modal-footer shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            Cancel
          </button>
          {tab === 'sync' ? (
            <button
              type="button"
              onClick={() => createMut.mutate()}
              disabled={!canSaveSync || createMut.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {createMut.isPending && <Loader2 size={14} className="animate-spin" />}
              Save LiveData
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSaveStream}
              onClick={() => toast.info('Stream connections coming soon.')}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Save LiveData
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
