"use strict";
/**
 * ntp-client.ts
 * Multi-sample NTP offset estimation against the Pi /time endpoint.
 * Uses 8 samples with RTT filtering + EWMA smoothing, same algorithm as
 * the main player's syncTimeWithServer().
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNtpOffset = getNtpOffset;
exports.getSyncedTime = getSyncedTime;
exports.setNtpOffset = setNtpOffset;
exports.syncTime = syncTime;
const NTP_SAMPLES = 8;
const RTT_LIMIT_MS = 300;
const SNAP_THRESHOLD = 80; // ms delta before EWMA snaps instead of blends
const EWMA_ALPHA = 0.2; // blend weight for subsequent updates
let _offsetMs = 0;
/** Returns the current best NTP offset in milliseconds. */
function getNtpOffset() { return _offsetMs; }
/** Returns Date.now() adjusted by the current NTP offset. */
function getSyncedTime() { return Date.now() + _offsetMs; }
/** Overwrites the NTP offset (used by p2p-sync-client for leader-derived offsets). */
function setNtpOffset(ms) { _offsetMs = ms; }
/**
 * Synchronise with the Pi /time endpoint.
 * Returns the new offset in milliseconds.
 * Resolves even if all samples fail (returns the previous offset).
 */
function syncTime(piBase) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${piBase}/time`;
        const good = [];
        for (let i = 0; i < NTP_SAMPLES; i++) {
            try {
                const t0 = Date.now();
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 1500);
                const res = yield fetch(url, { signal: ctrl.signal });
                clearTimeout(tid);
                const t3 = Date.now();
                const json = yield res.json();
                const ts = Number(json === null || json === void 0 ? void 0 : json.timestamp);
                if (!isFinite(ts))
                    continue;
                const rtt = t3 - t0;
                if (rtt > RTT_LIMIT_MS)
                    continue;
                good.push({ offset: ts - t0 - rtt / 2, rtt });
            }
            catch ( /* skip bad sample */_a) { /* skip bad sample */ }
            // Short inter-sample delay
            yield new Promise((r) => setTimeout(r, 20));
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
        return { offsetMs: Math.round(_offsetMs), rttMs: Math.round(best.rtt), samples: good.length };
    });
}
