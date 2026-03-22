/**
 * Samsung MDC (Multiple Display Control) — LAN TCP command sender.
 *
 * Protocol frame: [0xAA] [CMD] [DISPLAY_ID] [DATA_LEN] [DATA…] [CHECKSUM]
 *   Checksum = (CMD + DISPLAY_ID + DATA_LEN + sum(DATA bytes)) mod 256
 *
 * Samsung LFD/commercial displays listen on TCP port 1515 for MDC commands.
 * The API server opens a TCP socket directly to the device's LAN IP — no
 * changes are required on the Tizen app side.
 *
 * Key codes sourced from community reverse-engineering of the Samsung MDC
 * specification (QBx/QMx/PMx series). Verify on your specific model.
 */

import net from 'node:net';

// ── Navigation / function key codes (used with CMD 0x0B) ────────────────────
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

/** All command names accepted by the /remote-key route. */
export const MDC_ALL_COMMAND_NAMES = new Set([
  ...Object.keys(MDC_KEY_CODES),
  'POWER_ON',
  'POWER_OFF',
  'REBOOT',
]);

const MDC_PORT           = 1515;
const CONNECT_TIMEOUT_MS = 3000;
const MDC_CMD_KEY        = 0x0B; // Key Control
const MDC_CMD_POWER      = 0x11; // Panel Power On/Off
const MDC_CMD_RESET      = 0xA1; // Device restart (model-dependent)

/** Build a complete MDC binary packet. */
function buildPacket(cmd: number, data: number[], displayId = 0x01): Buffer {
  const len = data.length;
  const checksum = (cmd + displayId + len + data.reduce((s, b) => s + b, 0)) & 0xff;
  return Buffer.from([0xaa, cmd, displayId, len, ...data, checksum]);
}

/** Open TCP socket to ip:1515, send packet, close immediately. */
function sendPacket(ip: string, packet: Buffer): Promise<void> {
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

/** Send a navigation / function key press. */
export function sendMdcKey(ip: string, key: MdcKeyName): Promise<void> {
  return sendPacket(ip, buildPacket(MDC_CMD_KEY, [MDC_KEY_CODES[key]]));
}

/** Power the panel on (true) or off / standby (false). CMD 0x11. */
export function sendMdcPower(ip: string, on: boolean): Promise<void> {
  return sendPacket(ip, buildPacket(MDC_CMD_POWER, [on ? 0x01 : 0x00]));
}

/**
 * Restart the display OS. Uses CMD 0xA1 / data 0x00 which triggers a
 * soft-restart on most Samsung QBx / QMx / PMx series.
 * Behaviour is model-dependent — no response packet is expected.
 */
export function sendMdcReboot(ip: string): Promise<void> {
  return sendPacket(ip, buildPacket(MDC_CMD_RESET, [0x00]));
}
