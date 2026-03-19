/**
 * Tizen Signage Player — main entry point.
 *
 * Boot sequence:
 *  1. Read stored credentials (widgetdata / localStorage)
 *  2. If no deviceToken → request pairing code from server → show pairing UI
 *  3. Connect WS
 *  4. Fetch schedule + workspace config
 *  5. Start scheduler tick (10 s) + heartbeat (30 s)
 */

import { getDeviceToken, getDeviceId, getApiBase, setDeviceToken, setDeviceId } from './store.js';
import { getIdentity } from './device/identity.js';
import { getNetworkInfo } from './device/network.js';
import { connect, send } from './ws/manager.js';
import { scheduler } from './scheduler/index.js';
import { showPairing } from './ui/pairing.js';
import { setIdleDeviceInfo, setIdleLogo } from './ui/idle.js';
import { appendLog } from './ui/osd.js';
import { showOsd } from './ui/osd.js';

async function boot(): Promise<void> {
  appendLog('Player booting');

  const identity = getIdentity();
  appendLog(`DUID: ${identity.duid} model: ${identity.modelName}`);

  let deviceToken = getDeviceToken();
  let deviceId = getDeviceId();

  // ── Step 1: Pair if no token ─────────────────────────────────────────────
  if (!deviceToken || !deviceId) {
    try {
      const res = await fetch(`${getApiBase()}/devices/pair/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duid: identity.duid,
          modelName: identity.modelName,
          modelCode: identity.modelCode,
          serialNumber: identity.serialNumber,
          firmwareVersion: identity.firmwareVersion,
        }),
      });
      const data = await res.json() as { deviceId: string; code: string };
      deviceId = data.deviceId;
      setDeviceId(deviceId);
      showPairing(data.code, deviceId);
      return; // pairing UI will reload page on claim
    } catch (e) {
      appendLog(`Pair request failed: ${String(e)}`);
      // Retry after 15 s
      setTimeout(() => void boot(), 15_000);
      return;
    }
  }

  // ── Step 2: Send network info & system state ─────────────────────────────
  const netInfo = getNetworkInfo();

  // ── Step 3: Connect WS ───────────────────────────────────────────────────
  connect();

  // Send network_info once connected (slight delay for WS handshake)
  setTimeout(() => {
    send({ type: 'network_info', payload: { ...netInfo } });
  }, 2000);

  // ── Step 4: Init scheduler (fetches schedule + workspace, starts ticks) ──
  await scheduler.init();

  // ── Step 5: Set idle screen device info ──────────────────────────────────
  setIdleDeviceInfo(`DUID: ${identity.duid}`, netInfo.ip);

  appendLog('Boot complete');
}

// ── INFO key handler (Samsung remote) ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Info' || e.keyCode === 457) showOsd();
});

void boot();
