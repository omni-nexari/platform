/**
 * Test-only Node.js smoke server for Samsung B2B Tizen devices.
 *
 * This file is NOT used by the main player.
 * It is intended to be started directly from `test-tizen.html` via
 * b2bapis.b2bcontrol.startNodeServer(serverPath, serverName, onSuccess, onError).
 *
 * startNodeServer() only launches this script. The HTTP port is defined here by
 * server.listen(PORT, ...), and other devices on the same LAN must connect to
 * http://<tv-ip>:PORT.
 */

var http = require('http');

// Samsung SSSP Node.js runs as an unprivileged process — ports < 1024 are blocked.
// Port 8080 matches Samsung's own documentation example.
var PORT = 8080;
var STARTUP_BEACON_URL = 'http://192.168.1.110:3000/api/v1/devices/time?source=tizen-node-startup';

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
    if (typeof targetUrl !== 'string' || targetUrl.indexOf('http://') !== 0) {
      cb(new Error('Only http:// URLs are supported by this smoke test server'));
      return;
    }

    var withoutProtocol = targetUrl.substring('http://'.length);
    var slashIndex = withoutProtocol.indexOf('/');
    var hostPort = slashIndex >= 0 ? withoutProtocol.substring(0, slashIndex) : withoutProtocol;
    var requestPath = slashIndex >= 0 ? withoutProtocol.substring(slashIndex) : '/';
    var colonIndex = hostPort.indexOf(':');
    var hostname = colonIndex >= 0 ? hostPort.substring(0, colonIndex) : hostPort;
    var port = colonIndex >= 0 ? parseInt(hostPort.substring(colonIndex + 1), 10) : 80;

    if (!hostname) {
      cb(new Error('Invalid URL hostname'));
      return;
    }

    var options = {
      hostname: hostname,
      port: isNaN(port) ? 80 : port,
      path: requestPath,
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': 'tizen-node-smoke-test',
        'X-Tizen-Node-Smoke': '1'
      }
    };

    var request = http.request(options, function(response) {
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
