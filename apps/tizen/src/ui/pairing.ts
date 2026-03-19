/**
 * Pairing screen — shown on first boot until the device is claimed.
 * Displays the 6-char code in large text. Polls /devices/pair/status every 5 s.
 */

import { getApiBase, setDeviceToken, setDeviceId } from '../store.js';

export function showPairing(code: string, deviceId: string): void {
  document.body.innerHTML = `
    <div style="
      width:100vw; height:100vh;
      background:#0f172a;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      font-family:'Segoe UI',Arial,sans-serif;
      color:#e2e8f0;
      gap:24px;
    ">
      <div style="font-size:2.5vw;color:#94a3b8;letter-spacing:0.15em;">PAIR THIS DISPLAY</div>
      <div style="
        font-size:12vw; font-weight:800; letter-spacing:0.15em;
        color:#38bdf8; font-family:monospace;
      ">${code}</div>
      <div style="font-size:1.8vw;color:#64748b;text-align:center;">
        Enter this code in your Signage dashboard<br/>under Devices → Add Display
      </div>
    </div>
  `;

  const poll = setInterval(async () => {
    try {
      const res = await fetch(`${getApiBase()}/devices/pair/status?code=${code}`);
      const data = await res.json() as { status: string; deviceToken?: string; deviceId?: string };
      if (data.status === 'claimed' && data.deviceToken && data.deviceId) {
        clearInterval(poll);
        setDeviceToken(data.deviceToken);
        setDeviceId(data.deviceId);
        window.location.reload();
      }
    } catch { /* keep polling */ }
  }, 5000);
}
