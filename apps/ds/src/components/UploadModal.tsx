import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Upload, Globe, Code2, CloudUpload, Tv, Trash2, Plus, Star, FileCode2 } from 'lucide-react';
import { api } from '../lib/api.js';
import {
  startBackgroundDeviceUpload,
  subscribeBackgroundUploadTask,
  type BackgroundUploadTask,
} from '../lib/background-uploads.js';
import {
  detectIptvProtocol,
  type IptvChannel,
  type IptvProtocol,
} from '@signage/shared';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type Tab = 'device' | 'html5' | 'template' | 'weburl' | 'iptv';

interface ChannelRow {
  rowId: string;
  number: number;
  name: string;
  url: string;
  protocol: IptvProtocol;
}

const IPTV_PROTOCOLS: IptvProtocol[] = ['udp', 'rtp', 'rtsp', 'hls', 'dash', 'http'];

function makeChannelRow(number: number): ChannelRow {
  return {
    rowId: crypto.randomUUID(),
    number,
    name: '',
    url: '',
    protocol: 'udp',
  };
}

interface ContentItem {
  id: string;
  name: string;
  type: string;
}

interface QueuedFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
}

const ACCEPT = 'image/*,video/*,.pdf,.zip,.pptx,.ppt';

function queueFiles(selectedFiles: File[]): QueuedFile[] {
  return selectedFiles.map((file) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    progress: 0,
    status: 'pending',
  }));
}

function uploadStatusLabel(status: QueuedFile['status'], progress: number): string {
  if (status === 'uploaded') return 'Uploaded';
  if (status === 'failed') return 'Failed';
  if (status === 'uploading') return `${Math.max(1, Math.round(progress * 100))}%`;
  return 'Waiting';
}

export default function UploadModal({ workspaceId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('device');
  const queryClient = useQueryClient();

  // ── Device tab state ──────────────────────────────────────────────────────
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── HTML5 tab state ───────────────────────────────────────────────────────
  const [h5Name, setH5Name] = useState('');
  const [h5Zip, setH5Zip] = useState<File | null>(null);
  const [h5StartPage, setH5StartPage] = useState('index.html');
  const [h5Refresh, setH5Refresh] = useState(3600);
  const zipInputRef = useRef<HTMLInputElement>(null);
  // ── Template tab state (Roadmap Step 8) ──────────────────────────────────────
  const [tplName, setTplName] = useState('');
  const [tplId, setTplId] = useState<string | null>(null);  // ── IPTV channel-group tab state ──────────────────────────────
  const [iptvName, setIptvName] = useState('');
  const [iptvRows, setIptvRows] = useState<ChannelRow[]>([makeChannelRow(1)]);
  const [iptvDefault, setIptvDefault] = useState<number>(1);
  const [iptvM3u, setIptvM3u] = useState('');
  const [iptvShowM3u, setIptvShowM3u] = useState(false);
  // ── Web URL tab state ─────────────────────────────────────────────────────
  const [wName, setWName] = useState('');
  const [wUrl, setWUrl] = useState('');
  const [wRefresh, setWRefresh] = useState(3600);

  // ── Upload progress (simple per-file state) ───────────────────────────────
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [backgroundTask, setBackgroundTask] = useState<BackgroundUploadTask | null>(null);

  useEffect(() => {
    if (!activeTaskId) return;
    return subscribeBackgroundUploadTask(activeTaskId, (task) => {
      setBackgroundTask(task);
    });
  }, [activeTaskId]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['content', workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
  };

  // ── Device upload ──────────────────────────────────────────────────────────
  const uploadDevice = async () => {
    if (!files.length) return;
    const taskId = startBackgroundDeviceUpload(workspaceId, files.map((entry) => entry.file));
    setActiveTaskId(taskId);
  };

  // ── HTML5 upload ───────────────────────────────────────────────────────────
  const uploadHtml5Mut = useMutation({
    mutationFn: async () => {
      if (!h5Zip) throw new Error('No ZIP file selected');
      const form = new FormData();
      form.append('file', h5Zip);
      const item = await api.postForm<ContentItem>(`/content/upload?workspaceId=${workspaceId}`, form);
      await api.patch(`/content/${item.id}`, {
        name: h5Name || item.name,
        metadata: JSON.stringify({ startPage: h5StartPage, refreshInterval: h5Refresh }),
      });
    },
    onSuccess: () => {
      toast.success('HTML5 package uploaded');
      void invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });

  // ── Templates list (loaded once when the tab is opened) ─────────────────
  const tplListQ = useQuery<{ templates: Array<{ id: string; name: string; description: string }> }>({
    queryKey: ['html5-templates'],
    queryFn: () => api.get('/content/html5/templates'),
    enabled: tab === 'template',
    staleTime: 60_000,
  });

  const createFromTemplateMut = useMutation({
    mutationFn: () =>
      api.post('/content/html5/create', { workspaceId, templateId: tplId, name: tplName.trim() }),
    onSuccess: () => {
      toast.success('HTML5 content created from template');
      void invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Create failed'),
  });

  // ── Web URL ────────────────────────────────────────────────────────────────
  const addWebUrlMut = useMutation({
    mutationFn: () =>
      api.post('/content/web-url', {
        workspaceId,
        name: wName,
        webUrl: wUrl,
        refreshInterval: wRefresh,
      }),
    onSuccess: () => {
      toast.success('Web URL added');
      void invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  // ── IPTV channel group ─────────────────────────────────────────────
  const addIptvRow = () => {
    setIptvRows((prev) => {
      const usedNums = new Set(prev.map((r) => r.number));
      let next = 1;
      while (usedNums.has(next)) next += 1;
      return [...prev, makeChannelRow(next)];
    });
  };

  const removeIptvRow = (rowId: string) => {
    setIptvRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      return next.length ? next : [makeChannelRow(1)];
    });
  };

  const updateIptvRow = (rowId: string, patch: Partial<ChannelRow>) => {
    setIptvRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  };

  const onIptvUrlBlur = (rowId: string, url: string) => {
    const detected = detectIptvProtocol(url);
    if (detected) updateIptvRow(rowId, { protocol: detected });
  };

  const importM3uMut = useMutation({
    mutationFn: async () => {
      return api.post<{ channels: IptvChannel[]; defaultChannelNumber: number }>(
        '/content/channel-group/import-m3u',
        { text: iptvM3u },
      );
    },
    onSuccess: (data) => {
      setIptvRows(
        data.channels.map((ch) => ({
          rowId: crypto.randomUUID(),
          number: ch.number,
          name: ch.name,
          url: ch.url,
          protocol: ch.protocol,
        })),
      );
      setIptvDefault(data.defaultChannelNumber);
      setIptvShowM3u(false);
      setIptvM3u('');
      toast.success(`Imported ${data.channels.length} channels`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const addChannelGroupMut = useMutation({
    mutationFn: async () => {
      const channels = iptvRows.map((r) => ({
        number: r.number,
        name: r.name.trim(),
        url: r.url.trim(),
        protocol: r.protocol,
      }));
      return api.post('/content/channel-group', {
        workspaceId,
        name: iptvName.trim(),
        channels,
        defaultChannelNumber: iptvDefault,
      });
    },
    onSuccess: () => {
      toast.success('Channel group created');
      void invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const iptvCanSave = (() => {
    if (!iptvName.trim()) return false;
    if (!iptvRows.length) return false;
    const nums = new Set<number>();
    for (const r of iptvRows) {
      if (!r.name.trim() || !r.url.trim()) return false;
      if (!Number.isInteger(r.number) || r.number < 1) return false;
      if (nums.has(r.number)) return false;
      nums.add(r.number);
    }
    return nums.has(iptvDefault);
  })();
  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...queueFiles(dropped)]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    if (selectedFiles.length) {
      setFiles((prev) => [...prev, ...queueFiles(selectedFiles)]);
    }
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((item) => item.id !== id));

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'device',   label: 'MY DEVICE',  icon: <Upload size={14} /> },
    { id: 'html5',    label: 'WEB (HTML)', icon: <Code2 size={14} /> },
    { id: 'template', label: 'TEMPLATE',   icon: <FileCode2 size={14} /> },
    { id: 'weburl',   label: 'WEB (URL)',  icon: <Globe size={14} /> },
    { id: 'iptv',     label: 'IPTV',       icon: <Tv size={14} /> },
  ];

  const displayedFiles = backgroundTask
    ? backgroundTask.items.map((item, index) => ({
        id: item.id,
        file: files[index]?.file ?? new File([], item.name),
        progress: item.progress,
        status: item.status,
      }))
    : files;

  const deviceUploading = backgroundTask?.status === 'running';
  const busy =
    deviceUploading ||
    uploadHtml5Mut.isPending ||
    addWebUrlMut.isPending ||
    addChannelGroupMut.isPending ||
    importM3uMut.isPending ||
    createFromTemplateMut.isPending;
  const overallProgress = displayedFiles.length
    ? Math.round(displayedFiles.reduce((sum, item) => sum + item.progress, 0) / displayedFiles.length * 100)
    : 0;

  const handleClose = () => {
    if (deviceUploading) {
      toast.message('Upload will continue in the background. You will be notified when it finishes.');
    }
    onClose();
  };

  useEffect(() => {
    if (!backgroundTask) return;
    if (backgroundTask.status === 'completed') {
      onClose();
    }
  }, [backgroundTask, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className="modal-shell modal-shell-md">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Add Content</h2>
          <button
            onClick={handleClose}
            className="modal-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`modal-tab ${tab === t.id ? 'modal-tab-active' : ''}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body space-y-4 min-h-[300px]">

          {/* ── MY DEVICE ── */}
          {tab === 'device' && (
            <>
              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
                  ${dragging
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-[var(--border)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/5'
                  }`}
              >
                <CloudUpload size={32} className="text-[var(--text-muted)]" />
                <div className="text-center">
                  <p className="text-sm text-[var(--text)]">Drop files here or <span className="text-[var(--accent)]">browse</span></p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Images, Videos, PDF, ZIP (HTML5), PPTX</p>
                </div>
              </div>
              <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={handleFileChange} />

              {/* File list */}
              {displayedFiles.length > 0 && (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {displayedFiles.map((entry) => (
                    <li key={entry.id} className="px-3 py-2 rounded-lg bg-[var(--surface-raised)]">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text)] truncate flex-1">{entry.file.name}</span>
                            <span className={`text-[11px] shrink-0 ${entry.status === 'failed' ? 'text-red-400' : entry.status === 'uploaded' ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>
                              {uploadStatusLabel(entry.status, entry.progress)}
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-black/20 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-[width] duration-200 ${entry.status === 'failed' ? 'bg-red-400' : 'bg-[var(--accent)]'}`}
                              style={{ width: `${Math.max(entry.progress * 100, entry.status === 'failed' ? 100 : 0)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] shrink-0">
                          {(entry.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button onClick={() => removeFile(entry.id)} disabled={busy || !!backgroundTask} className="text-[var(--text-muted)] hover:text-red-400 shrink-0 disabled:opacity-40">
                        <X size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {deviceUploading && displayedFiles.length > 0 && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                    <span>Uploading files</span>
                    <span>{overallProgress}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-black/20 overflow-hidden">
                    <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200" style={{ width: `${overallProgress}%` }} />
                  </div>
                </div>
              )}

              <button
                onClick={uploadDevice}
                disabled={!files.length || busy || !!backgroundTask}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {deviceUploading ? `Uploading… ${overallProgress}%` : `Upload ${files.length || ''} File${files.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {/* ── WEB (HTML5) ── */}
          {tab === 'html5' && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Content Name</span>
                <input
                  value={h5Name}
                  onChange={(e) => setH5Name(e.target.value)}
                  placeholder="My HTML5 Banner"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>
              <div className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Web Package (ZIP)</span>
                <div
                  onClick={() => zipInputRef.current?.click()}
                  className="mt-1 flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-[var(--border)] hover:border-[var(--accent)]/60 cursor-pointer transition-colors"
                >
                  <Upload size={16} className="text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-muted)]">
                    {h5Zip ? h5Zip.name : 'Click to select a ZIP file'}
                  </span>
                </div>
                <input ref={zipInputRef} type="file" accept=".zip" className="hidden"
                  onChange={(e) => e.target.files?.[0] && setH5Zip(e.target.files[0])} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Start Page</span>
                  <input
                    value={h5StartPage}
                    onChange={(e) => setH5StartPage(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Refresh Interval</span>
                  <select
                    value={h5Refresh}
                    onChange={(e) => setH5Refresh(Number(e.target.value))}
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value={900}>15 minutes</option>
                    <option value={1800}>30 minutes</option>
                    <option value={3600}>1 hour</option>
                    <option value={21600}>6 hours</option>
                    <option value={86400}>24 hours</option>
                    <option value={0}>Never</option>
                  </select>
                </label>
              </div>

              <button
                onClick={() => uploadHtml5Mut.mutate()}
                disabled={!h5Zip || busy}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {uploadHtml5Mut.isPending ? 'Uploading…' : 'Upload Package'}
              </button>
            </>
          )}

          {/* ── TEMPLATE (HTML5 starter) ── */}
          {tab === 'template' && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Content Name</span>
                <input
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="My HTML5 Banner"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              <div className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Choose a Template</span>
                <div className="mt-2 grid grid-cols-1 gap-2 max-h-72 overflow-y-auto">
                  {tplListQ.isLoading && (
                    <div className="text-xs text-[var(--text-muted)]">Loading templates…</div>
                  )}
                  {tplListQ.data?.templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTplId(t.id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        tplId === t.id
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/60'
                      }`}
                    >
                      <div className="text-sm font-semibold text-[var(--text)]">{t.name}</div>
                      <div className="text-xs text-[var(--text-muted)] mt-0.5">{t.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-[var(--text-muted)]">
                The template ZIP is created in your library — open it from the Content list and click <strong>Edit</strong> to customise the HTML, CSS and JS.
              </p>

              <button
                onClick={() => createFromTemplateMut.mutate()}
                disabled={!tplId || !tplName.trim() || busy}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {createFromTemplateMut.isPending ? 'Creating…' : 'Create from Template'}
              </button>
            </>
          )}

          {/* ── WEB (URL) ── */}
          {tab === 'weburl' && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Content Name</span>
                <input
                  value={wName}
                  onChange={(e) => setWName(e.target.value)}
                  placeholder="Company Website"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">URL</span>
                <input
                  value={wUrl}
                  onChange={(e) => setWUrl(e.target.value)}
                  placeholder="https://example.com"
                  type="url"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Refresh Interval</span>
                <select
                  value={wRefresh}
                  onChange={(e) => setWRefresh(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value={900}>15 minutes</option>
                  <option value={1800}>30 minutes</option>
                  <option value={3600}>1 hour</option>
                  <option value={21600}>6 hours</option>
                  <option value={86400}>24 hours</option>
                  <option value={0}>Never</option>
                </select>
              </label>

              <button
                onClick={() => addWebUrlMut.mutate()}
                disabled={!wName.trim() || !wUrl.trim() || busy}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {addWebUrlMut.isPending ? 'Adding…' : 'Add URL'}
              </button>
            </>
          )}

          {/* ── IPTV (channel group) ── */}
          {tab === 'iptv' && (
            <>
              <label className="block">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Channel Group Name</span>
                <input
                  value={iptvName}
                  onChange={(e) => setIptvName(e.target.value)}
                  placeholder="Lobby TV Channels"
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Channels</span>
                <button
                  type="button"
                  onClick={() => setIptvShowM3u((v) => !v)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {iptvShowM3u ? 'Hide M3U import' : 'Import from M3U'}
                </button>
              </div>

              {iptvShowM3u && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 space-y-2">
                  <textarea
                    value={iptvM3u}
                    onChange={(e) => setIptvM3u(e.target.value)}
                    placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-chno=”1” tvg-name=”Ch 1”,Ch 1&#10;udp://239.0.0.1:1234"
                    rows={5}
                    className="w-full px-2 py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => importM3uMut.mutate()}
                    disabled={!iptvM3u.trim() || importM3uMut.isPending}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90"
                  >
                    {importM3uMut.isPending ? 'Parsing…' : 'Parse channels'}
                  </button>
                </div>
              )}

              <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--surface-raised)] text-[var(--text-muted)] uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-2 py-2 w-12">#</th>
                      <th className="text-left px-2 py-2 w-44">Name</th>
                      <th className="text-left px-2 py-2 w-24">Protocol</th>
                      <th className="text-left px-2 py-2">URL</th>
                      <th className="px-2 py-2 w-10" title="Default"></th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {iptvRows.map((row) => (
                      <tr key={row.rowId} className="border-t border-[var(--border)]">
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={1}
                            value={row.number}
                            onChange={(e) => updateIptvRow(row.rowId, { number: Number(e.target.value) || 1 })}
                            className="w-12 px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.name}
                            onChange={(e) => updateIptvRow(row.rowId, { name: e.target.value })}
                            placeholder="Channel name"
                            className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={row.protocol}
                            onChange={(e) => updateIptvRow(row.rowId, { protocol: e.target.value as IptvProtocol })}
                            className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          >
                            {IPTV_PROTOCOLS.map((p) => (
                              <option key={p} value={p}>{p.toUpperCase()}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.url}
                            onChange={(e) => updateIptvRow(row.rowId, { url: e.target.value })}
                            onBlur={(e) => onIptvUrlBlur(row.rowId, e.target.value)}
                            placeholder="udp://239.0.0.1:1234"
                            className="w-full px-1.5 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-xs font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => setIptvDefault(row.number)}
                            title="Set as default channel"
                            className={`p-1 rounded ${iptvDefault === row.number ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400'}`}
                          >
                            <Star size={14} fill={iptvDefault === row.number ? 'currentColor' : 'none'} />
                          </button>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeIptvRow(row.rowId)}
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
                onClick={addIptvRow}
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <Plus size={14} /> Add channel
              </button>

              <p className="text-[11px] text-[var(--text-muted)]">
                The default channel (★) plays first when this group starts on a screen.
                Viewers can switch with the remote’s CH+/CH− keys or by typing channel numbers.
              </p>

              <button
                onClick={() => addChannelGroupMut.mutate()}
                disabled={!iptvCanSave || busy}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {addChannelGroupMut.isPending ? 'Saving…' : `Save Channel Group (${iptvRows.length})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
