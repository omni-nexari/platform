/**
 * player-mse.ts
 * MSE (Media Source Extensions) video engine.
 *
 * Pipeline:
 *   fetch(videoUrl) → ReadableStream → MediaSource + SourceBuffer (1 MB chunks)
 *   video.oncanplay → signals READY to P2P sync client
 *   syncClient.onSyncPlay → schedules video.play() at wall-clock syncedStartMs
 *   requestVideoFrameCallback (with polyfill) → reports accurate currentTimeMs
 *   video.playbackRate nudge for drift correction (HTML5 supports smooth rates)
 */

import { getSyncedTime } from './ntp-client.js';
import * as P2PSync from './p2p-sync-client.js';
import { updateHud } from './perf-hud.js';
import { logger } from './logger.js';
import type { MsgSyncPlay, MsgSyncAdjust } from './sync-protocol.js';

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB append chunks

let _video: HTMLVideoElement | null = null;
let _ms: MediaSource | null = null;
let _sb: SourceBuffer | null = null;
let _syncedStartMs = -1;
let _startScheduled = false;
let _itemIndex = 0;
let _stateTickTimer: any = null;
let _rVfcSupported = false;
let _syncWatchdog: any = null;
let _videoDurationMs = 0;   // read from video.duration; shared via SYNC_PLAY
let _pausedForSync   = false;
let _playing         = false;
let _lastSeekTime    = 0;    // wall-clock time of last seek (rate-limit to prevent cascade)
let _lastLoopTime    = 0;    // wall-clock time of last loop restart

// Tolerances for wall-clock position correction
const SYNC_AHEAD_MS     = 50;   // nudge slow if ahead by more than this
const SYNC_BEHIND_MS    = 50;   // nudge fast if behind by more than this
const SYNC_SEEK_MS      = 300;  // hard seek if drift is larger than this
const MIN_SEEK_INTERVAL = 800;  // ms between seeks (Tizen seek is async — prevent cascade)
const LOOP_GRACE_MS     = 1500; // after loop restart, skip corrections until currentTime settles
const NUDGE_FAST        = 1.02;
const NUDGE_SLOW        = 0.98;
const NEAR_END_MS       = 500;  // don't correct within this many ms of loop boundary

// ── Public API ────────────────────────────────────────────────────────────────

/** Mount the MSE player into the given container. */
export function initMsePlayer(container: HTMLElement): void {
  _teardown();

  _video = document.createElement('video');
  _video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
  _video.muted  = false;
  _video.volume = 1;
  _video.playsInline = true;
  container.appendChild(_video);
  _registerEndedHandler();

  // Check for requestVideoFrameCallback support
  _rVfcSupported = typeof (_video as any).requestVideoFrameCallback === 'function';
  logger.info(`[MSE] rVFC supported: ${_rVfcSupported}`);

  P2PSync.onSyncPlay(_handleSyncPlay);
  P2PSync.onAdjust(_handleAdjust);

  _startStateTickTimer();
}

/**
 * Load a video URL via MSE streaming. Calls P2PSync.setVideoReady() once
 * the video has enough data to play (oncanplay).
 */
export async function loadVideo(url: string, itemIndex = 0): Promise<void> {
  if (!_video) return;
  _itemIndex      = itemIndex;
  _syncedStartMs  = -1;
  _startScheduled = false;

  logger.info(`[MSE] loading: ${url}`);
  updateHud({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: 'Buffering…' });

  // Use direct src assignment — fetch() is unreliable for widget-local files on
  // Samsung Tizen. The HTML5 video element handles local media natively.
  _video.preload = 'auto';
  _video.src = url;
  _video.load();

  // Wait for canplay
  await new Promise<void>((resolve) => {
    if (!_video) return resolve();
    if (_video.readyState >= 3) { resolve(); return; }
    _video.addEventListener('canplay', () => resolve(), { once: true });
  });

  logger.info('[MSE] canplay — signalling READY');
  _videoDurationMs = (_video.duration > 0 && isFinite(_video.duration))
    ? Math.round(_video.duration * 1000) : 0;
  if (_videoDurationMs > 0) {
    P2PSync.setVideoDuration(_videoDurationMs);
    logger.info(`[MSE] duration: ${_videoDurationMs}ms`);
  }
  updateHud({ lastAction: 'Ready — waiting for SYNC_PLAY' });
  P2PSync.setVideoReady(_itemIndex, 'mse');

  // Pause until SYNC_PLAY arrives; watchdog unpauses after 8s
  _video.pause();
  _syncWatchdog = setTimeout(() => {
    if (_video?.paused) {
      logger.warn('[MSE] watchdog: no SYNC_PLAY after 8s — playing unsynced');
      _playing = true;
      _video.play().catch((e: any) => logger.warn(`[MSE] watchdog play() failed: ${e?.message}`));
    }
  }, 8000);

  // If leader and SYNC_PLAY already scheduled before canplay, apply now
  if (_syncedStartMs > 0) _schedulePlay();

  if (_rVfcSupported) _registerRVFC();
}

export function teardown(): void { _teardown(); }

// ── Sync handlers ─────────────────────────────────────────────────────────────

function _handleSyncPlay(msg: MsgSyncPlay): void {
  clearTimeout(_syncWatchdog);
  if (_startScheduled) {
    logger.info(`[MSE] SYNC_PLAY ignored (play already scheduled)`);
    return;
  }
  _syncedStartMs = msg.syncedStartMs;
  // Prefer leader's duration so both TVs use an identical modulo divisor
  if ((msg.videoDurationMs ?? 0) > 0) _videoDurationMs = msg.videoDurationMs!;
  logger.info(`[MSE] SYNC_PLAY received: startMs=${msg.syncedStartMs} durationMs=${_videoDurationMs} (in ${msg.syncedStartMs - getSyncedTime()}ms)`);
  if (_video && _video.readyState >= 3) _schedulePlay();
}

function _schedulePlay(): void {
  if (_startScheduled || !_video) return;
  _startScheduled = true;
  // Always reset to start so both TVs play from the same position
  _video.pause();
  _video.currentTime = 0;

  const wait = _syncedStartMs - getSyncedTime();
  if (wait <= 0) {
    logger.warn('[MSE] SYNC_PLAY cue already past — playing immediately');
    _video.play().catch((e: any) => logger.warn(`[MSE] play() failed (past cue): ${e?.message}`));
    return;
  }

  logger.info(`[MSE] scheduling play in ${Math.round(wait)}ms`);
  // Poll at ~4ms intervals for the final 50ms for sub-frame precision
  const COARSE_THRESHOLD = 50;
  const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);

  setTimeout(() => {
    // Fine-grain busy-wait for remaining ms
    const target = _syncedStartMs;
    function tryPlay() {
      if (getSyncedTime() >= target) {
        _playing = true;
        _video?.play().catch((e: any) => logger.warn(`[MSE] play() failed: ${e?.message}`));
        updateHud({ lastAction: 'play() fired' });
      } else {
        setTimeout(tryPlay, 4);
      }
    }
    tryPlay();
  }, coarseWait);
}

function _handleAdjust(msg: MsgSyncAdjust): void {
  if (!_video) return;
  if (_videoDurationMs > 0) return; // wall-clock position-sync handles it
  updateHud({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });

  if (msg.action === 'snap' && msg.targetMs !== undefined) {
    _video.currentTime = msg.targetMs / 1000;
    _video.playbackRate = 1.0;
    logger.drift(`[MSE] snap to ${msg.targetMs}ms`, msg.driftMs);
  } else if (msg.action === 'nudge' && msg.driftRate !== undefined) {
    _video.playbackRate = msg.driftRate;
    logger.drift(`[MSE] nudge rate=${msg.driftRate}`, msg.driftMs);
    // Restore rate after 5s
    setTimeout(() => { if (_video) _video.playbackRate = 1.0; }, 5000);
  }
}

// ── rVFC / position reporting ─────────────────────────────────────────────────

function _registerRVFC(): void {
  if (!_video || !_rVfcSupported) return;
  (_video as any).requestVideoFrameCallback(_onFrame);
}

function _onFrame(_now: number, meta: { expectedDisplayTime: number; mediaTime: number }): void {
  if (!_video) return;
  const posMs  = meta.mediaTime * 1000;
  const syncNow = getSyncedTime();
  const elapsed = syncNow - _syncedStartMs;
  const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
  const driftMs = posMs - expectedMs;

  P2PSync.setPlaybackState(_itemIndex, posMs, 'mse');
  updateHud({ positionMs: posMs, expectedMs, driftMs });

  _registerRVFC(); // re-register for next frame
}

// ── Loop restart handler ──────────────────────────────────────────────────────

function _registerEndedHandler(): void {
  if (!_video) return;
  _video.addEventListener('ended', () => {
    if (_syncedStartMs > 0 && _videoDurationMs > 0) {
      // Seek to where wall-clock says we should be at the start of the new loop
      const elapsed    = getSyncedTime() - _syncedStartMs;
      const expectedMs = ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs;
      logger.info(`[MSE] loop: elapsed=${Math.round(elapsed)}ms seekTo=${Math.round(expectedMs)}ms`);
      _lastLoopTime = Date.now(); // start grace period — currentTime is stale until seek completes
      if (_video) {
        _video.currentTime = expectedMs / 1000;
        _video.play().catch((e: any) => logger.warn(`[MSE] loop play() failed: ${e?.message}`));
      }
    } else {
      if (_video) {
        _video.currentTime = 0;
        _video.play().catch((e: any) => logger.warn(`[MSE] loop play() failed: ${e?.message}`));
      }
    }
  });
}

// ── State tick — wall-clock position sync + reporting ─────────────────────────

function _startStateTickTimer(): void {
  _stateTickTimer = setInterval(() => {
    if (!_video || !_playing) return;
    // Skip corrections during grace period after loop restart — video.currentTime
    // is stale (shows pre-loop value) for up to 800ms after a seek on Tizen.
    if (Date.now() - _lastLoopTime < LOOP_GRACE_MS) return;
    const posMs   = _video.currentTime * 1000;
    const syncNow = getSyncedTime();

    // Compute where both TVs should be right now
    let expectedMs = posMs;
    if (_syncedStartMs > 0 && _videoDurationMs > 0) {
      const elapsed = syncNow - _syncedStartMs;
      expectedMs = ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs;
    }
    const driftMs = posMs - expectedMs;

    P2PSync.setPlaybackState(_itemIndex, posMs, 'mse');
    updateHud({ positionMs: posMs, expectedMs, driftMs });

    // Active position correction — skip near loop boundary to avoid modulo wrap issues
    if (_syncedStartMs > 0 && _videoDurationMs > 0) {
      const nearBoundary = expectedMs < NEAR_END_MS || expectedMs > _videoDurationMs - NEAR_END_MS;
      const absDrift = Math.abs(driftMs);

      if (!nearBoundary) {
        if (absDrift > SYNC_SEEK_MS) {
          // Large drift — seek once (rate-limited to prevent Tizen async cascade)
          const now = Date.now();
          if (now - _lastSeekTime > MIN_SEEK_INTERVAL) {
            _lastSeekTime = now;
            logger.info(`[MSE] sync-seek: drift ${Math.round(driftMs)}ms → ${Math.round(expectedMs)}ms`);
            _video.currentTime = expectedMs / 1000;
          }
        } else if (driftMs > SYNC_AHEAD_MS) {
          // Slightly ahead — play slower
          if (_video.playbackRate !== NUDGE_SLOW) {
            _video.playbackRate = NUDGE_SLOW;
            logger.info(`[MSE] sync-nudge slow: ahead ${Math.round(driftMs)}ms`);
          }
        } else if (driftMs < -SYNC_BEHIND_MS) {
          // Slightly behind — play faster
          if (_video.playbackRate !== NUDGE_FAST) {
            _video.playbackRate = NUDGE_FAST;
            logger.info(`[MSE] sync-nudge fast: behind ${Math.round(-driftMs)}ms`);
          }
        } else if (_video.playbackRate !== 1.0 && absDrift < 20) {
          // Back in tolerance — restore normal rate
          _video.playbackRate = 1.0;
          logger.info(`[MSE] sync-restored: drift ${Math.round(driftMs)}ms`);
        }
      }
    }
  }, 50);
}

// ── Streaming append helper ───────────────────────────────────────────────────

async function _streamAppend(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  let buf = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buf.length > 0) await _appendChunk(buf);
      break;
    }

    // Accumulate into buf
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;

    while (buf.length >= CHUNK_SIZE) {
      await _appendChunk(buf.slice(0, CHUNK_SIZE));
      buf = buf.slice(CHUNK_SIZE);
    }
  }
}

async function _appendChunk(chunk: Uint8Array): Promise<void> {
  if (!_sb) return;
  if (_sb.updating) {
    await new Promise<void>((r) => _sb!.addEventListener('updateend', () => r(), { once: true }));
  }
  const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
  _sb.appendBuffer(ab);
  await new Promise<void>((r) => _sb!.addEventListener('updateend', () => r(), { once: true }));
}

// ── Teardown ──────────────────────────────────────────────────────────────────

function _teardown(): void {
  clearInterval(_stateTickTimer);
  clearTimeout(_syncWatchdog);
  if (_video) {
    _video.pause();
    _video.src = '';
    _video.remove();
    _video = null;
  }
  if (_ms && _ms.readyState === 'open') {
    try { _ms.endOfStream(); } catch {}
  }
  _ms = null;
  _sb = null;
  _startScheduled  = false;
  _syncedStartMs   = -1;
  _playing         = false;
  _pausedForSync   = false;
  _videoDurationMs = 0;
  _lastSeekTime    = 0;
}
