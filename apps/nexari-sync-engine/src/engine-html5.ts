/**
 * engine-html5.ts — HTML5 <video> engine for Nexari Sync Engine
 *
 * Same external contract as engine.ts:
 *   initHtml5Engine(container) → prepareHtml5(url) → scheduleHtml5PlayAt(epochMs)
 *
 * Loop: 'ended' event → seekTo expectedMs → play()
 * Play scheduling: coarse setTimeout → 4ms spin-wait → play() at exact epoch.
 */
import { logger } from './logger.js';

let _video:         HTMLVideoElement | null = null;
let _destroyed      = false;
let _playing        = false;
let _durationMs     = 0;
let _playAtEpoch    = -1;
let _playStartEpoch = -1;
let _playTimer: any = null;
let _lastDriftLog   = 0;

// ── Init ───────────────────────────────────────────────────────────────────────

export function initHtml5Engine(container: HTMLElement): void {
  _destroyed = false; _playing = false; _durationMs = 0;
  _playAtEpoch = -1; _playStartEpoch = -1;

  _video = document.createElement('video');
  _video.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;object-fit:fill;background:#000;';
  _video.setAttribute('playsinline', '');
  _video.setAttribute('webkit-playsinline', '');
  container.appendChild(_video);

  _video.addEventListener('ended', () => {
    if (_destroyed || !_playing) return;
    logger.info('[HTML5] ended → loop');
    _handleLoop();
  });

  _video.addEventListener('error', () => {
    logger.error(`[HTML5] video error: ${_video?.error?.message ?? 'unknown'} (code ${_video?.error?.code})`);
  });

  _video.addEventListener('timeupdate', () => {
    if (_destroyed || !_playing || _playStartEpoch < 0 || _durationMs <= 0) return;
    const now = Date.now();
    if (now - _lastDriftLog < 2000) return;
    _lastDriftLog = now;
    const posMs  = Math.round((_video!.currentTime ?? 0) * 1000);
    const exp    = _expectedMs();
    const drift  = posMs - exp;
    logger.drift(`[HTML5] pos=${posMs}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms`, drift);
  });

  logger.info('[HTML5] <video> engine initialised');
}

// ── Prepare ────────────────────────────────────────────────────────────────────

export function prepareHtml5(url: string): Promise<void> {
  if (!_video || _destroyed) return Promise.reject(new Error('[HTML5] engine not initialised'));
  _playing = false; _durationMs = 0;

  return new Promise<void>((resolve, reject) => {
    const v = _video!;
    const cleanup = () => {
      v.removeEventListener('canplaythrough', onReady);
      v.removeEventListener('error',          onErr);
    };
    const onReady = () => {
      cleanup();
      _durationMs = Math.round((v.duration ?? 0) * 1000);
      logger.info(`[HTML5] canplaythrough — duration=${_durationMs}ms`);
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`[HTML5] load error: ${v.error?.message ?? 'unknown'}`));
    };

    v.addEventListener('canplaythrough', onReady);
    v.addEventListener('error',          onErr);

    v.src     = url;
    v.preload = 'auto';
    v.load();
    logger.info(`[HTML5] loading: ${url}`);
  });
}

// ── Scheduled play ─────────────────────────────────────────────────────────────

export function scheduleHtml5PlayAt(epochMs: number): void {
  if (_destroyed) return;
  _playAtEpoch = epochMs;
  clearTimeout(_playTimer);

  const wait = epochMs - Date.now();
  logger.info(`[HTML5] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);

  if (wait <= 0) { _doPlay(); return; }

  _playTimer = setTimeout(() => {
    (function spin() {
      if (_destroyed) return;
      if (Date.now() >= _playAtEpoch) { _doPlay(); return; }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, wait - 60));
}

function _doPlay(): void {
  if (_destroyed || _playing || !_video) return;
  _video.play()
    .then(() => {
      _playing        = true;
      _playStartEpoch = _playAtEpoch > 0 ? _playAtEpoch : Date.now();
      logger.info(`[HTML5] play() — startEpoch=${_playStartEpoch}`);
    })
    .catch((e: any) => logger.error(`[HTML5] play() failed: ${e?.message}`));
}

// ── Loop ───────────────────────────────────────────────────────────────────────

function _handleLoop(): void {
  if (!_video || _destroyed) return;
  const targetMs = _playStartEpoch > 0 && _durationMs > 0
    ? Math.round(((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs)
    : 0;
  logger.info(`[HTML5] loop → seekTo ${targetMs}ms`);
  _video.currentTime = targetMs / 1000;
  _video.play().catch((e: any) => logger.warn(`[HTML5] loop play() failed: ${e?.message}`));
}

// ── Public accessors ───────────────────────────────────────────────────────────

export function getHtml5Duration(): number  { return _durationMs; }
export function isHtml5Playing():   boolean { return _playing; }

// ── Teardown ───────────────────────────────────────────────────────────────────

export function destroyHtml5Engine(): void {
  _destroyed = true; _playing = false;
  clearTimeout(_playTimer);
  if (_video) {
    try { _video.pause(); } catch {}
    _video.src = '';
    try { _video.load(); } catch {}
    if (_video.parentNode) _video.parentNode.removeChild(_video);
    _video = null;
  }
  logger.info('[HTML5] engine destroyed');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _expectedMs(): number {
  if (_playStartEpoch < 0 || _durationMs <= 0) return 0;
  return ((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs;
}
