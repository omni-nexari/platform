/**
 * engine.ts - AVPlay engine for Nexari Sync Engine
 *
 * Single avplaystore player, reused each cycle:
 *  - _playerA: ONE avplaystore slot, persistent across all clip transitions.
 *    Never released mid-session; only at destroyEngine().
 *  - On EOS: setVideoStillMode("true") to freeze last frame on screen
 *            → stop() → open(nextUrl) → prepareAsync → play()+pause() at frame 0
 *            → LOOP_READY (frozen last frame visible during ~700ms rebuffer)
 *  - On LOOP_GO → _doPlay(): setVideoStillMode("false") → play() from frame 0
 *    (still-frame releases and new clip begins in one step with no black gap)
 *  - Fallback to webapis.avplay (global) if avplaystore unavailable;
 *    no setVideoStillMode in that path (brief black screen during transition).
 *
 * Role-based display:
 *   leader (QBC portrait)    -> ROTATION_90 + LETTER_BOX
 *   follower (SBB landscape) -> LETTER_BOX
 */
import { logger } from './logger.js';

declare const webapis: any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AvPlayer = {
  open(url: string): void;
  close(): void;
  stop(): void;
  play(): void;
  pause(): void;
  prepareAsync(onSuccess: () => void, onError: (err: any) => void): void;
  setListener(l: object): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): string;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayRotation(r: string): void;
  setDisplayMethod(m: string): void;
  setVideoStillMode(mode: string): void;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _url         = '';
let _durationMs  = 0;
let _playing     = false;
let _destroyed   = false;
let _prebuffered = false;
let _looping     = false;

let _playTimer:  any = null;
let _driftTimer: any = null;

let _role:  'leader' | 'follower' | null = null;
let _onLoop: (() => void) | null = null;

let _playlist:    string[] = [];
let _playlistIdx: number   = 0;

// avplaystore single-player state
let _useAvplaystore = false;
let _playerA: AvPlayer | null = null;  // persistent; never replaced mid-session

const DRIFT_LOG_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _getState(p: AvPlayer | null): string {
  if (!p) return 'NONE';
  try { return p.getState(); } catch { return 'NONE'; }
}

function _avState(): string {
  try { return webapis.avplay.getState() as string; } catch { return 'NONE'; }
}

function _setupDisplay(p?: AvPlayer | null): void {
  if (p) {
    try { p.setDisplayRect(0, 0, 1920, 1080); } catch {}
    if (_role === 'leader') {
      try { p.setDisplayRotation('PLAYER_DISPLAY_ROTATION_90'); } catch {}
      try { p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch {}
    } else {
      try { p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch {}
    }
  } else {
    try { webapis.avplay.setDisplayRect(0, 0, 1920, 1080); } catch {}
    if (_role === 'leader') {
      try { webapis.avplay.setDisplayRotation('PLAYER_DISPLAY_ROTATION_90'); } catch {}
      try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch {}
    } else {
      try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch {}
    }
  }
}

function _setStillMode(on: boolean): void {
  if (!_playerA) return;
  try { _playerA.setVideoStillMode(on ? 'true' : 'false'); } catch {}
}

// ---------------------------------------------------------------------------
// Listener factories
// ---------------------------------------------------------------------------

function _makeListenerA(): object {
  let eosGuard = false;
  return {
    onbufferingstart() { logger.info('[AVPlay] A buffering start'); },
    onbufferingprogress(pct: number) {
      if (pct % 25 === 0) logger.info(`[AVPlay] A buffering ${pct}%`);
    },
    onbufferingcomplete() { logger.info('[AVPlay] A buffering complete'); },
    oncurrentplaytime(_posMs: number) { /* no-op */ },
    onstreamcompleted() {
      if (eosGuard) return;
      let cur = 0;
      try { cur = _playerA ? _playerA.getCurrentTime() : 0; } catch {}
      if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
        logger.info(`[AVPlay] A spurious EOS pos=${cur}ms dur=${_durationMs}ms -- ignored`);
        return;
      }
      eosGuard = true;
      _playing = false;
      logger.info(`[AVPlay] A EOS at ${cur}ms -- starting prebuffer`);
      _prebufferForBarrier();
    },
    onerror(err: any) { logger.error(`[AVPlay] A error: ${JSON.stringify(err)}`); },
    onevent(type: string, _data: string) { logger.info(`[AVPlay] A event type=${type}`); },
  };
}

function _makeListenerSingle(): object {
  return {
    onbufferingstart() { logger.info('[AVPlay] buffering start'); },
    onbufferingprogress(pct: number) {
      if (pct % 25 === 0) logger.info(`[AVPlay] buffering ${pct}%`);
    },
    onbufferingcomplete() { logger.info('[AVPlay] buffering complete'); },
    oncurrentplaytime(_posMs: number) { /* no-op */ },
    onstreamcompleted() {
      let cur = 0;
      try { cur = webapis.avplay.getCurrentTime(); } catch {}
      if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
        logger.info(`[AVPlay] spurious EOS pos=${cur}ms dur=${_durationMs}ms -- ignored`);
        return;
      }
      _playing = false;
      logger.info(`[AVPlay] EOS at ${cur}ms -- starting prebuffer`);
      _prebufferForBarrier();
    },
    onerror(err: any) { logger.error(`[AVPlay] error: ${JSON.stringify(err)}`); },
    onevent(type: string, _data: string) { logger.info(`[AVPlay] event type=${type}`); },
  };
}

// ---------------------------------------------------------------------------
// Drift log + watchdog
// ---------------------------------------------------------------------------

function _startDriftLog(): void {
  if (_driftTimer) return;
  let frozenCount = 0;
  _driftTimer = setInterval(() => {
    if (_destroyed || !_playing) return;
    try {
      let pos: number; let st: string;
      if (_useAvplaystore && _playerA) {
        pos = _playerA.getCurrentTime();
        st  = _getState(_playerA);
      } else {
        pos = webapis.avplay.getCurrentTime();
        st  = _avState();
      }
      logger.info(`[AVPlay] pos=${pos}ms duration=${_durationMs}ms state=${st}`);
      if (_durationMs > 0 && pos >= _durationMs - 200) {
        frozenCount++;
        if (frozenCount >= 2) {
          frozenCount = 0;
          logger.warn(`[AVPlay] watchdog: frozen at end pos=${pos}ms -- forcing prebuffer`);
          _prebufferForBarrier();
        }
      } else { frozenCount = 0; }
    } catch {}
  }, DRIFT_LOG_MS);
}

function _stopDriftLog(): void {
  if (_driftTimer) { clearInterval(_driftTimer); _driftTimer = null; }
}

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export function setRole(role: 'leader' | 'follower'): void { _role = role; }
export function setOnLoop(cb: () => void): void            { _onLoop = cb; }

export function setPlaylist(urls: string[]): void {
  if (urls.length === 0) return;
  _playlist    = urls;
  _playlistIdx = 0;
  _url         = urls[0];
  logger.info(`[AVPlay] playlist (${urls.length}): ${urls.map((u) => u.split('/').pop()).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initEngine(_container: HTMLElement): void {
  _destroyed = false; _playing = false; _durationMs = 0;
  _url = ''; _looping = false; _prebuffered = false;
  clearTimeout(_playTimer); _stopDriftLog();

  // Try to acquire a single persistent avplaystore player.
  // We keep this one slot for the entire session (never release mid-play).
  try {
    if (typeof webapis !== 'undefined' && webapis.avplaystore) {
      if (_playerA) {
        // Re-init path: close existing slot cleanly
        try {
          const s = _getState(_playerA);
          if (s === 'PLAYING' || s === 'PAUSED') _playerA.stop();
          if (s !== 'NONE') _playerA.close();
        } catch {}
      } else {
        _playerA = webapis.avplaystore.getPlayer() as AvPlayer;
      }
      _useAvplaystore = true;
      logger.info('[AVPlay] avplaystore single-player mode');
    } else {
      throw new Error('avplaystore unavailable');
    }
  } catch {
    _playerA = null;
    _useAvplaystore = false;
    logger.info('[AVPlay] webapis.avplay fallback mode');
    try {
      const s = _avState();
      if (s === 'PLAYING' || s === 'PAUSED') webapis.avplay.stop();
      if (s !== 'NONE') webapis.avplay.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Prepare (first clip)
// ---------------------------------------------------------------------------

export function prepare(url: string): Promise<void> {
  _url = url; _durationMs = 0; _playing = false;
  _prebuffered = false; _looping = false;
  clearTimeout(_playTimer); _stopDriftLog();
  if (_playlist.length === 0) { _playlist = [url]; _playlistIdx = 0; }

  logger.info(`[AVPlay] prepare: ${url.split('/').pop()} avplaystore=${_useAvplaystore}`);
  return new Promise<void>((resolve, reject) => {
    if (_useAvplaystore && _playerA) {
      _openAndPrepare(_playerA, url, _makeListenerA(), resolve, reject);
    } else {
      _prepareSingle(url, resolve, reject);
    }
  });
}

function _openAndPrepare(
  p: AvPlayer, url: string, listener: object,
  resolve: () => void, reject: (e: Error) => void,
): void {
  try {
    const s = _getState(p);
    if (s === 'PLAYING' || s === 'PAUSED') p.stop();
    if (s !== 'NONE') p.close();
    p.open(url);
  } catch (e: any) {
    return reject(new Error(`avplaystore open failed: ${e?.message}`));
  }
  _setupDisplay(p);
  p.setListener(listener);
  p.prepareAsync(
    () => {
      if (_destroyed) return resolve();
      _setupDisplay(p);
      _durationMs = p.getDuration();
      logger.info(`[AVPlay] A prepared -- duration=${_durationMs}ms`);
      resolve();
    },
    (err: any) => {
      logger.error(`[AVPlay] A prepareAsync failed: ${JSON.stringify(err)}`);
      reject(new Error(String(err?.name ?? err)));
    },
  );
}

function _prepareSingle(url: string, resolve: () => void, reject: (e: Error) => void): void {
  try {
    const s = _avState();
    if (s === 'PLAYING' || s === 'PAUSED') webapis.avplay.stop();
    if (s !== 'NONE') webapis.avplay.close();
    webapis.avplay.open(url);
  } catch (e: any) { return reject(new Error(`AVPlay open failed: ${e?.message}`)); }
  _setupDisplay();
  webapis.avplay.setListener(_makeListenerSingle());
  webapis.avplay.prepareAsync(
    () => {
      if (_destroyed) return resolve();
      _setupDisplay();
      _durationMs = webapis.avplay.getDuration();
      logger.info(`[AVPlay] prepared -- duration=${_durationMs}ms`);
      resolve();
    },
    (err: any) => {
      logger.error(`[AVPlay] prepareAsync failed: ${JSON.stringify(err)}`);
      reject(new Error(String(err?.name ?? err)));
    },
  );
}

// ---------------------------------------------------------------------------
// Barrier prebuffer
// ---------------------------------------------------------------------------

function _prebufferForBarrier(): void {
  if (_destroyed || _looping) return;
  _looping     = true;
  _prebuffered = false;
  _stopDriftLog();

  if (_playlist.length > 1) {
    _playlistIdx = (_playlistIdx + 1) % _playlist.length;
    _url = _playlist[_playlistIdx];
    logger.info(`[AVPlay] playlist -> [${_playlistIdx + 1}/${_playlist.length}] ${_url.split('/').pop()}`);
  }

  if (_useAvplaystore && _playerA) {
    _prebufferAvplaystore(_url);
  } else {
    _prebufferGlobalAvplay(_url);
  }
}

/**
 * Avplaystore single-player transition:
 *  1. setVideoStillMode("true")  -> freeze last frame on screen
 *  2. stop()                     -> player IDLE  (still frame held)
 *  3. open(nextUrl)              -> reload same player slot with new URL
 *  4. prepareAsync → play()+pause() -> frame 0 buffered, still frame still visible
 *  5. LOOP_READY
 */
function _prebufferAvplaystore(nextUrl: string): void {
  _setStillMode(true);
  try { _playerA!.stop(); } catch {}
  logger.info('[AVPlay] avplaystore prebuffer: still-freeze -> stop -> open -> prepareAsync');
  try {
    _playerA!.open(nextUrl);
  } catch (e: any) {
    _looping = false;
    logger.error(`[AVPlay] A.open() failed: ${e?.message}`);
    return;
  }
  _setupDisplay(_playerA);
  _playerA!.setListener(_makeListenerA());
  _playerA!.prepareAsync(
    () => {
      if (_destroyed) { _looping = false; return; }
      _setupDisplay(_playerA);
      _durationMs = _playerA!.getDuration();
      try { _playerA!.play(); } catch {}
      setTimeout(() => {
        if (_destroyed) { _looping = false; return; }
        try { _playerA!.pause(); } catch {}
        _looping     = false;
        _prebuffered = true;
        logger.info('[AVPlay] avplaystore: prebuffered at frame 0 -- LOOP_READY');
        if (_onLoop) _onLoop();
      }, 100);
    },
    (err: any) => {
      _looping = false;
      logger.error(`[AVPlay] A prepareAsync failed in prebuffer: ${JSON.stringify(err)}`);
    },
  );
}

function _prebufferGlobalAvplay(nextUrl: string): void {
  logger.info('[AVPlay] global avplay prebuffer: stop -> close -> open -> prepareAsync');
  try { webapis.avplay.stop(); } catch {}
  try { webapis.avplay.close(); } catch {}
  setTimeout(() => {
    if (_destroyed) { _looping = false; return; }
    try {
      webapis.avplay.open(nextUrl);
      _setupDisplay();
      webapis.avplay.setListener(_makeListenerSingle());
      webapis.avplay.prepareAsync(
        () => {
          if (_destroyed) { _looping = false; return; }
          _setupDisplay();
          _durationMs = webapis.avplay.getDuration();
          try { webapis.avplay.play(); } catch {}
          setTimeout(() => {
            if (_destroyed) { _looping = false; return; }
            try { webapis.avplay.pause(); } catch {}
            _looping     = false;
            _prebuffered = true;
            logger.info('[AVPlay] global: prebuffered at frame 0 -- LOOP_READY');
            if (_onLoop) _onLoop();
          }, 100);
        },
        (err: any) => {
          _looping = false;
          logger.error(`[AVPlay] global prebuffer failed: ${JSON.stringify(err)}`);
        },
      );
    } catch (e: any) {
      _looping = false;
      logger.error(`[AVPlay] global prebuffer open failed: ${e?.message}`);
    }
  }, 50);
}

// ---------------------------------------------------------------------------
// Scheduled play
// ---------------------------------------------------------------------------

export function schedulePlayAt(epochMs: number): void {
  if (_destroyed) return;
  clearTimeout(_playTimer);
  const wait = epochMs - Date.now();
  logger.info(`[AVPlay] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
  if (wait <= 0) { _doPlay(); return; }
  _playTimer = setTimeout(() => {
    (function spin() {
      if (_destroyed) return;
      if (Date.now() >= epochMs) { _doPlay(); return; }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, wait - 60));
}

function _doPlay(): void {
  _playTimer   = null;
  if (_destroyed || _playing) return;
  _prebuffered = false;
  _playing     = true;

  if (_useAvplaystore && _playerA) {
    // Release still-frame freeze, then play from frame 0 (paused there by prebuffer).
    _setStillMode(false);
    try {
      _playerA.play();
      logger.info('[AVPlay] avplaystore play() -- synchronized start');
    } catch (e: any) {
      logger.error(`[AVPlay] avplaystore play() failed: ${e?.message}`);
    }
  } else {
    try {
      webapis.avplay.play();
      logger.info('[AVPlay] global avplay play() -- synchronized start');
    } catch (e: any) {
      logger.error(`[AVPlay] play() failed: ${e?.message}`);
    }
  }
  _startDriftLog();
}

/**
 * Legacy entry point kept for any direct callers in sync.ts.
 * LOOP_GO now routes through schedulePlayAt -> _doPlay().
 */
export function playFromPrebuffer(): void {
  if (_destroyed) return;
  if (!_prebuffered) logger.warn('[AVPlay] playFromPrebuffer: not prebuffered');
  _doPlay();
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

export function getDuration(): number { return _durationMs; }

export function isPlaying(): boolean {
  if (_useAvplaystore && _playerA) return _playing && _getState(_playerA) === 'PLAYING';
  return _playing && _avState() === 'PLAYING';
}

export function getCurrentPosMs(): number | null {
  if (!_playing) return null;
  try {
    if (_useAvplaystore && _playerA) return _playerA.getCurrentTime();
    return webapis.avplay.getCurrentTime();
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export function destroyEngine(): void {
  _destroyed = true; _playing = false; _prebuffered = false; _looping = false;
  clearTimeout(_playTimer); _stopDriftLog();
  if (_playerA) {
    _setStillMode(false);
    try {
      const s = _getState(_playerA);
      if (s === 'PLAYING' || s === 'PAUSED') _playerA.stop();
      if (s !== 'NONE') _playerA.close();
      webapis.avplaystore.releasePlayer(_playerA);
    } catch {}
    _playerA = null;
  }
  try {
    const s = _avState();
    if (s === 'PLAYING' || s === 'PAUSED') webapis.avplay.stop();
    if (s !== 'NONE') webapis.avplay.close();
  } catch {}
  _useAvplaystore = false;
  logger.info('[AVPlay] engine destroyed');
}