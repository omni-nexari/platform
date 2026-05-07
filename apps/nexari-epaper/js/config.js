// Nexari E-Paper — Server Configuration
// Defaults can be overridden at runtime via:
//   1) window.__PLAYER_CONFIG__ (injected by build-info.js at build time)
//   2) localStorage keys: PLAYER_API_BASE, PLAYER_WS_URL
const defaultConfig = {
  API_BASE: 'https://ds.chiho.app/api/v1',
  WS_URL: 'wss://ds.chiho.app',

  HEARTBEAT_INTERVAL: 60000,            // 60s — e-paper trades latency for battery
  TELEMETRY_INTERVAL: 5 * 60 * 1000,    // 5 min full telemetry
  PAIRING_CHECK_INTERVAL: 5000,         // 5s pairing status poll
  CONTENT_REFRESH_INTERVAL: 60000,      // 60s playlist freshness check (only used if WS is down)

  CACHE_VERSION: '1.0.0',
  MAX_CACHE_SIZE: 500 * 1024 * 1024,    // 500MB image cache cap (Phase 1 will use)

  // E-Paper specific defaults — also stored per-device in epaper_settings_json
  EPAPER_DEFAULT_REFRESH_TIME: { hour: 2, minute: 0 },  // daily full panel refresh @ 02:00
  EPAPER_DEFAULT_AUTO_SLEEP: 'NEVER',                   // push-first → no auto-sleep by default
  EPAPER_MIN_SWAP_RATE_SEC: 15,                         // hard floor — panel can't refresh faster

  DEBUG: false,
  REMOTE_LOG_ENABLED: true,
  REMOTE_LOG_LEVEL: 'info',
};

// Simple in-memory ring buffer for logs (used for remote bursts + WS log stream)
const LogBuffer = {
  max: 300,
  events: [],
  add(entry) {
    this.events.push(entry);
    if (this.events.length > this.max) {
      this.events.splice(0, this.events.length - this.max);
    }
  },
  /** Drain up to `n` entries (oldest first). Returns the drained entries. */
  drain(n) {
    if (!n || this.events.length === 0) return [];
    return this.events.splice(0, Math.min(n, this.events.length));
  },
};
if (typeof window !== 'undefined') window.LogBuffer = LogBuffer;

const injectedConfig = (typeof window !== 'undefined' && window.__PLAYER_CONFIG__) || {};
const storageApiBase = (typeof localStorage !== 'undefined' && localStorage.getItem('PLAYER_API_BASE')) || null;
const storageWsUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('PLAYER_WS_URL')) || null;

const CONFIG = Object.assign({}, defaultConfig, injectedConfig);
if (storageApiBase) CONFIG.API_BASE = storageApiBase;
if (storageWsUrl) CONFIG.WS_URL = storageWsUrl;

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

// ── Logger ──────────────────────────────────────────────────────────────────
const logger = {
  _deviceId: null,
  _queue: [],
  _flushTimer: null,
  _FLUSH_INTERVAL_MS: 15000,

  setDevice(id) {
    this._deviceId = id;
    if (!this._flushTimer) {
      this._flushTimer = setInterval(function() { logger._flush(); }, logger._FLUSH_INTERVAL_MS);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', function() { logger._flushBeacon(); });
      window.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') logger._flushBeacon();
      });
    }
  },

  _levelNum(level) {
    var levels = { debug: 10, info: 20, warn: 30, error: 40 };
    return levels[level] !== undefined ? levels[level] : 20;
  },

  _shouldRemote(level) {
    if (!CONFIG.REMOTE_LOG_ENABLED || !this._deviceId) return false;
    var threshold = this._levelNum(CONFIG.REMOTE_LOG_LEVEL);
    return this._levelNum(level) >= threshold;
  },

  _enqueue(level, args) {
    if (!this._shouldRemote(level)) return;
    var message = args.map(function(a) {
      return typeof a === 'string' ? a : JSON.stringify(a);
    }).join(' ');
    this._queue.push({ level: level, message: message.slice(0, 4000), createdAt: new Date().toISOString() });
    if (level === 'error') this._flush();
  },

  _flush() {
    if (this._queue.length === 0 || !this._deviceId) return;
    var batch = this._queue.splice(0, this._queue.length);
    var token = (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
    if (!token) return;
    fetch(CONFIG.API_BASE + '/logs/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ entries: batch, source: 'epaper' }),
    }).catch(function() { /* silent */ });
  },

  _flushBeacon() {
    if (this._queue.length === 0 || !this._deviceId) return;
    var token = (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
    if (!token) return;
    var batch = this._queue.splice(0, this._queue.length);
    var payload = JSON.stringify({ entries: batch, source: 'epaper' });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.API_BASE + '/logs/ingest', new Blob([payload], { type: 'application/json' }));
    }
  },

  debug: function(...args) {
    if (CONFIG.DEBUG) {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
      try { LogBuffer.add({ level: 'debug', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
      logger._enqueue('debug', args);
    }
  },
  info: function(...args) {
    console.log('[INFO]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'info', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._enqueue('info', args);
  },
  warn: function(...args) {
    console.warn('[WARN]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'warn', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._enqueue('warn', args);
  },
  error: function(...args) {
    console.error('[ERROR]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'error', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._enqueue('error', args);
  },
};

if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
  window.logger = logger;
}
