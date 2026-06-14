import {
  pgTable,
  bigserial,
  text,
  jsonb,
  uuid,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { organizations } from './auth.js';
import { devices } from './devices.js';
import { users } from './users.js';

export const logEntries = pgTable('log_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  source: text('source').notNull(),      // 'api' | 'ds' | 'tizen' | 'tizen-sbb'
  level: text('level').notNull(),        // 'debug' | 'info' | 'warn' | 'error'
  message: text('message').notNull(),
  meta: jsonb('meta'),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  appVersion: text('app_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_log_entries_level_time').on(t.level, desc(t.createdAt)),
  index('idx_log_entries_source_time').on(t.source, desc(t.createdAt)),
  index('idx_log_entries_device_time').on(t.deviceId, desc(t.createdAt)),
  index('idx_log_entries_org_time').on(t.orgId, desc(t.createdAt)),
]);
