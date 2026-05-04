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

  return 'nexari-sync-relay started on :' + PORT;
};
