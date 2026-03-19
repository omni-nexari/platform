import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Upload, Globe, Code2, CloudUpload } from 'lucide-react';
import { api } from '../lib/api.js';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

type Tab = 'device' | 'html5' | 'weburl';

interface ContentItem {
  id: string;
  name: string;
  type: string;
}

const ACCEPT = 'image/*,video/*,.pdf,.zip,.pptx,.ppt';

export default function UploadModal({ workspaceId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('device');
  const queryClient = useQueryClient();

  // ── Device tab state ──────────────────────────────────────────────────────
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── HTML5 tab state ───────────────────────────────────────────────────────
  const [h5Name, setH5Name] = useState('');
  const [h5Zip, setH5Zip] = useState<File | null>(null);
  const [h5StartPage, setH5StartPage] = useState('index.html');
  const [h5Refresh, setH5Refresh] = useState(3600);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Web URL tab state ─────────────────────────────────────────────────────
  const [wName, setWName] = useState('');
  const [wUrl, setWUrl] = useState('');
  const [wRefresh, setWRefresh] = useState(3600);

  // ── Upload progress (simple per-file state) ───────────────────────────────
  const [uploading, setUploading] = useState(false);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['content', workspaceId] });
    await queryClient.invalidateQueries({ queryKey: ['picker-content', workspaceId] });
  };

  // ── Device upload ──────────────────────────────────────────────────────────
  const uploadDevice = async () => {
    if (!files.length) return;
    setUploading(true);
    let success = 0;
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('file', file);
        await api.postForm<ContentItem>(`/content/upload?workspaceId=${workspaceId}`, form);
        success++;
      } catch (e) {
        toast.error(`Failed: ${file.name}`);
      }
    }
    setUploading(false);
    if (success) {
      toast.success(`Uploaded ${success} file${success > 1 ? 's' : ''}`);
      void invalidate();
      onClose();
    }
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

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'device', label: 'MY DEVICE', icon: <Upload size={14} /> },
    { id: 'html5', label: 'WEB (HTML)', icon: <Code2 size={14} /> },
    { id: 'weburl', label: 'WEB (URL)', icon: <Globe size={14} /> },
  ];

  const busy = uploading || uploadHtml5Mut.isPending || addWebUrlMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-shell modal-shell-md">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Add Content</h2>
          <button
            onClick={onClose}
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
              {files.length > 0 && (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--surface-raised)]">
                      <span className="text-xs text-[var(--text)] truncate flex-1">{f.name}</span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0">
                        {(f.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <button onClick={() => removeFile(i)} className="text-[var(--text-muted)] hover:text-red-400 shrink-0">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={uploadDevice}
                disabled={!files.length || busy}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--accent)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {uploading ? 'Uploading…' : `Upload ${files.length || ''} File${files.length !== 1 ? 's' : ''}`}
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
        </div>
      </div>
    </div>
  );
}
