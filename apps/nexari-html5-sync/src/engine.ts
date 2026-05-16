/**
 * engine.ts — A/B HTML5 <video> engine for multi-clip Nexari Sync
 *
 * Two persistent <video> elements (A and B):
 *   foreground (fg) — currently playing the active clip
 *   background (bg) — hidden, paused at frame 0 of the *next* clip
 *
 * Non-wall mode: fg is visible via CSS opacity/zIndex; bg hidden.
 *
 * Wall mode (CSS transforms don't crop Samsung Tizen 4 HW video planes):
 *   Both <video> elements are detached from the DOM (display:none — no HW
 *   plane activated). A single <canvas> is displayed fullscreen. A
 *   requestAnimationFrame loop draws the active fg video with drawImage(),
 *   applying the crop: drawImage(fgVideo, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH).
 *   For a 2×1 wall with 1920×1080 content:
 *     col 0 (left):  srcX=0,   srcW=960  → stretched to 1920×1080
 *     col 1 (right): srcX=960, srcW=960  → stretched to 1920×1080
 */
import { logger } from './logger.js';
type Role = 'leader' | 'follower';

let _role: Role = 'follower';
let _playlist: string[] = [];
let _onLoop: (() => void) | null = null;

let _videos: HTMLVideoElement[] = [];   // [A, B]
let _fg: 0 | 1 = 0;
let _container: HTMLElement | null = null;

let _idx = 0;                  // playlist index of the foreground clip
let _durationMs = 0;
let _prebuffered = false;
let _looping = false;
let _firstPlay = true;

let _eosWatchTimer: ReturnType<typeof setInterval> | null = null;
let _playTimer: ReturnType<typeof setTimeout> | null = null;

// Wall-crop state — survives destroyEngine/initEngine cycles.
// srcX/srcY/srcW/srcH = region to read from source video (pixels).
// dstW/dstH = canvas (panel) size.
let _wallCrop: { srcX: number; srcY: number; srcW: number; srcH: number; dstW: number; dstH: number } | null = null;

// Canvas used in wall mode.
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _rafId: number | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setRole(r: Role): void { _role = r; }
export function setOnLoop(cb: () => void): void { _onLoop = cb; }
export function setPlaylist(urls: string[]): void {
  _playlist = urls;
  _idx = 0;
  _log('[Engine] playlist set (' + urls.length + '): ' + urls.map(u => u.split('/').pop()).join(', '));
}
export function getPlaylistUrls(): string[] { return _playlist; }

/**
 * setWallCrop — configure canvas-based crop for video-wall mode.
 *
 * For a 2×1 wall with 1920×1080 source content and 1920×1080 panels:
 *   colW = 1920 / 2 = 960
 *   col 0 (left):  srcX=0,   srcY=0, srcW=960, srcH=1080
 *   col 1 (right): srcX=960, srcY=0, srcW=960, srcH=1080
 *   Both drawn to canvas at (0,0) → (1920,1080) — stretched to fill the panel.
 *
 * srcX/srcY/srcW/srcH describe the source region in the video's native pixels.
 * dstW/dstH is the panel (canvas) size in pixels.
 */
export function setWallCrop(srcX: number, srcY: number, srcW: number, srcH: number, dstW: number, dstH: number): void {
  _wallCrop = { srcX, srcY, srcW, srcH, dstW, dstH };
  _log(`[Engine] wall crop set srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH} → canvas ${dstW}×${dstH}`);
  // If canvas already exists (restart path), resize it.
  if (_canvas) {
    _canvas.width  = dstW;
    _canvas.height = dstH;
  }
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

// ---------------------------------------------------------------------------
// Play-latency probe — used for cross-device sync auto-calibration
// ---------------------------------------------------------------------------

// Cached result; null until first call. Reset by destroyEngine().
let _playLatencyMs: number | null = null;

/**
 * measurePlayLatencyMs — measure the time from video.play() to the first
 * rendered frame on this hardware. The relay distributes all latencies via
 * PEERS so each device can compute selfLatency = max(group) - own, ensuring
 * the slowest device is the reference and all first-frames align.
 *
 * Uses requestVideoFrameCallback (Chromium ≥83 / Electron) for frame-level
 * accuracy; falls back to timeupdate for older platforms (Tizen WebKit).
 * Result is cached; repeated calls return immediately.
 */
export async function measurePlayLatencyMs(url?: string): Promise<number> {
  if (_playLatencyMs !== null) return _playLatencyMs;
  const src = url ?? _playlist[0];
  if (!src) { _playLatencyMs = 100; return 100; }

  return new Promise<number>((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = src;
    // Attach to document so the compositor renders frames — required for
    // requestVideoFrameCallback to fire. Removed in done().
    v.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);

    const done = (ms: number) => {
      clearTimeout(timer);
      try { v.pause(); v.src = ''; if (v.parentNode) v.parentNode.removeChild(v); } catch {}
      _playLatencyMs = Math.max(10, ms);
      _log('[Engine] play-latency probe: ' + _playLatencyMs + 'ms');
      resolve(_playLatencyMs);
    };
    const timer = setTimeout(() => done(80), 2000); // 2 s max; 80 ms default for Chromium/Electron

    v.addEventListener('canplaythrough', () => {
      const t0 = performance.now();
      if (typeof (v as any).requestVideoFrameCallback === 'function') {
        // Chromium/Electron: fires on actual frame paint — sub-ms accurate.
        (v as any).requestVideoFrameCallback(() => done(Math.round(performance.now() - t0)));
      } else {
        // Tizen WebKit fallback: timeupdate fires when decoded pixels are available.
        v.addEventListener('timeupdate', () => done(Math.round(performance.now() - t0)), { once: true });
      }
      v.play().catch(() => {});
    }, { once: true });
    v.load();
  });
}

/** Returns the cached play-latency, or 100 ms if not yet measured. */
export function getPlayLatencyMs(): number { return _playLatencyMs ?? 100; }

export function initEngine(container: HTMLElement): Promise<void> {
  if (_videos.length) return Promise.resolve();
  _container = container;

  for (let i = 0; i < 2; i++) {
    const v = document.createElement('video');
    v.id = 'nexari-player-' + (i === 0 ? 'A' : 'B');
    // Keep videos out of the DOM entirely in wall mode (no HW plane).
    // In non-wall mode, append them to the container and use CSS opacity.
    if (!_wallCrop) {
      v.style.cssText = [
        'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'object-fit:contain', 'background:#000'
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
    // Wall mode: create a fullscreen canvas. Videos stay off-DOM.
    const { dstW, dstH } = _wallCrop;
    _canvas = document.createElement('canvas');
    _canvas.width  = dstW;
    _canvas.height = dstH;
    _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
    container.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
    _log(`[Engine] initialised (canvas wall mode, ${dstW}×${dstH})`);
  } else {
    _log('[Engine] initialised (HTML5 A/B-swap, 2 video elements)');
  }

  return Promise.resolve();
}

/**
 * prepare — load the first clip onto the foreground element. After load+seek,
 * fires LOOP_READY (matches single-src engine semantics). Kicks off bg preload.
 */
export function prepare(url: string): Promise<void> {
  if (_videos.length === 0) return Promise.reject(new Error('call initEngine first'));

  // Align _idx with the playlist URL (sync.ts may reorder playlist on follower).
  if (_playlist.length > 0) {
    const found = _playlist.indexOf(url);
    _idx = found >= 0 ? found : 0;
  }

  const fgVideo = _videos[_fg];

  // Same src already loaded → just rewind and fire LOOP_READY.
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
    // Preload next clip onto bg in the background.
    _preloadNext().catch((e) => _log('[Engine] preload next failed: ' + e));
  });
}

/**
 * schedulePlayAt — play at a specific epoch ms (used with GO and LOOP_GO).
 * On cycle 0 (just after prepare) we just play the fg — no swap yet.
 * On subsequent LOOP_GO calls, we swap A↔B atomically at the epoch.
 */
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

/** Immediate play (resync path / first prebuffer). */
export function playFromPrebuffer(): void {
  _doPlayOrSwap();
}

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
  _canvas = null;
  _ctx = null;
  _durationMs = 0;
  _prebuffered = false;
  _looping = false;
  _firstPlay = true;
  _fg = 0;
  _playLatencyMs = null; // reset so next session re-measures on this hardware
  _idx = 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _log(msg: string): void {
  logger.info(msg);
}

/** Start the canvas draw loop (wall mode only). */
function _startRaf(): void {
  if (!_wallCrop || !_ctx || _rafId !== null) return;
  const { srcX, srcY, srcW, srcH, dstW, dstH } = _wallCrop;
  const draw = () => {
    const v = _videos[_fg];
    if (v && v.readyState >= 2) {
      _ctx!.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);
    }
    _rafId = requestAnimationFrame(draw);
  };
  _rafId = requestAnimationFrame(draw);
}

/** Stop the canvas draw loop. */
function _stopRaf(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

function _fgLabel(): string { return _fg === 0 ? 'A' : 'B'; }
function _bgLabel(): string { return _fg === 0 ? 'B' : 'A'; }

/** Load src on a video element and wait for canplay. */
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

/** Seek the freshly-loaded fg to 0 and fire LOOP_READY. */
function _rewindFgAndArm(): Promise<void> {
  const v = _videos[_fg];
  if (_looping) return Promise.resolve();
  if (_prebuffered) {
    if (_onLoop) _onLoop();
    return Promise.resolve();
  }

  _stopEosWatch();
  _looping = true;
  _prebuffered = false;

  return new Promise<void>((resolve) => {
    let armed = false;
    let safetyTid: ReturnType<typeof setTimeout>;

    const arm = () => {
      if (armed) return;
      armed = true;
      clearTimeout(safetyTid);
      _looping = false;
      _prebuffered = true;
      _log('[Engine] fg(' + _fgLabel() + ') armed at frame 0 — firing LOOP_READY');
      if (_onLoop) _onLoop();
      resolve();
    };

    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      arm();
    };
    v.addEventListener('seeked', onSeeked, { once: true });

    try {
      v.pause();
      v.currentTime = 0;
    } catch {
      v.removeEventListener('seeked', onSeeked);
      arm();
      return;
    }

    safetyTid = setTimeout(() => {
      v.removeEventListener('seeked', onSeeked);
      _log('[Engine] fg seek timeout — arming anyway');
      arm();
    }, 500);
  });
}

/** Load the *next* playlist clip onto the bg element and seek to 0. Idempotent. */
function _preloadNext(): Promise<void> {
  if (_videos.length < 2 || _playlist.length < 2) return Promise.resolve();
  const bg = _videos[1 - _fg];
  const nextIdx = (_idx + 1) % _playlist.length;
  const nextUrl = _playlist[nextIdx];

  if (bg.src === nextUrl && bg.readyState >= 2 && Math.abs(bg.currentTime) < 0.05) {
    return Promise.resolve();   // already prebuffered at frame 0
  }

  _log('[Engine] bg(' + _bgLabel() + ') preload: ' + nextUrl.split('/').pop());

  // In CSS mode: ensure bg is hidden before reassigning src.
  // In canvas mode: video is off-DOM, no CSS needed.
  if (!_wallCrop) {
    bg.style.opacity = '0';
    bg.style.zIndex  = '1';
  }
  try { bg.pause(); } catch {}

  const loadOrReuse = (bg.src === nextUrl) ? Promise.resolve() : _loadSrc(bg, nextUrl);

  return loadOrReuse.then(() => new Promise<void>((res) => {
    if (Math.abs(bg.currentTime) < 0.05) { res(); return; }
    const onSeeked = () => { bg.removeEventListener('seeked', onSeeked); res(); };
    bg.addEventListener('seeked', onSeeked, { once: true });
    try { bg.currentTime = 0; } catch { res(); return; }
    setTimeout(() => { bg.removeEventListener('seeked', onSeeked); res(); }, 1500);
  })).then(() => {
    _log('[Engine] bg(' + _bgLabel() + ') prebuffered at frame 0');
  });
}

/** Cycle 0: just play fg. Cycle 1+: swap fg↔bg and play new fg. */
function _doPlayOrSwap(): void {
  if (_videos.length === 0) return;

  if (_firstPlay) {
    _firstPlay = false;
    _prebuffered = false;
    _videos[_fg].play().then(() => {
      _log('[Engine] play() fg(' + _fgLabel() + ') OK');
      _durationMs = Math.round((_videos[_fg].duration || 0) * 1000);
      if (_wallCrop) _startRaf();
      _startEosWatch();
    }).catch(e => _log('[Engine] play() failed: ' + e));
    return;
  }

  // Single-item playlist (or bg never loaded): no swap possible — rewind fg and replay.
  // _preloadNext() is a no-op when _playlist.length < 2, so bg.src is empty.
  const bgV = _videos[1 - _fg];
  if (_playlist.length <= 1 || !bgV.src) {
    const fgV = _videos[_fg];
    _prebuffered = false;
    _looping = false;
    _log('[Engine] single-item loop — rewinding fg(' + _fgLabel() + ')');
    const doPlay = () => {
      fgV.play().then(() => {
        _durationMs = Math.round((fgV.duration || 0) * 1000);
        _startEosWatch();
      }).catch(e => _log('[Engine] rewind-play failed: ' + e));
    };
    if (fgV.currentTime > 0.05) {
      let safetyClear = false;
      const onSeeked = () => { if (!safetyClear) { safetyClear = true; doPlay(); } };
      fgV.addEventListener('seeked', onSeeked, { once: true });
      try { fgV.currentTime = 0; } catch { onSeeked(); return; }
      setTimeout(() => { fgV.removeEventListener('seeked', onSeeked); if (!safetyClear) { safetyClear = true; doPlay(); } }, 1000);
    } else {
      doPlay();
    }
    return;
  }

  // Swap path (multi-item playlist — bg was preloaded by _preloadNext)
  const oldFg = _fg;
  const newFg = (1 - _fg) as 0 | 1;
  const oldV  = _videos[oldFg];
  const newV  = _videos[newFg];

  newV.play().then(() => {
    _log('[Engine] swap: now playing fg(' + (newFg === 0 ? 'A' : 'B') + ') idx=' + ((_idx + 1) % _playlist.length));
    if (_wallCrop) {
      // Canvas mode: flip the fg pointer; RAF loop starts drawing newV immediately.
      // Pause old only after new is confirmed playing.
      _fg = newFg;
      try { oldV.pause(); } catch {}
    } else {
      // CSS mode: update visibility then flip pointer.
      newV.style.zIndex  = '2';
      newV.style.opacity = '1';
      oldV.style.zIndex  = '1';
      oldV.style.opacity = '0';
      try { oldV.pause(); } catch {}
      _fg = newFg;
    }
    _idx = (_idx + 1) % _playlist.length;
    _durationMs = Math.round((newV.duration || 0) * 1000);
    _prebuffered = false;
    _looping = false;
    _startEosWatch();
    _preloadNext().catch((e) => _log('[Engine] preload-after-swap failed: ' + e));
  }).catch(e => {
    _log('[Engine] swap play() failed: ' + e);
    if (!_wallCrop) {
      oldV.style.zIndex  = '2';
      oldV.style.opacity = '1';
      newV.style.zIndex  = '1';
      newV.style.opacity = '0';
    }
  });
}

function _startEosWatch(): void {
  _stopEosWatch();
  const fgV = _videos[_fg];
  _eosWatchTimer = setInterval(() => {
    const v = _videos[_fg];
    if (!v || _prebuffered || _looping) return;
    const ct  = v.currentTime;
    const dur = v.duration;
    if (!dur || !isFinite(dur)) return;
    if (dur - ct < 1.0) {
      _log('[Engine] EOS approaching — arming for next loop');
      _stopEosWatch();
      _armNextLoop().catch(e => _log('[Engine] arm next-loop failed: ' + e));
    }
  }, 200);

  fgV.addEventListener('ended', _onVideoEnded, { once: true });
}

function _stopEosWatch(): void {
  if (_eosWatchTimer !== null) {
    clearInterval(_eosWatchTimer);
    _eosWatchTimer = null;
  }
  for (const v of _videos) v.removeEventListener('ended', _onVideoEnded);
}

function _onVideoEnded(): void {
  _log('[Engine] video.ended');
  if (!_looping && !_prebuffered) {
    _armNextLoop().catch(e => _log('[Engine] arm-on-ended failed: ' + e));
  }
}

/** Ensure bg has next clip prebuffered, then fire LOOP_READY. */
function _armNextLoop(): Promise<void> {
  if (_looping) return Promise.resolve();
  if (_prebuffered) {
    if (_onLoop) _onLoop();
    return Promise.resolve();
  }
  _looping = true;

  return _preloadNext().then(() => {
    _looping = false;
    _prebuffered = true;
    _log('[Engine] bg prebuffered — firing LOOP_READY');
    if (_onLoop) _onLoop();
  }).catch((e) => {
    _looping = false;
    _log('[Engine] arm next-loop preload error: ' + e);
    // Fire LOOP_READY anyway so the barrier doesn't stall the whole group.
    _prebuffered = true;
    if (_onLoop) _onLoop();
  });
}
