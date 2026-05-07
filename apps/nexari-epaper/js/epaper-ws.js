// Nexari E-Paper — WebSocket client.
//
// Connects to the same /ws/device endpoint used by nexari-tizen and listens
// for the small set of e-paper-specific events:
//   - epaper_playlist_changed → refresh schedule + restart cycle
//   - epaper_wake_now         → cancel sleep, ensure renderer running
//   - epaper_refresh_now      → request a full panel defrag
//   - epaper_settings_changed → re-apply EpaperPower settings + persist
//   - epaper_force_sleep      → call EpaperPower.goToSleep()
//   - refresh_schedule        → fall-through (parity with TV)
//
// Connection cadence is identical to nexari-tizen: open → 5s reconnect on
// close. The e-paper player keeps the socket open continuously because the
// device's networkStandby is forced ON (push-first profile).

window.EpaperWS = (function() {
  'use strict';

  var state = {
    socket: null,
    reconnectTimer: null,
    deviceToken: null,
    deviceId: null,
    started: false,
    closed: false,
  };

  var RECONNECT_MS = 5000;

  function buildUrl() {
    var base = (CONFIG && CONFIG.WS_URL) || '';
    if (!base) return null;
    var token = state.deviceToken || (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
    if (!token) return null;
    return base.replace(/\/+$/, '') + '/api/v1/devices/ws/device?token=' + encodeURIComponent(token);
  }

  function scheduleReconnect() {
    if (state.closed) return;
    if (state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(function() {
      state.reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function send(obj) {
    try {
      if (state.socket && state.socket.readyState === 1) {
        state.socket.send(JSON.stringify(obj));
      }
    } catch (e) {
      logger.warn('[WS] send failed: ' + (e && e.message));
    }
  }

  function applyPolicy(payload) {
    if (!payload) return;
    if (window.EpaperPower && EpaperPower.isAvailable()) {
      try {
        EpaperPower.applySettings(payload);
        logger.info('[WS] applied epaper_settings_changed');
      } catch (e) {
        logger.warn('[WS] applySettings failed: ' + (e && e.message));
      }
    }
  }

  function handleMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    var t = msg.type || msg.event;
    switch (t) {
      case 'server_ack':
        logger.debug('[WS] server_ack');
        break;

      case 'epaper_playlist_changed':
      case 'refresh_schedule':
        if (window.EpaperRenderer) EpaperRenderer.refreshNow();
        break;

      case 'epaper_wake_now':
        // Wake is implicit — if WS message arrived we're awake. Just nudge
        // the renderer to re-pull schedule in case anything changed.
        if (window.EpaperRenderer) EpaperRenderer.refreshNow();
        break;

      case 'epaper_refresh_now':
        if (window.EpaperPower && EpaperPower.isAvailable()) {
          try { EpaperPower.refreshNow(); } catch (_) {}
        }
        break;

      case 'epaper_settings_changed':
        applyPolicy(msg.payload || {});
        // Persist locally so we have the latest if the device boots offline
        try {
          localStorage.setItem('epaperSettings', JSON.stringify(msg.payload || {}));
        } catch (_) {}
        break;

      case 'epaper_force_sleep':
        if (window.EpaperPower && EpaperPower.isAvailable()) {
          try { EpaperPower.goToSleep(); } catch (e) { logger.warn('[WS] goToSleep failed: ' + (e && e.message)); }
        }
        break;

      // Generic commands the e-paper player still respects:
      case 'reboot':
        try { tizen.application.getCurrentApplication().exit(); } catch (_) { location.reload(); }
        break;

      case 'dump_logs':
        if (logger && typeof logger._flush === 'function') logger._flush();
        break;

      default:
        // Ignore TV-specific commands silently
        logger.debug('[WS] ignored type=' + t);
    }
  }

  function sendHeartbeat() {
    if (!state.socket || state.socket.readyState !== 1) return;
    try {
      var info = (window.Telemetry && Telemetry.getSystemInfo) ? Telemetry.getSystemInfo() : {};
      send({
        type: 'heartbeat',
        payload: {
          playerVersion: (window.__BUILD_INFO__ && window.__BUILD_INFO__.version) || null,
          firmwareVersion: info.firmwareVersion || null,
          timezone: info.timezone || null,
          resolution: info.resolution || null,
          powerState: 'on',
          kind: 'epaper',
          panelW: info.panelW || null,
          panelH: info.panelH || null,
          batteryPct: info.batteryPct != null ? info.batteryPct : null,
        },
      });
    } catch (e) {
      logger.warn('[WS] heartbeat failed: ' + (e && e.message));
    }
  }

  function connect() {
    var url = buildUrl();
    if (!url) {
      logger.warn('[WS] missing token or WS_URL — cannot connect');
      scheduleReconnect();
      return;
    }
    try {
      state.socket = new WebSocket(url);
    } catch (e) {
      logger.warn('[WS] new WebSocket failed: ' + (e && e.message));
      scheduleReconnect();
      return;
    }
    state.socket.onopen = function() {
      logger.info('[WS] open');
      sendHeartbeat();
    };
    state.socket.onmessage = function(ev) { handleMessage(ev.data); };
    state.socket.onerror = function(ev) {
      logger.warn('[WS] error: ' + (ev && ev.message ? ev.message : ''));
    };
    state.socket.onclose = function(ev) {
      logger.info('[WS] close code=' + (ev && ev.code) + ' reason=' + (ev && ev.reason));
      state.socket = null;
      scheduleReconnect();
    };
  }

  return {
    start: function(device) {
      if (state.started) return;
      state.started = true;
      state.closed = false;
      state.deviceId = device.id;
      state.deviceToken = device.deviceToken || (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || null;

      // Pull the latest server-side policy on boot (in case admin changed it
      // while device was sleeping/offline).
      if (window.API && typeof API.getEpaperPolicy === 'function') {
        API.getEpaperPolicy(state.deviceToken).then(function(policy) {
          if (policy && policy.settings) applyPolicy(policy.settings);
        }).catch(function() { /* ignore */ });
      }

      connect();

      // Periodic heartbeat (config interval, default 60s)
      var hbMs = (CONFIG && CONFIG.HEARTBEAT_INTERVAL) || 60000;
      setInterval(sendHeartbeat, hbMs);

      // Stream buffered console logs to the dashboard every 5 s via
      // device_log WS messages (mirrors nexari-tizen behaviour).
      setInterval(function() {
        var sock = state.socket;
        if (!sock || sock.readyState !== 1) return;
        var batch = (window.LogBuffer && typeof window.LogBuffer.drain === 'function')
          ? window.LogBuffer.drain(100)
          : [];
        if (!batch.length) return;
        var byLevel = { debug: [], info: [], warn: [], error: [] };
        for (var i = 0; i < batch.length; i++) {
          var e = batch[i];
          var lvl = (e.level && byLevel[e.level]) ? e.level : 'info';
          var ts = e.timestamp || new Date().toISOString();
          var msg = Array.isArray(e.message)
            ? e.message.map(function(a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ')
            : String(e.message != null ? e.message : '');
          byLevel[lvl].push(ts + ' ' + msg);
        }
        var levels = Object.keys(byLevel);
        for (var li = 0; li < levels.length; li++) {
          var level = levels[li];
          var lines = byLevel[level];
          if (!lines.length) continue;
          for (var si = 0; si < lines.length; si += 50) {
            try {
              sock.send(JSON.stringify({ type: 'device_log', payload: { level: level, lines: lines.slice(si, si + 50) } }));
            } catch (_) {}
          }
        }
      }, 5000);
    },

    isOpen: function() { return state.socket && state.socket.readyState === 1; },

    stop: function() {
      state.closed = true;
      if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
      if (state.socket) { try { state.socket.close(); } catch (_) {} state.socket = null; }
      state.started = false;
    },
  };
})();
