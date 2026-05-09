// Nexari E-Paper — Sleep cycle orchestrator.
//
// When the device has an autoSleep setting (not NEVER), this module:
//   1. Immediately reports the wake reason via a heartbeat to the server.
//   2. Waits WAKE_WINDOW_MS (60 s) so the renderer can sync content.
//   3. Schedules the next hardware wake-up via webapis.epaper.
//   4. Sends a final 'sleeping' heartbeat with the nextWakeAt timestamp.
//   5. Calls goToSleep() 2.5 s later — enough time for the WS message to flush.
//
// autoSleep values (HH:MM strings from the portal Power & refresh settings):
//   'NEVER'  → no sleep cycle, device stays awake.
//   '00:15'  → 15 min between wake cycles.
//   '00:30'  → 30 min.   '01:00'  → 1 h.   '02:00'  → 2 h.
//   '04:00'  → 4 h.      '08:00'  → 8 h.

window.EpaperSleepCycle = (function () {
  'use strict';

  // 60 s sync window — renderer fetches schedule + images before we sleep.
  var WAKE_WINDOW_MS = 60000;

  // Parse 'HH:MM' → seconds.  Returns 0 for NEVER or unknown values.
  function parseSec(autoSleep) {
    if (!autoSleep || autoSleep === 'NEVER') return 0;
    // Canonical HH:MM format (portal)
    var m = String(autoSleep).match(/^(\d+):(\d+)$/);
    if (m) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
    // Legacy enum fallback (older firmware configs)
    var legacy = { '30MIN': 1800, '1HOUR': 3600, '2HOUR': 7200, '4HOUR': 14400, '8HOUR': 28800 };
    return legacy[autoSleep] || 0;
  }

  function getVersion() {
    return (window.PLAYER_BUILD_INFO && window.PLAYER_BUILD_INFO.version) || null;
  }

  // Best-effort WS push — silently skipped when socket is not open.
  function pushHeartbeat(fields) {
    if (!window.EpaperWS || !EpaperWS.isOpen()) return;
    try {
      EpaperWS.push({
        type: 'heartbeat',
        payload: Object.assign({ kind: 'epaper', playerVersion: getVersion() }, fields),
      });
    } catch (e) {
      logger.warn('[SleepCycle] heartbeat push failed:', e && e.message);
    }
  }

  // Step 1 — Report why the device woke up (scheduled / boot / unknown).
  function reportWakeReason() {
    var reason = 'boot';
    if (window.EpaperPower && EpaperPower.isAvailable()) {
      try { reason = EpaperPower.wakeReason() || 'boot'; } catch (e) {}
    }
    logger.info('[SleepCycle] wake reason:', reason);
    pushHeartbeat({ powerState: 'on', lastWakeReason: reason });
  }

  // Step 2 — Schedule the next hardware wake then go to sleep.
  function scheduleAndSleep() {
    var settings = (window.EpaperPower && EpaperPower._settings) || {};
    var sec = parseSec(settings.autoSleep);

    if (sec === 0) {
      logger.info('[SleepCycle] autoSleep=NEVER — staying awake');
      return;
    }

    var nextWakeAt = new Date(Date.now() + sec * 1000);
    logger.info('[SleepCycle] scheduling wake at', nextWakeAt.toISOString(), '(in', sec, 's)');

    // Register the hardware wake-up timer (cancels any prior timer).
    if (window.EpaperPower && EpaperPower.isAvailable()) {
      EpaperPower.scheduleNextWakeup(sec);
    }

    // Notify the server the device is about to sleep.
    pushHeartbeat({ powerState: 'sleeping', nextWakeAt: nextWakeAt.toISOString() });

    // Brief pause so the WS message flushes before the radio goes down.
    setTimeout(function () {
      logger.info('[SleepCycle] going to sleep');
      if (window.EpaperPower && EpaperPower.isAvailable()) {
        try { EpaperPower.goToSleep(); } catch (e) {
          logger.warn('[SleepCycle] goToSleep failed:', e && e.message);
        }
      }
    }, 2500);
  }

  return {
    /**
     * Call once after startRuntime() / EpaperWS.start().
     * Immediately reports the wake reason, then after WAKE_WINDOW_MS schedules
     * the next wake and goes to sleep (skipped when autoSleep=NEVER).
     */
    run: function () {
      reportWakeReason();
      setTimeout(scheduleAndSleep, WAKE_WINDOW_MS);
    },
  };
})();
