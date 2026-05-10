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
// System info snapshot (for heartbeat + pairing)
// --------------------------------------------------------------------------

/** CPU load 0-100 averaged over all logical cores, sampled over 200 ms. */
async function getCpuLoad(): Promise<number | null> {
  return new Promise((resolve) => {
    const cpus1 = os.cpus();
    setTimeout(() => {
      const cpus2 = os.cpus();
      let idle = 0, total = 0;
      for (let i = 0; i < cpus1.length; i++) {
        const t1 = cpus1[i]!.times;
        const t2 = cpus2[i]!.times;
        const dt = (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys)
                 + (t2.irq - t1.irq) + (t2.idle - t1.idle);
        idle  += (t2.idle - t1.idle);
        total += dt;
      }
      resolve(total > 0 ? Math.round((1 - idle / total) * 100) : null);
    }, 200);
  });
}

/**
 * Disk free bytes on the drive that holds the user-data directory.
 * Uses PowerShell Get-PSDrive on Windows; falls back to df on Linux.
 */
async function getStorageFree(): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      // Get the drive letter (e.g. C) from process.execPath
      const drive = process.execPath.split(':')[0]?.toUpperCase() ?? 'C';
      const { stdout } = await execAsync(
        `powershell -NonInteractive -Command "(Get-PSDrive -Name ${drive}).Free"`
      );
      const n = parseInt(stdout.trim(), 10);
      return isNaN(n) ? null : n;
    } else {
      const { stdout } = await execAsync("df -k / | awk 'NR==2{print $4}'");
      const kb = parseInt(stdout.trim(), 10);
      return isNaN(kb) ? null : kb * 1024;
    }
  } catch { return null; }
}

/**
 * CPU temperature in Celsius via WMI MSAcpi_ThermalZoneTemperature.
 * Many desktop/laptop BIOSes expose this; returns null if unavailable.
 */
async function getCpuTemperature(): Promise<number | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync(
      'powershell -NonInteractive -Command "(Get-WmiObject -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature).CurrentTemperature"'
    );
    // WMI reports tenths of Kelvin
    const raw = parseFloat(stdout.trim());
    if (isNaN(raw) || raw <= 0) return null;
    return Math.round((raw / 10 - 273.15) * 10) / 10;
  } catch { return null; }
}

/**
 * Read HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid via `reg query`.
 * Using reg.exe avoids PowerShell/cmd.exe quote-escaping issues with registry paths.
 */
async function getMachineGuid(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid'
    );
    const m = stdout.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    return m?.[1] ?? null;
  } catch { return null; }
}

/** OEM chassis serial from BIOS — matches label on device. */
async function getBiosSerial(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync(
      'powershell -NonInteractive -Command "(Get-WmiObject -Class Win32_BIOS).SerialNumber"'
    );
    const s = stdout.trim();
    if (!s || /to be filled|default string|n\/a/i.test(s)) return null;
    return s;
  } catch { return null; }
}

/** Active Wi-Fi SSID via netsh (null if on ethernet or not connected). */
export async function getWifiSsid(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync('netsh wlan show interfaces');
    // Match "    SSID                   : MyNetwork" but NOT "    BSSID …"
    const m = stdout.match(/\bSSID\s*:\s*(.+)/);
    const ssid = m?.[1]?.trim();
    return ssid || null;
  } catch { return null; }
}

/** System timezone as IANA name (e.g. "Asia/Singapore"). */
export async function getWindowsTimezone(): Promise<string> {
  try {
    const { stdout } = await execAsync('tzutil /g');
    const winId = stdout.trim();
    // Mapping of Windows timezone IDs → IANA names (common deployments first)
    const MAP: Record<string, string> = {
      'UTC': 'UTC',
      'Singapore Standard Time': 'Asia/Singapore',
      'Malay Peninsula Standard Time': 'Asia/Kuala_Lumpur',
      'SE Asia Standard Time': 'Asia/Bangkok',
      'China Standard Time': 'Asia/Shanghai',
      'Taipei Standard Time': 'Asia/Taipei',
      'Tokyo Standard Time': 'Asia/Tokyo',
      'Korea Standard Time': 'Asia/Seoul',
      'India Standard Time': 'Asia/Kolkata',
      'Sri Lanka Standard Time': 'Asia/Colombo',
      'Nepal Standard Time': 'Asia/Kathmandu',
      'Bangladesh Standard Time': 'Asia/Dhaka',
      'Myanmar Standard Time': 'Asia/Rangoon',
      'Arabian Standard Time': 'Asia/Dubai',
      'Pakistan Standard Time': 'Asia/Karachi',
      'Afghanistan Standard Time': 'Asia/Kabul',
      'West Asia Standard Time': 'Asia/Tashkent',
      'Central Asia Standard Time': 'Asia/Almaty',
      'Russian Standard Time': 'Europe/Moscow',
      'W. Europe Standard Time': 'Europe/Berlin',
      'Central Europe Standard Time': 'Europe/Warsaw',
      'Romance Standard Time': 'Europe/Paris',
      'GMT Standard Time': 'Europe/London',
      'Eastern Standard Time': 'America/New_York',
      'Central Standard Time': 'America/Chicago',
      'Mountain Standard Time': 'America/Denver',
      'Pacific Standard Time': 'America/Los_Angeles',
      'AUS Eastern Standard Time': 'Australia/Sydney',
      'E. Australia Standard Time': 'Australia/Brisbane',
      'W. Australia Standard Time': 'Australia/Perth',
      'New Zealand Standard Time': 'Pacific/Auckland',
      'Hawaiian Standard Time': 'Pacific/Honolulu',
    };
    return MAP[winId] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/** Full OS name e.g. "Windows 11 Pro". */
async function getOsCaption(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execAsync(
      'powershell -NonInteractive -Command "(Get-WmiObject -Class Win32_OperatingSystem).Caption"'
    );
    return stdout.trim() || null;
  } catch { return null; }
}

export async function getSystemInfo() {
  const vol = await getVolume();
  const brightness = await getBrightness();

  // Run all slow queries in parallel
  const [
    machineGuid, biosSerial, osCaption, windowsBuild,
    cpuLoad, storageFreeBytes, temperatureC,
    timezone, wifiSsid,
  ] = await Promise.all([
    getMachineGuid(),
    getBiosSerial(),
    getOsCaption(),
    process.platform === 'win32'
      ? execAsync('powershell -NonInteractive -Command "[System.Environment]::OSVersion.Version.ToString()"')
          .then(({ stdout }) => stdout.trim() || null).catch(() => null)
      : Promise.resolve(null),
    getCpuLoad(),
    getStorageFree(),
    getCpuTemperature(),
    getWindowsTimezone(),
    getWifiSsid(),
  ]);

  // First non-internal IPv4 + its MAC (skip zero-MACs from virtual adapters)
  let ipAddress: string | null = null;
  let macAddress: string | null = null;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (!iface.internal && iface.family === 'IPv4') {
        const validMac = (iface.mac && iface.mac !== '00:00:00:00:00:00') ? iface.mac : null;
        if (!ipAddress) { ipAddress = iface.address; macAddress = validMac; }
        else if (!macAddress && validMac) { macAddress = validMac; }
      }
    }
  }

  return {
    systemVolume:    vol?.level ?? null,
    systemMuted:     vol?.muted ?? null,
    brightness,
    windowsBuild,
    osCaption,
    cpuModel:        os.cpus()[0]?.model ?? null,
    osRelease:       os.release(),
    hostname:        os.hostname(),
    machineGuid,
    biosSerial,
    ipAddress,
    macAddress,
    cpuLoad,
    storageFreeBytes,
    temperatureC,
    timezone,
    wifiSsid,
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
