/**
 * app.ts — Boot entry for Nexari Sync Engine
 *
 * Remote key map:
 *   KEY 1  → switch to HTML5 <video> engine
 *   KEY 2  → switch to AVPlay engine  (default)
 *   BACK   → exit app
 *
 * Engine switching: destroys the active engine and re-initialises the selected one.
 * The sync session does NOT restart on engine switch — the next sync cycle picks up
 * the newly active engine via the injected callbacks in SyncConfig.
 */
import { initEngine,       prepare,             schedulePlayAt,       getDuration,       destroyEngine       } from './engine.js';
import { initHtml5Engine,  prepareHtml5,        scheduleHtml5PlayAt,  getHtml5Duration,  destroyHtml5Engine  } from './engine-html5.js';
import { initLogger, logger } from './logger.js';
import { init as syncInit, stop as syncStop } from './sync.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  PI_BASE:        'http://192.168.1.17',
  GROUP_ID:       'syncengine-001',
  EXPECTED_PEERS: 2,
};

// ── State ─────────────────────────────────────────────────────────────────────

type EngineMode = 'avplay' | 'html5';
let _mode:         EngineMode   = 'avplay';
let _container:    HTMLElement;
let _syncStarted = false;

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  _container = document.getElementById('player-container')!;
  const statusEl   = document.getElementById('status')!;
  const deviceInfo = document.getElementById('device-info')!;
  const modeEl     = document.getElementById('engine-mode')!;

  const setStatus    = (msg: string)        => { statusEl.textContent = msg; };
  const setModeLabel = (m: EngineMode)      => {
    modeEl.textContent = m === 'avplay' ? '2 · AVPlay (active)' : '1 · HTML5 (active)';
  };

  setStatus('Detecting device…');
  const selfIp   = await _getSelfIp();
  const deviceId = await _makeDeviceId(selfIp);

  initLogger(CONFIG.PI_BASE, deviceId);
  deviceInfo.textContent = `${deviceId}  |  ${selfIp}  |  group: ${CONFIG.GROUP_ID}`;
  logger.info(`[App] boot ip=${selfIp} deviceId=${deviceId}`);

  // Register remote keys
  try {
    const td = (window as any).tizen?.tvinputdevice;
    if (td) {
      td.registerKey('1');
      td.registerKey('2');
    }
  } catch (e: any) {
    logger.warn(`[App] registerKey failed: ${e?.message}`);
  }

  document.addEventListener('keydown', (e) => {
    if (e.keyCode === 49 /* 1 */) {
      _switchEngine('html5', setStatus, setModeLabel);
    } else if (e.keyCode === 50 /* 2 */) {
      _switchEngine('avplay', setStatus, setModeLabel);
    } else if (e.keyCode === 10009 || e.keyCode === 27) {
      // RETURN / BACK — exit
      logger.info('[App] exit requested');
      syncStop();
      try { (window as any).tizen?.application?.getCurrentApplication().exit(); } catch {}
    }
  });

  // Activate default engine
  _activateEngine(_mode, _container);
  setModeLabel(_mode);

  // ── SYNC MODE ─────────────────────────────────────────────────────────────
  if (!_syncStarted) {
    _syncStarted = true;
    const overlay  = document.getElementById('overlay');
    const logPanel = document.getElementById('log-panel');
    syncInit({
      piBase:        CONFIG.PI_BASE,
      groupId:       CONFIG.GROUP_ID,
      deviceId,
      selfIp,
      expectedPeers: CONFIG.EXPECTED_PEERS,
      onStatus: (msg) => {
        setStatus(msg);
        logger.info(`[Sync] status: ${msg}`);
      },
      prepareEngine: (url) => {
        if (_mode === 'avplay') return prepare(url);
        return prepareHtml5(url);
      },
      schedulePlay: (epochMs) => {
        // Hide overlay now so AVPlay hardware layer is fully visible when video starts
        if (overlay)  overlay.style.display  = 'none';
        if (logPanel) logPanel.style.display = 'none';
        if (_mode === 'avplay') schedulePlayAt(epochMs);
        else                   scheduleHtml5PlayAt(epochMs);
      },
      getEngineDuration: () => {
        if (_mode === 'avplay') return getDuration();
        return getHtml5Duration();
      },
    });
  }
});

// ── Engine management ─────────────────────────────────────────────────────────

function _activateEngine(mode: EngineMode, container: HTMLElement): void {
  // Tear down whatever is running
  try { destroyEngine(); }      catch {}
  try { destroyHtml5Engine(); } catch {}

  // Remove any leftover DOM elements from previous engine
  const old = container.querySelector('object[type="application/avplayer"], video');
  if (old) old.parentNode?.removeChild(old);

  if (mode === 'avplay') {
    initEngine(container);
  } else {
    initHtml5Engine(container);
  }
}

function _switchEngine(mode: EngineMode, setStatus: (s: string) => void, setModeLabel: (m: EngineMode) => void): void {
  if (_mode === mode) return;
  logger.info(`[App] engine switch ${_mode} → ${mode}`);
  _mode = mode;
  setModeLabel(mode);
  _activateEngine(mode, _container);
  setStatus(`Engine: ${mode === 'avplay' ? 'AVPlay' : 'HTML5 video'} — waiting for next sync cue`);
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
  // 1. Serial number
  try {
    const serial = (window as any).webapis?.productinfo?.getSerialNumber?.();
    if (serial && serial.trim().length > 0) return tag + serial.trim();
  } catch {}
  // 2. DUID
  try {
    const duid = (window as any).webapis?.productinfo?.getDuid?.();
    if (duid && duid.trim().length > 0) return tag + duid.trim();
  } catch {}
  // 3. MAC
  const mac = await _getNetworkMac();
  if (mac) return tag + 'mac-' + mac;
  // 4. IP (when we actually got a real one)
  if (selfIp && selfIp !== '127.0.0.1' && selfIp !== '0.0.0.0') {
    return tag + selfIp.replace(/\./g, '-');
  }
  // 5. Persistent random ID in localStorage
  const key = '_nexari_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id.startsWith(tag) ? id : tag + id;
}
