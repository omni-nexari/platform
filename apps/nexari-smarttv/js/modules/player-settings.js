/**
 * player-settings.ts — Player Settings Overlay (Tizen)
 *
 * Triggered by remote key "2" (NUM_2 / keyCode 50).
 * Shows device info, current version, available update, WS status.
 *
 * Public API:
 *   PlayerSettings.init(opts)
 *   PlayerSettings.show() / hide() / toggle()
 *   PlayerSettings.setWsStatus(connected)
 *   PlayerSettings.isVisible()
 */
var PlayerSettings;
(function (PlayerSettings) {
    let _opts = null;
    let _visible = false;
    let _overlay = null;
    let _available = null;
    let _updateInProgress = false;
    // ─── CSS ───────────────────────────────────────────────────────────────────
    const CSS = `
    #ps-overlay {
      position: fixed; inset: 0; z-index: 99998;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.72);
      animation: ps-fadein 0.18s ease;
    }
    @keyframes ps-fadein { from { opacity:0; transform:scale(0.97) } to { opacity:1; transform:scale(1) } }
    #ps-panel {
      background: rgba(16,20,32,0.97);
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 18px;
      padding: 36px 44px;
      min-width: 540px;
      max-width: 700px;
      width: 60vw;
      color: #fff;
      font-family: 'Samsung Sharp Sans','Segoe UI',sans-serif;
      box-shadow: 0 28px 70px rgba(0,0,0,0.8);
    }
    #ps-header {
      display: flex; align-items: center; gap: 12px;
      font-size: 20px; font-weight: 700; color: #c8d8ff;
      margin-bottom: 26px; padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .ps-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 14px; gap: 16px;
    }
    .ps-label { color: rgba(200,215,255,0.55); font-size: 12px; white-space: nowrap; min-width: 110px; }
    .ps-val   { color: #dde8ff; font-size: 13px; text-align: right; word-break: break-all; }
    .ps-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 99px;
      font-size: 11px; font-weight: 700;
    }
    .ps-badge-ok   { background: rgba(50,200,120,0.18); color: #50c87a; border: 1px solid rgba(50,200,120,0.28); }
    .ps-badge-err  { background: rgba(255,80,80,0.18);  color: #ff7070; border: 1px solid rgba(255,80,80,0.28); }
    .ps-badge-warn { background: rgba(255,180,40,0.18); color: #ffc040; border: 1px solid rgba(255,180,40,0.28); }
    .ps-badge-info { background: rgba(80,160,255,0.18); color: #80b8ff; border: 1px solid rgba(80,160,255,0.28); }
    #ps-actions {
      display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap;
    }
    .ps-btn {
      padding: 10px 22px; border-radius: 9px; border: none; cursor: pointer;
      font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
      transition: opacity 0.15s, transform 0.1s;
    }
    .ps-btn:hover   { opacity: 0.85; transform: translateY(-1px); }
    .ps-btn:active  { transform: translateY(0); }
    .ps-btn-primary { background: #3a7bff; color: #fff; }
    .ps-btn-ghost   {
      background: rgba(255,255,255,0.08); color: #d0deff;
      border: 1px solid rgba(255,255,255,0.14);
    }
    .ps-btn-danger  {
      background: rgba(255,80,80,0.15); color: #ff9090;
      border: 1px solid rgba(255,80,80,0.25);
    }
    .ps-btn-update  {
      background: linear-gradient(135deg,#ff7b2c,#ffc030);
      color: #1a0700; font-weight: 800;
    }
    .ps-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
    #ps-progress-wrap {
      margin-top: 16px; background: rgba(255,255,255,0.07);
      border-radius: 6px; height: 6px; overflow: hidden;
    }
    #ps-progress-bar {
      height: 100%; background: linear-gradient(90deg,#3a7bff,#4ff2d1);
      transition: width 0.35s ease; width: 0%;
    }
    #ps-status-msg {
      margin-top: 10px; font-size: 12px; color: rgba(180,200,255,0.55);
      min-height: 18px;
    }
  `;
    // ─── DOM helpers ──────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ps-styles'))
            return;
        const s = document.createElement('style');
        s.id = 'ps-styles';
        s.textContent = CSS;
        document.head.appendChild(s);
    }
    function esc(v) {
        return String(v !== null && v !== void 0 ? v : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // ─── Overlay build ────────────────────────────────────────────────────────
    function ensureOverlay() {
        if (_overlay)
            return;
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
                '</div>';
        _overlay.addEventListener('click', function (e) {
            if (e.target === _overlay)
                hide();
        });
        document.body.appendChild(_overlay);
    }
    function refreshBody() {
        if (!_overlay || !_opts)
            return;
        const body = document.getElementById('ps-body');
        if (!body)
            return;
        const o = _opts;
        const wsOk = o.getWsConnected();
        const curVer = o.getCurrentVersion();
        const wsBadge = wsOk
            ? '<span class="ps-badge ps-badge-ok">&#9679; Connected</span>'
            : '<span class="ps-badge ps-badge-err">&#9679; Disconnected</span>';
        let updateRow = '';
        if (_available) {
            const isNewer = _available.version !== curVer;
            if (isNewer && _available.managementApproved) {
                updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val">v${esc(_available.version)} <span class="ps-badge ps-badge-info">Ready</span></span></div>`;
            }
            else if (isNewer) {
                updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val">v${esc(_available.version)} <span class="ps-badge ps-badge-warn">Awaiting approval</span></span></div>`;
            }
            else {
                updateRow = `<div class="ps-row"><span class="ps-label">Update</span><span class="ps-val"><span class="ps-badge ps-badge-ok">Up to date</span></span></div>`;
            }
        }
        body.innerHTML =
            `<div class="ps-row"><span class="ps-label">Device</span><span class="ps-val">${esc(o.getDeviceName())}</span></div>` +
                `<div class="ps-row"><span class="ps-label">Device ID</span><span class="ps-val" style="font-size:11px;opacity:0.5">${esc(o.getDeviceId())}</span></div>` +
                `<div class="ps-row"><span class="ps-label">Version</span><span class="ps-val">${curVer ? 'v' + esc(curVer) : '–'}</span></div>` +
                updateRow +
                `<div class="ps-row"><span class="ps-label">Server</span><span class="ps-val" style="font-size:11px">${esc(o.getApiBase())}</span></div>` +
                `<div class="ps-row"><span class="ps-label">IP Address</span><span class="ps-val">${esc(o.getIpAddress() || '–')}</span></div>` +
                `<div class="ps-row"><span class="ps-label">WebSocket</span><span class="ps-val">${wsBadge}</span></div>`;
        refreshActions();
    }
    function refreshActions() {
        if (!_opts)
            return;
        const el = document.getElementById('ps-actions');
        if (!el)
            return;
        el.innerHTML = '';
        const o = _opts;
        const canUpdate = !!_available && _available.version !== o.getCurrentVersion() && _available.managementApproved && !_updateInProgress;
        if (canUpdate && _available) {
            const btn = document.createElement('button');
            btn.className = 'ps-btn ps-btn-update';
            btn.textContent = 'Update to v' + _available.version;
            btn.addEventListener('click', startUpdate);
            el.appendChild(btn);
        }
        const reload = document.createElement('button');
        reload.className = 'ps-btn ps-btn-ghost';
        reload.textContent = 'Reload Content';
        reload.addEventListener('click', function () { o.onReloadContent(); hide(); });
        el.appendChild(reload);
        const clear = document.createElement('button');
        clear.className = 'ps-btn ps-btn-danger';
        clear.textContent = 'Clear Cache';
        clear.addEventListener('click', function () { o.onClearCache(); hide(); });
        el.appendChild(clear);
        const close = document.createElement('button');
        close.className = 'ps-btn ps-btn-ghost';
        close.textContent = 'Close  [2]';
        close.addEventListener('click', hide);
        el.appendChild(close);
    }
    // ─── Update flow ──────────────────────────────────────────────────────────
    function startUpdate() {
        if (!_available || _updateInProgress || !_opts)
            return;
        _updateInProgress = true;
        const rel = _available;
        refreshActions();
        const wrap = document.getElementById('ps-progress-wrap');
        const bar = document.getElementById('ps-progress-bar');
        if (wrap)
            wrap.style.display = '';
        if (bar)
            bar.style.width = '0%';
        setMsg('Starting update to v' + rel.version + '…');
        const tiz = window.tizen;
        let pkgId = 'com.nexari.player';
        try {
            pkgId = tiz.application.getCurrentApplication().appInfo.packageId || pkgId;
        }
        catch (_) { }
        const AppUpdater = window.AppUpdater;
        if (typeof AppUpdater === 'undefined') {
            setMsg('AppUpdater module not available — please update via portal');
            _updateInProgress = false;
            refreshActions();
            return;
        }
        AppUpdater.handle({ type: 'APP_UPDATE', wgtUrl: rel.downloadUrl, version: rel.version, packageId: pkgId }, function (statusType, data) {
            const pct = data && typeof data['pct'] === 'number' ? data['pct'] : null;
            if (bar && pct !== null)
                bar.style.width = pct + '%';
            if (statusType === 'app_update_downloading') {
                setMsg('Downloading… ' + (pct !== null ? pct + '%' : ''));
            }
            else if (statusType === 'app_update_installing') {
                const iPct = data && typeof data['installPct'] === 'number' ? data['installPct'] : null;
                if (bar && iPct !== null)
                    bar.style.width = iPct + '%';
                setMsg('Installing… ' + (iPct !== null ? iPct + '%' : ''));
            }
            else if (statusType === 'app_update_done') {
                if (bar)
                    bar.style.width = '100%';
                setMsg('Update installed — relaunching…');
            }
            else if (statusType === 'app_update_failed') {
                setMsg('Update failed: ' + (data && data['error'] ? String(data['error']) : 'unknown error'));
                _updateInProgress = false;
                if (wrap)
                    wrap.style.display = 'none';
                refreshActions();
            }
        });
    }
    function setMsg(text) {
        const el = document.getElementById('ps-status-msg');
        if (el)
            el.textContent = text;
    }
    // ─── Public API ───────────────────────────────────────────────────────────
    function show() {
        if (_visible) {
            refreshBody();
            return;
        }
        ensureOverlay();
        refreshBody();
        _overlay.style.display = 'flex';
        _visible = true;
    }
    PlayerSettings.show = show;
    function hide() {
        if (!_visible || !_overlay)
            return;
        _overlay.style.display = 'none';
        _visible = false;
        _updateInProgress = false;
        const wrap = document.getElementById('ps-progress-wrap');
        if (wrap)
            wrap.style.display = 'none';
        setMsg('');
    }
    PlayerSettings.hide = hide;
    function toggle() {
        _visible ? hide() : show();
    }
    PlayerSettings.toggle = toggle;
    function isVisible() {
        return _visible;
    }
    PlayerSettings.isVisible = isVisible;
    /** Call whenever WS connects or disconnects so the open overlay stays current. */
    function setWsStatus(_connected) {
        if (_visible)
            refreshBody();
    }
    PlayerSettings.setWsStatus = setWsStatus;
    function init(opts) {
        _opts = opts;
        // Initial update check, then every 30 min
        pollForUpdates();
        setInterval(pollForUpdates, 30 * 60 * 1000);
    }
    PlayerSettings.init = init;
    // ─── Update polling ───────────────────────────────────────────────────────
    function pollForUpdates() {
        if (!_opts)
            return;
        const apiBase = _opts.getApiBase();
        if (!apiBase)
            return;
        const token = localStorage.getItem('deviceToken') || '';
        const url = apiBase.replace(/\/+$/, '') + '/player-releases/latest?platform=tizen';
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        if (token)
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.timeout = 15000;
        xhr.onload = function () {
            try {
                if (xhr.status !== 200)
                    return;
                const data = JSON.parse(xhr.responseText);
                if (data && typeof data.version === 'string') {
                    _available = {
                        version: data.version,
                        downloadUrl: data.downloadUrl || '',
                        superadminApproved: !!data.superadminApproved,
                        managementApproved: !!data.managementApproved,
                    };
                }
                else {
                    _available = null;
                }
                if (_visible)
                    refreshBody();
            }
            catch (_) { }
        };
        xhr.onerror = xhr.ontimeout = function () { };
        try {
            xhr.send();
        }
        catch (_) { }
    }
})(PlayerSettings || (PlayerSettings = {}));
