#!/usr/bin/env node
/**
 * test-mdc-reboot.mjs
 * Local test tool — sends MDC reboot commands directly to a Samsung display
 * over TCP port 1515 (Samsung MDC protocol).
 *
 * Usage:
 *   node tools/test-mdc-reboot.mjs <ip> [displayId]
 *
 * Examples:
 *   node tools/test-mdc-reboot.mjs 192.168.1.50
 *   node tools/test-mdc-reboot.mjs 192.168.1.50 1
 *
 * MDC §2.1.11 – CMD_POWER (0x11):
 *   0x00 = Off | 0x01 = On | 0x02 = Reboot
 * CMD_RESET (0xA1) – soft-restart fallback for older firmware.
 *
 * The script also sends CMD_STATUS (0x00) first to confirm the TCP link
 * is alive, then tries CMD_POWER [0x02] and CMD_RESET [0x00] for reboot.
 */

import net from 'net';

const MDC_PORT = 1515;
const CONNECT_TIMEOUT_MS = 5000;
const RECV_TIMEOUT_MS   = 3000;

const CMD_STATUS = 0x00;
const CMD_POWER  = 0x11;
const CMD_RESET  = 0xA1;

// ── packet builder ──────────────────────────────────────────────────────────
function buildPacket(cmd, dataBytes, displayId = 0) {
  const len = dataBytes.length;
  let checksum = cmd + displayId + len;
  for (const b of dataBytes) checksum += b;
  checksum &= 0xff;
  return Buffer.from([0xaa, cmd, displayId, len, ...dataBytes, checksum]);
}

function hexBuf(buf) {
  return [...buf].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// ── single-shot TCP send ────────────────────────────────────────────────────
function sendPacket(host, packet, label, waitForReply = true) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let replied = false;
    let chunks = [];

    const finish = (status, info = '') => {
      if (replied) return;
      replied = true;
      s.destroy();
      const recv = chunks.length ? ' | reply: ' + hexBuf(Buffer.concat(chunks)) : '';
      console.log(`  [${label}] ${status}${info}${recv}`);
      resolve({ status, label });
    };

    s.setTimeout(CONNECT_TIMEOUT_MS);
    s.on('timeout', () => finish('TIMEOUT'));
    s.on('error', (e) => finish('ERROR', ` (${e.message})`));

    s.connect(MDC_PORT, host, () => {
      console.log(`  [${label}] TCP connected → sending: ${hexBuf(packet)}`);
      s.write(packet, () => {
        if (!waitForReply) {
          // Fire-and-forget — device drops connection on reboot, no ACK expected
          setTimeout(() => finish('SENT (no-ack)'), 300);
        }
      });
    });

    s.on('data', (chunk) => {
      chunks.push(chunk);
      if (!waitForReply) return;
      // Full MDC reply is 0xAA 0xFF <id> <len> <data...> <checksum>
      const full = Buffer.concat(chunks);
      if (full.length >= 3) {
        const expectedLen = 3 + 1 + full[3] + 1; // header(3) + len-byte + data + checksum
        if (full.length >= expectedLen) finish('ACK');
      }
    });

    // Fallback timeout for reply window
    if (waitForReply) {
      setTimeout(() => finish('NO-REPLY'), RECV_TIMEOUT_MS);
    }
  });
}

// ── main ────────────────────────────────────────────────────────────────────
const [,, ipArg, idArg] = process.argv;

if (!ipArg) {
  console.error('Usage: node tools/test-mdc-reboot.mjs <ip> [displayId]');
  process.exit(1);
}

const host      = ipArg;
const displayId = idArg != null ? parseInt(idArg, 10) : 0;

if (isNaN(displayId) || displayId < 0 || displayId > 254) {
  console.error('displayId must be 0–254');
  process.exit(1);
}

console.log(`\n=== MDC Reboot Test ===`);
console.log(`Target : ${host}:${MDC_PORT}  displayId=0x${displayId.toString(16).padStart(2,'0').toUpperCase()} (${displayId})\n`);

// 1. Status ping — verify TCP link and get current power state
console.log('Step 1: CMD_STATUS (0x00) — confirm device reachable');
await sendPacket(host, buildPacket(CMD_STATUS, [], displayId), 'STATUS', true);

// Small gap so the firmware releases the TCP slot (Samsung only handles 1 connection at a time)
await new Promise(r => setTimeout(r, 400));

// 2. CMD_POWER [0x02] — Reboot (MDC §2.1.11, newer firmware)
console.log('\nStep 2: CMD_POWER (0x11) [0x02] — Reboot');
await sendPacket(host, buildPacket(CMD_POWER, [0x02], displayId), 'REBOOT-POWER', false);

await new Promise(r => setTimeout(r, 300));

// 3. CMD_RESET [0x00] — Soft-restart (older firmware fallback)
console.log('\nStep 3: CMD_RESET (0xA1) [0x00] — Soft-restart fallback');
await sendPacket(host, buildPacket(CMD_RESET, [0x00], displayId), 'REBOOT-RESET', false);

console.log('\n=== Done — watch the screen for a reboot ===\n');
