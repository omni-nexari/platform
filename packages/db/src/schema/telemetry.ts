import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  real,
  bigint,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { organisations } from './auth.js';
import { devices } from './devices.js';
import { contentItems } from './content.js';
import { playlists } from './playlists.js';
import { schedules } from './schedules.js';
import { workspaces } from './workspaces.js';

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

/**
 * VideoWall sync groups (Phase 3 — Samsung SyncPlay API).
 */
export const syncGroups = pgTable('sync_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  groupId: smallint('group_id').notNull(),
  layout: jsonb('layout'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncGroupMembers = pgTable('sync_group_members', {
  syncGroupId: uuid('sync_group_id').notNull().references(() => syncGroups.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  tileCol: smallint('tile_col').notNull().default(0),
  tileRow: smallint('tile_row').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.syncGroupId, t.deviceId] }),
}));
