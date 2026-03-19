import {
  pgTable,
  uuid,
  bigint,
  timestamp,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';

export const orgStorageQuotas = pgTable('org_storage_quotas', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().unique().references(() => organisations.id),
  // bytes — defaults: starter=5 GB, pro=50 GB, enterprise=500 GB
  limitBytes: bigint('limit_bytes', { mode: 'number' }).notNull().default(5_368_709_120),
  usedBytes: bigint('used_bytes', { mode: 'number' }).notNull().default(0),
  alertThresholdPct: bigint('alert_threshold_pct', { mode: 'number' }).notNull().default(90),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
