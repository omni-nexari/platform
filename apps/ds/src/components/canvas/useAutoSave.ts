import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '../../lib/canvasStore.js';
import { api } from '../../lib/api.js';

/**
 * Subscription-based debounced auto-save.
 *
 * - Fires 3 s after the LAST mutation (dirty false→true transition).
 * - `everDirty` guards against saving sessions where the user never made a
 *   change (e.g. open → immediately close, or stale dirty flag from a
 *   previous Zustand module-level session).
 * - No flush on unmount — avoids double-save races with manual save.
 * - No setInterval — no periodic saves on unmodified canvases.
 */
export function useAutoSave(debounceMs = 3000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const everDirty = useRef(false);

  const save = useCallback(async () => {
    const { projectId, pages, settings, dirty } = useCanvasStore.getState();
    if (!projectId || !dirty || !everDirty.current || saving.current) return;

    saving.current = true;
    try {
      await api.patch(`/canvas/${projectId}/auto-save`, {
        sceneData: { pages },
        settings,
      });
      useCanvasStore.getState().markClean();
    } catch {
      // Silently fail — user can manually save
    } finally {
      saving.current = false;
    }
  }, []);

  // Subscribe to dirty transitions to debounce saves
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.dirty && !prev.dirty) {
        // First mutation this session — arm the guard
        everDirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void save(); }, debounceMs);
      }
      if (!state.dirty && prev.dirty) {
        // Manual save cleared dirty — cancel pending debounce
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      }
    });

    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
      // No flush on unmount — prevents saving after resetProject clears projectId
    };
  }, [save, debounceMs]);

  // Reset everDirty when a new project is loaded so a fresh open never saves
  useEffect(() => {
    return useCanvasStore.subscribe((state, prev) => {
      if (state.projectId !== prev.projectId) {
        everDirty.current = false;
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      }
    });
  }, []);

  return { saveNow: save };
}
