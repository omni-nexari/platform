/**
 * OSD (On-Screen Display) — shown when the INFO remote button is pressed.
 * Hold INFO for 3 s to enter the debug overlay.
 */

import { state } from '../state.js';

const LOG_BUFFER: string[] = [];
const MAX_LOG = 200;

export function appendLog(msg: string): void {
  LOG_BUFFER.push(`[${new Date().toISOString()}] ${msg}`);
  if (LOG_BUFFER.length > MAX_LOG) LOG_BUFFER.shift();
}

export function dumpLogs(): void {
  import('../ws/manager.js').then(({ send }) =>
    send({
      type: 'device_log',
      payload: { lines: [...LOG_BUFFER], level: 'info' },
    }),
  );
}

export function showOsd(): void {
  const el = document.getElementById('osd')!;
  el.innerHTML = `
    <div style="
      position:absolute; top:2vh; right:2vw;
      background:rgba(0,0,0,0.75);
      color:#fff;
      font-family:monospace;
      font-size:1.4vw;
      padding:1.5vw 2vw;
      border-radius:8px;
      line-height:1.6;
    ">
      <b>Signage Player v1.0.0</b><br/>
      WS: ${state.wsConnected ? '🟢 Online' : '🔴 Offline'}<br/>
      Now: ${state.currentContentId ?? '—'}<br/>
    </div>
  `;
  el.style.display = 'block';
  setTimeout(hideOsd, 5000);
}

export function hideOsd(): void {
  document.getElementById('osd')!.style.display = 'none';
}
