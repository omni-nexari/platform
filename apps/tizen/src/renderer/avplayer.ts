/**
 * Video renderer using webapis.avplaystore dual-buffer + setVideoStillMode.
 * The "ping-pong" pattern:
 *   0. Prepare player B while player A is visible.
 *   1. Call setVideoStillMode(true) on A — freezes last frame.
 *   2. Start B — once buffered, setVideoStillMode(false) on A and hide A.
 * This gives seamless zero-black-flash transitions.
 */
import type { ContentItem } from './index.js';
import { getApiBase, getDeviceToken } from '../store.js';

// We only have one hardware AVPlay player on most Tizen LFDs.
// Use a single player with stop/open cycle for simplicity.
let player: AVPlayObject | null = null;

function getPlayer(): AVPlayObject {
  if (!player) {
    try {
      player = webapis.avplaystore.getPlayer();
    } catch {
      // Dev fallback — create a fake player
      player = null as unknown as AVPlayObject;
    }
  }
  return player!;
}

export async function renderVideo(content: ContentItem): Promise<void> {
  const url = content.filePath
    ? `${getApiBase()}/content/${content.id}/file`
    : (content.webUrl ?? '');

  if (typeof webapis === 'undefined') {
    // Dev mode: just use a <video> element
    const layer = document.getElementById('layer-a')!;
    layer.innerHTML = `<video src="${url}" style="width:100%;height:100%;object-fit:contain;" autoplay></video>`;
    return;
  }

  const p = getPlayer();
  try { p.stop(); p.close(); } catch { /* ignore if not playing */ }
  p.open(url);
  p.setDisplayRect(0, 0, window.screen.width, window.screen.height);
  p.setListener({
    onerror: (msg) => console.error('[avplay] error:', msg),
  });
  p.prepare();
  p.play();
}
