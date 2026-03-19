/** Image renderer — CSS double-buffer crossfade */
import type { ContentItem } from './index.js';
import { getApiBase } from '../store.js';

let activeLayer: 'a' | 'b' = 'a';

export async function renderImage(content: ContentItem): Promise<void> {
  const url = content.filePath
    ? `${getApiBase()}/content/${content.id}/file`
    : (content.webUrl ?? '');

  const next: 'a' | 'b' = activeLayer === 'a' ? 'b' : 'a';
  const nextEl = document.getElementById(`layer-${next}`) as HTMLDivElement;
  const prevEl = document.getElementById(`layer-${activeLayer}`) as HTMLDivElement;

  // Preload into the hidden layer
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
    nextEl.innerHTML = '';
    nextEl.style.background = `url('${url}') center/contain no-repeat #000`;
    nextEl.style.opacity = '0';
    nextEl.style.display = 'block';
    nextEl.style.transition = 'opacity 0.4s ease';
    img.src = url;
  });

  // Crossfade
  requestAnimationFrame(() => {
    nextEl.style.opacity = '1';
    requestAnimationFrame(() => {
      prevEl.style.opacity = '0';
      setTimeout(() => {
        prevEl.style.display = 'none';
        prevEl.innerHTML = '';
        activeLayer = next;
      }, 450);
    });
  });
}
