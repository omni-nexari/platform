import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  bigint,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { devices } from './devices.js';
import { contentItems } from './content.js';
import { playlists } from './playlists.js';
import { schedules } from './schedules.js';

/**
 * One row per device heartbeat (every 30 s).
 * Retention: keep ~48 h via a periodic cleanup job (or use PARTITION BY DAY in v2).
 */
export const deviceHeartbeats = pgTable('device_heartbeats', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  playerVersion: text('player_version'),
  firmwareVersion: text('firmware_version'),
  powerState: text('power_state'), // on | off | standby
  clockDriftMs: integer('clock_drift_ms'),
  irLock: boolean('ir_lock'),
  buttonLock: boolean('button_lock'),
  cpuLoad: real('cpu_load'),                                          // 0-100
  storageFreeBytes: bigint('storage_free_bytes', { mode: 'number' }),
  memoryFreeBytes: bigint('memory_free_bytes', { mode: 'number' }),   // from tizen.systeminfo.getAvailableMemory()
  memoryTotalBytes: bigint('memory_total_bytes', { mode: 'number' }), // from tizen.systeminfo.getTotalMemory()
  deviceUptimeSec: integer('device_uptime_sec'),                       // from tizen.systeminfo.getDeviceUptime()
  temperatureC: real('temperature_c'),
  currentContentId: uuid('current_content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  nextContentId: uuid('next_content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  nextStartsAt: timestamp('next_starts_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  deviceTimeIdx: index('idx_device_heartbeats_device_time').on(t.deviceId, desc(t.createdAt)),
}));

/**
 * Proof-of-play log.  The parent table is PARTITION BY RANGE (started_at);
 * partitions are created by SQL migration 0008 and must be added monthly.
 * Retention: 13 months — drop the oldest partition each month.
 */
export const playEvents = pgTable('play_events', {
  id: uuid('id').notNull().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  playlistId: uuid('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  zoneId: text('zone_id'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
  completedFull: boolean('completed_full').notNull().default(true),
  source: text('source').notNull().default('schedule'), // schedule | playlist | default | emergency
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.id, t.startedAt] }),
  deviceIdx: index('idx_play_events_device').on(t.deviceId),
  contentIdx: index('idx_play_events_content').on(t.contentId),
  startedIdx: index('idx_play_events_started').on(desc(t.startedAt)),
}));

// syncGroups and syncGroupMembers have moved to schema/sync.ts
