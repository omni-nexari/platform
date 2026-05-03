/**
 * logger.ts
 * Wraps console.log and posts entries to the Pi test-sync /log endpoint.
 * Every entry includes engineMode and driftMs so the DS page can parse metrics.
 */

export interface LogEntry {
  deviceId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  ts: number;
  engineMode?: string;
  driftMs?: number;
  ntpOffsetMs?: number;
}

let _piBase    = '';
let _deviceId  = '';
let _engineMode: string = 'mse';
let _ntpOffset  = 0;
let _queue: LogEntry[] = [];
let _flushing   = false;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 2000;

export function initLogger(piBase: string, deviceId: string): void {
  _piBase   = piBase;
  _deviceId = deviceId;
  setInterval(_flush, FLUSH_INTERVAL_MS);
}

export function setLoggerEngine(mode: string): void { _engineMode = mode; }
export function setLoggerNtpOffset(ms: number): void { _ntpOffset = ms; }

function _push(level: LogEntry['level'], msg: string, extra?: { driftMs?: number }): void {
  const entry: LogEntry = {
    deviceId: _deviceId,
    level,
    msg,
    ts: Date.now(),
    engineMode: _engineMode,
    ntpOffsetMs: _ntpOffset,
    ...(extra?.driftMs !== undefined ? { driftMs: extra.driftMs } : {}),
  };
  console[level](`[${level.toUpperCase()}] ${msg}`);
  if (_piBase) _queue.push(entry);
}

export const logger = {
  debug: (msg: string) => _push('debug', msg),
  info:  (msg: string) => _push('info',  msg),
  warn:  (msg: string) => _push('warn',  msg),
  error: (msg: string) => _push('error', msg),
  drift: (msg: string, driftMs: number) => _push('info', msg, { driftMs }),
};

async function _flush(): Promise<void> {
  if (_flushing || !_queue.length || !_piBase) return;
  _flushing = true;
  const batch = _queue.splice(0, BATCH_SIZE);
  try {
    for (const entry of batch) {
      await fetch(`${_piBase}/api/v1/test-sync/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    }
  } catch { /* silent — log delivery is best-effort */ } finally {
    _flushing = false;
  }
}
