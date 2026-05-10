/**
 * logger.ts — Lightweight logger for player-web.
 *
 * All log calls are:
 *   1. Printed to console (visible in Chrome DevTools / logcat)
 *   2. Stored in a ring buffer (window.LogBuffer) so the player can drain and
 *      relay them to the server via the WS `device_log` message on demand.
 *
 * The HTTP flush to /test-sync/log is retained as a best-effort fallback for
 * Pi/standalone deployments that have no WS connection.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

interface BufferEntry {
  level: Level;
  message: string;
  timestamp: string;
}

// ── Ring buffer ──────────────────────────────────────────────────────────────

const MAX_BUF = 2000;
const ringBuffer: BufferEntry[] = [];

function appendBuf(level: Level, message: string): void {
  if (ringBuffer.length >= MAX_BUF) ringBuffer.shift();
  ringBuffer.push({ level, message, timestamp: new Date().toISOString() });
}

// Exposed on window so player.ts flushLogStream() can drain it
(window as unknown as Record<string, unknown>)['LogBuffer'] = {
  drain(n: number): BufferEntry[] {
    const take = Math.min(n, ringBuffer.length);
    return take > 0 ? ringBuffer.splice(0, take) : [];
  },
};

// ── HTTP fallback flush (for Pi / headless deployments) ───────────────────────

let _apiBase = '';
let _deviceId = '';
let _onLine: ((level: Level, msg: string) => void) | null = null;
let _httpQueue: { deviceId: string; level: Level; msg: string; ts: number }[] = [];
let _flushing = false;

export interface LoggerInit {
  apiBase: string;
  deviceId: string;
  onLine?: (level: Level, msg: string) => void;
  flushIntervalMs?: number;
}

export function initLogger(opts: LoggerInit): void {
  _apiBase = opts.apiBase;
  _deviceId = opts.deviceId;
  _onLine = opts.onLine ?? null;
  setInterval(_flush, opts.flushIntervalMs ?? 30_000); // low-frequency HTTP fallback
}

function _push(level: Level, msg: string): void {
  const consoleFn = level === 'error' ? console.error
    : level === 'warn'  ? console.warn
    : level === 'debug' ? console.debug
    : console.info;
  consoleFn(`[${level.toUpperCase()}] ${msg}`);

  appendBuf(level, msg);

  if (_onLine) { try { _onLine(level, msg); } catch { /* ignore */ } }
  if (_apiBase && _deviceId) _httpQueue.push({ deviceId: _deviceId, level, msg, ts: Date.now() });
}

export const logger = {
  debug: (msg: string) => _push('debug', msg),
  info:  (msg: string) => _push('info',  msg),
  warn:  (msg: string) => _push('warn',  msg),
  error: (msg: string) => _push('error', msg),
  /** @deprecated Use info/warn/error instead. Kept for sync engine compat. */
  drift: (msg: string, _driftMs: number) => _push('info', msg),
};

async function _flush(): Promise<void> {
  if (_flushing || !_httpQueue.length || !_apiBase) return;
  _flushing = true;
  const batch = _httpQueue.splice(0, 50);
  try {
    await fetch(`${_apiBase}/devices/device/${encodeURIComponent(_deviceId)}/logs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
    });
  } catch { /* best-effort */ }
  finally { _flushing = false; }
}

