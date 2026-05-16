/**
 * IPTV wizard — build a channel group and save as an `iptv` content item.
 * Steps:  1. Channels   2. Settings
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Save, Tv, Plus, Trash2, Star } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  detectIptvProtocol,
  isMulticastIPv4,
  type IptvChannel,
  type IptvProtocol,
} from '@signage/shared';
import { ActionButton, Badge, SectionCard, SectionCardBody, SectionCardHeader } from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ChannelRow {
  rowId: string;
  number: number;
  name: string;
  url: string;
  protocol: IptvProtocol;
}

const IPTV_PROTOCOLS: IptvProtocol[] = ['udp', 'rtp', 'rtsp', 'hls', 'dash', 'http'];

function makeChannelRow(number: number): ChannelRow {
  return { rowId: crypto.randomUUID(), number, name: '', url: '', protocol: 'udp' };
}

function extractIptvHost(url: string): string | null {
  const m = /^(?:udp|rtp):\/\/(?:[^@\/]*@)?([^:\/?#]+)/i.exec(url || '');
  return m && m[1] ? m[1] : null;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function IptvEditorPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('IPTV Channels');
  const [rows, setRows] = useState<ChannelRow[]>([makeChannelRow(1)]);
  const [defaultCh, setDefaultCh] = useState<number>(1);
  const [m3uText, setM3uText] = useState('');
  const [showM3u, setShowM3u] = useState(false);
  const [saving, setSaving] = useState(false);

  const stepNames = ['Channels', 'Settings'];
  const totalSteps = stepNames.length;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const importM3uMut = useMutation({
    mutationFn: () =>
      api.post<{ channels: IptvChannel[]; defaultChannelNumber: number }>(
        '/content/channel-group/import-m3u',
        { text: m3uText },
      ),
    onSuccess: (data) => {
      setRows(data.channels.map((ch) => ({
        rowId: crypto.randomUUID(),
        number: ch.number,
        name: ch.name,
        url: ch.url,
        protocol: ch.protocol,
      })));
      setDefaultCh(data.defaultChannelNumber);
      setShowM3u(false);
      setM3uText('');
      toast.success(`Imported ${data.channels.length} channels`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      api.post('/content/channel-group', {
        workspaceId: wsId,
        name: name.trim(),
        channels: rows.map((r) => ({
          number: r.number,
          name: r.name.trim(),
          url: r.url.trim(),
          protocol: r.protocol,
        })),
        defaultChannelNumber: defaultCh,
      }),
    onSuccess: (created: unknown) => {
      toast.success('Channel group created');
      void queryClient.invalidateQueries({ queryKey: ['content', wsId] });
      const cid = (created as { id?: string })?.id;
      navigate(`/workspaces/${wsId}/content${cid ? `?openId=${cid}` : ''}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  });

  // ── Row helpers ───────────────────────────────────────────────────────────
  const addRow = () => {
    setRows((prev) => {
      const used = new Set(prev.map((r) => r.number));
      let next = 1;
      while (used.has(next)) next += 1;
      return [...prev, makeChannelRow(next)];
    });
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length ? next : [makeChannelRow(1)];
    });
  };

  const updateRow = (rowId: string, patch: Partial<ChannelRow>) => {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const onUrlBlur = (rowId: string, url: string) => {
    const detected = detectIptvProtocol(url);
    if (detected) updateRow(rowId, { protocol: detected });
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const canSave = (() => {
    if (!name.trim()) return false;
    if (!rows.length) return false;
    const nums = new Set<number>();
    for (const r of rows) {
      if (!r.name.trim() || !r.url.trim()) return false;
      if (!Number.isInteger(r.number) || r.number < 1) return false;
      if (nums.has(r.number)) return false;
      nums.add(r.number);
    }
    return nums.has(defaultCh);
  })();

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
          <Badge tone="accent">IPTV</Badge>
        </div>

        <div className="flex items-center gap-2">
          {stepNames.map((n, i) => (
            <button
              key={n}
              onClick={() => setStep(i)}
              className={`px-2 py-1 rounded text-xs ${i === step ? 'bg-[var(--blue)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}
            >
              {i + 1}. {n}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {step > 0 && <ActionButton onClick={() => setStep((s) => s - 1)}>Back</ActionButton>}
          {step < totalSteps - 1 ? (
            <ActionButton onClick={() => setStep((s) => s + 1)}>
              Next <ArrowRight size={14} />
            </ActionButton>
          ) : (
            <ActionButton
              onClick={() => { setSaving(true); saveMut.mutate(undefined, { onSettled: () => setSaving(false) }); }}
              disabled={saving || !canSave}
            >
              <Save size={14} /> Save
            </ActionButton>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* ── Step 0: Channels ── */}
          {step === 0 && (
            <>
              <SectionCard>
                <SectionCardHeader>
                  <h3 className="text-sm font-semibold"><Tv size={14} className="inline mr-1.5 mb-0.5" />Channel List</h3>
                  <button
                    type="button"
                    onClick={() => setShowM3u((v) => !v)}
                    className="text-xs text-[var(--accent)] hover:underline ml-auto"
                  >
                    {showM3u ? 'Hide M3U import' : 'Import from M3U'}
                  </button>
                </SectionCardHeader>
                <SectionCardBody>
                  {showM3u && (
                    <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 space-y-2">
                      <textarea
                        value={m3uText}
                        onChange={(e) => setM3uText(e.target.value)}
                        placeholder={'#EXTM3U\n#EXTINF:-1 tvg-chno="1" tvg-name="Ch 1",Ch 1\nudp://239.0.0.1:1234'}
                        rows={6}
                        className="w-full px-2 py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => importM3uMut.mutate()}
                        disabled={!m3uText.trim() || importM3uMut.isPending}
                        className="px-3 py-1.5 rounded text-xs font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90"
                      >
                        {importM3uMut.isPending ? 'Parsing…' : 'Parse channels'}
                      </button>
                    </div>
                  )}

                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-[var(--surface)] text-[var(--text-muted)] uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-3 py-2 w-14">#</th>
                          <th className="text-left px-3 py-2 w-48">Name</th>
                          <th className="text-left px-3 py-2 w-28">Protocol</th>
                          <th className="text-left px-3 py-2">URL</th>
                          <th className="px-3 py-2 w-10 text-center" title="Default">★</th>
                          <th className="px-3 py-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.rowId} className="border-t border-[var(--border)]">
                            <td className="px-3 py-1.5">
                              <input
                                type="number"
                                min={1}
                                value={row.number}
                                onChange={(e) => updateRow(row.rowId, { number: Number(e.target.value) || 1 })}
                                className="w-12 px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                value={row.name}
                                onChange={(e) => updateRow(row.rowId, { name: e.target.value })}
                                placeholder="Channel name"
                                className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <select
                                value={row.protocol}
                                onChange={(e) => updateRow(row.rowId, { protocol: e.target.value as IptvProtocol })}
                                className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                              >
                                {IPTV_PROTOCOLS.map((p) => (
                                  <option key={p} value={p}>{p.toUpperCase()}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                value={row.url}
                                onChange={(e) => updateRow(row.rowId, { url: e.target.value })}
                                onBlur={(e) => onUrlBlur(row.rowId, e.target.value)}
                                placeholder="udp://239.0.0.1:1234"
                                className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                              />
                              {(() => {
                                if (row.protocol !== 'udp' && row.protocol !== 'rtp') return null;
                                const host = extractIptvHost(row.url);
                                if (!host || isMulticastIPv4(host)) return null;
                                return (
                                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/40">
                                    Not a multicast address
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setDefaultCh(row.number)}
                                title="Set as default channel"
                                className={`p-1 rounded ${defaultCh === row.number ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400'}`}
                              >
                                <Star size={14} fill={defaultCh === row.number ? 'currentColor' : 'none'} />
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(row.rowId)}
                                className="p-1 text-[var(--text-muted)] hover:text-red-400"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    onClick={addRow}
                    className="mt-3 flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
                  >
                    <Plus size={14} /> Add channel
                  </button>
                </SectionCardBody>
              </SectionCard>
            </>
          )}

          {/* ── Step 1: Settings ── */}
          {step === 1 && (
            <>
              <SectionCard>
                <SectionCardHeader>
                  <h3 className="text-sm font-semibold">Summary</h3>
                </SectionCardHeader>
                <SectionCardBody>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Group name</span>
                      <span className="font-medium text-[var(--text)]">{name || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Channels</span>
                      <span className="font-medium text-[var(--text)]">{rows.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Default channel</span>
                      <span className="font-medium text-[var(--text)]">
                        {rows.find((r) => r.number === defaultCh)?.name || `Ch ${defaultCh}`}
                      </span>
                    </div>
                  </div>
                </SectionCardBody>
              </SectionCard>

              <SectionCard>
                <SectionCardHeader>
                  <h3 className="text-sm font-semibold">Codec Recommendations</h3>
                </SectionCardHeader>
                <SectionCardBody className="space-y-3 text-sm text-[var(--text-muted)]">
                  <p>
                    <span className="font-semibold text-[var(--text)]">UDP/RTP multicast</span> — use addresses in{' '}
                    <code className="text-xs bg-[var(--surface-raised)] px-1 py-0.5 rounded">224.0.0.0/4</code>. 
                    H.264 up to 15&nbsp;Mbps for FHD streams gives the best compatibility on Tizen 4/SSSP4 panels.
                    MPEG-TS containers are most reliable.
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--text)]">HLS/DASH</span> — standard HTTP streams
                    work on all modern player platforms. Prefer adaptive bitrate playlists.
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--text)]">HEVC / H.265</span> — only supported on
                    Tizen 6.5+ panels. Use H.264 for broader compatibility.
                  </p>
                </SectionCardBody>
              </SectionCard>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
