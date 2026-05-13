/**
 * engine.ts — A/B HTML5 <video> engine for multi-clip sync playback.
 *
 * Ported verbatim from apps/nexari-html5-sync/src/engine.ts; only the
 * logger import path is adjusted for the player-web package layout.
 *
 * Two persistent <video> elements (A and B):
 *   foreground (fg) — currently playing the active clip
 *   background (bg) — hidden, paused at frame 0 of the *next* clip
 *
 * Non-wall mode: fg is visible via CSS opacity/zIndex; bg hidden.
 *
 * Wall mode (CSS transforms don't crop HW video planes on Samsung Tizen 4):
 *   Both <video> elements are kept off-DOM (display:none). A single <canvas>
 *   is displayed fullscreen. A requestAnimationFrame loop draws the active fg
 *   video with drawImage(), applying the crop rect.
 */
import { logger } from '../logger.js';

type Role = 'leader' | 'follower';

let _role: Role = 'follower';
let _playlist: string[] = [];
let _onLoop: (() => void) | null = null;

let _videos: HTMLVideoElement[] = [];   // [A, B]
let _fg: 0 | 1 = 0;
let _container: HTMLElement | null = null;

let _idx = 0;
let _durationMs = 0;
let _prebuffered = false;
let _looping = false;
let _firstPlay = true;

let _eosWatchTimer: ReturnType<typeof setInterval> | null = null;
let _playTimer: ReturnType<typeof setTimeout> | null = null;

let _wallCrop: { srcX: number; srcY: number; srcW: number; srcH: number; dstW: number; dstH: number } | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _rafId: number | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function setRole(r: Role): void { _role = r; }
export function setOnLoop(cb: () => void): void { _onLoop = cb; }
export function setPlaylist(urls: string[]): void {
  _playlist = urls;
  _idx = 0;
  _log('[Engine] playlist set (' + urls.length + '): ' + urls.map(u => u.split('/').pop()).join(', '));
}
export function getPlaylistUrls(): string[] { return _playlist; }

export function setWallCrop(
  srcX: number, srcY: number, srcW: number, srcH: number, dstW: number, dstH: number,
): void {
  _wallCrop = { srcX, srcY, srcW, srcH, dstW, dstH };
  _log(`[Engine] wall crop set srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH} → canvas ${dstW}×${dstH}`);
  if (_canvas) { _canvas.width = dstW; _canvas.height = dstH; }
}

export function isPlaying(): boolean {
  const v = _videos[_fg];
  return !!v && !v.paused && !v.ended && v.readyState >= 2;
}
export function getCurrentPosMs(): number {
  const v = _videos[_fg];
  return v ? v.currentTime * 1000 : 0;
}
export function getDuration(): number { return _durationMs; }

export function initEngine(container: HTMLElement): Promise<void> {
  if (_videos.length) return Promise.resolve();
  _container = container;

  for (let i = 0; i < 2; i++) {
    const v = document.createElement('video');
    v.id = 'nexari-player-' + (i === 0 ? 'A' : 'B');
    if (!_wallCrop) {
      v.style.cssText = [
        'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'object-fit:contain', 'background:#000',
      ].join(';');
      v.style.zIndex  = i === 0 ? '2' : '1';
      v.style.opacity = i === 0 ? '1' : '0';
      container.appendChild(v);
    }
    v.playsInline = true;
    v.autoplay    = false;
    v.muted       = false;
    v.loop        = false;
    v.preload     = 'auto';
    _videos.push(v);
  }

  if (_wallCrop) {
    const { dstW, dstH } = _wallCrop;
    _canvas = document.createElement('canvas');
    _canvas.width  = dstW;
    _canvas.height = dstH;
    _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
    container.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
    _log(`[Engine] initialised (canvas wall mode, ${dstW}×${dstH})`);
  } else {
    _log('[Engine] initialised (HTML5 A/B-swap)');
  }

  return Promise.resolve();
}

export function prepare(url: string): Promise<void> {
  if (_videos.length === 0) return Promise.reject(new Error('call initEngine first'));

  if (_playlist.length > 0) {
    const found = _playlist.indexOf(url);
    _idx = found >= 0 ? found : 0;
  }

  const fgVideo = _videos[_fg]!

  if (fgVideo.src && fgVideo.src === url) {
    _log('[Engine] prepare: same src — reusing fg');
    return _rewindFgAndArm().then(() => { _preloadNext().catch(() => {}); });
  }

  _log('[Engine] prepare: ' + url.split('/').pop() + ' onto fg=' + _fgLabel());
  return _loadSrc(fgVideo, url).then(() => {
    _durationMs = Math.round((fgVideo.duration || 0) * 1000);
    _log('[Engine] prepare done — duration=' + (_durationMs / 1000).toFixed(2) + 's');
    return _rewindFgAndArm();
  }).then(() => {
    _preloadNext().catch((e) => _log('[Engine] preload next failed: ' + e));
  });
}

export function schedulePlayAt(epochMs: number): void {
  if (_playTimer !== null) clearTimeout(_playTimer);
  const waitMs = epochMs - Date.now();
  _log('[Engine] schedulePlayAt T-' + waitMs + 'ms firstPlay=' + _firstPlay);
  _playTimer = setTimeout(() => {
    (function spin() {
      if (Date.now() >= epochMs) { _doPlayOrSwap(); return; }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, waitMs - 60));
}

export function playFromPrebuffer(): void { _doPlayOrSwap(); }

export function destroyEngine(): void {
  _stopEosWatch();
  _stopRaf();
  if (_playTimer !== null) { clearTimeout(_playTimer); _playTimer = null; }
  for (const v of _videos) {
    try { v.pause(); } catch {}
    if (v.parentNode) v.parentNode.removeChild(v);
  }
  _videos = [];
  if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
  _canvas = null; _ctx = null;
  _durationMs = 0; _prebuffered = false; _looping = false;
  _firstPlay = true; _fg = 0; _idx = 0;
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _log(msg: string): void { logger.info(msg); }

function _startRaf(): void {
  if (!_wallCrop || !_ctx || _rafId !== null) return;
  const { srcX, srcY, srcW, srcH, dstW, dstH } = _wallCrop;
  const draw = () => {
    const v = _videos[_fg];
    if (v && v.readyState >= 2) _ctx!.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);
    _rafId = requestAnimationFrame(draw);
  };
  _rafId = requestAnimationFrame(draw);
}
function _stopRaf(): void {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}

function _fgLabel(): string { return _fg === 0 ? 'A' : 'B'; }
function _bgLabel(): string { return _fg === 0 ? 'B' : 'A'; }

function _loadSrc(v: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onCanPlay = () => { cleanup(); resolve(); };
    const onError   = () => {
      cleanup();
      const ve = v.error;
      reject(new Error('video error code=' + (ve?.code ?? '?') + ' src=' + url));
    };
    function cleanup() {
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('error', onError);
    }
    v.addEventListener('canplay', onCanPlay, { once: true });
    v.addEventListener('error', onError, { once: true });
    try { v.pause(); } catch {}
    v.src = url;
    v.load();
  });
}

function _rewindFgAndArm(): Promise<void> {
  const v = _videos[_fg]!
  if (_looping) return Promise.resolve();
  if (_prebuffered) { if (_onLoop) _onLoop(); return Promise.resolve(); }

  _stopEosWatch();
  _looping = true; _prebuffered = false;

  return new Promise<void>((resolve) => {
    let armed = false;
    let safetyTid: ReturnType<typeof setTimeout>;

    const arm = () => {
      if (armed) return;
      armed = true;
      clearTimeout(safetyTid);
      _looping = false; _prebuffered = true;
      _log('[Engine] fg(' + _fgLabel() + ') armed at frame 0 — firing LOOP_READY');
      if (_onLoop) _onLoop();
      resolve();
    };

    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); arm(); };
    v.addEventListener('seeked', onSeeked, { once: true });
    try { v.pause(); v.currentTime = 0; }
    catch { v.removeEventListener('seeked', onSeeked); arm(); return; }
    safetyTid = setTimeout(() => { v.removeEventListener('seeked', onSeeked); _log('[Engine] fg seek timeout'); arm(); }, 500);
  });
}

function _preloadNext(): Promise<void> {
  if (_videos.length < 2 || _playlist.length < 2) return Promise.resolve();
  const bg = _videos[1 - _fg]!;
  const nextIdx = (_idx + 1) % _playlist.length;
  const nextUrl = _playlist[nextIdx]!

  if (bg.src === nextUrl && bg.readyState >= 2 && Math.abs(bg.currentTime) < 0.05) return Promise.resolve();

  _log('[Engine] bg(' + _bgLabel() + ') preload: ' + nextUrl.split('/').pop());
  if (!_wallCrop) { bg.style.opacity = '0'; bg.style.zIndex = '1'; }
  try { bg.pause(); } catch {}

  const loadOrReuse = (bg.src === nextUrl) ? Promise.resolve() : _loadSrc(bg, nextUrl);
  return loadOrReuse.then(() => new Promise<void>((res) => {
    if (Math.abs(bg.currentTime) < 0.05) { res(); return; }
    const onSeeked = () => { bg.removeEventListener('seeked', onSeeked); res(); };
    bg.addEventListener('seeked', onSeeked, { once: true });
    try { bg.currentTime = 0; } catch { res(); return; }
    setTimeout(() => { bg.removeEventListener('seeked', onSeeked); res(); }, 1500);
  })).then(() => { _log('[Engine] bg(' + _bgLabel() + ') prebuffered at frame 0'); });
}

function _doPlayOrSwap(): void {
  if (_videos.length === 0) return;

  if (_firstPlay) {
    _firstPlay = false; _prebuffered = false;
    _videos[_fg]!.play().then(() => {
      _log('[Engine] play() fg(' + _fgLabel() + ') OK');
      _durationMs = Math.round((_videos[_fg]!.duration || 0) * 1000);
      if (_wallCrop) _startRaf();
      _startEosWatch();
    }).catch(e => _log('[Engine] play() failed: ' + e));
    return;
  }

  // Single-item playlist or bg not loaded: rewind fg and replay.
  const bgV = _videos[1 - _fg]!;
  if (_playlist.length <= 1 || !bgV.src) {
    const fgV = _videos[_fg]!;
    _prebuffered = false; _looping = false;
    _log('[Engine] single-item loop — rewinding fg(' + _fgLabel() + ')');
    const doPlay = () => {
      fgV.play().then(() => {
        _durationMs = Math.round((fgV.duration || 0) * 1000);
        _startEosWatch();
      }).catch(e => _log('[Engine] rewind-play failed: ' + e));
    };
    if (fgV.currentTime > 0.05) {
      let done = false;
      const onSeeked = () => { if (!done) { done = true; doPlay(); } };
      fgV.addEventListener('seeked', onSeeked, { once: true });
      try { fgV.currentTime = 0; } catch { onSeeked(); return; }
      setTimeout(() => { fgV.removeEventListener('seeked', onSeeked); if (!done) { done = true; doPlay(); } }, 1000);
    } else {
      doPlay();
    }
    return;
  }

  const oldFg = _fg;
  const newFg = (1 - _fg) as 0 | 1;
  const oldV  = _videos[oldFg]!;
  const newV  = _videos[newFg]!

  newV.play().then(() => {
    _log('[Engine] swap: now playing fg(' + (newFg === 0 ? 'A' : 'B') + ')');
    if (_wallCrop) {
      _fg = newFg;
      try { oldV.pause(); } catch {}
    } else {
      newV.style.zIndex  = '2'; newV.style.opacity = '1';
      oldV.style.zIndex  = '1'; oldV.style.opacity = '0';
      try { oldV.pause(); } catch {}
      _fg = newFg;
    }
    _idx = (_idx + 1) % _playlist.length;
    _durationMs = Math.round((newV.duration || 0) * 1000);
    _prebuffered = false; _looping = false;
    _startEosWatch();
    _preloadNext().catch((e) => _log('[Engine] preload-after-swap failed: ' + e));
  }).catch(e => {
    _log('[Engine] swap play() failed: ' + e);
    if (!_wallCrop) {
      oldV.style.zIndex = '2'; oldV.style.opacity = '1';
      newV.style.zIndex = '1'; newV.style.opacity = '0';
    }
  });
}

function _startEosWatch(): void {
  _stopEosWatch();
  const v = _videos[_fg];
  if (!v) return;
  const dur = v.duration;
  if (!isFinite(dur) || dur <= 0) return;

  _eosWatchTimer = setInterval(() => {
    const cv = _videos[_fg];
    if (!cv) { _stopEosWatch(); return; }
    if (cv.ended || (isFinite(cv.duration) && cv.currentTime >= cv.duration - 0.08)) {
      _stopEosWatch();
      _onEos();
    }
  }, 100);
}

function _stopEosWatch(): void {
  if (_eosWatchTimer !== null) { clearInterval(_eosWatchTimer); _eosWatchTimer = null; }
}

function _onEos(): void {
  _log('[Engine] EOS fg(' + _fgLabel() + ') idx=' + _idx);
  _prebuffered = false;
  // Always go through _rewindFgAndArm() so LOOP_READY is sent for the barrier,
  // even for single-item playlists. _doPlayOrSwap() handles the rewind-replay
  // path when bg isn’t loaded (single item).
  _rewindFgAndArm().then(() => {
    _preloadNext().catch(() => {});
  });
}
