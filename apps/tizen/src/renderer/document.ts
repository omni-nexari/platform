/**
 * Document renderer — PDF and PPTX via webapis.document (Partner cert required).
 * Falls back to iframe-based rendering for dev.
 */
import type { ContentItem } from './index.js';
import { getApiBase } from '../store.js';

export async function renderDocument(content: ContentItem): Promise<void> {
  if (typeof webapis === 'undefined') {
    // Dev fallback — iframe
    const layer = document.getElementById('layer-a') as HTMLDivElement;
    layer.innerHTML = `<iframe src="${getApiBase()}/content/${content.id}/file" style="width:100%;height:100%;border:none;"></iframe>`;
    return;
  }

  const filePath = `wgt-private/${content.id}/${content.filePath?.split('/').pop() ?? 'file'}`;
  try {
    webapis.document.open({
      docpath: filePath,
      rect: { left: 0, top: 0, right: window.screen.width, bottom: window.screen.height },
    });
    const slideTimeMs = (content.duration ?? 10) * 1000;
    webapis.document.play(slideTimeMs);
  } catch (e) {
    console.error('[document] failed to open:', e);
  }
}
