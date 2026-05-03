/**
 * ntp-client.ts
 * Shared sync clock.
 *
 * The raw clock is seeded from Tizen Time API when available, then advanced by
 * performance.now() so playback math is monotonic. The offset can be calibrated
 * from a server timestamp or, preferably for local playback, from the elected
 * leader using an NTP-style request/reply exchange.
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
let _rawBaseMs = _readDeviceTimeMs();
let _syncedBaseMs = _rawBaseMs;
let _clockSource = 'device';

function _monotonicNow(): number {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function _readDeviceTimeMs(): number {
  try {
    const tzDate = (window as any).tizen?.time?.getCurrentDateTime?.();
    if (tzDate) {
      const utc = typeof tzDate.toUTC === 'function' ? tzDate.toUTC() : tzDate;
      const ms = Date.UTC(
        typeof utc.getUTCFullYear === 'function' ? utc.getUTCFullYear() : utc.getFullYear(),
        typeof utc.getUTCMonth === 'function' ? utc.getUTCMonth() : utc.getMonth(),
        typeof utc.getUTCDate === 'function' ? utc.getUTCDate() : utc.getDate(),
        typeof utc.getUTCHours === 'function' ? utc.getUTCHours() : utc.getHours(),
        typeof utc.getUTCMinutes === 'function' ? utc.getUTCMinutes() : utc.getMinutes(),
        typeof utc.getUTCSeconds === 'function' ? utc.getUTCSeconds() : utc.getSeconds(),
        typeof utc.getUTCMilliseconds === 'function' ? utc.getUTCMilliseconds() : utc.getMilliseconds(),
      );
      if (isFinite(ms)) {
        _clockSource = 'tizen-time';
        return ms;
      }
    }
  } catch {}
  _clockSource = 'date-now';
  return Date.now();
}

function _resetSyncedTimeBase(): void {
  _monoBaseMs = _monotonicNow();
  _rawBaseMs = _readDeviceTimeMs();
  _syncedBaseMs = _rawBaseMs + _offsetMs;
}

function _applyOffsetSample(offset: number, rtt: number, samples: number, source: string): NtpResult {
  const prev = _offsetMs;
  const delta = Math.abs(offset - prev);
  _offsetMs = delta > SNAP_THRESHOLD
    ? offset
    : prev * (1 - EWMA_ALPHA) + offset * EWMA_ALPHA;
  _resetSyncedTimeBase();
  _clockSource = source;

  return { offsetMs: Math.round(_offsetMs), rttMs: Math.round(rtt), samples };
}

/** Re-seeds the raw clock from Tizen Time API/Date and performance.now(). */
export function initializeDeviceClock(): void { _resetSyncedTimeBase(); }

/** Returns the current best NTP offset in milliseconds. */
export function getNtpOffset(): number { return _offsetMs; }

/** Returns a short label for the latest authority used to calibrate the clock. */
export function getClockSource(): string { return _clockSource; }

/** Returns the uncorrected local clock advanced by performance.now(). */
export function getLocalClockTime(): number { return _rawBaseMs + (_monotonicNow() - _monoBaseMs); }

/** Returns NTP-adjusted time advanced by a monotonic local clock. */
export function getSyncedTime(): number { return _syncedBaseMs + (_monotonicNow() - _monoBaseMs); }

/** Overwrites the NTP offset (used by p2p-sync-client for leader-derived offsets). */
export function setNtpOffset(ms: number): void {
  _offsetMs = ms;
  _resetSyncedTimeBase();
  _clockSource = 'manual';
}

/** Fold a server timestamp from any Pi HTTP response into the clock estimate. */
export function observeServerTime(serverTimestampMs: number, t0Ms: number, t3Ms: number): NtpResult | null {
  const ts = Number(serverTimestampMs);
  if (!isFinite(ts)) return null;
  const rtt = Math.max(0, t3Ms - t0Ms);
  if (rtt > RTT_LIMIT_MS) return null;
  const offset = ts - t0Ms - rtt / 2;
  return _applyOffsetSample(offset, rtt, 1, 'server');
}

/** Fold a leader/peer NTP-style response into the clock estimate. */
export function observeRemoteClock(
  remoteReceiveMs: number,
  remoteSendMs: number,
  localSendMs: number,
  localReceiveMs: number,
  samples: number,
  source = 'leader',
): NtpResult | null {
  const t0 = Number(localSendMs);
  const t1 = Number(remoteReceiveMs);
  const t2 = Number(remoteSendMs);
  const t3 = Number(localReceiveMs);
  if (![t0, t1, t2, t3].every(isFinite)) return null;
  const remoteProcessingMs = Math.max(0, t2 - t1);
  const rtt = Math.max(0, (t3 - t0) - remoteProcessingMs);
  if (rtt > RTT_LIMIT_MS) return null;
  const offset = ((t1 - t0) + (t2 - t3)) / 2;
  return _applyOffsetSample(offset, rtt, samples, source);
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
      const t0 = getLocalClockTime();
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 1500);
      const res  = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      const t3   = getLocalClockTime();
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
  return _applyOffsetSample(best.offset, best.rtt, good.length, 'server');
}
