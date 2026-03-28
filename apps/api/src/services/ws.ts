import { db, devices, deviceHeartbeats, deviceScreenshots, playEvents } from '@signage/db';
import { eq } from 'drizzle-orm';
import { DeviceMessageSchema } from '@signage/shared';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string | Buffer): void;
  readonly readyState: number; // 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED
}

export interface DeviceConsoleLogEntry {
  id: string;
  deviceId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  line: string;
  createdAt: string;
}

export interface MdcStatusResponse {
  requestId: string;
  ok: boolean;
  nodeRunning?: boolean;
  serial?: string;
  rawHex?: string;
  error?: string;
  status?: {
    displayId: number;
    ack: 'A' | 'N';
    rCmd: number;
    power?: number;
    volume?: number;
    mute?: number;
    input?: number;
    aspect?: number;
    nTime?: number;
    fTime?: number;
  };
}

export type WsCommand =
  | { type: 'reboot' }
  | { type: 'screenshot' }
  | { type: 'refresh_schedule' }
  | { type: 'emergency_start'; payload: { text?: string; contentItemId?: string } }
  | { type: 'emergency_clear' }
  | { type: 'power_off' }
  | { type: 'set_ntp'; payload: { server: string; timezone: string } }
  | { type: 'set_ir_lock'; payload: { lock: boolean } }
  | { type: 'set_button_lock'; payload: { lock: boolean } }
  | { type: 'set_on_timer'; payload: { slot: number; time: string } }
  | { type: 'set_off_timer'; payload: { slot: number; time: string } }
  | { type: 'clear_on_timer'; payload: { slot: number } }
  | { type: 'clear_off_timer'; payload: { slot: number } }
  | { type: 'update_tv_firmware' }
  | { type: 'update_player'; payload: { version: string; downloadUrl: string } }
  | { type: 'clear_cache' }
  | { type: 'dump_logs' }
  | { type: 'set_screenshot_interval'; payload: { minutes: number } }
  | { type: 'start_live_capture'; payload: { intervalMs: number } }
  | { type: 'stop_live_capture' }
  | { type: 'set_zones'; payload: { zones: Array<{ id: string; rect: { x: number; y: number; width: number; height: number }; playlistId?: string }> } }
  | { type: 'remote_key'; payload: { key: string } }
  | { type: 'remote_status'; payload: { requestId: string } }
  | { type: 'SESSION_CONFIG'; groupId: number; mode: string; syncPlaylistId: string | null }
  | { type: 'SYNC_PLAY'; action: 'STOP' | 'CANCEL' | 'START_SYNCPLAY' };

const connections = new Map<string, Conn>();
const deviceLogs = new Map<string, DeviceConsoleLogEntry[]>();
const MAX_DEVICE_LOGS = 2000;
const pendingMdcStatus = new Map<string, {
  resolve: (value: MdcStatusResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ── Live-view SSE relay ────────────────────────────────────────────────────
type LiveFrame = (dataBase64: string) => void;
const liveViewers = new Map<string, Set<LiveFrame>>();

export function registerLiveViewer(deviceId: string, cb: LiveFrame): void {
  if (!liveViewers.has(deviceId)) liveViewers.set(deviceId, new Set());
  liveViewers.get(deviceId)!.add(cb);
}

export function unregisterLiveViewer(deviceId: string, cb: LiveFrame): void {
  liveViewers.get(deviceId)?.delete(cb);
  if (liveViewers.get(deviceId)?.size === 0) liveViewers.delete(deviceId);
}

export function hasLiveViewers(deviceId: string): boolean {
  return (liveViewers.get(deviceId)?.size ?? 0) > 0;
}

function appendDeviceLogs(deviceId: string, level: DeviceConsoleLogEntry['level'], lines: string[]): void {
  if (lines.length === 0) return;

  const existing = deviceLogs.get(deviceId) ?? [];
  const next = existing.concat(
    lines
      .filter((line) => typeof line === 'string' && line.trim().length > 0)
      .map((line) => ({
        id: randomUUID(),
        deviceId,
        level,
        line,
        createdAt: new Date().toISOString(),
      })),
  );

  deviceLogs.set(deviceId, next.slice(-MAX_DEVICE_LOGS));
}

export function getDeviceLogs(deviceId: string, limit = 500): DeviceConsoleLogEntry[] {
  const logs = deviceLogs.get(deviceId) ?? [];
  return logs.slice(-Math.max(1, Math.min(limit, MAX_DEVICE_LOGS)));
}

export function clearDeviceLogs(deviceId: string): void {
  deviceLogs.delete(deviceId);
}

export function registerDevice(deviceId: string, socket: Conn): void {
  connections.set(deviceId, socket);
}

export function unregisterDevice(deviceId: string): void {
  connections.delete(deviceId);
}

export function isDeviceOnline(deviceId: string): boolean {
  const conn = connections.get(deviceId);
  return !!conn && conn.readyState === 1;
}

export function getOnlineDeviceIds(): string[] {
  return [...connections.entries()]
    .filter(([, c]) => c.readyState === 1)
    .map(([id]) => id);
}

export function sendCommand(deviceId: string, command: WsCommand): boolean {
  const conn = connections.get(deviceId);
  if (!conn || conn.readyState !== 1) return false;
  conn.send(JSON.stringify(command));
  return true;
}

export function broadcastToDevices(deviceIds: string[], command: WsCommand): void {
  for (const id of deviceIds) sendCommand(id, command);
}

function getPendingMdcStatusKey(deviceId: string, requestId: string): string {
  return `${deviceId}:${requestId}`;
}

export function requestRemoteStatus(deviceId: string, timeoutMs = 5000): Promise<MdcStatusResponse> {
  const requestId = randomUUID();
  const pendingKey = getPendingMdcStatusKey(deviceId, requestId);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMdcStatus.delete(pendingKey);
      reject(new Error('Timed out waiting for MDC status response from device'));
    }, timeoutMs);

    pendingMdcStatus.set(pendingKey, { resolve, reject, timer });

    const delivered = sendCommand(deviceId, { type: 'remote_status', payload: { requestId } });
    if (!delivered) {
      clearTimeout(timer);
      pendingMdcStatus.delete(pendingKey);
      reject(new Error('Device is offline or not connected via WebSocket'));
    }
  });
}

// ── Storage root for screenshots ──────────────────────────────────────────────
const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? join(process.cwd(), 'signage_uploads');

export async function handleDeviceMessage(deviceId: string, data: string): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return;
  }

  const parsed = DeviceMessageSchema.safeParse(raw);
  if (!parsed.success) {
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'type' in raw &&
      (raw as { type?: unknown }).type === 'screenshot_data'
    ) {
      console.warn('[ws] screenshot_data parse failed', parsed.error.issues);
    }
    return;
  }
  const msg = parsed.data;

  // ── heartbeat ──────────────────────────────────────────────────────────────
  if (msg.type === 'heartbeat') {
    const hb = 'readiness' in msg.payload
      ? {
          clockDriftMs: msg.payload.readiness.driftMs,
          currentContentId: msg.payload.readiness.currentContentId,
          nextContentId: msg.payload.readiness.nextContentId,
          nextStartsAt: msg.payload.readiness.nextStartsAt,
        }
      : msg.payload;
    await db
      .update(devices)
      .set({
        status: 'online',
        lastSeen: new Date(),
        ...(hb.playerVersion != null ? { playerVersion: hb.playerVersion } : {}),
        ...(hb.firmwareVersion != null ? { firmwareVersion: hb.firmwareVersion } : {}),
        ...(hb.timezone != null ? { timezone: hb.timezone } : {}),
        ...(hb.resolution != null ? { resolution: hb.resolution } : {}),
        ...(hb.powerState != null ? { powerState: hb.powerState } : {}),
        ...(hb.clockDriftMs != null ? { clockDriftMs: hb.clockDriftMs } : {}),
        ...(hb.irLock != null ? { irLock: hb.irLock } : {}),
        ...(hb.buttonLock != null ? { buttonLock: hb.buttonLock } : {}),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));

    await db.insert(deviceHeartbeats).values({
      deviceId,
      playerVersion: hb.playerVersion,
      firmwareVersion: hb.firmwareVersion,
      powerState: hb.powerState,
      clockDriftMs: hb.clockDriftMs,
      irLock: hb.irLock,
      buttonLock: hb.buttonLock,
      cpuLoad: hb.cpuLoad,
      storageFreeBytes: hb.storageFreeBytes,
      temperatureC: hb.temperatureCelsius,
      currentContentId: hb.currentContentId ?? null,
      nextContentId: hb.nextContentId ?? null,
      nextStartsAt: hb.nextStartsAt ? new Date(hb.nextStartsAt) : null,
    });
    return;
  }

  // ── network_info ───────────────────────────────────────────────────────────
  if (msg.type === 'network_info') {
    const ni = msg.payload;
    await db
      .update(devices)
      .set({
        ...(ni.ip ? { ipAddress: ni.ip } : {}),
        ...(ni.mac ? { macAddress: ni.mac } : {}),
        ...(ni.connectionType ? { connectionType: ni.connectionType } : {}),
        ...(ni.wifiSsid !== undefined ? { wifiSsid: ni.wifiSsid ?? null } : {}),
        ...(ni.wifiStrength !== undefined ? { wifiStrength: ni.wifiStrength ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));
    return;
  }

  // ── system_state ───────────────────────────────────────────────────────────
  if (msg.type === 'system_state') {
    const ss = msg.payload;
    await db
      .update(devices)
      .set({
        irLock: ss.irLock,
        buttonLock: ss.buttonLock,
        autoPowerOn: ss.autoPowerOn,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));
    return;
  }

  // ── screenshot_data ────────────────────────────────────────────────────────
  if (msg.type === 'screenshot_data') {
    const { dataBase64, contentId, trigger } = msg.payload;

    // Live-view frames are relayed directly to SSE listeners, never persisted
    if (trigger === 'live') {
      const viewers = liveViewers.get(deviceId);
      if (viewers) {
        console.info('[ws] relaying live frame', { deviceId, viewers: viewers.size, bytes: dataBase64.length });
        for (const cb of viewers) cb(dataBase64);
      }
      return;
    }

    const buf = Buffer.from(dataBase64, 'base64');
    const fileName = `${randomUUID()}.jpg`;
    const storageKey = `${deviceId}/${fileName}`;
    await writeFile(join(STORAGE_ROOT, deviceId, fileName), buf).catch(() => {
      // best-effort — directory may not exist yet
    });
    // ensure directory
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(STORAGE_ROOT, deviceId), { recursive: true });
    await writeFile(join(STORAGE_ROOT, deviceId, fileName), buf);
    await db.insert(deviceScreenshots).values({
      deviceId,
      storageKey,
      contentId: contentId ?? null,
      trigger: trigger ?? null,
    });
    return;
  }

  // ── play_log ───────────────────────────────────────────────────────────────
  if (msg.type === 'play_log') {
    const { entries } = msg.payload;
    if (entries.length === 0) return;
    await db.insert(playEvents).values(
      entries.map((e) => ({
        deviceId,
        contentId: e.contentId ?? null,
        playlistId: e.playlistId ?? null,
        scheduleId: e.scheduleId ?? null,
        zoneId: e.zoneId ?? null,
        startedAt: new Date(e.startedAt),
        endedAt: new Date(e.endedAt),
        durationMs: e.durationMs,
        completedFull: e.completedFull,
        source: e.source,
      })),
    );
    return;
  }

  // ── device_log ─────────────────────────────────────────────────────────────
  if (msg.type === 'device_log') {
    appendDeviceLogs(deviceId, msg.payload.level, msg.payload.lines);
    return;
  }

  // ── mdc_status ───────────────────────────────────────────────────────────
  if (msg.type === 'mdc_status') {
    const pendingKey = getPendingMdcStatusKey(deviceId, msg.payload.requestId);
    const pending = pendingMdcStatus.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      pendingMdcStatus.delete(pendingKey);

      const normalizedStatus = msg.payload.status
        ? {
          displayId: msg.payload.status.displayId,
          ack: msg.payload.status.ack,
          rCmd: msg.payload.status.rCmd,
          ...(msg.payload.status.power !== undefined ? { power: msg.payload.status.power } : {}),
          ...(msg.payload.status.volume !== undefined ? { volume: msg.payload.status.volume } : {}),
          ...(msg.payload.status.mute !== undefined ? { mute: msg.payload.status.mute } : {}),
          ...(msg.payload.status.input !== undefined ? { input: msg.payload.status.input } : {}),
          ...(msg.payload.status.aspect !== undefined ? { aspect: msg.payload.status.aspect } : {}),
          ...(msg.payload.status.nTime !== undefined ? { nTime: msg.payload.status.nTime } : {}),
          ...(msg.payload.status.fTime !== undefined ? { fTime: msg.payload.status.fTime } : {}),
        }
        : undefined;

      pending.resolve({
        requestId: msg.payload.requestId,
        ok: msg.payload.ok,
        ...(msg.payload.nodeRunning !== undefined ? { nodeRunning: msg.payload.nodeRunning } : {}),
        ...(msg.payload.serial !== undefined ? { serial: msg.payload.serial } : {}),
        ...(msg.payload.rawHex !== undefined ? { rawHex: msg.payload.rawHex } : {}),
        ...(msg.payload.error !== undefined ? { error: msg.payload.error } : {}),
        ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
      });
    }
    return;
  }

  // ── firmware_progress / download_progress / device_log / ack ──────────────
  // These are informational — logged for now, hooked in future work
}

