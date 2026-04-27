import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organisations } from './auth.js';
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
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  name: text('name').notNull(),
  type: text('type').notNull().default('location'), // sync | videowall | location | tag
  description: text('description'),
  // For videowall: grid dimensions
  videoWallCols: integer('video_wall_cols'),
  videoWallRows: integer('video_wall_rows'),
  // For sync type: backing Samsung SyncPlay group (auto-created on POST /device-groups when type='sync')
  syncGroupId: uuid('sync_group_id').references(() => syncGroups.id, { onDelete: 'set null' }),
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
