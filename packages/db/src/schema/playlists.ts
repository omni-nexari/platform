import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';
import { contentItems } from './content.js';

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references((): AnyPgColumn => workspaces.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  loop: boolean('loop').notNull().default(true),
  totalDuration: integer('total_duration').notNull().default(0),
  itemCount: integer('item_count').notNull().default(0),
  // ID of the first content item — used to serve a thumbnail via /content/:id/thumbnail
  thumbnailContentId: uuid('thumbnail_content_id').references((): AnyPgColumn => contentItems.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const playlistItems = pgTable('playlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  // 0-based position
  position: integer('position').notNull().default(0),
  // Exactly one of these must be non-null
  contentId: uuid('content_id').references(() => contentItems.id, { onDelete: 'set null' }),
  nestedPlaylistId: uuid('nested_playlist_id').references((): AnyPgColumn => playlists.id, { onDelete: 'set null' }),
  // Duration override in seconds; NULL means use the content / nested playlist's own duration
  duration: integer('duration'),
  transitionEffect: text('transition_effect').notNull().default('none'),
  // JSON string for per-item conditional overrides (time-of-day etc.)
  conditions: text('conditions').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
