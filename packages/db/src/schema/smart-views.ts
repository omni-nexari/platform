import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

export const smartViews = pgTable('smart_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceEntityIdx: index('smart_views_workspace_entity_idx').on(t.workspaceId, t.entityType),
}));
