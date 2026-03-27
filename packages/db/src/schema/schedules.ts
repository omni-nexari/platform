import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';
import { contentItems } from './content.js';
import { playlists } from './playlists.js';

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  /** 'general' | 'override' */
  type: text('type').notNull().default('general'),
  isActive: boolean('is_active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleSlots = pgTable('schedule_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  /** At most one of these is set */
  playlistId: uuid('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  // Note: no .references() on these — sync.ts imports devices.ts which imports schedules.ts (circular).
  // FK constraints are enforced by the DB (see migration 0020_syncplay.sql).
  syncGroupId: uuid('sync_group_id'),
  syncPlaylistId: uuid('sync_playlist_id'),
  /** Time of day as HH:MM */
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  /** 'once' | 'daily' | 'weekly' */
  recurrenceType: text('recurrence_type').notNull().default('weekly'),
  /** ISO date string YYYY-MM-DD — only for recurrenceType='once' */
  date: text('date'),
  /** Day indices 0=Mon … 6=Sun — only for recurrenceType='weekly' */
  daysOfWeek: integer('days_of_week').array(),
  /** Optional display name override */
  label: text('label'),
  /** Hex colour for the slot block in the calendar */
  color: text('color').notNull().default('#3b82f6'),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [schedules.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [schedules.createdBy],
    references: [users.id],
  }),
  slots: many(scheduleSlots),
}));

export const scheduleSlotsRelations = relations(scheduleSlots, ({ one }) => ({
  schedule: one(schedules, {
    fields: [scheduleSlots.scheduleId],
    references: [schedules.id],
  }),
  playlist: one(playlists, {
    fields: [scheduleSlots.playlistId],
    references: [playlists.id],
  }),
  content: one(contentItems, {
    fields: [scheduleSlots.contentId],
    references: [contentItems.id],
  }),
}));
