// Nexari E-Paper — Device Pairing Module

// ─── Connection Settings UI ───────────────────────────────────────────────────
window.PairingSettings = {
  _open: false,

  init() {
    const apiInput = document.getElementById('input-api-base');
    const wsInput  = document.getElementById('input-ws-url');
    if (apiInput) apiInput.value = CONFIG.API_BASE;
    if (wsInput)  wsInput.value  = CONFIG.WS_URL || '';

    if (apiInput && wsInput) {
      apiInput.addEventListener('input', () => {
        try {
          const u = new URL(apiInput.value.trim());
          wsInput.value = (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host;
        } catch (_) {}
      });
    }
  },

  toggle() {
    this._open = !this._open;
    const panel = document.getElementById('conn-settings-panel');
    const arrow = document.getElementById('conn-settings-arrow');
    if (panel) panel.classList.toggle('hidden', !this._open);
    if (arrow) arrow.innerHTML = this._open ? '&#9650;' : '&#9660;';
  },

  apply() {
    const apiEl = document.getElementById('input-api-base');
    const apiRaw = (apiEl ? apiEl.value : '').trim().replace(/\/$/, '');
    const wsEl = document.getElementById('input-ws-url');
    const wsRaw = (wsEl ? wsEl.value : '').trim().replace(/\/$/, '');
    const msg = document.getElementById('conn-settings-msg');

    try { new URL(apiRaw); } catch (_) {
      if (msg) { msg.style.color = '#b00040'; msg.textContent = 'Invalid API URL — must be http://… or https://…'; }
      return;
    }

    localStorage.setItem('PLAYER_API_BASE', apiRaw);
    if (wsRaw) localStorage.setItem('PLAYER_WS_URL', wsRaw);
    else       localStorage.removeItem('PLAYER_WS_URL');

    CONFIG.API_BASE = apiRaw;
    CONFIG.WS_URL = wsRaw || apiRaw.replace(/^http/, 'ws').replace(/\/api\/v1.*$/, '');

    if (msg) { msg.style.color = ''; msg.textContent = 'Saved — reconnecting…'; }
    setTimeout(() => location.reload(), 800);
  },

  reset() {
    localStorage.removeItem('PLAYER_API_BASE');
    localStorage.removeItem('PLAYER_WS_URL');
    const msg = document.getElementById('conn-settings-msg');
    if (msg) { msg.style.color = ''; msg.textContent = 'Reset to defaults — reconnecting…'; }
    setTimeout(() => location.reload(), 800);
  },
};

// ─── Pairing ──────────────────────────────────────────────────────────────────
window.Pairing = {
  pairingCheckInterval: null,
  pairingCode: null,

  showPairingScreen() {
    document.getElementById('pairing-screen').classList.remove('hidden');
    document.getElementById('player-screen').classList.add('hidden');
    document.getElementById('error-screen').classList.add('hidden');
  },

  async init() {
    logger.info('Starting e-paper pairing process...');
    this.showPairingScreen();
    PairingSettings.init();

    try {
      const sys = await Telemetry.getSystemInfo();
      const deviceInfo = {
        duid: sys.duid || sys.serialNumber || null,
        model: sys.model,
        realModel: sys.realModel,
        modelCode: sys.realModel || null,
        serialNumber: sys.serialNumber,
        firmwareVersion: sys.firmwareVersion,
        // E-paper specific
        panelW: sys.panelW,
        panelH: sys.panelH,
        orientation: sys.orientation,
        epaperApiVersion: sys.epaperApiVersion,
      };

      const displayModel = sys.realModel || sys.model || 'Unknown';
      this._setText('device-model', 'Model: ' + displayModel);
      if (sys.ipAddress) this._setText('device-ip', 'IP: ' + sys.ipAddress);
      if (sys.serialNumber) this._setText('device-serial', 'Serial: ' + sys.serialNumber);
      this._setText('device-panel', 'Panel: ' + sys.panelType);
      this._setText('device-epaper', 'E-Paper API: ' + (sys.epaperApiVersion || 'NOT AVAILABLE'));

      if (!sys.epaperApiVersion) {
        logger.warn('webapis.epaper not detected — running in non-epaper mode (emulator/dev?)');
      }

      await this.requestPairingCode(deviceInfo);
    } catch (error) {
      logger.error('Pairing init failed:', error && error.message);
      this.showError('Pairing failed', (error && error.message) || String(error));
    }
  },

  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  async requestPairingCode(deviceInfo) {
    try {
      this._setText('pairing-status', 'Requesting pairing code...');
      const response = await API.requestPairing(deviceInfo);

      if (response && response.status === 'claimed' && response.deviceToken) {
        logger.info('Device already claimed for this DUID — resuming');
        this._setText('pairing-status', 'Device already paired. Resuming...');

        let workspaceName = '';
        let workspaceId = '';
        try {
          const ws = await API.getWorkspaceInfo(response.deviceToken);
          workspaceId = (ws.workspace && ws.workspace.id) || '';
          workspaceName = (ws.workspace && ws.workspace.name) || '';
        } catch (e) {
          logger.warn('Workspace fetch on resume failed:', e && e.message);
        }

        this.onPaired({
          id: response.deviceId,
          deviceToken: response.deviceToken,
          name: workspaceName || localStorage.getItem('deviceName') || 'Nexari E-Paper',
          workspaceId: workspaceId,
        });
        return;
      }

      if (response && response.code) {
        this.pairingCode = response.code;
        logger.info('Pairing code:', this.pairingCode);
        this._setText('pairing-code', this.pairingCode);
        this._setText('pairing-status', 'Waiting for admin to confirm...');
        this.startPairingCheck();
      } else {
        throw new Error('No pairing code in response');
      }
    } catch (error) {
      logger.error('Failed to request pairing code:', error && error.message);
      this.showError('Failed to get pairing code', (error && error.message) || String(error));
    }
  },

  startPairingCheck() {
    this.stopPairingCheck();
    const self = this;
    this.pairingCheckInterval = setInterval(async function() {
      try {
        const result = await API.checkPairing(self.pairingCode);
        if (result.status === 'claimed') {
          logger.info('Pairing confirmed!');
          self.stopPairingCheck();

          let workspaceName = '';
          let workspaceId = '';
          try {
            const ws = await API.getWorkspaceInfo(result.deviceToken);
            workspaceId = (ws.workspace && ws.workspace.id) || '';
            workspaceName = (ws.workspace && ws.workspace.name) || '';
          } catch (e) {
            logger.warn('Workspace fetch failed:', e && e.message);
          }

          self.onPaired({
            id: result.deviceId,
            deviceToken: result.deviceToken,
            name: workspaceName || 'Nexari E-Paper',
            workspaceId: workspaceId,
          });
        }
      } catch (error) {
        logger.warn('Pairing check failed:', error && error.message);
      }
    }, CONFIG.PAIRING_CHECK_INTERVAL);
  },

  stopPairingCheck() {
    if (this.pairingCheckInterval) {
      clearInterval(this.pairingCheckInterval);
      this.pairingCheckInterval = null;
    }
  },

  onPaired(device) {
    logger.info('E-Paper device paired:', device.id);

    localStorage.setItem('deviceId', device.id);
    localStorage.setItem('deviceToken', device.deviceToken);
    localStorage.setItem('deviceName', device.name);
    localStorage.setItem('workspaceId', device.workspaceId || '');
    localStorage.setItem('isPaired', 'true');

    logger.setDevice(device.id);

    // Hand off to runtime (Phase 1 will replace this stub with real renderer + cache)
    if (window.EpaperApp && typeof window.EpaperApp.startRuntime === 'function') {
      window.EpaperApp.startRuntime(device);
    } else {
      logger.warn('EpaperApp.startRuntime not available — pairing complete but no runtime');
    }
  },

  showError(title, message) {
    const t = document.getElementById('error-title');
    const m = document.getElementById('error-message');
    if (t) t.textContent = title;
    if (m) m.textContent = message;
    document.getElementById('error-screen').classList.remove('hidden');
    document.getElementById('pairing-screen').classList.add('hidden');
    document.getElementById('player-screen').classList.add('hidden');
  },
};

// Retry button
const _retryBtn = document.getElementById('retry-button');
if (_retryBtn) _retryBtn.addEventListener('click', function() { location.reload(); });
