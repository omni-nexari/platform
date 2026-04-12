// Nexari Kiosk — Boot module
// Pairs the device then navigates to the kiosk display URL served by the DS web app.
// Flow: pair → poll status → get workspace info → window.location.href = kiosk URL

(function () {
  'use strict';

  var PAIRING_POLL_INTERVAL = 5000; // ms
  var pairingCode = null;
  var pairingTimer = null;
  var settingsOpen = false;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function show(id)  { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id)  { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  function serverBaseUrl() {
    // Derive server base from API_BASE: strip /api/v1 suffix
    var base = CONFIG.API_BASE.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');
    return base;
  }

  // ── Pairing API ──────────────────────────────────────────────────────────────
  async function requestPairing(deviceInfo) {
    var response = await fetch(CONFIG.API_BASE + '/devices/pair/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duid:            deviceInfo.duid || null,
        modelName:       deviceInfo.model || null,
        modelCode:       deviceInfo.modelCode || null,
        serialNumber:    deviceInfo.serialNumber || null,
        firmwareVersion: deviceInfo.firmwareVersion || null,
      }),
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function checkPairing(code) {
    var response = await fetch(CONFIG.API_BASE + '/devices/pair/status?code=' + encodeURIComponent(code));
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function getWorkspaceInfo(deviceToken) {
    var response = await fetch(CONFIG.API_BASE + '/devices/device/workspace', {
      headers: { 'Authorization': 'Bearer ' + deviceToken },
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json(); // { workspace: { id, name }, ... }
  }

  // ── Screen transitions ────────────────────────────────────────────────────────
  function showError(title, msg) {
    stopPolling();
    hide('pairing-screen');
    hide('launch-screen');
    show('error-screen');
    setText('error-title',   title || 'Error');
    setText('error-message', msg   || 'An unexpected error occurred.');
  }

  function showLaunch(msg) {
    hide('pairing-screen');
    hide('error-screen');
    show('launch-screen');
    setText('launch-status', msg || 'Connecting...');
  }

  // ── Polling ───────────────────────────────────────────────────────────────────
  function stopPolling() {
    if (pairingTimer) { clearInterval(pairingTimer); pairingTimer = null; }
  }

  function startPolling() {
    stopPolling();
    pairingTimer = setInterval(async function () {
      try {
        var result = await checkPairing(pairingCode);
        if (result.status === 'claimed') {
          stopPolling();
          await onClaimed(result);
        }
      } catch (err) {
        logger.warn('Pairing poll error:', err);
      }
    }, PAIRING_POLL_INTERVAL);
  }

  // ── After claim ───────────────────────────────────────────────────────────────
  async function onClaimed(result) {
    var deviceToken = result.deviceToken;
    logger.info('Kiosk claimed, fetching workspace info...');
    showLaunch('Paired! Loading kiosk...');

    localStorage.setItem('kiosk.deviceToken', deviceToken);
    localStorage.setItem('kiosk.deviceId',    result.deviceId);

    try {
      var wsData = await getWorkspaceInfo(deviceToken);
      var wsId = wsData.workspace && wsData.workspace.id;
      if (!wsId) throw new Error('No workspace assigned to this device yet');

      localStorage.setItem('kiosk.workspaceId', wsId);

      // Detect orientation from screen dimensions
      var orientation = window.screen.width < window.screen.height ? 'portrait' : 'landscape';

      var target = serverBaseUrl() + '/kiosk/' + wsId + '/' + orientation + '?dt=' + encodeURIComponent(deviceToken);
      logger.info('Navigating to kiosk URL:', target);
      setText('launch-status', 'Launching...');
      window.location.href = target;
    } catch (err) {
      showError('Launch Failed', err.message || 'Could not load kiosk data.');
    }
  }

  // ── Already-paired boot path ──────────────────────────────────────────────────
  async function resumeExisting(deviceToken, deviceId) {
    showLaunch('Resuming paired session...');
    try {
      var wsData = await getWorkspaceInfo(deviceToken);
      var wsId = wsData.workspace && wsData.workspace.id;
      if (!wsId) throw new Error('Device not yet assigned to a workspace');

      var orientation = window.screen.width < window.screen.height ? 'portrait' : 'landscape';
      var target = serverBaseUrl() + '/kiosk/' + wsId + '/' + orientation + '?dt=' + encodeURIComponent(deviceToken);
      logger.info('Resuming kiosk URL:', target);
      window.location.href = target;
    } catch (err) {
      // Token may be stale — clear and re-pair
      logger.warn('Resume failed, starting fresh pairing:', err);
      localStorage.removeItem('kiosk.deviceToken');
      localStorage.removeItem('kiosk.deviceId');
      localStorage.removeItem('kiosk.workspaceId');
      show('pairing-screen');
      hide('launch-screen');
      KioskBoot.init();
    }
  }

  // ── Main init ─────────────────────────────────────────────────────────────────
  async function init() {
    logger.info('Nexari Kiosk booting...');

    // Check for stored token first
    var storedToken = localStorage.getItem('kiosk.deviceToken');
    var storedDeviceId = localStorage.getItem('kiosk.deviceId');
    if (storedToken && storedDeviceId) {
      logger.info('Found stored device token, resuming...');
      return resumeExisting(storedToken, storedDeviceId);
    }

    show('pairing-screen');
    hide('launch-screen');
    hide('error-screen');

    // Get device info for pairing
    var deviceInfo = { duid: null, model: 'Unknown', serialNumber: null, firmwareVersion: null };
    try {
      var info = await Telemetry.getSystemInfo();
      deviceInfo.duid = info.duid || info.serialNumber || null;
      deviceInfo.model = info.realModel || info.model || 'Unknown';
      deviceInfo.serialNumber = info.serialNumber || null;
      deviceInfo.firmwareVersion = info.firmwareVersion || null;
      deviceInfo.modelCode = info.modelCode || null;

      setText('device-model',  'Model: ' + deviceInfo.model);
      if (info.ipAddress)    setText('device-ip',     'IP: '     + info.ipAddress);
      if (info.serialNumber) setText('device-serial', 'Serial: ' + info.serialNumber);
    } catch (err) {
      logger.warn('Could not get device info:', err);
    }

    // Request pairing code
    try {
      setText('pairing-status', 'Requesting pairing code...');
      var resp = await requestPairing(deviceInfo);

      // Device already claimed (DUID recognised)
      if (resp.status === 'claimed' && resp.deviceToken) {
        localStorage.setItem('kiosk.deviceToken', resp.deviceToken);
        localStorage.setItem('kiosk.deviceId',    resp.deviceId);
        return onClaimed(resp);
      }

      pairingCode = resp.code;
      setText('pairing-code',   pairingCode);
      setText('pairing-status', 'Waiting for admin to confirm...');
      startPolling();
    } catch (err) {
      showError('Pairing Failed', 'Could not connect to server: ' + err.message);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.KioskBoot = {
    init: init,
    retry: init,

    toggleSettings() {
      settingsOpen = !settingsOpen;
      var panel = document.getElementById('conn-settings-panel');
      var arrow = document.getElementById('conn-settings-arrow');
      if (panel) panel.classList.toggle('hidden', !settingsOpen);
      if (arrow) arrow.innerHTML = settingsOpen ? '&#9650;' : '&#9660;';
      if (settingsOpen) {
        var inp = document.getElementById('input-api-base');
        if (inp) { inp.value = CONFIG.API_BASE; inp.focus(); }
      }
    },

    applySettings() {
      var inp = document.getElementById('input-api-base');
      var msg = document.getElementById('conn-settings-msg');
      if (!inp) return;
      var raw = inp.value.trim().replace(/\/$/, '');
      try { new URL(raw); } catch (_) {
        if (msg) { msg.style.color = '#ff4466'; msg.textContent = 'Invalid URL'; }
        return;
      }
      localStorage.setItem('PLAYER_API_BASE', raw);
      window.location.reload();
    },

    resetSettings() {
      localStorage.removeItem('PLAYER_API_BASE');
      window.location.reload();
    },
  };

  // ── Auto-start ────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
