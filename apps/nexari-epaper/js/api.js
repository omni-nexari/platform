// Nexari E-Paper — API client (image-only, no avplay/syncplay)

window.API = {
  // ── POST /devices/pair/request ────────────────────────────────────────────
  async requestPairing(deviceInfo) {
    const url = `${CONFIG.API_BASE}/devices/pair/request`;
    try {
      const body = {
        duid: deviceInfo.duid || deviceInfo.serialNumber || null,
        modelName: deviceInfo.realModel || deviceInfo.model || deviceInfo.modelName || null,
        modelCode: deviceInfo.modelCode || null,
        serialNumber: deviceInfo.serialNumber || null,
        firmwareVersion: deviceInfo.firmwareVersion || null,
        // E-paper extras (server schema accepts these as optional)
        kind: 'epaper',
        platform: 'tizen-epaper',
        panelW: deviceInfo.panelW || null,
        panelH: deviceInfo.panelH || null,
        orientation: deviceInfo.orientation || null,
        epaperApiVersion: deviceInfo.epaperApiVersion || null,
      };
      logger.info('[API] requestPairing → POST ' + url);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json(); // { status?, deviceId, code?, expiresAt?, deviceToken? }
    } catch (error) {
      const cause = (error && (error.cause || error.message)) || String(error);
      logger.error('Failed to request pairing (url=' + url + ', api_base=' + CONFIG.API_BASE + '):', cause);
      throw error;
    }
  },

  // ── GET /devices/pair/status?code=CODE ────────────────────────────────────
  async checkPairing(code) {
    try {
      const response = await fetch(
        `${CONFIG.API_BASE}/devices/pair/status?code=${encodeURIComponent(code)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json();
    } catch (error) {
      logger.error('Failed to check pairing:', error);
      throw error;
    }
  },

  // ── GET /devices/device/workspace (device-auth Bearer token) ─────────────
  async getWorkspaceInfo(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/workspace`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── GET /devices/device/schedule ──────────────────────────────────────────
  async getSchedule(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/schedule`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── GET /devices/device/epaper/policy (Phase 2) ──────────────────────────
  async getEpaperPolicy(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/epaper/policy`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  },
};
