/**
 * logic.js — Node sidecar for Nexari Sync Engine (Pi-less mode)
 *
 * Loaded by `lib/server20XX.js.signed` (Samsung-signed stub). The stub does:
 *     var nodeJSServer = require('../js/logic.js');
 *     console.log(nodeJSServer());
 *
 * This module exports a function that, when invoked, starts an HTTP server
 * on PORT (9616) that mirrors the subset of the Pi `test-sync` API used by
 * the WebApp's sync.ts / clock.ts. State is held in memory (no Redis).
 *
 * Endpoints (all under any path; no /api/v1/test-sync prefix to keep it short):
 *   GET  /time
 *   POST /register             body: { deviceId, role, ip, groupId?, sessionId? }
 *   GET  /peers?groupId=X
 *   POST /signal/:targetId     body: { from, seq?, sessionId?, body }
 *   GET  /signals/:deviceId?since=N
 *   POST /log                  body: { deviceId, level?, msg, ts?, ... }
 *   GET  /logs?deviceId=X&limit=N
 *   DELETE /logs?deviceId=X
 *
 * The WebApp's `piBase` config is set to `http://<relay-ip>:9616/api/v1/test-sync`
 * so that paths like `/api/v1/test-sync/time` map onto our `/time` after stripping
 * the prefix. We accept BOTH bare and prefixed URLs to keep the WebApp untouched.
 *
 * Relay model: ONE TV (the "rendezvous") runs this server and all peers point
 * at its IP. We expect the relay TV's IP to be reachable on LAN.
 *
 * Ports / privileges: Tizen B2B Node servers are limited; pick a port that does
 * not conflict with the MDC bridge (9615 in nexari-tizen). Using 9616 here.
 */

module.exports = function startServer() {
  var http = require('http');
  var url  = require('url');

  var PORT = 9616;
  var PEER_TTL_MS    = 15000;
  var SIGNAL_TTL_MS  = 60000;
  var LOG_CAP        = 500;

  // ── In-memory state ──────────────────────────────────────────────────────
  // peers[groupId][deviceId] = { deviceId, role, ip, sessionId, registeredAt }
  var peers   = {};
  // signals[deviceId] = [ { from, seq, sessionId, body, at } ]
  var signals = {};
  // logs[deviceId] = [ { deviceId, level, msg, ts, ... } ]
  var logs    = {};

  // LOOP_READY barrier -- per-group map of deviceId -> true for devices that have
  // finished prebuffering at frame 0. When all peers are ready, relay broadcasts LOOP_GO.
  var loopReady = {};

  function readJson(req, cb) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end',  function() {
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { cb(e, null); }
    });
    req.on('error', function(e) { cb(e, null); });
  }

  function send(res, code, obj) {
    var body = obj == null ? '' : JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(body);
  }

  // Strip optional /api/v1/test-sync prefix so both legacy paths and short ones work.
  function normPath(p) {
    var prefixes = ['/api/v1/test-sync', '/test-sync'];
    for (var i = 0; i < prefixes.length; i++) {
      if (p.indexOf(prefixes[i]) === 0) return p.slice(prefixes[i].length) || '/';
    }
    return p;
  }

  function gcPeers(groupId) {
    var now = Date.now();
    var g = peers[groupId] || {};
    for (var id in g) {
      if (now - g[id].registeredAt > PEER_TTL_MS) delete g[id];
    }
  }

  function gcSignals(deviceId) {
    var now = Date.now();
    var arr = signals[deviceId] || [];
    while (arr.length && now - arr[0].at > SIGNAL_TTL_MS) arr.shift();
  }

  var server = http.createServer(function(req, res) {
    if (req.method === 'OPTIONS') { return send(res, 204, null); }

    var parsed = url.parse(req.url, true);
    var path   = normPath(parsed.pathname || '/');
    var query  = parsed.query || {};

    // GET /time ────────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/time') {
      return send(res, 200, { serverTimeMs: Date.now() });
    }

    // POST /register ───────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/register') {
      return readJson(req, function(err, body) {
        if (err) return send(res, 400, { error: 'bad json' });
        var deviceId  = body.deviceId;
        var role      = body.role;
        var ip        = body.ip;
        var groupId   = body.groupId   || 'syncengine-001';
        var sessionId = body.sessionId || null;
        if (!deviceId || !role || !ip) return send(res, 400, { error: 'deviceId, role, ip required' });

        if (!peers[groupId]) peers[groupId] = {};
        var prev = peers[groupId][deviceId];
        if (sessionId && prev && prev.sessionId && prev.sessionId !== sessionId) {
          // Stale session — drop pending signals
          delete signals[deviceId];
        }
        peers[groupId][deviceId] = {
          deviceId: deviceId, role: role, ip: ip,
          sessionId: sessionId, registeredAt: Date.now(),
        };
        return send(res, 200, { ok: true, serverTimeMs: Date.now() });
      });
    }

    // GET /peers ───────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/peers') {
      var groupId = query.groupId || 'syncengine-001';
      gcPeers(groupId);
      var list = [];
      var g = peers[groupId] || {};
      for (var id in g) list.push(g[id]);
      return send(res, 200, { peers: list, serverTimeMs: Date.now() });
    }

    // POST /signal/:targetId ──────────────────────────────────────────────
    if (req.method === 'POST' && path.indexOf('/signal/') === 0) {
      var target = path.slice('/signal/'.length);
      if (!target) return send(res, 404, { error: 'target required' });
      return readJson(req, function(err, body) {
        if (err) return send(res, 400, { error: 'bad json' });
        if (!body.from || !body.body) return send(res, 400, { error: 'from, body required' });
        if (!signals[target]) signals[target] = [];
        signals[target].push({
          from: body.from,
          seq:  body.seq || 0,
          sessionId: body.sessionId || null,
          body: body.body,
          at:   Date.now(),
        });
        // Cap per-device queue
        if (signals[target].length > 200) signals[target].splice(0, signals[target].length - 200);
        return send(res, 200, { ok: true, serverTimeMs: Date.now() });
      });
    }

    // GET /signals/:deviceId?since=N ───────────────────────────────────────
    if (req.method === 'GET' && path.indexOf('/signals/') === 0) {
      var deviceId = path.slice('/signals/'.length);
      if (!deviceId) return send(res, 404, { error: 'deviceId required' });
      var since = parseInt(query.since || '0', 10) || 0;
      gcSignals(deviceId);
      var arr = signals[deviceId] || [];
      var entries = [];
      for (var i = since; i < arr.length; i++) {
        entries.push({
          idx: i,
          from: arr[i].from,
          seq:  arr[i].seq,
          sessionId: arr[i].sessionId,
          body: arr[i].body,
          at:   arr[i].at,
        });
      }
      return send(res, 200, { entries: entries, nextSince: arr.length, serverTimeMs: Date.now() });
    }

    // POST /log ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/log') {
      return readJson(req, function(err, body) {
        if (err) return send(res, 400, { error: 'bad json' });
        if (!body.deviceId || !body.msg) return send(res, 400, { error: 'deviceId, msg required' });
        var deviceId = body.deviceId;
        if (!logs[deviceId]) logs[deviceId] = [];
        logs[deviceId].push({
          deviceId: deviceId,
          level:    body.level || 'info',
          msg:      body.msg,
          ts:       body.ts || Date.now(),
          engineMode:  body.engineMode  || null,
          driftMs:     body.driftMs     == null ? null : body.driftMs,
          ntpOffsetMs: body.ntpOffsetMs == null ? null : body.ntpOffsetMs,
        });
        if (logs[deviceId].length > LOG_CAP) {
          logs[deviceId].splice(0, logs[deviceId].length - LOG_CAP);
        }
        return send(res, 200, { ok: true });
      });
    }

    // GET /logs?deviceId=X&limit=N ─────────────────────────────────────────
    if (req.method === 'GET' && path === '/logs') {
      var dev = query.deviceId;
      if (!dev) return send(res, 400, { error: 'deviceId required' });
      var n = Math.min(500, Math.max(1, parseInt(query.limit || '200', 10) || 200));
      var arr2 = logs[dev] || [];
      return send(res, 200, { deviceId: dev, entries: arr2.slice(-n) });
    }

    // GET /devices — all deviceIds that have stored logs or active WS connections
    if (req.method === 'GET' && path === '/devices') {
      var logDevs   = Object.keys(logs);
      var wsDevs    = wsClients.filter(function(c) { return c.deviceId; }).map(function(c) { return c.deviceId; });
      var combined  = logDevs.concat(wsDevs).filter(function(v, i, a) { return a.indexOf(v) === i; });
      return send(res, 200, { devices: combined, serverTimeMs: Date.now() });
    }

    // DELETE /logs?deviceId=X ──────────────────────────────────────────────
    if (req.method === 'DELETE' && path === '/logs') {
      var dev2 = query.deviceId;
      if (!dev2) return send(res, 400, { error: 'deviceId required' });
      delete logs[dev2];
      res.writeHead(204); return res.end();
    }

    send(res, 404, { error: 'not found', path: path });
  });

  server.on('error', function(e) {
    console.log('[nexari-sync-relay] server error: ' + (e && e.message));
  });

  server.listen(PORT, '0.0.0.0', function() {
    console.log('[nexari-sync-relay] listening on 0.0.0.0:' + PORT);
  });

  // ── WebSocket relay (RFC 6455, no external deps) ─────────────────────────
  var crypto = require('crypto');
  var net    = require('net');

  // wsClients: [{ socket, deviceId, groupId, buf }]
  var wsClients = [];

  var WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

  function wsHandshake(socket, key) {
    var hash = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + hash + '\r\n\r\n'
    );
  }

  // Encode a text frame (opcode 0x01).
  function wsEncodeText(text) {
    var payload = Buffer.from(text, 'utf8');
    var len     = payload.length;
    var header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 127;
      header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
    }
    return Buffer.concat([header, payload]);
  }

  // Decode all complete frames from a buffer.
  // Returns { frames: [string, ...], remaining: Buffer }.
  function wsDecodeFrames(buf) {
    var frames = [];
    while (buf.length >= 2) {
      var opcode  = buf[0] & 0x0f;
      var masked  = !!(buf[1] & 0x80);
      var lenByte = buf[1] & 0x7f;
      var offset  = 2;
      var payLen;

      if (lenByte < 126) {
        payLen = lenByte;
      } else if (lenByte === 126) {
        if (buf.length < 4) break;
        payLen = buf.readUInt16BE(2);
        offset = 4;
      } else {
        if (buf.length < 10) break;
        payLen = buf.readUInt32BE(6); // ignore high word
        offset = 10;
      }

      var maskBytes = 0;
      if (masked) { maskBytes = 4; }
      if (buf.length < offset + maskBytes + payLen) break;

      var payload = buf.slice(offset + maskBytes, offset + maskBytes + payLen);
      if (masked) {
        var mask = buf.slice(offset, offset + 4);
        for (var i = 0; i < payLen; i++) payload[i] ^= mask[i % 4];
      }

      if (opcode === 0x01 || opcode === 0x00) { // text or continuation
        frames.push(payload.toString('utf8'));
      } else if (opcode === 0x08) { // close
        frames.push(null); // signal close
      }
      // ping/pong frames: ignore for now (browser sends none unmasked)
      buf = buf.slice(offset + maskBytes + payLen);
    }
    return { frames: frames, remaining: buf };
  }

  function wsSend(socket, obj) {
    try { socket.write(wsEncodeText(JSON.stringify(obj))); } catch (_) {}
  }

  function broadcastGroup(groupId, obj, excludeSocket) {
    var frame = wsEncodeText(JSON.stringify(obj));
    wsClients.forEach(function(c) {
      if (c.groupId === groupId && c.socket !== excludeSocket) {
        try { c.socket.write(frame); } catch (_) {}
      }
    });
  }

  function sendPeers(groupId) {
    var groupClients = wsClients.filter(function(c) { return c.groupId === groupId; });
    var peerList = groupClients.map(function(c) {
      return { deviceId: c.deviceId, ip: c.ip || '', registeredAt: c.registeredAt };
    });
    groupClients.forEach(function(c) {
      wsSend(c.socket, { type: 'PEERS', groupId: groupId, peers: peerList, serverTimeMs: Date.now() });
    });
  }

  function handleWsMessage(client, text) {
    var msg;
    try { msg = JSON.parse(text); } catch (_) { return; }

    if (msg.type === 'WS_REGISTER') {
      client.deviceId = msg.deviceId || ('anon-' + Date.now());
      client.groupId  = msg.groupId  || 'default';
      client.ip       = msg.ip       || '';
      client.registeredAt = Date.now();
      console.log('[ws] REGISTER ' + client.deviceId + ' group=' + client.groupId);

      // Sync into HTTP peers store so GET /peers returns WS-connected devices.
      var gid = client.groupId;
      if (!peers[gid]) peers[gid] = {};
      peers[gid][client.deviceId] = {
        deviceId: client.deviceId,
        role: client.deviceId,
        ip: client.ip,
        sessionId: null,
        registeredAt: client.registeredAt,
      };

      sendPeers(client.groupId);
      return;
    }

    if (msg.type === 'PING') {
      wsSend(client.socket, { type: 'PONG', t1: msg.t1, t2: Date.now() });
      return;
    }

    // LOOP_READY barrier: collect devices that have prebuffered at frame 0.
    // When all peers in the group are ready, broadcast LOOP_GO to everyone.
    if (msg.type === 'LOOP_READY') {
      var gid = msg.groupId || client.groupId;
      if (!loopReady[gid]) loopReady[gid] = {};
      loopReady[gid][msg.deviceId || client.deviceId] = true;
      var readyCount   = Object.keys(loopReady[gid]).length;
      var groupPeers   = wsClients.filter(function(c) { return c.groupId === gid && c.deviceId; });
      var expectedCount = groupPeers.length;  // require ALL currently-connected peers
      console.log('[Relay] LOOP_READY ' + (msg.deviceId || client.deviceId) + ' (' + readyCount + '/' + expectedCount + ')');
      if (expectedCount >= 2 && readyCount >= expectedCount) {
        loopReady[gid] = {};  // reset for next loop
        var playAt = Date.now() + 400;
        broadcastGroup(gid, { type: 'LOOP_GO', playAt: playAt }, null);
        console.log('[Relay] LOOP_GO playAt=' + playAt + ' -> group ' + gid);
      } else if (expectedCount < 2) {
        // Only 1 peer connected — do not fire LOOP_GO, wait for both devices
        console.log('[Relay] LOOP_READY received but only ' + expectedCount + ' peer(s) connected — waiting');
      }
      return;  // do NOT relay LOOP_READY to peers (it is handled server-side only)
    }

    // Broadcast everything else to the same group (include sender's deviceId as "from")
    if (client.groupId) {
      var relay = Object.assign({}, msg, { from: client.deviceId });
      broadcastGroup(client.groupId, relay, client.socket);
    }
  }

  function removeWsClient(socket) {
    var before = wsClients.length;
    var removed = wsClients.filter(function(c) { return c.socket === socket; });
    wsClients = wsClients.filter(function(c) { return c.socket !== socket; });
    if (wsClients.length < before) {
      // Remove from HTTP peers store too
      removed.forEach(function(c) {
        if (c.deviceId && c.groupId && peers[c.groupId]) {
          delete peers[c.groupId][c.deviceId];
        }
      });
      console.log('[ws] client disconnected; remaining=' + wsClients.length);
      var groups = {};
      wsClients.forEach(function(c) { if (c.groupId) groups[c.groupId] = true; });
      Object.keys(groups).forEach(sendPeers);
    }
  }

  server.on('upgrade', function(req, socket, head) {
    var key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    wsHandshake(socket, key);

    var client = { socket: socket, deviceId: '', groupId: '', ip: '', registeredAt: 0, buf: Buffer.alloc(0) };
    wsClients.push(client);
    console.log('[ws] new connection; total=' + wsClients.length);

    // Prepend the head bytes that were already read by the HTTP server
    if (head && head.length > 0) client.buf = head;

    socket.on('data', function(data) {
      client.buf = Buffer.concat([client.buf, data]);
      var result = wsDecodeFrames(client.buf);
      client.buf = result.remaining;
      result.frames.forEach(function(frame) {
        if (frame === null) { socket.destroy(); return; }
        handleWsMessage(client, frame);
      });
    });

    socket.on('close', function() { removeWsClient(socket); });
    socket.on('error', function(e) {
      console.log('[ws] socket error: ' + (e && e.message));
      removeWsClient(socket);
    });
  });

  // HEARTBEAT_PEERS broadcast every 5 s
  setInterval(function() {
    var groups = {};
    wsClients.forEach(function(c) { if (c.groupId) groups[c.groupId] = true; });
    Object.keys(groups).forEach(function(gid) {
      var ids = wsClients.filter(function(c) { return c.groupId === gid; }).map(function(c) { return c.deviceId; });
      var frame = wsEncodeText(JSON.stringify({ type: 'HEARTBEAT_PEERS', peers: ids }));
      wsClients.filter(function(c) { return c.groupId === gid; }).forEach(function(c) {
        try { c.socket.write(frame); } catch (_) {}
      });
    });
  }, 5000);

  return 'nexari-sync-relay started on :' + PORT;
};
