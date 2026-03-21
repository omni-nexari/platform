// API Helper Functions

window.API = {
  // Request pairing code
  async requestPairing(deviceInfo) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/request-pairing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceInfo })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error('Failed to request pairing:', error);
      throw error;
    }
  },

  // Check if pairing code has been confirmed
  async checkPairing(code) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/check-pairing/${code}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error('Failed to check pairing:', error);
      throw error;
    }
  },

  // Claim device by serial number (auto-pairing)
  async claimSerial(serialNumber, deviceInfo) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/claim-serial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber, deviceInfo })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error('Failed to claim serial:', error);
      throw error;
    }
  },

  // Send heartbeat
  async heartbeat(deviceId) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/${deviceId}/heartbeat`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.warn('Heartbeat failed:', error);
      throw error;
    }
  },

  // Send telemetry data
  async sendTelemetry(deviceId, telemetry) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/${deviceId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telemetry)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.warn('Telemetry failed:', error);
      throw error;
    }
  },

  // Send remote log event(s)
  async sendLog(deviceId, logs) {
    const body = Array.isArray(logs) ? logs : [logs];
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/${deviceId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      // Avoid recursive logging; surface once
      console.warn('[REMOTE-LOG] failed:', (error && error.message) || error);
      throw error;
    }
  },

  // Get pending commands
  async getCommands(deviceId) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/${deviceId}/commands`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.warn('Failed to get commands:', error);
      throw error;
    }
  },

  // Get current playlist/content
  async getCurrentContent(deviceId) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/${deviceId}/current-content`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.content || null;
    } catch (error) {
      logger.warn('Failed to get current content:', error);
      throw error;
    }
  },

  // Get specific content by ID
  async getContent(contentId) {
    try {
      const response = await fetch(`${CONFIG.API_BASE}/devices/content/${contentId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error('Failed to get content:', error);
      throw error;
    }
  }
};
