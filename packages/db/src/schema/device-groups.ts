import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './auth.js';
import { workspaces } from './workspaces.js';
import { devices } from './devices.js';
import { syncGroups } from './sync.js';

/**
 * A device group is a named collection of devices used for a specific purpose:
 *  - sync      — synchronized playback (links to a sync_groups row via syncGroupId)
 *  - videowall — multi-panel video wall
 *  - location  — physical location grouping
 *  - tag       — logical/label grouping
 */
export const deviceGroups = pgTable('device_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  name: text('name').notNull(),
  type: text('type').notNull().default('location'), // sync | videowall | location | tag
  description: text('description'),
  // For videowall: grid dimensions
  videoWallCols: integer('video_wall_cols'),
  videoWallRows: integer('video_wall_rows'),
  // For videowall: bezel compensation (mm per edge). NULL = no compensation.
  bezelTopMm: numeric('bezel_top_mm', { precision: 6, scale: 2 }),
  bezelRightMm: numeric('bezel_right_mm', { precision: 6, scale: 2 }),
  bezelBottomMm: numeric('bezel_bottom_mm', { precision: 6, scale: 2 }),
  bezelLeftMm: numeric('bezel_left_mm', { precision: 6, scale: 2 }),
  // For sync type: backing Samsung SyncPlay group (auto-created on POST /device-groups when type='sync')
  syncGroupId: uuid('sync_group_id').references(() => syncGroups.id, { onDelete: 'set null' }),
  /** Relay mode: 'lan' = leader device opens port 9616 relay; 'cloud' = use API /sync-relay */
  syncRelayMode: text('sync_relay_mode').notNull().default('lan'),
  /** Pinned leader device ID; NULL = auto-elect by platform priority */
  pinnedLeaderId: uuid('pinned_leader_id').references(() => devices.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deviceGroupMembers = pgTable('device_group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => deviceGroups.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  // For videowall: which cell this device occupies
  position: integer('position'),         // 0-based linear index
  positionCol: integer('position_col'),
  positionRow: integer('position_row'),
  // Per-tile physical metadata (videowall only)
  nativeWidthPx: integer('native_width_px'),   // NULL = 1920 default
  nativeHeightPx: integer('native_height_px'), // NULL = 1080 default
  colSpan: integer('col_span').notNull().default(1),
  rowSpan: integer('row_span').notNull().default(1),
  tileRotation: text('tile_rotation').notNull().default('0'), // '0'|'90'|'180'|'270'
  /** Lower number = higher leader priority. 0 = preferred leader. Used for videowall groups. */
  leaderPriority: integer('leader_priority').notNull().default(0),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ────────────────────────────────────────────────────────────────

export const deviceGroupsRelations = relations(deviceGroups, ({ one, many }) => ({
  syncGroup: one(syncGroups, {
    fields: [deviceGroups.syncGroupId],
    references: [syncGroups.id],
  }),
  members: many(deviceGroupMembers),
}));

export const deviceGroupMembersRelations = relations(deviceGroupMembers, ({ one }) => ({
  group: one(deviceGroups, {
    fields: [deviceGroupMembers.groupId],
    references: [deviceGroups.id],
  }),
  device: one(devices, {
    fields: [deviceGroupMembers.deviceId],
    references: [devices.id],
  }),
}));
