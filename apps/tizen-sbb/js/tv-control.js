// Samsung TV hardware control wrapper

window.TVControl = {
  apis: {
    power: null,
    remotePower: null,
    hospitality: null,
    b2bControl: null,
    tvDisplayControl: null,
    audio: null,
    tvWindow: null,
    tvChannel: null,
    systemInfo: null,
    tvInputDevice: null,
    systemControl: null,
  },
  capabilities: {
    screenPower: false,
    remotePower: false,
    audio: false,
    tvWindow: false,
    channel: false,
    videoSourceList: false,
    hospitalityPower: false,
    b2bPanelPower: false,
    tvDisplayPower: false,
    virtualStandby: false,
    tvInputPower: false,
    systemControlPower: false,
  },

  init() {
    this.apis.power = typeof tizen !== 'undefined' && tizen.power ? tizen.power : null;
    this.apis.remotePower = typeof webapis !== 'undefined' ? webapis.remotepower || null : null;
    this.apis.hospitality = typeof webapis !== 'undefined' && webapis.tv ? webapis.tv.hospitality || null : null;
    this.apis.b2bControl = typeof b2bapis !== 'undefined' ? b2bapis.b2bcontrol || null : null;
    this.apis.tvDisplayControl = typeof webapis !== 'undefined' ? webapis.tvdisplaycontrol || null : null;
    this.apis.tvInputDevice = typeof webapis !== 'undefined' ? (webapis.tvinputdevice || webapis.tvinputdevice2 || null) : (typeof b2bapis !== 'undefined' ? b2bapis.tvinputdevice || null : null);
    this.apis.systemControl = typeof webapis !== 'undefined' && webapis.systemcontrol ? webapis.systemcontrol : null;
    this.apis.audio = typeof tizen !== 'undefined' && tizen.tvaudiocontrol ? tizen.tvaudiocontrol : (typeof webapis !== 'undefined' ? webapis.audiocontrol || null : null);
    this.apis.tvWindow = typeof tizen !== 'undefined' ? tizen.tvwindow || null : null;
    this.apis.tvChannel = typeof tizen !== 'undefined' ? tizen.tvchannel || null : null;
    this.apis.systemInfo = typeof tizen !== 'undefined' ? tizen.systeminfo || null : null;

    this.capabilities.screenPower = !!(this.apis.power && (
      typeof this.apis.power.setScreenState === 'function' ||
      typeof this.apis.power.request === 'function'
    ));
    this.capabilities.remotePower = !!(this.apis.remotePower && typeof this.apis.remotePower.powerOff === 'function');
    this.capabilities.virtualStandby = !!(this.apis.remotePower && (
      typeof this.apis.remotePower.getVirtualStandbyMode === 'function' ||
      typeof this.apis.remotePower.setVirtualStandbyMode === 'function'
    ));
    this.capabilities.tvInputPower = !!(this.apis.tvInputDevice && (typeof this.apis.tvInputDevice.setPowerOn === 'function' || typeof this.apis.tvInputDevice.setPowerState === 'function'));
    this.capabilities.systemControlPower = !!(this.apis.systemControl && (typeof this.apis.systemControl.setPowerOn === 'function' || typeof this.apis.systemControl.setPowerOnWithKey === 'function'));
    this.capabilities.hospitalityPower = !!(this.apis.hospitality && (
      typeof this.apis.hospitality.powerOff === 'function' ||
      typeof this.apis.hospitality.powerOn === 'function' ||
      typeof this.apis.hospitality.controlPower === 'function' ||
      typeof this.apis.hospitality.setPowerOn === 'function'
    ));
    this.capabilities.b2bPanelPower = !!(this.apis.b2bControl);
    this.capabilities.tvDisplayPower = !!(this.apis.tvDisplayControl && (
      typeof this.apis.tvDisplayControl.setPower === 'function' ||
      typeof this.apis.tvDisplayControl.setPowerState === 'function'
    ));
    this.capabilities.audio = !!(this.apis.audio && (typeof this.apis.audio.setVolume === 'function' || typeof this.apis.audio.setVolumeLevel === 'function'));
    this.capabilities.tvWindow = !!(this.apis.tvWindow && typeof this.apis.tvWindow.getSource === 'function');
    this.capabilities.channel = !!(this.apis.tvChannel && (typeof this.apis.tvChannel.tune === 'function' || typeof this.apis.tvChannel.tuneUp === 'function'));
    this.capabilities.videoSourceList = !!(this.apis.systemInfo && typeof this.apis.systemInfo.getPropertyValue === 'function');

    logger.info('[TVControl] Initialized capabilities:', JSON.stringify(this.capabilities));
    logger.info('[TVControl] Power API probe:', JSON.stringify(this.describePowerApis()));
  },

  describePowerApis() {
    const pickMethods = (api, names) => {
      if (!api) return [];
      return names.filter((name) => typeof api[name] === 'function');
    };

    return {
      namespaces: {
        tizenPower: !!this.apis.power,
        tvDisplayControl: !!this.apis.tvDisplayControl,
        b2bControl: !!this.apis.b2bControl,
        hospitality: !!this.apis.hospitality,
        remotePower: !!this.apis.remotePower,
        tvInputDevice: !!this.apis.tvInputDevice,
        systemControl: !!this.apis.systemControl,
      },
      methods: {
        tizenPower: pickMethods(this.apis.power, ['setScreenState', 'getScreenState', 'request', 'release']),
        tvDisplayControl: pickMethods(this.apis.tvDisplayControl, ['setPower', 'getPower', 'setPowerState', 'getPowerState']),
        b2bControl: (() => {
        if (!this.apis.b2bControl) return [];
        const obj = this.apis.b2bControl;
        const known = ['setPowerOff', 'setPanelMute', 'getPanelMuteStatus', 'setPanelMuteStatus', 'setStandby', 'getStandby', 'panelOff', 'panelOn', 'setPower', 'getPower', 'reboot', 'rebootDevice', 'setSystemReboot', 'shutdown', 'setPowerState', 'getPowerState', 'setDisplayOnOff', 'setDisplayBrightness'];
        const found = new Set(known.filter((n) => typeof obj[n] === 'function'));
        try { Object.getOwnPropertyNames(obj).forEach((n) => { if (typeof obj[n] === 'function') found.add(n); }); } catch (_) {}
        try { const p = Object.getPrototypeOf(obj); if (p && p !== Object.prototype) Object.getOwnPropertyNames(p).forEach((n) => { if (typeof obj[n] === 'function') found.add(n); }); } catch (_) {}
        return [...found];
      })(),
        hospitality: pickMethods(this.apis.hospitality, ['powerOff', 'powerOn', 'controlPower', 'setPowerOn', 'getPowerState']),
        remotePower: pickMethods(this.apis.remotePower, ['powerOff', 'powerOn', 'reboot', 'getPowerState', 'setPowerOnWithKey']),
        tvInputDevice: pickMethods(this.apis.tvInputDevice, ['setPowerOn', 'setPowerState']),
        systemControl: pickMethods(this.apis.systemControl, ['setPowerOn', 'setPowerOnWithKey', 'rebootDevice']),
      },
    };
  },

  isAvailable(feature) {
    return !!this.capabilities[feature];
  },

  powerOff(options = {}) {
    const power = this.apis.power;
    const b2b = this.apis.b2bControl;
    const display = this.apis.tvDisplayControl;
    const hosp = this.apis.hospitality;
    const remote = this.apis.remotePower;

    if (!this.capabilities.screenPower && !this.capabilities.tvDisplayPower && !this.capabilities.b2bPanelPower && !this.capabilities.hospitalityPower && !this.isAvailable('remotePower')) {
      logger.warn('[TVControl] Tizen power/TVDisplay/LFD panel/hospitality/remote power API unavailable:', JSON.stringify(this.describePowerApis()));
      return false;
    }

    try {
      if (this.capabilities.screenPower && power) {
        if (typeof power.setScreenState === 'function') {
          const attempts = ['SCREEN_OFF', 'SCREEN_DIM'];
          for (let i = 0; i < attempts.length; i += 1) {
            try {
              power.setScreenState(attempts[i]);
              logger.info('[TVControl] Screen off requested via tizen.power.setScreenState', attempts[i]);
              return true;
            } catch (error) {
              logger.warn('[TVControl] tizen.power.setScreenState power-off attempt failed:', attempts[i], (error && error.message) || error);
            }
          }
        }
        if (typeof power.request === 'function') {
          try {
            power.request('SCREEN', 'SCREEN_DIM');
            logger.info('[TVControl] Screen dim requested via tizen.power.request("SCREEN", "SCREEN_DIM")');
            return true;
          } catch (error) {
            logger.warn('[TVControl] tizen.power.request SCREEN_DIM failed:', (error && error.message) || error);
          }
        }
      }

      if (this.capabilities.tvDisplayPower && display && typeof display.setPower === 'function') {
        const attempts = [false, 'OFF', 0];
        for (let i = 0; i < attempts.length; i += 1) {
          try {
            display.setPower(attempts[i]);
            logger.info('[TVControl] Power off requested via tvdisplaycontrol.setPower', attempts[i]);
            return true;
          } catch (error) {
            logger.warn('[TVControl] tvdisplaycontrol.setPower power-off attempt failed:', attempts[i], (error && error.message) || error);
          }
        }
      }
      if (this.capabilities.tvDisplayPower && display && typeof display.setPowerState === 'function') {
        const attempts = ['SCREEN_OFF', 'OFF', false, 0];
        for (let i = 0; i < attempts.length; i += 1) {
          try {
            display.setPowerState(attempts[i]);
            logger.info('[TVControl] Power off requested via tvdisplaycontrol.setPowerState', attempts[i]);
            return true;
          } catch (error) {
            logger.warn('[TVControl] tvdisplaycontrol.setPowerState power-off attempt failed:', attempts[i], (error && error.message) || error);
          }
        }
      }

      if (this.capabilities.b2bPanelPower && b2b) {
        const b2bOff = [
          ['setPowerOff', []],
          ['panelOff', []],
          ['setDisplayOnOff', [false]],
          ['setPower', [false]],
          ['setPowerState', ['OFF']],
          ['shutdown', []],
        ];
        for (let i = 0; i < b2bOff.length; i += 1) {
          const [method, args] = b2bOff[i];
          if (typeof b2b[method] === 'function') {
            try {
              b2b[method](...args,
                () => logger.info('[TVControl] b2b panel off via', method),
                (e) => logger.warn('[TVControl] b2b panel off cb error', method, (e && e.message) || e),
              );
              logger.info('[TVControl] Power off requested via b2bcontrol.' + method);
              return true;
            } catch (e) {
              logger.warn('[TVControl] b2b.' + method + ' power-off failed:', (e && e.message) || e);
            }
          }
        }
        logger.warn('[TVControl] b2bControl present but no power-off method matched. Available methods:', JSON.stringify(this.describePowerApis().methods.b2bControl));
      }
      if (options.virtualStandby && remote && typeof remote.setVirtualStandbyMode === 'function') {
        this.setVirtualStandbyMode(true);
      }
      if (hosp) {
        if (typeof hosp.controlPower === 'function') {
          hosp.controlPower('POWER_OFF');
        } else if (typeof hosp.powerOff === 'function') {
          hosp.powerOff();
        } else if (typeof hosp.setPowerOn === 'function') {
          hosp.setPowerOn(false);
        }
      } else if (remote && typeof remote.powerOff === 'function') {
        remote.powerOff();
      }
      logger.info('[TVControl] Power off requested (hospitality-first)');
      return true;
    } catch (error) {
      logger.error('[TVControl] Power off failed:', (error && error.message) || error);
      return false;
    }
  },

  powerOn() {
    const power = this.apis.power;
    const b2b = this.apis.b2bControl;
    const display = this.apis.tvDisplayControl;
    const hosp = this.apis.hospitality;
    const remote = this.apis.remotePower;
    const tvInput = this.apis.tvInputDevice;
    const sys = this.apis.systemControl;

    if (!this.capabilities.screenPower && !this.capabilities.tvDisplayPower && !this.capabilities.b2bPanelPower && !this.capabilities.hospitalityPower && !this.isAvailable('remotePower') && !this.capabilities.tvInputPower && !this.capabilities.systemControlPower) {
      logger.warn('[TVControl] Tizen power/TVDisplay/LFD panel/hospitality/remote/tvInput/systemcontrol power API unavailable:', JSON.stringify(this.describePowerApis()));
      return false;
    }

    try {
      if (this.capabilities.screenPower && power) {
        if (typeof power.setScreenState === 'function') {
          try {
            power.setScreenState('SCREEN_ON');
            logger.info('[TVControl] Screen on requested via tizen.power.setScreenState("SCREEN_ON")');
            return true;
          } catch (error) {
            logger.warn('[TVControl] tizen.power.setScreenState("SCREEN_ON") failed:', (error && error.message) || error);
          }
        }
        if (typeof power.request === 'function') {
          const attempts = ['SCREEN_NORMAL', 'SCREEN_BRIGHT'];
          for (let i = 0; i < attempts.length; i += 1) {
            try {
              power.request('SCREEN', attempts[i]);
              logger.info('[TVControl] Screen on requested via tizen.power.request("SCREEN", state)', attempts[i]);
              return true;
            } catch (error) {
              logger.warn('[TVControl] tizen.power.request screen-on attempt failed:', attempts[i], (error && error.message) || error);
            }
          }
        }
      }

      if (this.capabilities.tvDisplayPower && display && typeof display.setPower === 'function') {
        const attempts = [true, 'ON', 1];
        for (let i = 0; i < attempts.length; i += 1) {
          try {
            display.setPower(attempts[i]);
            logger.info('[TVControl] Power on requested via tvdisplaycontrol.setPower', attempts[i]);
            return true;
          } catch (error) {
            logger.warn('[TVControl] tvdisplaycontrol.setPower power-on attempt failed:', attempts[i], (error && error.message) || error);
          }
        }
      }
      if (this.capabilities.tvDisplayPower && display && typeof display.setPowerState === 'function') {
        const attempts = ['SCREEN_ON', 'ON', true, 1];
        for (let i = 0; i < attempts.length; i += 1) {
          try {
            display.setPowerState(attempts[i]);
            logger.info('[TVControl] Power on requested via tvdisplaycontrol.setPowerState', attempts[i]);
            return true;
          } catch (error) {
            logger.warn('[TVControl] tvdisplaycontrol.setPowerState power-on attempt failed:', attempts[i], (error && error.message) || error);
          }
        }
      }

      if (this.capabilities.b2bPanelPower && b2b) {
        const b2bOn = [
          ['setPanelMuteStatus', [false]],
          ['panelOn', []],
          ['setDisplayOnOff', [true]],
          ['setPower', [true]],
          ['setPowerState', ['ON']],
        ];
        for (let i = 0; i < b2bOn.length; i += 1) {
          const [method, args] = b2bOn[i];
          if (typeof b2b[method] === 'function') {
            try {
              b2b[method](...args,
                () => logger.info('[TVControl] b2b panel on via', method),
                (e) => logger.warn('[TVControl] b2b panel on cb error', method, (e && e.message) || e),
              );
              logger.info('[TVControl] Power on requested via b2bcontrol.' + method);
              return true;
            } catch (e) {
              logger.warn('[TVControl] b2b.' + method + ' power-on failed:', (e && e.message) || e);
            }
          }
        }
        logger.warn('[TVControl] b2bControl present but no power-on method matched. Available methods:', JSON.stringify(this.describePowerApis().methods.b2bControl));
      }

      if (hosp) {
        if (typeof hosp.controlPower === 'function') {
          hosp.controlPower('POWER_ON');
          logger.info('[TVControl] Power on requested (hospitality controlPower)');
          return true;
        }
        if (typeof hosp.powerOn === 'function') {
          hosp.powerOn();
          logger.info('[TVControl] Power on requested (hospitality powerOn)');
          return true;
        }
        if (typeof hosp.setPowerOn === 'function') {
          hosp.setPowerOn(true);
          logger.info('[TVControl] Power on requested (hospitality setPowerOn)');
          return true;
        }
      }

      if (tvInput) {
        if (typeof tvInput.setPowerOn === 'function') {
          tvInput.setPowerOn({ powerOn: true });
          logger.info('[TVControl] Power on requested (tvinputdevice.setPowerOn)');
          return true;
        }
        if (typeof tvInput.setPowerState === 'function') {
          tvInput.setPowerState(true);
          logger.info('[TVControl] Power on requested (tvinputdevice.setPowerState)');
          return true;
        }
      }

      if (sys) {
        if (typeof sys.setPowerOn === 'function') {
          sys.setPowerOn(true);
          logger.info('[TVControl] Power on requested (systemcontrol.setPowerOn)');
          return true;
        }
        if (typeof sys.setPowerOnWithKey === 'function') {
          // Some firmware expects a key string; try both bool and key token
          try {
            sys.setPowerOnWithKey(true);
            logger.info('[TVControl] Power on requested (systemcontrol.setPowerOnWithKey:true)');
            return true;
          } catch (err) {
            logger.warn('[TVControl] systemcontrol.setPowerOnWithKey(true) failed, retrying with KEY_POWER');
            try {
              sys.setPowerOnWithKey('KEY_POWER');
              logger.info('[TVControl] Power on requested (systemcontrol.setPowerOnWithKey:"KEY_POWER")');
              return true;
            } catch (err2) {
              logger.warn('[TVControl] systemcontrol.setPowerOnWithKey("KEY_POWER") failed:', (err2 && err2.message) || err2);
            }
          }
        }
      }

      if (remote) {
        // Prefer explicit key-based wake if available
        if (typeof remote.setPowerOnWithKey === 'function') {
          try {
            remote.setPowerOnWithKey('KEY_POWER');
            logger.info('[TVControl] Power on requested (remotepower.setPowerOnWithKey:"KEY_POWER")');
            return true;
          } catch (err) {
            logger.warn('[TVControl] remotepower.setPowerOnWithKey failed:', (err && err.message) || err);
          }
        }
        if (typeof remote.powerOn === 'function') {
          remote.powerOn();
          logger.info('[TVControl] Power on requested (remotePower.powerOn)');
          return true;
        }
      }
      logger.warn('[TVControl] powerOn() not supported on this device');
      return false;
    } catch (error) {
      logger.error('[TVControl] Power on failed:', (error && error.message) || error);
      return false;
    }
  },

  rebootTv() {
    try {
      if (typeof webapis !== 'undefined' && webapis.systemcontrol && typeof webapis.systemcontrol.rebootDevice === 'function') {
        logger.info('[TVControl] Rebooting device via systemcontrol.rebootDevice');
        webapis.systemcontrol.rebootDevice();
        return true;
      }
      if (this.apis.remotePower && typeof this.apis.remotePower.reboot === 'function') {
        logger.info('[TVControl] Rebooting device via remotepower.reboot');
        this.apis.remotePower.reboot();
        return true;
      }
    } catch (error) {
      logger.error('[TVControl] Reboot failed:', (error && error.message) || error);
      return false;
    }
    logger.warn('[TVControl] Reboot API unavailable');
    return false;
  },

  getPowerState() {
    try {
      if (this.apis.power && typeof this.apis.power.getScreenState === 'function') {
        return this.apis.power.getScreenState();
      }
      if (this.apis.tvDisplayControl && typeof this.apis.tvDisplayControl.getPower === 'function') {
        return this.apis.tvDisplayControl.getPower();
      }
      if (this.apis.remotePower && typeof this.apis.remotePower.getPowerState === 'function') {
        return this.apis.remotePower.getPowerState();
      }
      if (this.apis.hospitality && typeof this.apis.hospitality.getPowerState === 'function') {
        return this.apis.hospitality.getPowerState();
      }
    } catch (error) {
      logger.debug('[TVControl] getPowerState failed:', (error && error.message) || error);
    }
    return null;
  },

  setVirtualStandbyMode(enabled) {
    if (!this.capabilities.virtualStandby) {
      return false;
    }

    try {
      if (this.apis.remotePower && typeof this.apis.remotePower.setVirtualStandbyMode === 'function') {
        this.apis.remotePower.setVirtualStandbyMode(!!enabled);
        logger.info('[TVControl] Virtual standby mode:', enabled ? 'ON' : 'OFF');
        return true;
      }
    } catch (error) {
      logger.warn('[TVControl] Failed to set virtual standby mode:', (error && error.message) || error);
      return false;
    }

    return false;
  },

  getVirtualStandbyMode() {
    if (!this.capabilities.virtualStandby) {
      return null;
    }

    try {
      if (this.apis.remotePower && typeof this.apis.remotePower.getVirtualStandbyMode === 'function') {
        return this.apis.remotePower.getVirtualStandbyMode();
      }
    } catch (error) {
      logger.warn('[TVControl] Failed to read virtual standby mode:', (error && error.message) || error);
    }

    return null;
  },

  getVirtualStandbyRebootTime() {
    if (!this.capabilities.virtualStandby) {
      return null;
    }

    try {
      if (this.apis.remotePower && typeof this.apis.remotePower.getVirtualStandbyRebootTime === 'function') {
        return this.apis.remotePower.getVirtualStandbyRebootTime();
      }
    } catch (error) {
      logger.warn('[TVControl] Failed to read virtual standby reboot time:', (error && error.message) || error);
    }

    return null;
  },

  setVirtualStandbyRebootTime(time) {
    if (!this.capabilities.virtualStandby) {
      return false;
    }

    try {
      if (this.apis.remotePower && typeof this.apis.remotePower.setVirtualStandbyRebootTime === 'function') {
        this.apis.remotePower.setVirtualStandbyRebootTime(time);
        logger.info('[TVControl] Virtual standby reboot time set to', time);
        return true;
      }
    } catch (error) {
      logger.warn('[TVControl] Failed to set virtual standby reboot time:', (error && error.message) || error);
    }

    return false;
  },

  getVolume() {
    if (!this.isAvailable('audio')) {
      return null;
    }

    const audio = this.apis.audio;

    try {
      if (typeof audio.getVolume === 'function') {
        return audio.getVolume();
      }
      if (typeof audio.getVolumeLevel === 'function') {
        return audio.getVolumeLevel();
      }
    } catch (error) {
      logger.warn('[TVControl] Failed to read volume:', (error && error.message) || error);
    }

    return null;
  },

  setVolume(level) {
    if (!this.isAvailable('audio')) {
      logger.warn('[TVControl] Audio API unavailable');
      return false;
    }

    const audio = this.apis.audio;
    const clamped = Math.max(0, Math.min(100, Math.round(Number(level))));

    try {
      if (typeof audio.setVolume === 'function') {
        audio.setVolume(clamped);
      } else if (typeof audio.setVolumeLevel === 'function') {
        audio.setVolumeLevel(clamped);
      } else if (typeof audio.setVolumeAsync === 'function') {
        audio.setVolumeAsync(clamped, () => logger.info('[TVControl] Volume set async')); // Tizen 7+ async variant
      } else {
        logger.warn('[TVControl] setVolume/setVolumeLevel not supported');
        return false;
      }
      logger.info('[TVControl] Volume set to', clamped);
      return true;
    } catch (error) {
      logger.error('[TVControl] Failed to set volume:', (error && error.message) || error);
      return false;
    }
  },

  adjustVolume(delta = 1) {
    const current = this.getVolume();
    if (current === null) {
      return false;
    }
    return this.setVolume(current + delta);
  },

  volumeUp(step = 2) {
    return this.adjustVolume(Math.abs(step || 1));
  },

  volumeDown(step = 2) {
    return this.adjustVolume(-Math.abs(step || 1));
  },

  setMute(muted = true) {
    if (!this.isAvailable('audio')) {
      logger.warn('[TVControl] Audio API unavailable');
      return false;
    }

    const audio = this.apis.audio;

    try {
      if (typeof audio.setMute === 'function') {
        audio.setMute(!!muted);
      } else if (typeof audio.setMuteState === 'function') {
        audio.setMuteState(!!muted);
      } else if (typeof audio.setMuteAsync === 'function') {
        audio.setMuteAsync(!!muted, () => logger.info('[TVControl] Mute set async'));
      } else {
        logger.warn('[TVControl] setMute/setMuteState not supported');
        return false;
      }
      logger.info('[TVControl] Mute:', muted ? 'ON' : 'OFF');
      return true;
    } catch (error) {
      logger.error('[TVControl] Failed to set mute:', (error && error.message) || error);
      return false;
    }
  },

  toggleMute() {
    if (!this.isAvailable('audio')) {
      return false;
    }

    try {
      const audio = this.apis.audio;
      if (typeof audio.isMute === 'function') {
        return this.setMute(!audio.isMute());
      }
      if (typeof audio.getMute === 'function') {
        return this.setMute(!audio.getMute());
      }
      logger.warn('[TVControl] Cannot read current mute state');
      return false;
    } catch (error) {
      logger.warn('[TVControl] Toggle mute failed:', (error && error.message) || error);
      return false;
    }
  },

  async setInputSource(options = {}) {
    if (!this.isAvailable('tvWindow')) {
      logger.warn('[TVControl] TV window API unavailable');
      return false;
    }

    const targetType = (options.type || '').toUpperCase();
    if (!targetType) {
      logger.warn('[TVControl] setInputSource requires a type (e.g., HDMI, TV)');
      return false;
    }

    let descriptor = options.descriptor || null;

    if (!descriptor && this.isAvailable('videoSourceList')) {
      const sources = await this.getVideoSources().catch(error => {
        logger.warn('[TVControl] Failed to read video sources:', (error && error.message) || error);
        return null;
      });

      if (sources && sources.connected) {
        descriptor = this.findSourceDescriptor(sources.connected, targetType, options.number);
      }
    }

    if (!descriptor) {
      descriptor = { type: targetType, number: options.number || 0 };
    }

    return new Promise((resolve) => {
      try {
        this.apis.tvWindow.setSource(
          descriptor,
          (source) => {
            logger.info('[TVControl] Source set to', `${source.type || targetType}#${source.number != null ? number : ''}`);
            resolve(true);
          },
          (error) => {
            logger.error('[TVControl] setSource failed:', (error && error.message) || error);
            resolve(false);
          }
        );
      } catch (error) {
        logger.error('[TVControl] setSource exception:', (error && error.message) || error);
        resolve(false);
      }
    });
  },

  async ensureTvSource() {
    if (!this.isAvailable('tvWindow')) {
      return false;
    }

    try {
      const current = this.apis.tvWindow.getSource();
      if (current && current.type === 'TV') {
        return true;
      }
    } catch (error) {
      logger.debug('[TVControl] Could not read current source:', (error && error.message) || error);
    }

    return this.setInputSource({ type: 'TV' });
  },

  getVideoSources() {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable('videoSourceList')) {
        resolve(null);
        return;
      }
      try {
        this.apis.systemInfo.getPropertyValue('VIDEOSOURCE', resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  },

  findSourceDescriptor(list, type, number) {
    if (!Array.isArray(list)) {
      return null;
    }

    const upper = type.toUpperCase();
    const match = list.find((source) => {
      if (!source || !source.type) return false;
      const typeMatches = source.type.toUpperCase() === upper;
      if (!typeMatches) {
        return false;
      }
      if (typeof number === 'undefined' || number === null) {
        return true;
      }
      return Number(source.number) === Number(number);
    });

    return match || null;
  },

  channelUp() {
    if (!this.isAvailable('channel')) {
      logger.warn('[TVControl] Channel API unavailable');
      return false;
    }

    try {
      const callbacks = this.makeChannelCallbacks('Channel up');
      this.apis.tvChannel.tuneUp(callbacks, null, 'ALL');
      return true;
    } catch (error) {
      logger.error('[TVControl] Channel up failed:', (error && error.message) || error);
      return false;
    }
  },

  channelDown() {
    if (!this.isAvailable('channel')) {
      logger.warn('[TVControl] Channel API unavailable');
      return false;
    }

    try {
      const callbacks = this.makeChannelCallbacks('Channel down');
      this.apis.tvChannel.tuneDown(callbacks, null, 'ALL');
      return true;
    } catch (error) {
      logger.error('[TVControl] Channel down failed:', (error && error.message) || error);
      return false;
    }
  },

  async tuneChannel(options = {}) {
    if (!this.isAvailable('channel')) {
      logger.warn('[TVControl] Channel API unavailable');
      return false;
    }

    if (!options.major && !options.channel && !options.frequency) {
      logger.warn('[TVControl] tuneChannel requires a major/channel identifier');
      return false;
    }

    await this.ensureTvSource();

    const request = {
      major: Number(options.major || options.channel || 0),
      minor: Number(options.minor || 0),
      sourceType: options.sourceType || 'ALL',
      programNumber: options.programNumber || null,
    };

    return new Promise((resolve) => {
      try {
        const success = () => {
          logger.info('[TVControl] Tuned to channel', `${request.major}.${request.minor}`);
          resolve(true);
        };
        const error = (err) => {
          logger.error('[TVControl] tune() failed:', (err && err.message) || err);
          resolve(false);
        };
        if (typeof this.apis.tvChannel.tune === 'function') {
          this.apis.tvChannel.tune(request, success, error);
        } else {
          logger.warn('[TVControl] tune() not supported on this firmware');
          resolve(false);
        }
      } catch (invokeError) {
        logger.error('[TVControl] tune() exception:', (invokeError && invokeError.message) || invokeError);
        resolve(false);
      }
    });
  },

  showWindow(rect = ['0px', '0px', '100%', '100%'], zOrder = 'MAIN') {
    if (!this.isAvailable('tvWindow')) {
      logger.warn('[TVControl] TV window API unavailable');
      return false;
    }

    const normalizeRect = (inputRect) => {
      const fallbackW = Math.max((typeof window !== 'undefined' && window.innerWidth) || 0, (typeof screen !== 'undefined' && screen.width) || 0, 1920);
      const fallbackH = Math.max((typeof window !== 'undefined' && window.innerHeight) || 0, (typeof screen !== 'undefined' && screen.height) || 0, 1080);

      const parsePart = (v, axis) => {
        if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
        if (typeof v === 'string') {
          const s = v.trim();
          if (s.endsWith('px')) {
            const n = parseFloat(s.slice(0, -2));
            return Number.isFinite(n) ? Math.round(n) : 0;
          }
          if (s.endsWith('%')) {
            const pct = parseFloat(s.slice(0, -1));
            const base = axis === 'x' || axis === 'w' ? fallbackW : fallbackH;
            return Number.isFinite(pct) ? Math.round((pct / 100) * base) : base;
          }
          const n = parseFloat(s);
          return Number.isFinite(n) ? Math.round(n) : 0;
        }
        return 0;
      };

      if (!Array.isArray(inputRect) || inputRect.length < 4) {
        return [0, 0, fallbackW, fallbackH];
      }

      const x = parsePart(inputRect[0], 'x');
      const y = parsePart(inputRect[1], 'y');
      const w = parsePart(inputRect[2], 'w') || fallbackW;
      const h = parsePart(inputRect[3], 'h') || fallbackH;
      return [x, y, w, h];
    };

    try {
      const rectPx = normalizeRect(rect);
      this.apis.tvWindow.show(() => {
        logger.info('[TVControl] TV window shown');
      }, (error) => {
        logger.error('[TVControl] Failed to show TV window:', (error && error.message) || error);
      }, rectPx, zOrder);
      return true;
    } catch (error) {
      logger.error('[TVControl] showWindow failed:', (error && error.message) || error);
      return false;
    }
  },

  hideWindow(zOrder = 'MAIN') {
    if (!this.isAvailable('tvWindow')) {
      return false;
    }

    try {
      this.apis.tvWindow.hide(() => {
        logger.info('[TVControl] TV window hidden');
      }, (error) => {
        logger.error('[TVControl] Failed to hide TV window:', (error && error.message) || error);
      }, zOrder);
      return true;
    } catch (error) {
      logger.error('[TVControl] hideWindow failed:', (error && error.message) || error);
      return false;
    }
  },

  makeChannelCallbacks(label) {
    return {
      onsuccess: () => logger.info(`[TVControl] ${label} success`),
      onnosignal: () => logger.warn(`[TVControl] ${label} - no signal`),
      onerror: (error) => logger.error(`[TVControl] ${label} error:`, (error && error.message) || error),
    };
  },

  async getStatus() {
    const status = {
      powerState: null,
      volume: null,
      mute: null,
      input: null,
      firmwareVersion: null,
      model: null,
      serialNumber: null,
      installedApps: [],
    };

    // Power state
    try {
      if (this.apis.remotePower && typeof this.apis.remotePower.getPowerState === 'function') {
        status.powerState = this.apis.remotePower.getPowerState();
      }
    } catch (error) {
      logger.debug('[TVControl] getPowerState failed:', (error && error.message) || error);
    }

    // Volume/mute
    status.volume = this.getVolume();
    try {
      if (this.apis.audio) {
        if (typeof this.apis.audio.isMute === 'function') {
          status.mute = !!this.apis.audio.isMute();
        } else if (typeof this.apis.audio.getMute === 'function') {
          status.mute = !!this.apis.audio.getMute();
        }
      }
    } catch (error) {
      logger.debug('[TVControl] get mute failed:', (error && error.message) || error);
    }

    // Current input/source
    try {
      if (this.apis.tvWindow && typeof this.apis.tvWindow.getSource === 'function') {
        const source = this.apis.tvWindow.getSource();
        status.input = source ? { type: source.type, number: source.number } : null;
      }
    } catch (error) {
      logger.debug('[TVControl] getSource failed:', (error && error.message) || error);
    }

    // Firmware / build info
    try {
      if (this.apis.systemInfo && typeof this.apis.systemInfo.getPropertyValue === 'function') {
        await new Promise((resolve) => {
          this.apis.systemInfo.getPropertyValue('BUILD', (build) => {
            status.firmwareVersion = (build && build.buildVersion) || null;
            status.model = (build && build.model) || null;
            status.serialNumber = (build && build.serialNumber) || null;
            resolve();
          }, () => resolve());
        });
      }
    } catch (error) {
      logger.debug('[TVControl] BUILD info failed:', (error && error.message) || error);
    }

    // Installed apps (best-effort)
    try {
      if (typeof tizen !== 'undefined' && tizen.application && typeof tizen.application.getAppsInfo === 'function') {
        status.installedApps = await new Promise((resolve) => {
          tizen.application.getAppsInfo((apps) => {
            resolve((apps || []).map(app => ({ id: app.id, name: app.name })));
          }, () => resolve([]));
        });
      }
    } catch (error) {
      logger.debug('[TVControl] getAppsInfo failed:', (error && error.message) || error);
    }

    return status;
  }
};
