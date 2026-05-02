/**
 * MDC Bridge — all MDC/HTTP logic for the Nexari Player.
 *
 * This module is require()'d by the thin signed stub:
 *   lib/server2016.js.signed (SSSP4/Tizen 2.4)  →  require('../js/mdc.js')()
 *   lib/server2017.js.signed (SSSP5/Tizen 3.0)  →  require('../js/mdc.js')()
 *   lib/server2018.js.signed (SSSP6/Tizen 4.0)  →  require('../js/mdc.js')()
 *   lib/server2019.js.signed (SSSP7/Tizen 5.0)  →  require('../js/mdc.js')()
 *   lib/server2022.js.signed (SSSP8+/Tizen 6+)  →  require('../js/mdc.js')()
 *   server.js (unsigned dev root)               →  require('./js/mdc.js')()
 *
 * Only the tiny stub files in lib/ are submitted to Samsung for signing.
 * Update THIS file freely — no re-signing required.
 * Keep to Node built-in modules only — no node_modules.
 */
'use strict';

var http = require('http');
var net  = require('net');
var fs   = require('fs');
var path = require('path');
var dgram = require('dgram');

module.exports = function startMdcBridge() {

// ── MDC protocol constants ────────────────────────────────────────────────
var MDC_TCP_PORT     = 1515;
var HTTP_PORT        = 9615;
var SYNC_UDP_PORT    = 9618;
var CONNECT_TIMEOUT  = 3000;

// ── Static content directory (also parent of sync-manifest.json) ─────────
var CONTENT_DIR     = '/opt/usr/home/owner/apps_rw/fmDBbBnvJM/data/content';
var SYNC_DATA_DIR   = path.dirname(CONTENT_DIR);  // .../data
var MANIFEST_PATH   = path.join(SYNC_DATA_DIR, 'sync-manifest.json');

// ── Sync-peer coordination state ─────────────────────────────────────────
// Keyed by syncGroupId string.
// ready: this device's sync content is downloaded and prepared.
// startAt: timestamp (ms) at which to start SyncPlay, pushed by leader.
var syncPeerState = {}; // { [syncGroupId]: { ready: boolean, startAt: number|null } }

// ── SyncPlay LAN mesh state (Phase 1) ────────────────────────────────────
// Identity of this device in the sync mesh (set by player via POST /sync/identity).
var syncIdentity = { deviceId: null, groupId: null, priority: 99 };

// NTP offset (ms) reported by the player after each server-NTP sync.
// Added to Date.now() in /time so follower peer-NTP aligns to server UTC,
// not raw wall-clock, preventing a ~ntpOffset ms drift in SYNC_PLAY timing.
var bridgeNtpOffset = 0;

// Live peer table built from UDP beacons.
// peerTable[deviceId] = { ip, port, priority, groupId, lastSeenAt }
var peerTable = {};
var PEER_TIMEOUT_MS = 6000;
var BEACON_INTERVAL_MS = 2000;

// Cached manifest (also persisted on disk at MANIFEST_PATH).
var manifestCache = null;

// Inbound peer-to-peer sync messages, polled by player.
// Bounded FIFO so a paused player can never OOM the bridge.
var inboundSyncMessages = [];
var INBOUND_SYNC_MAX = 200;
var inboundSyncSeq = 0;

var CMD_KEY          = 0xB0; // Virtual Remote Control
var CMD_STATUS        = 0x00; // Status Control (Get)
var CMD_VIDEO_CONTROL  = 0x04; // Video Control Get
var CMD_RGB_CONTROL    = 0x06; // RGB Control Get
var CMD_MAINTENANCE    = 0x08; // Maintenance Control Get
var CMD_CHILD_DEVICE  = 0x0A; // Child Device Info Get (§2.2.0A.81)
var CMD_SERIAL_NUMBER  = 0x0B; // Serial Number Control Get
var CMD_DISPLAY_STATUS = 0x0D; // Display Status Get
var CMD_SW_VERSION    = 0x0E; // Software Version Get
var CMD_POWER         = 0x11; // Panel Power On/Off
var CMD_VOLUME        = 0x12; // Volume Set/Get
var CMD_MUTE          = 0x13; // Mute Set/Get
var CMD_INPUT_SOURCE  = 0x14; // Input Source Set/Get
var CMD_SCREEN_SIZE    = 0x19; // Screen Size Get
var CMD_NETWORK_CONFIG = 0x1B; // Network config / sub commands
var CMD_MDC_CONN_TYPE = 0x1D; // MDC Connection Type Get/Set (0x00=RS232C, 0x01=RJ45)
var CMD_BRIGHTNESS     = 0x25; // Brightness Get/Set
var CMD_SHARPNESS      = 0x26; // Sharpness Get/Set
var CMD_COLOR          = 0x27; // Color Get/Set
var CMD_RESET         = 0xA1; // Soft restart (model-dependent; no response expected)
var CMD_OSD           = 0x70; // OSD Select: 0x00 = OFF, 0x01 = ON
var CMD_URL_LAUNCHER  = 0xC7; // URL Launcher control (sub 0x82 URL address)
var CMD_DEVICE_NAME   = 0x67; // Device Name Get/Set
var CMD_CLOCK         = 0xA7; // Clock Control (§2.1.A7)
var CMD_MODEL_NAME    = 0x8A; // Model Name Get
var CMD_BRIGHTNESS_SENSOR = 0x86; // Brightness Sensor Get/Set
var CMD_MDC_ID_DISPLAY = 0xB9; // Display ID info hide/show Set
var CMD_STANDBY        = 0x4A; // Standby Control Get/Set (0x00=off, 0x01=on, 0x02=auto)
var CMD_LIGHT_SENSOR   = 0x50; // Light Sensor lux value Get (sub 0x00)
var CMD_OSD_DISPLAY    = 0xA3; // OSD Display Type On/Off Get/Set
var CMD_NETWORK_STANDBY = 0xB5; // Network Standby Get/Set (0x00=off, 0x01=on)
var CMD_AUTO_ID       = 0xB8; // Auto ID Setting Control (§2.1.B8) 0x00=START 0x01=END
var CMD_REMOTE_CONTROL = 0x36; // Remote Control Get/Set (0x00=disable, 0x01=enable)
var CMD_SAFETY_SCREEN_RUN = 0x59; // Safety Screen Run Get/Set
var CMD_SAFETY_LOCK    = 0x5D; // Safety Lock Get/Set (0x00=off, 0x01=on)
var CMD_TICKER         = 0x63; // Ticker Get/Set
var CMD_ORIENTATION   = 0xC8; // Orientation Get/Set (sub 0x81=menu, 0x82=source content)
var CMD_POWER_BUTTON  = 0xCA; // Power Button Get/Set (sub 0x91; 0x00=power-on-only, 0x01=toggle)

// On-Timer command bytes for slots 1–7 (Samsung MDC)
// Note: slots 4-7 skip 0xA7 (that's CMD_CLOCK) and 0xA8/0xA9/0xAA (off-timer slots 1-3 TBD)
var ON_TIMER_CMDS  = [0xA4, 0xA5, 0xA6, 0xAB, 0xAC, 0xAD, 0xAE];

// Samsung MDC input source byte values (common commercial display values)
var INPUT_SOURCES = {
  'HDMI1':     0x21,
  'HDMI2':     0x23,
  'HDMI3':     0x31,
  'HDMI4':     0x33,
  'INTERNAL_USB': 0x62,
  'PC':        0x14,
  'DVI':       0x18,
  'DP':        0x25,
  'AV':        0x08,
  'COMPONENT': 0x0C,
};

// Keys that require OSD to be unlocked first (Samsung SBB B2B OSD lock default)
// NOTE: MENU removed — MDC VRC (0xB0) bypasses OSD lock directly; OSD unlock
// was interfering. HOME kept since it may need it on some models.
var OSD_REQUIRED_KEYS = { HOME: true };

var KEY_CODES = {
  ARROW_UP:    0x60,
  ARROW_DOWN:  0x61,
  ARROW_LEFT:  0x65,
  ARROW_RIGHT: 0x62,
  ENTER:       0x68,
  RETURN:      0x58,
  MENU:        0x1A,
  HOME:        0x79
};

// ── Active MDC device ID ─────────────────────────────────────────────────
// Discovered at runtime via mdc_id_scan, set explicitly by save_mdc_id,
// or overridden per-request from API payload.displayId.
// In-memory only — persists across requests but resets on server restart.
// The API layer reads devices.mdcId from DB and injects it into
// every mdc_control payload so the correct ID is always used after restart.
var DEVICE_MDC_ID = 0x00;

// ── Packet builder ────────────────────────────────────────────────────────
function buildPacket(cmd, dataBytes, displayId) {
  displayId = (displayId !== undefined && displayId !== null) ? displayId : DEVICE_MDC_ID;
  var len = dataBytes.length;
  var checksum = cmd + displayId + len;
  for (var i = 0; i < dataBytes.length; i++) checksum += dataBytes[i];
  checksum = checksum & 0xff;
  var frame = [0xaa, cmd, displayId, len].concat(dataBytes).concat([checksum]);
  return new Buffer(frame); // Buffer.from not available in Node 6.x used by SSSP
}

function byteHex(value) {
  return (value < 16 ? '0' : '') + value.toString(16);
}

function bufferHex(buf) {
  var parts = [];
  for (var i = 0; i < buf.length; i++) parts.push(byteHex(buf[i]));
  return parts.join(' ');
}

// ── MDC serial queue ──────────────────────────────────────────────────────
// Samsung MDC firmware only handles ONE TCP connection to port 1515 at a time.
// All MDC calls must be serialised — concurrent connects cause ECONNREFUSED → 502.
var mdcQueue = [];
var mdcQueueBusy = false;

function mdcEnqueue(fn) {
  mdcQueue.push(fn);
  if (!mdcQueueBusy) mdcDrain();
}

function mdcDrain() {
  if (mdcQueue.length === 0) { mdcQueueBusy = false; return; }
  mdcQueueBusy = true;
  var next = mdcQueue.shift();
  next(function() { mdcDrain(); });
}

// ── TCP sender ────────────────────────────────────────────────────────────
function sendMdcPacket_raw(packet, cb) {
  var socket = net.createConnection(MDC_TCP_PORT, '127.0.0.1');
  var done = false;

  var timer = setTimeout(function() {
    if (done) return;
    done = true;
    socket.destroy();
    cb(new Error('MDC connect timeout'));
  }, CONNECT_TIMEOUT);

  socket.once('connect', function() {
    socket.write(packet, function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      cb(err || null);
    });
  });

  socket.once('error', function(err) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cb(err);
  });
}
function sendMdcPacket(packet, cb) {
  mdcEnqueue(function(release) {
    sendMdcPacket_raw(packet, function(err) { release(); cb(err); });
  });
}

function sendMdcPacketWithResponse_raw(packet, cb) {
  var socket = net.createConnection(MDC_TCP_PORT, '127.0.0.1');
  var done = false;
  var chunks = [];
  var total = 0;
  var expectedTotal = null;

  function finish(err, result) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    socket.destroy();
    cb(err || null, result || null);
  }

  var timer = setTimeout(function() {
    finish(new Error('MDC status response timeout'));
  }, CONNECT_TIMEOUT);

  socket.once('connect', function() {
    socket.write(packet, function(err) {
      if (err) finish(err);
    });
  });

  socket.on('data', function(chunk) {
    chunks.push(chunk);
    total += chunk.length;

    var buffer = Buffer.concat(chunks, total);
    if (expectedTotal === null && buffer.length >= 4) {
      expectedTotal = 4 + buffer[3] + 1;
    }
    if (expectedTotal !== null && buffer.length >= expectedTotal) {
      finish(null, buffer.slice(0, expectedTotal));
    }
  });

  socket.once('error', function(err) {
    finish(err);
  });
}
function sendMdcPacketWithResponse(packet, cb) {
  mdcEnqueue(function(release) {
    sendMdcPacketWithResponse_raw(packet, function(err, result) { release(); cb(err, result); });
  });
}

function parseStatusResponse(buffer) {
  var rawHex = bufferHex(buffer);
  if (!buffer || buffer.length < 7) {
    return { ok: false, error: 'Short MDC response', rawHex: rawHex };
  }

  var header = buffer[0];
  var command = buffer[1];
  var displayId = buffer[2];
  var length = buffer[3];
  var expectedTotal = 4 + length + 1;
  if (buffer.length < expectedTotal) {
    return { ok: false, error: 'Incomplete MDC response', rawHex: rawHex };
  }
  if (header !== 0xaa) {
    return { ok: false, error: 'Invalid MDC header 0x' + byteHex(header), rawHex: rawHex };
  }
  if (command !== 0xff) {
    return { ok: false, error: 'Unexpected MDC response command 0x' + byteHex(command), rawHex: rawHex };
  }

  var ack = String.fromCharCode(buffer[4]);
  var rCmd = buffer[5];
  if (ack === 'N') {
    return {
      ok: false,
      error: 'MDC NAK 0x' + byteHex(buffer[6] || 0),
      rawHex: rawHex,
      status: { displayId: displayId, ack: 'N', rCmd: rCmd }
    };
  }
  if (ack !== 'A') {
    return { ok: false, error: 'Unexpected MDC ACK byte ' + ack, rawHex: rawHex };
  }
  if (rCmd !== CMD_STATUS) {
    return {
      ok: false,
      error: 'Unexpected returned command 0x' + byteHex(rCmd),
      rawHex: rawHex,
      status: { displayId: displayId, ack: 'A', rCmd: rCmd }
    };
  }
  if (length < 9 || buffer.length < 14) {
    return { ok: false, error: 'Status ACK too short', rawHex: rawHex };
  }

  return {
    ok: true,
    rawHex: rawHex,
    status: {
      displayId: displayId,
      ack: 'A',
      rCmd: rCmd,
      power: buffer[6],
      volume: buffer[7],
      mute: buffer[8],
      input: buffer[9],
      aspect: buffer[10],
      nTime: buffer[11],
      fTime: buffer[12]
    }
  };
}

function parseAckDisplayId(buffer) {
  return buffer && buffer.length >= 3 ? buffer[2] : null;
}

function parseAckFrame(buffer, expectedCmd) {
  var rawHex = bufferHex(buffer || new Buffer([]));
  if (!buffer || buffer.length < 7) {
    return { ok: false, error: 'Short MDC response', rawHex: rawHex };
  }
  if (buffer[0] !== 0xAA) {
    return { ok: false, error: 'Invalid MDC header', rawHex: rawHex };
  }
  if (buffer[1] !== 0xFF) {
    return { ok: false, error: 'Unexpected MDC response command', rawHex: rawHex };
  }
  var ack = String.fromCharCode(buffer[4]);
  var rCmd = buffer[5];
  if (ack === 'N') {
    return {
      ok: false,
      error: 'MDC NAK 0x' + byteHex(buffer[6] || 0),
      rawHex: rawHex,
      ack: ack,
      rCmd: rCmd,
      displayId: parseAckDisplayId(buffer)
    };
  }
  if (ack !== 'A') {
    return { ok: false, error: 'Unexpected ACK byte', rawHex: rawHex, ack: ack, rCmd: rCmd, displayId: parseAckDisplayId(buffer) };
  }
  if (expectedCmd != null && rCmd !== expectedCmd) {
    return { ok: false, error: 'Unexpected returned command 0x' + byteHex(rCmd), rawHex: rawHex, ack: ack, rCmd: rCmd, displayId: parseAckDisplayId(buffer) };
  }
  var dataBytes = [];
  for (var i = 6; i < buffer.length - 1; i++) dataBytes.push(buffer[i]);
  return {
    ok: true,
    rawHex: rawHex,
    ack: ack,
    rCmd: rCmd,
    displayId: parseAckDisplayId(buffer),
    data: dataBytes
  };
}

function parseIntClamped(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (isNaN(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function parseIpv4(str, fallback) {
  if (typeof str !== 'string') return fallback;
  var parts = str.split('.');
  if (parts.length !== 4) return fallback;
  var out = [];
  for (var i = 0; i < 4; i++) {
    var n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255) return fallback;
    out.push(n);
  }
  return out;
}

function ipBytesToString(bytes, start) {
  return [
    bytes[start] || 0,
    bytes[start + 1] || 0,
    bytes[start + 2] || 0,
    bytes[start + 3] || 0
  ].join('.');
}

function bytesToAscii(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x20 && bytes[i] <= 0x7E) out += String.fromCharCode(bytes[i]);
  }
  return out.trim();
}

// Scan MDC IDs sequentially; calls cb(err, { displayId, rawHex }) on first ACK
// or cb(null, null) if none respond. timeoutMs per ID, default 800ms.
function scanMdcId(ids, timeoutMs, cb) {
  var idx = 0;
  function next() {
    if (idx >= ids.length) { cb(null, null); return; }
    var displayId = ids[idx++];
    var socket = net.createConnection(MDC_TCP_PORT, '127.0.0.1');
    var chunks = [], total = 0, done = false;
    var timer = setTimeout(function() {
      if (done) return; done = true; socket.destroy(); next();
    }, timeoutMs);
    socket.on('connect', function() {
      socket.write(buildPacket(CMD_STATUS, [], displayId));
    });
    socket.on('data', function(chunk) {
      chunks.push(chunk); total += chunk.length;
      var buf = Buffer.concat(chunks, total);
      if (buf.length >= 4 && buf.length >= 4 + buf[3] + 1) {
        clearTimeout(timer); if (done) return; done = true; socket.destroy();
        if (buf[4] === 65) { // 'A' ACK
          cb(null, { displayId: buf[2], rawHex: bufferHex(buf) });
        } else {
          next(); // NAK — try next ID
        }
      }
    });
    socket.on('error', function() {
      if (done) return; done = true; clearTimeout(timer); next();
    });
  }
  next();
}

function buildCurrentClockPacket() {
  var now    = new Date();
  var cDay   = now.getDate();
  var cMonth = now.getMonth() + 1;
  var cYear  = now.getFullYear();
  var cYear1 = (cYear >> 8) & 0xFF;
  var cYear2 = cYear & 0xFF;
  var cH24   = now.getHours();
  var cMin   = now.getMinutes();
  var cAmpm  = (cH24 < 12) ? 0x01 : 0x00;
  var cH12   = cH24 % 12 || 12;
  return buildPacket(CMD_CLOCK, [cDay, cH12, cMin, cMonth, cYear1, cYear2, cAmpm]);
}

// ── HTTP server ───────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  // CORS for browser fetch from the same origin / localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Sync-peer coordination routes ────────────────────────────────────
  // POST /sync-peer/ready   { syncGroupId }  — mark this device ready
  if (req.method === 'POST' && req.url === '/sync-peer/ready') {
    var body = '';
    req.on('data', function(chunk) { body += chunk.toString(); });
    req.on('end', function() {
      try { var p = JSON.parse(body); var gid = String(p.syncGroupId || ''); } catch(e) { gid = ''; }
      if (!gid) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'missing syncGroupId'})); return; }
      if (!syncPeerState[gid]) syncPeerState[gid] = { ready: false, startAt: null };
      syncPeerState[gid].ready = true;
      console.log('[mdc-bridge] sync-peer/ready: group=' + gid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // GET /sync-peer/status?syncGroupId=X  — returns {ready:bool}
  if (req.method === 'GET' && req.url && req.url.indexOf('/sync-peer/status') === 0) {
    var qs = req.url.split('?')[1] || '';
    var syncGroupIdParam = '';
    qs.split('&').forEach(function(p) { var kv = p.split('='); if (kv[0] === 'syncGroupId') syncGroupIdParam = decodeURIComponent(kv[1] || ''); });
    var state = syncPeerState[syncGroupIdParam] || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: !!state.ready }));
    return;
  }

  // POST /sync-peer/start  { syncGroupId, startAt }  — pushed by leader to follower
  if (req.method === 'POST' && req.url === '/sync-peer/start') {
    var startBody = '';
    req.on('data', function(chunk) { startBody += chunk.toString(); });
    req.on('end', function() {
      var sgid, sat;
      try { var sp = JSON.parse(startBody); sgid = String(sp.syncGroupId || ''); sat = Number(sp.startAt || 0); } catch(e) { sgid = ''; sat = 0; }
      if (!sgid || !sat) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'missing syncGroupId/startAt'})); return; }
      if (!syncPeerState[sgid]) syncPeerState[sgid] = { ready: false, startAt: null };
      syncPeerState[sgid].startAt = sat;
      console.log('[mdc-bridge] sync-peer/start: group=' + sgid + ' startAt=' + sat);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // GET /sync-peer/start-trigger?syncGroupId=X  — follower polls for startAt
  if (req.method === 'GET' && req.url && req.url.indexOf('/sync-peer/start-trigger') === 0) {
    var stqs = req.url.split('?')[1] || '';
    var stSyncGroupId = '';
    stqs.split('&').forEach(function(p) { var kv = p.split('='); if (kv[0] === 'syncGroupId') stSyncGroupId = decodeURIComponent(kv[1] || ''); });
    var stState = syncPeerState[stSyncGroupId] || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ startAt: stState.startAt || null }));
    return;
  }

  // ──────────────────────────────────────────────────────────────────────
  // SyncPlay LAN mesh routes (Phase 1)
  // ──────────────────────────────────────────────────────────────────────

  // GET /time  → server-clock NTP source for peer-to-peer clock sync.
  // Returns NTP-corrected time (Date.now() + bridgeNtpOffset) so follower peer-NTP
  // aligns to server UTC, matching getSyncedTime() across all devices.
  if (req.method === 'GET' && req.url === '/time') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ timestamp: Date.now() + bridgeNtpOffset }));
    return;
  }

  // POST /sync/ntp-offset  { ntpOffset: number }
  // Player calls this after each server-NTP sync to keep bridgeNtpOffset current.
  if (req.method === 'POST' && req.url === '/sync/ntp-offset') {
    var ntpBody = '';
    req.on('data', function(c) { ntpBody += c.toString(); });
    req.on('end', function() {
      try {
        var p = JSON.parse(ntpBody || '{}');
        if (typeof p.ntpOffset === 'number' && isFinite(p.ntpOffset)) {
          bridgeNtpOffset = p.ntpOffset;
        }
      } catch(e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  // POST /sync/identity  { deviceId, groupId, priority }
  // Player calls this once on startup; controls UDP beacon contents.
  if (req.method === 'POST' && req.url === '/sync/identity') {
    var idBody = '';
    req.on('data', function(c) { idBody += c.toString(); });
    req.on('end', function() {
      try {
        var p = JSON.parse(idBody || '{}');
        syncIdentity.deviceId = p.deviceId ? String(p.deviceId) : null;
        syncIdentity.groupId  = p.groupId  ? String(p.groupId)  : null;
        syncIdentity.priority = (typeof p.priority === 'number') ? p.priority : 99;
        console.log('[sync] identity set: deviceId=' + syncIdentity.deviceId +
                    ' groupId=' + syncIdentity.groupId + ' priority=' + syncIdentity.priority);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, identity: syncIdentity }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json: ' + e.message }));
      }
    });
    return;
  }

  // GET /sync/identity  → current identity (debug/diagnostics)
  if (req.method === 'GET' && req.url === '/sync/identity') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(syncIdentity));
    return;
  }

  // POST /sync/manifest  { ...manifest }  → persist manifest to disk + cache.
  // Survives reboot, used as the offline-first source of truth.
  if (req.method === 'POST' && req.url === '/sync/manifest') {
    var mBody = '';
    req.on('data', function(c) { mBody += c.toString(); });
    req.on('end', function() {
      try {
        var manifest = JSON.parse(mBody || '{}');
        if (!manifest.groupId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'manifest missing groupId' }));
          return;
        }
        manifestCache = manifest;
        // Seed peerTable with last-known IPs from manifest so direct WS works
        // before any UDP beacon is received (and as fallback if UDP is filtered).
        if (Array.isArray(manifest.peers)) {
          manifest.peers.forEach(function(p) {
            if (!p || !p.deviceId) return;
            var existing = peerTable[p.deviceId] || {};
            peerTable[p.deviceId] = {
              ip: existing.ip || p.lastKnownIp || null,
              port: p.port || HTTP_PORT,
              priority: typeof p.priority === 'number' ? p.priority : 99,
              groupId: manifest.groupId,
              lastSeenAt: existing.lastSeenAt || 0,  // 0 = manifest-supplied, not yet seen on UDP
            };
          });
        }
        fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest), function(err) {
          if (err) {
            console.warn('[sync] manifest write failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'write failed: ' + err.message }));
            return;
          }
          console.log('[sync] manifest persisted (groupId=' + manifest.groupId +
                      ' version=' + manifest.version + ' peers=' +
                      (Array.isArray(manifest.peers) ? manifest.peers.length : 0) + ')');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, version: manifest.version || 0 }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json: ' + e.message }));
      }
    });
    return;
  }

  // GET /sync/manifest  → return cached manifest (or read from disk on cold-start).
  if (req.method === 'GET' && req.url === '/sync/manifest') {
    if (manifestCache) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(manifestCache));
      return;
    }
    fs.readFile(MANIFEST_PATH, 'utf8', function(err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no cached manifest' }));
        return;
      }
      try { manifestCache = JSON.parse(data); } catch (_) { manifestCache = null; }
      res.writeHead(manifestCache ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(manifestCache ? JSON.stringify(manifestCache) : JSON.stringify({ error: 'manifest corrupted' }));
    });
    return;
  }

  // GET /sync/peers  → live peer table (UDP-discovered + manifest-seeded).
  // Stale entries (lastSeenAt > PEER_TIMEOUT_MS old) are filtered out, but
  // manifest-seeded peers (lastSeenAt = 0) are always returned with seen:false
  // so the player can attempt direct WS / HTTP fallback.
  if (req.method === 'GET' && req.url === '/sync/peers') {
    var nowMs = Date.now();
    var liveList = [];
    Object.keys(peerTable).forEach(function(devId) {
      var p = peerTable[devId];
      if (!p) return;
      var seen = !!p.lastSeenAt && (nowMs - p.lastSeenAt) <= PEER_TIMEOUT_MS;
      var manifestSeeded = !p.lastSeenAt;
      if (!seen && !manifestSeeded) return; // expired UDP entry
      liveList.push({
        deviceId: devId,
        ip: p.ip,
        port: p.port,
        priority: p.priority,
        groupId: p.groupId,
        lastSeenAt: p.lastSeenAt,
        seen: seen,
      });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peers: liveList, self: syncIdentity }));
    return;
  }

  // POST /sync/message  { type, payload, [target] }
  // Inbound from a peer bridge (or this device's player). Buffered for player polling.
  // Player polls GET /sync/messages?since=<seq> at 1 Hz.
  if (req.method === 'POST' && req.url === '/sync/message') {
    var msgBody = '';
    req.on('data', function(c) { msgBody += c.toString(); });
    req.on('end', function() {
      try {
        var msg = JSON.parse(msgBody || '{}');
        if (!msg || !msg.type) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing type' }));
          return;
        }
        inboundSyncSeq++;
        var record = {
          seq: inboundSyncSeq,
          receivedAt: Date.now(),
          type: msg.type,
          fromDeviceId: msg.fromDeviceId || null,
          payload: msg.payload || null,
        };
        inboundSyncMessages.push(record);
        // Bound the buffer: drop oldest.
        if (inboundSyncMessages.length > INBOUND_SYNC_MAX) {
          inboundSyncMessages.splice(0, inboundSyncMessages.length - INBOUND_SYNC_MAX);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, seq: inboundSyncSeq }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json: ' + e.message }));
      }
    });
    return;
  }

  // GET /sync/messages?since=<seq>  → drain buffer
  if (req.method === 'GET' && req.url && req.url.indexOf('/sync/messages') === 0) {
    var smqs = req.url.split('?')[1] || '';
    var sinceSeq = 0;
    smqs.split('&').forEach(function(p) {
      var kv = p.split('=');
      if (kv[0] === 'since') sinceSeq = parseInt(decodeURIComponent(kv[1] || '0'), 10) || 0;
    });
    var pending = inboundSyncMessages.filter(function(m) { return m.seq > sinceSeq; });
    var maxSeq = inboundSyncSeq;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: pending, lastSeq: maxSeq }));
    return;
  }

  if (req.method === 'GET' && req.url === '/serial') {
    // CMD 0x0B with data_len=0 is a GET request that returns the 15-byte serial number
    sendMdcPacketWithResponse(buildPacket(0x0B, []), function(err, buffer) {
      if (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
      var rawHex = bufferHex(buffer);
      if (!buffer || buffer.length < 7) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Short serial response', rawHex: rawHex }));
        return;
      }
      var ack = String.fromCharCode(buffer[4]);
      if (ack !== 'A') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'MDC NAK', rawHex: rawHex }));
        return;
      }
      var dataLen = buffer[3];
      // Response data: [ack(1), rCmd(1), serial_bytes...]
      // Serial starts at buffer[6], length = dataLen - 2
      var serial = '';
      for (var i = 6; i < 4 + dataLen && i < buffer.length - 1; i++) {
        if (buffer[i] && buffer[i] !== 0) serial += String.fromCharCode(buffer[i]);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, serial: serial.trim(), rawHex: rawHex }));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/remote-key') {
    var body = '';
    req.on('data', function(chunk) { body += chunk.toString(); });
    req.on('end', function() {
      var key, packet;
      try {
        var parsed = JSON.parse(body);
        key = parsed.key || '';
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad JSON' }));
        return;
      }

      if (key === 'POWER_ON' || key === 'POWER_OFF') {
        // Use response variant so we can log the real ACK/NAK from the panel.
        // Per Samsung MDC spec: ACK for 0x11 is 0xFF 'A' 0x11 <Power>.
        var powerByte = key === 'POWER_ON' ? 0x01 : 0x00;
        sendMdcPacketWithResponse(buildPacket(CMD_POWER, [powerByte]), function(err, buffer) {
          if (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, key: key, error: err.message }));
            return;
          }
          var rawHex = bufferHex(buffer);
          // ACK frame: AA FF <id> 03 'A' 11 <powerVal> <checksum>
          var ackByte = buffer && buffer.length >= 5 ? String.fromCharCode(buffer[4]) : '?';
          var rCmd   = buffer && buffer.length >= 6 ? buffer[5] : -1;
          var val    = buffer && buffer.length >= 7 ? buffer[6] : -1;
          if (ackByte === 'A') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, key: key, ack: 'A', rCmd: rCmd, val: val, rawHex: rawHex }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, key: key, ack: ackByte, errCode: val, rawHex: rawHex }));
          }
        });
        return;
      } else if (key === 'REBOOT') {
        packet = buildPacket(CMD_RESET, [0x00]);
      } else if (KEY_CODES[key] !== undefined) {
        packet = buildPacket(CMD_KEY, [KEY_CODES[key]]);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown key: ' + key }));
        return;
      }

      // For keys that open menus (MENU, HOME), Samsung SBB B2B OSD lock
      // silently swallows the IR code. Unlock OSD first, then send the key.
      if (OSD_REQUIRED_KEYS[key]) {
        var osdOnPacket = buildPacket(CMD_OSD, [0x01]);
        sendMdcPacket(osdOnPacket, function(osdErr) {
          if (osdErr) {
            // OSD unlock failed — try key anyway
            return sendMdcPacket(packet, function(err) {
              if (err) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, key: key }));
              }
            });
          }
          // Small delay so OSD layer is ready before the IR keycode
          setTimeout(function() {
            sendMdcPacket(packet, function(err) {
              if (err) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, key: key, osdUnlocked: true }));
              }
            });
          }, 200);
        });
        return;
      }

      sendMdcPacket(packet, function(err) {
        if (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, key: key }));
        }
      });
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    sendMdcPacketWithResponse(buildPacket(CMD_STATUS, []), function(err, buffer) {
      if (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
      var parsed = parseStatusResponse(buffer);
      res.writeHead(parsed.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(parsed));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/device-name') {
    // CMD 0x67 with data_len=0 is a GET request (per Samsung MDC spec §2.1.67)
    sendMdcPacketWithResponse(buildPacket(CMD_DEVICE_NAME, []), function(err, buffer) {
      if (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
      var rawHex = bufferHex(buffer);
      if (!buffer || buffer.length < 7) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Short device-name response', rawHex: rawHex }));
        return;
      }
      var ack = String.fromCharCode(buffer[4]);
      if (ack !== 'A') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'MDC NAK for device name', rawHex: rawHex }));
        return;
      }
      var dataLen = buffer[3];
      // ACK data layout: [ack(1), rCmd(1), name_bytes...]
      // → name starts at buffer[6], length = dataLen - 2
      var name = '';
      for (var i = 6; i < 4 + dataLen && i < buffer.length - 1; i++) {
        if (buffer[i] && buffer[i] !== 0) name += String.fromCharCode(buffer[i]);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: name.trim(), rawHex: rawHex }));
    });
    return;
  }

  // ── GET /status-full ─ aggregate status, serial, device-name, model, IP, remote-ctrl ────
  // All MDC commands are sent sequentially because port 1515 only allows one TCP connection.
  if (req.method === 'GET' && req.url === '/status-full') {
    var sfResult = {};

    function sfStep1(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_STATUS, []), function(err, buf) {
        if (!err) {
          var p = parseStatusResponse(buf);
          if (p.ok) sfResult.status = p.status;
        }
        next();
      });
    }
    function sfStep2(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_SERIAL_NUMBER, []), function(err, buf) {
        if (!err) {
          var p = parseAckFrame(buf, CMD_SERIAL_NUMBER);
          if (p.ok) sfResult.serial = bytesToAscii(p.data || []);
        }
        next();
      });
    }
    function sfStep3(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_DEVICE_NAME, []), function(err, buf) {
        if (err) { console.log('[status-full] step3 deviceName err:', err.message); next(); return; }
        var ackChar = buf && buf.length >= 5 ? String.fromCharCode(buf[4]) : '?';
        console.log('[status-full] step3 deviceName ack:', ackChar, 'rawHex:', buf ? bufferHex(buf) : 'null');
        if (!err && buf && buf.length >= 5 && ackChar === 'A') {
          var dLen = buf[3];
          var dName = '';
          for (var di = 6; di < 4 + dLen && di < buf.length - 1; di++) {
            if (buf[di]) dName += String.fromCharCode(buf[di]);
          }
          sfResult.deviceName = dName.trim();
        }
        next();
      });
    }
    function sfStep4(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_MODEL_NAME, []), function(err, buf) {
        if (err) { console.log('[status-full] step4 modelName err:', err.message); next(); return; }
        var p = parseAckFrame(buf, CMD_MODEL_NAME);
        console.log('[status-full] step4 modelName ok:', p.ok, 'data:', p.data, 'rawHex:', p.rawHex);
        if (p.ok) sfResult.modelName = bytesToAscii(p.data || []);
        next();
      });
    }
    function sfStep5(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x82]), function(err, buf) {
        if (err) { console.log('[status-full] step5 networkConfig err:', err.message); next(); return; }
        var p = parseAckFrame(buf, CMD_NETWORK_CONFIG);
        console.log('[status-full] step5 networkConfig ok:', p.ok, 'data:', p.data, 'rawHex:', p.rawHex);
        if (p.ok) {
          var bytes = p.data || [];
          var off = bytes.length > 0 && bytes[0] === 0x82 ? 1 : 0;
          if (bytes.length >= off + 16) sfResult.ipAddress = ipBytesToString(bytes, off);
          else console.log('[status-full] step5 data too short, bytes.length:', bytes.length, 'needed:', off + 16);
        }
        next();
      });
    }
    function sfStep6(next) {
      sendMdcPacketWithResponse(buildPacket(CMD_REMOTE_CONTROL, []), function(err, buf) {
        if (!err && buf && buf.length >= 7 && buf[4] === 65) {
          sfResult.remoteControl = buf[6]; // 0x00=disabled, 0x01=enabled
        }
        next();
      });
    }

    sfStep1(function() {
      sfStep2(function() {
        sfStep3(function() {
          sfStep4(function() {
            sfStep5(function() {
              sfStep6(function() {
                sfResult.ok = true;
                console.log('[status-full] result:', JSON.stringify(sfResult));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(sfResult));
              });
            });
          });
        });
      });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/mdc-control') {
    var mcBody = '';
    req.on('data', function(chunk) { mcBody += chunk.toString(); });
    req.on('end', function() {
      var parsed;
      try { parsed = JSON.parse(mcBody); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad JSON' }));
        return;
      }

      // API injects displayId from devices.mdcId when available.
      // Apply it before building packets so DB scan/save/load is respected.
      if (parsed.displayId != null) {
        var requestDisplayId = parseInt(parsed.displayId, 10);
        if (!isNaN(requestDisplayId) && requestDisplayId >= 0 && requestDisplayId <= 254) {
          DEVICE_MDC_ID = requestDisplayId;
        }
      }

      var action = parsed.action || '';
      var packet;
      if (action === 'set_volume') {
        var level = Math.max(0, Math.min(100, parseInt(parsed.level, 10) || 0));
        packet = buildPacket(CMD_VOLUME, [level]);
      } else if (action === 'set_mute') {
        packet = buildPacket(CMD_MUTE, [parsed.mute ? 0x01 : 0x00]);
      } else if (action === 'set_source') {
        var sourceId = INPUT_SOURCES[parsed.source];
        if (sourceId === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown source: ' + parsed.source }));
          return;
        }
        packet = buildPacket(CMD_INPUT_SOURCE, [sourceId]);
      } else if (action === 'set_device_name') {
        // MDC §2.1.67 SET: variable-length name bytes, max 15 chars
        var devName = (parsed.name || '').slice(0, 15);
        var nameBytes = [];
        for (var ni = 0; ni < devName.length; ni++) {
          nameBytes.push(devName.charCodeAt(ni));
        }
        packet = buildPacket(CMD_DEVICE_NAME, nameBytes);
      } else if (action === 'set_clock') {
        // MDC §2.1.A7 – SET device clock to current server time (Node Date)
        // Data: [Day, H(1-12), M(0-59), Month, Year1(hi), Year2(lo), AMPM]
        var clockPkt = buildCurrentClockPacket();
        console.log('[clock] set pkt=' + bufferHex(clockPkt));
        sendMdcPacketWithResponse(clockPkt, function(clockErr, clockBuf) {
          if (clockErr) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'set_clock: ' + clockErr.message }));
            return;
          }
          console.log('[clock] ack =' + bufferHex(clockBuf));
          var clockAck = clockBuf && String.fromCharCode(clockBuf[4]);
          if (clockAck !== 'A') {
            var nakCode = (clockBuf && clockBuf[6]) ? byteHex(clockBuf[6]) : '??';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, supported: false, error: 'set_clock NAK 0x' + nakCode, rawHex: bufferHex(clockBuf) }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, action: 'set_clock', rawHex: bufferHex(clockBuf) }));
        });
        return;
      } else if (action === 'get_clock') {
        // MDC §2.1.A7 – GET current device clock; async path, no packet variable needed
        sendMdcPacketWithResponse(buildPacket(CMD_CLOCK, []), function(err, buffer) {
          if (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          var rawHex = bufferHex(buffer);
          if (!buffer || buffer.length < 13) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Short clock ACK', rawHex: rawHex }));
            return;
          }
          var ack = String.fromCharCode(buffer[4]);
          if (ack !== 'A') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, supported: false, error: 'MDC NAK for clock', rawHex: rawHex }));
            return;
          }
          var day   = buffer[6];               // 1-31
          var h12   = buffer[7];               // 1-12
          var min   = buffer[8];               // 0-59
          var month = buffer[9];               // 1-12
          var year  = (buffer[10] << 8) | buffer[11]; // Year1=high, Year2=low
          var ampm  = buffer[12];              // 0x00=PM, 0x01=AM
          // Convert 12h+AM/PM to 24h
          var hour24 = ampm === 0x01 ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
          var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
          var iso = year + '-' + pad(month) + '-' + pad(day) + 'T' + pad(hour24) + ':' + pad(min) + ':00';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, time: iso, day: day, hour: hour24, min: min, month: month, year: year, rawHex: rawHex }));
        });
        return; // async – skip the sendMdcPacket call below
      } else if (action === 'network_standby_set') {
        // MDC §2.1.B5 – SET Network Standby (0x00=off, 0x01=on)
        var nsVal = parsed.value ? 0x01 : 0x00;
        packet = buildPacket(CMD_NETWORK_STANDBY, [nsVal]);
      } else if (action === 'status_get') {
        // MDC §2.1.00 – GET Status Control (power, volume, mute, input, aspect, timer bytes)
        sendMdcPacketWithResponse(buildPacket(CMD_STATUS, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedStatus = parseStatusResponse(buf);
          if (!parsedStatus.ok) {
            res.writeHead(502);
            res.end(JSON.stringify(parsedStatus));
            return;
          }
          var status = parsedStatus.status || {};
          res.writeHead(200);
          res.end(JSON.stringify({
            ok: true,
            rawHex: parsedStatus.rawHex,
            displayId: status.displayId,
            data: [status.power, status.volume, status.mute, status.input, status.aspect, status.nTime, status.fTime],
            power: status.power,
            volume: status.volume,
            mute: status.mute,
            input: status.input,
            aspect: status.aspect,
            nTime: status.nTime,
            fTime: status.fTime
          }));
        });
        return;
      } else if (action === 'video_control_get') {
        // MDC §2.1.04 – GET Video Control (contrast/brightness/sharpness/color/tint/color tone/color temp)
        sendMdcPacketWithResponse(buildPacket(CMD_VIDEO_CONTROL, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_VIDEO_CONTROL);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'rgb_control_get') {
        // MDC §2.1.06 – GET RGB Control
        sendMdcPacketWithResponse(buildPacket(CMD_RGB_CONTROL, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_RGB_CONTROL);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'maintenance_get') {
        // MDC §2.1.08 – GET Maintenance Control
        sendMdcPacketWithResponse(buildPacket(CMD_MAINTENANCE, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_MAINTENANCE);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'serial_number_get') {
        // MDC §2.1.0B – GET Serial Number
        sendMdcPacketWithResponse(buildPacket(CMD_SERIAL_NUMBER, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SERIAL_NUMBER);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.serial = bytesToAscii(parsedAck.data || []);
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'model_name_get') {
        // MDC §2.1.8A – GET Model Name
        sendMdcPacketWithResponse(buildPacket(CMD_MODEL_NAME, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_MODEL_NAME);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.modelName = bytesToAscii(parsedAck.data || []);
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'screen_size_get') {
        // MDC §2.1.19 – GET Screen Size
        sendMdcPacketWithResponse(buildPacket(CMD_SCREEN_SIZE, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SCREEN_SIZE);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.screenSize = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_config_get') {
        // MDC §2.1.1B.82 – GET IP/Subnet/Gateway/DNS
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x82]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          var byteOffset = bytes.length > 0 && bytes[0] === 0x82 ? 1 : 0;
          if (bytes.length >= byteOffset + 16) {
            parsedAck.ipAddress = ipBytesToString(bytes, byteOffset + 0);
            parsedAck.subnetMask = ipBytesToString(bytes, byteOffset + 4);
            parsedAck.gateway = ipBytesToString(bytes, byteOffset + 8);
            parsedAck.dns = ipBytesToString(bytes, byteOffset + 12);
          }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_config_set') {
        // MDC §2.1.1B.82 – SET IP/Subnet/Gateway/DNS
        var ipBytes = parseIpv4(String(parsed.ipAddress || ''), [192, 168, 0, 100]);
        var subnetBytes = parseIpv4(String(parsed.subnetMask || ''), [255, 255, 255, 0]);
        var gatewayBytes = parseIpv4(String(parsed.gateway || ''), [192, 168, 0, 1]);
        var dnsBytes = parseIpv4(String(parsed.dns || ''), [8, 8, 8, 8]);
        var networkSetPayload = [0x82]
          .concat(ipBytes)
          .concat(subnetBytes)
          .concat(gatewayBytes)
          .concat(dnsBytes);
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, networkSetPayload), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) {
            var errCode = (buf && buf.length > 7) ? byteHex(buf[7]) : '??';
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: 'network_config_set NAK err=0x' + errCode, rawHex: parsedAck.rawHex }));
            return;
          }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'weekly_restart_get') {
        // MDC §2.1.1B.A2 – GET Weekly Restart
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0xA2]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          var byteOffset = bytes.length > 0 && bytes[0] === 0xA2 ? 1 : 0;
          parsedAck.weekDay = bytes[byteOffset] != null ? bytes[byteOffset] : null;
          parsedAck.timeHour = bytes[byteOffset + 1] != null ? bytes[byteOffset + 1] : null;
          parsedAck.timeMinute = bytes[byteOffset + 2] != null ? bytes[byteOffset + 2] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'weekly_restart_set') {
        // MDC §2.1.1B.A2 – SET Weekly Restart
        var weekDay = parseIntClamped(parsed.weekDay, 0, 0, 0x7F) & 0x7F;
        var hour = parseIntClamped(parsed.timeHour, 0, 0, 23);
        var minute = parseIntClamped(parsed.timeMinute, 0, 0, 59);
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0xA2, weekDay, hour, minute]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'brightness_sensor_get') {
        // MDC §2.1.86 – GET Brightness Sensor mode
        sendMdcPacketWithResponse(buildPacket(CMD_BRIGHTNESS_SENSOR, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_BRIGHTNESS_SENSOR);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'brightness_sensor_set') {
        // MDC §2.1.86 – SET Brightness Sensor mode (0=off, 1=on)
        var brSensor = parseIntClamped(parsed.value, 0, 0, 1);
        sendMdcPacketWithResponse(buildPacket(CMD_BRIGHTNESS_SENSOR, [brSensor]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_BRIGHTNESS_SENSOR);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = brSensor;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'mdc_id_display_set') {
        // MDC §2.1.B9 – SET Display ID OSD show/hide (0=off, 1=on)
        var mdcIdDisplay = parseIntClamped(parsed.value, 0, 0, 1);
        sendMdcPacketWithResponse(buildPacket(CMD_MDC_ID_DISPLAY, [mdcIdDisplay]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_MDC_ID_DISPLAY);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = mdcIdDisplay;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'url_launcher_address_get') {
        // MDC §2.1.C7 sub 0x82 – GET URL Launcher address
        sendMdcPacketWithResponse(buildPacket(CMD_URL_LAUNCHER, [0x82]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_URL_LAUNCHER);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          var offset = bytes.length > 0 && bytes[0] === 0x82 ? 1 : 0;
          parsedAck.urlAddress = bytesToAscii(bytes.slice(offset));
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'url_launcher_address_set') {
        // MDC §2.1.C7 sub 0x82 – SET URL Launcher address (ASCII, <=200)
        var url = String(parsed.urlAddress || parsed.value || '').trim();
        var urlBytes = [];
        for (var ui = 0; ui < url.length && ui < 200; ui++) {
          urlBytes.push(url.charCodeAt(ui) & 0xFF);
        }
        var payloadBytes = [0x82].concat(urlBytes);
        sendMdcPacketWithResponse(buildPacket(CMD_URL_LAUNCHER, payloadBytes), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_URL_LAUNCHER);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.urlAddress = url;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_standby_get') {
        // MDC §2.1.B5 – GET Network Standby
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_STANDBY, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65 /* 'A' */) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else if (action === 'standby_set') {
        // MDC §2.1.4A – SET Standby Control (0x00=off, 0x01=on, 0x02=auto)
        var sbVal = parseInt(parsed.value, 10) & 0xFF;
        packet = buildPacket(CMD_STANDBY, [sbVal]);
      } else if (action === 'standby_get') {
        // MDC §2.1.4A – GET Standby Control
        sendMdcPacketWithResponse(buildPacket(CMD_STANDBY, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else if (action === 'osd_display_set') {
        // MDC §2.1.A3 – SET OSD Display Type On/Off
        // parsed.osdType: 0x00=Source, 0x01=Not Optimum Mode, 0x02=No Signal, 0x03=MDC, 0x04=Schedule Channel Info
        // parsed.osdOnOff: 0x00=off, 0x01=on
        var osdType  = parseInt(parsed.osdType, 10) & 0xFF;
        var osdOnOff = parseInt(parsed.osdOnOff, 10) & 0xFF;
        packet = buildPacket(CMD_OSD_DISPLAY, [osdType, osdOnOff]);
      } else if (action === 'osd_display_get') {
        // MDC §2.1.A3 – GET OSD Display status bitmask
        // ACK val1 bits: 0=Source, 1=Not Optimum Mode, 2=No Signal, 3=MDC, 4=Schedule Channel Info
        sendMdcPacketWithResponse(buildPacket(CMD_OSD_DISPLAY, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else if (action === 'menu_orientation_set') {
        // MDC §2.1.C8 sub 0x81 – SET Menu Orientation
        packet = buildPacket(CMD_ORIENTATION, [0x81, parseInt(parsed.value, 10) & 0xFF]);
      } else if (action === 'menu_orientation_get') {
        // MDC §2.1.C8 sub 0x81 – GET Menu Orientation
        sendMdcPacketWithResponse(buildPacket(CMD_ORIENTATION, [0x81]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, sub: buf[6], value: buf[7] }));
        });
        return;
      } else if (action === 'src_orientation_set') {
        // MDC §2.1.C8 sub 0x82 – SET Source Content Orientation
        packet = buildPacket(CMD_ORIENTATION, [0x82, parseInt(parsed.value, 10) & 0xFF]);
      } else if (action === 'src_orientation_get') {
        // MDC §2.1.C8 sub 0x82 – GET Source Content Orientation
        sendMdcPacketWithResponse(buildPacket(CMD_ORIENTATION, [0x82]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, sub: buf[6], value: buf[7] }));
        });
        return;
      } else if (action === 'power_button_set') {
        // MDC §2.1.CA sub 0x91 – SET Power Button mode
        packet = buildPacket(CMD_POWER_BUTTON, [0x91, parseInt(parsed.value, 10) & 0xFF]);
      } else if (action === 'power_button_get') {
        // MDC §2.1.CA sub 0x91 – GET Power Button mode
        sendMdcPacketWithResponse(buildPacket(CMD_POWER_BUTTON, [0x91]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, sub: buf[6], value: buf[7] }));
        });
        return;
      } else if (action === 'display_status_get') {
        // MDC §2.1.0D – GET Display Status
        sendMdcPacketWithResponse(buildPacket(CMD_DISPLAY_STATUS, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({
            ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes,
            lampError: buf[6], tempError: buf[7], brightnessError: buf[8],
            syncError: buf[9], currentTemp: buf[10], fanError: buf[11]
          }));
        });
        return;
      } else if (action === 'light_sensor_get') {
        // MDC §2.1.50 – GET Light Sensor lux value (sub cmd 0x00)
        // Response Data H/L: lux = DataH * 256 + DataL
        sendMdcPacketWithResponse(buildPacket(CMD_LIGHT_SENSOR, [0x00]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          // NAK = model doesn't support light sensor — return 200 so the browser doesn't log a console error
          if (buf[4] !== 65) { res.writeHead(200); res.end(JSON.stringify({ ok: false, supported: false, rawHex: rawHex })); return; }
          // ACK: [AA FF id 05 'A' 0x50 0x00 dataH dataL checksum]
          var dataH = buf[7] || 0;
          var dataL = buf[8] || 0;
          var lux = (dataH << 8) | dataL;
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), lux: lux }));
        });
        return;
      } else if (action === 'sw_version_get') {
        // MDC §2.1.0E – GET Software Version
        sendMdcPacketWithResponse(buildPacket(CMD_SW_VERSION, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          var versionStr = '';
          for (var di = 6; di < buf.length - 1; di++) {
            dataBytes.push(buf[di]);
            if (buf[di] > 0x1F && buf[di] < 0x80) versionStr += String.fromCharCode(buf[di]);
          }
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, version: versionStr }));
        });
        return;
      } else if (action === 'mdc_conn_type_set') {
        // MDC §2.1.1D – SET MDC Connection Type (0x00=RS232C, 0x01=RJ45)
        packet = buildPacket(CMD_MDC_CONN_TYPE, [parsed.value ? 0x01 : 0x00]);
      } else if (action === 'mdc_conn_type_get') {
        // MDC §2.1.1D – GET MDC Connection Type
        sendMdcPacketWithResponse(buildPacket(CMD_MDC_CONN_TYPE, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else if (action === 'brightness_get') {
        // MDC §2.1.25 – GET Brightness
        sendMdcPacketWithResponse(buildPacket(CMD_BRIGHTNESS, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_BRIGHTNESS);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'brightness_set') {
        // MDC §2.1.25 – SET Brightness
        var brightness = parseIntClamped(parsed.value, 50, 0, 100);
        sendMdcPacketWithResponse(buildPacket(CMD_BRIGHTNESS, [brightness]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_BRIGHTNESS);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = brightness;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'sharpness_get') {
        // MDC §2.1.26 – GET Sharpness
        sendMdcPacketWithResponse(buildPacket(CMD_SHARPNESS, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SHARPNESS);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'sharpness_set') {
        // MDC §2.1.26 – SET Sharpness
        var sharpness = parseIntClamped(parsed.value, 50, 0, 100);
        sendMdcPacketWithResponse(buildPacket(CMD_SHARPNESS, [sharpness]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SHARPNESS);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = sharpness;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'color_get') {
        // MDC §2.1.27 – GET Color
        sendMdcPacketWithResponse(buildPacket(CMD_COLOR, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_COLOR);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'color_set') {
        // MDC §2.1.27 – SET Color
        var color = parseIntClamped(parsed.value, 50, 0, 100);
        sendMdcPacketWithResponse(buildPacket(CMD_COLOR, [color]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_COLOR);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = color;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'safety_screen_run_get') {
        // MDC §2.1.59 – GET Safety Screen Run Type
        sendMdcPacketWithResponse(buildPacket(CMD_SAFETY_SCREEN_RUN, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SAFETY_SCREEN_RUN);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = parsedAck.data && parsedAck.data.length ? parsedAck.data[0] : null;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'safety_screen_run_set') {
        // MDC §2.1.59 – SET Safety Screen Run Type
        var safetyType = parseIntClamped(parsed.value, 0, 0, 0x11);
        sendMdcPacketWithResponse(buildPacket(CMD_SAFETY_SCREEN_RUN, [safetyType]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_SAFETY_SCREEN_RUN);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.value = safetyType;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'ticker_get') {
        // MDC §2.1.63 – GET Ticker
        // Response layout (15 header bytes, then message text):
        // [0]=onOff, [1]=startH, [2]=startM, [3]=endH, [4]=endM,
        // [5]=posH, [6]=posV, [7]=motionOnOff, [8]=motionDir, [9]=motionSpeed,
        // [10]=fontSize, [11]=fgColor, [12]=bgColor, [13]=fgOpacity, [14]=bgOpacity,
        // [15+]=message ASCII bytes (length = MDC LEN - 15)
        sendMdcPacketWithResponse(buildPacket(CMD_TICKER, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_TICKER);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          parsedAck.onOff = bytes[0] != null ? bytes[0] : 0;
          parsedAck.startHour = bytes[1] != null ? bytes[1] : 0;
          parsedAck.startMinute = bytes[2] != null ? bytes[2] : 0;
          parsedAck.endHour = bytes[3] != null ? bytes[3] : 0;
          parsedAck.endMinute = bytes[4] != null ? bytes[4] : 0;
          parsedAck.positionHorizontal = bytes[5] != null ? bytes[5] : 0;
          parsedAck.positionVertical = bytes[6] != null ? bytes[6] : 0;
          parsedAck.motionOnOff = bytes[7] != null ? bytes[7] : 0;
          parsedAck.motionDirection = bytes[8] != null ? bytes[8] : 0;
          parsedAck.motionSpeed = bytes[9] != null ? bytes[9] : 0;
          parsedAck.fontSize = bytes[10] != null ? bytes[10] : 0;
          parsedAck.foregroundColor = bytes[11] != null ? bytes[11] : 0;
          parsedAck.backgroundColor = bytes[12] != null ? bytes[12] : 0;
          parsedAck.foregroundOpacity = bytes[13] != null ? bytes[13] : 0;
          parsedAck.backgroundOpacity = bytes[14] != null ? bytes[14] : 0;
          parsedAck.messageData = bytes.slice(15);
          parsedAck.message = bytesToAscii(parsedAck.messageData);
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'ticker_set') {
        // MDC §2.1.63 – SET Ticker
        // Payload: 15 fixed header bytes (no leading length byte, no AM/PM bytes), then message.
        // fgOpacity: 0x03=FLASHING, 0x04=FLASH_ALL, 0x05=OFF
        // bgOpacity: 0x00=SOLID, 0x01=TRANSPARENT, 0x02=TRANSLUCENT, 0x03=UNKNOWN
        var tickerMessage = String(parsed.message || 'TEST TICKER');
        var messageBytes = [];
        for (var mi = 0; mi < tickerMessage.length; mi++) {
          messageBytes.push(tickerMessage.charCodeAt(mi) & 0xFF);
        }
        var tickerPayload = [
          parseIntClamped(parsed.onOff, 1, 0, 1),
          parseIntClamped(parsed.startHour, 9, 1, 12),
          parseIntClamped(parsed.startMinute, 0, 0, 59),
          parseIntClamped(parsed.endHour, 6, 1, 12),
          parseIntClamped(parsed.endMinute, 0, 0, 59),
          parseIntClamped(parsed.positionHorizontal, 0, 0, 2),
          parseIntClamped(parsed.positionVertical, 0, 0, 2),
          parseIntClamped(parsed.motionOnOff, 1, 0, 1),
          parseIntClamped(parsed.motionDirection, 0, 0, 3),
          parseIntClamped(parsed.motionSpeed, 0, 0, 2),
          parseIntClamped(parsed.fontSize, 0, 0, 2),
          parseIntClamped(parsed.foregroundColor, 1, 0, 7),
          parseIntClamped(parsed.backgroundColor, 0, 0, 7),
          parseIntClamped(parsed.foregroundOpacity, 5, 3, 5),
          parseIntClamped(parsed.backgroundOpacity, 0, 0, 3)
        ].concat(messageBytes.slice(0, 240));
        sendMdcPacketWithResponse(buildPacket(CMD_TICKER, tickerPayload), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_TICKER);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_wifi_set') {
        // MDC §2.1.1B.8A – SET WiFi AP config (add SSID + password to connection history)
        // Note: device may switch network; response may not be received if IP changes.
        // StrCoded format: [code_byte, len_byte, ...ascii_bytes]
        // Payload: [0x8A, 0x00, ssidLen, ...ssidBytes, 0x01, passLen, ...passBytes]
        var wifiSsid = String(parsed.ssid || '');
        var wifiPassword = String(parsed.password || '');
        var ssidBytes = [];
        for (var wi = 0; wi < wifiSsid.length; wi++) ssidBytes.push(wifiSsid.charCodeAt(wi) & 0xFF);
        var passBytes = [];
        for (var pi = 0; pi < wifiPassword.length; pi++) passBytes.push(wifiPassword.charCodeAt(pi) & 0xFF);
        var wifiPayload = [0x8A, 0x00, ssidBytes.length].concat(ssidBytes)
          .concat([0x01, passBytes.length]).concat(passBytes);
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, wifiPayload), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) {
            // For sub-command NAKs: buf[6]=subCmd echo (0x8A), buf[7]=actual ERR code
            var errCode = (buf && buf.length > 7) ? byteHex(buf[7]) : '??';
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: 'WiFi NAK err=0x' + errCode + ' (device may not support WiFi or needs WiFi mode active)', rawHex: parsedAck.rawHex }));
            return;
          }
          parsedAck.ssid = wifiSsid;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_ip_mode_get') {
        // MDC §2.1.1B.85 – GET Network IP Mode (0x00=Dynamic/DHCP, 0x01=Static)
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x85]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(200); res.end(JSON.stringify({ ok: false, supported: false, error: 'NAK' })); return; }
          var bytes = parsedAck.data || [];
          var byteOffset = bytes.length > 0 && bytes[0] === 0x85 ? 1 : 0;
          parsedAck.ipMode = bytes[byteOffset] != null ? bytes[byteOffset] : null; // 0=DHCP, 1=Static
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'network_ip_mode_set') {
        // MDC §2.1.1B.85 – SET Network IP Mode (0x00=Dynamic/DHCP, 0x01=Static)
        var ipMode = parsed.dhcp ? 0x00 : 0x01;
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x85, ipMode]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) {
            var errCode = (buf && buf.length > 7) ? byteHex(buf[7]) : '??';
            res.writeHead(200);
            res.end(JSON.stringify({ ok: false, error: 'network_ip_mode_set NAK err=0x' + errCode, rawHex: parsedAck.rawHex }));
            return;
          }
          parsedAck.ipMode = ipMode;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'child_device_get') {
        // MDC §2.2.0A.81 – GET Child Device Info
        // Returns: panelOnOff, source, videoWallOnOff, videoWallPosition, videoWallDivision,
        //          videoWallMode, rotation, screenSize, modelCode, swVerLength, swVer..., modelNameLength, modelName...
        sendMdcPacketWithResponse(buildPacket(CMD_CHILD_DEVICE, [0x81]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_CHILD_DEVICE);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          // bytes[0]=subCmd(0x81), bytes[1]=panelOnOff, bytes[2]=source, bytes[3]=videoWallOnOff,
          // bytes[4]=videoWallPosition, bytes[5]=videoWallDivision, bytes[6]=videoWallMode,
          // bytes[7]=rotation, bytes[8]=screenSize, bytes[9]=modelCode,
          // bytes[10]=swVerLength, bytes[11..10+swVerLen]=swVer string,
          // bytes[11+swVerLen]=modelNameLength, bytes[12+swVerLen..]=modelName string
          var byteOffset = bytes.length > 0 && bytes[0] === 0x81 ? 1 : 0;
          parsedAck.panelOnOff = bytes[byteOffset] != null ? bytes[byteOffset] : null;
          parsedAck.source = bytes[byteOffset + 1] != null ? bytes[byteOffset + 1] : null;
          parsedAck.videoWallOnOff = bytes[byteOffset + 2] != null ? bytes[byteOffset + 2] : null;
          parsedAck.videoWallPosition = bytes[byteOffset + 3] != null ? bytes[byteOffset + 3] : null;
          parsedAck.videoWallDivision = bytes[byteOffset + 4] != null ? bytes[byteOffset + 4] : null;
          parsedAck.videoWallMode = bytes[byteOffset + 5] != null ? bytes[byteOffset + 5] : null;
          parsedAck.rotation = bytes[byteOffset + 6] != null ? bytes[byteOffset + 6] : null;
          parsedAck.screenSize = bytes[byteOffset + 7] != null ? bytes[byteOffset + 7] : null;
          parsedAck.modelCode = bytes[byteOffset + 8] != null ? bytes[byteOffset + 8] : null;
          var swVerLen = bytes[byteOffset + 9] != null ? bytes[byteOffset + 9] : 0;
          parsedAck.swVersion = bytesToAscii(bytes.slice(byteOffset + 10, byteOffset + 10 + swVerLen));
          var modelNameStart = byteOffset + 10 + swVerLen;
          var modelNameLen = bytes[modelNameStart] != null ? bytes[modelNameStart] : 0;
          parsedAck.modelName = bytesToAscii(bytes.slice(modelNameStart + 1, modelNameStart + 1 + modelNameLen));
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'mac_address_get') {
        // MDC §2.2.1B.81 – GET MAC Address (active network profile, wired or wireless)
        // ACK data[0]=0x81, data[1..12]=12 ASCII-coded MAC chars (no colons, e.g. "fe68af54c20e")
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x81]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          var byteOffset = bytes.length > 0 && bytes[0] === 0x81 ? 1 : 0;
          var raw = bytesToAscii(bytes.slice(byteOffset, byteOffset + 12));
          // Format as XX:XX:XX:XX:XX:XX if we received 12 clean hex chars
          if (raw.length === 12) {
            parsedAck.macAddress = raw.replace(/(.{2})/g, '$1:').slice(0, 17);
          } else {
            parsedAck.macAddress = raw;
          }
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'device_pin_get') {
        // MDC §2.2.1B.87 – GET Device PIN
        // Note: spec says this will NOT work via Ethernet (only RS232C).
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x87]), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          var bytes = parsedAck.data || [];
          var byteOffset = bytes.length > 0 && bytes[0] === 0x87 ? 1 : 0;
          parsedAck.pin = bytesToAscii(bytes.slice(byteOffset));
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'device_pin_set') {
        // MDC §2.2.1B.87 – SET Device PIN
        // Note: spec says this will NOT work via Ethernet (only RS232C).
        var pinStr = String(parsed.pin || '');
        var pinBytes = [];
        for (var pni = 0; pni < pinStr.length; pni++) pinBytes.push(pinStr.charCodeAt(pni) & 0xFF);
        sendMdcPacketWithResponse(buildPacket(CMD_NETWORK_CONFIG, [0x87].concat(pinBytes)), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var parsedAck = parseAckFrame(buf, CMD_NETWORK_CONFIG);
          if (!parsedAck.ok) { res.writeHead(502); res.end(JSON.stringify(parsedAck)); return; }
          parsedAck.pin = pinStr;
          res.writeHead(200); res.end(JSON.stringify(parsedAck));
        });
        return;
      } else if (action === 'on_timer_set') {
        // MDC On-Timer SET — read-modify-write pattern:
        //   1. GET current 15-byte state from the slot (preserves unknown constants)
        //   2. Apply only the user-supplied fields
        //   3. SET the modified bytes
        //
        // Hour fields use 12-hour format (0–12). Confirmed from packet capture:
        // all working SET packets use onHour/offHour ≤ 12. Sending >12 causes NAK 0x01.
        // AM/PM encoding is TBD — for now hours must be in the 12h range.
        //
        // 15-byte layout (confirmed from enable/disable captures):
        // [0]=onHour, [1]=onMin, [2]=source, [3]=onEnable,
        // [4]=offHour, [5]=offMin, [6]=repeat, [7]=offEnable,
        // [8-11]=manualDayBits (LE), [12]=volume, [13-14]=model constants (read-only)
        var slot = Math.max(1, Math.min(7, parseInt(parsed.slot, 10) || 1));
        var timerCmd = ON_TIMER_CMDS[slot - 1];

        // Step 1: GET current state
        sendMdcPacketWithResponse(buildPacket(timerCmd, []), function(getErr, getBuf) {
          // Default base in case GET fails (safe factory-like values)
          var base = [0x07, 0x00, 0x01, 0x00, 0x0C, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0x60, 0x01];
          if (!getErr && getBuf && getBuf.length >= 22 && String.fromCharCode(getBuf[4]) === 'A') {
            for (var bi = 0; bi < 15; bi++) {
              if (6 + bi < getBuf.length - 1) base[bi] = getBuf[6 + bi];
            }
          }

          // Step 2: Apply user-supplied fields (hours clamped to 12h range)
          if (parsed.onHour   != null) base[0]  = Math.max(0, Math.min(12, parseInt(parsed.onHour,  10) || 0));
          if (parsed.onMin    != null) base[1]  = Math.max(0, Math.min(59, parseInt(parsed.onMin,   10) || 0));
          if (parsed.source   != null) base[2]  = parseInt(parsed.source, 10) & 0xFF;
          if (parsed.onEnable != null) base[3]  = parsed.onEnable ? 0x01 : 0x00;
          if (parsed.offHour  != null) base[4]  = Math.max(0, Math.min(12, parseInt(parsed.offHour, 10) || 0));
          if (parsed.offMin   != null) base[5]  = Math.max(0, Math.min(59, parseInt(parsed.offMin,  10) || 0));
          if (parsed.repeat   != null) base[6]  = Math.max(0, Math.min(5,  parseInt(parsed.repeat,  10) || 0));
          if (parsed.offEnable != null) base[7] = parsed.offEnable ? 0x01 : 0x00;
          var manualBitsVal = parsed.manualBits != null ? parsed.manualBits : parsed.manualDays;
          if (manualBitsVal != null) {
            var mb = parseInt(manualBitsVal, 10) || 0;
            base[8] = mb & 0xFF; base[9] = (mb >> 8) & 0xFF;
            base[10] = (mb >> 16) & 0xFF; base[11] = (mb >> 24) & 0xFF;
          }
          if (parsed.volume != null) base[12] = Math.max(0, Math.min(100, parseInt(parsed.volume, 10) || 0));
          // base[13] and base[14] are always preserved from GET (model-specific constants)

          // Step 3: SET with modified bytes
          sendMdcPacketWithResponse(buildPacket(timerCmd, base), function(setErr, setBuf) {
            if (setErr) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: setErr.message }));
              return;
            }
            var rawHex = bufferHex(setBuf);
            if (!setBuf || setBuf.length < 5) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'Short timer SET response', rawHex: rawHex }));
              return;
            }
            var setAck = String.fromCharCode(setBuf[4]);
            if (setAck !== 'A') {
              var nakCode = setBuf[6] != null ? ('0x' + byteHex(setBuf[6])) : '??';
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'MDC NAK for on_timer SET slot ' + slot + ', code ' + nakCode, rawHex: rawHex }));
              return;
            }
            var echoData = [];
            for (var di = 6; di < setBuf.length - 1; di++) echoData.push(setBuf[di]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(setBuf), slot: slot, cmd: timerCmd, data: echoData }));
          });
        });
        return;
      } else if (action === 'on_timer_get') {
        // MDC On-Timer GET for slot 1–7 (0xA4/A5/A6/AB/AC/AD/AE)
        var slot = Math.max(1, Math.min(7, parseInt(parsed.slot, 10) || 1));
        var timerCmd = ON_TIMER_CMDS[slot - 1];
        sendMdcPacketWithResponse(buildPacket(timerCmd, []), function(err, buf) {
          if (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          var rawHex = bufferHex(buf);
          if (!buf || buf.length < 5) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Short timer response', rawHex: rawHex }));
            return;
          }
          var ack = String.fromCharCode(buf[4]);
          if (ack !== 'A') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, supported: false, error: 'MDC NAK for on_timer slot ' + slot, rawHex: rawHex }));
            return;
          }
          // Data bytes start at buf[6]; response is 15 bytes (dataLen=0x11=17, minus 2 for ack+cmd)
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          // Parse raw bytes into named fields using the confirmed 15-byte layout:
          // [0]=onHour [1]=onMin [2]=source [3]=onEnable
          // [4]=offHour [5]=offMin [6]=repeat [7]=offEnable
          // [8-11]=manualDayBits(LE) [12]=volume [13-14]=model constants
          var onHour    = dataBytes[0] != null ? dataBytes[0] : 0;
          var onMin     = dataBytes[1] != null ? dataBytes[1] : 0;
          var timerSrc  = dataBytes[2] != null ? dataBytes[2] : 0x01;
          var onEnable  = dataBytes[3] === 0x01;
          var offHour   = dataBytes[4] != null ? dataBytes[4] : 0;
          var offMin    = dataBytes[5] != null ? dataBytes[5] : 0;
          var timerRpt  = dataBytes[6] != null ? dataBytes[6] : 1;
          var offEnable = dataBytes[7] === 0x01;
          var manualDays = (dataBytes[8] || 0) | ((dataBytes[9] || 0) << 8) | ((dataBytes[10] || 0) << 16) | ((dataBytes[11] || 0) << 24);
          var timerVol  = dataBytes[12] != null ? dataBytes[12] : 0;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            rawHex: rawHex,
            displayId: parseAckDisplayId(buf),
            slot: slot,
            cmd: timerCmd,
            data: dataBytes,
            onHour: onHour,
            onMin: onMin,
            onEnable: onEnable,
            offHour: offHour,
            offMin: offMin,
            offEnable: offEnable,
            repeat: timerRpt,
            volume: timerVol,
            source: timerSrc,
            manualDays: manualDays,
          }));
        });
        return;
      } else if (action === 'b2b_timer_get' || action === 'b2b_timer_set' || action === 'b2b_timer_clear') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: 'This device reached the local MDC bridge for a B2B timer action. The SSSP timer test must be intercepted in js/player.js first, so the player bundle on the device is stale or has not been restarted.',
          action: action,
          requiresPlayerIntercept: true,
        }));
        return;
      } else if (action === 'auto_id_start') {
        // MDC §2.1.B8 Auto ID START — broadcast to all chained displays.
        // Devices on the chain are assigned sequential IDs starting at 1.
        // A single device will be assigned ID=1.
        // Spec says: send START, wait for devices to settle, then send END.
        sendMdcPacketWithResponse(buildPacket(CMD_AUTO_ID, [0x00], 0xFE), function(err, buf) {
          // 0xFE broadcast: some firmware versions do return an ACK, others don't.
          // We treat both success and timeout as "sent" — the important result is
          // the follow-up scan after the caller sends auto_id_stop.
          if (err && err.message && err.message.indexOf('timeout') === -1) {
            res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return;
          }
          var ackOk = !err && buf && buf[4] === 65;
          res.writeHead(200); res.end(JSON.stringify({
            ok: true,
            started: true,
            ackReceived: ackOk,
            rawHex: (buf && !err) ? bufferHex(buf) : null,
          }));
        });
        return;
      } else if (action === 'auto_id_stop') {
        // MDC §2.1.B8 Auto ID END.
        // After sending END, scan IDs 1–9 to confirm the device was assigned ID=1.
        sendMdcPacketWithResponse(buildPacket(CMD_AUTO_ID, [0x01], 0xFE), function(err, buf) {
          var ackOk = !err && buf && buf[4] === 65;
          // Scan regardless of ACK outcome — settling takes a moment
          setTimeout(function() {
            mdcEnqueue(function(release) {
              scanMdcId([0,1,2,3,4,5,6,7,8,9], 500, function(scanErr, found) {
                release();
                res.writeHead(200); res.end(JSON.stringify({
                  ok: !!found,
                  stopped: true,
                  ackReceived: ackOk,
                  endRawHex: (buf && !err) ? bufferHex(buf) : null,
                  displayId: found ? found.displayId : null,
                  idOk: found ? found.displayId === 1 : false,
                  scanRawHex: found ? found.rawHex : null,
                  error: found ? undefined : 'No device responded after AUTO ID END',
                }));
              });
            });
          }, 600);
        });
        return;
      } else if (action === 'set_mdc_id') {
        // Set the in-memory DEVICE_MDC_ID used as default for all buildPacket calls.
        // Called by the API after saving mdcId to devices.settings, so server.js
        // uses the correct ID immediately without needing a full restart/rescan.
        var newId = Math.max(0, Math.min(254, parseInt(parsed.id, 10) || 0));
        DEVICE_MDC_ID = newId;
        res.writeHead(200); res.end(JSON.stringify({ ok: true, displayId: DEVICE_MDC_ID }));
        return;
      } else if (action === 'mdc_id_scan') {
        // Scan MDC IDs 0–9 to find which one this device is set to.
        // Sends CMD_STATUS GET to each ID sequentially, 500 ms timeout per ID.
        // Automatically updates DEVICE_MDC_ID on success.
        // Goes through the MDC queue so it never overlaps with other TCP connections.
        mdcEnqueue(function(release) {
          scanMdcId([0,1,2,3,4,5,6,7,8,9], 500, function(err, found) {
            release();
            if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
            if (!found) {
              res.writeHead(200); res.end(JSON.stringify({ ok: false, error: 'No response from IDs 0–9' }));
              return;
            }
            DEVICE_MDC_ID = found.displayId; // update in-memory ID for this session
            res.writeHead(200); res.end(JSON.stringify({
              ok: true,
              displayId: found.displayId,
              idOk: found.displayId === 1,
              rawHex: found.rawHex,
            }));
          });
        });
        return;
      } else if (action === 'mdc_conn_type_fix') {
        // 0xFE is the Samsung MDC broadcast address — never produces an ACK.
        // Strategy:
        //   Step 1 — fire-and-forget broadcast SET RJ45 via 0xFE (reaches the
        //            device regardless of its current MDC ID, no response expected).
        //   Step 2 — scan IDs 1–9 to find which ID the device responds to.
        //            If found ID = 1 → all MDC commands will work.
        //            If found ID ≠ 1 → user must change it via OSD.
        sendMdcPacket(buildPacket(CMD_MDC_CONN_TYPE, [0x01], 0xFE), function(sendErr) {
          // Ignore send error — broadcast SET goes out even without ACK.
          setTimeout(function() {
            mdcEnqueue(function(release) {
            scanMdcId([0,1,2,3,4,5,6,7,8,9], 500, function(err, found) {
              release();
              if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
              if (!found) {
                res.writeHead(200);
                res.end(JSON.stringify({
                  ok: false,
                  rj45Sent: true,
                  idOk: false,
                  error: 'RJ45 SET broadcast sent but no device responded to IDs 0–9',
                }));
                return;
              }
              res.writeHead(200);
              res.end(JSON.stringify({
                ok: true,
                rj45Sent: true,
                rawHex: found.rawHex,
                displayId: found.displayId,
                idOk: found.displayId === 1,
              }));
              DEVICE_MDC_ID = found.displayId; // update in-memory ID for this session
            });
            }); // end mdcEnqueue
          }, 400); // 400 ms settle after broadcast SET
        });
        return;
      } else if (action === 'remote_control_set') {
        // MDC §2.1.36 – SET Remote Control (0x00=disable, 0x01=enable)
        packet = buildPacket(CMD_REMOTE_CONTROL, [parseInt(parsed.value, 10) & 0xFF]);
      } else if (action === 'remote_control_get') {
        // MDC §2.1.36 – GET Remote Control
        sendMdcPacketWithResponse(buildPacket(CMD_REMOTE_CONTROL, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else if (action === 'safety_lock_set') {
        // MDC §2.1.5D – SET Safety Lock (0x00=off, 0x01=on)
        packet = buildPacket(CMD_SAFETY_LOCK, [parseInt(parsed.value, 10) & 0xFF]);
      } else if (action === 'safety_lock_get') {
        // MDC §2.1.5D – GET Safety Lock
        sendMdcPacketWithResponse(buildPacket(CMD_SAFETY_LOCK, []), function(err, buf) {
          if (err) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          var rawHex = bufferHex(buf);
          if (buf[4] !== 65) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'NAK', rawHex: rawHex })); return; }
          var dataBytes = [];
          for (var di = 6; di < buf.length - 1; di++) dataBytes.push(buf[di]);
          res.writeHead(200); res.end(JSON.stringify({ ok: true, rawHex: rawHex, displayId: parseAckDisplayId(buf), data: dataBytes, value: buf[6] }));
        });
        return;
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action: ' + action }));
        return;
      }
      sendMdcPacket(packet, function(err) {
        if (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, action: action }));
        }
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

  // ── Static file server for PDF/content files ─────────────────────────
  // B2BDoc on SSSP6 requires HTTP URLs, not file:// paths.
  // The web app calls: http://127.0.0.1:9615/content/<filename>
  // which serves from: /opt/usr/home/owner/apps_rw/fmDBbBnvJM/data/content/
  // This route is added after all MDC routes so it doesn't interfere.
  // (CONTENT_DIR is declared at module top so SYNC_DATA_DIR/MANIFEST_PATH can derive from it.)
  var MIME_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };

  var origHandler = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'GET' && req.url && req.url.indexOf('/content/') === 0) {
      var fileName = req.url.slice('/content/'.length).split('?')[0];
      // Prevent path traversal
      fileName = path.basename(fileName);
      var filePath = path.join(CONTENT_DIR, fileName);
      fs.stat(filePath, function(err, stat) {
        if (err || !stat.isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        var ext = path.extname(fileName).toLowerCase();
        var mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
        fs.createReadStream(filePath).pipe(res);
      });
      return;
    }
    origHandler(req, res);
  });

  server.listen(HTTP_PORT, '0.0.0.0', function() {
    console.log('[mdc-bridge] Listening on 0.0.0.0:' + HTTP_PORT);
  });

  // ── SyncPlay LAN mesh: cold-start manifest load ─────────────────────────
  fs.readFile(MANIFEST_PATH, 'utf8', function(err, data) {
    if (err) {
      console.log('[sync] no cached manifest at ' + MANIFEST_PATH + ' (' + err.code + ')');
      return;
    }
    try {
      manifestCache = JSON.parse(data);
      // Pre-seed peerTable from manifest peer list (lastKnownIp).
      if (manifestCache && Array.isArray(manifestCache.peers)) {
        manifestCache.peers.forEach(function(p) {
          if (!p || !p.deviceId) return;
          peerTable[p.deviceId] = {
            ip: p.lastKnownIp || null,
            port: p.port || HTTP_PORT,
            priority: typeof p.priority === 'number' ? p.priority : 99,
            groupId: manifestCache.groupId,
            lastSeenAt: 0,
          };
        });
      }
      console.log('[sync] manifest loaded from disk (groupId=' +
                  (manifestCache && manifestCache.groupId) + ' version=' +
                  (manifestCache && manifestCache.version) + ')');
    } catch (e) {
      console.warn('[sync] manifest parse failed: ' + e.message);
      manifestCache = null;
    }
  });

  // ── SyncPlay LAN mesh: UDP 9618 beacon ──────────────────────────────────
  // Broadcast presence every BEACON_INTERVAL_MS; receive peers' beacons,
  // populate peerTable. Resilient to filtered UDP networks (manifest peer
  // list provides backup).
  try {
    var udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udp.on('error', function(err) {
      console.warn('[sync] UDP error:', err && err.message);
      try { udp.close(); } catch (_) {}
    });

    udp.on('message', function(buf, rinfo) {
      var beacon;
      try { beacon = JSON.parse(buf.toString('utf8')); }
      catch (e) { return; /* malformed beacon, ignore */ }
      if (!beacon || !beacon.deviceId) return;
      // Ignore our own beacon (UDP loopback on broadcast).
      if (syncIdentity.deviceId && beacon.deviceId === syncIdentity.deviceId) return;
      // Ignore other groups (a single LAN can host multiple sync groups).
      if (syncIdentity.groupId && beacon.groupId && beacon.groupId !== syncIdentity.groupId) return;
      peerTable[beacon.deviceId] = {
        ip: rinfo.address,
        port: beacon.port || HTTP_PORT,
        priority: typeof beacon.priority === 'number' ? beacon.priority : 99,
        groupId: beacon.groupId || null,
        lastSeenAt: Date.now(),
      };
    });

    udp.on('listening', function() {
      try { udp.setBroadcast(true); } catch (e) {
        console.warn('[sync] setBroadcast failed:', e && e.message);
      }
      var addr = udp.address();
      console.log('[sync] UDP beacon listening on ' + addr.address + ':' + addr.port);
    });

    udp.bind(SYNC_UDP_PORT, '0.0.0.0');

    // Periodic outbound beacon.
    setInterval(function() {
      if (!syncIdentity.deviceId || !syncIdentity.groupId) return; // not yet provisioned
      var beacon = JSON.stringify({
        deviceId: syncIdentity.deviceId,
        groupId:  syncIdentity.groupId,
        priority: syncIdentity.priority,
        port:     HTTP_PORT,
        ts:       Date.now(),
      });
      var msg = Buffer.from(beacon, 'utf8');
      try {
        udp.send(msg, 0, msg.length, SYNC_UDP_PORT, '255.255.255.255', function(err) {
          if (err) console.warn('[sync] beacon send failed:', err.message);
        });
      } catch (e) {
        // socket may not yet be ready or have been torn down; non-fatal
      }
    }, BEACON_INTERVAL_MS);

    // Periodic peer pruning (separate from beacon so it still runs if we
    // haven't been provisioned yet).
    setInterval(function() {
      var nowMs = Date.now();
      Object.keys(peerTable).forEach(function(devId) {
        var p = peerTable[devId];
        // Don't expire manifest-seeded entries (lastSeenAt=0); they stay
        // until either UDP-confirmed or the manifest is replaced.
        if (!p || !p.lastSeenAt) return;
        if (nowMs - p.lastSeenAt > PEER_TIMEOUT_MS) {
          delete peerTable[devId];
        }
      });
    }, 1000);
  } catch (e) {
    console.warn('[sync] UDP beacon init failed:', e && e.message);
  }
};
