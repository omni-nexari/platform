/**
 * player-avplay.ts
 * Samsung native AVPlay engine.
 *
 * AVPlay does not support fractional playback-rate nudging, and some Tizen TV
 * builds report stale decoder position or reject seekTo while buffering.
 * Runtime correction is therefore diagnostic-only; sync quality comes from a
 * precise shared start epoch and stable local timeline.
 *
 * Seek strategy:
 *   seekTo(ms, successCb, errorCb) fires callback when seek is complete.
 *   _seekInFlight flag blocks the tick and any new seek until callback fires.
 *   After callback, getCurrentTime() immediately reflects the new position.
 *
 * Speed control:
 *   AVPlay setSpeed() only accepts integer rates (no 1.02x nudge).
 *   Drift correction is therefore conservative: ignore tiny drift, hold soft drift,
 *   and seek only for larger errors.
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

const DRIFT_NOOP_MS   = 80;    // ignore tiny phase error
const SYNC_SEEK_MS    = 300;   // AVPlay cannot fractional-nudge; seek only above this
const NEAR_END_MS     = 500;   // skip corrections within this ms of loop boundary
const SEEK_SETTLE_MS  = 2500;  // post-seek cooldown; AVPlay can report stale position while buffering
const SEEK_TIMEOUT_MS = 2500;  // some Tizen builds do not call seekTo callbacks reliably
const RUNTIME_SEEK_ENABLED = false;

let _syncedStartMs  = -1;
let _startScheduled = false;
let _itemIndex      = 0;
let _stateTickTimer: any = null;
let _syncWatchdog: any   = null;
let _videoDurationMs = 0;
let _playing         = false;
let _seekInFlight    = false;  // AVPlay blocks all API calls during seekTo
let _lastSeekTime    = 0;      // timestamp of last completed seek — throttles cascade
let _lastSoftDriftLogTime = 0;
let _lastHardDriftLogTime = 0;
let _tearingDown     = false;
let _objElem: HTMLObjectElement | null = null;  // AVPlay requires an <object> element

function _localNow(): number {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

// ── AVPlay accessor ────────────────────────────────────────────────────────────

interface AVPlayHandle {
  open(url: string): void;
  close(): void;
  prepare(): void;
  prepareAsync(success: () => void, error: (e: any) => void): void;
  setBufferingParam?(option: string, unitOrAmount: string, amount?: number): void;
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
export function initAvplayPlayer(container: HTMLElement): void {
  _teardown();
  _tearingDown = false;

  if (!_av()) {
    logger.warn('[AVPlay] webapis.avplay not available — falling back gracefully');
    return;
  }

  // AVPlay requires an <object type="application/avplayer"> element in the DOM.
  // The element itself is invisible; AVPlay renders natively behind it.
  _objElem = document.createElement('object') as HTMLObjectElement;
  _objElem.type = 'application/avplayer';
  _objElem.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
  container.appendChild(_objElem);

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

  // AVPlay needs an absolute file:// URI — resolve async for Tizen 4 compat.
  return _resolveAbsoluteUri(url).then((absUri) => _openAndPrepare(av, absUri));
}

export function teardown(): void { _teardown(); }

// ── URI resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a relative URL (e.g. "./media/1.mp4") to an absolute file:// URI
 * suitable for webapis.avplay.open().
 *
 * Strategy:
 *  1. If already absolute (http/https/file) — return as-is.
 *  2. Tizen 5+ — tizen.filesystem.toURI('wgt-package') is synchronous.
 *  3. Tizen 4  — tizen.filesystem.resolve() is async (callback); wrap in Promise.
 *  4. Fallback — derive base from a <script> src attribute (always absolute per spec).
 */
function _resolveAbsoluteUri(url: string): Promise<string> {
  // Already absolute
  if (/^(https?|file):\/\//i.test(url)) return Promise.resolve(url);

  // Strip leading ./
  const rel = url.replace(/^\.\//, '');

  // 1. Tizen 5+ synchronous path
  try {
    const base: string = (window as any).tizen?.filesystem?.toURI('wgt-package');
    if (base && typeof base === 'string' && base.length > 5) {
      const abs = (base.endsWith('/') ? base : base + '/') + rel;
      logger.info(`[AVPlay] resolved URI (toURI): ${abs}`);
      return Promise.resolve(abs);
    }
  } catch (e: any) {
    logger.warn(`[AVPlay] toURI failed: ${e?.message} — trying resolve()`);
  }

  // 2. Tizen 4 async callback resolve
  const tizen = (window as any).tizen;
  if (tizen?.filesystem?.resolve) {
    return new Promise<string>((res, rej) => {
      try {
        tizen.filesystem.resolve(
          'wgt-package',
          (dir: any) => {
            const base: string = dir.toURI ? dir.toURI() : String(dir);
            const abs = (base.endsWith('/') ? base : base + '/') + rel;
            logger.info(`[AVPlay] resolved URI (resolve): ${abs}`);
            res(abs);
          },
          (e: any) => {
            logger.warn(`[AVPlay] filesystem.resolve failed: ${e?.message} — using script fallback`);
            res(_scriptBaseFallback(rel));
          },
          'r',
        );
      } catch (e: any) {
        logger.warn(`[AVPlay] filesystem.resolve threw: ${e?.message}`);
        res(_scriptBaseFallback(rel));
      }
    });
  }

  // 3. Script src fallback
  return Promise.resolve(_scriptBaseFallback(rel));
}

function _scriptBaseFallback(rel: string): string {
  for (const s of Array.from(document.scripts) as HTMLScriptElement[]) {
    if (s.src && s.src.startsWith('file:///') && s.src.includes('bundle.js')) {
      const base = s.src.replace(/js\/bundle\.js.*$/, '');
      const abs = base + rel;
      logger.info(`[AVPlay] resolved URI (script): ${abs}`);
      return abs;
    }
  }
  // Last resort — relative path (will likely fail on Tizen, but surfaces the error)
  logger.warn(`[AVPlay] could not resolve absolute URI for: ${rel}`);
  return rel;
}

// ── Open and prepare ───────────────────────────────────────────────────────────

function _openAndPrepare(av: AVPlayHandle, absUri: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      logger.info(`[AVPlay] open: ${absUri}`);
      av.open(absUri);
      _disableInternalBuffering(av);
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
          if (!_tearingDown) P2PSync.setPlaybackState(_itemIndex, _ms, 'avplay');
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
          _videoDurationMs = av.getDuration();
          P2PSync.setVideoDuration(_videoDurationMs);
          logger.info(`[AVPlay] READY — duration=${_videoDurationMs}ms`);
          updateHud({ lastAction: 'Ready — waiting for SYNC_PLAY' });
          P2PSync.setVideoReady(_itemIndex, 'avplay');

          _syncWatchdog = setTimeout(() => {
            if (!_playing && !_tearingDown) {
              logger.warn('[AVPlay] watchdog: still waiting for SYNC_PLAY; not starting unsynced');
            }
          }, 15000);

          if (_syncedStartMs > 0) _schedulePlay();
          resolve();
        },
        (e: any) => {
          logger.error(`[AVPlay] prepareAsync failed: ${e?.message ?? String(e)}`);
          reject(new Error(e?.message ?? String(e)));
        },
      );
    } catch (e: any) {
      logger.error(`[AVPlay] open/setup failed: ${e?.message ?? String(e)}`);
      reject(e);
    }
  });
}

function _disableInternalBuffering(av: AVPlayHandle): void {
  if (typeof av.setBufferingParam !== 'function') {
    logger.warn('[AVPlay] setBufferingParam unavailable');
    return;
  }

  const setZero = (option: 'PLAYER_BUFFER_FOR_PLAY' | 'PLAYER_BUFFER_FOR_RESUME'): boolean => {
    try {
      av.setBufferingParam!(option, 'PLAYER_BUFFER_SIZE_IN_SECOND', 0);
      return true;
    } catch (e1: any) {
      try {
        av.setBufferingParam!(option, '0');
        return true;
      } catch (e2: any) {
        logger.warn(`[AVPlay] setBufferingParam ${option}=0 failed: ${e2?.message ?? e1?.message ?? e2}`);
        return false;
      }
    }
  };

  const playOk = setZero('PLAYER_BUFFER_FOR_PLAY');
  const resumeOk = setZero('PLAYER_BUFFER_FOR_RESUME');
  if (playOk || resumeOk) logger.info(`[AVPlay] buffering disabled: play=${playOk} resume=${resumeOk}`);
}

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
    try {
      av.play();
      _lastSeekTime = _localNow();
    } catch (e: any) { logger.warn(`[AVPlay] play() failed: ${e?.message}`); }
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
          _lastSeekTime = _localNow();
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

  // Guard: if no synced start time, just restart from 0 (watchdog / unsynced mode)
  if (_syncedStartMs <= 0 || _videoDurationMs <= 0) {
    logger.info('[AVPlay] loop: no syncedStart — seeking to 0');
    _seekTo(0, 'loop', () => { if (!_tearingDown) try { av.play(); } catch {} });
    return;
  }

  const elapsed    = getSyncedTime() - _syncedStartMs;
  const expectedMs = ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs;

  logger.info(`[AVPlay] loop: elapsed=${Math.round(elapsed)}ms seekTo=${Math.round(expectedMs)}ms`);
  _seekTo(expectedMs, 'loop', () => {
    if (_tearingDown) return;
    try { av.play(); } catch (e: any) { logger.warn(`[AVPlay] loop play() failed: ${e?.message}`); }
  });
}

function _seekTo(ms: number, label: string, onDone?: () => void): void {
  if (_seekInFlight || _tearingDown) return;
  const av = _av();
  if (!av) return;

  _seekInFlight = true;
  let done = false;
  let timeout: any = null;
  const targetMs = Math.round(ms);

  const finish = (ok: boolean, err?: any) => {
    if (done) return;
    done = true;
    if (timeout) clearTimeout(timeout);
    _lastSeekTime = _localNow();
    _seekInFlight = false;
    if (!ok) logger.warn(`[AVPlay] ${label} seekTo ${targetMs}ms failed/timeout: ${err?.message ?? err ?? 'timeout'}`);
    onDone?.();
  };

  timeout = setTimeout(() => finish(false, 'timeout'), SEEK_TIMEOUT_MS);
  try {
    av.seekTo(targetMs, () => finish(true), (e: any) => finish(false, e));
  } catch (e: any) {
    finish(false, e);
  }
}

// ── State tick — wall-clock position correction ────────────────────────────────

function _startStateTickTimer(): void {
  _stateTickTimer = setInterval(() => {
    if (!_playing || _tearingDown) return;
    // Skip tick while a seek is in progress or within the post-seek settle window
    const now = _localNow();
    if (_seekInFlight || now - _lastSeekTime < SEEK_SETTLE_MS) return;

    const av = _av();
    if (!av) return;

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

      if (!nearBoundary && absDrift > DRIFT_NOOP_MS && absDrift < SYNC_SEEK_MS) {
        if (now - _lastSoftDriftLogTime > 1000) {
          _lastSoftDriftLogTime = now;
          logger.info(`[AVPlay] soft drift ${Math.round(driftMs)}ms — no fractional speed support; holding`);
        }
      }

      if (!nearBoundary && absDrift >= SYNC_SEEK_MS) {
        if (RUNTIME_SEEK_ENABLED) {
          logger.info(`[AVPlay] sync-seek: drift ${Math.round(driftMs)}ms → ${Math.round(expectedMs)}ms`);
          _seekTo(expectedMs, 'sync-seek');
        } else if (now - _lastHardDriftLogTime > 2000) {
          _lastHardDriftLogTime = now;
          logger.warn(`[AVPlay] hard drift ${Math.round(driftMs)}ms — runtime seek disabled; holding timeline`);
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

  if (_objElem) {
    _objElem.remove();
    _objElem = null;
  }

  _playing        = false;
  _seekInFlight   = false;
  _lastSeekTime   = 0;
  _lastSoftDriftLogTime = 0;
  _lastHardDriftLogTime = 0;
  _startScheduled = false;
  _syncedStartMs  = -1;
  _videoDurationMs = 0;
}
