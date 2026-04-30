import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { workspaces } from './workspaces.js';
import { users } from './users.js';
import { contentItems } from './content.js';
import { devices } from './devices.js';

/**
 * Sync playlists — content lists played synchronously across a group of screens.
 * Each item references a single content item with an optional duration override.
 */
export const syncPlaylists = pgTable('sync_playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncPlaylistItems = pgTable('sync_playlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  syncPlaylistId: uuid('sync_playlist_id').notNull().references(() => syncPlaylists.id, { onDelete: 'cascade' }),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  /** Duration override in seconds; null = use content default */
  durationSeconds: integer('duration_seconds'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sync groups — named groups of screens that play content in lockstep.
 * mode: 'native-samsung' = use Samsung b2bapis/webapis SyncPlay (auto-detected)
 *       'custom-mixed'   = software-based sync via WebSocket coordinator (Phase 5)
 */
export const syncGroups = pgTable('sync_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Samsung SyncPlay group ID: CRC-16 of this UUID, 0-65535. Checked for collisions at creation. */
  groupId: integer('group_id').notNull(),
  /** Assigned sync playlist to play */
  syncPlaylistId: uuid('sync_playlist_id').references(() => syncPlaylists.id, { onDelete: 'set null' }),
  /** Auto-detected from member device models. 'native-samsung' unless a non-Samsung device is present. */
  mode: text('mode').notNull().default('native-samsung'),
  /** Optional layout metadata for video-wall tiling (Phase 5) */
  layout: jsonb('layout'),
  /** Manifest version pushed by API; bumped on any change. Devices compare to detect updates. */
  manifestVersion: integer('manifest_version').notNull().default(0),
  /** Aggregate group state derived from member heartbeats: idle | preparing | playing | error */
  state: text('state').notNull().default('idle'),
  /** Item index currently active across the group (best-effort, leader-reported) */
  currentItemIndex: integer('current_item_index').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncGroupMembers = pgTable('sync_group_members', {
  syncGroupId: uuid('sync_group_id').notNull().references(() => syncGroups.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  tileCol: smallint('tile_col').notNull().default(0),
  tileRow: smallint('tile_row').notNull().default(0),
  /** Lower number = higher priority for leader election */
  leaderPriority: integer('leader_priority').notNull().default(0),
  /** Last LAN-IP reported via heartbeat; primary peer-table source for the bridge. */
  lastSeenIp: text('last_seen_ip'),
  /** Latest reported drift versus leader, in milliseconds. */
  driftMs: integer('drift_ms'),
  /** Latest reported HTML5 playbackRate (1.0 = nominal). */
  playbackRate: integer('playback_rate_x1000'),
  /** preparing | ready | playing | offline | error */
  readyState: text('ready_state').notNull().default('offline'),
  /** Timestamp of the last heartbeat from this device about this group. */
  lastReportAt: timestamp('last_report_at', { withTimezone: true }),
}, (t) => ({
  pk: primaryKey({ columns: [t.syncGroupId, t.deviceId] }),
}));

// ── Relations ────────────────────────────────────────────────────────────────

export const syncPlaylistsRelations = relations(syncPlaylists, ({ one, many }) => ({
  org: one(organisations, {
    fields: [syncPlaylists.orgId],
    references: [organisations.id],
  }),
  workspace: one(workspaces, {
    fields: [syncPlaylists.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [syncPlaylists.createdBy],
    references: [users.id],
  }),
  items: many(syncPlaylistItems),
}));

export const syncPlaylistItemsRelations = relations(syncPlaylistItems, ({ one }) => ({
  syncPlaylist: one(syncPlaylists, {
    fields: [syncPlaylistItems.syncPlaylistId],
    references: [syncPlaylists.id],
  }),
  content: one(contentItems, {
    fields: [syncPlaylistItems.contentId],
    references: [contentItems.id],
  }),
}));

export const syncGroupsRelations = relations(syncGroups, ({ one, many }) => ({
  org: one(organisations, {
    fields: [syncGroups.orgId],
    references: [organisations.id],
  }),
  workspace: one(workspaces, {
    fields: [syncGroups.workspaceId],
    references: [workspaces.id],
  }),
  syncPlaylist: one(syncPlaylists, {
    fields: [syncGroups.syncPlaylistId],
    references: [syncPlaylists.id],
  }),
  members: many(syncGroupMembers),
}));

export const syncGroupMembersRelations = relations(syncGroupMembers, ({ one }) => ({
  syncGroup: one(syncGroups, {
    fields: [syncGroupMembers.syncGroupId],
    references: [syncGroups.id],
  }),
  device: one(devices, {
    fields: [syncGroupMembers.deviceId],
    references: [devices.id],
  }),
}));
