import { pgTable, uuid, text, timestamp, jsonb, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const portalAnalyticsPreferences = pgTable('portal_analytics_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actorUniqueIdx: uniqueIndex('portal_analytics_preferences_actor_idx').on(table.actorType, table.actorId),
}));

export const portalAnalyticsDrilldownPresets = pgTable('portal_analytics_drilldown_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id').notNull(),
  name: text('name').notNull(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  view: text('view').notNull(),
  searchParams: jsonb('search_params').$type<Record<string, string>>().notNull().default({}),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actorIdx: index('portal_analytics_drilldown_presets_actor_idx').on(table.actorType, table.actorId),
}));

export const portalAnalyticsAlertStates = pgTable('portal_analytics_alert_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id').notNull(),
  alertKey: text('alert_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actorAlertUniqueIdx: uniqueIndex('portal_analytics_alert_states_actor_alert_idx').on(table.actorType, table.actorId, table.alertKey),
}));

export const platformAdminNotifications = pgTable('platform_admin_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  readAt: timestamp('read_at', { withTimezone: true }),
  dismissed: boolean('dismissed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actorCreatedIdx: index('platform_admin_notifications_actor_created_idx').on(table.actorType, table.actorId, table.createdAt),
}));