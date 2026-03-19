/** Double-buffer renderer coordinator. Routes content to the right sub-renderer. */

import { renderVideo } from './avplayer.js';
import { renderImage } from './image.js';
import { renderIframe } from './iframe.js';
import { renderDocument } from './document.js';

export interface ContentItem {
  id: string;
  type: string;
  name?: string;
  filePath?: string | null;
  webUrl?: string | null;
  duration?: number | null;
}

class Renderer {
  async play(content: ContentItem): Promise<void> {
    const { type } = content;
    if (type === 'video') {
      await renderVideo(content);
    } else if (type === 'image') {
      await renderImage(content);
    } else if (type === 'web_url' || type === 'html5') {
      await renderIframe(content);
    } else if (type === 'pdf' || type === 'presentation') {
      await renderDocument(content);
    }
  }

  stop(): void {
    // Clear both layers
    const a = document.getElementById('layer-a');
    const b = document.getElementById('layer-b');
    if (a) a.innerHTML = '';
    if (b) { b.innerHTML = ''; (b as HTMLElement).style.display = 'none'; }
  }
}

export const renderer = new Renderer();
