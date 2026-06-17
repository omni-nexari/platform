/**
 * ws-client.ts — maintains a persistent WebSocket connection to the API.
 *
 * Handles: LOAD_URL, RELOAD, SLEEP, DISPLAY_POWER, SET_VOLUME, SET_MUTE,
 *           SET_BRIGHTNESS, SET_DISPLAY, WAKE_ON_LAN, SCREENSHOT, DUMP_LOGS.
 *
 * Sends heartbeats every 30 s.
 */
import WebSocket, { type RawData } from 'ws';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { getDefaultApiBase, getStore } from './store.js';
import { getSystemInfo, getWifiSsid } from './os-bridge.js';
import os from 'os';

const HEARTBEAT_INTERVAL_MS = 30_000;

let ws: WebSocket | null = null;
let hbTimer: ReturnType<typeof setInterval> | null = null;
let win: BrowserWindow | null = null;

// ── LAN Relay (port 9616) ─────────────────────────────────────────────────
// Full JSON protocol relay compatible with sync.ts (cloud relay protocol).
// Handles: WS_REGISTER→PEERS, PING→PONG(t1/t2), READY barrier→GO(playAt),
//          LOOP_READY barrier→LOOP_GO(playAt), HEARTBEAT_PEERS every 5s,
//          all other messages fanout with `from`.

interface RelayPeer { ws: WebSocket; deviceId: string; groupId: string; registeredAt: number; }

let relayServer: WebSocket.Server | null = null;
let relayPeers: RelayPeer[] = [];
let relayReadySet: Set<WebSocket> = new Set();
let relayLoopReady = new Map<string, Set<string>>();
let relayHbTimer: ReturnType<typeof setInterval> | null = null;

function _relaySendPeers(groupId: string): void {
  const group = relayPeers.filter((p) => p.groupId === groupId);
  const peers = group.map((p) => ({ deviceId: p.deviceId, ip: '', registeredAt: p.registeredAt }));
  const frame = JSON.stringify({ type: 'PEERS', groupId, peers, serverTimeMs: Date.now() });
  group.forEach((p) => { if (p.ws.readyState === WebSocket.OPEN) try { p.ws.send(frame); } catch {} });
}

function startRelayServer(_expectedPeers: number): void {
  if (relayServer) return; // already running
  relayReadySet.clear();
  relayLoopReady.clear();
  relayPeers = [];

  relayServer = new WebSocket.Server({ port: 9616 });

  // Heartbeat: broadcast HEARTBEAT_PEERS to each group every 5 s so sync.ts
  // _waitPeers() sees peer updates even if WS_REGISTER arrives out of order.
  relayHbTimer = setInterval(() => {
    if (!relayServer) return;
    const groups = new Set(relayPeers.map((p) => p.groupId).filter(Boolean));
    for (const gid of groups) {
      const ids = relayPeers.filter((p) => p.groupId === gid).map((p) => p.deviceId);
      const frame = JSON.stringify({ type: 'HEARTBEAT_PEERS', peers: ids });
      relayPeers.filter((p) => p.groupId === gid).forEach((p) => {
        if (p.ws.readyState === WebSocket.OPEN) try { p.ws.send(frame); } catch {}
      });
    }
  }, 5000);

  relayServer.on('close', () => {
    if (relayHbTimer) { clearInterval(relayHbTimer); relayHbTimer = null; }
  });

  relayServer.on('connection', (client: WebSocket) => {
    const peer: RelayPeer = { ws: client, deviceId: '', groupId: '', registeredAt: 0 };
    relayPeers.push(peer);

    client.on('message', (data: RawData) => {
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const type: string = msg?.type ?? '';

      if (type === 'PING') {
        client.send(JSON.stringify({ type: 'PONG', t1: msg.t1, t2: Date.now() }));
        return;
      }
      if (type === 'WS_REGISTER') {
        peer.deviceId    = String(msg.deviceId || `anon-${Date.now()}`);
        peer.groupId     = String(msg.groupId  || 'default');
        peer.registeredAt = Date.now();
        _relaySendPeers(peer.groupId);
        return;
      }
      if (type === 'READY') {
        relayReadySet.add(client);
        const groupPeers = relayPeers.filter((p) => p.groupId === peer.groupId && p.ws.readyState === WebSocket.OPEN);
        if (relayReadySet.size >= Math.max(1, groupPeers.length)) {
          const playAt = Date.now() + 400;
          const go = JSON.stringify({ type: 'GO', playAt });
          groupPeers.forEach((p) => { try { p.ws.send(go); } catch {} });
          relayReadySet.clear();
        }
        return;
      }
      if (type === 'LOOP_READY') {
        const gid = String(msg.groupId || peer.groupId);
        let set = relayLoopReady.get(gid);
        if (!set) { set = new Set(); relayLoopReady.set(gid, set); }
        set.add(String(msg.deviceId || peer.deviceId));
        const groupPeers = relayPeers.filter((p) => p.groupId === gid && p.ws.readyState === WebSocket.OPEN);
        if (groupPeers.length >= 2 && set.size >= groupPeers.length) {
          relayLoopReady.set(gid, new Set());
          const playAt = Date.now() + 400;
          const loopGo = JSON.stringify({ type: 'LOOP_GO', playAt });
          groupPeers.forEach((p) => { try { p.ws.send(loopGo); } catch {} });
        }
        return;
      }
      // All other messages (LOAD_URL, PLAYHEAD, etc.): fanout to group with `from`.
      const out = JSON.stringify({ ...msg, from: peer.deviceId || 'relay' });
      relayPeers.filter((p) => p.ws !== client && p.groupId === peer.groupId)
        .forEach((p) => { if (p.ws.readyState === WebSocket.OPEN) try { p.ws.send(out); } catch {} });
    });

    client.on('close', () => {
      relayReadySet.delete(client);
      const idx = relayPeers.indexOf(peer);
      if (idx >= 0) relayPeers.splice(idx, 1);
      if (peer.groupId) _relaySendPeers(peer.groupId);
    });
  });
  console.info('[ws-client] LAN relay server started on port 9616');
}

function stopRelayServer(): void {
  if (!relayServer) return;
  if (relayHbTimer) { clearInterval(relayHbTimer); relayHbTimer = null; }
  relayServer.close();
  relayServer = null;
  relayPeers = [];
  relayReadySet.clear();
  relayLoopReady.clear();
  console.info('[ws-client] LAN relay server stopped');
}

/** Send any message over the device WS (callable from IPC handlers). */
export function wsSend(payload: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

let _logIpcRegistered = false;

export function connectWs(playerWindow: BrowserWindow) {
  win = playerWindow;

  // Register the log relay IPC handler exactly once (connectWs may be called
  // multiple times — on startup if already paired, and again after pairing).
  if (!_logIpcRegistered) {
    _logIpcRegistered = true;
    ipcMain.on('ws:device_log', (_evt, level: string, lines: string[]) => {
      wsSend({ type: 'device_log', payload: { level, lines } });
    });
  }

  connect();
}

function connect() {
  const store = getStore();
  const apiBase = store.get('apiBase') || getDefaultApiBase();
  const token   = store.get('deviceToken');
  if (!token) return;

  const wsBase = apiBase.replace(/^http/, 'ws');
  const url    = `${wsBase}/devices/ws/device?token=${encodeURIComponent(token)}`;

  ws = new WebSocket(url);

  ws.on('open', () => {
    scheduleHeartbeat();
    // Delay first heartbeat by 2 s so the player window is fully shown
    // and Electron's screen API returns real bounds instead of 0×0.
    setTimeout(() => { sendHeartbeat(); sendNetworkInfo(); }, 2_000);
  });

  ws.on('message', (raw: RawData) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handleCommand(msg);
  });

  ws.on('close', () => {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    // Reconnect with exponential backoff (capped at 30 s)
    setTimeout(connect, Math.min(30_000, 2_000 + Math.random() * 3_000));
  });

  ws.on('error', (err: Error) => {
    console.error('[ws-client] error:', err.message);
    ws?.terminate();
  });
}

function scheduleHeartbeat() {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

async function sendHeartbeat() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const info = await getSystemInfo();
    const displays = screen.getAllDisplays();
    const primary  = screen.getPrimaryDisplay();
    // Use physical pixels (logical × scaleFactor) to match what Tizen reports.
    // Fall back to workArea if bounds are zero (early boot race condition).
    const b = (primary.bounds.width > 0) ? primary.bounds : primary.workArea;
    const physW = Math.round(b.width  * primary.scaleFactor);
    const physH = Math.round(b.height * primary.scaleFactor);
    const res   = (physW > 0 && physH > 0) ? `${physW}x${physH}` : null;
    console.log(`[ws-client] heartbeat: res=${res} mac=${info.macAddress} machineGuid=${info.machineGuid?.slice(0,8)}…`);
    // Only include fields when non-null. The shared HeartbeatSchema marks most
    // fields as `.optional()` (not `.nullable()`), so sending `null` would fail
    // Zod validation and silently drop the entire heartbeat on the API side.
    const payload: Record<string, unknown> = {
      playerVersion: app.getVersion(),
      platform: 'windows',
      powerState: 'on',
      timezone: info.timezone,
      deviceUptimeSec: Math.round(os.uptime()),
      memoryFreeBytes: os.freemem(),
      memoryTotalBytes: os.totalmem(),
      displayCount: displays.length,
      primaryDisplayIndex: displays.findIndex((d) => d.id === primary.id),
    };
    if (res != null)                     payload.resolution         = res;
    if (info.cpuLoad != null)            payload.cpuLoad            = info.cpuLoad;
    if (info.storageFreeBytes != null)   payload.storageFreeBytes   = info.storageFreeBytes;
    if (info.temperatureC != null)       payload.temperatureCelsius = info.temperatureC;
    if (info.systemVolume != null)       payload.systemVolume       = info.systemVolume;
    if (info.systemMuted != null)        payload.systemMuted        = info.systemMuted;
    if (info.windowsBuild != null)       payload.windowsBuild       = info.windowsBuild;
    ws.send(JSON.stringify({ type: 'heartbeat', payload }));
  } catch (err: any) {
    console.error('[ws-client] sendHeartbeat failed:', err?.message ?? err);
  }
}

function detectConnectionType(ifaceName: string): 'wifi' | 'ethernet' {
  const n = ifaceName.toLowerCase();
  if (n.includes('wi-fi') || n.includes('wifi') || n.includes('wlan') || n.includes('wireless')) return 'wifi';
  return 'ethernet';
}

async function sendNetworkInfo() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const ifaces = os.networkInterfaces();
  let ip: string | null = null;
  let mac: string | null = null;
  let connectionType: 'wifi' | 'ethernet' = 'ethernet';

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const iface of addrs ?? []) {
      if (!iface.internal && iface.family === 'IPv4') {
        // Accept any non-loopback IPv4 — don't filter by adapter name because
        // Hyper-V bridges the physical NIC through a vEthernet adapter that
        // carries the real IP and MAC.
        const validMac = (iface.mac && iface.mac !== '00:00:00:00:00:00') ? iface.mac : null;
        if (!ip) {
          ip = iface.address;
          mac = validMac;
          connectionType = detectConnectionType(name);
        } else if (!mac && validMac) {
          mac = validMac; // found a real MAC for an already-selected IP
        }
      }
    }
  }
  const ssid = await getWifiSsid();
  ws.send(JSON.stringify({
    type: 'network_info',
    payload: {
      ip: ip ?? undefined,
      mac: mac ?? undefined,
      connectionType,
      ...(ssid != null ? { wifiSsid: ssid } : {}),
    },
  }));
}

async function handleCommand(msg: any) {
  const type: string = msg?.type ?? msg?.command ?? '';
  switch (type) {
    case 'LOAD_URL':
      win?.webContents.send('CMD_LOAD_URL', { url: msg.url });
      break;

    case 'RELOAD':
      win?.webContents.reload();
      break;

    case 'SLEEP':
    case 'sleep':
      win?.webContents.send('CMD_SLEEP');
      break;

    case 'display_power':
      win?.webContents.send('CMD_DISPLAY_POWER', { on: !!msg.on });
      break;

    case 'set_system_volume': {
      const { setVolume } = await import('./os-bridge.js');
      await setVolume(Number(msg.payload?.level ?? msg.level ?? 50));
      break;
    }

    case 'set_system_mute': {
      const { setMute } = await import('./os-bridge.js');
      await setMute(!!(msg.payload?.mute ?? msg.mute));
      break;
    }

    case 'set_brightness': {
      const { setBrightness } = await import('./os-bridge.js');
      await setBrightness(Number(msg.payload?.level ?? msg.level ?? 100), msg.payload?.displayIndex ?? msg.displayIndex);
      break;
    }

    case 'set_display':
      win?.webContents.send('CMD_SET_DISPLAY', { displayIndex: msg.payload?.displayIndex ?? msg.displayIndex ?? 0 });
      break;

    case 'wake_on_lan': {
      const { sendWol } = await import('./os-bridge.js');
      await sendWol(msg.payload?.targetMac ?? msg.targetMac, msg.payload?.broadcastIp ?? msg.broadcastIp);
      break;
    }

    case 'set_windows_settings': {
      const { applySettings } = await import('./windows-settings.js');
      const settings = msg.payload?.settings ?? msg.settings ?? {};
      await applySettings(settings, win);
      console.info('[ws-client] applied windows settings:', Object.keys(settings).join(','));
      break;
    }

    case 'screenshot': {
      const img = await win?.webContents.capturePage();
      if (!img) break;
      const dataBase64 = img.toJPEG(85).toString('base64');
      wsSend({
        type: 'screenshot_data',
        payload: { dataBase64, trigger: 'manual', contentId: null },
      });
      break;
    }

    case 'screenshot_auto': {
      const img = await win?.webContents.capturePage();
      if (!img) break;
      const dataBase64 = img.toJPEG(85).toString('base64');
      wsSend({
        type: 'screenshot_data',
        payload: { dataBase64, trigger: 'content_change', contentId: null },
      });
      break;
    }

    case 'dump_logs':
      // Ask renderer to flush its in-memory ring buffer
      win?.webContents.send('CMD_DUMP_LOGS');
      break;

    case 'refresh_schedule':
    case 'content-update':
    case 'content.published':
    case 'emergency_start':
    case 'emergency_clear':
      win?.webContents.send('WS_MESSAGE', msg);
      break;

    case 'SYNC_GROUP_INIT':
    case 'VIDEOWALL_INIT': {
      // If this device is the elected leader and relay mode is LAN, start the
      // relay server so followers can connect to port 9616.
      const store2 = getStore();
      const myDeviceId = store2.get('deviceId') as string | undefined;
      const isLeader = Array.isArray(msg.leaderPriority) && msg.leaderPriority[0] === myDeviceId;
      if (isLeader && (msg.syncRelayMode ?? 'lan') === 'lan') {
        const expectedPeers = Array.isArray(msg.peers) ? msg.peers.length : 1;
        startRelayServer(expectedPeers);
      } else {
        // Not leader — stop any previous relay we may have been running.
        stopRelayServer();
      }
      win?.webContents.send('WS_MESSAGE', msg);
      break;
    }

    default:
      // Forward all other messages (sync relay etc.) to renderer
      win?.webContents.send('WS_MESSAGE', msg);
  }
}
