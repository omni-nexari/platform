import { z } from 'zod';

export const DeviceStatusEnum = z.enum(['unclaimed', 'online', 'offline', 'error']);
export type DeviceStatus = z.infer<typeof DeviceStatusEnum>;

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid().nullable(),
  name: z.string(),
  pairingCode: z.string().nullable(),
  status: DeviceStatusEnum,
  lastSeen: z.string().datetime().nullable(),
  timezone: z.string(),
  resolution: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  playerVersion: z.string().nullable(),
  ipAddress: z.string().nullable(),
  settings: z.string(),

  // Tizen hardware identity
  duid: z.string().nullable(),
  modelName: z.string().nullable(),
  modelCode: z.string().nullable(),
  serialNumber: z.string().nullable(),
  macAddress: z.string().nullable(),

  // Network
  connectionType: z.enum(['wifi', 'ethernet']).nullable(),
  wifiSsid: z.string().nullable(),
  wifiStrength: z.number().int().nullable(),

  // Display state
  screenOrientation: z.enum(['landscape', 'portrait']).nullable(),
  powerState: z.enum(['on', 'off', 'standby']).nullable(),
  irLock: z.boolean(),
  buttonLock: z.boolean(),
  autoPowerOn: z.boolean(),

  // NTP
  ntpEnabled: z.boolean(),
  ntpServer: z.string().nullable(),
  ntpTimezone: z.string().nullable(),
  clockDriftMs: z.number().int().nullable(),

  // Location
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  locationLabel: z.string().nullable(),

  // Config
  screenshotIntervalMin: z.number().int().nullable(),
  defaultPlaylistId: z.string().uuid().nullable(),
  publishedContentId: z.string().uuid().nullable(),
  publishedPlaylistId: z.string().uuid().nullable(),
  publishedScheduleId: z.string().uuid().nullable(),

  // On/Off timer slots (populated by mdc_poll, keys are slot numbers 1-7)
  timerSlots: z.record(z.string(), z.object({
    onHour: z.number(), onMin: z.number(), onEnable: z.boolean(),
    offHour: z.number(), offMin: z.number(), offEnable: z.boolean(),
    repeat: z.number(), volume: z.number(), source: z.number(), manualDays: z.number(),
  })).nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

/** Sent by Tizen device on first boot to request a pairing code. */
export const PairRequestSchema = z.object({
  duid: z.string().min(1).nullish(),
  modelName: z.string().nullish(),
  modelCode: z.string().nullish(),
  serialNumber: z.string().nullish(),
  firmwareVersion: z.string().nullish(),
});
export type PairRequestInput = z.infer<typeof PairRequestSchema>;

export const ClaimDeviceSchema = z.object({
  code: z.string().length(6),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
});
export type ClaimDeviceInput = z.infer<typeof ClaimDeviceSchema>;

export const ZoneSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('playlist'), playlistId: z.string().uuid(), playlistName: z.string().optional() }),
  z.object({ type: z.literal('content'), contentId: z.string().uuid(), contentName: z.string().optional(), contentType: z.string().optional() }),
  z.object({ type: z.literal('empty') }),
]);
export type ZoneSource = z.infer<typeof ZoneSourceSchema>;

const ZoneConfigSchema = z.object({
  id: z.string(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  label: z.string().nullable().optional(),
  playlistId: z.string().uuid().optional().nullable(), // backward compat
  source: ZoneSourceSchema.optional().nullable(),
});

export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  timezone: z.string().optional(),
  settings: z.string().optional(),
  defaultPlaylistId: z.string().uuid().nullable().optional(),
  screenshotIntervalMin: z.number().int().min(1).nullable().optional(),
  locationLabel: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  zones: z.array(ZoneConfigSchema).nullable().optional(),
});
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceSchema>;

// ── WS Commands (server → device) ─────────────────────────────────────────────

export const DeviceCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('reboot') }),
  z.object({ command: z.literal('screenshot') }),
  z.object({ command: z.literal('refresh_schedule') }),
  z.object({ command: z.literal('emergency_start'), payload: z.object({ text: z.string().optional(), contentItemId: z.string().uuid().optional() }) }),
  z.object({ command: z.literal('emergency_clear') }),
  z.object({ command: z.literal('relaunch_app') }),
  z.object({ command: z.literal('power_off') }),
  z.object({ command: z.literal('power_on') }),
  z.object({ command: z.literal('set_ntp'), payload: z.object({ server: z.string(), timezone: z.string() }) }),
  z.object({ command: z.literal('set_ir_lock'), payload: z.object({ lock: z.boolean() }) }),
  z.object({ command: z.literal('set_button_lock'), payload: z.object({ lock: z.boolean() }) }),
  z.object({ command: z.literal('set_on_timer'), payload: z.object({ slot: z.number().int().min(1).max(7), time: z.string() }) }),
  z.object({ command: z.literal('set_off_timer'), payload: z.object({ slot: z.number().int().min(1).max(7), time: z.string() }) }),
  z.object({ command: z.literal('clear_on_timer'), payload: z.object({ slot: z.number().int().min(1).max(7) }) }),
  z.object({ command: z.literal('clear_off_timer'), payload: z.object({ slot: z.number().int().min(1).max(7) }) }),
  z.object({ command: z.literal('update_tv_firmware') }),
  z.object({ command: z.literal('update_player'), payload: z.object({ version: z.string(), downloadUrl: z.string() }) }),
  z.object({ command: z.literal('clear_cache') }),
  z.object({ command: z.literal('dump_logs') }),
  z.object({ command: z.literal('set_screenshot_interval'), payload: z.object({ minutes: z.number().int().min(1) }) }),
  z.object({ command: z.literal('set_zones'), payload: z.object({ zones: z.array(ZoneConfigSchema) }) }),
  z.object({
    command: z.literal('mdc_control'),
    payload: z.object({
      action: z.enum([
        'set_volume', 'set_mute', 'set_source', 'set_device_name',
        'standby_set', 'network_standby_set', 'remote_control_set', 'safety_lock_set',
        'osd_display_set', 'menu_orientation_set', 'src_orientation_set',
        'url_launcher_address_get', 'url_launcher_address_set',
      ]),
      level: z.number().int().min(0).max(100).optional(),
      mute: z.boolean().optional(),
      source: z.string().optional(),
      name: z.string().max(15).optional(),
      value: z.number().int().min(0).max(255).optional(),
      osdType: z.number().int().min(0).max(4).optional(),
      osdOnOff: z.number().int().min(0).max(1).optional(),
      urlAddress: z.string().max(200).optional(),
    }),
  }),
]);
export type DeviceCommandInput = z.infer<typeof DeviceCommandSchema>;

// ── Heartbeat (device → server, inside WS message) ────────────────────────────

export const HeartbeatSchema = z.object({
  playerVersion: z.string().optional(),
  firmwareVersion: z.string().optional(),
  timezone: z.string().optional(),
  resolution: z.string().optional(),
  powerState: z.enum(['on', 'off', 'standby']).optional(),
  clockDriftMs: z.number().int().optional(),
  irLock: z.boolean().optional(),
  buttonLock: z.boolean().optional(),
  cpuLoad: z.number().min(0).max(100).optional(),
  storageFreeBytes: z.number().int().optional(),
  memoryFreeBytes: z.number().int().optional(),
  memoryTotalBytes: z.number().int().optional(),
  deviceUptimeSec: z.number().int().optional(),
  temperatureCelsius: z.number().optional(),
  currentContentId: z.string().uuid().nullable().optional(),
  nextContentId: z.string().uuid().nullable().optional(),
  nextStartsAt: z.string().datetime().nullable().optional(),
  tvName: z.string().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatSchema>;

const HeartbeatReadinessSchema = z.object({
  readiness: z.object({
    driftMs: z.number().optional(),
    currentContentId: z.string().uuid().nullable().optional(),
    nextContentId: z.string().uuid().nullable().optional(),
    nextStartsAt: z.string().datetime().nullable().optional(),
  }),
});

// ── Device → Server WS messages ───────────────────────────────────────────────

export const PlayLogEntrySchema = z.object({
  contentId: z.string().uuid().nullable(),
  playlistId: z.string().uuid().nullable().optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  zoneId: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationMs: z.number().int(),
  completedFull: z.boolean(),
  source: z.enum(['schedule', 'playlist', 'default', 'emergency']),
});
export type PlayLogEntry = z.infer<typeof PlayLogEntrySchema>;

export const DeviceMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat'), payload: z.union([HeartbeatSchema, HeartbeatReadinessSchema]) }),
  z.object({
    type: z.literal('network_info'),
    payload: z.object({
      mac: z.string(),
      ip: z.string(),
      gateway: z.string().optional(),
      dns: z.string().optional(),
      connectionType: z.enum(['wifi', 'ethernet']),
      wifiSsid: z.string().optional(),
      wifiStrength: z.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal('system_state'),
    payload: z.object({ irLock: z.boolean(), buttonLock: z.boolean(), autoPowerOn: z.boolean() }),
  }),
  z.object({
    type: z.literal('screenshot_data'),
    payload: z.object({
      dataBase64: z.string(),
      contentId: z.string().uuid().nullable().optional(),
      trigger: z.enum(['auto_change', 'auto_interval', 'manual', 'live']),
    }),
  }),
  z.object({
    type: z.literal('firmware_progress'),
    payload: z.object({
      status: z.enum(['downloading', 'installing', 'complete', 'error']),
      progressPct: z.number().optional(),
      errorMessage: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('play_log'),
    payload: z.object({ entries: z.array(PlayLogEntrySchema) }),
  }),
  z.object({
    type: z.literal('download_progress'),
    payload: z.object({
      contentId: z.string().uuid(),
      progressPct: z.number(),
      bytesDownloaded: z.number().int(),
      totalBytes: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal('device_log'),
    payload: z.object({
      lines: z.array(z.string()),
      level: z.enum(['debug', 'info', 'warn', 'error']),
    }),
  }),
  z.object({
    type: z.literal('ack'),
    payload: z.object({
      commandId: z.string().uuid(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('mdc_status'),
    payload: z.object({
      requestId: z.string().uuid(),
      ok: z.boolean(),
      nodeRunning: z.boolean().optional(),
      serial: z.string().optional(),
      deviceName: z.string().optional(),
      modelName: z.string().optional(),
      ipAddress: z.string().optional(),
      remoteControl: z.number().int().optional(),
      tvName: z.string().optional(),
      deviceTime: z.string().optional(),
      rawHex: z.string().optional(),
      error: z.string().optional(),
      status: z.object({
        displayId: z.number().int(),
        ack: z.enum(['A', 'N']),
        rCmd: z.number().int(),
        power: z.number().int().optional(),
        volume: z.number().int().optional(),
        mute: z.number().int().optional(),
        input: z.number().int().optional(),
        aspect: z.number().int().optional(),
        nTime: z.number().int().optional(),
        fTime: z.number().int().optional(),
      }).optional(),
    }),
  }),
  z.object({
    type: z.literal('mdc_heartbeat'),
    payload: z.object({
      power:  z.number().int().optional(),
      volume: z.number().int().optional(),
      mute:   z.number().int().optional(),
      input:  z.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal('mdc_poll'),
    payload: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('mdc_id_persist'),
    payload: z.object({ mdcId: z.number().int().min(1).max(254) }),
  }),
  z.object({
    type: z.literal('mdc_control_response'),
    payload: z.object({
      requestId: z.string(),
      ok: z.boolean(),
      rawHex: z.string().optional(),
      data: z.array(z.number().int()).optional(),
      error: z.string().optional(),
    }).passthrough(),
  }),
  z.object({
    type: z.literal('tizen_probe_result'),
    payload: z.object({
      requestId: z.string(),
      data: z.record(z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('tizen_command_result'),
    payload: z.object({
      requestId: z.string(),
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: z.string().optional(),
    }),
  }),
]);
export type DeviceMessage = z.infer<typeof DeviceMessageSchema>;

