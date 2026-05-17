import {
  Plus, Trash2, Copy, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { useCanvasStore } from '../../lib/canvasStore.js';

export default function CanvasPageBar() {
  const {
    pages,
    selectedPageId,
    selectPage,
    addPage,
    removePage,
    duplicatePage,
    reorderPages,
    updatePage,
    zoom,
    setZoom,
    fitCanvas,
    settings,
  } = useCanvasStore();

  const selectedIdx = pages.findIndex((p) => p.id === selectedPageId);

  function handleFitToScreen() {
    fitCanvas();
  }

  return (
    <div className="h-14 shrink-0 flex items-center justify-between px-3 border-t border-[var(--border)] bg-[var(--card)]">
      {/* Left: page thumbnails */}
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto pr-4">
        {pages.map((page, idx) => (
          <button
            key={page.id}
            onClick={() => selectPage(page.id)}
            className={`relative shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
              page.id === selectedPageId
                ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--blue)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)] hover:bg-[var(--surface)]'
            }`}
          >
            <span className="font-medium">{idx + 1}</span>
            <span className="truncate max-w-[80px]">{page.title}</span>
            <span className="text-[10px] opacity-60">{page.duration}s</span>
          </button>
        ))}

        {/* Add page */}
        <button
          onClick={addPage}
          className="shrink-0 p-1.5 rounded-lg border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
          title="Add a new page"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Center: page controls */}
      <div className="flex items-center gap-1 shrink-0 mx-4">
        <button
          onClick={() => {
            if (selectedIdx > 0) reorderPages(selectedIdx, selectedIdx - 1);
          }}
          disabled={selectedIdx <= 0}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
          title="Move page left"
        >
          <ChevronLeft size={14} />
        </button>

        <button
          onClick={() => {
            if (selectedIdx < pages.length - 1) reorderPages(selectedIdx, selectedIdx + 1);
          }}
          disabled={selectedIdx >= pages.length - 1}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
          title="Move page right"
        >
          <ChevronRight size={14} />
        </button>

        <button
          onClick={() => duplicatePage(selectedPageId)}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          title="Duplicate page"
        >
          <Copy size={14} />
        </button>

        <button
          onClick={() => removePage(selectedPageId)}
          disabled={pages.length <= 1}
          className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
          title="Delete page"
        >
          <Trash2 size={14} />
        </button>

        <div className="w-px h-5 bg-[var(--border)] mx-1" />

        {/* Page title edit */}
        <input
          type="text"
          value={pages[selectedIdx]?.title ?? ''}
          onChange={(e) => updatePage(selectedPageId, { title: e.target.value })}
          className="w-24 px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs"
          placeholder="Page title"
        />

        {/* Duration */}
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={pages[selectedIdx]?.duration ?? 10}
            onChange={(e) => updatePage(selectedPageId, { duration: Math.max(1, parseInt(e.target.value) || 10) })}
            min={1}
            className="w-12 px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs text-center"
          />
          <span className="text-[10px] text-[var(--text-muted)]">sec</span>
        </div>
      </div>

      {/* Right: zoom controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setZoom(zoom - 0.1)}
          disabled={zoom <= 0.1}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>

        <button
          onClick={handleFitToScreen}
          className="px-2 py-0.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors font-mono"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          onClick={() => setZoom(zoom + 0.1)}
          disabled={zoom >= 5}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>

        <button
          onClick={handleFitToScreen}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
          title="Fit to screen"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
