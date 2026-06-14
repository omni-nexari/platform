import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organizations } from './auth.js';
import { users } from './users.js';

export const deviceConfigTemplates = pgTable('device_config_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** Partial device config object — same fields as PATCH /devices/:id body */
  config: jsonb('config').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('device_config_templates_org_id_idx').on(t.orgId),
}));

export const deviceConfigTemplatesRelations = relations(deviceConfigTemplates, ({ one }) => ({
  org: one(organizations, {
    fields: [deviceConfigTemplates.orgId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [deviceConfigTemplates.createdBy],
    references: [users.id],
  }),
}));
