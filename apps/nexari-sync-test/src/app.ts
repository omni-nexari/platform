/**
 * app.ts
 * Entry point for the Nexari Sync Test app.
 *
 * Boot sequence:
 *   1. Detect device IP from tizen.systeminfo (or fallback to window.location.hostname)
 *   2. syncTime() — 8-sample NTP against Pi
 *   3. P2PSync.init() — register + start peer discovery
 *   4. Fetch first video URL from Pi /api/v1/content?type=video&limit=1
 *   5. Activate MSE player (default engine) and load the video
 *   6. P2P handles SYNC_PLAY when both peers are READY
 *
 * Remote keys:
 *   CH+ (MediaChannelUp / key code 427) → broadcastSetEngine() toggle MSE↔WASM
 *   RETURN / BACK → exit app
 */

// All modules are loaded as globals via <script> tags (module:none TypeScript build)
// TypeScript sees them via import for type checking; runtime uses the global names.
import { syncTime, getNtpOffset } from './ntp-client.js';
import * as P2PSync from './p2p-sync-client.js';
import { initMsePlayer, loadVideo as msLoad, teardown as msTeardown } from './player-mse.js';
import { initWasmPlayer, loadVideo as wasmLoad, teardown as wasmTeardown } from './player-wasm.js';
import { initHud, updateHud } from './perf-hud.js';
import { initLogger, setLoggerEngine, logger } from './logger.js';
import type { EngineMode } from './sync-protocol.js';

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  PI_BASE:  'http://192.168.1.17',
  GROUP_ID: 'synctest-001',
};

// ── State ─────────────────────────────────────────────────────────────────────
let _currentEngine: EngineMode = 'mse';
let _videoUrl = '';
let _container: HTMLElement;
let _statusEl: HTMLElement | null;
let _bannerEl: HTMLElement | null;

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  _container  = document.getElementById('video-container')!;
  _statusEl   = document.getElementById('status-msg');
  _bannerEl   = document.getElementById('engine-banner');

  initHud();
  _setStatus('Detecting device…');

  const selfIp  = await _getSelfIp();
  const deviceId = selfIp.replace(/\./g, '-');

  initLogger(CONFIG.PI_BASE, deviceId);
  logger.info(`[App] boot: ip=${selfIp} deviceId=${deviceId}`);

  _setStatus('Syncing time…');
  await syncTime(CONFIG.PI_BASE).catch(() => logger.warn('[App] NTP sync failed — using local clock'));
  logger.info(`[App] NTP offset: ${getNtpOffset()}ms`);

  updateHud({ ntpOffsetMs: getNtpOffset() });

  _setStatus('Connecting to peer…');
  P2PSync.init({
    piBase:   CONFIG.PI_BASE,
    deviceId,
    selfIp,
    groupId:  CONFIG.GROUP_ID,
    logger: (level, msg) => {
      updateHud({ connectionState: level === 'error' ? 'error' : (P2PSync.getRole() === 'pending' ? 'connecting' : 'connected') });
      logger[level](msg);
    },
  });

  P2PSync.onVideoUrl((msg) => {
    _videoUrl = msg.url;
    logger.info(`[App] VIDEO_URL from leader: ${_videoUrl}`);
    _activateEngine(_currentEngine, _videoUrl);
  });

  P2PSync.onSetEngine((msg) => {
    logger.info(`[App] SET_ENGINE: ${msg.engineMode}`);
    _switchEngine(msg.engineMode);
  });

  // Register remote key handler
  try { (window as any).tizen?.tvinputdevice?.registerKey('ChannelUp'); } catch {}
  document.addEventListener('keydown', _onKey);

  _setStatus('Fetching video…');
  _videoUrl = await _fetchVideoUrl();
  logger.info(`[App] video URL: ${_videoUrl}`);

  // Wait briefly for P2P role to be determined (peer poll up to ~4s)
  await _waitForRole(8000);

  updateHud({ role: P2PSync.getRole(), engineMode: _currentEngine });
  _setBanner(_currentEngine);

  if (P2PSync.getRole() === 'leader') {
    logger.info('[App] leader: sending VIDEO_URL to follower');
    // Leader pushes VIDEO_URL to follower via DataChannel (handled in p2p-sync-client internally)
    // For now, leader also activates its own player directly
    _activateEngine(_currentEngine, _videoUrl);
  } else {
    _setStatus('Follower — waiting for VIDEO_URL…');
    // Follower activates engine when VIDEO_URL arrives (onVideoUrl above)
    // Fallback: if we already have a URL and no DC yet, start directly after 5s
    setTimeout(() => {
      if (_videoUrl && !_container.querySelector('video, canvas')) {
        logger.warn('[App] follower fallback: starting engine without leader sync');
        _activateEngine(_currentEngine, _videoUrl);
      }
    }, 5000);
  }
});

// ── Engine management ─────────────────────────────────────────────────────────

function _activateEngine(engine: EngineMode, url: string): void {
  _hideStatus();
  if (engine === 'mse') {
    initMsePlayer(_container);
    msLoad(url).catch((e: any) => logger.error(`[App] MSE load failed: ${e?.message}`));
  } else {
    initWasmPlayer(_container);
    wasmLoad(url).catch((e: any) => logger.error(`[App] WASM load failed: ${e?.message}`));
  }
  setLoggerEngine(engine);
  updateHud({ engineMode: engine });
  _setBanner(engine);
}

function _switchEngine(newEngine: EngineMode): void {
  if (newEngine === _currentEngine) return;
  logger.info(`[App] switching engine: ${_currentEngine} → ${newEngine}`);
  _currentEngine = newEngine;

  // Teardown both (only one is active but tear both for safety)
  msTeardown();
  wasmTeardown();

  _activateEngine(newEngine, _videoUrl);
}

// ── Remote key handler ────────────────────────────────────────────────────────

function _onKey(e: KeyboardEvent): void {
  // CH+ key codes: 427 (Tizen), 33 (PageUp) for dev browser
  const CH_PLUS = [427, 33];
  if (CH_PLUS.includes(e.keyCode)) {
    if (P2PSync.getRole() === 'leader') {
      const next: EngineMode = _currentEngine === 'mse' ? 'wasm' : 'mse';
      logger.info(`[App] CH+ key → broadcastSetEngine(${next})`);
      P2PSync.broadcastSetEngine(next);
      _currentEngine = next;
    } else {
      logger.info('[App] CH+ key ignored — follower cannot initiate engine switch');
    }
  }
  if (e.keyCode === 10009 || e.keyCode === 8) { // RETURN / BACK
    try { (window as any).tizen?.application?.getCurrentApplication()?.exit(); } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _getSelfIp(): Promise<string> {
  try {
    const sysinfo = (window as any).tizen?.systeminfo;
    if (sysinfo) {
      return await new Promise<string>((resolve, reject) => {
        sysinfo.getPropertyValue('NETWORK', (net: any) => {
          resolve(net?.ipAddress ?? '0.0.0.0');
        }, reject);
      });
    }
  } catch {}
  // Fallback for dev browser
  return window.location.hostname || '127.0.0.1';
}

async function _fetchVideoUrl(): Promise<string> {
  try {
    const res  = await fetch(`${CONFIG.PI_BASE}/api/v1/content?type=video&limit=1`);
    const data = await res.json();
    const item = data?.items?.[0] ?? data?.[0];
    if (item?.url) return item.url as string;
    if (item?.filePath) return `${CONFIG.PI_BASE}/uploads/${item.filePath}` as string;
  } catch (e: any) {
    logger.error(`[App] fetchVideoUrl failed: ${e?.message}`);
  }
  return '';
}

async function _waitForRole(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (P2PSync.getRole() === 'pending' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

function _setStatus(msg: string): void {
  if (_statusEl) { _statusEl.textContent = msg; _statusEl.style.display = ''; }
}

function _hideStatus(): void {
  if (_statusEl) _statusEl.style.display = 'none';
}

function _setBanner(engine: EngineMode): void {
  if (_bannerEl) _bannerEl.textContent = engine.toUpperCase();
}
