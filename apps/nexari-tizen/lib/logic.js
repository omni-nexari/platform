/**
 * Smoke-test logic for Samsung B2B Tizen Node.js runtime.
 *
 * This file is required by server65.js.signed (the signed entry-point).
 * Only the entry-point needs Samsung signing — this file is plain JS.
 *
 * What it does:
 *   1. Fires an outbound HTTP beacon to the dev server on startup.
 *   2. Starts an HTTP server on port 3000 serving GET /health.
 *
 * NOT used by the main player (server.js / MDC bridge).
 */

var Logic = function() {
  var http = require('http');
  var PORT = 3000;
  var DEV_SERVER = 'http://192.168.1.17';
  var BEACON_PATH = '/api/v1/devices/time?source=tizen-node-logic-startup';

  // ── Outbound beacon on startup ────────────────────────────────────────────
  try {
    var beacon = http.request(
      { hostname: '192.168.1.17', port: 80, path: BEACON_PATH, method: 'GET' },
      function(res) { console.log('[smoke] beacon response: ' + res.statusCode); }
    );
    beacon.on('error', function(e) { console.error('[smoke] beacon error: ' + e.message); });
    beacon.end();
  } catch (e) {
    console.error('[smoke] beacon threw: ' + e.message);
  }

  // ── HTTP server ───────────────────────────────────────────────────────────
  var server = http.createServer(function(req, res) {
    var cors = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, cors);
      res.end(JSON.stringify({
        ok: true,
        service: 'tizen-node-smoke',
        port: PORT,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Ping the dev server and return the result
    if (req.method === 'GET' && req.url.indexOf('/ping-dev') === 0) {
      var pingReq = http.request(
        { hostname: '192.168.1.17', port: 80, path: BEACON_PATH, method: 'GET' },
        function(pingRes) {
          var body = '';
          pingRes.on('data', function(c) { body += c; });
          pingRes.on('end', function() {
            res.writeHead(200, cors);
            res.end(JSON.stringify({ ok: true, upstream: pingRes.statusCode, body: body.slice(0, 200) }));
          });
        }
      );
      pingReq.on('error', function(e) {
        res.writeHead(200, cors);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      });
      pingReq.end();
      return;
    }

    res.writeHead(404, cors);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(PORT, '0.0.0.0', function() {
    console.log('[smoke] server listening on port ' + PORT);
    // Second beacon after server is up
    try {
      var b2 = http.request(
        { hostname: '192.168.1.17', port: 80, path: '/api/v1/devices/time?source=tizen-node-server-up', method: 'GET' },
        function(res) { console.log('[smoke] server-up beacon: ' + res.statusCode); }
      );
      b2.on('error', function(e) { console.error('[smoke] server-up beacon error: ' + e.message); });
      b2.end();
    } catch (e) {
      console.error('[smoke] server-up beacon threw: ' + e.message);
    }
  });

  server.on('error', function(e) {
    console.error('[smoke] server error: ' + e.message);
  });

  return 'Loaded';
};

module.exports = Logic;
