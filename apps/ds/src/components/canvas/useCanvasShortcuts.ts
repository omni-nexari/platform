import { useEffect, useCallback } from 'react';
import { useCanvasStore } from '../../lib/canvasStore.js';

/** Global keyboard shortcuts for the canvas editor */
export function useCanvasShortcuts() {
  const {
    undo, redo, removeElements, duplicateSelected,
    selectedElementIds, selectElements, currentElements,
  } = useCanvasStore();

  const handler = useCallback((e: KeyboardEvent) => {
    // Ignore when typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const mod = e.ctrlKey || e.metaKey;

    // Undo: Ctrl+Z
    if (mod && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }

    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((mod && e.key === 'z' && e.shiftKey) || (mod && e.key === 'y')) {
      e.preventDefault();
      redo();
      return;
    }

    // Delete selected
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0) {
      e.preventDefault();
      removeElements(selectedElementIds);
      return;
    }

    // Duplicate: Ctrl+D
    if (mod && e.key === 'd') {
      e.preventDefault();
      duplicateSelected();
      return;
    }

    // Select all: Ctrl+A
    if (mod && e.key === 'a') {
      e.preventDefault();
      const els = currentElements();
      selectElements(els.filter((el) => !el.locked).map((el) => el.id));
      return;
    }

    // Nudge with arrow keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedElementIds.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const { updateElement, pages, selectedPageId } = useCanvasStore.getState();
      const page = pages.find((p) => p.id === selectedPageId);
      if (!page) return;
      for (const id of selectedElementIds) {
        const el = page.elements.find((e) => e.id === id);
        if (el && !el.locked) {
          updateElement(id, { x: el.x + dx, y: el.y + dy });
        }
      }
      return;
    }

    // Escape — deselect
    if (e.key === 'Escape') {
      useCanvasStore.getState().clearSelection();
      return;
    }
  }, [undo, redo, removeElements, duplicateSelected, selectedElementIds, selectElements, currentElements]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
