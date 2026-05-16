/**
 * HTML5 package editor modal (Roadmap Step 7 + Step 12).
 *
 * - File tree on the left (read-only listing of ZIP entries)
 * - Monaco editor on the right with language inferred from extension
 * - "Preview" tab swaps the editor for a sandboxed iframe pointed at
 *   /api/v1/content/:id/preview/index.html (already served by the API)
 *
 * The iframe uses sandbox="allow-scripts" only \u2014 NOT allow-same-origin \u2014
 * which prevents user content from reading dashboard cookies/storage.
 *
 * Calls the API endpoints added in apps/api/src/routes/content.ts:
 *   GET    /content/:id/html5/files
 *   GET    /content/:id/html5/file?path=...
 *   PUT    /content/:id/html5/file        { path, content }
 *   POST   /content/:id/html5/file        { path, content }
 *   DELETE /content/:id/html5/file?path=...
 *   POST   /content/:id/html5/rename-file { from, to }
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { toast } from 'sonner';
import { X, Save, FilePlus, Trash2, Pencil, RefreshCw, Eye, FileCode2 } from 'lucide-react';
import { api, buildApiUrl } from '../lib/api.js';

interface FileEntry {
  path: string;
  size: number;
  isText: boolean;
}

interface FileListResp {
  files: FileEntry[];
}

interface FileBody {
  path: string;
  content: string;
}

interface Props {
  contentId: string;
  contentName: string;
  onClose: () => void;
  /** When true, renders inline (no fixed overlay/backdrop) — used inside full-page wizards. */
  embedded?: boolean;
}

function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'html':
    case 'htm':  return 'html';
    case 'css':  return 'css';
    case 'js':
    case 'mjs':  return 'javascript';
    case 'json': return 'json';
    case 'svg':
    case 'xml':  return 'xml';
    case 'md':   return 'markdown';
    case 'txt':  return 'plaintext';
    default:     return 'plaintext';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function Html5EditorModal({ contentId, contentName, onClose, embedded }: Props) {
  const qc = useQueryClient();
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  // Cache-buster appended to preview URL so the iframe reloads after save
  const [previewKey, setPreviewKey] = useState<number>(() => Date.now());

  // ── File tree ────────────────────────────────────────────────────────────
  const { data: list, isLoading: listLoading, refetch: refetchList } = useQuery<FileListResp>({
    queryKey: ['html5-files', contentId],
    queryFn: () => api.get(`/content/${contentId}/html5/files`),
  });

  // Auto-select index.html (or the first text file) on first load.
  useEffect(() => {
    if (!list || selectedPath) return;
    const entry =
      list.files.find((f) => f.path === 'index.html' && f.isText) ??
      list.files.find((f) => f.isText) ??
      null;
    if (entry) setSelectedPath(entry.path);
  }, [list, selectedPath]);

  // ── File body ───────────────────────────────────────────────────────────
  const { data: body, isLoading: bodyLoading } = useQuery<FileBody>({
    queryKey: ['html5-file', contentId, selectedPath],
    queryFn: () => api.get(`/content/${contentId}/html5/file?path=${encodeURIComponent(selectedPath!)}`),
    enabled: !!selectedPath,
  });

  useEffect(() => {
    if (body) {
      setDraft(body.content);
      setDirty(false);
    }
  }, [body]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: () =>
      api.put(`/content/${contentId}/html5/file`, { path: selectedPath, content: draft }),
    onSuccess: () => {
      toast.success('Saved');
      setDirty(false);
      setPreviewKey(Date.now());
      void qc.invalidateQueries({ queryKey: ['html5-files', contentId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const createMut = useMutation({
    mutationFn: (path: string) =>
      api.post(`/content/${contentId}/html5/file`, { path, content: '' }),
    onSuccess: (_d, path) => {
      toast.success(`Created ${path}`);
      void refetchList();
      setSelectedPath(path);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Create failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (path: string) =>
      api.delete(`/content/${contentId}/html5/file?path=${encodeURIComponent(path)}`),
    onSuccess: (_d, path) => {
      toast.success(`Deleted ${path}`);
      if (selectedPath === path) setSelectedPath(null);
      void refetchList();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const renameMut = useMutation({
    mutationFn: (vars: { from: string; to: string }) =>
      api.post(`/content/${contentId}/html5/rename-file`, vars),
    onSuccess: (_d, vars) => {
      toast.success(`Renamed to ${vars.to}`);
      setSelectedPath(vars.to);
      void refetchList();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Rename failed'),
  });

  // ── Handlers ────────────────────────────────────────────────────────────
  function tryClose() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    onClose();
  }

  function onCreate() {
    const name = prompt('New file path (e.g. assets/extra.css):')?.trim();
    if (!name) return;
    createMut.mutate(name);
  }

  function onRename() {
    if (!selectedPath) return;
    const next = prompt('Rename to:', selectedPath)?.trim();
    if (!next || next === selectedPath) return;
    renameMut.mutate({ from: selectedPath, to: next });
  }

  function onDelete() {
    if (!selectedPath) return;
    if (selectedPath === 'index.html') {
      toast.error('Cannot delete index.html');
      return;
    }
    if (!confirm(`Delete ${selectedPath}? This cannot be undone.`)) return;
    deleteMut.mutate(selectedPath);
  }

  // ── Preview URL (cache-busted) ──────────────────────────────────────────
  const previewSrc = useMemo(
    () => buildApiUrl(`/content/${contentId}/preview/index.html?v=${previewKey}`),
    [contentId, previewKey],
  );

  const language = selectedPath ? languageFor(selectedPath) : 'plaintext';
  const editorReadOnly = !selectedPath || (body && !list?.files.find((f) => f.path === selectedPath)?.isText);

  // ── Shared sub-elements ──────────────────────────────────────────────────
  const viewToggle = (
    <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
      <button
        onClick={() => setView('edit')}
        className={`px-3 py-1 text-xs ${view === 'edit' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}
      >
        Edit
      </button>
      <button
        onClick={() => { setView('preview'); setPreviewKey(Date.now()); }}
        className={`px-3 py-1 text-xs flex items-center gap-1 ${view === 'preview' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}
      >
        <Eye size={12} /> Preview
      </button>
    </div>
  );

  const editorBody = (
    <div className="flex-1 min-h-0 flex">
          {/* File tree */}
          <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
              <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Files</span>
              <div className="flex items-center gap-1">
                <button onClick={onCreate} title="New file" className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)]">
                  <FilePlus size={14} />
                </button>
                <button onClick={() => refetchList()} title="Refresh" className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)]">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {listLoading && <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Loading\u2026</div>}
              {list?.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    if (dirty && !confirm('Discard unsaved changes?')) return;
                    setSelectedPath(f.path);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 ${
                    selectedPath === f.path
                      ? 'bg-[var(--accent)]/15 text-[var(--text)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'
                  }`}
                  title={f.path}
                >
                  <span className={`truncate ${f.isText ? '' : 'italic'}`}>{f.path}</span>
                  <span className="shrink-0 text-[10px] opacity-60">{formatSize(f.size)}</span>
                </button>
              ))}
              {list && list.files.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No files in package</div>
              )}
            </div>
          </aside>

          {/* Editor / Preview */}
          <main className="flex-1 min-w-0 flex flex-col">
            {view === 'edit' ? (
              <>
                <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 bg-[var(--surface)]">
                  <span className="text-xs text-[var(--text-muted)] truncate">
                    {selectedPath ?? 'No file selected'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onRename}
                      disabled={!selectedPath}
                      className="px-2 py-1 text-xs rounded text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 flex items-center gap-1"
                    >
                      <Pencil size={12} /> Rename
                    </button>
                    <button
                      onClick={onDelete}
                      disabled={!selectedPath || selectedPath === 'index.html'}
                      className="px-2 py-1 text-xs rounded text-red-400 hover:bg-red-500/10 disabled:opacity-30 flex items-center gap-1"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                    <button
                      onClick={() => saveMut.mutate()}
                      disabled={!selectedPath || !dirty || saveMut.isPending || !!editorReadOnly}
                      className="px-3 py-1 text-xs rounded bg-[var(--accent)] text-white disabled:opacity-40 flex items-center gap-1"
                    >
                      <Save size={12} /> {saveMut.isPending ? 'Saving\u2026' : 'Save'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  {selectedPath && bodyLoading && (
                    <div className="p-4 text-xs text-[var(--text-muted)]">Loading file\u2026</div>
                  )}
                  {selectedPath && !bodyLoading && (
                    <Editor
                      height="100%"
                      language={language}
                      value={draft}
                      theme="vs-dark"
                      options={{
                        readOnly: !!editorReadOnly,
                        minimap: { enabled: false },
                        fontSize: 13,
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                      }}
                      onChange={(v) => {
                        setDraft(v ?? '');
                        setDirty(true);
                      }}
                    />
                  )}
                  {!selectedPath && (
                    <div className="p-6 text-sm text-[var(--text-muted)]">Select a file from the tree.</div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-0 bg-black">
                {/*
                  Step 12 \u2014 sandboxed iframe.
                  Intentionally NOT including allow-same-origin so the user
                  content cannot read dashboard cookies or localStorage.
                */}
                <iframe
                  key={previewKey}
                  src={previewSrc}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                  title="HTML5 preview"
                />
              </div>
            )}
          </main>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        <div className="modal-header">
          <span className="modal-title flex items-center gap-2">
            <FileCode2 size={18} /> {contentName}
            {dirty && <span className="text-xs text-amber-400">\u2022 unsaved</span>}
          </span>
          {viewToggle}
        </div>
        {editorBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={tryClose} />
      <div className="modal-shell" style={{ width: '95vw', maxWidth: 1400, height: '90vh' }}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title flex items-center gap-2">
            <FileCode2 size={18} /> {contentName}
            {dirty && <span className="text-xs text-amber-400">\u2022 unsaved</span>}
          </h2>
          <div className="flex items-center gap-2">
            {viewToggle}
            <button onClick={tryClose} className="modal-close"><X size={20} /></button>
          </div>
        </div>
        {editorBody}
      </div>
    </div>
  );
}
