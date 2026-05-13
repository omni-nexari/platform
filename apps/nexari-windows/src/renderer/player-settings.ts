/**
 * player-settings.ts — Player Settings Overlay (Windows / Electron renderer)
 *
 * Triggered by right-click (contextmenu) anywhere on the player screen.
 * Shows device info, current version, available update, WS status.
 *
 * Update mechanism: electron-updater (autoUpdater) handles Windows updates
 * automatically; we show its status here and let users trigger a check.
 * For OTA releases published via the Nexari portal, we also poll
 * GET /player-releases/latest?platform=windows and show the available version.
 *
 * Public API:
 *   initPlayerSettings(opts)    — call once from player.ts
 *   playerSettingsOnUpdateAvailable(version)
 *   playerSettingsOnUpdateDownloaded()
 */

export interface PlayerSettingsOpts {
  getDeviceId:       () => string;
  getDeviceName:     () => string;
  getApiBase:        () => string;
  getWsConnected:    () => boolean;
  getVersion:        () => string;
  onReloadContent:   () => void;
  onClearCache:      () => void;
  /** Trigger autoUpdater.checkForUpdates() via IPC (optional). */
  onCheckForUpdates?: () => void;
  /** Download + install a specific WGT/EXE url via portal-style update. */
  onInstallUpdate?:  (url: string, version: string) => void;
}

interface ReleaseInfo {
  version:            string;
  downloadUrl:        string;
  superadminApproved: boolean;
  managementApproved: boolean;
}

const CSS = `
  #ps-overlay {
    position: fixed; inset: 0; z-index: 99998;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.65);
    animation: ps-fadein 0.15s ease;
  }
  @keyframes ps-fadein { from { opacity:0; transform:scale(0.97) } to { opacity:1; transform:scale(1) } }
  #ps-panel {
    background: rgba(16,20,32,0.97);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    padding: 32px 40px;
    min-width: 480px;
    max-width: 640px;
    color: #fff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    box-shadow: 0 24px 60px rgba(0,0,0,0.75);
  }
  #ps-header {
    display: flex; align-items: center; gap: 10px;
    font-size: 18px; font-weight: 700; color: #c8d8ff;
    margin-bottom: 22px; padding-bottom: 14px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .ps-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
    font-size: 13px; gap: 12px;
  }
  .ps-label { color: rgba(200,215,255,0.5); font-size: 12px; white-space: nowrap; min-width: 100px; }
  .ps-val   { color: #dde8ff; font-size: 13px; text-align: right; word-break: break-all; }
  .ps-badge {
    display: inline-flex; align-items: center;
    padding: 2px 9px; border-radius: 99px; font-size: 11px; font-weight: 700;
  }
  .ps-badge-ok   { background: rgba(50,200,120,0.18); color: #50c87a; border: 1px solid rgba(50,200,120,0.28); }
  .ps-badge-err  { background: rgba(255,80,80,0.18);  color: #ff7070; border: 1px solid rgba(255,80,80,0.28); }
  .ps-badge-warn { background: rgba(255,180,40,0.18); color: #ffc040; border: 1px solid rgba(255,180,40,0.28); }
  .ps-badge-info { background: rgba(80,160,255,0.18); color: #80b8ff; border: 1px solid rgba(80,160,255,0.28); }
  #ps-actions { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
  .ps-btn {
    padding: 9px 18px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; transition: opacity 0.15s;
  }
  .ps-btn:hover   { opacity: 0.85; }
  .ps-btn-primary { background: #3a7bff; color: #fff; }
  .ps-btn-ghost   {
    background: rgba(255,255,255,0.08); color: #d0deff;
    border: 1px solid rgba(255,255,255,0.13);
  }
  .ps-btn-danger  {
    background: rgba(255,80,80,0.14); color: #ff9090;
    border: 1px solid rgba(255,80,80,0.22);
  }
  .ps-btn-update  {
    background: linear-gradient(135deg,#ff7b2c,#ffc030);
    color: #1a0700; font-weight: 800;
  }
  .ps-btn:disabled { opacity: 0.38; cursor: default; }
  #ps-progress-wrap {
    margin-top: 14px; background: rgba(255,255,255,0.07);
    border-radius: 6px; height: 5px; overflow: hidden;
  }
  #ps-progress-bar {
    height: 100%; background: linear-gradient(90deg,#3a7bff,#4ff2d1);
    transition: width 0.3s ease; width: 0%;
  }
  #ps-status-msg {
    margin-top: 8px; font-size: 12px; color: rgba(180,200,255,0.5); min-height: 18px;
  }
  #ps-hint { margin-top: 18px; font-size: 11px; color: rgba(200,215,255,0.3); text-align: right; }
`;

let _opts: PlayerSettingsOpts | null = null;
let _visible = false;
let _overlay: HTMLElement | null = null;
let _autoUpdateVersion: string | null = null;
let _autoUpdateDownloaded = false;
let _available: ReleaseInfo | null = null;

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectStyles() {
  if (document.getElementById('ps-styles')) return;
  const s = document.createElement('style');
  s.id = 'ps-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function ensureOverlay() {
  if (_overlay) return;
  injectStyles();
  _overlay = document.createElement('div');
  _overlay.id = 'ps-overlay';
  _overlay.innerHTML =
    '<div id="ps-panel">' +
      '<div id="ps-header">&#9881; Player Settings</div>' +
      '<div id="ps-body"></div>' +
      '<div id="ps-actions"></div>' +
      '<div id="ps-progress-wrap" style="display:none"><div id="ps-progress-bar"></div></div>' +
      '<div id="ps-status-msg"></div>' +
      '<div id="ps-hint">Right-click to open &middot; ESC to close</div>' +
    '</div>';
  _overlay.addEventListener('click', (e) => { if (e.target === _overlay) hide(); });
  document.body.appendChild(_overlay);
}

function refreshBody() {
  if (!_overlay || !_opts) return;
  const body = document.getElementById('ps-body');
  if (!body) return;
  const o = _opts;

  const wsOk = o.getWsConnected();
  const curVer = o.getVersion();
  const wsBadge = wsOk
    ? '<span class="ps-badge ps-badge-ok">&#9679; Connected</span>'
    : '<span class="ps-badge ps-badge-err">&#9679; Disconnected</span>';

  let updateRow = '';
  if (_autoUpdateDownloaded) {
    updateRow = '<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val"><span class="ps-badge ps-badge-warn">Ready — restart to apply</span></span></div>';
  } else if (_autoUpdateVersion) {
    updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val">v${esc(_autoUpdateVersion)} <span class="ps-badge ps-badge-info">Downloading…</span></span></div>`;
  } else if (_available && _available.version !== curVer && _available.managementApproved) {
    updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val">v${esc(_available.version)} <span class="ps-badge ps-badge-info">Available</span></span></div>`;
  } else if (_available && _available.version !== curVer) {
    updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val">v${esc(_available.version)} <span class="ps-badge ps-badge-warn">Awaiting approval</span></span></div>`;
  } else if (curVer) {
    updateRow = '<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val"><span class="ps-badge ps-badge-ok">Up to date</span></span></div>';
  }

  body.innerHTML =
    `<div class="ps-row"><span class="ps-label">Device</span><span class="ps-val">${esc(o.getDeviceName())}</span></div>` +
    `<div class="ps-row"><span class="ps-label">Device ID</span><span class="ps-val" style="font-size:11px;opacity:0.5">${esc(o.getDeviceId())}</span></div>` +
    `<div class="ps-row"><span class="ps-label">Version</span><span class="ps-val">${curVer ? 'v' + esc(curVer) : '–'}</span></div>` +
    updateRow +
    `<div class="ps-row"><span class="ps-label">Server</span><span class="ps-val" style="font-size:11px">${esc(o.getApiBase())}</span></div>` +
    `<div class="ps-row"><span class="ps-label">WebSocket</span><span class="ps-val">${wsBadge}</span></div>`;

  refreshActions();
}

function refreshActions() {
  if (!_opts) return;
  const el = document.getElementById('ps-actions');
  if (!el) return;
  el.innerHTML = '';
  const o = _opts;

  // If autoUpdater already has a downloaded update, offer restart
  if (_autoUpdateDownloaded) {
    const btn = document.createElement('button');
    btn.className = 'ps-btn ps-btn-update';
    btn.textContent = 'Restart & Apply Update';
    btn.addEventListener('click', () => { location.reload(); });
    el.appendChild(btn);
  } else if (o.onCheckForUpdates) {
    const btn = document.createElement('button');
    btn.className = 'ps-btn ps-btn-primary';
    btn.textContent = 'Check for Updates';
    btn.addEventListener('click', () => {
      o.onCheckForUpdates!();
      setMsg('Checking for updates…');
    });
    el.appendChild(btn);
  }

  const reload = document.createElement('button');
  reload.className = 'ps-btn ps-btn-ghost';
  reload.textContent = 'Reload Content';
  reload.addEventListener('click', () => { o.onReloadContent(); hide(); });
  el.appendChild(reload);

  const clear = document.createElement('button');
  clear.className = 'ps-btn ps-btn-danger';
  clear.textContent = 'Clear Cache';
  clear.addEventListener('click', () => { o.onClearCache(); hide(); });
  el.appendChild(clear);

  const close = document.createElement('button');
  close.className = 'ps-btn ps-btn-ghost';
  close.textContent = 'Close  [ESC]';
  close.addEventListener('click', hide);
  el.appendChild(close);
}

function setMsg(text: string) {
  const el = document.getElementById('ps-status-msg');
  if (el) el.textContent = text;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function show() {
  if (_visible) { refreshBody(); return; }
  ensureOverlay();
  refreshBody();
  _overlay!.style.display = 'flex';
  _visible = true;
}

export function hide() {
  if (!_visible || !_overlay) return;
  _overlay.style.display = 'none';
  _visible = false;
  setMsg('');
  const wrap = document.getElementById('ps-progress-wrap');
  if (wrap) wrap.style.display = 'none';
}

export function toggle() {
  _visible ? hide() : show();
}

export function setWsStatus(_connected: boolean) {
  if (_visible) refreshBody();
}

/** Called by player.ts when electron-updater signals an update is available. */
export function onAutoUpdateAvailable(version: string) {
  _autoUpdateVersion = version;
  if (_visible) refreshBody();
}

/** Called by player.ts when electron-updater signals download is complete. */
export function onAutoUpdateDownloaded() {
  _autoUpdateDownloaded = true;
  if (_visible) refreshBody();
}

export function initPlayerSettings(opts: PlayerSettingsOpts) {
  _opts = opts;
  // ESC closes overlay
  document.addEventListener('keydown', (e) => {
    if (_visible && (e.key === 'Escape' || e.keyCode === 27)) hide();
  });
  // Right-click opens overlay
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggle();
  });
  // Poll for portal-published updates
  pollForUpdates();
  setInterval(pollForUpdates, 30 * 60 * 1000);
}

function pollForUpdates() {
  if (!_opts) return;
  const apiBase = _opts.getApiBase();
  if (!apiBase) return;
  const token = localStorage.getItem('deviceToken') || '';
  const url = apiBase.replace(/\/+$/, '') + '/player-releases/latest?platform=windows';
  fetch(url, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: any) => {
      if (data && typeof data.version === 'string') {
        _available = {
          version:            data.version,
          downloadUrl:        data.downloadUrl || '',
          superadminApproved: !!data.superadminApproved,
          managementApproved: !!data.managementApproved,
        };
      } else {
        _available = null;
      }
      if (_visible) refreshBody();
    })
    .catch(() => {});
}
