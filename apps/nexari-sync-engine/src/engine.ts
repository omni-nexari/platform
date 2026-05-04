/**
 * engine.ts — HTML5 <video> engine for Nexari Sync Engine (single-engine build)
 *
 * Public API (consumed by app.ts and sync.ts):
 *   initEngine(container)            — create the <video> element
 *   prepare(url)                     — load + canplaythrough
 *   schedulePlayAt(epochMs)          — coarse setTimeout + 4ms spin → play()
 *   destroyEngine()                  — tear down
 *   getDuration()                    — ms
 *   isPlaying()                      — boolean
 *   getCurrentPosMs()                — current playhead ms (or null)
 *   nudgePhase(deltaMs)              — playbackRate rubber-band drift correction
 *
 * Layout policy (matches AVPlay engine behaviour):
 *   - object-fit: contain  → portrait content fills portrait panel (QBC) and
 *     letterboxes on landscape panel (SBB) with black bars on the sides.
 *   - We rely on the OS-level panel orientation reported via window.screen
 *     (AVPlay engine used the same heuristic). No CSS rotation is needed.
 */
import { logger } from './logger.js';

let _video:         HTMLVideoElement | null = null;
let _destroyed      = false;
let _playing        = false;
let _durationMs     = 0;
let _playAtEpoch    = -1;
let _playStartEpoch = -1;
let _playTimer: any = null;
let _lastDriftLog   = 0;

// Actual-rate probe: sample (currentTime, wallClock) each drift tick and
// compute Δct/Δwall to see if the hardware decoder runs below 1×.
let _prevProbeCt  = -1;   // seconds
let _prevProbeWall = -1;  // ms

// Startup re-anchor grace window (ms): allow large _playStartEpoch corrections
// for this long after play() starts. Tizen 4 can take ~7s before the first
// real frame, and the video may play a "catch-up" burst at >1× rate during
// pipeline init. We keep the large-correction window open for the whole startup
// period instead of using a one-shot flag that fires too early.
const STARTUP_ANCHOR_GRACE_MS = 15000;
let _playStartedAt = -1;   // wall clock ms when _doPlay() called play()

// playbackRate rubber-band state — see nudgePhase()
let _rateTimer: any = null;
const RATE_WINDOW_MS    = 2500;   // how long a correction is applied
                                  // (longer than sync tick @1500ms so rate
                                  // persists between successive nudges)
const RATE_MAX_OFFSET   = 0.10;   // ±10% rate clamp — more aggressive since
                                  // Tizen 4 only partially honours rate.
const RATE_MIN_DELTA_MS = 4;      // ignore tiny nudges

// ── Init ───────────────────────────────────────────────────────────────────────

export function initEngine(container: HTMLElement): void {
  _destroyed = false; _playing = false; _durationMs = 0;
  _playAtEpoch = -1; _playStartEpoch = -1;

  const portrait = window.screen.width < window.screen.height;
  logger.info(`[HTML5] init — screen=${window.screen.width}x${window.screen.height} layout=${portrait ? 'portrait' : 'landscape'}`);

  _video = document.createElement('video');
  // object-fit:contain → fill on matching aspect, letterbox otherwise.
  _video.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;'
    + 'object-fit:contain;background:#000;';
  _video.setAttribute('playsinline', '');
  _video.setAttribute('webkit-playsinline', '');
  _video.muted = true;            // autoplay-without-gesture compliance on Tizen
  // Native looping. Avoids the Tizen 4 quirk where seeking near end-of-video
  // (target ~= duration) lands at an arbitrary earlier position.
  _video.loop = true;
  container.appendChild(_video);

  // 'ended' should not fire while loop=true, but log if firmware ignores it.
  _video.addEventListener('ended', () => {
    logger.warn('[HTML5] ended fired despite loop=true — forcing replay');
    if (_video && !_destroyed) {
      try { _video.currentTime = 0; _video.play(); } catch {}
    }
  });

  _video.addEventListener('error', () => {
    logger.error(`[HTML5] video error: ${_video?.error?.message ?? 'unknown'} (code ${_video?.error?.code})`);
  });

  _video.addEventListener('timeupdate', () => {
    if (_destroyed || !_playing || _playStartEpoch < 0 || _durationMs <= 0) return;
    const now = Date.now();
    if (now - _lastDriftLog < 2000) return;
    _lastDriftLog = now;

    const v     = _video!;
    const posMs = Math.round((v.currentTime ?? 0) * 1000);

    // ── Actual decode rate probe ──────────────────────────────────────────
    // Compute first so we can gate _reanchorClock on a stable playback rate.
    let actualRate: number | null = null;
    let actualRateStr = '';
    const ct = v.currentTime ?? 0;
    if (_prevProbeCt >= 0 && _prevProbeWall >= 0) {
      const dtWall = (now - _prevProbeWall) / 1000;
      let   dtCt   = ct - _prevProbeCt;
      if (dtCt < -1) dtCt += _durationMs / 1000;
      if (dtWall > 0.1) {
        actualRate    = dtCt / dtWall;
        actualRateStr = ` actualRate=${actualRate.toFixed(3)}`;
      }
    }
    _prevProbeCt   = ct;
    _prevProbeWall = now;

    // Re-anchor the expected-clock only when the decoder is running at a
    // steady 1× rate (not during Tizen 4 catch-up bursts where actualRate
    // reaches 1.5×+). The burst lasts ~8-10s and corrupts _playStartEpoch
    // with each corrective tick. Guard with two conditions:
    //   1. actualRate must be in [0.85, 1.10] — burst runs at >1.2×
    //   2. at least STARTUP_ANCHOR_GRACE_MS ms must have elapsed since play()
    //      so that even a brief 1× reading during the burst doesn't slip through
    const inGrace = _playStartedAt >= 0 && (now - _playStartedAt) < STARTUP_ANCHOR_GRACE_MS;
    const rateOk  = actualRate === null || (actualRate >= 0.85 && actualRate <= 1.10);
    if (!inGrace && rateOk) {
      _reanchorClock();
    }

    const exp   = _expectedMs();
    const drift = posMs - exp;

    // ── Buffer fill probe ─────────────────────────────────────────────────
    let bufStr = '';
    try {
      const buf = v.buffered;
      if (buf && buf.length > 0) {
        const end = Math.round(buf.end(buf.length - 1) * 1000);
        bufStr = ` buf=0-${end}ms`;
      } else {
        bufStr = ' buf=empty';
      }
    } catch {}

    logger.drift(
      `[HTML5] pos=${posMs}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms`
      + ` rate=${v.playbackRate.toFixed(3)}${actualRateStr}${bufStr}`,
      drift,
    );
  });

  logger.info('[HTML5] <video> engine initialised');
}

// ── Prepare ────────────────────────────────────────────────────────────────────

export function prepare(url: string): Promise<void> {
  if (!_video || _destroyed) return Promise.reject(new Error('[HTML5] engine not initialised'));
  _playing = false; _durationMs = 0;

  return new Promise<void>((resolve, reject) => {
    const v = _video!;
    const cleanup = () => {
      v.removeEventListener('canplaythrough', onReady);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error',          onErr);
    };
    const onMeta = () => {
      _durationMs = Math.round((v.duration ?? 0) * 1000);
      logger.info(`[HTML5] loadedmetadata — duration=${_durationMs}ms videoSize=${v.videoWidth}x${v.videoHeight}`);
    };
    const onReady = async () => {
      cleanup();
      if (_durationMs <= 0) _durationMs = Math.round((v.duration ?? 0) * 1000);
      logger.info(`[HTML5] canplaythrough — duration=${_durationMs}ms`);

      // ── Decoder primer ────────────────────────────────────────────────
      // canplaythrough means "buffer is full enough" but on Tizen 4 the
      // first real play() still pays a 1-9s pipeline-warmup tax. Fix it
      // by actually starting playback for a few frames, then pausing and
      // rewinding to 0. The next play() reuses the warm pipeline and
      // starts within a frame, so READY now means "ready to play instantly".
      try {
        await _primeDecoder(v);
        logger.info('[HTML5] decoder primed — ready to play instantly');
      } catch (e: any) {
        logger.warn(`[HTML5] decoder prime failed (continuing): ${e?.message}`);
      }
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`[HTML5] load error: ${v.error?.message ?? 'unknown'}`));
    };

    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('canplaythrough', onReady);
    v.addEventListener('error',          onErr);

    v.src     = url;
    v.preload = 'auto';
    v.load();
    logger.info(`[HTML5] loading: ${url}`);
  });
}

/**
 * Force the decoder to allocate buffers and decode the first frames so
 * subsequent play() is instant on Tizen 4 (whose firmware otherwise
 * pays a 5-9s warmup tax on the first real play).
 *
 * Strategy: muted play() for a fixed 250ms (long enough to render real
 * frames), then pause, then seek back to 0, then explicitly reset
 * playbackRate. The fixed duration avoids racing with the 'playing'
 * event which on Tizen 4 fires before any frames are actually decoded.
 */
function _primeDecoder(v: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const PRIME_PLAY_MS = 250;

    const finish = () => {
      if (settled) return;
      settled = true;
      try { v.pause(); } catch {}
      // Seek back to 0 and wait for the seek to land before resolving
      // so the real play() starts at frame 0.
      const onSeeked = () => {
        v.removeEventListener('seeked', onSeeked);
        // Explicit rate reset — some firmwares retain stale rate state.
        try { v.playbackRate = 1.0; } catch {}
        resolve();
      };
      v.addEventListener('seeked', onSeeked);
      try { v.currentTime = 0; } catch { resolve(); }
      // Fallback in case 'seeked' never fires
      setTimeout(() => { v.removeEventListener('seeked', onSeeked); resolve(); }, 1500);
    };

    // Hard timeout — never block READY indefinitely.
    setTimeout(finish, 4000);

    v.muted = true;
    v.playbackRate = 1.0;
    v.play()
      .then(() => { setTimeout(finish, PRIME_PLAY_MS); })
      .catch(() => finish());
  });
}

// ── Scheduled play ─────────────────────────────────────────────────────────────

export function schedulePlayAt(epochMs: number): void {
  if (_destroyed) return;
  _playAtEpoch = epochMs;
  clearTimeout(_playTimer);

  const wait = epochMs - Date.now();
  logger.info(`[HTML5] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);

  if (wait <= 0) { _doPlay(); return; }

  _playTimer = setTimeout(() => {
    (function spin() {
      if (_destroyed) return;
      if (Date.now() >= _playAtEpoch) { _doPlay(); return; }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, wait - 60));
}

function _doPlay(): void {
  if (_destroyed || _playing || !_video) return;
  _video.currentTime = 0;
  _video.playbackRate = 1.0;
  _prevProbeCt   = -1;   // reset rate probe so first tick gets a clean baseline
  _prevProbeWall = -1;
  _video.play()
    .then(() => {
      _playing        = true;
      _playStartEpoch = _playAtEpoch > 0 ? _playAtEpoch : Date.now();
      _playStartedAt  = Date.now();   // start grace window for large re-anchors
      logger.info(`[HTML5] play() — startEpoch=${_playStartEpoch}`);
    })
    .catch((e: any) => logger.error(`[HTML5] play() failed: ${e?.message}`));
}

// ── Loop ───────────────────────────────────────────────────────────────────────
// (handled natively by `video.loop = true` set in initEngine)

// ── Public accessors used by sync.ts ───────────────────────────────────────────

export function getDuration():      number  { return _durationMs; }
export function isPlaying():        boolean { return _playing; }

export function getCurrentPosMs(): number | null {
  if (!_video || !_playing) return null;
  return Math.round((_video.currentTime ?? 0) * 1000);
}

/**
 * Hard catch-up seek used by the follower when startup-skew leaves it
 * far enough behind/ahead of the leader that rate correction can't close
 * the gap in a reasonable time. Refuses to seek inside the loop-boundary
 * danger zone (Tizen 4 lands at the wrong position when the target is
 * within ~500ms of duration).
 *
 * Returns true if the seek was issued, false if it was refused.
 */
export function hardSeekTo(posMs: number): boolean {
  if (_destroyed || !_playing || !_video || _durationMs <= 0) return false;
  const safe = 500;                       // avoid loop boundary on Tizen 4
  const clamped = Math.max(safe, Math.min(_durationMs - safe, posMs));
  if (Math.abs(clamped - posMs) > 1) {
    logger.info(`[HTML5] hardSeekTo ${posMs}ms refused (in loop-boundary zone)`);
    return false;
  }
  // Reset any pending rate correction — we're starting clean.
  clearTimeout(_rateTimer);
  _video.playbackRate = 1.0;
  _video.currentTime  = clamped / 1000;
  logger.info(`[HTML5] hardSeekTo ${clamped}ms`);
  return true;
}

/**
 * Plan C live drift correction — playbackRate rubber-band.
 *
 * Sign convention (matches sync.ts): deltaMs > 0 means "I'm ahead of group, slow me down".
 * We map the desired ms shift to a rate offset over a fixed window:
 *
 *   rate = 1 - (deltaMs / RATE_WINDOW_MS)   clamped to ±RATE_MAX_OFFSET
 *
 * After RATE_WINDOW_MS the rate snaps back to 1.0. With sync.ts damping (0.5)
 * and per-tick cap (80ms), the worst-case rate is ~5%, which is inaudible
 * for music/voice on consumer TVs and visually invisible.
 */
export function nudgePhase(deltaMs: number): void {
  if (_destroyed || !_playing || !_video) return;
  if (Math.abs(deltaMs) < RATE_MIN_DELTA_MS) return;

  // Smooth playbackRate rubber-band only. We deliberately do NOT seek mid-stream:
  // on Tizen 4 (SBB) seeks near the loop boundary land in unpredictable spots
  // and ping-pong with the leader. Drift correction therefore happens gradually.
  let rateOffset = -deltaMs / RATE_WINDOW_MS;
  if (rateOffset >  RATE_MAX_OFFSET) rateOffset =  RATE_MAX_OFFSET;
  if (rateOffset < -RATE_MAX_OFFSET) rateOffset = -RATE_MAX_OFFSET;
  const newRate = Math.max(0.5, Math.min(2.0, 1 + rateOffset));

  _video.playbackRate = newRate;
  clearTimeout(_rateTimer);
  _rateTimer = setTimeout(() => {
    if (_video && !_destroyed) _video.playbackRate = 1.0;
  }, RATE_WINDOW_MS);

  logger.info(`[HTML5] nudge drift=${deltaMs}ms → rate=${newRate.toFixed(3)} for ${RATE_WINDOW_MS}ms`);
}

// ── Teardown ───────────────────────────────────────────────────────────────────

export function destroyEngine(): void {
  _destroyed = true; _playing = false;
  clearTimeout(_playTimer);
  clearTimeout(_rateTimer);
  if (_video) {
    try { _video.pause(); } catch {}
    _video.src = '';
    try { _video.load(); } catch {}
    if (_video.parentNode) _video.parentNode.removeChild(_video);
    _video = null;
  }
  logger.info('[HTML5] engine destroyed');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _expectedMs(): number {
  if (_playStartEpoch < 0 || _durationMs <= 0) return 0;
  return ((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs;
}

/**
 * Re-anchor _playStartEpoch so exp tracks the actual decoder position.
 * Called once per drift tick. Without this, the initial play() latency
 * (difference between scheduled GO epoch and first real frame) accumulates
 * as a fixed offset that grows ~linearly with loops.
 *
 * We compute what _playStartEpoch SHOULD be given the video's current
 * position and wall clock, then replace only if the correction is large
 * enough to be meaningful (> 20ms) and not a loop-wrap artefact.
 */
function _reanchorClock(): void {
  if (!_video || _playStartEpoch < 0 || _durationMs <= 0) return;
  const posMs  = Math.round((_video.currentTime ?? 0) * 1000);
  if (posMs < 200) return;
  const now    = Date.now();
  const elapsed   = now - _playStartEpoch;
  const loopN     = Math.floor(elapsed / _durationMs);
  const corrected = now - (loopN * _durationMs + posMs);
  const delta     = corrected - _playStartEpoch;
  // Allow up to 1.5× duration for the first post-burst correction (Tizen 4
  // decoder burst can bake in a full-loop offset). After that ±2s is enough.
  const firstAnchor = _playStartedAt >= 0 && (now - _playStartedAt) < STARTUP_ANCHOR_GRACE_MS + 6000;
  const maxDelta = firstAnchor ? (_durationMs * 1.5) : 2000;
  if (Math.abs(delta) > 20 && Math.abs(delta) < maxDelta) {
    const tag = Math.abs(delta) > 500 ? 'startup-anchor' : 're-anchor';
    logger.info(`[HTML5] clock ${tag}: _playStartEpoch ${delta > 0 ? '+' : ''}${Math.round(delta)}ms → actualPos=${posMs}ms`);
    _playStartEpoch = corrected;
  }
}
