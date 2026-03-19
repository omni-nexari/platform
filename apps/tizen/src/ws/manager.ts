import { getApiBase } from '../store.js';
import { getDeviceId, getDeviceToken } from '../store.js';
import { state } from '../state.js';
import { handleServerCommand } from './handlers.js';

let socket: WebSocket | null = null;
let reconnectDelay = 2000;
const MAX_DELAY = 60_000;

export function connect(): void {
  const token = getDeviceToken();
  if (!token) return;
  const base = getApiBase().replace(/^http/, 'ws');
  socket = new WebSocket(`${base}/devices/ws/device?token=${encodeURIComponent(token)}`);

  socket.addEventListener('open', () => {
    state.wsConnected = true;
    reconnectDelay = 2000;
    console.log('[ws] connected');
  });

  socket.addEventListener('message', (ev) => {
    try {
      const cmd = JSON.parse(ev.data as string) as { type: string; payload?: unknown };
      handleServerCommand(cmd);
    } catch { /* ignore malformed */ }
  });

  socket.addEventListener('close', () => {
    state.wsConnected = false;
    socket = null;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });
}

export function send(msg: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function disconnect(): void {
  socket?.close();
}
