/**
 * clock.ts — NTP-style clock offset measurement against Pi relay
 *
 * Why: Tizen 7 (QBC) and Tizen 4 (SBB) NTP-sync independently — their Date.now()
 * can differ by 20-60ms. The play epoch in GO is meaningless if each device
 * interprets it on its own skewed clock.
 *
 * Solution: measure offsetMs such that  serverTime ≈ localTime + offsetMs.
 * Leader sends GO playAt in SERVER time; each device converts to its own local
 * clock before scheduling. Both align to the relay's clock as canonical truth.
 *
 * Mini-NTP per sample:
 *   t1 = local before fetch
 *   t2 = serverTimeMs returned by /time
 *   t3 = local after fetch
 *   rtt    = t3 - t1
 *   offset = t2 + rtt/2 - t3        (symmetric one-way delay assumption)
 * 7 samples, pick min-RTT (best symmetry).
 *
 * TODO (future): replace this with leader-as-clock-source over WebSocket on
 * the LAN, removing dependency on the Pi relay for ongoing syncplay.
 */
import { logger } from './logger.js';

let _offsetMs  = 0;
let _measured  = false;
let _bestRttMs = -1;

export function getOffsetMs():   number  { return _offsetMs; }
export function getBestRttMs():  number  { return _bestRttMs; }
export function isMeasured():    boolean { return _measured; }
export function localToServer(localMs: number):  number { return localMs  + _offsetMs; }
export function serverToLocal(serverMs: number): number { return serverMs - _offsetMs; }

export async function measureOffset(piBase: string, samples = 7): Promise<number> {
  const results: { offset: number; rtt: number }[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const t1  = Date.now();
      const res = await fetch(`${piBase}/api/v1/test-sync/time`, { cache: 'no-store' as any });
      const t3  = Date.now();
      if (!res.ok) { logger.warn(`[Clock] sample ${i} HTTP ${res.status}`); continue; }
      const data = await res.json();
      const t2: number = Number(data.serverTimeMs);
      if (!isFinite(t2)) continue;
      const rtt    = t3 - t1;
      const offset = t2 + rtt / 2 - t3;
      results.push({ offset, rtt });
    } catch (e: any) {
      logger.warn(`[Clock] sample ${i} failed: ${e?.message}`);
    }
    await new Promise<void>((r) => setTimeout(r, 50));
  }

  if (results.length === 0) {
    logger.warn('[Clock] no samples succeeded — using offset=0');
    _offsetMs = 0; _measured = false; _bestRttMs = -1;
    return 0;
  }

  results.sort((a, b) => a.rtt - b.rtt);
  const best = results[0];
  _offsetMs  = Math.round(best.offset);
  _bestRttMs = best.rtt;
  _measured  = true;

  const summary = results.map((r) => `rtt=${r.rtt}ms off=${Math.round(r.offset)}ms`).join('; ');
  logger.info(`[Clock] offset=${_offsetMs}ms bestRtt=${_bestRttMs}ms samples=${results.length} | ${summary}`);
  return _offsetMs;
}
