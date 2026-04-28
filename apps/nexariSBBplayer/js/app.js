/**
 * Nexari SBB Player — app.js
 * Tizen 4 compatible: var-based, no arrow functions in critical paths,
 * no ES6 modules, no ??, no shorthand properties.
 *
 * Key 1 on remote (keyCode 49) → toggle console log overlay
 * BACK / ESC                   → close overlay
 */

(function() {
  'use strict';

  /* ================================================================
     CONSOLE LOG INTERCEPT — runs before everything else
     ================================================================ */
  var LOG_MAX = 500;
  var logLines = [];
  var logOverlayVisible = false;

  var _origLog   = console.log   || function() {};
  var _origInfo  = console.info  || function() {};
  var _origWarn  = console.warn  || function() {};
  var _origError = console.error || function() {};
  var _origDebug = console.debug || function() {};

  function padTwo(n) { return n < 10 ? '0' + n : '' + n; }

  function nowTs() {
    var d = new Date();
    return padTwo(d.getHours()) + ':' + padTwo(d.getMinutes()) + ':' + padTwo(d.getSeconds()) + '.' + (d.getMilliseconds() < 100 ? '0' : '') + d.getMilliseconds();
  }

  function argsToStr(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === null) { parts.push('null'); continue; }
      if (a === undefined) { parts.push('undefined'); continue; }
      if (typeof a === 'object') {
        try { parts.push(JSON.stringify(a)); } catch (ex) { parts.push(String(a)); }
      } else {
        parts.push(String(a));
      }
    }
    return parts.join(' ');
  }

  function pushLog(level, args) {
    var entry = { ts: nowTs(), level: level, msg: argsToStr(args) };
    logLines.push(entry);
    if (logLines.length > LOG_MAX) { logLines.shift(); }
    if (logOverlayVisible) { appendLogLine(entry); updateLogCount(); }
  }

  console.log   = function() { _origLog.apply(console, arguments);   pushLog('log',   arguments); };
  console.info  = function() { _origInfo.apply(console, arguments);  pushLog('info',  arguments); };
  console.warn  = function() { _origWarn.apply(console, arguments);  pushLog('warn',  arguments); };
  console.error = function() { _origError.apply(console, arguments); pushLog('error', arguments); };
  console.debug = function() { _origDebug.apply(console, arguments); pushLog('debug', arguments); };

  window.onerror = function(msg, src, line, col) {
    pushLog('error', ['[UNCAUGHT] ' + msg + ' @ ' + src + ':' + line + ':' + col]);
    return false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    var r = e.reason;
    pushLog('error', ['[REJECTION] ' + (r && r.message ? r.message : String(r))]);
  });

  /* ================================================================
     LOG OVERLAY DOM HELPERS
     ================================================================ */
  function getLogBody()    { return document.getElementById('log-body'); }
  function getLogCount()   { return document.getElementById('log-count'); }
  function getLogOverlay() { return document.getElementById('log-overlay'); }

  function updateLogCount() {
    var el = getLogCount();
    if (el) { el.textContent = logLines.length + ' lines'; }
  }

  function appendLogLine(entry) {
    var body = getLogBody();
    if (!body) { return; }
    var row = document.createElement('div');
    row.className = 'log-line log-level-' + entry.level;
    var ts   = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = entry.ts;
    var lvl  = document.createElement('span');
    lvl.textContent = '[' + entry.level.toUpperCase() + '] ';
    var msg  = document.createElement('span');
    msg.textContent = entry.msg;
    row.appendChild(ts);
    row.appendChild(lvl);
    row.appendChild(msg);
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function renderAllLogs() {
    var body = getLogBody();
    if (!body) { return; }
    body.innerHTML = '';
    for (var i = 0; i < logLines.length; i++) {
      appendLogLine(logLines[i]);
    }
    body.scrollTop = body.scrollHeight;
    updateLogCount();
  }

  function clearLogs() {
    logLines = [];
    var body = getLogBody();
    if (body) { body.innerHTML = ''; }
    updateLogCount();
    console.info('Log cleared');
  }

  function showLogOverlay() {
    var el = getLogOverlay();
    if (!el) { return; }
    el.classList.remove('hidden');
    logOverlayVisible = true;
    renderAllLogs();
  }

  function hideLogOverlay() {
    var el = getLogOverlay();
    if (!el) { return; }
    el.classList.add('hidden');
    logOverlayVisible = false;
  }

  function toggleLogOverlay() {
    if (logOverlayVisible) { hideLogOverlay(); } else { showLogOverlay(); }
  }

  /* ================================================================
     REMOTE KEY REGISTRATION (Tizen 4)
     All non-mandatory keys require registerKey().
     We use getSupportedKeys() to discover the actual key name for
     keyCode 49 ('1') — the name is device-specific.
     Logs the full supported key list so we can inspect from overlay.
     ================================================================ */
  var KEY_TOGGLE_LOG = 49; /* keyCode for '1' */

  function registerKeys() {
    try {
      if (!window.tizen || !tizen.tvinputdevice) {
        console.warn('tizen.tvinputdevice not available — skipping key registration');
        return;
      }
      var supported = tizen.tvinputdevice.getSupportedKeys();
      var nameFor49 = null;
      var names = [];
      for (var i = 0; i < supported.length; i++) {
        names.push(supported[i].name + '=' + supported[i].code);
        if (supported[i].code === KEY_TOGGLE_LOG) {
          nameFor49 = supported[i].name;
        }
      }
      console.info('Supported keys (' + supported.length + '): ' + names.join(', '));

      if (nameFor49) {
        tizen.tvinputdevice.registerKey(nameFor49);
        console.info('Registered key for toggle log: ' + nameFor49 + ' (code ' + KEY_TOGGLE_LOG + ')');
      } else {
        /* keyCode 49 not in supported list — try literal '1' as fallback */
        try {
          tizen.tvinputdevice.registerKey('1');
          console.info('Registered key via fallback name: 1');
        } catch (fe) {
          console.warn('Key code 49 not supported on this device: ' + fe.message);
        }
      }
    } catch (e) {
      console.warn('registerKeys error: ' + e.message);
    }
  }

  document.addEventListener('keydown', function(e) {
    var k = e.keyCode;
    console.debug('keydown: ' + k);
    if (k === KEY_TOGGLE_LOG) {
      toggleLogOverlay();
    } else if (k === 10009 || k === 27) { /* RETURN / ESC — close overlay if open */
      if (logOverlayVisible) { hideLogOverlay(); }
    }
  });

  /* ================================================================
     DOM refs
     ================================================================ */
  var elModel     = document.getElementById('device-model');
  var elIp        = document.getElementById('device-ip');
  var elSerial    = document.getElementById('device-serial');
  var elDuid      = document.getElementById('device-duid');
  var elFw        = document.getElementById('device-fw');
  var elRealModel = document.getElementById('device-realmodel');
  var elLocale    = document.getElementById('device-locale');
  var elStatus    = document.getElementById('app-status');

  function setText(el, value) {
    if (el) { el.textContent = value; }
  }

  function setStatus(msg) {
    setText(elStatus, msg);
    console.info('[Status] ' + msg);
  }

  /* ================================================================
     DEVICE INFO DETECTION
     ================================================================ */
  function detectModel() {
    try {
      if (window.webapis && webapis.productinfo) {
        var model = webapis.productinfo.getModel();
        setText(elModel, 'Model: ' + (model || 'Unknown'));
        console.info('Model: ' + model);
      } else {
        setText(elModel, 'Model: N/A');
        console.warn('webapis.productinfo not available');
      }
    } catch (e) {
      setText(elModel, 'Model: Error');
      console.error('detectModel: ' + e.message);
    }
  }

  function detectRealModel() {
    try {
      if (window.webapis && webapis.productinfo) {
        var real = webapis.productinfo.getRealModel();
        var code = webapis.productinfo.getModelCode();
        setText(elRealModel, 'Full Model: ' + (real || 'Unknown') + (code ? ' (' + code + ')' : ''));
        console.info('RealModel: ' + real + ' ModelCode: ' + code);
      } else {
        setText(elRealModel, 'Full Model: N/A');
      }
    } catch (e) {
      setText(elRealModel, 'Full Model: Error');
      console.error('detectRealModel: ' + e.message);
    }
  }

  function detectFirmware() {
    try {
      if (window.webapis && webapis.productinfo) {
        var fw = webapis.productinfo.getFirmware();  /* correct API name */
        setText(elFw, 'Firmware: ' + (fw || 'Unknown'));
        console.info('Firmware: ' + fw);
      } else {
        setText(elFw, 'Firmware: N/A');
      }
    } catch (e) {
      setText(elFw, 'Firmware: Error');
      console.error('detectFirmware: ' + e.message);
    }
  }

  function detectSerial() {
    /* Try multiple sources in priority order (same strategy as nexari-tizen):
       1. webapis.productinfo.getSerialNumber()
       2. tizen.tvinfo.getDeviceId()
       3. webapis.systemcontrol.getSerialNumber()
       4. b2bapis.b2bcontrol.getSerialNumber()  ← most reliable on SBB */
    var serial = null;
    var source = null;
    try {
      if (window.webapis && webapis.productinfo && typeof webapis.productinfo.getSerialNumber === 'function') {
        serial = webapis.productinfo.getSerialNumber();
        source = 'productinfo';
      }
    } catch (e) { console.debug('productinfo.getSerialNumber: ' + e.message); }

    try {
      if (!serial && window.tizen && tizen.tvinfo && typeof tizen.tvinfo.getDeviceId === 'function') {
        serial = tizen.tvinfo.getDeviceId();
        source = 'tvinfo';
      }
    } catch (e) { console.debug('tvinfo.getDeviceId: ' + e.message); }

    try {
      if (!serial && window.webapis && webapis.systemcontrol && typeof webapis.systemcontrol.getSerialNumber === 'function') {
        serial = webapis.systemcontrol.getSerialNumber();
        source = 'systemcontrol';
      }
    } catch (e) { console.debug('systemcontrol.getSerialNumber: ' + e.message); }

    try {
      if (!serial && window.b2bapis && b2bapis.b2bcontrol && typeof b2bapis.b2bcontrol.getSerialNumber === 'function') {
        serial = b2bapis.b2bcontrol.getSerialNumber();
        source = 'b2bcontrol';
      }
    } catch (e) { console.debug('b2bcontrol.getSerialNumber: ' + e.message); }

    if (serial) {
      setText(elSerial, 'Serial: ' + serial);
      console.info('Serial (' + source + '): ' + serial);
    } else {
      setText(elSerial, 'Serial: N/A');
      console.warn('Serial number not available from any source');
    }
  }

  function detectDuid() {
    /* DUID is the device UUID — from webapis.productinfo.getDuid() */
    try {
      if (window.webapis && webapis.productinfo && typeof webapis.productinfo.getDuid === 'function') {
        var duid = webapis.productinfo.getDuid();
        setText(elDuid, 'UUID (DUID): ' + (duid || 'Unknown'));
        console.info('DUID: ' + duid);
      } else {
        setText(elDuid, 'UUID (DUID): N/A');
        console.warn('webapis.productinfo.getDuid not available');
      }
    } catch (e) {
      setText(elDuid, 'UUID (DUID): Error');
      console.error('detectDuid: ' + e.message);
    }
  }

  function detectLocale() {
    try {
      if (window.webapis && webapis.productinfo) {
        var locale = webapis.productinfo.getLocalSet();
        setText(elLocale, 'Locale: ' + (locale || 'Unknown'));
        console.info('LocalSet: ' + locale);
      } else {
        setText(elLocale, 'Locale: N/A');
      }
    } catch (e) {
      setText(elLocale, 'Locale: Error');
      console.error('detectLocale: ' + e.message);
    }
  }

  function detectIp() {
    try {
      if (window.tizen && tizen.systeminfo) {
        tizen.systeminfo.getPropertyValue(
          'NETWORK',
          function(info) {
            var ip = 'Unknown';
            try { ip = info.ipAddress || info.Ipv4Address || 'Unknown'; } catch (ex) { /* ignore */ }
            setText(elIp, 'IP: ' + ip);
            console.info('IP: ' + ip);
          },
          function(err) {
            setText(elIp, 'IP: Unavailable');
            console.warn('getPropertyValue NETWORK failed: ' + (err && err.message ? err.message : err));
          }
        );
      } else {
        setText(elIp, 'IP: N/A');
        console.warn('tizen.systeminfo not available');
      }
    } catch (e) {
      setText(elIp, 'IP: Error');
      console.error('detectIp: ' + e.message);
    }
  }

  /* ================================================================
     INIT
     ================================================================ */
  function init() {
    console.info('Nexari SBB Player — init');
    registerKeys();
    setStatus('Nexari SBB Player ready');
    detectModel();
    detectRealModel();
    detectFirmware();
    detectSerial();
    detectDuid();
    detectLocale();
    detectIp();
    console.info('Init complete. Press key 1 on remote to toggle log.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

