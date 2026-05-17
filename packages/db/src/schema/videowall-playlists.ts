import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';
import { contentItems } from './content.js';
import { deviceGroups } from './device-groups.js';

// ── Tables ────────────────────────────────────────────────────────────────────

export const videowallPlaylists = pgTable('videowall_playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references((): AnyPgColumn => workspaces.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  /** The videowall device group this playlist is authored for. */
  groupId: uuid('group_id').references(() => deviceGroups.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const videowallPlaylistSlots = pgTable(
  'videowall_playlist_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id').notNull().references(() => videowallPlaylists.id, { onDelete: 'cascade' }),
    positionCol: integer('position_col').notNull(),
    positionRow: integer('position_row').notNull(),
    /** Content assigned to this cell. NULL = no content (cell is blank). */
    contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
    /** CSS object-fit behaviour when rendering content on the device. */
    objectFit: text('object_fit').notNull().default('cover'), // 'cover' | 'contain' | 'fill'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqSlot: unique().on(t.playlistId, t.positionCol, t.positionRow),
  }),
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const videowallPlaylistsRelations = relations(videowallPlaylists, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [videowallPlaylists.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [videowallPlaylists.createdBy],
    references: [users.id],
  }),
  group: one(deviceGroups, {
    fields: [videowallPlaylists.groupId],
    references: [deviceGroups.id],
  }),
  slots: many(videowallPlaylistSlots),
}));

export const videowallPlaylistSlotsRelations = relations(videowallPlaylistSlots, ({ one }) => ({
  playlist: one(videowallPlaylists, {
    fields: [videowallPlaylistSlots.playlistId],
    references: [videowallPlaylists.id],
  }),
  content: one(contentItems, {
    fields: [videowallPlaylistSlots.contentId],
    references: [contentItems.id],
  }),
}));
