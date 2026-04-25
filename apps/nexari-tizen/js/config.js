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

const PersistentLogStore = {
  key: 'nexari.tizen.logs',
  updatedAtKey: 'nexari.tizen.logs.updatedAt',
  max: 300,

  load() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-this.max).map(function(entry) {
        return {
          level: entry && entry.level ? String(entry.level) : 'info',
          time: entry && entry.time ? String(entry.time) : '--:--:--',
          text: entry && entry.text ? String(entry.text) : '',
        };
      });
    } catch (error) {
      return [];
    }
  },

  save(entries) {
    try {
      if (typeof localStorage === 'undefined') return;
      const safeEntries = Array.isArray(entries) ? entries.slice(-this.max) : [];
      localStorage.setItem(this.key, JSON.stringify(safeEntries));
      localStorage.setItem(this.updatedAtKey, String(Date.now()));
    } catch (error) {}
  },

  clear() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.key);
      localStorage.setItem(this.updatedAtKey, String(Date.now()));
    } catch (error) {}
  },

  exportText(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return safeEntries.map(function(entry) {
      const level = entry && entry.level ? String(entry.level).toUpperCase() : 'INFO';
      const time = entry && entry.time ? String(entry.time) : '--:--:--';
      const text = entry && entry.text ? String(entry.text) : '';
      return '[' + time + '] [' + level + '] ' + text;
    }).join('\n');
  },

  getUpdatedAt() {
    try {
      if (typeof localStorage === 'undefined') return '0';
      return localStorage.getItem(this.updatedAtKey) || '0';
    } catch (error) {
      return '0';
    }
  }
};

if (typeof window !== 'undefined') {
  window.PersistentLogStore = PersistentLogStore;
}

// ── On-screen Log Console ─────────────────────────────────────────────────────
const UiLog = {
  _entries: PersistentLogStore.load(),
  _max: PersistentLogStore.max,
  _visible: false,
  _followTail: true,
  _filter: 'all',
  _controlIndex: 0,
  _controls: ['ui-log-filter-all', 'ui-log-filter-error', 'ui-log-filter-warn', 'ui-log-filter-info', 'ui-log-filter-debug', 'ui-log-top', 'ui-log-older', 'ui-log-newer', 'ui-log-latest', 'ui-log-clear'],

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
    PersistentLogStore.save(this._entries);
    if (this._visible) this._render();
  },

  _render() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    const previousTop = el.scrollTop;
    const colors = { debug: '#7a8299', info: '#4ff2d1', warn: '#f59e0b', error: '#ff3ea5' };
    const filteredEntries = this._getFilteredEntries();
    let html = '';
    for (let i = 0; i < filteredEntries.length; i++) {
      const e = filteredEntries[i];
      const c = colors[e.level] || '#e8eaf0';
      const msg = String(e.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += '<div class="ul-row"><span class="ul-time">' + e.time + '</span>' +
              '<span class="ul-lvl" style="color:' + c + '">[' + e.level.toUpperCase() + ']</span>' +
              '<span class="ul-msg">' + msg + '</span></div>';
    }
    el.innerHTML = html;
    if (this._followTail) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = previousTop;
    }
    this._updateStatus();
    this._syncControls();
  },

  toggle() {
    const panel = document.getElementById('ui-log-panel');
    if (!panel) return;
    this._visible = !this._visible;
    panel.style.display = this._visible ? 'flex' : 'none';
    if (this._visible) {
      this._syncControls();
      this._render();
    }
  },

  clear() {
    this._entries = [];
    this._followTail = true;
    PersistentLogStore.clear();
    const el = document.getElementById('ui-log-list');
    if (el) el.innerHTML = '';
    this._updateStatus();
    this._syncControls();
  },

  setFilter(filter) {
    this._filter = filter || 'all';
    this._followTail = true;
    this._render();
  },

  scrollToTop() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    this._followTail = false;
    el.scrollTop = 0;
    this._updateStatus();
  },

  scrollToBottom() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    this._followTail = true;
    el.scrollTop = el.scrollHeight;
    this._updateStatus();
  },

  scrollOlder() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    this._followTail = false;
    el.scrollTop = Math.max(0, el.scrollTop - Math.max(120, Math.floor(el.clientHeight * 0.75)));
    this._updateStatus();
  },

  scrollNewer() {
    const el = document.getElementById('ui-log-list');
    if (!el) return;
    el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(120, Math.floor(el.clientHeight * 0.75)));
    this._followTail = (el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
    this._updateStatus();
  },

  moveControl(direction) {
    if (!this._controls.length) return;
    this._controlIndex = (this._controlIndex + direction + this._controls.length) % this._controls.length;
    this._syncControls();
  },

  activateControl() {
    const controlId = this._controls[this._controlIndex];
    if (controlId === 'ui-log-filter-all') this.setFilter('all');
    else if (controlId === 'ui-log-filter-error') this.setFilter('error');
    else if (controlId === 'ui-log-filter-warn') this.setFilter('warn');
    else if (controlId === 'ui-log-filter-info') this.setFilter('info');
    else if (controlId === 'ui-log-filter-debug') this.setFilter('debug');
    else if (controlId === 'ui-log-top') this.scrollToTop();
    else if (controlId === 'ui-log-older') this.scrollOlder();
    else if (controlId === 'ui-log-newer') this.scrollNewer();
    else if (controlId === 'ui-log-latest') this.scrollToBottom();
    else if (controlId === 'ui-log-clear') this.clear();
  },

  _getFilteredEntries() {
    if (this._filter === 'all') return this._entries;
    return this._entries.filter(function(entry) {
      return entry.level === UiLog._filter;
    });
  },

  _syncControls() {
    for (var i = 0; i < this._controls.length; i++) {
      var button = document.getElementById(this._controls[i]);
      if (!button) continue;
      if (i === this._controlIndex) button.classList.add('is-active');
      else button.classList.remove('is-active');
      if (this._controls[i] === 'ui-log-filter-' + this._filter) button.classList.add('is-on');
      else if (this._controls[i].indexOf('ui-log-filter-') === 0) button.classList.remove('is-on');
    }
  },

  _updateStatus() {
    const el = document.getElementById('ui-log-list');
    const status = document.getElementById('ui-log-status');
    if (!status) return;
    var mode = this._followTail ? 'Live' : 'History';
    var filteredEntries = this._getFilteredEntries();
    var count = filteredEntries.length;
    var total = this._entries.length;
    var filterLabel = this._filter === 'all' ? 'All' : this._filter.toUpperCase();
    if (!el) {
      status.textContent = mode + ' | ' + filterLabel + ' | ' + count + '/' + total + ' logs';
      return;
    }
    var scrollPct = el.scrollHeight > el.clientHeight
      ? Math.round(100 * el.scrollTop / (el.scrollHeight - el.clientHeight))
      : 100;
    status.textContent = mode + ' | ' + filterLabel + ' | ' + count + '/' + total + ' | ' + scrollPct + '%';
  },
};

if (typeof window !== 'undefined') {
  window.UiLog = UiLog;
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
  _queue: [],
  _flushTimer: null,
  _FLUSH_INTERVAL_MS: 15000,

  setDevice(id) {
    this._deviceId = id;
    // Start periodic flush once we have a device identity
    if (!this._flushTimer) {
      this._flushTimer = setInterval(function() { logger._flush(); }, logger._FLUSH_INTERVAL_MS);
    }
    // Flush on page unload so we don't lose the last batch
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
    // Immediate flush on error so critical entries are not delayed
    if (level === 'error') { this._flush(); }
  },

  _flush() {
    if (this._queue.length === 0 || !this._deviceId) return;
    var batch = this._queue.splice(0, this._queue.length);
    var token = (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
    if (!token) return;
    fetch(CONFIG.API_BASE + '/logs/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ entries: batch, source: 'tizen' }),
    }).catch(function() { /* silent fail — never disrupt the player */ });
  },

  _flushBeacon() {
    if (this._queue.length === 0 || !this._deviceId) return;
    var token = (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
    if (!token) return;
    var batch = this._queue.splice(0, this._queue.length);
    var payload = JSON.stringify({ entries: batch, source: 'tizen' });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.API_BASE + '/logs/ingest', new Blob([payload], { type: 'application/json' }));
    }
  },

  debug: function(...args) {
    if (CONFIG.DEBUG) {
      console.log('[DEBUG]', new Date().toISOString(), ...args);
      try { LogBuffer.add({ level: 'debug', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
      try { UiLog.append('debug', args); } catch (e) {}
      logger._enqueue('debug', args);
    }
  },
  info: function(...args) {
    console.log('[INFO]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'info', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('info', args); } catch (e) {}
    logger._enqueue('info', args);
  },
  warn: function(...args) {
    console.warn('[WARN]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'warn', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('warn', args); } catch (e) {}
    logger._enqueue('warn', args);
  },
  error: function(...args) {
    console.error('[ERROR]', new Date().toISOString(), ...args);
    try { LogBuffer.add({ level: 'error', message: args, timestamp: new Date().toISOString() }); } catch (e) {}
    try { UiLog.append('error', args); } catch (e) {}
    logger._enqueue('error', args);
  },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, logger };
}
