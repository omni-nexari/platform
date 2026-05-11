/**
 * windows-settings.ts — applies the per-device WindowsPlayerSettings to the
 * running player. Persists them to JsonStore so they survive restarts.
 *
 * Behaviors:
 *   • autoLaunch                  → app.setLoginItemSettings
 *   • dailyRebootTime             → setInterval check, app.relaunch + app.exit
 *   • hideCursor                  → renderer broadcast (CSS body { cursor:none })
 *   • enforceSleepBlock           → powerSaveBlocker watchdog
 *   • blockShortcuts              → globalShortcut.register Alt+F4 / Win / etc.
 *   • exitPinHash                 → stored; renderer prompts on close attempt
 *   • hardwareAcceleration:false  → app.disableHardwareAcceleration() (boot only)
 *   • rotation                    → renderer broadcast (CSS transform)
 *   • logRetentionDays            → file-rotation cleanup of asset-cache/log files
 *   • assetCacheMaxBytes          → LRU eviction of asset-cache directory
 *   • proxyUrl                    → session.defaultSession.setProxy
 *   • targetDisplayIndex          → reposition player window
 *   • remoteDevToolsPort          → command-line switch (boot only — warns at runtime)
 */
import { app, BrowserWindow, globalShortcut, powerSaveBlocker, screen, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { getStore } from './store.js';

export type WindowsPlayerSettings = {
  autoLaunch?: boolean;
  dailyRebootTime?: string | null;
  hideCursor?: boolean;
  enforceSleepBlock?: boolean;
  blockShortcuts?: boolean;
  exitPinHash?: string | null;
  hardwareAcceleration?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  logRetentionDays?: number;
  assetCacheMaxBytes?: number;
  proxyUrl?: string | null;
  targetDisplayIndex?: number | null;
  remoteDevToolsPort?: number | null;
};

const DEFAULTS: Required<{
  [K in keyof WindowsPlayerSettings]: NonNullable<WindowsPlayerSettings[K]>;
}> = {
  autoLaunch: true,
  dailyRebootTime: '03:30',
  hideCursor: true,
  enforceSleepBlock: true,
  blockShortcuts: true,
  exitPinHash: '',
  hardwareAcceleration: true,
  rotation: 0,
  logRetentionDays: 14,
  assetCacheMaxBytes: 50 * 1024 * 1024 * 1024, // 50 GB
  proxyUrl: '',
  targetDisplayIndex: 0,
  remoteDevToolsPort: 0,
};

let _current: WindowsPlayerSettings = {};
let _powerBlockerId: number | null = null;
let _powerBlockerTimer: ReturnType<typeof setInterval> | null = null;
let _rebootTimer: ReturnType<typeof setInterval> | null = null;
let _cacheGcTimer: ReturnType<typeof setInterval> | null = null;
let _playerWin: BrowserWindow | null = null;

/** Get the merged effective settings (saved + defaults). */
export function getEffectiveSettings(): Required<WindowsPlayerSettings> {
  return { ...DEFAULTS, ..._current } as Required<WindowsPlayerSettings>;
}

/** Read pre-app-ready settings (called from main.ts before app.on('ready')). */
export function loadSettingsForBoot(): Required<WindowsPlayerSettings> {
  try {
    const stored = getStore().get('windowsSettings') as WindowsPlayerSettings | undefined;
    _current = stored || {};
  } catch {
    _current = {};
  }
  return getEffectiveSettings();
}

/** Apply settings on receipt from server (or after store load). */
export async function applySettings(
  next: WindowsPlayerSettings,
  win: BrowserWindow | null,
): Promise<void> {
  _playerWin = win;
  _current = { ..._current, ...next };
  try { getStore().set('windowsSettings', _current); } catch { /* best-effort */ }
  const eff = getEffectiveSettings();

  applyAutoLaunch(eff.autoLaunch);
  applySleepBlock(eff.enforceSleepBlock);
  applyShortcutBlock(eff.blockShortcuts);
  applyDailyReboot(eff.dailyRebootTime);
  applyCursorAndRotation(win, eff.hideCursor, eff.rotation);
  applyTargetDisplay(win, eff.targetDisplayIndex);
  await applyProxy(eff.proxyUrl);
  applyAssetCacheGc(eff.assetCacheMaxBytes, eff.logRetentionDays);
}

// ── Individual appliers ─────────────────────────────────────────────────────

function applyAutoLaunch(enabled: boolean): void {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: [],
    });
  } catch (err) {
    console.warn('[settings] autoLaunch failed:', (err as Error).message);
  }
}

function applySleepBlock(enabled: boolean): void {
  if (_powerBlockerTimer) { clearInterval(_powerBlockerTimer); _powerBlockerTimer = null; }
  if (!enabled) {
    if (_powerBlockerId != null && powerSaveBlocker.isStarted(_powerBlockerId)) {
      powerSaveBlocker.stop(_powerBlockerId);
    }
    _powerBlockerId = null;
    return;
  }
  // Watchdog: re-arm every minute if it ever stops (some Windows policies kill it).
  const arm = () => {
    if (_powerBlockerId == null || !powerSaveBlocker.isStarted(_powerBlockerId)) {
      _powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
  };
  arm();
  _powerBlockerTimer = setInterval(arm, 60_000);
}

function applyShortcutBlock(enabled: boolean): void {
  globalShortcut.unregisterAll();
  if (!enabled) return;
  // Swallow common exit/devtools/window keys. Do NOT block Ctrl+Shift+I in dev mode.
  const keys = ['Alt+F4', 'Ctrl+W', 'F11', 'Alt+Tab', 'Alt+Space'];
  for (const k of keys) {
    try { globalShortcut.register(k, () => { /* swallowed */ }); } catch {}
  }
}

function applyDailyReboot(time: string | null): void {
  if (_rebootTimer) { clearInterval(_rebootTimer); _rebootTimer = null; }
  if (!time) return;
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return;

  // Check every 30 s; trigger when local time crosses HH:MM (with 1 min lockout).
  let lastFired = 0;
  _rebootTimer = setInterval(() => {
    const now = new Date();
    if (now.getHours() === hh && now.getMinutes() === mm && Date.now() - lastFired > 90_000) {
      lastFired = Date.now();
      console.info(`[settings] dailyReboot: relaunching (scheduled ${time})`);
      app.relaunch();
      app.exit(0);
    }
  }, 30_000);
}

function applyCursorAndRotation(win: BrowserWindow | null, hideCursor: boolean, rotation: number): void {
  if (!win || win.isDestroyed()) return;
  // Inject CSS into the renderer; both behaviors live there.
  const css = `
    ${hideCursor ? `body { cursor: none !important; }` : ''}
    ${rotation && rotation !== 0
      ? `body { transform: rotate(${rotation}deg); transform-origin: center center; }`
      : ''}
  `;
  // insertCSS returns a key, we don't track removal — just push fresh rules.
  void win.webContents.insertCSS(css);
}

function applyTargetDisplay(win: BrowserWindow | null, index: number | null): void {
  if (!win || win.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  const idx = (index != null && index >= 0 && index < displays.length) ? index : 0;
  const target = displays[idx];
  if (!target) return;
  const b = target.bounds;
  // setBounds first, then re-fullscreen — Electron requires this order on Windows.
  if (win.isFullScreen()) win.setFullScreen(false);
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  win.setFullScreen(true);
}

async function applyProxy(proxyUrl: string | null): Promise<void> {
  try {
    if (!proxyUrl) {
      await session.defaultSession.setProxy({ mode: 'direct' });
    } else {
      await session.defaultSession.setProxy({ proxyRules: proxyUrl });
    }
  } catch (err) {
    console.warn('[settings] setProxy failed:', (err as Error).message);
  }
}

function applyAssetCacheGc(maxBytes: number, logRetentionDays: number): void {
  if (_cacheGcTimer) { clearInterval(_cacheGcTimer); _cacheGcTimer = null; }
  const run = () => {
    try {
      const cacheDir = path.join(app.getPath('userData'), 'asset-cache');
      if (fs.existsSync(cacheDir)) lruEvict(cacheDir, maxBytes);
      const logDir = path.join(app.getPath('userData'), 'logs');
      if (logRetentionDays > 0 && fs.existsSync(logDir)) ageEvict(logDir, logRetentionDays);
    } catch (err) {
      console.warn('[settings] cache GC failed:', (err as Error).message);
    }
  };
  // Run once on boot, then every 6 hours.
  setTimeout(run, 60_000);
  _cacheGcTimer = setInterval(run, 6 * 60 * 60_000);
}

function lruEvict(dir: string, maxBytes: number): void {
  const entries = fs.readdirSync(dir).map((f) => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { p, size: st.size, atime: st.atimeMs };
  });
  let total = entries.reduce((s, e) => s + e.size, 0);
  if (total <= maxBytes) return;
  entries.sort((a, b) => a.atime - b.atime); // oldest first
  for (const e of entries) {
    if (total <= maxBytes) break;
    try { fs.unlinkSync(e.p); total -= e.size; } catch { /* ignore */ }
  }
}

function ageEvict(dir: string, maxAgeDays: number): void {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
}

/** Register globalShortcut.unregisterAll on app quit so dev relaunches work. */
export function registerSettingsLifecycle(): void {
  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch {}
    if (_rebootTimer) clearInterval(_rebootTimer);
    if (_powerBlockerTimer) clearInterval(_powerBlockerTimer);
    if (_cacheGcTimer) clearInterval(_cacheGcTimer);
  });
}
