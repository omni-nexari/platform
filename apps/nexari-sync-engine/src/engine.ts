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
  setVideoRoi?(xRatio: number, yRatio: number, wRatio: number, hRatio: number): void;
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

// Wall-crop state — survives destroyEngine/initEngine cycles.
// Uses AVPlay setVideoRoi(xRatio, yRatio, wRatio, hRatio) for true source-region
// crop (B2B/LFD only, since Tizen 6.0). The screen-side displayRect stays
// fullscreen (0,0,1920,1080); the ROI tells the decoder/scaler which slice
// of the source frame to render. On Tizen <6 setVideoRoi throws
// NotSupportedError and the device falls back to full-frame playback.
let _wallRoi: { xR: number; yR: number; wR: number; hR: number } | null = null;

// HTML5 <video> wall mode — A/B double-buffer pattern (mirrors nexari-html5-sync).
// On Tizen 4 reassigning src on a visible/playing video corrupts the hardware
// overlay, so we keep two persistent <video> elements: the visible one (fg) plays;
// the hidden one (bg) preloads + seeks the next clip; LOOP_GO swaps z-index/opacity.
let _useHtml5       = false;
let _html5Videos:   HTMLVideoElement[] = [];
let _html5Fg: 0 | 1 = 0;
let _html5FirstPlay = true;
let _html5EosTimer: any = null;
let _html5Container: HTMLElement | null = null;

const DRIFT_LOG_MS = 2000;
const H5_EOS_LEAD_MS = 1000;   // fire LOOP_READY 1s before fg ends

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
  // In wall mode the screen-side display rect is fullscreen; the source-region
  // crop is applied via _applyWallRoi() AFTER prepareAsync success (setVideoRoi
  // requires READY/PLAYING/PAUSED).
  if (_wallRoi) {
    if (p) {
      try { p.setDisplayRect(0, 0, 1920, 1080); } catch {}
      try { p.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN'); } catch {}
    } else {
      try { webapis.avplay.setDisplayRect(0, 0, 1920, 1080); } catch {}
      try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN'); } catch {}
    }
    return;
  }
  // Single-screen (no wall) — original role-based setup.
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

/**
 * Apply video-wall source-region crop.
 *
 * Path 1 — Tizen 6.0+ (B2B/LFD): setVideoRoi(xR, yR, wR, hR) — true source-region
 *   crop, GPU-scaled. Display rect stays fullscreen 1920×1080.
 *
 * Path 2 — Tizen <6 fallback: oversize setDisplayRect with offsets. Older
 *   Smart Signage AVPlay has unsigned-long displayRect params, so only
 *   non-negative offsets are legal. This means only the col=0/row=0 cell
 *   (xR=0, yR=0) can be cropped this way — anything requiring negative
 *   offset falls back to full-frame playback.
 *
 *   For (xR, yR, wR, hR) ROI, the equivalent display rect (clipped by the
 *   screen) is:
 *     outW = 1920 / wR;  outH = 1080 / hR
 *     offX = -xR * outW; offY = -yR * outH
 *   When offX==0 && offY==0 the screen ends up showing the [0..wR]×[0..hR]
 *   slice of the source, which is what we want for col=0/row=0.
 *
 * Must be called AFTER prepareAsync success (state must be READY/PLAYING/PAUSED).
 */
function _applyWallRoi(p?: AvPlayer | null): void {
  if (!_wallRoi) return;
  const { xR, yR, wR, hR } = _wallRoi;
  const target: any = p ?? (webapis as any).avplay;

  // Path 1 — Tizen 6.0+ setVideoRoi
  if (target && typeof target.setVideoRoi === 'function') {
    try {
      target.setVideoRoi(xR, yR, wR, hR);
      logger.info(`[AVPlay] setVideoRoi(${xR}, ${yR}, ${wR}, ${hR}) applied`);
      return;
    } catch (e: any) {
      logger.warn(`[AVPlay] setVideoRoi threw: ${e?.name ?? e?.message ?? e} — trying displayRect fallback`);
      // fall through to path 2
    }
  } else {
    logger.info('[AVPlay] setVideoRoi unavailable (Tizen <6.0?) — trying displayRect fallback');
  }

  // Path 2 — Tizen <6 oversize displayRect fallback (unsigned-long params)
  const outW = Math.round(1920 / wR);
  const outH = Math.round(1080 / hR);
  const offX = -Math.round(xR * outW);
  const offY = -Math.round(yR * outH);
  if (offX < 0 || offY < 0) {
    logger.warn(`[AVPlay] displayRect fallback needs negative offset (${offX},${offY}) — Tizen <6 cannot crop col>0/row>0; playing full frame`);
    return;
  }
  try {
    if (p) {
      p.setDisplayRect(offX, offY, outW, outH);
      try { p.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN'); } catch {}
    } else {
      webapis.avplay.setDisplayRect(offX, offY, outW, outH);
      try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN'); } catch {}
    }
    logger.info(`[AVPlay] displayRect oversize fallback (${offX},${offY},${outW},${outH}) applied`);
  } catch (e: any) {
    logger.warn(`[AVPlay] displayRect fallback threw: ${e?.name ?? e?.message ?? e} — playing full frame`);
  }
}

function _setStillMode(on: boolean): void {
  if (!_playerA) return;
  try { _playerA.setVideoStillMode(on ? 'true' : 'false'); } catch {}
}

function _h5Cleanup(): void {
  _h5StopEosWatch();
  for (const v of _html5Videos) {
    try { v.pause(); } catch {}
    if (v.parentNode) v.parentNode.removeChild(v);
  }
  _html5Videos = [];
  _html5Fg = 0;
  _html5FirstPlay = true;
}

function _h5StyleVideo(v: HTMLVideoElement, isFg: boolean): void {
  v.style.cssText = [
    'position:absolute', 'top:0', 'left:0',
    'background:#000',
  ].join(';');
  v.style.zIndex  = isFg ? '2' : '1';
  v.style.opacity = isFg ? '1' : '0';
  v.playsInline = true;
  v.autoplay = false;
  v.muted    = true;
  v.loop     = false;
  v.preload  = 'auto';
  if (_wallRoi) {
    const { xR, yR, wR, hR } = _wallRoi;
    const vw = Math.round(1920 / wR);
    const vh = Math.round(1080 / hR);
    const vl = -Math.round(xR * vw);
    const vt = -Math.round(yR * vh);
    v.style.width     = vw + 'px';
    v.style.height    = vh + 'px';
    v.style.transform = `translate(${vl}px,${vt}px)`;
    v.style.objectFit = 'fill';
  } else {
    v.style.width  = '100%';
    v.style.height = '100%';
    v.style.objectFit = 'contain';
  }
}

function _h5EnsureVideos(): void {
  if (_html5Videos.length === 2) return;
  _h5Cleanup();
  const host = _html5Container ?? document.body;
  for (let i = 0; i < 2; i++) {
    const v = document.createElement('video');
    v.id = 'nexari-h5-' + (i === 0 ? 'A' : 'B');
    _h5StyleVideo(v, i === 0);
    host.appendChild(v);
    _html5Videos.push(v);
  }
  _html5Fg = 0;
  _html5FirstPlay = true;
  if (_wallRoi) {
    const { xR, yR, wR, hR } = _wallRoi;
    const vw = Math.round(1920 / wR);
    const vh = Math.round(1080 / hR);
    const vl = -Math.round(xR * vw);
    const vt = -Math.round(yR * vh);
    logger.info(`[HTML5] A/B videos created — size=${vw}x${vh} offset=(${vl},${vt})`);
  } else {
    logger.info('[HTML5] A/B videos created — fullscreen');
  }
}

function _h5LoadSrc(v: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      v.removeEventListener('canplay',    onCanPlay);
      v.removeEventListener('loadeddata', onCanPlay);
      v.removeEventListener('error',      onError);
    };
    const onCanPlay = () => { if (done) return; done = true; cleanup(); resolve(); };
    const onError   = () => {
      if (done) return; done = true; cleanup();
      reject(new Error('video error code=' + (v.error?.code ?? '?') + ' src=' + url));
    };
    v.addEventListener('canplay',    onCanPlay);
    v.addEventListener('loadeddata', onCanPlay);  // fallback
    v.addEventListener('error',      onError);
    try { v.pause(); } catch {}
    v.src = url;
    v.load();
    setTimeout(() => { if (!done) { logger.warn('[HTML5] _h5LoadSrc canplay timeout — forcing'); onCanPlay(); } }, 8000);
  });
}

function _h5SeekToZero(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime) < 0.05) { resolve(); return; }
    let done = false;
    const onSeeked = () => { if (done) return; done = true; v.removeEventListener('seeked', onSeeked); resolve(); };
    v.addEventListener('seeked', onSeeked);
    try { v.pause(); v.currentTime = 0; } catch { done = true; v.removeEventListener('seeked', onSeeked); resolve(); return; }
    setTimeout(() => { if (!done) { done = true; v.removeEventListener('seeked', onSeeked); resolve(); } }, 800);
  });
}

/** Preload `(playlistIdx+1) % len` onto bg. Idempotent: skips if already at frame 0 of the right url. */
function _h5PreloadBg(): Promise<void> {
  if (_html5Videos.length < 2 || _playlist.length < 2) return Promise.resolve();
  const bg = _html5Videos[1 - _html5Fg];
  const nextIdx = (_playlistIdx + 1) % _playlist.length;
  const nextUrl = _playlist[nextIdx];
  if (bg.src === nextUrl && bg.readyState >= 2 && Math.abs(bg.currentTime) < 0.05) {
    return Promise.resolve();
  }
  logger.info(`[HTML5] bg preload: ${nextUrl.split('/').pop()}`);
  bg.style.opacity = '0';
  bg.style.zIndex  = '1';
  try { bg.pause(); } catch {}
  const loadOrReuse = (bg.src === nextUrl) ? Promise.resolve() : _h5LoadSrc(bg, nextUrl);
  return loadOrReuse.then(() => _h5SeekToZero(bg))
    .then(() => { logger.info('[HTML5] bg prebuffered at frame 0'); });
}

function _h5StartEosWatch(): void {
  _h5StopEosWatch();
  _html5EosTimer = setInterval(() => {
    if (_destroyed || _looping || _prebuffered) return;
    const v = _html5Videos[_html5Fg];
    if (!v) return;
    const ct = v.currentTime, dur = v.duration;
    if (!dur || !isFinite(dur)) return;
    if ((dur - ct) * 1000 < H5_EOS_LEAD_MS) {
      logger.info('[HTML5] EOS approaching — arming next loop');
      _h5StopEosWatch();
      _playing = false;  // allow the LOOP_GO _doPlay swap to proceed
      _prebufferForBarrier();
    }
  }, 200);
}

function _h5StopEosWatch(): void {
  if (_html5EosTimer != null) { clearInterval(_html5EosTimer); _html5EosTimer = null; }
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
      if (_useHtml5) {
        const v = _html5Videos[_html5Fg];
        if (!v) return;
        pos = Math.round(v.currentTime * 1000);
        st  = v.paused ? 'PAUSED' : 'PLAYING';
      } else if (_useAvplaystore && _playerA) {
        pos = _playerA.getCurrentTime();
        st  = _getState(_playerA);
      } else {
        pos = webapis.avplay.getCurrentTime();
        st  = _avState();
      }
      logger.info(`[${_useHtml5 ? 'HTML5' : 'AVPlay'}] pos=${pos}ms duration=${_durationMs}ms state=${st}`);
      if (_durationMs > 0 && pos >= _durationMs - 200) {
        frozenCount++;
        if (frozenCount >= 2) {
          frozenCount = 0;
          logger.warn(`[${_useHtml5 ? 'HTML5' : 'AVPlay'}] watchdog: frozen at end pos=${pos}ms -- forcing prebuffer`);
          _playing = false;  // must be reset so _doPlay() proceeds after LOOP_GO
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

/**
 * setWallCrop — configure AVPlay source-region crop for video-wall mode
 * via setVideoRoi(xRatio, yRatio, wRatio, hRatio). All ratios are 0..1.
 *
 * The decoder reads the full source frame; the GPU/scaler renders only the
 * specified sub-region, stretched to fill the panel (display rect stays
 * fullscreen 1920×1080).
 *
 * For a 2×1 wall with 1920×1080 source:
 *   col 0 (left):  setWallCrop(0,   0, 0.5, 1)   — QBC
 *   col 1 (right): setWallCrop(0.5, 0, 0.5, 1)   — SBB
 *
 * Requires Tizen 6.0+ B2B/LFD. On older devices (e.g. SBB Tizen 4) the
 * call is silently skipped and full-frame video plays — caller is expected
 * to fall back to HTML5 CSS-transform wall path on those devices.
 */
export function setWallCrop(xRatio: number, yRatio: number, wRatio: number, hRatio: number): void {
  _wallRoi = { xR: xRatio, yR: yRatio, wR: wRatio, hR: hRatio };
  logger.info(`[AVPlay] wall ROI set xR=${xRatio} yR=${yRatio} wR=${wRatio} hR=${hRatio}`);
}

/** Enable HTML5 <video> CSS-crop wall mode (Tizen <6 fallback). Must be called before initEngine(). */
export function setHtml5Wall(): void {
  _useHtml5 = true;
  logger.info('[HTML5] HTML5 wall mode enabled');
}

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

export function initEngine(container: HTMLElement): void {
  _destroyed = false; _playing = false; _durationMs = 0;
  _url = ''; _looping = false; _prebuffered = false;
  clearTimeout(_playTimer); _stopDriftLog();

  if (_useHtml5) {
    _html5Container = container;
    _h5Cleanup();
    // Defensively shut down any AVPlay HW plane that may be active from a
    // previous app run. On Tizen 4 SBB an active AVPlay overlay composites
    // simultaneously with HTML5 <video> planes, producing interlace stripes.
    try {
      const s = (() => { try { return webapis.avplay.getState() as string; } catch { return 'NONE'; } })();
      if (s === 'PLAYING' || s === 'PAUSED') webapis.avplay.stop();
      if (s !== 'NONE') webapis.avplay.close();
      logger.info(`[HTML5] init: pre-existing avplay state=${s} -- closed`);
    } catch (e: any) {
      logger.info(`[HTML5] init: avplay close skipped (${e?.message ?? e})`);
    }
    _h5EnsureVideos();
    logger.info('[HTML5] initEngine — HTML5 A/B wall mode');
    return;
  }

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
    if (_useHtml5) {
      _prepareHtml5(url, resolve, reject);
    } else if (_useAvplaystore && _playerA) {
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
      _applyWallRoi(p);
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
      _applyWallRoi();
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

function _prepareHtml5(url: string, resolve: () => void, reject: (e: Error) => void): void {
  _h5EnsureVideos();
  // Align _playlistIdx with the URL we're being asked to prepare (sync.ts may
  // have reordered the playlist on the follower).
  if (_playlist.length > 0) {
    const found = _playlist.indexOf(url);
    _playlistIdx = found >= 0 ? found : 0;
  }
  _html5FirstPlay = true;
  const fg = _html5Videos[_html5Fg];
  _h5LoadSrc(fg, url)
    .then(() => _h5SeekToZero(fg))
    .then(() => {
      if (_destroyed) return resolve();
      _durationMs = Math.round((fg.duration || 0) * 1000);
      logger.info(`[HTML5] fg(${_html5Fg === 0 ? 'A' : 'B'}) prepared — duration=${_durationMs}ms`);
      // Best-effort preload of next clip onto bg. Don't block prepare on this.
      _h5PreloadBg().catch((e) => logger.warn(`[HTML5] bg preload error: ${e?.message ?? e}`));
      resolve();
    })
    .catch((e: any) => reject(new Error(`HTML5 prepare failed: ${e?.message ?? e}`)));
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

  if (_useHtml5) {
    _prebufferHtml5(_url);
  } else if (_useAvplaystore && _playerA) {
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
      _applyWallRoi(_playerA);
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
          _applyWallRoi();
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

function _prebufferHtml5(nextUrl: string): void {
  // _prebufferForBarrier already advanced _playlistIdx and set _url=nextUrl.
  // The bg should ALREADY have nextUrl preloaded at frame 0 from the previous
  // _h5PreloadBg() call. If not, preload now.
  const bg = _html5Videos[1 - _html5Fg];
  const ready = bg && bg.src === nextUrl && bg.readyState >= 2 && Math.abs(bg.currentTime) < 0.05;
  const fire = () => {
    if (_destroyed) { _looping = false; return; }
    _looping = false;
    _prebuffered = true;
    logger.info('[HTML5] bg prebuffered — LOOP_READY');
    if (_onLoop) _onLoop();
  };
  if (ready) {
    logger.info('[HTML5] bg already at frame 0 — firing LOOP_READY immediately');
    fire();
    return;
  }
  logger.info('[HTML5] bg not ready — loading now');
  if (!bg) { _looping = false; return; }
  bg.style.opacity = '0';
  bg.style.zIndex  = '1';
  try { bg.pause(); } catch {}
  const loadOrReuse = (bg.src === nextUrl) ? Promise.resolve() : _h5LoadSrc(bg, nextUrl);
  loadOrReuse
    .then(() => _h5SeekToZero(bg))
    .then(fire)
    .catch((e) => {
      logger.warn(`[HTML5] prebuffer load failed: ${e?.message ?? e} — firing LOOP_READY anyway to unblock barrier`);
      fire();
    });
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

  if (_useHtml5) {
    if (_html5Videos.length < 2) {
      logger.error('[HTML5] _doPlay: videos not initialised');
      return;
    }
    if (_html5FirstPlay) {
      _html5FirstPlay = false;
      const fg = _html5Videos[_html5Fg];
      try { fg.currentTime = 0; } catch {}
      const p = fg.play() as any;
      const ok = () => {
        logger.info(`[HTML5] play() fg(${_html5Fg === 0 ? 'A' : 'B'}) — synchronized start`);
        _durationMs = Math.round((fg.duration || 0) * 1000);
        _h5StartEosWatch();
      };
      if (p && typeof p.then === 'function') {
        p.then(ok).catch((e: any) => logger.error(`[HTML5] play() failed: ${e?.message ?? e}`));
      } else {
        ok();
      }
      _startDriftLog();
      return;
    }
    // Swap path: bring bg to front and play it; pause+hide old fg after success.
    const oldFg = _html5Fg;
    const newFg = (1 - _html5Fg) as 0 | 1;
    const oldV  = _html5Videos[oldFg];
    const newV  = _html5Videos[newFg];
    newV.style.zIndex  = '2';
    newV.style.opacity = '1';
    oldV.style.zIndex  = '1';
    try { newV.currentTime = 0; } catch {}
    const p = newV.play() as any;
    const onSwapOk = () => {
      oldV.style.opacity = '0';
      try { oldV.pause(); } catch {}
      _html5Fg = newFg;
      _durationMs = Math.round((newV.duration || 0) * 1000);
      logger.info(`[HTML5] swap — now playing fg(${newFg === 0 ? 'A' : 'B'}) idx=${_playlistIdx}`);
      _h5StartEosWatch();
      // Preload clip-after-next onto the now-bg (the old fg).
      _h5PreloadBg().catch((e) => logger.warn(`[HTML5] post-swap preload failed: ${e?.message ?? e}`));
    };
    if (p && typeof p.then === 'function') {
      p.then(onSwapOk).catch((e: any) => {
        logger.error(`[HTML5] swap play() failed: ${e?.message ?? e}`);
        // Restore old fg as visible if swap failed.
        oldV.style.zIndex  = '2';
        oldV.style.opacity = '1';
        newV.style.zIndex  = '1';
        newV.style.opacity = '0';
      });
    } else {
      onSwapOk();
    }
    _startDriftLog();
    return;
  }

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
  if (_useHtml5) {
    const v = _html5Videos[_html5Fg];
    return _playing && v != null && !v.paused;
  }
  if (_useAvplaystore && _playerA) return _playing && _getState(_playerA) === 'PLAYING';
  return _playing && _avState() === 'PLAYING';
}

export function getCurrentPosMs(): number | null {
  if (!_playing) return null;
  if (_useHtml5) {
    const v = _html5Videos[_html5Fg];
    return v ? Math.round(v.currentTime * 1000) : null;
  }
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
  if (_useHtml5) {
    _h5Cleanup();
    logger.info('[HTML5] engine destroyed');
    return;
  }
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