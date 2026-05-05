/**
 * engine.ts — A/B HTML5 <video> engine for multi-clip Nexari Sync
 *
 * Two persistent <video> elements:
 *   foreground (fg) — currently playing the active clip (z-index 2, opacity 1)
 *   background (bg) — hidden, paused at frame 0 of the *next* clip (z-index 1, opacity 0)
 *
 * Only the hidden+paused bg ever has its src reassigned. The fg's src is never
 * touched while it's visible/playing — that's what corrupts Tizen 4's hardware
 * overlay. On LOOP_GO we swap (show+play bg, pause fg), then preload the
 * clip-after-next onto the now-bg.
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
    v.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'object-fit:contain', 'background:#000'
    ].join(';');
    v.style.zIndex  = i === 0 ? '2' : '1';
    v.style.opacity = i === 0 ? '1' : '0';
    v.playsInline = true;
    v.autoplay    = false;
    v.muted       = false;
    v.loop        = false;
    v.preload     = 'auto';
    container.appendChild(v);
    _videos.push(v);
  }

  _log('[Engine] initialised (HTML5 A/B-swap, 2 video elements)');
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
  if (_playTimer !== null) { clearTimeout(_playTimer); _playTimer = null; }
  for (const v of _videos) {
    try { v.pause(); } catch {}
    if (v.parentNode) v.parentNode.removeChild(v);
  }
  _videos = [];
  _durationMs = 0;
  _prebuffered = false;
  _looping = false;
  _firstPlay = true;
  _fg = 0;
  _idx = 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _log(msg: string): void {
  logger.info(msg);
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

  // Make sure bg is hidden + paused before src reassignment.
  bg.style.opacity = '0';
  bg.style.zIndex  = '1';
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
      _startEosWatch();
    }).catch(e => _log('[Engine] play() failed: ' + e));
    return;
  }

  // Swap path
  const oldFg = _fg;
  const newFg = (1 - _fg) as 0 | 1;
  const oldV  = _videos[oldFg];
  const newV  = _videos[newFg];

  // Bring new in front; old goes behind. Start new BEFORE pausing old so the
  // compositor briefly overlaps two frames (hides any single-slot decoder dip).
  newV.style.zIndex  = '2';
  newV.style.opacity = '1';
  oldV.style.zIndex  = '1';

  newV.play().then(() => {
    _log('[Engine] swap: now playing fg(' + (newFg === 0 ? 'A' : 'B') + ') idx=' + ((_idx + 1) % _playlist.length));
    oldV.style.opacity = '0';
    try { oldV.pause(); } catch {}
    _fg = newFg;
    _idx = (_idx + 1) % _playlist.length;
    _durationMs = Math.round((newV.duration || 0) * 1000);
    _prebuffered = false;
    _looping = false;
    _startEosWatch();
    // Preload clip-after-next onto the now-bg (the old fg).
    _preloadNext().catch((e) => _log('[Engine] preload-after-swap failed: ' + e));
  }).catch(e => {
    _log('[Engine] swap play() failed: ' + e);
    oldV.style.zIndex  = '2';
    oldV.style.opacity = '1';
    newV.style.zIndex  = '1';
    newV.style.opacity = '0';
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
