// Kiosk Health Reporting Module
// Sends periodic health snapshots to POST /pos/kiosk/heartbeat
// Uses Telemetry.getResourcesQuick() to read CPU, memory, storage via tizen.systeminfo
// Works for both kiosk and kitchen device types

window.KioskHealth = {
  _interval: null,
  _intervalMs: 30 * 1000,
  _deviceId: null,
  _deviceToken: null,

  start(deviceId, deviceToken) {
    this.stop();
    this._deviceId = deviceId;
    this._deviceToken = deviceToken;
    // Send first heartbeat immediately, then every 30s
    this._tick();
    this._interval = setInterval(() => this._tick(), this._intervalMs);
    logger.info('KioskHealth: started (interval=' + (this._intervalMs / 1000) + 's)');
  },

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  },

  async _tick() {
    try {
      const resources = await Telemetry.getResourcesQuick();

      // Pull firmware + uptime from cached full system info when available
      const cached = Telemetry._systemInfoCache && Telemetry._systemInfoCache.value;

      // Derive player version the same way api.js does
      var buildInfo = window.PLAYER_BUILD_INFO;
      var playerVersion = (buildInfo && (buildInfo.version + ' ' + buildInfo.buildId))
        || window.PLAYER_DEPLOY_VERSION
        || null;

      // Tizen OS version (e.g. "6.5") — read once and cache
      if (!this._platformVersion) {
        try {
          this._platformVersion = tizen.systeminfo.getCapability(
            'http://tizen.org/feature/platform.version'
          ) || null;
        } catch (_) { this._platformVersion = null; }
      }

      var payload = {
        cpuLoad: resources.cpuLoad,
        memoryFreeBytes: resources.memoryFreeBytes,
        memoryTotalBytes: resources.memoryTotalBytes,
        storageFreeBytes: resources.storageFreeBytes,
        deviceUptimeSec: cached ? (cached.deviceUptime || null) : null,
        firmwareVersion: this._platformVersion
          ? (cached ? (cached.firmwareVersion || null) : null)
            ? (cached.firmwareVersion + ' (Tizen ' + this._platformVersion + ')')
            : ('Tizen ' + this._platformVersion)
          : (cached ? (cached.firmwareVersion || null) : null),
        playerVersion: playerVersion,
        powerState: 'on',
      };

      var response = await fetch(CONFIG.API_BASE + '/pos/kiosk/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this._deviceToken,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn('KioskHealth: heartbeat HTTP ' + response.status);
      } else {
        logger.debug('KioskHealth: heartbeat sent ok');
      }
    } catch (error) {
      logger.warn('KioskHealth: heartbeat failed:', error && error.message ? error.message : String(error));
    }
  },
};
