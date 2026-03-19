/**
 * Built-in idle screen.
 * Shown when no schedule slot is active and no default playlist is configured.
 * Fully offline — no network required.
 */

let clockTimer: ReturnType<typeof setInterval> | null = null;

export function showIdle(): void {
  const el = document.getElementById('idle')!;
  if (el.style.display === 'block') return; // already visible

  el.innerHTML = `
    <div style="
      width: 100%; height: 100%;
      background: #0a0a0a;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #e0e0e0;
      gap: 16px;
    ">
      <div id="idle-clock" style="font-size: 10vw; font-weight: 200; letter-spacing: 0.05em; color: #fff;"></div>
      <div id="idle-date"  style="font-size: 2.4vw; color: #888; letter-spacing: 0.1em;"></div>
      <div id="idle-logo"  style="margin: 24px 0;"></div>
      <div id="idle-info"  style="font-size: 1.4vw; color: #555; text-align: center; line-height: 1.8;"></div>
      <div id="idle-ws"    style="
        position: absolute; bottom: 2vh; right: 2vw;
        display: flex; align-items: center; gap: 8px;
        font-size: 1.2vw; color: #444;
      ">
        <span id="idle-ws-dot" style="width:10px;height:10px;border-radius:50%;background:#555;display:inline-block;"></span>
        <span id="idle-ws-label">Connecting…</span>
      </div>
    </div>
  `;

  el.style.display = 'block';
  updateIdleContent();

  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(updateIdleContent, 1000);
}

export function hideIdle(): void {
  const el = document.getElementById('idle')!;
  el.style.display = 'none';
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function updateIdleContent(): void {
  const now = new Date();

  const clockEl = document.getElementById('idle-clock');
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const dateEl = document.getElementById('idle-date');
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
  }

  // WS status dot
  import('../state.js').then(({ state }) => {
    const dot = document.getElementById('idle-ws-dot');
    const label = document.getElementById('idle-ws-label');
    if (dot && label) {
      dot.style.background = state.wsConnected ? '#22c55e' : '#ef4444';
      label.textContent = state.wsConnected ? 'Connected' : 'Offline';
    }
  });
}

export function setIdleDeviceInfo(name: string, ip: string): void {
  const el = document.getElementById('idle-info');
  if (el) el.innerHTML = `${name}<br>${ip}`;
}

export function setIdleLogo(logoUrl: string): void {
  const el = document.getElementById('idle-logo');
  if (!el || !logoUrl) return;
  el.innerHTML = `<img src="${logoUrl}" style="max-height:8vh;max-width:20vw;object-fit:contain;opacity:0.7;" />`;
}
