// Nexari Kitchen — Boot module
// Pairs the device then navigates to the kitchen order display URL served by the DS web app.
// Flow: pair → poll status → get workspace info → window.location.href = kitchen URL

(function () {
  'use strict';

  var PAIRING_POLL_INTERVAL = 5000;
  var pairingCode = null;
  var pairingTimer = null;
  var settingsOpen = false;

  function show(id)  { var el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id)  { var el = document.getElementById(id); if (el) el.classList.add('hidden'); }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  function serverBaseUrl() {
    return CONFIG.API_BASE.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');
  }

  async function requestPairing(deviceInfo) {
    var res = await fetch(CONFIG.API_BASE + '/devices/pair/request', {
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
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function checkPairing(code) {
    var res = await fetch(CONFIG.API_BASE + '/devices/pair/status?code=' + encodeURIComponent(code));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function getWorkspaceInfo(deviceToken) {
    var res = await fetch(CONFIG.API_BASE + '/devices/device/workspace', {
      headers: { 'Authorization': 'Bearer ' + deviceToken },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function showError(title, msg) {
    stopPolling();
    hide('pairing-screen');
    hide('launch-screen');
    show('error-screen');
    setText('error-title',   title || 'Error');
    setText('error-message', msg || 'An unexpected error occurred.');
  }

  function showLaunch(msg) {
    hide('pairing-screen');
    hide('error-screen');
    show('launch-screen');
    setText('launch-status', msg || 'Connecting...');
  }

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

  async function onClaimed(result) {
    var deviceToken = result.deviceToken;
    logger.info('Kitchen claimed, fetching workspace info...');
    showLaunch('Paired! Loading kitchen display...');

    localStorage.setItem('kitchen.deviceToken', deviceToken);
    localStorage.setItem('kitchen.deviceId',    result.deviceId);

    try {
      var wsData = await getWorkspaceInfo(deviceToken);
      var wsId = wsData.workspace && wsData.workspace.id;
      if (!wsId) throw new Error('No workspace assigned to this device yet');

      localStorage.setItem('kitchen.workspaceId', wsId);

      var target = serverBaseUrl() + '/kitchen/' + wsId + '?dt=' + encodeURIComponent(deviceToken);
      logger.info('Navigating to kitchen URL:', target);
      setText('launch-status', 'Launching kitchen display...');
      window.location.href = target;
    } catch (err) {
      showError('Launch Failed', err.message || 'Could not load kitchen data.');
    }
  }

  async function resumeExisting(deviceToken, deviceId) {
    showLaunch('Resuming kitchen session...');
    try {
      var wsData = await getWorkspaceInfo(deviceToken);
      var wsId = wsData.workspace && wsData.workspace.id;
      if (!wsId) throw new Error('Device not yet assigned to a workspace');

      var target = serverBaseUrl() + '/kitchen/' + wsId + '?dt=' + encodeURIComponent(deviceToken);
      logger.info('Resuming kitchen URL:', target);
      window.location.href = target;
    } catch (err) {
      logger.warn('Resume failed, re-pairing:', err);
      localStorage.removeItem('kitchen.deviceToken');
      localStorage.removeItem('kitchen.deviceId');
      localStorage.removeItem('kitchen.workspaceId');
      show('pairing-screen');
      hide('launch-screen');
      KitchenBoot.init();
    }
  }

  async function init() {
    logger.info('Nexari Kitchen booting...');

    var storedToken = localStorage.getItem('kitchen.deviceToken');
    var storedDeviceId = localStorage.getItem('kitchen.deviceId');
    if (storedToken && storedDeviceId) {
      logger.info('Found stored device token, resuming...');
      return resumeExisting(storedToken, storedDeviceId);
    }

    show('pairing-screen');
    hide('launch-screen');
    hide('error-screen');

    var deviceInfo = { duid: null, model: 'Unknown', serialNumber: null, firmwareVersion: null };
    try {
      var info = await Telemetry.getSystemInfo();
      deviceInfo.duid = info.duid || info.serialNumber || null;
      deviceInfo.model = info.realModel || info.model || 'Unknown';
      deviceInfo.serialNumber = info.serialNumber || null;
      deviceInfo.firmwareVersion = info.firmwareVersion || null;
      deviceInfo.modelCode = info.modelCode || null;

      setText('device-model',  'Model: '  + deviceInfo.model);
      if (info.ipAddress)    setText('device-ip',     'IP: '     + info.ipAddress);
      if (info.serialNumber) setText('device-serial', 'Serial: ' + info.serialNumber);
    } catch (err) {
      logger.warn('Could not get device info:', err);
    }

    try {
      setText('pairing-status', 'Requesting pairing code...');
      var resp = await requestPairing(deviceInfo);

      if (resp.status === 'claimed' && resp.deviceToken) {
        localStorage.setItem('kitchen.deviceToken', resp.deviceToken);
        localStorage.setItem('kitchen.deviceId',    resp.deviceId);
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

  window.KitchenBoot = {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
