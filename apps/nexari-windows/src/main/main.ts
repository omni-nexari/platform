/**
 * main.ts — Electron main process.
 *
 * Lifecycle:
 *   1. Load persisted config (ElectronStore).
 *   2. If not yet paired → open pairing window.
 *   3. Once paired → open fullscreen player window.
 *   4. Connect WS to API; handle all DeviceCommand types via IPC bridge.
 *   5. Set up auto-updater; report download progress to renderer.
 */
import { app, BrowserWindow, ipcMain, net, powerSaveBlocker, shell, session } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { autoUpdater } from 'electron-updater';
import { getStore } from './store.js';
import { createPlayerWindow } from './windows/player.js';
import { createPairingWindow } from './windows/pairing.js';
import { connectWs } from './ws-client.js';
import { registerOsBridges } from './os-bridge.js';
import { applySettings, getEffectiveSettings, loadSettingsForBoot, registerSettingsLifecycle } from './windows-settings.js';

const isDev = !!process.env.NEXARI_DEV;

// ── Pre-ready boot-time settings (must run before app.on('ready')) ──────────
// Read persisted settings synchronously from disk so flags like
// hardware-acceleration / remote DevTools port can be wired in before
// Electron's GPU + browser stack initialize.
try {
  const boot = loadSettingsForBoot();
  if (!boot.hardwareAcceleration) {
    app.disableHardwareAcceleration();
  }
  if (boot.remoteDevToolsPort && boot.remoteDevToolsPort > 0) {
    app.commandLine.appendSwitch('remote-debugging-port', String(boot.remoteDevToolsPort));
  }
} catch { /* first run — store missing */ }

let playerWin: BrowserWindow | null = null;
let pairingWin: BrowserWindow | null = null;

app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling');
// Suppress DevTools Autofill protocol noise (not supported in this Electron build)
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');

app.on('ready', async () => {
  // Set AppUserModelID so Windows associates the taskbar icon with our shortcut
  // (and does not fall back to the default electron.exe icon during dev).
  if (process.platform === 'win32') {
    try { app.setAppUserModelId('app.chiho.nexari-windows'); } catch { /* ignore */ }
  }
  registerOsBridges();
  registerSettingsLifecycle();

  // Apply persisted Windows player settings (idempotent — safe to call before
  // a player window exists; rotation/cursor/display will re-apply once it does).
  await applySettings({}, null);

  // Keep display awake — we are a signage player
  powerSaveBlocker.start('prevent-display-sleep');

  const store = getStore();
  const deviceToken = store.get('deviceToken');

  if (!deviceToken) {
    pairingWin = createPairingWindow(isDev);
    pairingWin.on('closed', () => { pairingWin = null; });
  } else {
    playerWin = createPlayerWindow(isDev);
    playerWin.on('closed', () => { playerWin = null; });
    // Re-apply window-bound settings (cursor / rotation / target display).
    playerWin.webContents.once('did-finish-load', () => {
      void applySettings({}, playerWin);
    });
    connectWs(playerWin);
    setupUpdater(playerWin);
  }

  // Pairing complete: renderer posts PAIRED — switch windows.
  // Use ipcMain.on (not once) so re-pairing after unpair also works.
  ipcMain.on('PAIRED', (_evt, data: { token: string; deviceId: string; apiBase: string }) => {
    const store2 = getStore();
    store2.set('deviceToken', data.token);
    store2.set('deviceId', data.deviceId);
    store2.set('apiBase', data.apiBase);

    pairingWin?.close();
    pairingWin = null;
    playerWin = createPlayerWindow(isDev);
    playerWin.on('closed', () => { playerWin = null; });
    playerWin.webContents.once('did-finish-load', () => {
      void applySettings({}, playerWin);
    });
    connectWs(playerWin);
    setupUpdater(playerWin);
  });

  // Device deleted from server — clear credentials and show pairing screen
  ipcMain.handle('app:unpair', () => {
    const s = getStore();
    s.set('deviceToken', '');
    s.set('deviceId', '');
    playerWin?.close();
    playerWin = null;
    pairingWin = createPairingWindow(isDev);
    pairingWin.on('closed', () => { pairingWin = null; });
  });

  // Expose full config to renderer (player bootstrap)
  ipcMain.handle('app:getConfig', () => {
    const s = getStore();
    const defaultApiBase = process.env.NEXARI_DEV === '1'
      ? 'http://192.168.1.17/api/v1'
      : 'https://ds.chiho.app/api/v1';
    return {
      apiBase:     s.get('apiBase') || defaultApiBase,
      deviceToken: s.get('deviceToken') || '',
      deviceId:    s.get('deviceId')    || '',
      appVersion:  app.getVersion(),
    };
  });

  // ── Asset pre-download cache ──────────────────────────────────────────────
  // Renderer calls this for IMAGE, VIDEO, PDF, OFFICE so content plays from
  // local disk rather than streaming over the network each time.
  const _dlInflight = new Map<string, Promise<string>>();
  ipcMain.handle('asset:download', (_evt, url: string): Promise<string> => {
    const existing = _dlInflight.get(url);
    if (existing) return existing;

    const task = (async (): Promise<string> => {
      const cacheDir = path.join(app.getPath('userData'), 'asset-cache');
      fs.mkdirSync(cacheDir, { recursive: true });

      const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
      const ext  = (url.split('?')[0].match(/\.[a-zA-Z0-9]{2,5}$/) || [''])[0].toLowerCase();
      const filePath = path.join(cacheDir, hash + ext);

      // Return cached file if it already exists with content
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        return filePath;
      }

      // Stream download via Electron net (handles auth, proxy, redirects)
      const resp = await net.fetch(url);
      if (!resp.ok) throw new Error(`asset:download HTTP ${resp.status} ${url}`);

      const tmp = filePath + '.tmp';
      const ws  = fs.createWriteStream(tmp);
      const reader = resp.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await new Promise<void>((res, rej) => ws.write(value, (e: unknown) => (e ? rej(e) : res())));
        }
        await new Promise<void>((res) => ws.end(res));
        fs.renameSync(tmp, filePath);
        return filePath;
      } catch (e) {
        ws.destroy();
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      } finally {
        _dlInflight.delete(url);
      }
    })();

    _dlInflight.set(url, task);
    return task;
  });

  // Expose default API base URL to renderer (pairing form)
  ipcMain.handle('app:getDefaultApiBase', () =>
    process.env.NEXARI_DEV === '1'
      ? 'http://192.168.1.17/api/v1'
      : 'https://ds.chiho.app/api/v1'
  );

  // Allow renderer to trigger an update check manually (from settings overlay)
  ipcMain.handle('app:checkForUpdates', () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });

  // Set Content-Security-Policy on all renderer responses.
  // Locked-down policy:
  //   - script-src removes 'unsafe-inline'; Vite bundles all scripts.
  //   - connect-src is restricted to the configured apiBase host + ws/wss
  //     variants; localhost is included for dev/HMR.
  //   - frame-src remains permissive because user content may include
  //     arbitrary iframes (HTML5 ads, calendars, dashboards).
  const apiBase = (getStore().get('apiBase') as string | undefined)
    || (process.env.NEXARI_DEV === '1' ? 'http://192.168.1.17/api/v1' : 'https://ds.chiho.app/api/v1');
  const connectSrcHosts = new Set<string>(['ws://localhost:*', 'http://localhost:*', 'https://localhost:*']);
  try {
    const u = new URL(apiBase);
    const isHttps = u.protocol === 'https:';
    const httpOrigin = `${u.protocol}//${u.host}`;
    const wsScheme = isHttps ? 'wss:' : 'ws:';
    const wsOrigin = `${wsScheme}//${u.host}`;
    connectSrcHosts.add(httpOrigin);
    connectSrcHosts.add(wsOrigin);
  } catch { /* ignore — apiBase malformed */ }
  // Always permit production hosts so a re-pair after CSP install still works.
  connectSrcHosts.add('https://ds.chiho.app');
  connectSrcHosts.add('wss://ds.chiho.app');
  const connectSrc = ["'self'", ...Array.from(connectSrcHosts)].join(' ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self' file: blob: data:",
            "script-src 'self' file: blob:",
            "style-src 'self' 'unsafe-inline'",
            "img-src * data: blob:",
            "media-src * blob: data:",
            `connect-src ${connectSrc}`,
            "frame-src * blob: file:",
            "worker-src blob: 'self' file:",
            "font-src * data:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        ],
      },
    });
  });

  // Allow opening external links in system browser
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function setupUpdater(win: BrowserWindow) {
  if (isDev) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('UPDATE_AVAILABLE', { version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    win.webContents.send('UPDATE_PROGRESS', { percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('UPDATE_DOWNLOADED');
  });

  // Check immediately, then every hour
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 3_600_000);
}
