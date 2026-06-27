/**
 * pairing.ts — renderer logic for the pairing window.
 *
 * Identical flow to nexari-tizen:
 *   1. POST /devices/pair/request  → get code (or auto-resume if already claimed)
 *   2. Display code + device info
 *   3. Poll GET /devices/pair/status?code=CODE every 3 s
 *   4. On claimed → window.nexari.paired() → main switches to player window
 *
 * Connection settings panel lets the user change the API base URL and reload.
 */

const codeEl    = document.getElementById('pairing-code')    as HTMLDivElement;
const statusEl  = document.getElementById('pairing-status')  as HTMLDivElement;
const hostEl    = document.getElementById('device-hostname') as HTMLSpanElement;
const ipEl      = document.getElementById('device-ip')       as HTMLSpanElement;
const osEl      = document.getElementById('device-os')       as HTMLSpanElement;
const cpuEl     = document.getElementById('device-cpu')      as HTMLSpanElement;

const connToggle = document.getElementById('conn-settings-toggle') as HTMLButtonElement;
const connPanel  = document.getElementById('conn-settings-panel')  as HTMLDivElement;
const connArrow  = document.getElementById('conn-arrow')           as HTMLSpanElement;
const apiInput   = document.getElementById('input-api-base')       as HTMLInputElement;
const btnSave    = document.getElementById('btn-save')             as HTMLButtonElement;
const btnReset   = document.getElementById('btn-reset')            as HTMLButtonElement;
const connMsg    = document.getElementById('conn-msg')             as HTMLDivElement;

// ── Connection settings ────────────────────────────────────────────────────────

let connOpen = false;
connToggle.addEventListener('click', () => {
  connOpen = !connOpen;
  connPanel.classList.toggle('hidden', !connOpen);
  connToggle.classList.toggle('open', connOpen);
  connArrow.textContent = connOpen ? '▴' : '▾';
  if (connOpen) apiInput.focus();
});

btnSave.addEventListener('click', async () => {
  const val = apiInput.value.trim().replace(/\/$/, '');
  try { new URL(val); } catch {
    connMsg.style.color = '#f87171';
    connMsg.textContent = 'Invalid URL — must start with http:// or https://';
    return;
  }
  // Persist to both localStorage (renderer read) and electron-store (CSP rebuild on next load).
  localStorage.setItem('PLAYER_API_BASE', val);
  await window.nexari.setApiBase(val);
  connMsg.style.color = '#4ade80';
  connMsg.textContent = 'Saved — reconnecting…';
  setTimeout(() => location.reload(), 700);
});

btnReset.addEventListener('click', () => {
  localStorage.removeItem('PLAYER_API_BASE');
  connMsg.style.color = '#4ade80';
  connMsg.textContent = 'Reset to defaults — reconnecting…';
  setTimeout(() => location.reload(), 700);
});

// ── Status helpers ─────────────────────────────────────────────────────────────

function setStatus(msg: string, type: 'normal' | 'error' | 'success' = 'normal') {
  statusEl.textContent = msg;
  statusEl.className = 'pairing-status' + (type !== 'normal' ? ` ${type}` : '');
}

// ── Pairing ────────────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function init() {
  // 0. Show player version
  try {
    const cfg = await window.nexari.getConfig();
    const vEl = document.getElementById('player-version');
    if (vEl && cfg.appVersion) vEl.textContent = `v${cfg.appVersion}`;
  } catch { /* ignore */ }

  // 1. Resolve apiBase: localStorage override → IPC default
  const apiBase = localStorage.getItem('PLAYER_API_BASE')
    || await window.nexari.getDefaultApiBase();

  // Pre-fill connection settings input
  apiInput.value = apiBase;

  // 2. Get device info
  const info: any = await window.nexari.getSystemInfo();

  hostEl.textContent = info?.hostname ?? navigator.userAgent.split(' ')[0] ?? '—';
  ipEl.textContent   = info?.ipAddress ?? '—';
  osEl.textContent   = info?.osCaption ?? (info?.windowsBuild ? `Windows ${info.windowsBuild}` : (info?.osRelease ?? '—'));
  cpuEl.textContent  = (info?.cpuModel ?? '—').replace(/\s+@.+$/, '');  // strip clock speed for brevity

  // 3. Request pairing code
  await requestCode(apiBase, info);
}

async function requestCode(apiBase: string, info: any) {
  setStatus('Requesting pairing code…');

  const body = {
    duid:            info?.machineGuid ?? info?.hostname ?? null,
    modelName:       info?.cpuModel ?? null,
    serialNumber:    info?.biosSerial ?? info?.machineGuid ?? info?.hostname ?? null,
    firmwareVersion: info?.windowsBuild ?? info?.osRelease ?? null,
    platform:        'windows',
    osVersion:       info?.osCaption ?? info?.osRelease ?? null,
    cpuModel:        info?.cpuModel ?? null,
    windowsBuild:    info?.windowsBuild ?? null,
    macAddress:      info?.macAddress ?? null,
  };

  try {
    const res = await fetch(`${apiBase}/devices/pair/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();

    // Already paired (e.g. reinstall of same machine)
    if (data.status === 'claimed' && data.deviceToken) {
      setStatus('Device already registered. Resuming…', 'success');
      await onClaimed(apiBase, data.deviceId, data.deviceToken);
      return;
    }

    if (!data.code) throw new Error('No pairing code received from server');

    // Show code and start polling
    codeEl.textContent = data.code;
    setStatus('Waiting for admin to confirm in the dashboard…');
    startPolling(apiBase, data.code);

  } catch (err: any) {
    setStatus(`Failed: ${err?.message ?? 'network error'}`, 'error');
    // Auto-retry after 15 s
    setTimeout(() => requestCode(apiBase, info), 15_000);
  }
}

function startPolling(apiBase: string, code: string) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${apiBase}/devices/pair/status?code=${encodeURIComponent(code)}`);
      if (!res.ok) return; // transient — keep polling
      const data = await res.json();
      if (data.status === 'claimed' && data.deviceToken) {
        clearInterval(pollTimer!);
        pollTimer = null;
        setStatus('Paired! Starting player…', 'success');
        codeEl.style.color = '#4ade80';
        await onClaimed(apiBase, data.deviceId, data.deviceToken);
      }
    } catch {
      // network hiccup — keep polling
    }
  }, 3_000);
}

async function onClaimed(apiBase: string, deviceId: string, token: string) {
  // Write to localStorage so the player window (same file:// origin) picks it up
  localStorage.setItem('apiBase',     apiBase);
  localStorage.setItem('deviceToken', token);
  localStorage.setItem('deviceId',    deviceId);

  // Hand off to main process — switches to player window
  window.nexari.paired({ token, deviceId, apiBase });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
init().catch(err => {
  console.error('Pairing init error:', err);
  setStatus(`Init error: ${err?.message ?? err}`, 'error');
});

