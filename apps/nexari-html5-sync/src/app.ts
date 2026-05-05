/**
 * app.ts — Boot entry for Nexari HTML5 Sync
 *
 * Identical sync protocol to NexariSyncEngine but uses HTML5 <video>
 * instead of AVPlay. Last-frame freeze is achieved by pausing the video
 * element after EOS (browser compositing holds last decoded frame).
 */
import { initEngine, prepare, schedulePlayAt, getDuration, destroyEngine } from './engine.js';
import { initLogger, logger } from './logger.js';
import { init as syncInit, stop as syncStop } from './sync.js';

// ── Config ────────────────────────────────────────────────────────────────────

const RELAY_IP   = '192.168.1.11';
const RELAY_PORT = 9616;

const CONFIG = {
  WS_URL:         `ws://${RELAY_IP}:${RELAY_PORT}`,
  // Log relay: send logs to the on-TV Node relay (QBC:9616).
  // The relay stores logs in memory; the dashboard queries it directly.
  LOG_BASE:       `http://${RELAY_IP}:${RELAY_PORT}`,
  GROUP_ID:       'html5sync-001',
  EXPECTED_PEERS: 1,
};

// ── State ─────────────────────────────────────────────────────────────────────

let _container:    HTMLElement;
let _syncStarted = false;

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('error', (e) => {
  const msg = `[App] UNCAUGHT ERROR: ${e?.message} (${e?.filename}:${e?.lineno})`;
  console.error(msg);
  try { (window as any).__nexariLog?.(msg); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = `[App] UNHANDLED REJECTION: ${e?.reason?.message ?? e?.reason}`;
  console.error(msg);
  try { (window as any).__nexariLog?.(msg); } catch {}
});

window.addEventListener('load', async () => {
  _container = document.getElementById('player-container')!;
  const statusEl   = document.getElementById('status')!;
  const deviceInfo = document.getElementById('device-info')!;
  const modeEl     = document.getElementById('engine-mode')!;

  const setStatus = (msg: string) => { statusEl.textContent = msg; };
  modeEl.textContent = 'HTML5 Video';

  setStatus('Detecting device…');
  const selfIp   = await _getSelfIp();
  const deviceId = await _makeDeviceId(selfIp);

  initLogger(CONFIG.LOG_BASE, deviceId);
  deviceInfo.textContent = `${deviceId}  |  ${selfIp}  |  group: ${CONFIG.GROUP_ID}`;
  logger.info(`[App] boot ip=${selfIp} deviceId=${deviceId}`);

  document.addEventListener('keydown', (e) => {
    if (e.keyCode === 10009 || e.keyCode === 27) {
      logger.info('[App] exit requested');
      syncStop();
      try { (window as any).tizen?.application?.getCurrentApplication().exit(); } catch {}
    }
  });

  initEngine(_container).catch(e => logger.error(`[App] initEngine failed: ${e?.message ?? e}`));

  // Start the on-device Node sidecar relay (Pi-less). Fire and forget;
  // sync.ts will retry connections to RELAY_IP until it comes up.
  _startNodeRelay(setStatus);

  if (!_syncStarted) {
    _syncStarted = true;
    const overlay  = document.getElementById('overlay');
    const logPanel = document.getElementById('log-panel');
    // Brief delay so the local Node relay has a chance to bind before
    // sync starts polling/registering.
    await new Promise((r) => setTimeout(r, 2500));
    syncInit({
      wsUrl:         CONFIG.WS_URL,
      groupId:       CONFIG.GROUP_ID,
      deviceId,
      selfIp,
      expectedPeers: CONFIG.EXPECTED_PEERS,
      onStatus: (msg) => {
        setStatus(msg);
        logger.info(`[Sync] status: ${msg}`);
      },
      prepareEngine: (url) => prepare(url),
      // Wipe + reinitialise the engine. sync.ts calls this when a new
      // follower joins mid-play so leader + followers restart cleanly.
      restartEngine: () => {
        logger.info('[App] engine restart requested');
        try { destroyEngine(); } catch {}
        const old = _container.querySelector('video');
        if (old?.parentNode) old.parentNode.removeChild(old);
        initEngine(_container).catch(e => logger.error(`[App] restartEngine failed: ${e?.message ?? e}`));
      },
      schedulePlay: (epochMs) => {
        if (overlay)  overlay.style.display  = 'none';
        if (logPanel) logPanel.style.display = 'none';
        schedulePlayAt(epochMs);
      },
      getEngineDuration: () => getDuration(),
    });
  }
});

// ── Node sidecar (Pi-less relay) ──────────────────────────────────────────────

/**
 * Stub selection by Tizen platform.version (matches NodeTester/main.js):
 *   2.4 → server2016, 3.0 → server2017, 4.0 → server2018,
 *   5.0 → server2019, 6.0+ → server2022
 */
function _pickSignedStub(): string {
  let v = '6.5';
  try {
    v = (window as any).tizen?.systeminfo?.getCapability(
      'http://tizen.org/feature/platform.version',
    ) || v;
  } catch {}
  if (v === '2.4' || v === '2.4.0') return '../lib/server2016.js.signed';
  if (v === '3.0' || v === '3.0.0') return '../lib/server2017.js.signed';
  if (v === '4.0' || v === '4.0.0') return '../lib/server2018.js.signed';
  if (v === '5.0' || v === '5.0.0') return '../lib/server2019.js.signed';
  return '../lib/server2022.js.signed';
}

function _startNodeRelay(setStatus: (s: string) => void): void {
  const b2b = (window as any).b2bapis?.b2bcontrol;
  if (!b2b || typeof b2b.startNodeServer !== 'function') {
    logger.warn('[NodeRelay] b2bcontrol.startNodeServer unavailable on this firmware');
    return;
  }
  const stub = _pickSignedStub();
  logger.info(`[NodeRelay] starting ${stub} → :${RELAY_PORT}`);
  setStatus(`Starting Node relay (${stub.split('/').pop()})…`);
  try {
    b2b.startNodeServer(
      stub,
      'nexari-sync-relay',
      () => { logger.info(`[NodeRelay] running on :${RELAY_PORT}`); },
      (e: any) => { logger.warn(`[NodeRelay] start failed: ${e?.message ?? e}`); },
    );
  } catch (e: any) {
    logger.warn(`[NodeRelay] startNodeServer threw: ${e?.message}`);
  }
}

// ── Device identification ─────────────────────────────────────────────────────

async function _getSelfIp(): Promise<string> {
  for (const propName of ['NETWORK', 'WIFI_NETWORK', 'ETHERNET_NETWORK']) {
    try {
      const si = (window as any).tizen?.systeminfo;
      if (!si?.getPropertyValue) break;
      const ip = await new Promise<string>((resolve) => {
        si.getPropertyValue(
          propName,
          (nw: any) => {
            const addr = (nw?.ipAddress ?? nw?.ip ?? '').trim();
            resolve(addr && addr !== '0.0.0.0' ? addr : '');
          },
          () => resolve(''),
        );
      });
      if (ip) return ip;
    } catch {}
  }
  const h = window.location.hostname;
  return (h && h !== 'localhost') ? h : '127.0.0.1';
}

function _normMac(v: unknown): string {
  const t = String(v ?? '').trim().toLowerCase();
  return /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/.test(t)
    ? t.replace(/[^0-9a-f]/g, '') : '';
}

async function _getNetworkMac(): Promise<string> {
  try {
    const net = (window as any).webapis?.network;
    const m = _normMac(net?.getMac?.());
    if (m) return m;
    const info = net?.getActiveConnectionInfo?.();
    const m2 = _normMac(info?.macAddress ?? info?.mac);
    if (m2) return m2;
  } catch {}
  for (const prop of ['WIFI_NETWORK', 'ETHERNET_NETWORK', 'NETWORK']) {
    try {
      const si = (window as any).tizen?.systeminfo;
      if (!si?.getPropertyValue) break;
      const m = await new Promise<string>((r) => {
        si.getPropertyValue(prop,
          (info: any) => r(_normMac(info?.macAddress ?? info?.networkMacAddress ?? '')),
          () => r(''),
        );
      });
      if (m) return m;
    } catch {}
  }
  return '';
}

function _tizenTag(): string {
  try {
    const v = String((window as any).tizen?.systeminfo
      ?.getCapability?.('http://tizen.org/feature/platform.version') ?? '');
    return v ? `tizen${v.split('.').slice(0, 2).join('.')}-` : '';
  } catch { return ''; }
}

async function _makeDeviceId(selfIp: string): Promise<string> {
  const tag = _tizenTag();
  try {
    const serial = (window as any).webapis?.productinfo?.getSerialNumber?.();
    if (serial && serial.trim().length > 0) return tag + serial.trim();
  } catch {}
  try {
    const duid = (window as any).webapis?.productinfo?.getDuid?.();
    if (duid && duid.trim().length > 0) return tag + duid.trim();
  } catch {}
  const mac = await _getNetworkMac();
  if (mac) return tag + 'mac-' + mac;
  if (selfIp && selfIp !== '127.0.0.1' && selfIp !== '0.0.0.0') {
    return tag + selfIp.replace(/\./g, '-');
  }
  const key = '_nexari_h5_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id.startsWith(tag) ? id : tag + id;
}
