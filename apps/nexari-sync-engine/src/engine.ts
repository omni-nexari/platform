/**
 * engine.ts — AVPlay engine for Nexari Sync Engine
 *
 * AVPlay state machine: NONE → open() → IDLE → prepareAsync() → READY → play() → PLAYING
 *
 * Loop: onstreamcompleted → stop() + prepareAsync() + seekTo(expectedMs) + play()
 *   - MUST defer onstreamcompleted via setTimeout(0) — calling stop() synchronously
 *     inside the callback freezes the Tizen 4 display compositor.
 *   - After stop(), re-apply setDisplayRect + setDisplayMethod before play().
 *
 * Play scheduling: coarse setTimeout → 4ms spin-wait → play() at exact epoch.
 *   Uses Date.now() which is NTP-synced at OS level on Samsung TVs.
 */
import { logger } from './logger.js';

interface AV {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, err: (e: any) => void): void;
  setBufferingParam?(opt: string, unit: string, amount?: number): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod(mode: string): void;
  setDisplayRotation?(rotation: string): void;
  setStreamingProperty?(name: string, value: string): void;
  setListener(cb: object): void;
  play(): void;
  stop(): void;
  pause(): void;
  seekTo(ms: number, ok: () => void, err: (e: any) => void): void;
  getDuration(): number;
  getCurrentTime(): number;
  getState(): string;
  setVideoStillMode?(value: string): void; // 'true' freezes last frame; 'false' resumes drawing
}

type Slot = {
  av:        AV;
  obj:       HTMLObjectElement;
  ready:     boolean;
  preparing: boolean;
};

let _slots: Slot[] = [];     // [active, inactive] when avplaystore present; [solo] for single-slot fallback
let _activeIdx       = 0;    // index of currently-displaying slot in _slots

let _url             = '';   // resolved absolute URI (shared by both slots for looping)
let _destroyed       = false;
let _playing         = false;
let _durationMs      = 0;
let _swapFlight      = false; // a loop boundary swap (or single-slot reset) is in flight
let _playAtEpoch     = -1;
let _playStartEpoch  = -1;
let _playTimer: any  = null;
let _lastDriftLog    = 0;
let _pollTimer: any  = null;
let _firstPlaytimeLogged = false;

function _activeSlot(): Slot | null { return _slots[_activeIdx] ?? null; }
function _otherSlot():  Slot | null { return _slots.length > 1 ? _slots[1 - _activeIdx] : null; }
function _av():         AV | null   { return _activeSlot()?.av ?? null; }

function _logDrift(ms: number): void {
  if (_destroyed || !_playing || _playStartEpoch < 0 || _durationMs <= 0) return;
  const now = Date.now();
  if (now - _lastDriftLog < 2000) return;
  _lastDriftLog = now;
  const exp   = _expectedMs();
  const drift = ms - exp;
  logger.drift(`[AVPlay] pos=${ms}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms`, drift);
}

// ── Init ───────────────────────────────────────────────────────────────────────

// Apply display rotation + rect + mode based on screen orientation.
// Portrait: rotate 90° then use 1920×1080 landscape coords (rotation changes coordinate origin).
// Landscape: no rotation, letterbox to preserve content aspect ratio.
function _applyDisplay(a: AV): void {
  const portrait = window.screen.width < window.screen.height;
  if (portrait && typeof a.setDisplayRotation === 'function') {
    try { a.setDisplayRotation('PLAYER_DISPLAY_ROTATION_90'); logger.info('[AVPlay] setDisplayRotation(ROTATION_90) OK'); }
    catch (e: any) { logger.warn(`[AVPlay] setDisplayRotation failed: ${e?.message}`); }
  }
  try { a.setDisplayRect(0, 0, 1920, 1080); logger.info('[AVPlay] setDisplayRect(0,0,1920,1080) OK'); }
  catch (e: any) { logger.error(`[AVPlay] setDisplayRect failed: ${e?.message}`); }
  // Portrait after rotation fills full rotated canvas; landscape letterboxes to preserve content ratio
  const mode = portrait ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
  try { a.setDisplayMethod(mode); logger.info(`[AVPlay] setDisplayMethod(${mode}) OK`); }
  catch (e: any) { logger.error(`[AVPlay] setDisplayMethod failed: ${e?.message}`); }
}

export function initEngine(container: HTMLElement): void {
  _destroyed = false; _playing = false; _durationMs = 0;
  _swapFlight = false; _playAtEpoch = -1; _playStartEpoch = -1;
  _firstPlaytimeLogged = false;
  _url = '';
  _slots = [];
  _activeIdx = 0;

  // Remove any leftover AVPlay objects from a previous engine init
  Array.from(container.querySelectorAll('object[type="application/avplayer"]')).forEach(o => o.parentNode?.removeChild(o));

  const w: any = window;
  const store  = w.webapis?.avplaystore;
  const avplay = w.webapis?.avplay;
  // Two slots when AVPlayStore is available (enables seamless still-mode swap);
  // single slot fallback uses the legacy webapis.avplay (no seamless — black gap on loop).
  const slotCount = store ? 2 : (avplay ? 1 : 0);
  if (slotCount === 0) { logger.warn('[AVPlay] webapis.avplay/avplaystore not available'); return; }

  for (let i = 0; i < slotCount; i++) {
    const obj = document.createElement('object') as HTMLObjectElement;
    obj.type = 'application/avplayer';
    obj.setAttribute('width',  '1920');
    obj.setAttribute('height', '1080');
    obj.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;';
    container.appendChild(obj);
    const av: AV = store ? (store.getPlayer() as AV) : (avplay as AV);
    _slots.push({ av, obj, ready: false, preparing: false });
  }
  logger.info(`[AVPlay] engine init slots=${slotCount} screen=${window.screen.width}x${window.screen.height} portrait=${window.screen.width < window.screen.height} seamless=${slotCount === 2}`);
}

// ── Prepare ────────────────────────────────────────────────────────────────────

export function prepare(url: string): Promise<void> {
  if (_destroyed || _slots.length === 0) return Promise.reject(new Error('[AVPlay] not available'));
  _playing = false; _durationMs = 0; _swapFlight = false;
  return _resolveUri(url).then((abs) => {
    _url = abs;
    // IMPORTANT: open ONLY slot0 here. AVPlayStore serializes open() across players —
    // opening slot1 concurrently will silently abort slot0's prepareAsync. Slot1 is opened
    // on demand inside _handleLoop at the loop boundary (matches Samsung still-mode sample).
    return _openSlot(_slots[0], abs, 0);
  });
}

function _openSlot(slot: Slot, absUri: string, idx: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (_destroyed) { reject(new Error('destroyed')); return; }
    const a = slot.av;
    try {
      logger.info(`[AVPlay] slot${idx} open → ${absUri}`);
      a.open(absUri);
      try { logger.info(`[AVPlay] slot${idx} state after open: ${a.getState()}`); } catch {}

      // Skip setBufferingParam on local file:// URIs — silently stalls Tizen 7's decode pipeline
      const isLocalFile = /^file:\/\//i.test(absUri);
      if (!isLocalFile && typeof a.setBufferingParam === 'function') {
        try { a.setBufferingParam('PLAYER_BUFFER_FOR_PLAY',   'PLAYER_BUFFER_SIZE_IN_SECOND', 0); } catch {}
        try { a.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 0); } catch {}
      }

      _applyDisplay(a);
      a.setListener(_makeListener(slot, idx));
      slot.preparing = true;

      a.prepareAsync(
        () => {
          if (_destroyed) { reject(new Error('destroyed during prepare')); return; }
          _applyDisplay(a);
          slot.ready = true;
          slot.preparing = false;
          if (idx === 0) _durationMs = a.getDuration();
          // Hold non-active slots frozen so they don't blank the display before the swap.
          if (idx !== _activeIdx && typeof a.setVideoStillMode === 'function') {
            try { a.setVideoStillMode('true'); logger.info(`[AVPlay] slot${idx} setVideoStillMode(true) — held ready`); }
            catch (e: any) { logger.warn(`[AVPlay] slot${idx} setVideoStillMode failed: ${e?.message}`); }
          }
          logger.info(`[AVPlay] slot${idx} READY — duration=${_durationMs}ms state=${a.getState()}`);
          resolve();
        },
        (e: any) => {
          slot.preparing = false;
          logger.error(`[AVPlay] slot${idx} prepareAsync failed: ${e?.message ?? e}`);
          reject(new Error(e?.message ?? String(e)));
        },
      );
    } catch (e: any) {
      logger.error(`[AVPlay] slot${idx} open failed: ${e?.message ?? e}`);
      reject(e);
    }
  });
}

function _makeListener(slot: Slot, idx: number): object {
  return {
    onbufferingstart:    () => logger.info(`[AVPlay] slot${idx} buffering start`),
    onbufferingcomplete: () => logger.info(`[AVPlay] slot${idx} buffering complete`),
    onstreamcompleted: () => {
      // Only act when the active slot ends; inactive slots are held in still-mode
      if (slot !== _activeSlot()) {
        logger.info(`[AVPlay] slot${idx} stream completed (inactive — ignored)`);
        return;
      }
      logger.info(`[AVPlay] slot${idx} stream completed → swap scheduled`);
      if (!_destroyed) setTimeout(() => { if (!_destroyed) _handleLoop(); }, 0);
    },
    oncurrentplaytime: (ms: number) => {
      if (slot !== _activeSlot()) return;
      if (!_firstPlaytimeLogged) {
        _firstPlaytimeLogged = true;
        logger.info(`[AVPlay] slot${idx} oncurrentplaytime first call: ms=${ms}`);
      }
      if (ms === 0) return;
      _logDrift(ms);
    },
    onerror:     (t: string)            => logger.error(`[AVPlay] slot${idx} error type=${t}`),
    onerrormsg:  (t: string, m: string) => logger.error(`[AVPlay] slot${idx} errormsg type=${t} msg=${m}`),
    onevent:     (t: string, d: string) => logger.info(`[AVPlay] slot${idx} event type=${t} data=${d}`),
    onstreaminfo: (w: number, h: number, bw: number, bh: number) => logger.info(`[AVPlay] slot${idx} streaminfo ${w}x${h} base=${bw}x${bh}`),
    ondrmevent:  (t: string, d: string) => logger.info(`[AVPlay] slot${idx} drmevent type=${t} data=${d}`),
    onresolutionchanged: (w: number, h: number) => logger.info(`[AVPlay] slot${idx} resolution changed ${w}x${h}`),
    onbufferlevelchanged: (pct: number) => logger.info(`[AVPlay] slot${idx} buffer level ${pct}%`),
    onopenstatecompleted: () => logger.info(`[AVPlay] slot${idx} openstate completed`),
    onresourceconflicted: ()            => logger.warn(`[AVPlay] slot${idx} resource conflict`),
  };
}

// ── Scheduled play ─────────────────────────────────────────────────────────────

export function schedulePlayAt(epochMs: number): void {
  if (_destroyed) return;
  _playAtEpoch = epochMs;
  clearTimeout(_playTimer);
  const slot = _activeSlot(); if (!slot) return;

  const wait = epochMs - Date.now();
  logger.info(`[AVPlay] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms slot=${_activeIdx}`);

  if (wait <= 0) { _doPlay(slot); return; }

  // Coarse sleep then tight spin-wait
  _playTimer = setTimeout(() => {
    (function spin() {
      if (_destroyed) return;
      if (Date.now() >= _playAtEpoch) { _doPlay(slot); return; }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, wait - 60));
}

function _doPlay(slot: Slot): void {
  if (_destroyed || _playing) return;
  const a = slot.av;
  try {
    _applyDisplay(a);
    // Active slot must NOT be in still-mode at play time, else video freezes on first frame
    if (typeof a.setVideoStillMode === 'function') {
      try { a.setVideoStillMode('false'); } catch {}
    }
    try { logger.info(`[AVPlay] slot${_activeIdx} state before play: ${a.getState()}`); } catch {}
    a.play();
    _playing        = true;
    _playStartEpoch = _playAtEpoch > 0 ? _playAtEpoch : Date.now();
    logger.info(`[AVPlay] slot${_activeIdx} play() OK startEpoch=${_playStartEpoch}`);
    setTimeout(() => {
      if (_destroyed || !_playing) return;
      try {
        const st = a.getState(); const ms = a.getCurrentTime ? a.getCurrentTime() : -1;
        if (st === 'PLAYING' && ms === 0) logger.warn(`[AVPlay] STALL DETECTED — state=${st} pos=${ms}ms after 4s`);
        else logger.info(`[AVPlay] watchdog OK — state=${st} pos=${ms}ms`);
      } catch {}
    }, 4000);
    _startPoll();
  } catch (e: any) {
    logger.error(`[AVPlay] play() failed: ${e?.message}`);
  }
}

function _startPoll(): void {
  clearInterval(_pollTimer);
  _pollTimer = setInterval(() => {
    if (_destroyed || !_playing) { clearInterval(_pollTimer); return; }
    const a = _av(); if (!a) return;
    try {
      const ms = a.getCurrentTime ? a.getCurrentTime() : -1;
      const st = a.getState ? a.getState() : '?';
      logger.info(`[AVPlay] poll slot${_activeIdx} state=${st} pos=${ms}ms`);
      if (ms > 0) _logDrift(ms);
    } catch (e: any) { logger.warn(`[AVPlay] poll err: ${e?.message}`); }
  }, 5000);
}

// ── Seamless still-mode loop ────────────────────────────────────────────────────────
//
// At end-of-stream on the active slot:
//   1. activate other slot:   other.setVideoStillMode('false')  + (optional seekTo)  + other.play()
//   2. deactivate from slot:  from.setVideoStillMode('true')   freezes last frame  + from.stop()
//   3. re-prepare from slot:  from.prepareAsync()  (silent, held in stillMode for next swap)
//
// The video output never blanks: outgoing slot freezes its last frame at the same instant the
// incoming slot starts pushing decoded frames into the hardware overlay.

function _handleLoop(): void {
  if (_swapFlight || _destroyed) return;
  const fromSlot = _activeSlot(); if (!fromSlot) return;
  const toSlot   = _otherSlot();

  if (!toSlot) { _fullResetLoop(fromSlot); return; }

  _swapFlight = true;
  _playing    = false;
  clearInterval(_pollTimer);

  const fromAv  = fromSlot.av;
  const toAv    = toSlot.av;
  const fromIdx = _activeIdx;
  const toIdx   = 1 - _activeIdx;

  logger.info(`[AVPlay] swap slot${fromIdx}→slot${toIdx} starting`);

  // 1. Freeze fromSlot's last frame on the hardware overlay
  if (typeof fromAv.setVideoStillMode === 'function') {
    try { fromAv.setVideoStillMode('true'); logger.info(`[AVPlay] slot${fromIdx} setVideoStillMode(true) — frame frozen`); }
    catch (e: any) { logger.warn(`[AVPlay] slot${fromIdx} stillMode(true) err: ${e?.message}`); }
  }
  try { fromAv.stop(); logger.info(`[AVPlay] slot${fromIdx} stopped`); } catch (e: any) { logger.warn(`[AVPlay] slot${fromIdx} stop err: ${e?.message}`); }
  // Close fully so AVPlayStore frees its slot for the incoming open.
  try { fromAv.close(); fromSlot.ready = false; logger.info(`[AVPlay] slot${fromIdx} closed`); } catch (e: any) { logger.warn(`[AVPlay] slot${fromIdx} close err: ${e?.message}`); }

  // 2. Open + prepare toSlot. Frozen frame on outgoing keeps display painted during prepare.
  try {
    logger.info(`[AVPlay] slot${toIdx} open → ${_url}`);
    toAv.open(_url);
  } catch (e: any) { logger.error(`[AVPlay] slot${toIdx} open failed: ${e?.message}`); _swapFlight = false; return; }
  _applyDisplay(toAv);
  toAv.setListener(_makeListener(toSlot, toIdx));
  // Hold incoming in still mode while it prepares (so the moment we flip it false, frames flow).
  if (typeof toAv.setVideoStillMode === 'function') {
    try { toAv.setVideoStillMode('true'); } catch {}
  }

  toSlot.preparing = true;
  toAv.prepareAsync(
    () => {
      if (_destroyed) return;
      toSlot.preparing = false;
      toSlot.ready    = true;
      _applyDisplay(toAv);

      // Recompute target NOW (after the 200-700ms prepare latency) so we land at correct phase.
      const targetMs = _playStartEpoch > 0 && _durationMs > 0
        ? Math.round(((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs)
        : 0;
      // Wrap-around guard: if we're in the last 500ms or first 100ms, just play from start —
      // seeking that close to a boundary is unreliable and produces large drift glitches.
      const useSeek = targetMs > 100 && targetMs < _durationMs - 500;
      logger.info(`[AVPlay] slot${toIdx} prepared — target=${targetMs}ms useSeek=${useSeek}`);

      const finalize = () => {
        if (typeof toAv.setVideoStillMode === 'function') {
          try { toAv.setVideoStillMode('false'); } catch {}
        }
        try { toAv.play(); } catch (e: any) { logger.error(`[AVPlay] slot${toIdx} play() failed: ${e?.message}`); }
        _activeIdx  = toIdx;
        _playing    = true;
        _swapFlight = false;
        logger.info(`[AVPlay] swap complete — playing slot${_activeIdx}`);
        _startPoll();
      };

      if (useSeek) {
        try {
          toAv.seekTo(targetMs, finalize, (e: any) => { logger.warn(`[AVPlay] slot${toIdx} seekTo failed: ${e?.message} — playing from 0`); finalize(); });
        } catch (e: any) { logger.warn(`[AVPlay] slot${toIdx} seekTo threw: ${e?.message}`); finalize(); }
      } else {
        finalize();
      }
    },
    (e: any) => {
      toSlot.preparing = false;
      _swapFlight      = false;
      logger.error(`[AVPlay] slot${toIdx} swap prepareAsync failed: ${e?.message ?? e} — falling back to full reset on slot${fromIdx}`);
      // Try to recover by reopening fromSlot from scratch
      try { fromAv.open(_url); } catch {}
      _applyDisplay(fromAv);
      fromAv.setListener(_makeListener(fromSlot, fromIdx));
      _fullResetLoop(fromSlot);
    },
  );
}

// Single-slot fallback (no AVPlayStore): full pipeline reset on the same player.
// Will produce a brief black gap on Tizen builds without webapis.avplaystore.
function _fullResetLoop(slot: Slot): void {
  _swapFlight = true;
  _playing    = false;
  clearInterval(_pollTimer);
  const a = slot.av;
  let done = false;

  const guard = setTimeout(() => {
    if (done) return; done = true; _swapFlight = false;
    logger.warn('[AVPlay] full-reset loop timeout — forcing play()');
    try { a.play(); } catch {}
    _playing = true; _startPoll();
  }, 6000);

  try { a.stop(); } catch {}
  a.prepareAsync(
    () => {
      if (done || _destroyed) return;
      const targetMs = _playStartEpoch > 0 && _durationMs > 0
        ? Math.round(((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs)
        : 0;
      logger.info(`[AVPlay] full-reset loop ready, seekTo=${targetMs}ms`);
      _applyDisplay(a);
      const finishPlay = () => {
        if (done) return; done = true; clearTimeout(guard); _swapFlight = false;
        try { a.play(); } catch {}
        _playing = true; _startPoll();
      };
      if (targetMs > 100 && targetMs < _durationMs - 200) {
        a.seekTo(targetMs, finishPlay, (e: any) => { logger.warn(`[AVPlay] reset seekTo failed: ${e?.message}`); finishPlay(); });
      } else {
        finishPlay();
      }
    },
    (e: any) => {
      if (done) return; done = true; clearTimeout(guard); _swapFlight = false;
      logger.error(`[AVPlay] full-reset prepareAsync failed: ${e?.message ?? e}`);
    },
  );
}

// ── Public accessors ───────────────────────────────────────────────────────────

export function getDuration(): number  { return _durationMs; }
export function isPlaying():   boolean { return _playing; }

/**
 * Current playhead position in milliseconds, or null if not stably playing.
 * Returns the AVPlay reported pos (post-decoder), so reflects what's actually on the panel.
 */
export function getCurrentPosMs(): number | null {
  if (!_playing) return null;
  const a = _av(); if (!a || !a.getCurrentTime) return null;
  try {
    const ms = a.getCurrentTime();
    if (ms <= 0) return null;
    return ms;
  } catch { return null; }
}

/**
 * Shift the play-start epoch by deltaMs.
 *   delta > 0 → the device's next loop swap fires deltaMs LATER (use when local video is running ahead)
 *   delta < 0 → the device's next loop swap fires |delta|ms EARLIER (use when running behind)
 * Affects the targetMs computed inside _handleLoop on the next swap, giving a phase
 * correction without interrupting the currently-playing cycle.
 */
export function nudgePhase(deltaMs: number): void {
  if (!_playing || _playStartEpoch < 0) return;
  _playStartEpoch += deltaMs;
  logger.info(`[AVPlay] phase nudge ${deltaMs >= 0 ? '+' : ''}${deltaMs}ms → playStartEpoch=${_playStartEpoch}`);
}

/** Internal play-start epoch (local clock); negative if not yet playing. */
export function getPlayStartEpoch(): number { return _playStartEpoch; }

// ── Teardown ───────────────────────────────────────────────────────────────────

export function destroyEngine(): void {
  _destroyed = true; _playing = false;
  clearTimeout(_playTimer);
  clearInterval(_pollTimer);
  for (const slot of _slots) {
    try {
      const s = slot.av.getState();
      if (s === 'PLAYING' || s === 'PAUSED' || s === 'READY') slot.av.stop();
      slot.av.close();
    } catch {}
    if (slot.obj?.parentNode) slot.obj.parentNode.removeChild(slot.obj);
  }
  _slots = [];
  logger.info('[AVPlay] engine destroyed');
}

// ── URI resolution ─────────────────────────────────────────────────────────────

function _resolveUri(url: string): Promise<string> {
  if (/^(https?|file):\/\//i.test(url)) return Promise.resolve(url);
  const rel = url.replace(/^\.\//, '');

  // Tizen 5+ — synchronous toURI
  try {
    const base: string = (window as any).tizen?.filesystem?.toURI('wgt-package');
    if (base && base.length > 5) {
      const abs = (base.endsWith('/') ? base : base + '/') + rel;
      logger.info(`[AVPlay] uri (toURI): ${abs}`);
      return Promise.resolve(abs);
    }
  } catch {}

  // Tizen 4 — async resolve callback
  const tizen = (window as any).tizen;
  if (tizen?.filesystem?.resolve) {
    return new Promise<string>((res) => {
      try {
        tizen.filesystem.resolve(
          'wgt-package',
          (dir: any) => {
            const base: string = dir.toURI ? dir.toURI() : String(dir);
            const abs = (base.endsWith('/') ? base : base + '/') + rel;
            logger.info(`[AVPlay] uri (resolve): ${abs}`);
            res(abs);
          },
          () => res(_scriptBase(rel)),
          'r',
        );
      } catch { res(_scriptBase(rel)); }
    });
  }

  return Promise.resolve(_scriptBase(rel));
}

function _scriptBase(rel: string): string {
  for (const s of Array.from(document.scripts) as HTMLScriptElement[]) {
    if (s.src?.startsWith('file:///') && s.src.includes('bundle.js'))
      return s.src.replace(/js\/bundle\.js.*$/, '') + rel;
  }
  logger.warn(`[AVPlay] could not resolve absolute URI for: ${rel}`);
  return rel;
}

function _expectedMs(): number {
  if (_playStartEpoch < 0 || _durationMs <= 0) return 0;
  return ((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs;
}
