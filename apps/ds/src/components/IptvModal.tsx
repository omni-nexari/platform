import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Star, Trash2, Tv } from 'lucide-react';
import { api } from '../lib/api.js';
import {
  detectIptvProtocol,
  isMulticastIPv4,
  type IptvChannel,
  type IptvProtocol,
} from '@signage/shared';

function extractIptvHost(url: string): string | null {
  const m = /^(?:udp|rtp):\/\/(?:[^@\/]*@)?([^:\/?#]+)/i.exec(url || '');
  return m && m[1] ? m[1] : null;
}

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

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export default function IptvModal({ workspaceId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<ChannelRow[]>([makeChannelRow(1)]);
  const [defaultCh, setDefaultCh] = useState<number>(1);
  const [m3uText, setM3uText] = useState('');
  const [showM3u, setShowM3u] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['content', workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
  };

  const addRow = () => {
    setRows((prev) => {
      const used = new Set(prev.map((r) => r.number));
      let n = 1; while (used.has(n)) n++;
      return [...prev, makeChannelRow(n)];
    });
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => { const next = prev.filter((r) => r.rowId !== rowId); return next.length ? next : [makeChannelRow(1)]; });
  };

  const updateRow = (rowId: string, patch: Partial<ChannelRow>) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));

  const onUrlBlur = (rowId: string, url: string) => {
    const detected = detectIptvProtocol(url);
    if (detected) updateRow(rowId, { protocol: detected });
  };

  const importM3u = useMutation({
    mutationFn: () => api.post<{ channels: IptvChannel[]; defaultChannelNumber: number }>(
      '/content/channel-group/import-m3u', { text: m3uText },
    ),
    onSuccess: (data) => {
      setRows(data.channels.map((ch) => ({ rowId: crypto.randomUUID(), number: ch.number, name: ch.name, url: ch.url, protocol: ch.protocol })));
      setDefaultCh(data.defaultChannelNumber);
      setShowM3u(false);
      setM3uText('');
      toast.success(`Imported ${data.channels.length} channels`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const saveMut = useMutation({
    mutationFn: () => api.post('/content/channel-group', {
      workspaceId,
      name: name.trim(),
      channels: rows.map((r) => ({ number: r.number, name: r.name.trim(), url: r.url.trim(), protocol: r.protocol })),
      defaultChannelNumber: defaultCh,
    }),
    onSuccess: () => { toast.success('Channel group created'); void invalidate(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const canSave = (() => {
    if (!name.trim() || !rows.length) return false;
    const nums = new Set<number>();
    for (const r of rows) {
      if (!r.name.trim() || !r.url.trim()) return false;
      if (!Number.isInteger(r.number) || r.number < 1 || nums.has(r.number)) return false;
      nums.add(r.number);
    }
    return nums.has(defaultCh);
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-lg">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-orange-500/15 flex items-center justify-center text-orange-400">
              <Tv size={15} />
            </div>
            <h2 className="modal-title">IPTV Channel Group</h2>
          </div>
          <button onClick={onClose} className="modal-close"><X size={20} /></button>
        </div>

        <div className="modal-body space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Channel Group Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lobby TV Channels"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
          </label>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Channels</span>
            <button type="button" onClick={() => setShowM3u((v) => !v)} className="text-xs text-[var(--accent)] hover:underline">
              {showM3u ? 'Hide M3U import' : 'Import from M3U'}
            </button>
          </div>

          {showM3u && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 space-y-2">
              <textarea value={m3uText} onChange={(e) => setM3uText(e.target.value)}
                placeholder={'#EXTM3U\n#EXTINF:-1 tvg-chno="1" tvg-name="Ch 1",Ch 1\nudp://239.0.0.1:1234'}
                rows={5}
                className="w-full px-2 py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
              <button type="button" onClick={() => importM3u.mutate()} disabled={!m3uText.trim() || importM3u.isPending}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90">
                {importM3u.isPending ? 'Parsing…' : 'Parse channels'}
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface-raised)] text-[var(--text-muted)] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-2 py-2 w-12">#</th>
                  <th className="text-left px-2 py-2 w-40">Name</th>
                  <th className="text-left px-2 py-2 w-24">Protocol</th>
                  <th className="text-left px-2 py-2">URL</th>
                  <th className="px-2 py-2 w-8" title="Default" />
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowId} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1">
                      <input type="number" min={1} value={row.number}
                        onChange={(e) => updateRow(row.rowId, { number: Number(e.target.value) || 1 })}
                        className="w-12 px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={row.name} onChange={(e) => updateRow(row.rowId, { name: e.target.value })} placeholder="Channel name"
                        className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                    </td>
                    <td className="px-2 py-1">
                      <select value={row.protocol} onChange={(e) => updateRow(row.rowId, { protocol: e.target.value as IptvProtocol })}
                        className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]">
                        {IPTV_PROTOCOLS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input value={row.url} onChange={(e) => updateRow(row.rowId, { url: e.target.value })}
                        onBlur={(e) => onUrlBlur(row.rowId, e.target.value)} placeholder="udp://239.0.0.1:1234"
                        className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]" />
                      {(() => {
                        if (row.protocol !== 'udp' && row.protocol !== 'rtp') return null;
                        const host = extractIptvHost(row.url);
                        if (!host || isMulticastIPv4(host)) return null;
                        return <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/40">Not a multicast address</span>;
                      })()}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button type="button" onClick={() => setDefaultCh(row.number)} title="Set as default"
                        className={`p-1 rounded ${defaultCh === row.number ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400'}`}>
                        <Star size={14} fill={defaultCh === row.number ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button type="button" onClick={() => removeRow(row.rowId)} className="p-1 text-[var(--text-muted)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
            <Plus size={14} /> Add channel
          </button>

          <p className="text-[11px] text-[var(--text-muted)]">
            The default channel (★) plays first. Viewers can switch with CH+/CH− keys or by typing channel numbers.
            <br />
            <span className="font-semibold text-[var(--text)]">Codec tip:</span> H.264 ≤ 15&nbsp;Mbps for FHD (best Tizen 4/SSSP4 compat). MPEG-TS containers work best for UDP/RTP multicast.
          </p>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="modal-btn-secondary">Cancel</button>
          <button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}
            className="modal-btn-primary disabled:opacity-40">
            {saveMut.isPending ? 'Saving…' : `Save Channel Group (${rows.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
