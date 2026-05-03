/**
 * app.ts
 * Entry point for the Nexari Sync Test app.
 *
 * Boot sequence:
 *   1. Detect device IP from tizen.systeminfo (or fallback to window.location.hostname)
 *   2. Initialize a local monotonic clock from Tizen Time API/Date
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
import { getClockSource, getNtpOffset, initializeDeviceClock } from './ntp-client.js';
import * as P2PSync from './p2p-sync-client.js';
import { initMsePlayer, loadVideo as msLoad, teardown as msTeardown } from './player-mse.js';
import { initWasmPlayer, loadVideo as wasmLoad, teardown as wasmTeardown } from './player-wasm.js';
import { initAvplayPlayer, loadVideo as avLoad, teardown as avTeardown } from './player-avplay.js';
import { initHud, updateHud } from './perf-hud.js';
import { initLogger, setLoggerEngine, logger } from './logger.js';
import type { EngineMode } from './sync-protocol.js';

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  PI_BASE:  'http://192.168.1.17',
  GROUP_ID: 'synctest-001',
};

// ── State ─────────────────────────────────────────────────────────────────────
let _currentEngine: EngineMode = 'avplay';
let _videoUrl = '';
let _container: HTMLElement;
let _statusEl: HTMLElement | null;
let _bannerEl: HTMLElement | null;
let _leaderActivated = false;
let _followerActivated = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  _container  = document.getElementById('video-container')!;
  _statusEl   = document.getElementById('status-msg');
  _bannerEl   = document.getElementById('engine-banner');

  initHud();
  _setStatus('Detecting device…');

  const selfIp  = await _getSelfIp();
  const deviceId = await _getDeviceId(selfIp);

  initLogger(CONFIG.PI_BASE, deviceId);
  logger.info(`[App] boot: ip=${selfIp} deviceId=${deviceId}`);

  _setStatus('Initializing clock…');
  initializeDeviceClock();
  logger.info(`[App] clock initialized: source=${getClockSource()} offset=${Math.round(getNtpOffset())}ms`);

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
    if (_followerActivated) return;
    _followerActivated = true;
    _activateEngine(_currentEngine, _videoUrl);
  });

  P2PSync.onSetEngine((msg) => {
    logger.info(`[App] SET_ENGINE: ${msg.engineMode}`);
    _switchEngine(msg.engineMode);
  });

  P2PSync.onRole((role) => {
    updateHud({ role, engineMode: _currentEngine });
    if (role === 'leader') _activateLeaderIfNeeded('role');
    if (role === 'follower') _setStatus('Follower — waiting for VIDEO_URL…');
  });

  // Register remote key handler
  try { (window as any).tizen?.tvinputdevice?.registerKey('ChannelUp'); } catch {}
  document.addEventListener('keydown', _onKey);

  _setStatus('Loading video…');
  _videoUrl = _fetchVideoUrl();
  logger.info(`[App] video URL: ${_videoUrl}`);
  P2PSync.broadcastVideoUrl(_videoUrl);

  // Wait briefly for P2P role to be determined (peer poll up to ~4s)
  await _waitForRole(8000);

  updateHud({ role: P2PSync.getRole(), engineMode: _currentEngine });
  _setBanner(_currentEngine);

  if (P2PSync.getRole() === 'leader') {
    _activateLeaderIfNeeded('initial');
  } else {
    _setStatus('Follower — waiting for VIDEO_URL…');
    // Follower activates engine only when VIDEO_URL arrives (onVideoUrl above).
    // Starting unsynced makes heartbeat/state logs stale and destabilizes the test.
    setTimeout(() => {
      if (_videoUrl && !_container.querySelector('video, canvas, object[type="application/avplayer"]')) {
        logger.warn('[App] follower still waiting for leader VIDEO_URL — not starting unsynced');
      }
    }, 12000);
  }
});

// ── Engine management ─────────────────────────────────────────────────────────

function _activateEngine(engine: EngineMode, url: string): void {
  _hideStatus();
  if (engine === 'avplay') {
    initAvplayPlayer(_container);
    avLoad(url).catch((e: any) => logger.error(`[App] AVPlay load failed: ${e?.message}`));
  } else if (engine === 'mse') {
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

function _activateLeaderIfNeeded(reason: string): void {
  if (_leaderActivated || !_videoUrl) return;
  _leaderActivated = true;
  logger.info(`[App] leader: sending VIDEO_URL to follower (${reason})`);
  P2PSync.broadcastVideoUrl(_videoUrl);
  _activateEngine(_currentEngine, _videoUrl);
}

function _switchEngine(newEngine: EngineMode): void {
  if (newEngine === _currentEngine) return;
  logger.info(`[App] switching engine: ${_currentEngine} → ${newEngine}`);
  _currentEngine = newEngine;

  // Teardown all engines (only one is active but tear all for safety)
  avTeardown();
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
      // Cycle: avplay → mse → avplay (wasm excluded — requires SharedArrayBuffer)
      const next: EngineMode = _currentEngine === 'avplay' ? 'mse' : 'avplay';
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
  // 1. Samsung webapis.network (most reliable on Tizen TV)
  try {
    const net = (window as any).webapis?.network;
    if (net) {
      const info = net.getActiveConnectionInfo?.();
      if (info?.ipAddress && info.ipAddress !== '0.0.0.0') return info.ipAddress as string;
    }
  } catch {}
  // 2. tizen.systeminfo NETWORK property
  try {
    const sysinfo = (window as any).tizen?.systeminfo;
    if (sysinfo) {
      const ip = await new Promise<string>((resolve, reject) => {
        sysinfo.getPropertyValue(
          'NETWORK',
          (net: any) => { resolve(net?.ipAddress && net.ipAddress !== '0.0.0.0' ? net.ipAddress : ''); },
          () => resolve(''),
        );
      });
      if (ip) return ip;
    }
  } catch {}
  // 3. Dev browser fallback
  const h = window.location.hostname;
  return (h && h !== 'localhost') ? h : '127.0.0.1';
}

async function _getDeviceId(selfIp: string): Promise<string> {
  const tag = _getTizenTag(); // e.g. 'tizen4-', 'tizen6.5-', ''
  // 1. TV serial number — guaranteed unique per unit
  try {
    const serial = (window as any).webapis?.productinfo?.getSerialNumber?.();
    if (serial && serial.trim().length > 0) return tag + serial.trim();
  } catch {}
  // 2. DUID
  try {
    const duid = (window as any).webapis?.productinfo?.getDuid?.();
    if (duid && duid.trim().length > 0) return tag + duid.trim();
  } catch {}
  // 3. Network MAC — stable across reinstall when product IDs are unavailable
  const mac = await _getNetworkMac();
  if (mac) return tag + mac;
  // 4. IP-derived (works when IP detection succeeds)
  if (selfIp && selfIp !== '127.0.0.1' && selfIp !== '0.0.0.0') return tag + selfIp.replace(/\./g, '-');
  // 5. Persistent random ID stored in localStorage
  const storageKey = '_nexari_sync_device_id';
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(storageKey, id);
  }
  // Only prepend tag if id doesn't already have it (survives reboot)
  return id.startsWith(tag) ? id : tag + id;
}

async function _getNetworkMac(): Promise<string> {
  const normalize = (value: unknown): string => {
    const text = String(value ?? '').trim().toLowerCase();
    return /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/.test(text)
      ? 'mac-' + text.replace(/[^0-9a-f]/g, '')
      : '';
  };

  try {
    const net = (window as any).webapis?.network;
    const direct = normalize(net?.getMac?.());
    if (direct) return direct;
    const info = net?.getActiveConnectionInfo?.();
    const fromInfo = normalize(info?.macAddress ?? info?.mac ?? info?.physicalAddress);
    if (fromInfo) return fromInfo;
  } catch {}

  for (const propertyName of ['WIFI_NETWORK', 'ETHERNET_NETWORK', 'NETWORK']) {
    try {
      const sysinfo = (window as any).tizen?.systeminfo;
      if (!sysinfo?.getPropertyValue) continue;
      const mac = await new Promise<string>((resolve) => {
        sysinfo.getPropertyValue(
          propertyName,
          (info: any) => resolve(normalize(info?.macAddress ?? info?.mac ?? info?.networkMacAddress)),
          () => resolve(''),
        );
      });
      if (mac) return mac;
    } catch {}
  }
  return '';
}

/** Return a short Tizen version prefix: 'tizen4-', 'tizen6.5-', 'tizen7-', etc. */
function _getTizenTag(): string {
  try {
    const ver = (window as any).tizen?.systeminfo?.getCapability(
      'http://tizen.org/feature/platform.version',
    ) as string | undefined;
    if (ver && typeof ver === 'string') {
      const parts = ver.split('.');
      const major = parseInt(parts[0], 10);
      const minor = parseInt(parts[1] ?? '0', 10);
      // Use major.minor only when minor is non-zero, else just major
      const label = minor > 0 ? `${major}.${minor}` : `${major}`;
      return `tizen${label}-`;
    }
  } catch {}
  return '';
}

// Embedded media playlist — files bundled inside the .wgt package
const EMBEDDED_MEDIA = [
  './media/1.mp4',
  './media/2.mp4',
  './media/3.mp4',
];

function _fetchVideoUrl(): string {
  return EMBEDDED_MEDIA[0];
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
