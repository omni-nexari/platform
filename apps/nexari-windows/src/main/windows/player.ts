import { BrowserWindow } from 'electron';
import path from 'path';

const iconPath = path.resolve(__dirname, '../../../build/icon.ico');

export function createPlayerWindow(isDev: boolean): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Always load from pre-built dist/renderer/ — no Vite dev server required.
  void win.loadFile(path.resolve(__dirname, '../../renderer/index.html'));

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.once('ready-to-show', () => win.show());
  return win;
}

export function createPairingWindow(isDev: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 680,
    center: true,
    resizable: false,
    title: 'Nexari Player — Pairing',
    backgroundColor: '#0f172a',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  void win.loadFile(path.resolve(__dirname, '../../renderer/pairing.html'));

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.once('ready-to-show', () => win.show());
  return win;
}
