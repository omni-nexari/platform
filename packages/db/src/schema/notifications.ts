import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { users } from './users.js';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(), // device_offline | storage_warning | content_expiry | invite | system
  title: text('title').notNull(),
  body: text('body').notNull(),
  entityType: text('entity_type'),   // device | content | workspace | org …
  entityId: uuid('entity_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  dismissed: boolean('dismissed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
