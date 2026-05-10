/**
 * os-bridge.ts — IPC handlers and helpers for Windows OS integration.
 *
 * Volume/mute: via `loudness` npm package (WinRT Audio API wrapper).
 * Brightness:  via WMI / PowerShell (best-effort; external monitors unsupported).
 * WoL:         via `wake_on_lan` npm package.
 */
import { ipcMain } from 'electron';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import wol from 'wake_on_lan';

const execAsync = promisify(exec);

// --------------------------------------------------------------------------
// Volume / Mute
// --------------------------------------------------------------------------
export async function getVolume(): Promise<{ level: number; muted: boolean } | null> {
  try {
    const loudness = await import('loudness');
    const [level, muted] = await Promise.all([loudness.getVolume(), loudness.getMuted()]);
    return { level, muted };
  } catch {
    return null;
  }
}

export async function setVolume(level: number): Promise<void> {
  try {
    const loudness = await import('loudness');
    await loudness.setVolume(Math.max(0, Math.min(100, level)));
  } catch { /* no-op on unsupported HW */ }
}

export async function setMute(mute: boolean): Promise<void> {
  try {
    const loudness = await import('loudness');
    await loudness.setMuted(mute);
  } catch { /* no-op */ }
}

// --------------------------------------------------------------------------
// Brightness (internal display only via WMI)
// --------------------------------------------------------------------------
export async function setBrightness(level: number, _displayIndex?: number): Promise<void> {
  if (process.platform !== 'win32') return;
  const pct = Math.max(0, Math.min(100, level));
  const cmd = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${pct})`;
  await execAsync(`powershell -NonInteractive -Command "${cmd}"`).catch(() => {});
}

export async function getBrightness(): Promise<number | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync(
      `powershell -NonInteractive -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"`
    );
    return parseInt(stdout.trim(), 10) || null;
  } catch { return null; }
}

// --------------------------------------------------------------------------
// Wake-on-LAN relay
// --------------------------------------------------------------------------
export function sendWol(mac: string, broadcastIp?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const opts: any = {};
    if (broadcastIp) opts.address = broadcastIp;
    wol.wake(mac, opts, (err: Error | null | undefined) => {
      if (err) reject(err); else resolve();
    });
  });
}

// --------------------------------------------------------------------------
// System info snapshot (for heartbeat)
// --------------------------------------------------------------------------
export async function getSystemInfo() {
  const vol = await getVolume();
  const brightness = await getBrightness();

  // Windows build number from `ver` output
  let windowsBuild: string | null = null;
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('ver');
      const m = stdout.match(/(\d+\.\d+\.\d+)/);
      if (m) windowsBuild = m[1] ?? null;
    } catch { /* ignore */ }
  }

  // First non-internal IPv4 + its MAC
  let ipAddress: string | null = null;
  let macAddress: string | null = null;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (!iface.internal && iface.family === 'IPv4') {
        if (!ipAddress) ipAddress = iface.address;
        if (!macAddress) macAddress = iface.mac;
      }
    }
  }

  return {
    systemVolume: vol?.level ?? null,
    systemMuted: vol?.muted ?? null,
    brightness,
    windowsBuild,
    cpuModel: os.cpus()[0]?.model ?? null,
    osRelease: os.release(),
    hostname: os.hostname(),
    ipAddress,
    macAddress,
  };
}

// --------------------------------------------------------------------------
// IPC handler registration (called from main.ts)
// --------------------------------------------------------------------------
export function registerOsBridges() {
  ipcMain.handle('os:getSystemInfo', () => getSystemInfo());
  ipcMain.handle('os:setVolume',     (_e, level: number) => setVolume(level));
  ipcMain.handle('os:setMute',       (_e, mute: boolean) => setMute(mute));
  ipcMain.handle('os:setBrightness', (_e, level: number, idx?: number) => setBrightness(level, idx));
  ipcMain.handle('os:sendWol',       (_e, mac: string, broadcastIp?: string) => sendWol(mac, broadcastIp));
}
