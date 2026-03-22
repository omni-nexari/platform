/**
 * MDC Bridge — local Node.js HTTP server running ON the Samsung display.
 *
 * Started by app.js via:
 *   b2bapis.b2bcontrol.startNodeServer('server.js.signed', 'mdc-bridge', ...)
 *
 * The browser-side player calls:
 *   POST http://127.0.0.1:9615/remote-key   { key: 'ARROW_UP' }
 *
 * This server translates the key name into a Samsung MDC binary packet and
 * sends it to the TV firmware via TCP on localhost:1515 (MDC port).
 * Because both this server and the firmware are on the same device, 127.0.0.1
 * always works regardless of the display's external IP or network topology.
 *
 * NOTE: This file must be signed with Samsung's Node signing tool before
 * deployment. The signed output (server.js.signed) is what gets bundled in
 * the .wgt package. Only Node built-in modules may be used — no node_modules.
 */

var http = require('http');
var net  = require('net');

// ── MDC protocol constants ────────────────────────────────────────────────
var MDC_TCP_PORT     = 1515;
var HTTP_PORT        = 9615;
var CONNECT_TIMEOUT  = 3000;

var CMD_KEY   = 0x0B; // Key Control
var CMD_STATUS = 0x00; // Status Control (Get)
var CMD_POWER = 0x11; // Panel Power On/Off
var CMD_RESET = 0xA1; // Soft restart (model-dependent; no response expected)

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

// ── Packet builder ────────────────────────────────────────────────────────
function buildPacket(cmd, dataBytes, displayId) {
  displayId = displayId || 0x01;
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

// ── TCP sender ────────────────────────────────────────────────────────────
function sendMdcPacket(packet, cb) {
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

function sendMdcPacketWithResponse(packet, cb) {
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

      if (key === 'POWER_ON') {
        packet = buildPacket(CMD_POWER, [0x01]);
      } else if (key === 'POWER_OFF') {
        packet = buildPacket(CMD_POWER, [0x00]);
      } else if (key === 'REBOOT') {
        packet = buildPacket(CMD_RESET, [0x00]);
      } else if (KEY_CODES[key] !== undefined) {
        packet = buildPacket(CMD_KEY, [KEY_CODES[key]]);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown key: ' + key }));
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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(HTTP_PORT, '127.0.0.1', function() {
  console.log('[mdc-bridge] Listening on 127.0.0.1:' + HTTP_PORT);
});
