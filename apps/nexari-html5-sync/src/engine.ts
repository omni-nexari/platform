/**
 * engine.ts - HTML5 Video engine for Nexari HTML5 Sync (A/B swap)
 *
 * Why A/B swap:
 *   On Tizen 4.0 WebKit the <video> element renders into a hardware overlay
 *   surface. When you reassign `src` on the same element, internal state
 *   (currentTime, duration, decoder) updates correctly, but the overlay
 *   surface keeps showing the LAST frame of the previous clip until the
 *   element itself is replaced. play()+pause() does NOT force a repaint.
 *
 *   The fix is a classic A/B (ping-pong) swap. Two <video> elements are
 *   stacked. While A is the visible/playing element, B is hidden behind A
 *   and prebuffers the next clip. On LOOP_GO we hide A and show B, then
 *   play B. The Tizen compositor sees a different element come forward and
 *   renders correctly. After playing B, it becomes the "active" element and
 *   A becomes the next prebuffer target.
 *
 *   Bonus: the formerly-active element keeps its last frame visible until
 *   the next swap, so transitions remain smooth (no black flash).
 *
 * Public API is unchanged from the single-element version.
 */
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _videoA: HTMLVideoElement | null = null;
let _videoB: HTMLVideoElement | null = null;

// _active = currently visible / playing.
// _buffer = hidden, used to prebuffer the next clip.
let _active: HTMLVideoElement | null = null;
let _buffer: HTMLVideoElement | null = null;

let _container: HTMLElement | null = null;

let _url            = '';
let _durationMs     = 0;     // duration of the ACTIVE clip
let _bufferedDurMs  = 0;     // duration of the BUFFER clip (set after prebuffer)
let _playing        = false;
let _destroyed      = false;
let _prebuffered    = false;
let _looping        = false;

let _playTimer:  any = null;
let _driftTimer: any = null;

let _role:   'leader' | 'follower' | null = null;
let _onLoop: (() => void) | null          = null;

let _playlist:    string[] = [];
let _playlistIdx: number   = 0;

const DRIFT_LOG_MS = 2000;
// Tizen 4.0 hardware video overlays ignore ALL CSS (position, top/left,
// z-index, opacity) — every <video> element renders at (0,0) on the hardware
// compositor regardless of styling.  display:none is the ONLY property that
// actually suppresses a Tizen hardware overlay surface.

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export function setRole(role: 'leader' | 'follower'): void {
  _role = role;
  if (_videoA) _applyStyle(_videoA);
  if (_videoB) _applyStyle(_videoB);
}

export function setOnLoop(cb: () => void): void { _onLoop = cb; }

export function setPlaylist(urls: string[]): void {
  if (urls.length === 0) return;
  _playlist    = urls;
  _playlistIdx = 0;
  _url         = urls[0];
  logger.info(`[HTML5] playlist (${urls.length}): ${urls.map((u) => u.split('/').pop()).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initEngine(container: HTMLElement): void {
  _container = container;
  _destroyed = false; _playing = false; _durationMs = 0; _bufferedDurMs = 0;
  _url = ''; _looping = false; _prebuffered = false;
  clearTimeout(_playTimer); _stopDriftLog();

  // Remove any stale <video> elements from prior runs
  Array.from(container.querySelectorAll('video')).forEach((v) => {
    try { (v as HTMLVideoElement).pause(); } catch {}
    if (v.parentNode) v.parentNode.removeChild(v);
  });

  // Container must be a positioned ancestor for our absolute children.
  if (!container.style.position || container.style.position === 'static') {
    container.style.position = 'relative';
  }

  _videoA = _createVideoElement();
  _videoB = _createVideoElement();
  container.appendChild(_videoA);
  container.appendChild(_videoB);

  _active = _videoA;
  _buffer = _videoB;
  _showActive();

  logger.info('[HTML5] engine initialised (A/B swap)');
}

function _createVideoElement(): HTMLVideoElement {
  const v = document.createElement('video');
  v.autoplay  = false;
  v.muted     = false;
  v.playsInline = true;
  _applyStyle(v);
  return v;
}

function _applyStyle(v: HTMLVideoElement): void {
  v.style.position   = 'absolute';
  v.style.top        = '0';
  v.style.left       = '0';
  v.style.width      = '100%';
  v.style.height     = '100%';
  v.style.objectFit  = 'contain';
  v.style.background = '#000';
  // Hidden by default; _showActive() flips active to display:block.
  v.style.display    = 'none';
}

/**
 * Show active element, hide buffer element.
 * display:none is the ONLY CSS property that suppresses a Tizen 4.0
 * hardware video overlay — opacity/z-index/position are all ignored.
 */
function _showActive(): void {
  if (_active) _active.style.display = 'block';
  if (_buffer) _buffer.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Prepare (first clip)
// ---------------------------------------------------------------------------

export function prepare(url: string): Promise<void> {
  _url = url; _durationMs = 0; _playing = false;
  _prebuffered = false; _looping = false;
  clearTimeout(_playTimer); _stopDriftLog();
  if (_playlist.length === 0) { _playlist = [url]; _playlistIdx = 0; }

  logger.info(`[HTML5] prepare: ${url.split('/').pop()}`);
  return _loadActive(url);
}

// ---------------------------------------------------------------------------
// Core load helpers
// ---------------------------------------------------------------------------

/** Load a URL into the ACTIVE element (used for the very first clip only). */
function _loadActive(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const v = _active;
    if (!v) return reject(new Error('no active video'));

    v.onended = null;
    v.onerror = null;

    try { v.pause(); } catch {}
    v.src = url;
    v.load();

    const cleanup = () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onErr);
    };
    const onErr = () => {
      const e = v.error;
      cleanup();
      reject(new Error(`active load error code=${e?.code} msg=${e?.message}`));
    };
    const onMeta = () => {
      cleanup();
      if (_destroyed) return resolve();
      _durationMs = Math.round((v.duration || 0) * 1000);
      logger.info(`[HTML5] prepared (active): ${url.split('/').pop()} duration=${_durationMs}ms`);
      _attachEosListener(v);
      resolve();
    };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.addEventListener('error', onErr, { once: true });
  });
}

/**
 * Load a URL into the BUFFER (hidden) element and pause at frame 0.
 * Because this element is behind the visible one, we can do play+pause to
 * force the decoder to render frame 0 onto its surface without showing
 * anything on screen yet. On swap, this surface becomes visible.
 */
function _loadBuffer(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const v = _buffer;
    if (!v) return reject(new Error('no buffer video'));

    v.onended = null;
    v.onerror = null;

    try { v.pause(); } catch {}
    v.src = url;
    v.load();

    const cleanup = () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onErr);
    };
    const onErr = () => {
      const e = v.error;
      cleanup();
      reject(new Error(`buffer load error code=${e?.code} msg=${e?.message}`));
    };
    const onMeta = () => {
      cleanup();
      if (_destroyed) return resolve();
      _bufferedDurMs = Math.round((v.duration || 0) * 1000);
      logger.info(`[HTML5] prepared (buffer): ${url.split('/').pop()} duration=${_bufferedDurMs}ms`);

      // Force decoder to render frame 0 onto buffer's overlay surface.
      // Buffer is hidden (z-index=0, opacity=0) so the user sees nothing.
      setTimeout(() => {
        v.play().then(() => {
          setTimeout(() => {
            try { v.pause(); } catch {}
            try { v.currentTime = 0; } catch {}
            _prebuffered = true;
            logger.info('[HTML5] buffer prebuffered at frame 0 -- LOOP_READY');
            resolve();
          }, 120);
        }).catch((e: any) => {
          logger.warn(`[HTML5] buffer play() rejected: ${e?.message ?? e} (continuing)`);
          _prebuffered = true;
          resolve();
        });
      }, 60);
    };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.addEventListener('error', onErr, { once: true });
  });
}

// ---------------------------------------------------------------------------
// EOS listener
// ---------------------------------------------------------------------------

function _attachEosListener(v: HTMLVideoElement): void {
  v.onended = () => {
    if (_destroyed) return;
    const pos = Math.round((v.currentTime || 0) * 1000);
    if (_durationMs > 0 && pos < _durationMs - 600) {
      logger.info(`[HTML5] spurious ended pos=${pos}ms dur=${_durationMs}ms -- ignored`);
      return;
    }
    logger.info(`[HTML5] EOS at ${pos}ms -- starting prebuffer`);
    _playing = false;
    _prebufferForBarrier();
  };
  v.onerror = (e) => {
    logger.error(`[HTML5] video error: ${JSON.stringify(e)}`);
  };
}

// ---------------------------------------------------------------------------
// Barrier prebuffer (loads NEXT clip into hidden buffer element)
// ---------------------------------------------------------------------------

function _prebufferForBarrier(): void {
  if (_destroyed || _looping) return;
  _looping     = true;
  _prebuffered = false;
  _stopDriftLog();

  if (_playlist.length > 1) {
    _playlistIdx = (_playlistIdx + 1) % _playlist.length;
    _url = _playlist[_playlistIdx];
    logger.info(`[HTML5] playlist -> [${_playlistIdx + 1}/${_playlist.length}] ${_url.split('/').pop()}`);
  }

  logger.info('[HTML5] prebuffer: load next clip into hidden buffer element');

  _loadBuffer(_url).then(() => {
    if (_destroyed) { _looping = false; return; }
    _looping = false;
    if (_onLoop) _onLoop();
  }).catch((err) => {
    _looping = false;
    logger.error(`[HTML5] prebuffer failed: ${err?.message ?? err}`);
  });
}

// ---------------------------------------------------------------------------
// Drift log
// ---------------------------------------------------------------------------

function _startDriftLog(): void {
  if (_driftTimer) return;
  _driftTimer = setInterval(() => {
    if (_destroyed || !_playing || !_active) return;
    const pos = Math.round((_active.currentTime || 0) * 1000);
    const st  = _active.paused ? 'PAUSED' : 'PLAYING';
    logger.info(`[HTML5] pos=${pos}ms duration=${_durationMs}ms state=${st}`);
  }, DRIFT_LOG_MS);
}

function _stopDriftLog(): void {
  if (_driftTimer) { clearInterval(_driftTimer); _driftTimer = null; }
}

// ---------------------------------------------------------------------------
// Scheduled play
// ---------------------------------------------------------------------------

export function schedulePlayAt(epochMs: number): void {
  if (_destroyed) return;
  clearTimeout(_playTimer);
  const wait = epochMs - Date.now();
  logger.info(`[HTML5] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
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
  _playTimer = null;
  if (_destroyed || _playing) return;
  _playing = true;

  // If we've prebuffered into the buffer element, swap A↔B so that buffer
  // becomes the visible/active one.
  if (_prebuffered && _buffer && _active) {
    const oldActive = _active;
    const newActive = _buffer;

    // Swap pointers
    _active = newActive;
    _buffer = oldActive;

    // Roll buffered duration into active duration
    _durationMs    = _bufferedDurMs;
    _bufferedDurMs = 0;

    // display:none suppresses the hardware overlay surface on Tizen 4.0.
    // Hide old BEFORE showing new so both surfaces are never on-screen together.
    oldActive.style.display = 'none';
    newActive.style.display = 'block';

    // Detach EOS from old, attach to new
    oldActive.onended = null;
    oldActive.onerror = null;
    _attachEosListener(newActive);

    logger.info('[HTML5] swap A<->B (buffer is now active)');

    // Clear old active's src shortly after so its surface is freed for the
    // next prebuffer cycle.  Wait a few frames so the new active's play()
    // call below has already started before we touch the old element.
    setTimeout(() => {
      try { oldActive.pause(); } catch {}
      try { oldActive.removeAttribute('src'); oldActive.load(); } catch {}
    }, 300);
  }

  if (!_active) { logger.error('[HTML5] _doPlay: no active video'); _playing = false; return; }

  // Reset position (the brief play+pause during prebuffer may have advanced ~120ms)
  try { _active.currentTime = 0; } catch {}
  _prebuffered = false;

  _active.play().then(() => {
    logger.info('[HTML5] play() -- synchronized start');
    _startDriftLog();
  }).catch((e: any) => {
    logger.error(`[HTML5] play() failed: ${e?.message ?? e}`);
    _playing = false;
  });
}

export function playFromPrebuffer(): void {
  if (_destroyed) return;
  if (!_prebuffered) logger.warn('[HTML5] playFromPrebuffer: not prebuffered');
  _doPlay();
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

export function getDuration(): number { return _durationMs; }

export function isPlaying(): boolean {
  return _playing && !!_active && !_active.paused;
}

export function getCurrentPosMs(): number | null {
  if (!_playing || !_active) return null;
  return Math.round((_active.currentTime || 0) * 1000);
}

export function getPlaylistUrls(): string[] { return _playlist.slice(); }

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export function destroyEngine(): void {
  _destroyed = true; _playing = false; _prebuffered = false; _looping = false;
  clearTimeout(_playTimer); _stopDriftLog();
  [ _videoA, _videoB ].forEach((v) => {
    if (!v) return;
    try { v.pause(); } catch {}
    v.onended = null;
    v.onerror = null;
    try { v.removeAttribute('src'); v.load(); } catch {}
    if (v.parentNode) v.parentNode.removeChild(v);
  });
  _videoA = null; _videoB = null; _active = null; _buffer = null;
  logger.info('[HTML5] engine destroyed');
}
