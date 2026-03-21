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

    try {
      // Get device info
      const systemInfo = await Telemetry.getSystemInfo();
      const deviceInfo = {
        model: systemInfo.model,
        realModel: (systemInfo.systemConfig && systemInfo.systemConfig.realModel) || systemInfo.realModel || null,
        tvName: systemInfo.tvName || null,
        manufacturer: systemInfo.manufacturer,
        platform: systemInfo.platform,
        serialNumber: systemInfo.serialNumber,
        firmwareVersion: systemInfo.firmwareVersion,
        capabilities: systemInfo.capabilities
      };
      
      // Display device info on pairing screen - prefer realModel over internal model
      const displayModel = (systemInfo.systemConfig && systemInfo.systemConfig.realModel) || deviceInfo.model;
      document.getElementById('device-model').textContent = `Model: ${displayModel}`;
      
      if (systemInfo.ipAddress) {
        document.getElementById('device-ip').textContent = `IP: ${systemInfo.ipAddress}`;
      }
      if (systemInfo.serialNumber) {
        document.getElementById('device-serial').textContent = `Serial: ${systemInfo.serialNumber}`;
      }
      if (systemInfo.panelType) {
        document.getElementById('device-panel').textContent = `Panel: ${systemInfo.panelType}`;
      }

      // Manual pairing only (serial auto-claim removed)
      await this.requestPairingCode(deviceInfo);
      
    } catch (error) {
      logger.error('Pairing initialization failed:', error);
      this.showError('Failed to initialize pairing', error.message);
    }
  },

  // Request pairing code from backend
  async requestPairingCode(deviceInfo) {
    try {
      document.getElementById('pairing-status').textContent = 'Requesting pairing code...';
      
      const response = await API.requestPairing(deviceInfo);
      
      if (response.pairingCode) {
        this.pairingCode = response.pairingCode;
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
        
        if (result.paired) {
          logger.info('Pairing confirmed!');
          this.stopPairingCheck();
          this.onPaired(result.device);
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
    localStorage.setItem('deviceName', device.name);
    localStorage.setItem('workspaceId', device.workspaceId);
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
