import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { users } from './users';
import { contentItems } from './content';

export const canvasProjects = pgTable('canvas_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  /** Links 1:1 to a content_items row so canvas can flow through playlists/schedules/tags */
  contentItemId: uuid('content_item_id').references(() => contentItems.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),

  name: text('name').notNull(),
  description: text('description'),

  /** Full scene tree (pages, elements, positions, styles) */
  sceneData: jsonb('scene_data').notNull().default('{}'),

  /** Global canvas settings: dimensions, background, grid, guides */
  settings: jsonb('settings').notNull().default('{}'),

  /** Optimistic-lock counter — incremented on each save */
  version: integer('version').notNull().default(1),

  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
