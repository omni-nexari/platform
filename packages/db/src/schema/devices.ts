import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { workspaces } from './workspaces.js';
import { users } from './users.js';
import { playlists } from './playlists.js';
import { contentItems } from './content.js';
import { schedules } from './schedules.js';

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organisations.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  name: text('name').notNull().default('New Display'),
  pairingCode: text('pairing_code').unique(),
  pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
  status: text('status').notNull().default('unclaimed'), // unclaimed | online | offline | error
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  timezone: text('timezone').notNull().default('UTC'),
  resolution: text('resolution'),
  firmwareVersion: text('firmware_version'),
  playerVersion: text('player_version'),
  ipAddress: text('ip_address'),
  settings: text('settings').notNull().default('{}'),
  deviceToken: text('device_token'),

  // ── Device classification ──────────────────────────────────────────────────
  // type: what the device is used for
  type: text('device_type').notNull().default('signage'), // signage | kiosk | kitchen
  // platform: the Player OS/runtime
  platform: text('platform').notNull().default('tizen'),  // tizen | tizen-sbb | browser | android | webos | linux | windows

  // ── Windows / desktop player extras (kind='tv', platform='windows') ────────
  osVersion: text('os_version'),
  cpuModel: text('cpu_model'),
  gpuModel: text('gpu_model'),
  displayCount: integer('display_count'),
  primaryDisplayIndex: integer('primary_display_index'),
  systemVolume: integer('system_volume'),         // 0-100 (Windows volume, distinct from MDC)
  systemMuted: boolean('system_muted'),
  systemBrightness: integer('system_brightness'), // 0-100 (DDC/CI on Windows)
  windowsBuild: text('windows_build'),

  // ── Tizen hardware identity ────────────────────────────────────────────────
  duid: text('duid').unique(),
  manufacturer: text('manufacturer'),   // e.g. 'Samsung', 'LG', 'Philips'
  modelName: text('model_name'),
  modelCode: text('model_code'),
  serialNumber: text('serial_number'),
  macAddress: text('mac_address'),

  // ── Network ────────────────────────────────────────────────────────────────
  connectionType: text('connection_type'), // wifi | ethernet
  wifiSsid: text('wifi_ssid'),
  wifiStrength: integer('wifi_strength'),

  // ── E-Paper specific (kind='epaper') ───────────────────────────────────────
  // Distinguishes Samsung e-paper signage from regular TV/SBB displays.
  // Image-only renderer; uses webapis.epaper power/refresh APIs and a push-first
  // power profile (network standby always ON).
  kind: text('kind').notNull().default('tv'), // 'tv' | 'epaper'
  panelW: integer('panel_w'),
  panelH: integer('panel_h'),
  panelOrientation: text('panel_orientation'), // 'landscape' | 'portrait' — runtime-detected
  batteryPct: integer('battery_pct'),
  lastWakeReason: text('last_wake_reason'), // 'scheduled' | 'push' | 'user' | 'boot' | 'unknown'
  nextWakeAt: timestamp('next_wake_at', { withTimezone: true }),
  epaperApiVersion: text('epaper_api_version'),
  /** Per-device e-paper preferences. See migration 0055 for shape. */
  epaperSettings: jsonb('epaper_settings'),

  // ── Display state ──────────────────────────────────────────────────────────
  screenOrientation: text('screen_orientation'), // landscape | portrait
  powerState: text('power_state'), // on | off | standby — null until MDC reports
  irLock: boolean('ir_lock').notNull().default(false),
  buttonLock: boolean('button_lock').notNull().default(false),
  autoPowerOn: boolean('auto_power_on').notNull().default(false),

  // ── MDC state (auto-updated every 30s / 5min by player) ───────────────────
  mdcId: integer('mdc_id'),
  mdcVolume: integer('mdc_volume'),                     // 0-100
  mdcMute: boolean('mdc_mute'),                         // true=muted
  mdcInput: integer('mdc_input'),                       // source byte
  mdcStandby: integer('mdc_standby'),                   // 0=off 1=on 2=auto
  mdcNetworkStandby: integer('mdc_network_standby'),    // 0=off 1=on
  mdcRemoteControl: integer('mdc_remote_control'),      // 0=disable 1=enable
  mdcSafetyLock: integer('mdc_safety_lock'),            // 0=off 1=on
  mdcSoftwareVersion: text('mdc_software_version'),
  mdcOsdStatus: integer('mdc_osd_status'),              // bitmask
  mdcMenuOrientation: integer('mdc_menu_orientation'),  // 0-3
  mdcSrcOrientation: integer('mdc_src_orientation'),    // 0-3 or null=unsupported
  mdcTemperatureC: doublePrecision('mdc_temperature_c'),
  mdcLuxValue: integer('mdc_lux_value'),                // light sensor lux (model-dependent)
  mdcHwClock: text('mdc_hw_clock'),                     // device HW clock ISO string from MDC get_clock
  mdcLastPoll: timestamp('mdc_last_poll', { withTimezone: true }),
  mdcUrlLauncherAddress: text('mdc_url_launcher_address'),

  // ── On/Off timer state (from MDC poll) ─────────────────────────────────────
  timerSlots: jsonb('timer_slots'),

  // ── NTP / clock ────────────────────────────────────────────────────────────
  ntpEnabled: boolean('ntp_enabled').notNull().default(false),
  ntpServer: text('ntp_server'),
  ntpTimezone: text('ntp_timezone'),
  clockDriftMs: integer('clock_drift_ms'),

  // ── Location ───────────────────────────────────────────────────────────────
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  locationLabel: text('location_label'),

  // ── Multi-zone + screenshot policy ─────────────────────────────────────────
  zones: jsonb('zones'), // ZoneConfig[]
  screenshotIntervalMin: integer('screenshot_interval_min'),

  // ── Idle fallback playlist ─────────────────────────────────────────────────
  defaultPlaylistId: uuid('default_playlist_id').references(() => playlists.id, { onDelete: 'set null' }),

  // ── Direct per-device publish target override ─────────────────────────────
  publishedContentId: uuid('published_content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  publishedPlaylistId: uuid('published_playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  publishedScheduleId: uuid('published_schedule_id').references(() => schedules.id, { onDelete: 'set null' }),  // Note: no .references() here — sync.ts imports devices.ts so adding a back-reference would be circular.
  // The FK constraint is enforced by the DB (see migration 0020_syncplay.sql).
  publishedSyncGroupId: uuid('published_sync_group_id'),
  /** Per-device alert threshold overrides. Shape: { notSeenMinutes?, tempC?, cpuLoad?, storageFreeBytes? } */
  alertThresholds: jsonb('alert_thresholds'),
  /** Per-device Windows player settings — see WindowsPlayerSettings shape in shared. */
  windowsSettings: jsonb('windows_settings'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deviceScreenshots = pgTable('device_screenshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  trigger: text('trigger'), // auto_change | auto_interval | manual
  storageKey: text('storage_key').notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  requestedBy: uuid('requested_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** OTA player release catalog. (platform, version) is the natural key; one isLatest row per platform. */
export const playerReleases = pgTable('player_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'tizen' | 'windows' | 'epaper' — separate channel per player. */
  platform: text('platform').notNull().default('tizen'),
  version: text('version').notNull(),
  releaseNotes: text('release_notes'),
  downloadUrl: text('download_url').notNull(),
  /** electron-updater latest.yml URL (Windows only). */
  manifestUrl: text('manifest_url'),
  /** Installer file SHA-512 (Base64) — required by electron-updater. */
  sha512: text('sha512'),
  /** Installer file SHA-256 (hex) — used by Tizen/ePaper/player-web installers for integrity verification. */
  sha256: text('sha256'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  isLatest:              boolean('is_latest').notNull().default(false),
  /** Set by platform owner when the release is approved for resellers to see. */
  superadminApprovedAt:  timestamp('superadmin_approved_at', { withTimezone: true }),
  publishedAt:           timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-management-company approval of a player release.
 *  Created when a management-company admin clicks "Approve for clients".
 *  One row per (release, management_company) — unique constraint enforced. */
export const playerReleaseApprovals = pgTable(
  'player_release_approvals',
  {
    id:                  uuid('id').primaryKey().defaultRandom(),
    releaseId:           uuid('release_id').notNull().references(() => playerReleases.id, { onDelete: 'cascade' }),
    managementCompanyId: uuid('management_company_id').notNull(),
    approvedAt:          timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy:          uuid('approved_by'),
  },
  (t) => [
    uniqueIndex('uq_player_release_approvals_release_company').on(t.releaseId, t.managementCompanyId),
  ],
);
