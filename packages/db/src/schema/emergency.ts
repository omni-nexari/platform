import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

/**
 * An active emergency override that interrupts all device playback.
 * Priority 99 — always wins over every scheduled playlist.
 */
export const emergencyOverrides = pgTable('emergency_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  scope: text('scope').notNull().default('org'), // org | workspace | tag | device
  scopeId: text('scope_id'),                     // workspaceId, tag name, or deviceId when scope != 'org'
  contentType: text('content_type').notNull().default('text'), // text | media
  contentText: text('content_text'),
  contentItemId: uuid('content_item_id'),        // Phase 3: FK to content_items
  autoClearAt: timestamp('auto_clear_at', { withTimezone: true }),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  clearedBy: uuid('cleared_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
