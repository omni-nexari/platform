/**
 * Browser-side log capture for the DS dashboard.
 *
 * - Intercepts console.warn + console.error
 * - Captures window.onerror and unhandledrejection
 * - Batches entries and flushes to POST /api/v1/logs/ingest every 10 s
 *   or immediately on page unload (via sendBeacon)
 *
 * Call `initRemoteLogger()` once at app startup, before anything else logs.
 */

const FLUSH_INTERVAL_MS = 10_000;
// Use a root-relative path so it works in both dev (vite proxy) and production (nginx)
const INGEST_URL = '/api/v1/logs/ingest';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface Entry {
  level: Level;
  message: string;
  meta: Record<string, unknown> | undefined;
  createdAt: string;
}

const queue: Entry[] = [];

function enqueue(level: Level, message: string, meta?: Record<string, unknown>) {
  queue.push({ level, message, meta: meta, createdAt: new Date().toISOString() });
}

function argsToString(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    })
    .join(' ');
}

/** Ship the current queue. Returns silently on any failure. */
async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(INGEST_URL, {
      method: 'POST',
      credentials: 'include',          // send session cookie
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch, source: 'ds' }),
    });
  } catch {
    // Silently drop — never throw inside a logging utility
  }
}

/** Use sendBeacon on unload so the request survives page teardown. */
function flushBeacon() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  const payload = JSON.stringify({ entries: batch, source: 'ds' });
  navigator.sendBeacon(INGEST_URL, new Blob([payload], { type: 'application/json' }));
}

let _initialized = false;

export function initRemoteLogger() {
  if (_initialized) return;
  _initialized = true;

  // ── Intercept console.warn ─────────────────────────────────────────────
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    enqueue('warn', argsToString(args));
  };

  // ── Intercept console.error ────────────────────────────────────────────
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    enqueue('error', argsToString(args));
  };

  // ── Global JS errors ───────────────────────────────────────────────────
  window.addEventListener('error', (event) => {
    enqueue('error', event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  // ── Unhandled promise rejections ───────────────────────────────────────
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `Unhandled rejection: ${reason.message}`
        : `Unhandled rejection: ${String(reason)}`;
    enqueue('error', message, {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // ── Periodic flush ─────────────────────────────────────────────────────
  setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);

  // ── Flush on unload ────────────────────────────────────────────────────
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBeacon();
  });
  window.addEventListener('pagehide', flushBeacon);
}
