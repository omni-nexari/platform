// Telemetry Collection Module

window.Telemetry = {
  _systemInfoCache: { value: null, fetchedAt: 0 },
  _systemInfoInFlight: null,
  _systemInfoCacheTtlMs: 30 * 1000,
  _systemInfoMinRefreshIntervalMs: 10 * 1000,
  _lastLoggedModel: null,
  runtime: {
    iptv: {
      url: null,
      protocol: null,
      streamType: null,
      bufferingEvents: 0,
      lastError: null,
    },
    castReady: null,
    ottStatus: null,
    cloneStatus: null,
  },
  // Map Samsung numeric connection type codes to readable strings
  mapConnectionType(value) {
    const typeMap = {
      0: 'DISCONNECTED',
      1: 'WIFI',
      2: 'ETHERNET',
      3: 'OTHER',
    };
    return typeMap.hasOwnProperty(value) ? typeMap[value] : String(value);
  },

  // Helper to promisify tizen.systeminfo.getPropertyValue
  // 2-second timeout so a missing/broken property never hangs the whole chain
  getPropertyAsync(property) {
    return new Promise(function(resolve) {
      var timer = setTimeout(function() { resolve(null); }, 2000);
      try {
        tizen.systeminfo.getPropertyValue(
          property,
          function(val) { clearTimeout(timer); resolve(val); },
          function(error) {
            clearTimeout(timer);
            try { logger.warn('Failed to get ' + property + ':', error); } catch(e) {}
            resolve(null);
          }
        );
      } catch (error) {
        clearTimeout(timer);
        try { logger.warn('Exception getting ' + property + ':', error); } catch(e) {}
        resolve(null);
      }
    });
  },

  // Get full system info for backend
  async getSystemInfo(forceRefresh = false) {
    const self = (typeof window !== 'undefined' && window.Telemetry) ? window.Telemetry : this;
    const now = Date.now();

    // Always dedupe concurrent callers (even if a truthy arg is passed accidentally).
    if (self._systemInfoInFlight) {
      return self._systemInfoInFlight;
    }

    const cached = (self._systemInfoCache && self._systemInfoCache.value);
    const fetchedAt = (self._systemInfoCache && self._systemInfoCache.fetchedAt) || 0;
    const ageMs = fetchedAt ? (now - fetchedAt) : Number.POSITIVE_INFINITY;

    // Prefer cached values within TTL.
    // Also avoid tight refresh loops when callers pass an event object or other truthy arg.
    if (cached) {
      if (ageMs < self._systemInfoCacheTtlMs) {
        return cached;
      }
      if (forceRefresh && ageMs < self._systemInfoMinRefreshIntervalMs) {
        return cached;
      }
    }

    self._systemInfoInFlight = (async () => {
      try {
        logger.debug('Collecting system telemetry...');

        const [build, display, network, storage, memory, cpu, locale, wifiNetworkInfo, ethernetNetworkInfo] = await Promise.all([
        self.getPropertyAsync('BUILD'),
        self.getPropertyAsync('DISPLAY'),
        self.getPropertyAsync('NETWORK'),
        self.getPropertyAsync('STORAGE'),
        self.getPropertyAsync('MEMORY'),
        self.getPropertyAsync('CPU'),
        self.getPropertyAsync('LOCALE'),
        self.getPropertyAsync('WIFI_NETWORK'),
        self.getPropertyAsync('ETHERNET_NETWORK')
      ]);

      // Get DUID and model from multiple sources
      let duid = null;
      let model = null;
      let serialNumber = null;
      let softwareVersion = null; // webapis.productinfo.getFirmware() — user-visible "Software Version"
      let serialAttempts = [];
      
      // Try webapis productinfo first (Samsung specific - most reliable)
      try {
        if (typeof webapis !== 'undefined' && webapis.productinfo) {
          if (typeof webapis.productinfo.getDuid === 'function') {
            duid = webapis.productinfo.getDuid();
          }
          if (typeof webapis.productinfo.getModel === 'function') {
            model = webapis.productinfo.getModel();
          }
          if (typeof webapis.productinfo.getFirmware === 'function') {
            try {
              softwareVersion = webapis.productinfo.getFirmware();
              logger.debug('Software version from productinfo.getFirmware:', softwareVersion);
            } catch (e) {
              logger.debug('productinfo.getFirmware not available:', e.message);
            }
          }
          if (typeof webapis.productinfo.getSerialNumber === 'function') {
            try {
              serialNumber = webapis.productinfo.getSerialNumber();
              serialAttempts.push('productinfo.getSerialNumber');
            } catch (e) {
              logger.debug('Serial number not available');
            }
          }
        }
      } catch (error) {
        logger.debug('webapis.productinfo error:', error.message);
      }
      
      // Try tvinfo API as fallback
      try {
        if (typeof tizen !== 'undefined' && tizen.tvinfo && typeof tizen.tvinfo.getVersion === 'function') {
          const tvVersion = tizen.tvinfo.getVersion();
          duid = duid || tvVersion.duid || null;
          model = model || tvVersion.model || null;
        }
        if (!serialNumber && typeof tizen !== 'undefined' && tizen.tvinfo && typeof tizen.tvinfo.getDeviceId === 'function') {
          try {
            serialNumber = tizen.tvinfo.getDeviceId();
            serialAttempts.push('tvinfo.getDeviceId');
          } catch (e) {
            logger.debug('tvinfo.getDeviceId not available');
          }
        }
      } catch (error) {
        logger.debug('tvinfo.getVersion not available');
      }

      // Try systemcontrol if exposed (B2B)
      try {
        if (!serialNumber && typeof webapis !== 'undefined' && webapis.systemcontrol && typeof webapis.systemcontrol.getSerialNumber === 'function') {
          serialNumber = webapis.systemcontrol.getSerialNumber();
          serialAttempts.push('systemcontrol.getSerialNumber');
        }
      } catch (e) {
        logger.debug('systemcontrol.getSerialNumber not available');
      }

      // Try b2bcontrol.getSerialNumber as another fallback
      try {
        if (!serialNumber && typeof webapis !== 'undefined' && webapis.b2bcontrol && typeof webapis.b2bcontrol.getSerialNumber === 'function') {
          serialNumber = webapis.b2bcontrol.getSerialNumber();
          serialAttempts.push('b2bcontrol.getSerialNumber');
        }
      } catch (e) {
        logger.debug('b2bcontrol.getSerialNumber not available');
      }

      // Fallback to BUILD info
      model = model || (build && build.model) || 'Unknown TV';
      serialNumber = serialNumber || (build && build.serialNumber) || null;

      // Log serial attempts for debugging on device (non-fatal)
      if (!serialNumber) {
        try {
          const productKeys = typeof webapis !== 'undefined' && webapis.productinfo ? Object.keys(webapis.productinfo) : [];
          logger.debug('Serial not found. Tried:', serialAttempts, 'productinfo keys:', productKeys);
        } catch (_) {
          // ignore
        }
      }
      
      if (self._lastLoggedModel !== model) {
        logger.info('Device model detected:', model);
        self._lastLoggedModel = model;
      }
      logger.debug('Device identification:', { duid, model, serialNumber });
      
      // Detect device type from model number
      const deviceType = self.detectDeviceType(model);
      
      // Helper for safe Samsung API calls
      const networkApi = typeof webapis !== 'undefined' ? webapis.network : null;

      // Probe once — error 18 (NetworkError) means the service isn't ready on this firmware.
      // If the probe fails, skip all webapis.network calls to avoid spamming the console.
      let networkApiReady = false;
      if (networkApi) {
        try {
          networkApi.getActiveConnectionType();
          networkApiReady = true;
        } catch (e) {
          logger.debug('webapis.network not ready (code ' + ((e && e.code) || e) + '), skipping network API calls');
        }
      }

      const safeNetworkCall = (methodName, ...args) => {
        if (!networkApiReady) return null;
        try {
          if (typeof networkApi[methodName] === 'function') {
            return networkApi[methodName](...args);
          }
        } catch (err) {
          logger.debug(`webapis.network.${methodName} failed (code ${(err && err.code) || err && err.message || err})`);
        }
        return null;
      };

      // Get MAC address from network info - try different property names
      let macAddress = null;
      if (network) {
        macAddress = network.macAddress || network.mac || network.hwaddr || null;
        // If still null, try to get from ipAddress info
        if (!macAddress && network.ipAddress) {
          try {
            // Some versions store it in a different structure
            const networkInfo = await self.getPropertyAsync('NETWORK');
            if (networkInfo && Array.isArray(networkInfo)) {
              macAddress = (networkInfo[0] && networkInfo[0].mac) || (networkInfo[0] && networkInfo[0].macAddress) || null;
            }
          } catch (e) {
            logger.debug('Could not extract MAC from network array');
          }
        }
      }

      if (!macAddress && wifiNetworkInfo) {
        macAddress = wifiNetworkInfo.macAddress || wifiNetworkInfo.mac || null;
      }
      if (!macAddress && ethernetNetworkInfo) {
        macAddress = ethernetNetworkInfo.macAddress || ethernetNetworkInfo.mac || null;
      }
      
      // Try Samsung webapis.network if MAC still not found
      if (!macAddress && networkApiReady) {
        macAddress = safeNetworkCall('getMac') || safeNetworkCall('getEthernetMac');
      }
      
      // Get network connectivity status
      let networkStatus = 'unknown';
      let ipAddress = (network && network.ipAddress) || (wifiNetworkInfo && wifiNetworkInfo.ipAddress) || (ethernetNetworkInfo && ethernetNetworkInfo.ipAddress) || 'Unknown';
      let wifiSsid = (wifiNetworkInfo && wifiNetworkInfo.ssid) || null;
      let gateway = (network && network.gateway) || (network && network.gatewayAddress) || (wifiNetworkInfo && wifiNetworkInfo.gateway) || (ethernetNetworkInfo && ethernetNetworkInfo.gateway) || null;
      let subnetMask = (network && network.subnetMask) || (network && network.subnet) || (wifiNetworkInfo && wifiNetworkInfo.subnetMask) || (ethernetNetworkInfo && ethernetNetworkInfo.subnetMask) || null;
      
      try {
        if (networkApiReady) {
          const isConnected = safeNetworkCall('isConnectedToGateway');
          if (typeof isConnected === 'boolean') {
            networkStatus = isConnected ? 'connected' : 'disconnected';
          }

          // getActiveConnectionType was already called successfully in the probe above
          const connType = safeNetworkCall('getActiveConnectionType');
          if (connType !== null && connType !== undefined) {
            if (typeof connType === 'number') {
              networkStatus = self.mapConnectionType(connType);
            } else {
              networkStatus = connType;
            }
          }

          const ipFromApi = safeNetworkCall('getIp');
          if (ipAddress === 'Unknown' && ipFromApi) {
            ipAddress = ipFromApi;
          }

          const gwFromApi = safeNetworkCall('getGateway');
          if (!gateway && gwFromApi) {
            gateway = gwFromApi;
          }

          const subnetFromApi = safeNetworkCall('getSubnetMask');
          if (!subnetMask && subnetFromApi) {
            subnetMask = subnetFromApi;
          }

          const wifiSsidFromApi = safeNetworkCall('getWiFiSsid');
          if (!wifiSsid && wifiSsidFromApi) {
            wifiSsid = wifiSsidFromApi;
          }
        }
      } catch (error) {
        logger.debug('Could not get network status from webapis.network');
      }
      
      // Log what webapis are actually available for debugging
      if (!macAddress && typeof webapis !== 'undefined') {
        logger.debug('Available webapis:', Object.keys(webapis));
        if (webapis.network && networkApiReady) {
          logger.debug('Available network methods:', Object.keys(webapis.network));
        }
      }

      // Detect panel type (FHD, UHD, 8K)
      let panelType = 'FHD';
      try {
        if (typeof webapis !== 'undefined' && webapis.productinfo) {
          if (typeof webapis.productinfo.is8KPanelSupported === 'function' && webapis.productinfo.is8KPanelSupported()) {
            panelType = '8K';
          } else if (typeof webapis.productinfo.isUHDAModel === 'function' && webapis.productinfo.isUHDAModel()) {
            panelType = 'UHD';
          } else if (typeof webapis.productinfo.isUdPanelSupported === 'function' && webapis.productinfo.isUdPanelSupported()) {
            panelType = 'UHD';
          }
        }
        // Fallback to resolution-based detection
        if (display && display.resolutionWidth >= 7680) {
          panelType = '8K';
        } else if (display && display.resolutionWidth >= 3840) {
          panelType = 'UHD';
        }
      } catch (e) {
        logger.debug('Panel type detection failed, using default:', panelType);
      }

      // Get Samsung system config
      let systemConfig = null;
      try {
        if (typeof webapis !== 'undefined' && webapis.productinfo && typeof webapis.productinfo.getSystemConfig === 'function') {
          systemConfig = {
              smartTVServerType: (webapis.productinfo.getSmartTVServerType && webapis.productinfo.getSmartTVServerType()) || null,
              realModel: (webapis.productinfo.getRealModel && webapis.productinfo.getRealModel()) || null,
              localSet: (webapis.productinfo.getLocalSet && webapis.productinfo.getLocalSet()) || null
          };
        }
      } catch (e) {
        logger.debug('System config not available');
      }

      // Detect supported codecs
      let supportedCodecs = { video: [], audio: [] };
      try {
        if (typeof webapis !== 'undefined' && webapis.systeminfo) {
          const videoCodecs = ['h264', 'h265', 'vp8', 'vp9', 'av1', 'mpeg4', 'mpeg2'];
          const audioCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'ac3', 'eac3'];
          
          videoCodecs.forEach(codec => {
            try {
                if (webapis.systeminfo.isSupportedVideoCodec && webapis.systeminfo.isSupportedVideoCodec(codec)) {
                supportedCodecs.video.push(codec.toUpperCase());
              }
            } catch (e) {}
          });
          
          audioCodecs.forEach(codec => {
            try {
                if (webapis.systeminfo.isSupportedAudioCodec && webapis.systeminfo.isSupportedAudioCodec(codec)) {
                supportedCodecs.audio.push(codec.toUpperCase());
              }
            } catch (e) {}
          });
        }
      } catch (e) {
        logger.debug('Codec detection failed');
      }

      // Get memory from direct tizen.systeminfo methods (more accurate than MEMORY property)
      let memoryTotal = null;
      let memoryFree = null;
      try {
        if (typeof tizen !== 'undefined' && tizen.systeminfo) {
          if (typeof tizen.systeminfo.getTotalMemory === 'function') {
            memoryTotal = tizen.systeminfo.getTotalMemory();
          }
          if (typeof tizen.systeminfo.getAvailableMemory === 'function') {
            memoryFree = tizen.systeminfo.getAvailableMemory();
          }
        }
      } catch (e) {
        logger.debug('Direct memory methods unavailable, falling back to MEMORY property:', e.message);
      }
      // Fallback to MEMORY property if direct methods unavailable
      if (memoryTotal == null && memory) {
        memoryTotal = (memory.availableCapacity != null) ? memory.availableCapacity * 2 : null; // Rough estimate
      }
      if (memoryFree == null && memory) {
        memoryFree = memory.availableCapacity || null;
      }

      // Get device uptime from tizen.systeminfo.getDeviceUptime()
      let deviceUptime = null;
      try {
        if (typeof tizen !== 'undefined' && tizen.systeminfo && typeof tizen.systeminfo.getDeviceUptime === 'function') {
          deviceUptime = tizen.systeminfo.getDeviceUptime();
        }
      } catch (e) {
        logger.debug('Device uptime not available:', e.message);
      }

      // Calculate runtime uptime (time since player started) as fallback
      const uptime = deviceUptime != null ? deviceUptime : Math.floor(performance.now() / 1000);

      // Get power state
      let powerState = 'ON';
      try {
        if (typeof webapis !== 'undefined' && webapis.remotepower && typeof webapis.remotepower.getPowerState === 'function') {
          powerState = webapis.remotepower.getPowerState() || 'ON';
        }
      } catch (e) {
        logger.debug('Power state not available');
      }

      // Try to get a friendly device name (may not be supported on all firmwares)
      let tvName =
        safeNetworkCall('getTVName') ||
        safeNetworkCall('getTVname') ||
        safeNetworkCall('getDeviceName') ||
        safeNetworkCall('getFriendlyName') ||
        safeNetworkCall('getHostName') ||
        null;

      if (!tvName) {
        try {
          if (typeof webapis !== 'undefined' && webapis.productinfo && typeof webapis.productinfo.getSystemConfig === 'function') {
            tvName =
              webapis.productinfo.getSystemConfig('DeviceName') ||
              webapis.productinfo.getSystemConfig('TVName') ||
              null;
          }
        } catch (_) {
          // ignore
        }
      }

      if (typeof tvName === 'string') {
        tvName = tvName.trim() || null;
      }

      if (!tvName && typeof webapis !== 'undefined' && webapis.network) {
        try {
          logger.debug('TV name API not available. network methods:', Object.keys(webapis.network));
        } catch (_) {
          // ignore
        }
      }

      const systemInfo = {
        // Unique Identifiers
        duid: duid,
        serialNumber: serialNumber,
        macAddress: macAddress,
        
        // Device Profile
        model: model,
        manufacturer: (build && build.manufacturer) || 'Samsung',
        platform: 'TIZEN',
        deviceType: deviceType, // HOSPITALITY, SIGNAGE, or CONSUMER
        firmwareVersion: softwareVersion || (build && build.buildVersion) || null,
        
        // Display
        resolution: display ? `${display.resolutionWidth}x${display.resolutionHeight}` : null,
        brightness: (display && display.brightness) || null,
        panelType: panelType,
        
        // Network - enhanced with Samsung Network API
        ipAddress: ipAddress,
        networkType: networkStatus,
        wifiSsid: wifiSsid,
        gateway: gateway,
        subnetMask: subnetMask,
        
        // Resources
        cpuLoad: (cpu && cpu.load) || null,
        memoryTotal: memoryTotal,
        memoryFree: memoryFree,
        memoryAvailable: memoryFree,
        storageTotal: (storage && storage.units && storage.units[0] && storage.units[0].capacity) || null,
        storageFree: (storage && storage.units && storage.units[0] && storage.units[0].availableCapacity) || null,
        
        // System
        uptime: uptime,
        deviceUptime: deviceUptime,
        powerState: powerState,
        systemConfig: systemConfig,
        realModel: (systemConfig && systemConfig.realModel) || null,
        supportedCodecs: supportedCodecs,
        
        // Locale
        locale: (locale && locale.language) || 'en-US',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        
        // Capabilities
        capabilities: {
          supports4K: display ? display.resolutionWidth >= 3840 : false,
          supportsWiFi: self.checkCapability('http://tizen.org/feature/network.wifi'),
          supportsBluetooth: self.checkCapability('http://tizen.org/feature/bluetooth'),
            supportsHospitality: typeof (webapis && webapis.tv && webapis.tv.hospitality) !== 'undefined',
          supportsCast: typeof (webapis && webapis.cast) !== 'undefined',
          supportsAVPlay: typeof (webapis && webapis.avplay) !== 'undefined',
          supportsDownloadAPI: typeof (tizen && tizen.download) !== 'undefined'
        },

        tvName: tvName || null,
      };

      logger.debug('System info collected:', systemInfo);

      self._systemInfoCache = {
        value: systemInfo,
        fetchedAt: Date.now(),
      };
      return systemInfo;
      
      } catch (error) {
        logger.error('Failed to collect system info:', error);
        return {
          model: 'Unknown',
          manufacturer: 'Samsung',
          platform: 'TIZEN',
          capabilities: {}
        };
      }
    })();

    try {
      return await self._systemInfoInFlight;
    } finally {
      self._systemInfoInFlight = null;
    }
  },

  // Lightweight resource snapshot for 30s heartbeat — avoids full getSystemInfo() overhead
  async getResourcesQuick() {
    let memoryFree = null;
    let memoryTotal = null;
    try {
      if (typeof tizen !== 'undefined' && tizen.systeminfo) {
        if (typeof tizen.systeminfo.getTotalMemory === 'function') memoryTotal = tizen.systeminfo.getTotalMemory();
        if (typeof tizen.systeminfo.getAvailableMemory === 'function') memoryFree = tizen.systeminfo.getAvailableMemory();
      }
    } catch (e) { /* unavailable */ }

    const [cpu, storage] = await Promise.all([
      this.getPropertyAsync('CPU'),
      this.getPropertyAsync('STORAGE'),
    ]);

    return {
      cpuLoad: (cpu && cpu.load != null) ? cpu.load : null,
      storageFreeBytes: (storage && storage.units && storage.units[0]) ? storage.units[0].availableCapacity : null,
      memoryFreeBytes: memoryFree,
      memoryTotalBytes: memoryTotal,
    };
  },

  // Detect device type from Samsung model number
  detectDeviceType(model) {
    if (!model || model === 'Unknown') return 'UNKNOWN';
    
    const modelUpper = model.toUpperCase();
    
    // Samsung Hospitality TV models start with HG, HE, or HN
    if (modelUpper.startsWith('HG') || modelUpper.startsWith('HE') || modelUpper.startsWith('HN')) {
      return 'HOSPITALITY';
    }
    
    // Samsung Signage/Display models start with LH, QM, QB, QH, QE, PM, or DB
    if (modelUpper.startsWith('LH') ||
        modelUpper.startsWith('QM') || 
        modelUpper.startsWith('QB') || 
        modelUpper.startsWith('QH') || 
        modelUpper.startsWith('QE') ||
        modelUpper.startsWith('PM') ||
        modelUpper.startsWith('DB') ||
        modelUpper.startsWith('DM')) {
      return 'SIGNAGE';
    }
    
    // Consumer TVs typically start with UA, UN, UE, QN, etc.
    if (modelUpper.startsWith('UA') || 
        modelUpper.startsWith('UN') || 
        modelUpper.startsWith('UE') ||
        modelUpper.startsWith('QN') ||
        modelUpper.startsWith('KU') ||
        modelUpper.startsWith('KS')) {
      return 'CONSUMER';
    }
    
    // Check if hospitality API is available as fallback
    try {
      if (typeof webapis !== 'undefined' && webapis.tv && webapis.tv.hospitality) {
        return 'HOSPITALITY';
      }
    } catch (e) {
      // Ignore
    }
    
    return 'UNKNOWN';
  },

  // Check device capability
  checkCapability(capability) {
    try {
      return tizen.systeminfo.getCapability(capability);
    } catch (error) {
      return false;
    }
  },

  // Send telemetry to backend
  async send(deviceId) {
    try {
      const systemInfo = await this.getSystemInfo();
      const deviceTimeMs = Date.now();
      
      const telemetryData = {
        duid: systemInfo.duid,
        macAddress: systemInfo.macAddress,
        ipAddress: systemInfo.ipAddress,
        serialNumber: systemInfo.serialNumber,
        model: systemInfo.model,
        manufacturer: systemInfo.manufacturer,
        platform: systemInfo.platform,
        deviceType: systemInfo.deviceType,
        resolution: systemInfo.resolution,
        brightness: systemInfo.brightness,
        cpuLoad: systemInfo.cpuLoad,
        memoryTotal: systemInfo.memoryTotal,
        memoryFree: systemInfo.memoryFree,
        storageTotal: systemInfo.storageTotal,
        storageFree: systemInfo.storageFree,
        networkType: systemInfo.networkType,
        wifiSsid: systemInfo.wifiSsid,
        gateway: systemInfo.gateway,
        subnetMask: systemInfo.subnetMask,
        locale: systemInfo.locale,
        timezone: systemInfo.timezone,
        firmwareVersion: systemInfo.firmwareVersion,
        systemConfig: systemInfo.systemConfig,
        deviceUptime: systemInfo.deviceUptime,

        // Clock/diagnostics
        deviceTimeMs,
        clockSource: 'javascript',

        // IPTV / Cast / OTT / Clone runtime signals
        iptv: this.runtime.iptv,
        castReady: this.runtime.castReady,
        ottStatus: this.runtime.ottStatus,
        cloneStatus: this.runtime.cloneStatus,
      };

      await API.sendTelemetry(deviceId, telemetryData);
      logger.info('Telemetry sent successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to send telemetry:', error);
      return false;
    }
  },

  updateIptvStats(patch) {
    this.runtime.iptv = Object.assign({}, this.runtime.iptv, patch);
  },
  setCastReady(value) {
    this.runtime.castReady = value;
  },
  setOttStatus(value) {
    this.runtime.ottStatus = value;
  },
  setCloneStatus(value) {
    this.runtime.cloneStatus = value;
  },

  // Get basic device info for pairing
  async getDeviceInfo() {
    try {
      const systemInfo = await this.getSystemInfo();
      
      return {
        model: systemInfo.model,
        manufacturer: systemInfo.manufacturer,
        platform: systemInfo.platform,
        serialNumber: systemInfo.serialNumber,
        firmwareVersion: systemInfo.firmwareVersion,
        capabilities: systemInfo.capabilities
      };
    } catch (error) {
      logger.error('Failed to get device info:', error);
      return {
        model: 'Unknown',
        manufacturer: 'Samsung',
        platform: 'TIZEN'
      };
    }
  }
};
