// Nexari E-Paper — Telemetry (slim: device identity + panel + battery + epaper api)

window.Telemetry = {
  _systemInfoCache: null,
  _systemInfoFetchedAt: 0,
  _systemInfoTtlMs: 30 * 1000,

  getPropertyAsync(property) {
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(null); }, 2000);
      try {
        if (typeof tizen === 'undefined' || !tizen.systeminfo) { clearTimeout(timer); resolve(null); return; }
        tizen.systeminfo.getPropertyValue(
          property,
          function(val) { clearTimeout(timer); resolve(val); },
          function() { clearTimeout(timer); resolve(null); }
        );
      } catch (e) { clearTimeout(timer); resolve(null); }
    });
  },

  // Detect panel size + orientation from screen + Samsung product info
  detectPanel() {
    var w = (window.screen && window.screen.width) || window.innerWidth || 0;
    var h = (window.screen && window.screen.height) || window.innerHeight || 0;
    // Use the larger dimension as the long edge for classification
    var longEdge = Math.max(w, h);
    var shortEdge = Math.min(w, h);
    var orientation = (w >= h) ? 'landscape' : 'portrait';
    // Classify model by resolution. EM32DX2 = 2560×1440 (16:9), EM13DX1 = 1600×1200 (4:3). Tolerate ±80px for OSD/scaling.
    var model = 'unknown';
    if (Math.abs(longEdge - 2560) <= 80 && Math.abs(shortEdge - 1440) <= 80) model = 'EM32DX2';
    else if (Math.abs(longEdge - 1600) <= 80 && Math.abs(shortEdge - 1200) <= 80) model = 'EM13DX1';
    return { panelW: w, panelH: h, orientation: orientation, modelClass: model };
  },

  getEpaperApiVersion() {
    try {
      if (typeof webapis !== 'undefined' && webapis.epaper && typeof webapis.epaper.getVersion === 'function') {
        return webapis.epaper.getVersion();
      }
    } catch (e) { logger.warn('webapis.epaper.getVersion failed:', e && e.message); }
    return null;
  },

  async getSystemInfo(forceRefresh) {
    var now = Date.now();
    if (!forceRefresh && this._systemInfoCache && (now - this._systemInfoFetchedAt) < this._systemInfoTtlMs) {
      return this._systemInfoCache;
    }

    var results = await Promise.all([
      this.getPropertyAsync('BUILD'),
      this.getPropertyAsync('NETWORK'),
      this.getPropertyAsync('WIFI_NETWORK'),
      this.getPropertyAsync('ETHERNET_NETWORK'),
      this.getPropertyAsync('CPU'),
      this.getPropertyAsync('STORAGE'),
    ]);
    var build    = results[0];
    var network  = results[1];
    var wifi     = results[2];
    var ethernet = results[3];
    var cpu      = results[4];
    var storage  = results[5];

    // Memory — direct synchronous methods are more accurate than the MEMORY property
    var memoryTotal = null;
    var memoryFree  = null;
    try {
      if (typeof tizen !== 'undefined' && tizen.systeminfo) {
        if (typeof tizen.systeminfo.getTotalMemory === 'function')    memoryTotal = tizen.systeminfo.getTotalMemory();
        if (typeof tizen.systeminfo.getAvailableMemory === 'function') memoryFree  = tizen.systeminfo.getAvailableMemory();
      }
    } catch (e) {}

    // Device uptime in seconds
    var deviceUptimeSec = null;
    try {
      if (typeof tizen !== 'undefined' && tizen.systeminfo &&
          typeof tizen.systeminfo.getDeviceUptime === 'function') {
        deviceUptimeSec = tizen.systeminfo.getDeviceUptime();
      }
    } catch (e) {}

    var duid = null, model = null, realModel = null, serialNumber = null, firmwareVersion = null;
    try {
      if (typeof webapis !== 'undefined' && webapis.productinfo) {
        if (typeof webapis.productinfo.getDuid === 'function') duid = webapis.productinfo.getDuid();
        if (typeof webapis.productinfo.getModel === 'function') model = webapis.productinfo.getModel();
        if (typeof webapis.productinfo.getRealModel === 'function') realModel = webapis.productinfo.getRealModel();
        if (typeof webapis.productinfo.getFirmware === 'function') {
          try { firmwareVersion = webapis.productinfo.getFirmware(); } catch (e) {}
        }
        if (typeof webapis.productinfo.getSerialNumber === 'function') {
          try { serialNumber = webapis.productinfo.getSerialNumber(); } catch (e) {}
        }
      }
    } catch (e) {}

    if (!serialNumber) {
      try {
        if (typeof webapis !== 'undefined' && webapis.systemcontrol &&
            typeof webapis.systemcontrol.getSerialNumber === 'function') {
          serialNumber = webapis.systemcontrol.getSerialNumber();
        }
      } catch (e) {}
    }

    // ── webapis.network (Samsung Network API) ────────────────────────────
    // On some Tizen firmware getActiveConnectionType() throws before the stack is
    // fully initialised, but getMac() / getIp() still work.  Try each call
    // individually so a failure on one doesn't block the others.
    var networkApi = (typeof webapis !== 'undefined') ? webapis.network : null;
    var networkApiReady = false;
    if (networkApi) {
      try { networkApi.getActiveConnectionType(); networkApiReady = true; }
      catch (e) { logger.debug('[Telemetry] webapis.network not ready (code ' + (e && e.code) + ')'); }
    }
    var safeNet = function(method) {
      if (!networkApi) return null;
      try { if (typeof networkApi[method] === 'function') return networkApi[method]() || null; } catch (e) {}
      return null;
    };

    // MAC address: call getMac()/getEthernetMac() unconditionally (don't gate on
    // networkApiReady) then fall back to tizen.systeminfo property values.
    var macAddress = safeNet('getMac') || safeNet('getEthernetMac')
      || (wifi && (wifi.macAddress || wifi.mac))
      || (ethernet && (ethernet.macAddress || ethernet.mac))
      || (network && (network.macAddress || network.mac))
      || null;

    // Connection type: Samsung API gives a numeric code, map to readable string
    var connTypeMap = { 0: 'DISCONNECTED', 1: 'WIFI', 2: 'ETHERNET', 3: 'OTHER' };
    var connTypeRaw = networkApiReady ? safeNet('getActiveConnectionType') : null;
    var networkType = connTypeRaw !== null
      ? (connTypeMap[connTypeRaw] || String(connTypeRaw))
      : ((network && network.networkType) || null);

    // IP, SSID — prefer Samsung API, fall back to tizen.systeminfo
    var ipAddress = safeNet('getIp')
      || (wifi && wifi.ipAddress)
      || (ethernet && ethernet.ipAddress)
      || null;
    var wifiSsid = safeNet('getWiFiSsid') || (wifi && wifi.ssid) || null;
    var wifiStrength = (wifi && wifi.signalStrength) || null;

    // Timezone — Tizen reports an IANA string (e.g. "America/New_York")
    var timezone = null;
    try {
      if (typeof tizen !== 'undefined' && tizen.time &&
          typeof tizen.time.getLocalTimezone === 'function') {
        timezone = tizen.time.getLocalTimezone();
      }
    } catch (e) { logger.debug('[Telemetry] getLocalTimezone failed:', e && e.message); }

    var panel = this.detectPanel();
    var epaperApiVersion = this.getEpaperApiVersion();

    // Battery level — webapis.deviced.getBatteryCapacity() returns 0-100 integer.
    // Power source  — webapis.deviced.getBatteryPowerSource() → 'AC_CHARGER'|'USB_CHARGER'|'NO_CHARGER'
    var batteryPct = null;
    var batterySource = null;
    try {
      if (typeof webapis !== 'undefined' && webapis.deviced &&
          typeof webapis.deviced.getBatteryCapacity === 'function') {
        var bl = webapis.deviced.getBatteryCapacity();
        if (bl != null && !isNaN(bl)) {
          batteryPct = Math.round(Number(bl));
          logger.info('[Telemetry] battery: ' + batteryPct + '%');
        } else {
          logger.info('[Telemetry] getBatteryCapacity returned null/NaN');
        }
        if (typeof webapis.deviced.getBatteryPowerSource === 'function') {
          batterySource = webapis.deviced.getBatteryPowerSource();
          logger.info('[Telemetry] powerSource: ' + batterySource);
        }
      } else {
        logger.info('[Telemetry] webapis.deviced not available on this firmware');
      }
    } catch (e) { logger.info('[Telemetry] getBatteryCapacity threw: ' + (e && e.message)); }

    var info = {
      duid: duid,
      model: model || (build && build.model) || 'Unknown',
      realModel: realModel,
      serialNumber: serialNumber || (build && build.serialNumber) || null,
      firmwareVersion: firmwareVersion || (build && build.buildVersion) || null,
      manufacturer: (build && build.manufacturer) || 'Samsung',
      platform: 'tizen-epaper',
      ipAddress: ipAddress,
      macAddress: macAddress,
      networkType: networkType,
      wifiSsid: wifiSsid,
      wifiStrength: wifiStrength,
      // E-paper specific
      kind: 'epaper',
      panelW: panel.panelW,
      panelH: panel.panelH,
      orientation: panel.orientation,
      resolution: panel.panelW + 'x' + panel.panelH,
      panelType: panel.modelClass + ' ' + panel.panelW + 'x' + panel.panelH + ' (' + panel.orientation + ')',
      modelClass: panel.modelClass,
      epaperApiVersion: epaperApiVersion,
      batteryPct: batteryPct,
      batterySource: batterySource,
      batteryCharging: batterySource === 'AC_CHARGER' || batterySource === 'USB_CHARGER',
      // Resources (same field names as nexari-tizen so WS/DB handling is identical)
      cpuLoad: (cpu && cpu.load != null) ? cpu.load : null,
      storageFreeBytes: (storage && storage.units && storage.units[0]) ? storage.units[0].availableCapacity : null,
      memoryFreeBytes: memoryFree,
      memoryTotalBytes: memoryTotal,
      deviceUptimeSec: deviceUptimeSec,
      timezone: timezone,
      capabilities: {
        epaper: !!epaperApiVersion,
        avplay: false,
        syncplay: false,
        broadcast: false,
      },
    };

    this._systemInfoCache = info;
    this._systemInfoFetchedAt = now;

    // Log a parseable summary so DeviceDetailPage can show observed values
    // even before the first DB heartbeat round-trip completes.
    logger.info('System info collected: ' + JSON.stringify({
      macAddress: info.macAddress,
      resolution: info.resolution,
      ipAddress: info.ipAddress,
      networkType: info.networkType,
      wifiSsid: info.wifiSsid,
      timezone: info.timezone,
      firmwareVersion: info.firmwareVersion,
      realModel: info.realModel,
      panelType: info.panelType,
      batteryPct: info.batteryPct,
      batterySource: info.batterySource,
    }));

    return info;
  },

  // Sent over WS once paired
  async send(deviceId) {
    try {
      var info = await this.getSystemInfo(true);
      logger.debug('Telemetry sample:', JSON.stringify(info).slice(0, 400));
      return info;
    } catch (e) {
      logger.warn('Telemetry.send failed:', e && e.message);
      return null;
    }
  },
};
