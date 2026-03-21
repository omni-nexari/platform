// Server Configuration
// Defaults can be overridden at runtime via:
//   1) window.__PLAYER_CONFIG__ (injected script before this file)
//   2) localStorage keys: PLAYER_API_BASE, PLAYER_WS_URL
// If WS_URL is omitted, it will be derived from API_BASE (ws/wss + host:port).
const defaultConfig = {
  // Backend API base URL
  API_BASE: 'https://ds.chiho.app/api/v1',

  // WebSocket URL for real-time updates
  WS_URL: 'wss://ds.chiho.app',

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
  DEBUG: false,

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
      logger._send('debug', args);
    }
  },
  info: (...args) => {
    console.log('[INFO]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'info', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._send('info', args);
  },
  warn: (...args) => {
    console.warn('[WARN]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'warn', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._send('warn', args);
  },
  error: (...args) => {
    console.error('[ERROR]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'error', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    logger._send('error', args);
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, logger };
}
