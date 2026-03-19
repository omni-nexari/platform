import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const tagCategories = pgTable('tag_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  /** Array of entity types this category applies to: 'device' | 'content' | 'playlist' | 'schedule' */
  availableFor: text('available_for').array().notNull().default([]),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceTags = pgTable('workspace_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id').notNull().references(() => tagCategories.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),   // optional per-tag colour override; falls back to category colour
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Records every time a workspace tag is attached to a device, content item, playlist, or schedule. */
export const tagAssignments = pgTable('tag_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tagId: uuid('tag_id').notNull().references(() => workspaceTags.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull(),
  entityType: text('entity_type').notNull(), // 'device' | 'content' | 'playlist' | 'schedule'
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('tag_assignment_unique').on(t.tagId, t.entityId),
  tagIdx: index('idx_tag_assignments_tag').on(t.tagId),
  wsEntityIdx: index('idx_tag_assignments_ws_entity').on(t.workspaceId, t.entityType),
}));
