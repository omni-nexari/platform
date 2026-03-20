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
  | { type: 'set_zones'; payload: { zones: Array<{ id: string; rect: { x: number; y: number; width: number; height: number }; playlistId?: string }> } };

const connections = new Map<string, Conn>();

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
  if (!parsed.success) return;
  const msg = parsed.data;

  // ── heartbeat ──────────────────────────────────────────────────────────────
  if (msg.type === 'heartbeat') {
    const hb = msg.payload;
    await db
      .update(devices)
      .set({
        status: 'online',
        lastSeen: new Date(),
        ...(hb.playerVersion != null ? { playerVersion: hb.playerVersion } : {}),
        ...(hb.firmwareVersion != null ? { firmwareVersion: hb.firmwareVersion } : {}),
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
        ipAddress: ni.ip,
        macAddress: ni.mac,
        connectionType: ni.connectionType,
        wifiSsid: ni.wifiSsid ?? null,
        wifiStrength: ni.wifiStrength ?? null,
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

  // ── firmware_progress / download_progress / device_log / ack ──────────────
  // These are informational — logged for now, hooked in future work
}

