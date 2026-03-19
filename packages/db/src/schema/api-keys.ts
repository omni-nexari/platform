import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id), // NULL = org-scoped
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(), // SHA-256 of the raw key
  keyPrefix: text('key_prefix').notNull(),      // first 8 chars shown in UI
  scopes: text('scopes').notNull().default('read'), // space-separated: read write admin
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
