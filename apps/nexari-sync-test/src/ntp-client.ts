/**
 * ntp-client.ts
 * Multi-sample NTP offset estimation against the Pi /time endpoint.
 * Uses 8 samples with RTT filtering + EWMA smoothing, same algorithm as
 * the main player's syncTimeWithServer().
 */

const NTP_SAMPLES    = 8;
const RTT_LIMIT_MS   = 300;
const SNAP_THRESHOLD = 80;   // ms delta before EWMA snaps instead of blends
const EWMA_ALPHA     = 0.2;  // blend weight for subsequent updates

export interface NtpResult {
  offsetMs: number;
  rttMs: number;
  samples: number;
}

let _offsetMs = 0;
let _monoBaseMs = _monotonicNow();
let _syncedBaseMs = Date.now();

function _monotonicNow(): number {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function _resetSyncedTimeBase(): void {
  _monoBaseMs = _monotonicNow();
  _syncedBaseMs = Date.now() + _offsetMs;
}

/** Returns the current best NTP offset in milliseconds. */
export function getNtpOffset(): number { return _offsetMs; }

/** Returns NTP-adjusted time advanced by a monotonic local clock. */
export function getSyncedTime(): number { return _syncedBaseMs + (_monotonicNow() - _monoBaseMs); }

/** Overwrites the NTP offset (used by p2p-sync-client for leader-derived offsets). */
export function setNtpOffset(ms: number): void {
  _offsetMs = ms;
  _resetSyncedTimeBase();
}

/**
 * Synchronise with the Pi /time endpoint.
 * Returns the new offset in milliseconds.
 * Resolves even if all samples fail (returns the previous offset).
 */
export async function syncTime(piBase: string): Promise<NtpResult> {
  const url = `${piBase}/time`;
  const good: Array<{ offset: number; rtt: number }> = [];

  for (let i = 0; i < NTP_SAMPLES; i++) {
    try {
      const t0 = Date.now();
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 1500);
      const res  = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      const t3   = Date.now();
      const json = await res.json() as { timestamp?: number };
      const ts   = Number(json?.timestamp);
      if (!isFinite(ts)) continue;
      const rtt  = t3 - t0;
      if (rtt > RTT_LIMIT_MS) continue;
      good.push({ offset: ts - t0 - rtt / 2, rtt });
    } catch { /* skip bad sample */ }
    // Short inter-sample delay
    await new Promise((r) => setTimeout(r, 20));
  }

  if (good.length === 0) {
    return { offsetMs: _offsetMs, rttMs: 0, samples: 0 };
  }

  good.sort((a, b) => a.rtt - b.rtt);
  const best = good[0];
  const prev = _offsetMs;
  const delta = Math.abs(best.offset - prev);
  _offsetMs = delta > SNAP_THRESHOLD
    ? best.offset
    : prev * (1 - EWMA_ALPHA) + best.offset * EWMA_ALPHA;
  _resetSyncedTimeBase();

  return { offsetMs: Math.round(_offsetMs), rttMs: Math.round(best.rtt), samples: good.length };
}
