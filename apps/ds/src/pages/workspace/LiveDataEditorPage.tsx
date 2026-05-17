/**
 * LiveData wizard — configure a JSON REST data feed and save as a
 * `datasync` content item. The Tizen/Windows renderer polls the table
 * endpoint and renders the data as a styled schedule-board table.
 *
 * Steps:  1. Source (URL → Test → column picker)   2. Display (title / refresh / save)
 */
import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, Save, Activity,
  Search, Loader2, CheckCircle2, AlertCircle, Check,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { ActionButton, Badge, SectionCard, SectionCardBody, SectionCardHeader } from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ColumnConfig {
  key: string;
  label: string;
  enabled: boolean;
}

interface PreviewData {
  fields: string[];
  sample: Record<string, unknown>[];
}

type PreviewState = 'idle' | 'loading' | 'ok' | 'error';

const REFRESH_OPTIONS = [
  { value: 60,    label: '1 minute' },
  { value: 300,   label: '5 minutes' },
  { value: 900,   label: '15 minutes' },
  { value: 1800,  label: '30 minutes' },
  { value: 3600,  label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '24 hours' },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LiveDataEditorPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const stepNames = ['Source', 'Display'];

  // ── Source step state ─────────────────────────────────────────────────────
  const [name, setName]           = useState('LiveData Feed');
  const [sourceUrl, setSourceUrl] = useState('');
  const [dataPath, setDataPath]   = useState('');

  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData]   = useState<PreviewData | null>(null);
  const [columns, setColumns]           = useState<ColumnConfig[]>([]);
  const [labelField, setLabelField]     = useState('');

  const abortRef = useRef<AbortController | null>(null);

  // ── Display step state ────────────────────────────────────────────────────
  const [title, setTitle]       = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [refresh, setRefresh]   = useState(300);

  // ── Derived ──────────────────────────────────────────────────────────────
  const enabledColumns = columns.filter((c) => c.enabled);
  const canAdvance = previewState === 'ok' && enabledColumns.length > 0 && name.trim().length > 0;

  // ── Test URL ──────────────────────────────────────────────────────────────
  const handleTestUrl = async () => {
    if (!sourceUrl.trim() || !wsId) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setPreviewState('loading');
    setPreviewError('');
    setPreviewData(null);
    try {
      const params = new URLSearchParams({ workspaceId: wsId, sourceUrl: sourceUrl.trim() });
      if (dataPath.trim()) params.set('dataPath', dataPath.trim());
      const data = await api.get<PreviewData>(`/content/datasync/preview?${params}`);
      setPreviewData(data);
      const cols: ColumnConfig[] = data.fields.map((f) => ({
        key: f,
        label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        enabled: true,
      }));
      setColumns(cols);
      setLabelField(data.fields[0] ?? '');
      setPreviewState('ok');
      if (!title) setTitle(name.trim() || 'LiveData');
    } catch (err: unknown) {
      setPreviewState('error');
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
    }
  };

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/content/datasync', {
        workspaceId:    wsId,
        name:           name.trim(),
        sourceUrl:      sourceUrl.trim(),
        dataPath:       dataPath.trim(),
        labelField,
        columns:        enabledColumns.map(({ key, label }) => ({ key, label })),
        title:          title.trim() || name.trim(),
        subtitle:       subtitle.trim(),
        refreshSeconds: refresh,
      }),
    onSuccess: (item) => {
      toast.success('LiveData feed created');
      navigate(`/workspaces/${wsId}/content?openId=${item.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  if (!wsId) return null;

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/content`)}
            className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)]"
          >
            <ArrowLeft size={16} />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold bg-transparent text-[var(--text)] focus:outline-none focus:bg-[var(--surface)] px-2 py-1 rounded"
          />
          <Badge tone="info">LiveData</Badge>
        </div>

        {/* Step pills */}
        <div className="flex items-center gap-1">
          {stepNames.map((n, i) => (
            <button
              key={n}
              onClick={() => { if (i === 1 && !canAdvance) return; setStep(i); }}
              disabled={i === 1 && !canAdvance}
              className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-40 ${
                i === step
                  ? 'bg-sky-500 text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'
              }`}
            >
              {i + 1}. {n}
            </button>
          ))}
        </div>

        {/* Nav buttons */}
        <div className="flex items-center gap-2">
          {step > 0 && (
            <ActionButton onClick={() => setStep((s) => s - 1)}>Back</ActionButton>
          )}
          {step < stepNames.length - 1 ? (
            <ActionButton
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
            >
              Next <ArrowRight size={14} />
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !canAdvance}
            >
              {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </ActionButton>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Step 0: Source ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15">
                  <Activity size={18} className="text-sky-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--text)]">Configure JSON Source</h2>
                  <p className="text-xs text-[var(--text-muted)]">Enter a URL that returns a JSON array and click Test to inspect the data.</p>
                </div>
              </div>
            </div>

            <SectionCard>
              <SectionCardHeader><h3 className="text-sm font-semibold text-[var(--text)]">Source URL</h3></SectionCardHeader>
              <SectionCardBody>
                <div className="space-y-3">
                  <div className="flex gap-2">
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
                      className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 transition-colors"
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
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] font-mono"
                  />

                  {previewState === 'error' && (
                    <p className="text-xs text-red-400 flex items-center gap-1.5">
                      <AlertCircle size={12} /> {previewError}
                    </p>
                  )}
                  {previewState === 'ok' && (
                    <p className="text-xs text-green-400 flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> {previewData?.fields.length} fields detected
                    </p>
                  )}
                </div>
              </SectionCardBody>
            </SectionCard>

            {/* Preview table */}
            {previewState === 'ok' && previewData && (
              <>
                <SectionCard>
                  <SectionCardHeader><h3 className="text-sm font-semibold text-[var(--text)]">Data Preview <span className="font-normal text-[var(--text-muted)]">— first {previewData.sample.length} rows</span></h3></SectionCardHeader>
                  <SectionCardBody className="p-0 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--surface-raised)]">
                            {previewData.fields.map((f) => (
                              <th key={f} className="px-3 py-2 text-left text-[var(--text-muted)] font-medium whitespace-nowrap border-r border-[var(--border)] last:border-r-0">
                                {f}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.sample.slice(0, 3).map((row, i) => (
                            <tr key={i} className="border-t border-[var(--border)]">
                              {previewData.fields.map((f) => (
                                <td key={f} className="px-3 py-1.5 text-[var(--text)] whitespace-nowrap border-r border-[var(--border)] last:border-r-0 max-w-[180px] truncate">
                                  {String(row[f] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold text-[var(--text)]">Row Label Field</h3>
                    <p className="text-xs text-[var(--text-muted)]">Identifies each row in the left-hand column.</p>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <select
                      value={labelField}
                      onChange={(e) => setLabelField(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    >
                      <option value="">(none — use row number)</option>
                      {previewData.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </SectionCardBody>
                </SectionCard>

                <SectionCard>
                  <SectionCardHeader>
                    <h3 className="text-sm font-semibold text-[var(--text)]">Columns to Display</h3>
                    <div className="ml-auto flex gap-3 text-xs">
                      <button type="button" onClick={() => setColumns((c) => c.map((col) => ({ ...col, enabled: true })))} className="text-[var(--accent)] hover:underline">All</button>
                      <button type="button" onClick={() => setColumns((c) => c.map((col) => ({ ...col, enabled: false })))} className="text-[var(--text-muted)] hover:text-[var(--text)]">None</button>
                    </div>
                  </SectionCardHeader>
                  <SectionCardBody>
                    <div className="space-y-2">
                      {columns.map((col) => (
                        <div key={col.key} className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setColumns((cs) => cs.map((c) => c.key === col.key ? { ...c, enabled: !c.enabled } : c))}
                            className={`shrink-0 flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                              col.enabled ? 'bg-sky-500 border-sky-500' : 'border-[var(--border)] bg-[var(--surface-raised)]'
                            }`}
                          >
                            {col.enabled && <Check size={12} className="text-white" />}
                          </button>
                          <code className="w-36 shrink-0 text-xs text-[var(--text-muted)] truncate">{col.key}</code>
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
                      <p className="mt-3 text-xs text-amber-400">Select at least one column to continue.</p>
                    )}
                  </SectionCardBody>
                </SectionCard>
              </>
            )}
          </div>
        )}

        {/* ── Step 1: Display ────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">

            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">Display Settings</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">How the table appears on the signage display.</p>
            </div>

            <SectionCard>
              <SectionCardHeader><h3 className="text-sm font-semibold text-[var(--text)]">Table Header</h3></SectionCardHeader>
              <SectionCardBody>
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Title</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={name || 'Table title'}
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Subtitle</span>
                    <input
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      placeholder="Optional subtitle shown below the title"
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>
              </SectionCardBody>
            </SectionCard>

            <SectionCard>
              <SectionCardHeader>
                <h3 className="text-sm font-semibold text-[var(--text)]">Refresh Interval</h3>
                <p className="text-xs text-[var(--text-muted)]">How often the display polls for updated data from your source URL.</p>
              </SectionCardHeader>
              <SectionCardBody>
                <select
                  value={refresh}
                  onChange={(e) => setRefresh(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {REFRESH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </SectionCardBody>
            </SectionCard>

            {/* Summary */}
            <SectionCard>
              <SectionCardHeader><h3 className="text-sm font-semibold text-[var(--text)]">Summary</h3></SectionCardHeader>
              <SectionCardBody>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-[var(--text-muted)]">Source</dt>
                    <dd className="text-[var(--text)] font-mono text-xs truncate">{sourceUrl}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-[var(--text-muted)]">Columns</dt>
                    <dd className="text-[var(--text)]">{enabledColumns.map((c) => c.label).join(', ')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-[var(--text-muted)]">Row label</dt>
                    <dd className="text-[var(--text)]">{labelField || '(row number)'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-[var(--text-muted)]">Refresh</dt>
                    <dd className="text-[var(--text)]">{REFRESH_OPTIONS.find((o) => o.value === refresh)?.label}</dd>
                  </div>
                </dl>
              </SectionCardBody>
            </SectionCard>

          </div>
        )}
      </div>
    </div>
  );
}
