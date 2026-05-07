// Nexari E-Paper — Power & display control wrapper around webapis.epaper
// Push-first profile: networkStandby always ON, no auto-sleep by default.
// Settings come from CONFIG defaults and (in Phase 2) per-device epaper_settings_json.

window.EpaperPower = {
  _initialized: false,
  _settings: null,

  isAvailable() {
    return typeof webapis !== 'undefined' && webapis.epaper;
  },

  // Default settings — overridden by server-issued policy in Phase 2
  defaultSettings() {
    return {
      networkStandby: true,                          // push-first → always ON
      dailyRefreshAt: { hour: 2, minute: 0 },        // 02:00 daily full refresh
      autoSleep: 'NEVER',                            // NEVER|30MIN|1HOUR|2HOUR|4HOUR|8HOUR
      batteryWarnIcon: true,
      led: { color: 'LED_GREEN', mode: 'on' },       // 'on' | 'blink' | 'off'
      maxSwapRateSec: 30,
    };
  },

  applySettings(settings) {
    if (!this.isAvailable()) {
      logger.warn('[EpaperPower] webapis.epaper not available — skipping power init');
      return false;
    }

    // Log API version for diagnostics (webapis.epaper.getVersion())
    try {
      var apiVer = webapis.epaper.getVersion();
      logger.info('[EpaperPower] API version:', apiVer);
    } catch (e) { logger.warn('[EpaperPower] getVersion failed:', e && e.message); }

    var s = Object.assign({}, this.defaultSettings(), settings || {});
    this._settings = s;

    // Network standby — read current state first so we only call set if it changed
    try {
      var currentStandby = webapis.epaper.getNetworkStandby();
      var wantStandby = s.networkStandby ? 'ON' : 'OFF';
      if (currentStandby !== wantStandby) {
        webapis.epaper.setNetworkStandby(wantStandby);
      }
      logger.info('[EpaperPower] network standby:', wantStandby);
    } catch (e) { logger.warn('[EpaperPower] setNetworkStandby failed:', e && e.message); }

    // Auto-sleep — read current value first to avoid unnecessary writes
    try {
      if (s.autoSleep && s.autoSleep !== 'NEVER') {
        webapis.epaper.setAutoSleepTime(s.autoSleep);
        logger.info('[EpaperPower] auto-sleep:', s.autoSleep);
      } else {
        // Some firmwares don't support 'NEVER' — use reset
        try { webapis.epaper.resetAutoSleepTime(); } catch (_) {}
        logger.info('[EpaperPower] auto-sleep: NEVER (reset)');
      }
    } catch (e) { logger.warn('[EpaperPower] setAutoSleepTime failed:', e && e.message); }

    // Daily refresh time — read current value first
    try {
      var currentRefresh = webapis.epaper.getScreenRefreshTime();
      var wantHour = s.dailyRefreshAt.hour;
      var wantMin = s.dailyRefreshAt.minute;
      if (!currentRefresh || currentRefresh.hour !== wantHour || currentRefresh.minute !== wantMin) {
        webapis.epaper.setScreenRefreshTime({ hour: wantHour, minute: wantMin });
      }
      logger.info('[EpaperPower] daily refresh:', wantHour + ':' + String(wantMin).padStart(2, '0'));
    } catch (e) { logger.warn('[EpaperPower] setScreenRefreshTime failed:', e && e.message); }

    // Battery warning icon — read then set
    try {
      var currentBatt = webapis.epaper.getBatteryWarningIconDisplay();
      var wantBatt = s.batteryWarnIcon ? 'ON' : 'OFF';
      if (currentBatt !== wantBatt) {
        webapis.epaper.setBatteryWarningIconDisplay(wantBatt);
      }
    } catch (e) { logger.warn('[EpaperPower] setBatteryWarningIconDisplay failed:', e && e.message); }

    // LED
    try {
      var led = s.led || { color: 'LED_GREEN', mode: 'on' };
      if (led.mode === 'off') {
        webapis.epaper.setLEDStateOff(led.color || 'LED_GREEN');
      } else if (led.mode === 'blink') {
        webapis.epaper.setLEDStateBlink({
          color: led.color || 'LED_GREEN',
          onIntervalTime: 'LED_500MS',
          offIntervalTime: 'LED_500MS',
          duration: 0, // 0 = forever per sample
        });
      } else {
        webapis.epaper.setLEDStateOn({ color: led.color || 'LED_GREEN', duration: 0 });
      }
    } catch (e) { logger.warn('[EpaperPower] LED failed:', e && e.message); }

    this._initialized = true;
    return true;
  },

  // Force a full panel refresh — call after image swap
  refreshNow() {
    if (!this.isAvailable()) return;
    try { webapis.epaper.screenRefreshNow(); } catch (e) { logger.warn('[EpaperPower] screenRefreshNow failed:', e && e.message); }
  },

  // Schedule a wakeup at a specific Date
  scheduleWakeup(when) {
    if (!this.isAvailable() || !when) return null;
    try {
      var id = webapis.epaper.setScheduleWakeupTime({
        year: when.getFullYear(),
        month: when.getMonth() + 1,
        day: when.getDate(),
        hour: when.getHours(),
        minute: when.getMinutes(),
        second: when.getSeconds(),
      });
      logger.info('[EpaperPower] wakeup scheduled at', when.toISOString(), 'id=', id);
      return id;
    } catch (e) {
      logger.warn('[EpaperPower] setScheduleWakeupTime failed:', e && e.message);
      return null;
    }
  },

  cancelWakeup(id) {
    if (!this.isAvailable() || id == null) return;
    try { webapis.epaper.cancelScheduleWakeupTime(id); } catch (e) { logger.warn('[EpaperPower] cancelScheduleWakeupTime failed:', e && e.message); }
  },

  // Higher-level helper: schedule a wakeup `intervalSec` seconds from now.
  // Cancels the previous timer (persisted in localStorage) first.
  // cb(timerId, nextDate) is called on success.
  scheduleNextWakeup(intervalSec, cb) {
    var sec = intervalSec || (CONFIG && CONFIG.WAKE_INTERVAL_SEC) || 300;
    // Cancel previously scheduled timer so we never accumulate stale timers.
    var prevId = null;
    try { prevId = JSON.parse(localStorage.getItem('_epaperWakeTimerId')); } catch (_) {}
    if (prevId != null) this.cancelWakeup(prevId);

    var next = new Date(Date.now() + sec * 1000);
    var id = this.scheduleWakeup(next);
    try { localStorage.setItem('_epaperWakeTimerId', JSON.stringify(id)); } catch (_) {}
    if (cb) cb(id, next);
    return id;
  },

  // Did we wake from a scheduled timer?
  wakeReason() {
    if (!this.isAvailable()) return 'unknown';
    try {
      var scheduled = webapis.epaper.isScheduledPlayBootReason();
      return scheduled ? 'scheduled' : 'boot';
    } catch (e) { return 'unknown'; }
  },

  goToSleep() {
    if (!this.isAvailable()) return;
    try { logger.info('[EpaperPower] goToSleep()'); webapis.epaper.goToSleep(); } catch (e) { logger.warn('[EpaperPower] goToSleep failed:', e && e.message); }
  },

  // Read the E-Paper API version string — useful for pairing/telemetry metadata
  getApiVersion() {
    if (!this.isAvailable()) return null;
    try { return webapis.epaper.getVersion(); } catch (e) { return null; }
  },
};
