/**
 * Test-only Node.js smoke server for Samsung B2B Tizen devices.
 *
 * This file is NOT used by the main player.
 * It is intended to be signed as `test-node-server.js.signed` and started
 * manually from `test-tizen.html` via b2bapis.b2bcontrol.startNodeServer().
 */

var http = require('http');
var https = require('https');
var url = require('url');

var PORT = 80;
var STARTUP_BEACON_URL = 'http://192.168.1.17/api/v1/devices/time?source=tizen-node-startup';

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function collectRequestBody(req, cb) {
  var body = '';
  req.on('data', function(chunk) { body += chunk.toString(); });
  req.on('end', function() { cb(body); });
}

function outboundPing(targetUrl, cb) {
  try {
    var parsed = url.parse(targetUrl);
    var transport = parsed.protocol === 'https:' ? https : http;
    var options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': 'tizen-node-smoke-test',
        'X-Tizen-Node-Smoke': '1'
      }
    };

    var request = transport.request(options, function(response) {
      var text = '';
      response.on('data', function(chunk) { text += chunk.toString(); });
      response.on('end', function() {
        cb(null, {
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          body: text
        });
      });
    });

    request.on('timeout', function() {
      request.destroy(new Error('Outbound request timeout'));
    });
    request.on('error', function(error) {
      cb(error);
    });
    request.end();
  } catch (error) {
    cb(error);
  }
}

var server = http.createServer(function(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    respondJson(res, 200, {
      ok: true,
      service: 'test-node-server',
      port: PORT,
      pid: typeof process !== 'undefined' ? process.pid : null,
      uptimeSec: typeof process !== 'undefined' && process.uptime ? Math.round(process.uptime()) : null,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/ping-dev') {
    collectRequestBody(req, function(body) {
      var payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (error) {
        respondJson(res, 400, { ok: false, error: 'Bad JSON' });
        return;
      }

      if (!payload.url || typeof payload.url !== 'string') {
        respondJson(res, 400, { ok: false, error: 'Missing url' });
        return;
      }

      outboundPing(payload.url, function(error, result) {
        if (error) {
          respondJson(res, 502, {
            ok: false,
            url: payload.url,
            error: error.message || String(error)
          });
          return;
        }

        respondJson(res, result.ok ? 200 : 502, {
          ok: result.ok,
          url: payload.url,
          statusCode: result.statusCode,
          statusMessage: result.statusMessage,
          body: result.body
        });
      });
    });
    return;
  }

  respondJson(res, 404, {
    ok: false,
    error: 'Not found',
    method: req.method,
    url: req.url
  });
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('[test-node-server] listening on 0.0.0.0:' + PORT);

  if (STARTUP_BEACON_URL) {
    var separator = STARTUP_BEACON_URL.indexOf('?') >= 0 ? '&' : '?';
    var beaconUrl = STARTUP_BEACON_URL + separator + 'ts=' + encodeURIComponent(new Date().toISOString());
    outboundPing(beaconUrl, function(error, result) {
      if (error) {
        console.log('[test-node-server] startup beacon failed: ' + (error.message || String(error)));
        return;
      }
      console.log('[test-node-server] startup beacon response: ' + result.statusCode + ' ' + result.statusMessage);
    });
  }
});
