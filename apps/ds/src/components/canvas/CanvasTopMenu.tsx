import { useState } from 'react';
import { toast } from 'sonner';
import {
  Save, Undo2, Redo2, RotateCcw, Settings2,
  Grid3X3, ChevronDown,
} from 'lucide-react';
import { useCanvasStore } from '../../lib/canvasStore.js';
import { api } from '../../lib/api.js';
import { SIZE_PRESETS } from '../../lib/canvasTypes.js';

export default function CanvasTopMenu() {
  const {
    projectId, projectName, projectVersion, dirty,
    pages, settings, undo, redo, past, future,
    setProjectName, markClean, updateSettings, resetProject,
  } = useCanvasStore();

  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(projectName);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!projectId) return;
    setSaving(true);
    try {
      await api.put(`/canvas/${projectId}`, {
        sceneData: { pages },
        settings,
        version: projectVersion,
        name: projectName,
      });
      markClean();
      // Update local version
      useCanvasStore.setState((s) => ({ projectVersion: s.projectVersion + 1 }));
      toast.success('Design saved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      if (msg.includes('updated elsewhere')) {
        toast.error('Someone else updated this design. Please refresh.');
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleNameSubmit() {
    const trimmed = nameInput.trim();
    if (trimmed) setProjectName(trimmed);
    setEditingName(false);
  }

  return (
    <div className="h-11 shrink-0 flex items-center justify-between px-3 border-b border-[var(--border)] bg-[var(--card)]">
      {/* Left: project name */}
      <div className="flex items-center gap-3 min-w-0">
        {editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') setEditingName(false); }}
            className="bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-0.5 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)] w-48"
          />
        ) : (
          <button
            onClick={() => { setNameInput(projectName); setEditingName(true); }}
            className="text-sm font-semibold text-[var(--text)] hover:text-[var(--blue)] transition-colors truncate max-w-[200px]"
            title="Click to rename"
          >
            {projectName}
          </button>
        )}
        {dirty && <span className="text-[10px] text-amber-400 font-medium">Unsaved</span>}
      </div>

      {/* Center: tools */}
      <div className="flex items-center gap-1">
        {/* Undo */}
        <button
          onClick={undo}
          disabled={past.length === 0}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors disabled:opacity-30"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>

        {/* Redo */}
        <button
          onClick={redo}
          disabled={future.length === 0}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors disabled:opacity-30"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-px h-5 bg-[var(--border)] mx-1" />

        {/* Grid toggle */}
        <button
          onClick={() => updateSettings({ gridEnabled: !settings.gridEnabled })}
          className={`p-1.5 rounded transition-colors ${
            settings.gridEnabled
              ? 'text-[var(--blue)] bg-[var(--blue)]/10'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
          }`}
          title={settings.gridEnabled ? 'Hide Grid' : 'Show Grid'}
        >
          <Grid3X3 size={16} />
        </button>

        {/* Snap toggle */}
        <button
          onClick={() => updateSettings({ snapToGrid: !settings.snapToGrid })}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            settings.snapToGrid
              ? 'text-[var(--blue)] bg-[var(--blue)]/10'
              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
          }`}
          title={settings.snapToGrid ? 'Snap to Grid: On' : 'Snap to Grid: Off'}
        >
          Snap
        </button>

        <div className="w-px h-5 bg-[var(--border)] mx-1" />

        {/* Canvas size presets */}
        <div className="relative">
          <button
            onClick={() => setShowSizeMenu(!showSizeMenu)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
            title="Canvas size"
          >
            <Settings2 size={14} />
            {settings.width} × {settings.height}
            <ChevronDown size={12} />
          </button>

              {showSizeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSizeMenu(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] shadow-xl py-1">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={`${p.width}x${p.height}`}
                    onClick={() => {
                      updateSettings({ width: p.width, height: p.height });
                      setShowSizeMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface)] transition-colors ${
                      settings.width === p.width && settings.height === p.height
                        ? 'text-[var(--blue)] font-medium'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {p.label}
                    <span className="ml-auto float-right opacity-60">{p.width}×{p.height}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: save */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetProject}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          title="Reset canvas"
        >
          <RotateCcw size={16} />
        </button>

        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--blue)] text-white hover:opacity-90 disabled:opacity-40"
        >
          <Save size={14} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
