// Device Pairing Module

// ─── Connection Settings UI ───────────────────────────────────────────────────
window.PairingSettings = {
  _open: false,

  init() {
    const apiInput = document.getElementById('input-api-base');
    const wsInput  = document.getElementById('input-ws-url');
    if (apiInput) apiInput.value = CONFIG.API_BASE;
    if (wsInput)  wsInput.value  = CONFIG.WS_URL || '';

    // Auto-derive WS URL when API URL changes
    if (apiInput && wsInput) {
      apiInput.addEventListener('input', () => {
        try {
          const u = new URL(apiInput.value.trim());
          wsInput.value = (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host;
        } catch (_) { /* leave WS field alone if URL not yet valid */ }
      });
    }
  },

  toggle() {
    this._open = !this._open;
    const panel = document.getElementById('conn-settings-panel');
    const arrow = document.getElementById('conn-settings-arrow');
    const toggle = document.getElementById('conn-settings-toggle');
    if (panel) panel.classList.toggle('hidden', !this._open);
    if (arrow) arrow.innerHTML = this._open ? '&#9650;' : '&#9660;';
    if (toggle) toggle.style.borderRadius = this._open ? '12px 12px 0 0' : '12px';
    if (this._open) {
      const inp = document.getElementById('input-api-base');
      if (inp) inp.focus();
    }
  },

  apply() {
    var _apiEl = document.getElementById('input-api-base');
    const apiRaw = (_apiEl ? _apiEl.value : '').trim().replace(/\/$/, '');
    var _wsEl = document.getElementById('input-ws-url');
    const wsRaw  = (_wsEl ? _wsEl.value : '').trim().replace(/\/$/, '');
    const msg    = document.getElementById('conn-settings-msg');

    try { new URL(apiRaw); } catch (_) {
      if (msg) { msg.style.color = '#ff4466'; msg.textContent = 'Invalid API URL — must be http://… or https://…'; }
      return;
    }

    localStorage.setItem('PLAYER_API_BASE', apiRaw);
    if (wsRaw) localStorage.setItem('PLAYER_WS_URL', wsRaw);
    else        localStorage.removeItem('PLAYER_WS_URL');

    // Update live CONFIG so the pairing request uses the new URL immediately
    CONFIG.API_BASE = apiRaw;
    CONFIG.WS_URL   = wsRaw || apiRaw.replace(/^http/, 'ws').replace(/\/api\/v1.*$/, '');

    if (msg) { msg.style.color = ''; msg.textContent = 'Saved — reconnecting…'; }
    setTimeout(() => location.reload(), 800);
  },

  reset() {
    // Clear server config
    localStorage.removeItem('PLAYER_API_BASE');
    localStorage.removeItem('PLAYER_WS_URL');
    // Clear ALL pairing state so device re-pairs from scratch
    localStorage.removeItem('isPaired');
    localStorage.removeItem('deviceId');
    localStorage.removeItem('deviceToken');
    localStorage.removeItem('deviceName');
    localStorage.removeItem('workspaceId');
    const msg = document.getElementById('conn-settings-msg');
    if (msg) { msg.style.color = ''; msg.textContent = 'Reset — will re-pair on reload…'; }
    setTimeout(() => location.reload(), 800);
  },
};

// ─── Pairing ──────────────────────────────────────────────────────────────────

window.Pairing = {
  pairingCheckInterval: null,
  pairingCode: null,

  // Show pairing screen
  showPairingScreen() {
    document.getElementById('pairing-screen').classList.remove('hidden');
    document.getElementById('player-screen').classList.add('hidden');
    document.getElementById('error-screen').classList.add('hidden');
  },

  // Initialize pairing process
  async init() {
    logger.info('Starting pairing process...');
    this.showPairingScreen();
    PairingSettings.init();

    // Show immediate placeholders — visible even if all async calls hang
    document.getElementById('pairing-status').textContent = 'Initializing...';
    document.getElementById('device-model').textContent   = 'Model: ...';
    document.getElementById('device-tvname').textContent  = 'Name: ...';
    document.getElementById('device-ip').textContent      = 'IP: ...';
    document.getElementById('pairing-code').textContent   = '......';

    // ── Step 1: gather device info with 5 s timeout ────────────────────────
    document.getElementById('pairing-status').textContent = 'Reading device info...';
    let systemInfo = {};
    try {
      systemInfo = (await Promise.race([
        Telemetry.getSystemInfo(),
        new Promise(function(resolve) { setTimeout(function() { resolve({}); }, 5000); })
      ])) || {};
      logger.info('Device info received');
    } catch (infoErr) {
      logger.warn('getSystemInfo failed, continuing with empty info:', infoErr);
    }

    const displayModel = (systemInfo.systemConfig && systemInfo.systemConfig.realModel)
      || systemInfo.model || 'N/A';
    document.getElementById('device-model').textContent   = 'Model: ' + displayModel;
    document.getElementById('device-tvname').textContent  = 'Name: ' + (systemInfo.tvName || 'N/A');
    document.getElementById('device-ip').textContent      = 'IP: ' + (systemInfo.ipAddress || 'N/A');

    logger.info('Device info — model:', displayModel,
      'ip:', systemInfo.ipAddress || 'N/A',
      'tvName:', systemInfo.tvName || 'N/A');

    // ── Step 2: request pairing code ──────────────────────────────────────
    document.getElementById('pairing-status').textContent = 'Connecting to server...';
    logger.info('Requesting pairing code from', CONFIG.API_BASE);

    const deviceInfo = {
      duid:            systemInfo.duid || systemInfo.serialNumber || null,
      model:           systemInfo.model || null,
      realModel:       (systemInfo.systemConfig && systemInfo.systemConfig.realModel) || systemInfo.realModel || null,
      tvName:          systemInfo.tvName || null,
      manufacturer:    systemInfo.manufacturer || null,
      platform:        systemInfo.platform || null,
      serialNumber:    systemInfo.serialNumber || null,
      firmwareVersion: systemInfo.firmwareVersion || null,
      capabilities:    systemInfo.capabilities || null,
    };

    try {
      await this.requestPairingCode(deviceInfo);
    } catch (error) {
      logger.error('Pairing initialization failed:', error);
      document.getElementById('pairing-status').textContent = 'ERROR: ' + (error.message || error);
    }
  },

  // Request pairing code from backend
  async requestPairingCode(deviceInfo) {
    try {
      document.getElementById('pairing-status').textContent = 'Requesting pairing code...';
      
      const response = await API.requestPairing(deviceInfo);

      if (response && response.status === 'claimed' && response.deviceToken) {
        logger.info('Device already claimed for this DUID, resuming existing pairing');
        document.getElementById('pairing-status').textContent = 'Device already paired. Resuming...';

        let workspaceName = '';
        let workspaceId = '';
        try {
          const wsData = await API.getWorkspaceInfo(response.deviceToken);
          workspaceId = (wsData.workspace && wsData.workspace.id) || '';
          workspaceName = (wsData.workspace && wsData.workspace.name) || '';
        } catch (error) {
          logger.warn('Could not fetch workspace info for existing pairing:', error);
        }

        this.onPaired({
          id: response.deviceId,
          deviceToken: response.deviceToken,
          name: workspaceName || localStorage.getItem('deviceName') || 'SBB Player',
          workspaceId,
        });
        return;
      }
      
      if (response.code) {
        this.pairingCode = response.code;
        logger.info('Received pairing code:', this.pairingCode);
        
        // Display pairing code
        document.getElementById('pairing-code').textContent = this.pairingCode;
        document.getElementById('pairing-status').textContent = 'Waiting for admin to confirm...';
        
        // Start polling for pairing confirmation
        this.startPairingCheck();
      } else {
        throw new Error('No pairing code received');
      }
      
    } catch (error) {
      logger.error('Failed to request pairing code:', error);
      this.showError('Failed to get pairing code', error.message);
    }
  },

  // Start checking if pairing has been confirmed
  startPairingCheck() {
    this.stopPairingCheck(); // Clear any existing interval
    
    this.pairingCheckInterval = setInterval(async () => {
      try {
        const result = await API.checkPairing(this.pairingCode);

        if (result.status === 'claimed') {
          logger.info('Pairing confirmed!');
          this.stopPairingCheck();
          // Fetch workspace info to get workspaceId and populate device name
          const token = result.deviceToken;
          let workspaceName = '';
          let workspaceId = '';
          try {
            const wsData = await API.getWorkspaceInfo(token);
            workspaceId = (wsData.workspace && wsData.workspace.id) || '';
            workspaceName = (wsData.workspace && wsData.workspace.name) || '';
          } catch (e) {
            logger.warn('Could not fetch workspace info:', e);
          }
          this.onPaired({
            id: result.deviceId,
            deviceToken: token,
            name: workspaceName || 'SBB Player',
            workspaceId,
          });
        }
      } catch (error) {
        logger.warn('Pairing check failed:', error);
      }
    }, CONFIG.PAIRING_CHECK_INTERVAL);
  },

  // Stop pairing check interval
  stopPairingCheck() {
    if (this.pairingCheckInterval) {
      clearInterval(this.pairingCheckInterval);
      this.pairingCheckInterval = null;
    }
  },

  // Called when device is successfully paired
  onPaired(device) {
    logger.info('Device paired successfully:', device);
    
    // Save device credentials
    localStorage.setItem('deviceId', device.id);
    localStorage.setItem('deviceToken', device.deviceToken);
    localStorage.setItem('deviceName', device.name);
    localStorage.setItem('workspaceId', device.workspaceId || '');
    localStorage.setItem('isPaired', 'true');
    
    // Debug logging
    logger.debug('Checking Player availability...');
    logger.debug('window.Player exists:', typeof window.Player);
    logger.debug('window.Player.init exists:', typeof (window.Player && window.Player.init));
    
    // Send initial telemetry
    Telemetry.send(device.id).then(() => {
      logger.info('Initial telemetry sent');
      
      // Start the player after telemetry
      if (window.Player && typeof window.Player.init === 'function') {
        logger.info('Starting player...');
        window.Player.init(device);
      } else {
        logger.error('Player not available!');
        logger.error('window.Player:', window.Player);
      }
    }).catch(error => {
      logger.warn('Initial telemetry failed, starting player anyway:', error);
      
      // Start player even if telemetry fails
      if (window.Player && typeof window.Player.init === 'function') {
        logger.info('Starting player...');
        window.Player.init(device);
      } else {
        logger.error('Player not available!');
        logger.error('window.Player:', window.Player);
      }
    });
  },

  // Show error screen
  showError(title, message) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-screen').classList.remove('hidden');
    document.getElementById('pairing-screen').classList.add('hidden');
    document.getElementById('player-screen').classList.add('hidden');
  }
};

// Retry button handler
var _retryBtn = document.getElementById('retry-button');
if (_retryBtn) { _retryBtn.addEventListener('click', function() {
  location.reload();
}); }
