import { db, devices, deviceHeartbeats, deviceScreenshots, playEvents, syncGroupMembers, syncGroups } from '@signage/db';
import { eq, and } from 'drizzle-orm';
import { DeviceMessageSchema } from '@signage/shared';
import { writeFile, mkdir } from 'node:fs/promises';
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
  deviceName?: string;
  modelName?: string;
  ipAddress?: string;
  remoteControl?: number;
  tvName?: string;
  deviceTime?: string;
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
  | { type: 'screenshot_auto' }
  | { type: 'refresh_schedule' }
  | { type: 'emergency_start'; payload: { text?: string; contentItemId?: string } }
  | { type: 'emergency_clear' }
  | { type: 'power_off' }
  | { type: 'power_on' }
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
  | { type: 'mdc_control'; payload: { action: string; requestId?: string; level?: number; mute?: boolean; source?: string; [key: string]: unknown } }
  | { type: 'SESSION_CONFIG'; groupId: number; mode: string; syncPlaylistId: string | null }
  | { type: 'SYNC_PLAY'; action: 'STOP' | 'CANCEL' | 'START_SYNCPLAY' }
  | {
      // SyncPlay Phase 4: full manifest push (LAN-cacheable).
      type: 'SYNC_GROUP_INIT';
      syncGroupId: string;
      version: number;
      groupId: number;
      leaderPriority: string[];
      peers: Array<{ deviceId: string; lastKnownIp: string | null; port: number }>;
      playlist: { id: string; items: Array<Record<string, unknown>> } | null;
    }
  | {
      // Force devices to drop sync state and re-init from server (emergency).
      type: 'SYNC_RESET';
      syncGroupId: string;
      reason?: string;
    }
  | {
      // Videowall: wall geometry + cell assignment pushed to each panel device.
      // mode='videowall' → player crops its region from the full-wall video.
      // mode='syncplay' → player runs P2P SyncEngine but renders full-screen (no crop).
      type: 'VIDEOWALL_INIT';
      mode: 'videowall' | 'syncplay';
      deviceGroupId: string;
      geometry: {
        gridCols: number;
        gridRows: number;
        canvasW: number;
        canvasH: number;
        colWidths: number[];
        rowHeights: number[];
        bezels: { topMm: number; rightMm: number; bottomMm: number; leftMm: number } | null;
      };
      leaderPriority: string[];
      peers: Array<{ deviceId: string; lastKnownIp: string | null; port: number }>;
      myCell: {
        deviceId: string;
        positionCol: number;
        positionRow: number;
        colSpan: number;
        rowSpan: number;
        tileRotation: string;
        nativeWidthPx: number | null;
        nativeHeightPx: number | null;
      };
    }
  | {
      // Clears any active videowall manifest on the device so it reverts to
      // normal single-screen rendering on next content load.
      type: 'VIDEOWALL_CLEAR';
    }
  | { type: 'tizen_probe'; payload: { requestId: string } }
  | { type: 'tizen_command'; payload: { requestId: string; action: string; params?: unknown } }
  | { type: 'ntp_resync' }
  | { type: 'switch_playlist'; payload: { playlistId: string | null } }
  | { type: 'switch_content'; payload: { contentId: string | null } };

const connections = new Map<string, Conn>();
const deviceLogs = new Map<string, DeviceConsoleLogEntry[]>();
const lastNtpResyncSentAt = new Map<string, number>(); // rate-limit ntp_resync per device
const MAX_DEVICE_LOGS = 2000;
const pendingMdcStatus = new Map<string, {
  resolve: (value: MdcStatusResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export type MdcControlResponse = {
  requestId: string;
  ok: boolean;
  rawHex?: string;
  data?: number[];
  error?: string;
  [key: string]: unknown;
};

const pendingMdcControl = new Map<string, {
  resolve: (value: MdcControlResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export type TizenProbeEntry = { label: string; value?: unknown; error?: string };
export type TizenProbeResult = {
  requestId: string;
  sections: Record<string, TizenProbeEntry[]>;
};

const pendingTizenProbe = new Map<string, {
  resolve: (value: TizenProbeResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export type TizenCommandResult = {
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

const pendingTizenCommand = new Map<string, {
  resolve: (value: TizenCommandResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ── Latest-frame in-memory store (device card thumbnail, no disk write) ────
const latestFrameStore = new Map<string, { buf: Buffer; updatedAt: Date }>();

export function getLatestFrame(deviceId: string): { buf: Buffer; updatedAt: Date } | undefined {
  return latestFrameStore.get(deviceId);
}

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

export function requestMdcControl(
  deviceId: string,
  action: string,
  payload: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<MdcControlResponse> {
  const requestId = randomUUID();
  const pendingKey = `${deviceId}:${requestId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingMdcControl.delete(pendingKey);
      reject(new Error('Timed out waiting for MDC control response from device'));
    }, timeoutMs);

    pendingMdcControl.set(pendingKey, { resolve, reject, timer });

    const delivered = sendCommand(deviceId, {
      type: 'mdc_control',
      payload: { action, requestId, ...payload },
    });
    if (!delivered) {
      clearTimeout(timer);
      pendingMdcControl.delete(pendingKey);
      reject(new Error('Device is offline or not connected via WebSocket'));
    }
  });
}

export function requestTizenCommand(deviceId: string, action: string, params?: unknown, timeoutMs = 30_000): Promise<TizenCommandResult> {
  const requestId = randomUUID();
  const pendingKey = `${deviceId}:${requestId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTizenCommand.delete(pendingKey);
      reject(new Error('Timed out waiting for Tizen command result from device'));
    }, timeoutMs);

    pendingTizenCommand.set(pendingKey, { resolve, reject, timer });

    const delivered = sendCommand(deviceId, { type: 'tizen_command', payload: { requestId, action, ...(params !== undefined ? { params } : {}) } });
    if (!delivered) {
      clearTimeout(timer);
      pendingTizenCommand.delete(pendingKey);
      reject(new Error('Device is offline or not connected via WebSocket'));
    } else {
      console.info('[ws] tizen_command sent', { deviceId, action, requestId });
    }
  });
}

export function requestTizenProbe(deviceId: string, timeoutMs = 30_000): Promise<TizenProbeResult> {
  const requestId = randomUUID();
  const pendingKey = `${deviceId}:${requestId}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTizenProbe.delete(pendingKey);
      reject(new Error('Timed out waiting for Tizen probe result from device'));
    }, timeoutMs);

    pendingTizenProbe.set(pendingKey, { resolve, reject, timer });

    const delivered = sendCommand(deviceId, { type: 'tizen_probe', payload: { requestId } });
    if (!delivered) {
      clearTimeout(timer);
      pendingTizenProbe.delete(pendingKey);
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

  // Handle MDC control responses before schema parsing so API relay remains
  // robust even if the shared package watcher has not reloaded yet.
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'type' in raw &&
    (raw as { type?: unknown }).type === 'mdc_control_response'
  ) {
    const payload = (raw as {
      payload?: {
        requestId?: unknown;
        ok?: unknown;
        rawHex?: unknown;
        data?: unknown;
        error?: unknown;
      };
    }).payload;

    if (typeof payload?.requestId === 'string' && typeof payload?.ok === 'boolean') {
      const pendingKey = `${deviceId}:${payload.requestId}`;
      const pending = pendingMdcControl.get(pendingKey);
      if (pending) {
        clearTimeout(pending.timer);
        pendingMdcControl.delete(pendingKey);
        console.info('[ws] raw mdc_control_response resolved', { deviceId, requestId: payload.requestId, ok: payload.ok });
        pending.resolve({
          ...(payload as Record<string, unknown>),
          requestId: String(payload.requestId),
          ok: !!payload.ok,
          ...(Array.isArray(payload.data) ? { data: (payload.data as unknown[]).filter((item): item is number => typeof item === 'number') } : {}),
        } as MdcControlResponse);
      } else {
        console.warn('[ws] raw mdc_control_response had no pending waiter', { deviceId, requestId: payload.requestId });
      }
      return;
    }

    console.warn('[ws] raw mdc_control_response missing required fields', { deviceId, raw });
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
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'type' in raw &&
      (raw as { type?: unknown }).type === 'mdc_control_response'
    ) {
      console.warn('[ws] mdc_control_response parse failed', parsed.error.issues, raw);
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
        ...('tvName' in hb && hb.tvName ? { name: hb.tvName } : {}),
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
      memoryFreeBytes: hb.memoryFreeBytes,
      memoryTotalBytes: hb.memoryTotalBytes,
      deviceUptimeSec: hb.deviceUptimeSec,
      temperatureC: hb.temperatureCelsius,
      currentContentId: hb.currentContentId ?? null,
      nextContentId: hb.nextContentId ?? null,
      nextStartsAt: hb.nextStartsAt ? new Date(hb.nextStartsAt) : null,
    });

    // If drift exceeds ±200ms, nudge the TV to resync — but at most once per 60s per device
    const NTP_RESYNC_THRESHOLD_MS = 200;
    const NTP_RESYNC_COOLDOWN_MS = 60_000;
    if (hb.clockDriftMs != null && Math.abs(hb.clockDriftMs) > NTP_RESYNC_THRESHOLD_MS) {
      const lastSent = lastNtpResyncSentAt.get(deviceId) ?? 0;
      if (Date.now() - lastSent > NTP_RESYNC_COOLDOWN_MS) {
        const conn = connections.get(deviceId);
        if (conn?.readyState === 1 /* OPEN */) {
          conn.send(JSON.stringify({ type: 'ntp_resync' }));
          lastNtpResyncSentAt.set(deviceId, Date.now());
          console.info(`[ws] ntp_resync sent to ${deviceId} (drift=${hb.clockDriftMs}ms)`);
        }
      }
    }

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

  // ── mdc_heartbeat: 30s MDC status_get result → update powerState + live MDC state ─
  if (msg.type === 'mdc_heartbeat') {
    const mh = msg.payload as { power?: number; volume?: number; mute?: number; input?: number };
    const set: Partial<typeof devices.$inferInsert> = { updatedAt: new Date() };
    if (mh.power  != null) set.powerState = mh.power === 1 ? 'on' : 'off';
    if (mh.volume != null) set.mdcVolume  = mh.volume;
    if (mh.mute   != null) set.mdcMute    = mh.mute === 1;
    if (mh.input  != null) set.mdcInput   = mh.input;
    await db.update(devices).set(set).where(eq(devices.id, deviceId));
    return;
  }

  // ── mdc_poll: 5min full MDC GET results → write to dedicated DB columns ───
  if (msg.type === 'mdc_poll') {
    const mp = msg.payload as Record<string, unknown>;
    const set: Partial<typeof devices.$inferInsert> = { updatedAt: new Date(), mdcLastPoll: new Date() };
    if (mp.standby         != null) set.mdcStandby        = mp.standby         as number;
    if (mp.osdStatus       != null) set.mdcOsdStatus      = mp.osdStatus       as number;
    if (mp.networkStandby  != null) set.mdcNetworkStandby = mp.networkStandby  as number;
    if (mp.menuOrientation != null) set.mdcMenuOrientation = mp.menuOrientation as number;
    // srcOrientation can be null (NAK = unsupported) — always write
    set.mdcSrcOrientation = mp.srcOrientation != null ? mp.srcOrientation as number : null;
    if (mp.remoteControl   != null) set.mdcRemoteControl  = mp.remoteControl   as number;
    if (mp.safetyLock      != null) set.mdcSafetyLock     = mp.safetyLock      as number;
    if (mp.softwareVersion != null) set.mdcSoftwareVersion = mp.softwareVersion as string;
    if (mp.temperatureC    != null) set.mdcTemperatureC   = mp.temperatureC    as number;
    if (mp.luxValue        != null) set.mdcLuxValue        = mp.luxValue        as number;
    if (mp.hwClock         != null) set.mdcHwClock         = mp.hwClock         as string;
    if (mp.urlLauncherAddress != null) set.mdcUrlLauncherAddress = mp.urlLauncherAddress as string;
    // Timer slots (keys "1"-"7", each has the parsed on/off timer state)
    if (Array.isArray(mp.timers)) {
      const slots: Record<string, unknown> = {};
      (mp.timers as (Record<string, unknown> | null)[]).forEach((t, i) => {
        if (t != null) slots[String(i + 1)] = t;
      });
      if (Object.keys(slots).length > 0) set.timerSlots = slots;
    }
    await db.update(devices).set(set).where(eq(devices.id, deviceId));
    return;
  }

  // ── mdc_id_persist: save scanned MDC ID into dedicated DB column ──────────
  if (msg.type === 'mdc_id_persist') {
    const { mdcId } = msg.payload as { mdcId: number };
    if (typeof mdcId === 'number' && mdcId >= 1 && mdcId <= 254) {
      await db.update(devices).set({ mdcId, updatedAt: new Date() }).where(eq(devices.id, deviceId));
    }
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

    // Always update the in-memory latest frame (serves device-card thumbnail instantly)
    latestFrameStore.set(deviceId, { buf, updatedAt: new Date() });

    if (trigger !== 'manual') {
      // Auto shots (content_change, interval, auto): persist as a single overwriting
      // thumbnail.jpg per device so the /screenshot/latest DB fallback works after
      // server restarts (when the in-memory store is empty).
      (async () => {
        try {
          const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
          const dir = join(STORAGE_ROOT, deviceId);
          await mkdir(dir, { recursive: true });
          const storageKey = `${deviceId}/thumbnail.jpg`;
          await writeFile(join(STORAGE_ROOT, storageKey), buf);
          // Update existing thumbnail row (stable UUID) or insert if first time.
          // Keeping the same UUID prevents the portal from getting a 404 during the
          // 15s poll window after the old UUID was deleted. The latestFrameAt
          // cache-buster (?t=) in the image URL handles re-fetching new file content.
          const existingThumb = await db.query.deviceScreenshots.findFirst({
            where: and(eq(deviceScreenshots.deviceId, deviceId), eq(deviceScreenshots.trigger, 'thumbnail')),
            columns: { id: true },
          });
          if (existingThumb) {
            await db.update(deviceScreenshots)
              .set({ storageKey, takenAt: new Date() })
              .where(eq(deviceScreenshots.id, existingThumb.id));
          } else {
            await db.insert(deviceScreenshots).values({ deviceId, storageKey, trigger: 'thumbnail' });
          }
        } catch (err) {
          console.error('[ws] screenshot_data persist failed', { deviceId, trigger }, err);
        }
      })();
      return;
    }

    const fileName = `${randomUUID()}.jpg`;
    const storageKey = `${deviceId}/${fileName}`;
    // ensure directory
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

      // Persist MDC power to devices table so it is the source of truth
      if (normalizedStatus?.power !== undefined) {
        const mdcPowerState = normalizedStatus.power === 1 ? 'on' : 'off';
        await db.update(devices).set({ powerState: mdcPowerState, updatedAt: new Date() }).where(eq(devices.id, deviceId));
      }

      pending.resolve({
        requestId: msg.payload.requestId,
        ok: msg.payload.ok,
        ...(msg.payload.nodeRunning !== undefined ? { nodeRunning: msg.payload.nodeRunning } : {}),
        ...(msg.payload.serial !== undefined ? { serial: msg.payload.serial } : {}),
        ...(msg.payload.deviceName !== undefined ? { deviceName: msg.payload.deviceName } : {}),
        ...(msg.payload.modelName !== undefined ? { modelName: msg.payload.modelName } : {}),
        ...(msg.payload.ipAddress !== undefined ? { ipAddress: msg.payload.ipAddress } : {}),
        ...(msg.payload.remoteControl !== undefined ? { remoteControl: msg.payload.remoteControl } : {}),
        ...(msg.payload.tvName !== undefined ? { tvName: msg.payload.tvName } : {}),
        ...(msg.payload.deviceTime !== undefined ? { deviceTime: msg.payload.deviceTime } : {}),
        ...(msg.payload.rawHex !== undefined ? { rawHex: msg.payload.rawHex } : {}),
        ...(msg.payload.error !== undefined ? { error: msg.payload.error } : {}),
        ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
      });
    }
    return;
  }

  // ── mdc_control_response ────────────────────────────────────────────────
  if (msg.type === 'mdc_control_response') {
    const pendingKey = `${deviceId}:${msg.payload.requestId}`;
    const pending = pendingMdcControl.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      pendingMdcControl.delete(pendingKey);
      console.info('[ws] mdc_control_response resolved', { deviceId, requestId: msg.payload.requestId, ok: msg.payload.ok });
      // Spread the full passthrough payload so extra fields (e.g. displayId, idOk) are preserved.
      const { requestId: _rid, ok: _ok, data, ...extra } = msg.payload as Record<string, unknown> & { requestId: string; ok: boolean; data?: unknown };
      pending.resolve({
        ...extra,
        requestId: msg.payload.requestId,
        ok: msg.payload.ok,
        ...(msg.payload.rawHex !== undefined ? { rawHex: msg.payload.rawHex } : {}),
        ...(Array.isArray(data) ? { data: (data as unknown[]).filter((x): x is number => typeof x === 'number') } : {}),
        ...(msg.payload.error !== undefined ? { error: msg.payload.error } : {}),
      });
    } else {
      console.warn('[ws] mdc_control_response had no pending waiter', { deviceId, requestId: msg.payload.requestId });
    }
    return;
  }

  // ── tizen_probe_result ────────────────────────────────────────────────────
  if (msg.type === 'tizen_probe_result') {
    const pendingKey = `${deviceId}:${msg.payload.requestId}`;
    const pending = pendingTizenProbe.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTizenProbe.delete(pendingKey);
      const data = msg.payload.data as Record<string, TizenProbeEntry[]>;
      pending.resolve({ requestId: msg.payload.requestId, sections: data });
    }
    return;
  }

  // ── tizen_command_result ──────────────────────────────────────────────────
  if (msg.type === 'tizen_command_result') {
    console.info('[ws] tizen_command_result received', { deviceId, requestId: msg.payload.requestId, ok: msg.payload.ok, error: msg.payload.error });
    const pendingKey = `${deviceId}:${msg.payload.requestId}`;
    const pending = pendingTizenCommand.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTizenCommand.delete(pendingKey);
      pending.resolve({
        requestId: msg.payload.requestId,
        ok: msg.payload.ok,
        ...(msg.payload.value !== undefined ? { value: msg.payload.value } : {}),
        ...(msg.payload.error !== undefined ? { error: msg.payload.error } : {}),
      });
    }
    return;
  }

  // ── sync_heartbeat (SyncPlay observability — never required for playback) ──
  if (msg.type === 'sync_heartbeat') {
    const p = msg.payload;
    try {
      const patch: Record<string, unknown> = {
        readyState: p.readyState ?? 'playing',
        lastReportAt: new Date(),
      };
      if (typeof p.driftMs === 'number') patch.driftMs = p.driftMs;
      if (typeof p.playbackRate === 'number') patch.playbackRate = Math.round(p.playbackRate * 1000);
      if (p.lanIp) patch.lastSeenIp = p.lanIp;
      await db.update(syncGroupMembers)
        .set(patch)
        .where(and(
          eq(syncGroupMembers.syncGroupId, p.syncGroupId),
          eq(syncGroupMembers.deviceId, deviceId),
        ));
      // Leader is authoritative on currentItemIndex.
      if (p.role === 'leader') {
        await db.update(syncGroups)
          .set({ currentItemIndex: p.itemIndex, state: 'playing', updatedAt: new Date() })
          .where(eq(syncGroups.id, p.syncGroupId));
      }
    } catch (err) {
      console.warn('[ws] sync_heartbeat persist failed', { deviceId, err: (err as Error)?.message });
    }
    return;
  }

  // ── firmware_progress / download_progress / device_log / ack ──────────────
  // These are informational — logged for now, hooked in future work
}

