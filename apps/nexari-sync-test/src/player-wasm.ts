/**
 * player-wasm.ts
 * WASM/ffmpeg canvas player.
 *
 * Pipeline:
 *   decodeVideo(url) → ImageData[] frame buffer (all pre-decoded before READY)
 *   SYNC_PLAY → rAF loop renders frames at:
 *     frameIdx = floor((getSyncedTime() - syncedStartMs) / frameDurationMs)
 *   Skips frames if behind, holds if ahead.
 *   Reports currentTimeMs = frameIdx * frameDurationMs for heartbeat.
 */

import { getSyncedTime } from './ntp-client.js';
import * as P2PSync from './p2p-sync-client.js';
import { decodeVideo, DecodedVideo } from './decoder-ffmpeg.js';
import { updateHud } from './perf-hud.js';
import { logger } from './logger.js';
import type { MsgSyncPlay, MsgSyncAdjust } from './sync-protocol.js';

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _decoded: DecodedVideo | null = null;
let _syncedStartMs = -1;
let _rafHandle = 0;
let _itemIndex  = 0;
let _snapOffset = 0; // additional ms offset applied by snap corrections
let _syncWatchdog: any = null;

// ── Public API ────────────────────────────────────────────────────────────────

/** Mount the WASM canvas player into the given container. */
export function initWasmPlayer(container: HTMLElement): void {
  _teardown();

  _canvas = document.createElement('canvas');
  _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
  container.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  P2PSync.onSyncPlay(_handleSyncPlay);
  P2PSync.onAdjust(_handleAdjust);
}

/**
 * Fetch and fully decode the video before signalling READY.
 * Heavy: all frames are decoded to RAM.
 */
export async function loadVideo(url: string, itemIndex = 0): Promise<void> {
  if (!_canvas || !_ctx) return;
  _itemIndex   = itemIndex;
  _syncedStartMs = -1;
  _snapOffset    = 0;

  updateHud({ lastAction: 'Decoding…', decodePercent: 0 });

  try {
    _decoded = await decodeVideo(url);
  } catch (e: any) {
    logger.error(`[WASM] decode failed: ${e?.message}`);
    throw e;
  }

  // Size the canvas to decoded frame dimensions
  _canvas.width  = _decoded.width;
  _canvas.height = _decoded.height;

  logger.info('[WASM] decode complete — signalling READY');
  updateHud({ lastAction: 'Ready — waiting for SYNC_PLAY', decodePercent: null });
  P2PSync.setVideoDuration(_decoded.durationMs);
  P2PSync.setVideoReady(_itemIndex, 'wasm');

  // Watchdog: start playback unsynced if no SYNC_PLAY arrives in 10s
  _syncWatchdog = setTimeout(() => {
    if (_syncedStartMs < 0) {
      logger.warn('[WASM] watchdog: no SYNC_PLAY after 10s — playing unsynced');
      _syncedStartMs = getSyncedTime();
      _startRaf();
    }
  }, 10000);
}

export function teardown(): void { _teardown(); }

// ── Sync handlers ─────────────────────────────────────────────────────────────

function _handleSyncPlay(msg: MsgSyncPlay): void {
  clearTimeout(_syncWatchdog);
  _syncedStartMs = msg.syncedStartMs;
  const wait = _syncedStartMs - getSyncedTime();
  logger.info(`[WASM] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${Math.round(wait)}ms)`);
  updateHud({ lastAction: `SYNC_PLAY in ${Math.round(wait)}ms` });

  if (!_decoded) {
    logger.warn('[WASM] SYNC_PLAY arrived before decode — storing cue');
    return; // rAF will start once decode completes and loadVideo checks _syncedStartMs
  }

  if (wait <= 0) {
    logger.warn('[WASM] SYNC_PLAY cue already past — starting immediately');
    _startRaf();
    return;
  }

  // Coarse wait, then fine-grain busy-wait
  const COARSE_THRESHOLD = 50;
  const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
  setTimeout(() => {
    const target = _syncedStartMs;
    function tryStart() {
      if (getSyncedTime() >= target) {
        updateHud({ lastAction: 'rAF started' });
        _startRaf();
      } else {
        setTimeout(tryStart, 4);
      }
    }
    tryStart();
  }, coarseWait);
}

function _handleAdjust(msg: MsgSyncAdjust): void {
  updateHud({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });
  if (msg.action === 'snap' && msg.targetMs !== undefined) {
    // Apply offset so rAF loop treats targetMs as current position
    _snapOffset = msg.targetMs - _getCurrentPositionMs();
    logger.drift(`[WASM] snap offset=${Math.round(_snapOffset)}ms`, msg.driftMs);
  }
  // WASM can't nudge playbackRate (we control the frame schedule directly via getSyncedTime)
  // For nudge: temporarily shift _syncedStartMs by a small amount
  if (msg.action === 'nudge' && msg.driftRate !== undefined) {
    // driftRate > 1 means we're behind → shift start earlier
    const shiftMs = (msg.driftRate - 1.0) * 1000; // proportional shift
    _syncedStartMs -= shiftMs;
    logger.drift(`[WASM] nudge: shifted syncedStartMs by ${Math.round(-shiftMs)}ms`, msg.driftMs);
  }
}

// ── rAF render loop ───────────────────────────────────────────────────────────

function _startRaf(): void {
  if (_rafHandle) cancelAnimationFrame(_rafHandle);
  _rafHandle = requestAnimationFrame(_rafTick);
}

function _rafTick(): void {
  if (!_decoded || !_ctx || !_canvas) return;

  const frames        = _decoded.frames;
  const frameDurationMs = 1000 / _decoded.fps;
  const totalFrames   = frames.length;

  const elapsed   = getSyncedTime() - _syncedStartMs + _snapOffset;
  let frameIdx    = Math.floor(elapsed / frameDurationMs);

  // Loop
  frameIdx = ((frameIdx % totalFrames) + totalFrames) % totalFrames;

  const posMs      = frameIdx * frameDurationMs;
  const expectedMs = elapsed > 0 ? elapsed % (_decoded.durationMs) : 0;
  const driftMs    = posMs - expectedMs;

  P2PSync.setPlaybackState(_itemIndex, posMs, 'wasm');
  updateHud({ positionMs: posMs, expectedMs, driftMs });

  _ctx.putImageData(frames[frameIdx], 0, 0);

  _rafHandle = requestAnimationFrame(_rafTick);
}

function _getCurrentPositionMs(): number {
  if (!_decoded || _syncedStartMs < 0) return 0;
  const frameDurationMs = 1000 / _decoded.fps;
  const elapsed = getSyncedTime() - _syncedStartMs + _snapOffset;
  const frameIdx = Math.floor(elapsed / frameDurationMs);
  return frameIdx * frameDurationMs;
}

// ── Teardown ──────────────────────────────────────────────────────────────────

function _teardown(): void {
  if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = 0; }
  clearTimeout(_syncWatchdog);
  if (_canvas) { _canvas.remove(); _canvas = null; }
  _ctx    = null;
  _decoded = null;
  _syncedStartMs = -1;
  _snapOffset    = 0;
}
