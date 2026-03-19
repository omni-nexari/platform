/**
 * Download queue using tizen.download API.
 * Streams files to wgt-private storage and reports progress via WS.
 */
import { send } from '../ws/manager.js';
import { recordCached } from './manifest.js';
import { getApiBase, getDeviceToken } from '../store.js';

export interface DownloadTask {
  id: string; // contentId or 'ota-<version>'
  url: string;
  fileName: string;
  type: 'content' | 'ota';
  sha256?: string;
}

const queue: DownloadTask[] = [];
let active = false;

export function queueDownload(task: DownloadTask): void {
  if (queue.some((t) => t.id === task.id)) return;
  queue.push(task);
  if (!active) processNext();
}

function processNext(): void {
  const task = queue.shift();
  if (!task) { active = false; return; }
  active = true;

  if (typeof tizen === 'undefined') {
    // Dev fallback: fetch via browser
    fetch(task.url, { headers: { Authorization: `Bearer ${getDeviceToken() ?? ''}` } })
      .then(() => {
        recordCached({ contentId: task.id, fileName: task.fileName, sha256: '', cachedAt: Date.now() });
        send({ type: 'download_progress', payload: { contentId: task.id, progressPct: 100, bytesDownloaded: 0, totalBytes: 0 } });
        processNext();
      })
      .catch(() => processNext());
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = new (tizen.download as any).DownloadRequest(task.url, `wgt-private/${task.id}`, task.fileName);
  const downloadId = tizen.download.start(req, {
    onprogress(id: number, received: number, total: number) {
      const pct = total > 0 ? Math.round((received / total) * 100) : 0;
      send({ type: 'download_progress', payload: { contentId: task.id, progressPct: pct, bytesDownloaded: received, totalBytes: total } });
    },
    oncompleted(_id: number, _fullPath: string) {
      recordCached({ contentId: task.id, fileName: task.fileName, sha256: task.sha256 ?? '', cachedAt: Date.now() });
      processNext();
    },
    onfailed() {
      console.error('[downloader] failed:', task.id);
      processNext();
    },
  });

  // Store download id for potential cancel
  void downloadId;
}
