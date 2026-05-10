/**
 * preload.ts — context bridge between renderer and main process.
 * Exposes a minimal, typed API surface on window.nexari.
 */
import { contextBridge, ipcRenderer } from 'electron';

export type NexariApi = typeof api;

const api = {
  // ── Pairing ─────────────────────────────────────────────────────────────
  paired: (data: { token: string; deviceId: string; apiBase: string }) =>
    ipcRenderer.send('PAIRED', data),

  // ── Config ──────────────────────────────────────────────────────────────
  getDefaultApiBase: (): Promise<string> => ipcRenderer.invoke('app:getDefaultApiBase'),
  getConfig: (): Promise<{ apiBase: string; deviceToken: string; deviceId: string }> =>
    ipcRenderer.invoke('app:getConfig'),

  // ── Asset cache ──────────────────────────────────────────────────────────
  /** Download a content URL to local disk cache and return the local file path. */
  downloadAsset: (url: string): Promise<string> => ipcRenderer.invoke('asset:download', url),

  // ── OS bridges ─────────────────────────────────────────────────────────
  getSystemInfo: () => ipcRenderer.invoke('os:getSystemInfo'),
  setVolume:     (level: number) => ipcRenderer.invoke('os:setVolume', level),
  setMute:       (mute: boolean) => ipcRenderer.invoke('os:setMute', mute),
  setBrightness: (level: number, idx?: number) => ipcRenderer.invoke('os:setBrightness', level, idx),
  sendWol:       (mac: string, broadcastIp?: string) => ipcRenderer.invoke('os:sendWol', mac, broadcastIp),

  // ── Incoming messages from main process ─────────────────────────────────
  onMessage: (channel: string, cb: (data: unknown) => void) => {
    const allowed = [
      'CMD_LOAD_URL', 'CMD_SLEEP', 'CMD_DISPLAY_POWER',
      'CMD_SET_DISPLAY', 'CMD_DUMP_LOGS', 'WS_MESSAGE',
      'UPDATE_AVAILABLE', 'UPDATE_PROGRESS', 'UPDATE_DOWNLOADED',
    ];
    if (!allowed.includes(channel)) return;
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // ── Remote logging ────────────────────────────────────────────────────────
  /** Send a batch of console log lines to the API via the device WebSocket. */
  sendDeviceLog: (level: 'debug' | 'info' | 'warn' | 'error', lines: string[]) =>
    ipcRenderer.send('ws:device_log', level, lines),
};

contextBridge.exposeInMainWorld('nexari', api);
