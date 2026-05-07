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
    // Classify model by long edge (32"=2560, 13"=1600). Tolerate ±50px for OSD/scaling.
    var model = 'unknown';
    if (Math.abs(longEdge - 2560) <= 80 && Math.abs(shortEdge - 1440) <= 80) model = 'epaper-32';
    else if (Math.abs(longEdge - 1600) <= 80 && Math.abs(shortEdge - 1200) <= 80) model = 'epaper-13';
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

    var build = await this.getPropertyAsync('BUILD');
    var network = await this.getPropertyAsync('NETWORK');
    var wifi = await this.getPropertyAsync('WIFI_NETWORK');
    var ethernet = await this.getPropertyAsync('ETHERNET_NETWORK');

    var duid = null, model = null, serialNumber = null, firmwareVersion = null, realModel = null;
    try {
      if (typeof webapis !== 'undefined' && webapis.productinfo) {
        if (typeof webapis.productinfo.getDuid === 'function') duid = webapis.productinfo.getDuid();
        if (typeof webapis.productinfo.getModel === 'function') model = webapis.productinfo.getModel();
        if (typeof webapis.productinfo.getRealModel === 'function') realModel = webapis.productinfo.getRealModel();
        if (typeof webapis.productinfo.getFirmware === 'function') firmwareVersion = webapis.productinfo.getFirmware();
        if (typeof webapis.productinfo.getSerialNumber === 'function') {
          try { serialNumber = webapis.productinfo.getSerialNumber(); } catch (e) {}
        }
      }
    } catch (e) {}

    try {
      if (!serialNumber && typeof webapis !== 'undefined' && webapis.systemcontrol &&
          typeof webapis.systemcontrol.getSerialNumber === 'function') {
        serialNumber = webapis.systemcontrol.getSerialNumber();
      }
    } catch (e) {}

    var panel = this.detectPanel();
    var epaperApiVersion = this.getEpaperApiVersion();

    var ipAddress = (wifi && wifi.ipAddress) || (ethernet && ethernet.ipAddress) || null;
    var macAddress = (wifi && wifi.macAddress) || (ethernet && ethernet.macAddress) || null;
    var networkType = (network && network.networkType) || null;
    var wifiSsid = (wifi && wifi.ssid) || null;
    var wifiStrength = (wifi && wifi.signalStrength) || null;

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
      panelType: panel.modelClass + ' ' + panel.panelW + 'x' + panel.panelH + ' (' + panel.orientation + ')',
      modelClass: panel.modelClass,
      epaperApiVersion: epaperApiVersion,
      capabilities: {
        epaper: !!epaperApiVersion,
        avplay: false,
        syncplay: false,
        broadcast: false,
      },
    };

    this._systemInfoCache = info;
    this._systemInfoFetchedAt = now;
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
