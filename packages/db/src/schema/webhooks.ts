import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { users } from './users.js';

export const outboundWebhooks = pgTable('outbound_webhooks', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  url:       text('url').notNull(),
  /** Random hex secret used for HMAC-SHA256 request signing */
  secret:    text('secret').notNull(),
  /** Array of event type strings this webhook subscribes to */
  events:    text('events').array().notNull().default([]),
  isActive:  boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('outbound_webhooks_org_id_idx').on(t.orgId),
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  webhookId:      uuid('webhook_id').notNull().references(() => outboundWebhooks.id, { onDelete: 'cascade' }),
  eventType:      text('event_type').notNull(),
  payload:        jsonb('payload').notNull(),
  /** pending | success | failed | abandoned */
  status:         text('status').notNull().default('pending'),
  responseStatus: integer('response_status'),
  responseBody:   text('response_body'),
  attemptCount:   integer('attempt_count').notNull().default(0),
  nextAttemptAt:  timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt:    timestamp('delivered_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  webhookIdx: index('webhook_deliveries_webhook_id_idx').on(t.webhookId),
}));

export const outboundWebhooksRelations = relations(outboundWebhooks, ({ one, many }) => ({
  org:       one(organisations, { fields: [outboundWebhooks.orgId],     references: [organisations.id] }),
  creator:   one(users,         { fields: [outboundWebhooks.createdBy], references: [users.id] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(outboundWebhooks, { fields: [webhookDeliveries.webhookId], references: [outboundWebhooks.id] }),
}));

export type OutboundWebhook = typeof outboundWebhooks.$inferSelect;
export type WebhookDelivery  = typeof webhookDeliveries.$inferSelect;
