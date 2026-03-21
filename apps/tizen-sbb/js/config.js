// Server Configuration
// Defaults can be overridden at runtime via:
//   1) window.__PLAYER_CONFIG__ (injected script before this file)
//   2) localStorage keys: PLAYER_API_BASE, PLAYER_WS_URL
// If WS_URL is omitted, it will be derived from API_BASE (ws/wss + host:port).
const defaultConfig = {
  // Backend API base URL
  API_BASE: 'http://192.168.1.110:3000/api/v1',

  // WebSocket URL for real-time updates
  WS_URL: 'ws://192.168.1.110:3000',

  // Heartbeat interval (30 seconds)
  HEARTBEAT_INTERVAL: 30000,

  // Full telemetry interval (5 minutes)
  TELEMETRY_INTERVAL: 5 * 60 * 1000,

  // Command polling interval (10 seconds)
  COMMAND_POLL_INTERVAL: 10000,

  // Pairing code expiry check interval (5 seconds)
  PAIRING_CHECK_INTERVAL: 5000,

  // Content refresh interval (1 minute)
  CONTENT_REFRESH_INTERVAL: 60000,

  // Cache settings
  CACHE_VERSION: '1.0.0',
  MAX_CACHE_SIZE: 500 * 1024 * 1024, // 500MB

  // Debug mode
  DEBUG: true,

  // Remote logging
  REMOTE_LOG_ENABLED: true,
  REMOTE_LOG_LEVEL: 'warn', // debug|info|warn|error
};

// Simple in-memory ring buffer for logs (used for remote bursts)
const LogBuffer = {
  max: 300,
  events: [],
  add(entry) {
    this.events.push(entry);
    if (this.events.length > this.max) {
      this.events.splice(0, this.events.length - this.max);
    }
  },
  drain(max = 200) {
    const count = Math.min(max, this.events.length);
    const out = this.events.slice(-count);
    this.events = [];
    return out;
  }
};
if (typeof window !== 'undefined') {
  window.LogBuffer = LogBuffer;
}

// ── On-screen Log Console (shows all log entries as a UI panel) ──────────────
const UiLog = {
  _entries: [],
  _max: 80,
  _visible: false,

  append(level, args) {
    const time = new Date().toTimeString().slice(0, 8);
    let text = '';
    try {
      text = Array.prototype.map.call(args, function(a) {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack.split('\n').slice(1, 3).join('\n') : '');
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
    } catch (e) { text = String(args); }
    this._entries.push({ level, time, text });
    if (this._entries.length > this._max) this._entries.shift();
    if (this._visible) this._render();
  },

  _render() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    const colors = { debug: '#7a8299', info: '#4ff2d1', warn: '#f59e0b', error: '#ff3ea5' };
    let html = '';
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      const c = colors[e.level] || '#e8eaf0';
      const msg = String(e.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += '<div class="ul-row"><span class="ul-time">' + e.time + '</span>' +
              '<span class="ul-lvl" style="color:' + c + '">[' + e.level.toUpperCase() + ']</span>' +
              '<span class="ul-msg">' + msg + '</span></div>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  },

  toggle() {
    const panel = document.getElementById('ui-log-panel');
    if (!panel) return;
    this._visible = !this._visible;
    panel.style.display = this._visible ? 'flex' : 'none';
    if (this._visible) this._render();
  },

  clear() {
    this._entries = [];
    const el = document.getElementById('ui-log-list');
    if (el) el.innerHTML = '';
  },
};

if (typeof window !== 'undefined') {
  window.UiLog = UiLog;
  // PC keyboard shortcut: press L (or Shift+L) to toggle the log panel
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      document.addEventListener('keydown', function(e) {
        if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (typeof UiLog !== 'undefined') UiLog.toggle();
        }
      });
    });
  }
}

// ── Override native console so ALL console.* calls appear in UiLog ───────────
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  (function() {
    var _origLog   = console.log   ? console.log.bind(console)   : function() {};
    var _origInfo  = console.info  ? console.info.bind(console)  : _origLog;
    var _origWarn  = console.warn  ? console.warn.bind(console)  : _origLog;
    var _origError = console.error ? console.error.bind(console) : _origLog;
    var _origDebug = console.debug ? console.debug.bind(console) : _origLog;

    function _toUi(level, args) {
      try { UiLog.append(level, Array.prototype.slice.call(args)); } catch (e) {}
    }

    console.log   = function() { _origLog.apply(console, arguments);   _toUi('info',  arguments); };
    console.info  = function() { _origInfo.apply(console, arguments);  _toUi('info',  arguments); };
    console.warn  = function() { _origWarn.apply(console, arguments);  _toUi('warn',  arguments); };
    console.error = function() { _origError.apply(console, arguments); _toUi('error', arguments); };
    console.debug = function() { _origDebug.apply(console, arguments); _toUi('debug', arguments); };
  })();
}

const injectedConfig = (typeof window !== 'undefined' && window.__PLAYER_CONFIG__) || {};

const storageApiBase = (typeof localStorage !== 'undefined' && localStorage.getItem('PLAYER_API_BASE')) || null;
const storageWsUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('PLAYER_WS_URL')) || null;

const CONFIG = Object.assign({}, defaultConfig, injectedConfig);

if (storageApiBase) {
  CONFIG.API_BASE = storageApiBase;
}

if (storageWsUrl) {
  CONFIG.WS_URL = storageWsUrl;
}

// Derive WS_URL from API_BASE if not explicitly set
if (!CONFIG.WS_URL && CONFIG.API_BASE) {
  try {
    const apiUrl = new URL(CONFIG.API_BASE);
    const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    CONFIG.WS_URL = `${wsProtocol}//${apiUrl.host}`;
  } catch (err) {
    console.warn('[CONFIG] Failed to derive WS_URL from API_BASE:', (err && err.message) || err);
  }
}

// Logging helper
const logger = {
  _deviceId: null,
  setDevice(id) {
    this._deviceId = id;
  },
  _shouldRemote(level) {
    if (!CONFIG.REMOTE_LOG_ENABLED || !this._deviceId) return false;
    const levels = { debug: 10, info: 20, warn: 30, error: 40 };
    const threshold = levels[CONFIG.REMOTE_LOG_LEVEL] !== undefined ? levels[CONFIG.REMOTE_LOG_LEVEL] : 30;
    return ((levels[level] !== undefined ? levels[level] : 30) >= threshold);
  },
  async _send(level, args) {
    if (!this._shouldRemote(level)) return;
    try {
      const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      await API.sendLog(this._deviceId, {
        level,
        message,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Do not throw; keep console intact
    }
  },
  debug: (...args) => {
    if (CONFIG.DEBUG) {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
      try { LogBuffer.add({ level: 'debug', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
      try { UiLog.append('debug', args); } catch (e) {}
      logger._send('debug', args);
    }
  },
  info: (...args) => {
    console.log('[INFO]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'info', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('info', args); } catch (e) {}
    logger._send('info', args);
  },
  warn: (...args) => {
    console.warn('[WARN]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'warn', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('warn', args); } catch (e) {}
    logger._send('warn', args);
  },
  error: (...args) => {
    console.error('[ERROR]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'error', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('error', args); } catch (e) {}
    logger._send('error', args);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, logger };
}

// Auto-show log panel immediately when DEBUG is on
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    if (CONFIG.DEBUG && typeof UiLog !== 'undefined') {
      UiLog._visible = true;
      var p = document.getElementById('ui-log-panel');
      if (p) p.style.display = 'flex';
    }
  });
}
