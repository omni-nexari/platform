/**
 * logger.ts
 * Console + on-screen log panel + Pi relay (/api/v1/test-sync/log).
 */

type Level = 'info' | 'warn' | 'error';

interface Entry {
  deviceId: string;
  level: Level;
  msg: string;
  ts: number;
  driftMs?: number;
}

let _piBase   = '';
let _deviceId = '';
let _queue: Entry[] = [];
let _flushing = false;

export function initLogger(piBase: string, deviceId: string): void {
  _piBase   = piBase;
  _deviceId = deviceId;
  setInterval(_flush, 2000);
}

function _push(level: Level, msg: string, driftMs?: number): void {
  const entry: Entry = { deviceId: _deviceId, level, msg, ts: Date.now() };
  if (driftMs !== undefined) entry.driftMs = driftMs;
  (console[level] ?? console.log)(`[${level.toUpperCase()}] ${msg}`);
  _appendToUi(level, msg);
  if (_piBase && _deviceId) _queue.push(entry);
}

export const logger = {
  info:  (msg: string)                  => _push('info',  msg),
  warn:  (msg: string)                  => _push('warn',  msg),
  error: (msg: string)                  => _push('error', msg),
  drift: (msg: string, driftMs: number) => _push('info',  msg, driftMs),
};

function _appendToUi(level: Level, msg: string): void {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const cls = level === 'warn' ? 'l-warn' : level === 'error' ? 'l-error' : msg.includes('drift') ? 'l-drift' : 'l-info';
  const line = document.createElement('div');
  line.className = cls;
  const t = new Date().toISOString().slice(11, 23);
  line.innerHTML = `<span class="l-ts">${t}</span>${_esc(msg)}`;
  panel.appendChild(line);
  while (panel.children.length > 201) panel.removeChild(panel.children[1]); // keep title + 200 lines
  panel.scrollTop = panel.scrollHeight;
}

function _esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function _flush(): Promise<void> {
  if (_flushing || !_queue.length || !_piBase) return;
  _flushing = true;
  const batch = _queue.splice(0, 20);
  try {
    for (const entry of batch) {
      // Use Promise.race timeout so a hung fetch never freezes the flush loop
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('log flush timeout')), 3000),
      );
      await Promise.race([
        fetch(`${_piBase}/api/v1/test-sync/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }),
        timeout,
      ]);
    }
  } catch { /* best-effort */ } finally {
    _flushing = false;
  }
}
