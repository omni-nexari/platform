/**
 * player-avplay.ts
 * Samsung native AVPlay engine.
 *
 * Key advantage over MSE:
 *   getCurrentTime() is a synchronous native call — always accurate.
 *   No Tizen async-seek stale-DOM problem → cascade is impossible.
 *
 * Seek strategy:
 *   seekTo(ms, successCb, errorCb) fires callback when seek is complete.
 *   _seekInFlight flag blocks the tick and any new seek until callback fires.
 *   After callback, getCurrentTime() immediately reflects the new position.
 *
 * Speed control:
 *   AVPlay setSpeed() only accepts integer rates (no 1.02x nudge).
 *   All drift correction is seek-based (threshold: SYNC_SEEK_MS).
 *
 * State machine (Samsung AVPlay):
 *   NONE → open() → IDLE → setListener/setDisplayRect → prepareAsync() → READY → play() → PLAYING
 *
 * Requires:
 *   <script src="$WEBAPIS/webapis/webapis.js"></script> in index.html
 */

import { getSyncedTime } from './ntp-client.js';
import * as P2PSync from './p2p-sync-client.js';
import { updateHud } from './perf-hud.js';
import { logger } from './logger.js';
import type { MsgSyncPlay, MsgSyncAdjust } from './sync-protocol.js';

// Drift threshold — seek when |drift| exceeds this.
// AVPlay has no sub-integer speed control so nudge is unavailable; seeks only.
const SYNC_SEEK_MS = 200;
const NEAR_END_MS  = 500;  // skip corrections within this ms of loop boundary

let _syncedStartMs  = -1;
let _startScheduled = false;
let _itemIndex      = 0;
let _stateTickTimer: any = null;
let _syncWatchdog: any   = null;
let _videoDurationMs = 0;
let _playing         = false;
let _seekInFlight    = false;  // AVPlay blocks all API calls during seekTo
let _tearingDown     = false;

// ── AVPlay accessor ────────────────────────────────────────────────────────────

interface AVPlayHandle {
  open(url: string): void;
  close(): void;
  prepare(): void;
  prepareAsync(success: () => void, error: (e: any) => void): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod(mode: string): void;
  setListener(cb: object): void;
  play(): void;
  seekTo(ms: number, success: () => void, error: (e: any) => void): void;
  stop(): void;
  pause(): void;
  getDuration(): number;
  getCurrentTime(): number;
  getState(): string;
}

function _av(): AVPlayHandle | null {
  return (window as any).webapis?.avplay ?? null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Initialise AVPlay and register P2P sync handlers. container param ignored — AVPlay renders natively. */
export function initAvplayPlayer(_container: HTMLElement): void {
  _teardown();
  _tearingDown = false;

  if (!_av()) {
    logger.warn('[AVPlay] webapis.avplay not available — falling back gracefully');
    return;
  }

  P2PSync.onSyncPlay(_handleSyncPlay);
  P2PSync.onAdjust(_handleAdjust);
  _startStateTickTimer();
  logger.info('[AVPlay] engine initialised');
}

/** Open and prepare the video. Calls P2PSync.setVideoReady() when prepared. */
export function loadVideo(url: string, itemIndex = 0): Promise<void> {
  const av = _av();
  if (!av) return Promise.reject(new Error('[AVPlay] webapis.avplay not available'));

  _itemIndex      = itemIndex;
  _syncedStartMs  = -1;
  _startScheduled = false;
  _seekInFlight   = false;
  _playing        = false;

  logger.info(`[AVPlay] loading: ${url}`);
  updateHud({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: 'Opening…' });

  return new Promise<void>((resolve, reject) => {
    try {
      av.open(url);
      // Must set display before prepare
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');

      av.setListener({
        onbufferingstart: () => {
          updateHud({ lastAction: 'Buffering…' });
          logger.info('[AVPlay] buffering start');
        },
        onbufferingcomplete: () => {
          logger.info('[AVPlay] buffering complete');
        },
        onstreamcompleted: () => {
          if (!_playing || _tearingDown) return;
          _handleLoop();
        },
        oncurrentplaytime: (_ms: number) => {
          // Position updates arrive here too; the 50ms tick handles sync corrections
        },
        onerror: (eventType: string) => {
          logger.error(`[AVPlay] error: ${eventType}`);
        },
        onerrormsg: (eventType: string, msg: string) => {
          logger.error(`[AVPlay] errormsg: ${eventType} — ${msg}`);
        },
        onresourceconflicted: () => {
          logger.warn('[AVPlay] resource conflict');
        },
      });

      av.prepareAsync(
        () => {
          // State is now READY
          _videoDurationMs = av.getDuration();
          P2PSync.setVideoDuration(_videoDurationMs);
          logger.info(`[AVPlay] READY — duration=${_videoDurationMs}ms`);
          updateHud({ lastAction: 'Ready — waiting for SYNC_PLAY' });
          P2PSync.setVideoReady(_itemIndex, 'avplay');

          // Player is paused in READY state — no auto-play. Wait for SYNC_PLAY.
          // Watchdog: play unsynced after 8s if no SYNC_PLAY arrives.
          _syncWatchdog = setTimeout(() => {
            if (!_playing && !_tearingDown) {
              logger.warn('[AVPlay] watchdog: no SYNC_PLAY in 8s — playing unsynced');
              _playing = true;
              try { av.play(); } catch {}
            }
          }, 8000);

          // If SYNC_PLAY already arrived before prepare completed, apply now
          if (_syncedStartMs > 0) _schedulePlay();
          resolve();
        },
        (e: any) => {
          logger.error(`[AVPlay] prepareAsync failed: ${e?.message ?? String(e)}`);
          reject(e);
        },
      );
    } catch (e: any) {
      logger.error(`[AVPlay] open/setup failed: ${e?.message ?? String(e)}`);
      reject(e);
    }
  });
}

export function teardown(): void { _teardown(); }

// ── Sync handlers ──────────────────────────────────────────────────────────────

function _handleSyncPlay(msg: MsgSyncPlay): void {
  clearTimeout(_syncWatchdog);
  if (_startScheduled) {
    logger.info('[AVPlay] SYNC_PLAY ignored (play already scheduled)');
    return;
  }
  _syncedStartMs = msg.syncedStartMs;
  if ((msg.videoDurationMs ?? 0) > 0) _videoDurationMs = msg.videoDurationMs!;
  logger.info(
    `[AVPlay] SYNC_PLAY: startMs=${msg.syncedStartMs} durationMs=${_videoDurationMs} ` +
    `(in ${msg.syncedStartMs - getSyncedTime()}ms)`,
  );
  if (_av()) _schedulePlay();
}

function _schedulePlay(): void {
  if (_startScheduled || _tearingDown) return;
  _startScheduled = true;

  const av = _av();
  if (!av) return;

  // If watchdog already started playback, pause so we can restart cleanly
  try {
    const state = av.getState();
    if (state === 'PLAYING') av.pause();
  } catch {}

  const wait = _syncedStartMs - getSyncedTime();
  if (wait <= 0) {
    logger.warn('[AVPlay] SYNC_PLAY cue already past — playing immediately');
    _playing = true;
    try { av.play(); } catch (e: any) { logger.warn(`[AVPlay] play() failed: ${e?.message}`); }
    return;
  }

  logger.info(`[AVPlay] scheduling play in ${Math.round(wait)}ms`);
  const COARSE_THRESHOLD = 50;
  const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);

  setTimeout(() => {
    const target = _syncedStartMs;
    function tryPlay() {
      if (_tearingDown) return;
      if (getSyncedTime() >= target) {
        _playing = true;
        try {
          av.play();
          updateHud({ lastAction: 'play() fired' });
        } catch (e: any) {
          logger.warn(`[AVPlay] play() failed: ${e?.message}`);
        }
      } else {
        setTimeout(tryPlay, 4);
      }
    }
    tryPlay();
  }, coarseWait);
}

function _handleAdjust(_msg: MsgSyncAdjust): void {
  // Wall-clock tick handles all drift correction when videoDurationMs > 0
}

// ── Loop handler ───────────────────────────────────────────────────────────────

function _handleLoop(): void {
  if (_seekInFlight || _tearingDown) return;
  const av = _av();
  if (!av) return;

  const elapsed    = getSyncedTime() - _syncedStartMs;
  const expectedMs = _syncedStartMs > 0 && _videoDurationMs > 0
    ? ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs
    : 0;

  logger.info(`[AVPlay] loop: elapsed=${Math.round(elapsed)}ms seekTo=${Math.round(expectedMs)}ms`);
  _seekInFlight = true;

  const onDone = () => {
    _seekInFlight = false;
    if (_tearingDown) return;
    try { av.play(); } catch (e: any) { logger.warn(`[AVPlay] loop play() failed: ${e?.message}`); }
  };

  try {
    av.seekTo(Math.round(expectedMs), onDone, (e: any) => {
      logger.warn(`[AVPlay] loop seekTo failed: ${e?.message ?? e} — playing from 0`);
      _seekInFlight = false;
      // State after onstreamcompleted may not allow seekTo on some models;
      // just restart from 0 — tick will immediately do a wall-clock correction.
      if (!_tearingDown) try { av.play(); } catch {}
    });
  } catch (e: any) {
    logger.warn(`[AVPlay] loop seekTo threw: ${e?.message ?? e}`);
    _seekInFlight = false;
    try { av.play(); } catch {}
  }
}

// ── State tick — wall-clock position correction ────────────────────────────────

function _startStateTickTimer(): void {
  _stateTickTimer = setInterval(() => {
    if (!_playing || _tearingDown) return;
    // Skip tick while seek is in progress — AVPlay blocks all API calls during seekTo
    if (_seekInFlight) return;

    const av = _av();
    if (!av) return;

    // getCurrentTime() is a native call — always accurate, never stale after seek
    const posMs   = av.getCurrentTime();
    const syncNow = getSyncedTime();

    let expectedMs = posMs;
    if (_syncedStartMs > 0 && _videoDurationMs > 0) {
      const elapsed = syncNow - _syncedStartMs;
      expectedMs = ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs;
    }
    const driftMs = posMs - expectedMs;

    P2PSync.setPlaybackState(_itemIndex, posMs, 'avplay');
    updateHud({ positionMs: posMs, expectedMs, driftMs });

    if (_syncedStartMs > 0 && _videoDurationMs > 0) {
      const nearBoundary = expectedMs < NEAR_END_MS || expectedMs > _videoDurationMs - NEAR_END_MS;
      const absDrift = Math.abs(driftMs);

      if (!nearBoundary && absDrift > SYNC_SEEK_MS) {
        logger.info(`[AVPlay] sync-seek: drift ${Math.round(driftMs)}ms → ${Math.round(expectedMs)}ms`);
        _seekInFlight = true;
        try {
          av.seekTo(
            Math.round(expectedMs),
            () => { _seekInFlight = false; },
            (e: any) => {
              _seekInFlight = false;
              logger.warn(`[AVPlay] sync-seek failed: ${e?.message ?? e}`);
            },
          );
        } catch (e: any) {
          _seekInFlight = false;
          logger.warn(`[AVPlay] seekTo threw: ${e?.message ?? e}`);
        }
      }
    }
  }, 50);
}

// ── Teardown ───────────────────────────────────────────────────────────────────

function _teardown(): void {
  _tearingDown = true;
  clearInterval(_stateTickTimer);
  clearTimeout(_syncWatchdog);
  _stateTickTimer = null;
  _syncWatchdog   = null;

  const av = _av();
  if (av) {
    try {
      const state = av.getState();
      if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY') {
        av.stop();
      }
      if (state !== 'NONE') {
        av.close();
      }
    } catch {}
  }

  _playing        = false;
  _seekInFlight   = false;
  _startScheduled = false;
  _syncedStartMs  = -1;
  _videoDurationMs = 0;
}
