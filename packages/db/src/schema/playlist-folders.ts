import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const playlistFolders = pgTable('playlist_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references((): AnyPgColumn => workspaces.id),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const playlistFoldersRelations = relations(playlistFolders, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [playlistFolders.workspaceId],
    references: [workspaces.id],
  }),
  parent: one(playlistFolders, {
    fields: [playlistFolders.parentId],
    references: [playlistFolders.id],
    relationName: 'playlistFolderParent',
  }),
  children: many(playlistFolders, {
    relationName: 'playlistFolderParent',
  }),
}));
