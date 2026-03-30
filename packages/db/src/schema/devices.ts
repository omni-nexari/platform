import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  jsonb,
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

  // ── Tizen hardware identity ────────────────────────────────────────────────
  duid: text('duid').unique(),
  modelName: text('model_name'),
  modelCode: text('model_code'),
  serialNumber: text('serial_number'),
  macAddress: text('mac_address'),

  // ── Network ────────────────────────────────────────────────────────────────
  connectionType: text('connection_type'), // wifi | ethernet
  wifiSsid: text('wifi_ssid'),
  wifiStrength: integer('wifi_strength'),

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
  mdcLastPoll: timestamp('mdc_last_poll', { withTimezone: true }),

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

/** OTA player release catalog. */
export const playerReleases = pgTable('player_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull().unique(),
  releaseNotes: text('release_notes'),
  downloadUrl: text('download_url').notNull(),
  isLatest: boolean('is_latest').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
