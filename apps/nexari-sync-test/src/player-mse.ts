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

  try {
    _ms = new MediaSource();
    _video.src = URL.createObjectURL(_ms);

    await new Promise<void>((resolve) => {
      _ms!.addEventListener('sourceopen', () => resolve(), { once: true });
    });

    // Detect MIME type from URL extension
    const ext  = url.split('.').pop()?.toLowerCase() ?? 'mp4';
    const mime = ext === 'webm' ? 'video/webm; codecs="vp9"' : 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';

    if (!MediaSource.isTypeSupported(mime)) {
      throw new Error(`MSE: MIME not supported: ${mime}`);
    }

    _sb = _ms.addSourceBuffer(mime);

    // Stream-fetch and append in chunks
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url} → ${resp.status}`);
    const reader = resp.body!.getReader();

    await _streamAppend(reader);

    _ms.endOfStream();
    logger.info('[MSE] source buffer complete');

  } catch (e: any) {
    logger.error(`[MSE] load failed: ${e?.message}`);
    throw e;
  }

  // Wait for canplay
  await new Promise<void>((resolve) => {
    if (!_video) return resolve();
    if (_video.readyState >= 3) { resolve(); return; }
    _video.addEventListener('canplay', () => resolve(), { once: true });
  });

  logger.info('[MSE] canplay — signalling READY');
  updateHud({ lastAction: 'Ready — waiting for SYNC_PLAY' });
  P2PSync.setVideoReady(_itemIndex, 'mse');

  // Pause until SYNC_PLAY arrives; watchdog unpauses after 8s
  _video.pause();
  _syncWatchdog = setTimeout(() => {
    if (_video?.paused) {
      logger.warn('[MSE] watchdog: no SYNC_PLAY after 8s — playing unsynced');
      _video.play().catch(() => {});
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
  _syncedStartMs = msg.syncedStartMs;
  logger.info(`[MSE] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${msg.syncedStartMs - getSyncedTime()}ms)`);
  if (_video && _video.readyState >= 3) _schedulePlay();
}

function _schedulePlay(): void {
  if (_startScheduled || !_video) return;
  _startScheduled = true;

  const wait = _syncedStartMs - getSyncedTime();
  if (wait <= 0) {
    logger.warn('[MSE] SYNC_PLAY cue already past — playing immediately');
    _video.play().catch((e: any) => logger.error(`[MSE] play failed: ${e?.message}`));
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
        _video?.play().catch((e: any) => logger.error(`[MSE] play() failed: ${e?.message}`));
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

// ── State tick (polyfill path for Tizen 4/5 without rVFC) ─────────────────────

function _startStateTickTimer(): void {
  if (_rVfcSupported) return; // rVFC handles it
  _stateTickTimer = setInterval(() => {
    if (!_video) return;
    const posMs  = _video.currentTime * 1000;
    const syncNow = getSyncedTime();
    const elapsed = syncNow - _syncedStartMs;
    const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
    const driftMs = posMs - expectedMs;

    P2PSync.setPlaybackState(_itemIndex, posMs, 'mse');
    updateHud({ positionMs: posMs, expectedMs, driftMs });
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
  _startScheduled = false;
  _syncedStartMs  = -1;
}
