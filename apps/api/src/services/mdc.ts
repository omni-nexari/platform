/**
 * Samsung MDC (Multiple Display Control) — LAN TCP key injection.
 *
 * Protocol frame: [0xAA] [CMD] [DISPLAY_ID] [DATA_LEN] [DATA…] [CHECKSUM]
 *   Checksum = (CMD + DISPLAY_ID + DATA_LEN + DATA bytes) mod 256
 *
 * Samsung LFD/commercial displays listen on TCP port 1515 for MDC commands.
 * The API server opens a TCP socket directly to the device's LAN IP — no
 * changes are required on the Tizen app side.
 *
 * Key codes are sourced from community reverse-engineering of the Samsung MDC
 * specification. These are consistent across Samsung LFD (QBx/QMx/PMx) series
 * but may need verification on specific model variants.
 */

import net from 'node:net';

export const MDC_KEY_CODES = {
  ARROW_UP:    0x60,
  ARROW_DOWN:  0x61,
  ARROW_LEFT:  0x65,
  ARROW_RIGHT: 0x62,
  ENTER:       0x68,
  RETURN:      0x58, // Back / Return
  MENU:        0x1A,
  HOME:        0x79,
} as const;

export type MdcKeyName = keyof typeof MDC_KEY_CODES;

const MDC_PORT = 1515;
const MDC_CMD_KEY = 0x0B;     // Key Control command
const CONNECT_TIMEOUT_MS = 3000;

function buildKeyPacket(keyCode: number, displayId = 0x01): Buffer {
  const cmd = MDC_CMD_KEY;
  const dataLen = 0x01;
  const checksum = (cmd + displayId + dataLen + keyCode) & 0xff;
  return Buffer.from([0xaa, cmd, displayId, dataLen, keyCode, checksum]);
}

/**
 * Send a single key press to a Samsung LFD display via MDC over TCP.
 * Connects, sends the 6-byte packet, then immediately closes the socket.
 */
export async function sendMdcKey(ip: string, key: MdcKeyName): Promise<void> {
  const packet = buildKeyPacket(MDC_KEY_CODES[key]);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: MDC_PORT });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`MDC: connection to ${ip}:${MDC_PORT} timed out`));
    }, CONNECT_TIMEOUT_MS);

    socket.once('connect', () => {
      socket.write(packet, (err) => {
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve();
      });
    });

    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
