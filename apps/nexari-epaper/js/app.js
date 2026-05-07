// Nexari E-Paper — Main Application Entry Point

(function() {
  'use strict';

  logger.info('Nexari E-Paper starting...');
  logger.info('API Base:', CONFIG.API_BASE);
  logger.info('WebSocket URL:', CONFIG.WS_URL);

window.EpaperApp = {
    device: null,

    startRuntime: function(device) {
      this.device = device;
      logger.info('[EpaperApp] startRuntime', device.id);

      // Apply default e-paper power profile
      if (window.EpaperPower && EpaperPower.isAvailable()) {
        EpaperPower.applySettings(EpaperPower.defaultSettings());
      } else {
        logger.warn('[EpaperApp] webapis.epaper unavailable — power profile skipped');
      }

      // Swap screens
      const pairing = document.getElementById('pairing-screen');
      const player = document.getElementById('player-screen');
      if (pairing) pairing.classList.add('hidden');
      if (player) player.classList.remove('hidden');

      const nameEl = document.getElementById('device-name');
      if (nameEl) nameEl.textContent = device.name || 'E-Paper';

      const img = document.getElementById('content-image');
      if (img) img.alt = 'Loading content…';

      // Determine how we woke up
      var reason = (window.EpaperPower && EpaperPower.isAvailable())
        ? EpaperPower.wakeReason()   // 'scheduled' | 'boot' | 'unknown'
        : 'unknown';
      var debugNoSleep = (CONFIG && CONFIG.DEBUG_NO_SLEEP) ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_NO_SLEEP') === 'true');
      var sleepDelayMs = (CONFIG && CONFIG.SLEEP_DELAY_MS) || 60000;

      logger.info('[EpaperApp] wake reason:', reason, debugNoSleep ? '(DEBUG_NO_SLEEP)' : '');

      if (reason === 'boot' && !debugNoSleep) {
        // Manual power-on: device is already showing the frozen e-ink image.
        // Just reschedule the next polling wake and sleep quickly.
        // No need to re-render — the panel holds its image without power.
        logger.info('[EpaperApp] manual boot — rescheduling wake, sleeping in', sleepDelayMs / 1000, 's');
        if (window.EpaperPower) {
          EpaperPower.scheduleNextWakeup(null, function(id, next) {
            logger.info('[EpaperApp] next wake scheduled:', next.toISOString(), 'id=', id);
          });
        }
        // Open WS briefly so server can push urgent commands (content_update, force_sleep)
        if (window.EpaperWS) {
          try { EpaperWS.start(device); } catch (e) { logger.warn('[EpaperApp] WS start failed:', e && e.message); }
        }
        setTimeout(function() {
          if (window.EpaperPower && EpaperPower.isAvailable()) EpaperPower.goToSleep();
        }, sleepDelayMs);
        return;
      }

      // Scheduled wake (or DEBUG_NO_SLEEP) — fetch and render content.
      // After the first image is on screen, schedule the next wakeup then sleep.
      if (window.EpaperRenderer) {
        try {
          EpaperRenderer.start(device, function onFirstRender() {
            if (window.EpaperPower) {
              EpaperPower.scheduleNextWakeup(null, function(id, next) {
                logger.info('[EpaperApp] next wake scheduled:', next.toISOString(), 'id=', id);
              });
            }
            if (!debugNoSleep) {
              logger.info('[EpaperApp] sleeping in', sleepDelayMs / 1000, 's');
              setTimeout(function() {
                if (window.EpaperPower && EpaperPower.isAvailable()) EpaperPower.goToSleep();
              }, sleepDelayMs);
            } else {
              logger.info('[EpaperApp] DEBUG_NO_SLEEP — staying awake');
            }
          });
        } catch (e) { logger.error('[EpaperApp] Renderer start failed:', e && e.message); }
      }

      // WS runs during the awake window for push commands + heartbeat
      if (window.EpaperWS) {
        try { EpaperWS.start(device); } catch (e) { logger.warn('[EpaperApp] WS start failed:', e && e.message); }
      }

      // Initial telemetry
      Telemetry.send(device.id).catch(function(e) { logger.warn('[EpaperApp] initial telemetry failed:', e && e.message); });
    },
  };

  // ── Boot ────────────────────────────────────────────────────────────────
  const isPaired = localStorage.getItem('isPaired') === 'true';
  const deviceId = localStorage.getItem('deviceId');
  const deviceName = localStorage.getItem('deviceName');
  const deviceToken = localStorage.getItem('deviceToken');
  const workspaceId = localStorage.getItem('workspaceId');

  if (isPaired && deviceId && deviceToken) {
    logger.info('Device already paired:', deviceName);
    logger.setDevice(deviceId);
    EpaperApp.startRuntime({
      id: deviceId,
      name: deviceName,
      deviceToken: deviceToken,
      workspaceId: workspaceId,
    });
  } else {
    if (isPaired && !deviceToken) logger.warn('Paired flag set without token — re-pairing');
    logger.info('Device not paired, starting pairing process');
    Pairing.init();
  }

  // Tizen back/exit handling
  window.addEventListener('tizenhwkey', function(e) {
    if (e && e.keyName === 'back') {
      try { e.preventDefault(); } catch (_) {}
    }
  });

  // Refresh content when the app returns to foreground (e.g. after wake)
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      logger.info('[App] visible — refreshing content');
      if (window.EpaperRenderer) EpaperRenderer.refreshNow();
    } else {
      logger.info('[App] hidden');
    }
  });

  // Cleanup on unload
  window.addEventListener('beforeunload', function() {
    logger.info('[App] closing');
    if (window.EpaperRenderer && typeof EpaperRenderer.stop === 'function') EpaperRenderer.stop();
    if (window.EpaperWS && typeof EpaperWS.stop === 'function') EpaperWS.stop();
    if (window.Pairing && typeof Pairing.stopPairingCheck === 'function') Pairing.stopPairingCheck();
  });

  // Global error handlers
  window.addEventListener('error', function(e) {
    logger.error('[App] uncaught error:', e.error ? e.error.message : e.message);
  });

  window.addEventListener('unhandledrejection', function(e) {
    logger.error('[App] unhandled rejection:', e.reason && e.reason.message ? e.reason.message : String(e.reason));
  });

  logger.info('Application initialized');
})();
