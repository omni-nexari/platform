// Nexari E-Paper — Main Application Entry Point

(function() {
  'use strict';

  logger.info('Nexari E-Paper starting...');
  logger.info('API Base:', CONFIG.API_BASE);
  logger.info('WebSocket URL:', CONFIG.WS_URL);

  window.EpaperApp = {
    device: null,

    // Phase 1: pair → apply power profile → start image renderer loop.
    // Phase 2 will additionally start the WS client for push events.
    startRuntime: function(device) {
      this.device = device;
      logger.info('[EpaperApp] startRuntime', device.id);

      // Apply default e-paper power profile (push-first)
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

      // Start the image renderer loop (schedule poll + cycle)
      if (window.EpaperRenderer) {
        try { EpaperRenderer.start(device); } catch (e) { logger.error('Renderer start failed:', e && e.message); }
      } else {
        logger.warn('[EpaperApp] EpaperRenderer not loaded');
      }

      // Start the WS push channel (server can wake/refresh/reconfigure us)
      if (window.EpaperWS) {
        try { EpaperWS.start(device); } catch (e) { logger.error('WS start failed:', e && e.message); }
      } else {
        logger.warn('[EpaperApp] EpaperWS not loaded');
      }

      // Telemetry sample — Phase 2 will switch to WS
      Telemetry.send(device.id).catch(function(e) { logger.warn('initial telemetry failed:', e && e.message); });
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
})();
