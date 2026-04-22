import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, real, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { apiKeys } from './api-keys.js';

export const sensorSources = pgTable('sensor_sources', {
  id:            uuid('id').primaryKey().defaultRandom(),
  workspaceId:   uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  /** webhook | polling | mqtt */
  type:          text('type').notNull().default('webhook'),
  /** Default unit label (e.g. "°C", "%", "ppm") */
  unit:          text('unit'),
  /** Type-specific configuration (polling URL, MQTT topic, etc.) */
  config:        jsonb('config').notNull().default({}),
  /** API key used to authenticate push readings for this sensor */
  apiKeyId:      uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  lastReadingAt: timestamp('last_reading_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('sensor_sources_workspace_id_idx').on(t.workspaceId),
}));

export const sensorReadings = pgTable('sensor_readings', {
  id:         uuid('id').primaryKey().defaultRandom(),
  sensorId:   uuid('sensor_id').notNull().references(() => sensorSources.id, { onDelete: 'cascade' }),
  value:      real('value').notNull(),
  unit:       text('unit'),
  metadata:   jsonb('metadata'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sensorRecordedIdx: index('sensor_readings_sensor_id_recorded_at_idx').on(t.sensorId, t.recordedAt),
}));

export const triggerRules = pgTable('trigger_rules', {
  id:               uuid('id').primaryKey().defaultRandom(),
  workspaceId:      uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  sensorId:         uuid('sensor_id').references(() => sensorSources.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  /**
   * Array of condition objects:
   * { field: 'value'|'hour', operator: '>'|'<'|'>='|'<='|'=='|'!=', value: number, logic?: 'and'|'or' }
   */
  conditions:       jsonb('conditions').notNull().default([]),
  /**
   * switch_playlist | switch_content | send_notification | send_device_command | webhook_out
   */
  actionType:       text('action_type').notNull(),
  actionTargetId:   uuid('action_target_id'),
  actionPayload:    jsonb('action_payload'),
  /** all | device_id | device_tag */
  deviceScope:      text('device_scope').notNull().default('all'),
  deviceScopeValue: text('device_scope_value'),
  cooldownSeconds:  integer('cooldown_seconds').notNull().default(300),
  isActive:         boolean('is_active').notNull().default(true),
  lastFiredAt:      timestamp('last_fired_at', { withTimezone: true }),
  fireCount:        integer('fire_count').notNull().default(0),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx:     index('trigger_rules_workspace_id_idx').on(t.workspaceId),
  sensorIdx: index('trigger_rules_sensor_id_idx').on(t.sensorId),
}));

export const sensorSourcesRelations = relations(sensorSources, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [sensorSources.workspaceId], references: [workspaces.id] }),
  apiKey:    one(apiKeys,    { fields: [sensorSources.apiKeyId],    references: [apiKeys.id] }),
  readings:  many(sensorReadings),
  rules:     many(triggerRules),
}));

export const sensorReadingsRelations = relations(sensorReadings, ({ one }) => ({
  sensor: one(sensorSources, { fields: [sensorReadings.sensorId], references: [sensorSources.id] }),
}));

export const triggerRulesRelations = relations(triggerRules, ({ one }) => ({
  workspace: one(workspaces,    { fields: [triggerRules.workspaceId], references: [workspaces.id] }),
  sensor:    one(sensorSources, { fields: [triggerRules.sensorId],    references: [sensorSources.id] }),
}));

export type SensorSource  = typeof sensorSources.$inferSelect;
export type SensorReading = typeof sensorReadings.$inferSelect;
export type TriggerRule   = typeof triggerRules.$inferSelect;
