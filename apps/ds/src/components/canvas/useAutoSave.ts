import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '../../lib/canvasStore.js';
import { api } from '../../lib/api.js';

/** Debounced auto-save — persists scene data every few seconds when dirty */
export function useAutoSave(intervalMs = 4000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const save = useCallback(async () => {
    const { projectId, pages, settings, dirty } = useCanvasStore.getState();
    if (!projectId || !dirty || saving.current) return;

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

  useEffect(() => {
    timer.current = setInterval(() => { void save(); }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
      // Flush on unmount
      void save();
    };
  }, [save, intervalMs]);

  return { saveNow: save };
}
