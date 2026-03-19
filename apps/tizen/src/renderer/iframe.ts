/** iframe renderer — web_url and extracted html5 zip */
import type { ContentItem } from './index.js';
import { getApiBase } from '../store.js';

export async function renderIframe(content: ContentItem): Promise<void> {
  const url = content.type === 'web_url'
    ? (content.webUrl ?? '')
    : `${getApiBase()}/content/${content.id}/file`;

  const layer = document.getElementById('layer-a') as HTMLDivElement;
  layer.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.style.cssText = 'width:100%;height:100%;border:none;background:#000;';
  frame.setAttribute('allow', 'autoplay; fullscreen');
  layer.appendChild(frame);
}
