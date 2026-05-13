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
    screenshotIntervalHandle: null,
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

      // Server pushing fresh calendar events (via calendar-broker):
      case 'calendar_events':
        if (window.EpaperCalendar && msg.payload && msg.payload.contentId) {
          logger.info('[WS] calendar_events push for ' + msg.payload.contentId);
          EpaperCalendar.pushUpdate(msg.payload.contentId, msg.payload.events || []);
        }
        break;

      case 'calendar_unavailable':
        logger.warn('[WS] calendar unavailable: contentId=' + (msg.payload && msg.payload.contentId) + ' — ' + (msg.payload && msg.payload.error));
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

      case 'app_update':
      case 'APP_UPDATE':
        if (window.EpaperUpdater && typeof EpaperUpdater.handle === 'function') {
          EpaperUpdater.handle(msg.payload || {}, function(type, data) {
            send(Object.assign({ type: type, deviceId: state.deviceId }, data || {}));
          });
        } else {
          logger.warn('[WS] EpaperUpdater not loaded');
        }
        break;

      case 'update_player':
        // Alias for app_update — forward to EpaperUpdater with downloadUrl normalised to wgtUrl
        if (window.EpaperUpdater && typeof EpaperUpdater.handle === 'function') {
          var updatePayload = msg.payload || {};
          if (!updatePayload.wgtUrl && updatePayload.downloadUrl) {
            updatePayload = Object.assign({}, updatePayload, { wgtUrl: updatePayload.downloadUrl });
          }
          EpaperUpdater.handle(updatePayload, function(type, data) {
            send(Object.assign({ type: type, deviceId: state.deviceId }, data || {}));
          });
        } else {
          logger.warn('[WS] EpaperUpdater not loaded for update_player');
        }
        break;

      // Generic commands the e-paper player still respects:
      case 'reboot':
        try { tizen.application.getCurrentApplication().exit(); } catch (_) { location.reload(); }
        break;

      case 'dump_logs':
        if (logger && typeof logger._flush === 'function') logger._flush();
        break;

      case 'screenshot':
      case 'screenshot_auto': {
        captureAndSend(t === 'screenshot_auto' ? 'auto' : 'manual');
        break;
      }

      case 'set_screenshot_interval': {
        // Clear any existing auto-screenshot timer
        if (state.screenshotIntervalHandle) {
          clearInterval(state.screenshotIntervalHandle);
          state.screenshotIntervalHandle = null;
        }
        var minutes = Math.max(1, Number(msg.payload && msg.payload.minutes) || 5);
        logger.info('[WS] screenshot interval set to ' + minutes + ' min');
        // Capture immediately, then on interval
        setTimeout(function() { captureAndSend('interval'); }, 3000);
        state.screenshotIntervalHandle = setInterval(function() {
          captureAndSend('interval');
        }, minutes * 60000);
        break;
      }

      default:
        // Ignore TV-specific commands silently
        logger.debug('[WS] ignored type=' + t);
    }
  }

  // ── captureAndSend — shared screen capture used by manual, auto, and interval ──
  // trigger: 'manual' | 'interval'
  function captureAndSend(trigger) {
    var trig = trigger || 'manual';
    logger.info('[WS] captureAndSend trigger=' + trig);

    var w = window.innerWidth  || screen.width  || 1200;
    var h = window.innerHeight || screen.height || 1600;
    var version = (window.PLAYER_BUILD_INFO && window.PLAYER_BUILD_INFO.version) || '?';

    function sendFallback(reason) {
      try {
        var fb  = document.createElement('canvas');
        fb.width  = Math.min(w, 600);
        fb.height = Math.min(h, 400);
        var fc = fb.getContext('2d');
        fc.fillStyle = '#f8f8f8';
        fc.fillRect(0, 0, fb.width, fb.height);
        fc.fillStyle = '#222';
        fc.font = 'bold 22px sans-serif';
        fc.fillText('Nexari E-Paper v' + version, 20, 50);
        fc.font = '16px sans-serif';
        fc.fillStyle = '#555';
        fc.fillText(reason || 'Live capture unavailable on this firmware', 20, 88);
        fc.fillText(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', 20, 116);
        var info = '';
        try {
          info = window.screen.width + 'x' + window.screen.height +
                 ' | ' + (navigator.userAgent.match(/Tizen\s[\d.]+/) || [''])[0];
        } catch (_) {}
        if (info) { fc.fillText(info, 20, 144); }
        var b64 = fb.toDataURL('image/jpeg', 0.85).replace(/^data:[^;]+;base64,/, '');
        send({ type: 'screenshot_data', payload: { dataBase64: b64, trigger: trig, contentId: null } });
        logger.info('[WS] screenshot fallback sent (' + reason + ')');
      } catch (e2) {
        logger.warn('[WS] screenshot fallback failed: ' + (e2 && e2.message));
      }
    }

    try {
      var canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      // If an image is currently displayed, draw it directly (blob URL is
      // same-origin so canvas stays clean and toDataURL() will not throw).
      var imgContentEl = document.getElementById('content-image');
      if (imgContentEl && imgContentEl.src &&
          imgContentEl.naturalWidth > 0 &&
          imgContentEl.style.display !== 'none') {
        try {
          // Draw with letterboxing (object-contain): preserve aspect ratio, centre on black
          var iw = imgContentEl.naturalWidth;
          var ih = imgContentEl.naturalHeight;
          var scale = Math.min(w / iw, h / ih);
          var dw = iw * scale;
          var dh = ih * scale;
          var dx = (w - dw) / 2;
          var dy = (h - dh) / 2;
          ctx.drawImage(imgContentEl, dx, dy, dw, dh);
          var imgB64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:[^;]+;base64,/, '');
          send({ type: 'screenshot_data', payload: { dataBase64: imgB64, trigger: trig, contentId: null } });
          logger.info('[WS] screenshot sent from image element (' + imgB64.length + ' chars)');
        } catch (imgErr) {
          logger.warn('[WS] screenshot drawImage failed: ' + (imgErr && imgErr.message));
          sendFallback('Image draw failed');
        }
        return;
      }

      // Try to capture calendar DOM via SVG foreignObject + data URI
      var calEl = document.getElementById('content-calendar');
      var srcEl = calEl && calEl.firstElementChild ? calEl : null;
      if (!srcEl) {
        sendFallback('No content loaded');
        return;
      }

      var xml;
      try { xml = new XMLSerializer().serializeToString(srcEl); } catch (xe) {
        logger.warn('[WS] screenshot serialize failed: ' + (xe && xe.message));
        sendFallback('Serialize error');
        return;
      }

      var svgSrc =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
        '<foreignObject width="100%" height="100%">' +
        '<div xmlns="http://www.w3.org/1999/xhtml">' + xml + '</div>' +
        '</foreignObject></svg>';

      // Use data URI (not blob URL) — more reliable on Tizen 8 WebView
      var dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgSrc);
      var img = new Image();
      img.onload = function () {
        try {
          ctx.drawImage(img, 0, 0, w, h);
          // toDataURL() throws SecurityError on Tizen for foreignObject canvases
          var b64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:[^;]+;base64,/, '');
          send({ type: 'screenshot_data', payload: { dataBase64: b64, trigger: trig, contentId: null } });
          logger.info('[WS] screenshot sent (' + b64.length + ' chars)');
        } catch (e) {
          logger.warn('[WS] screenshot toDataURL failed: ' + (e && e.message));
          sendFallback('Canvas security restriction');
        }
      };
      img.onerror = function () {
        logger.warn('[WS] screenshot SVG load failed');
        sendFallback('SVG render failed');
      };
      img.src = dataUri;
    } catch (e) {
      logger.warn('[WS] screenshot error: ' + (e && e.message));
      sendFallback('Capture error');
    }
  }

  function sendHeartbeat() {
    if (!state.socket || state.socket.readyState !== 1) return;

    function doSend(info) {
      info = info || {};
      try {
        send({
          type: 'heartbeat',
          payload: {
            playerVersion: (window.PLAYER_BUILD_INFO && window.PLAYER_BUILD_INFO.version) || null,
            firmwareVersion: info.firmwareVersion || null,
            timezone: info.timezone || null,
            resolution: info.resolution || null,
            powerState: 'on',
            kind: 'epaper',
            panelW: info.panelW || null,
            panelH: info.panelH || null,
            batteryPct: info.batteryPct != null ? info.batteryPct : null,
            cpuLoad: info.cpuLoad != null ? info.cpuLoad : null,
            memoryFreeBytes: info.memoryFreeBytes != null ? info.memoryFreeBytes : null,
            memoryTotalBytes: info.memoryTotalBytes != null ? info.memoryTotalBytes : null,
            storageFreeBytes: info.storageFreeBytes != null ? info.storageFreeBytes : null,
            deviceUptimeSec: info.deviceUptimeSec != null ? info.deviceUptimeSec : null,
          },
        });
        // Dispatch extended telemetry: network_info + heartbeat extras (mirrors nexari-tizen)
        if (window.API && typeof API.sendTelemetry === 'function') {
          API.sendTelemetry(state.deviceId, info).catch(function() {});
        }
      } catch (e) {
        logger.warn('[WS] heartbeat failed: ' + (e && e.message));
      }
    }

    if (window.Telemetry && typeof Telemetry.getSystemInfo === 'function') {
      try {
        var p = Telemetry.getSystemInfo();
        if (p && typeof p.then === 'function') {
          p.then(function(info) { doSend(info); }).catch(function() { doSend({}); });
        } else {
          doSend(p || {});
        }
      } catch (_) { doSend({}); }
    } else {
      doSend({});
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
      // Re-subscribe to any calendar content currently on screen
      // (WS subscription is lost on reconnect)
      if (window.EpaperCalendar) {
        EpaperCalendar.resubscribeAll();
      }
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

    /** Send a raw message object — used by API.sendTelemetry() */
    push: function(msg) { return send(msg); },

    isOpen: function() { return !!(state.socket && state.socket.readyState === 1); },

    stop: function() {
      state.closed = true;
      if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
      if (state.socket) { try { state.socket.close(); } catch (_) {} state.socket = null; }
      state.started = false;
    },
  };
})();
