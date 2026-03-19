import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash'), // NULL if SSO only
    name: text('name').notNull().default(''),
    avatarUrl: text('avatar_url'),
    orgRole: text('org_role').notNull().default('member'), // owner | admin | member
    status: text('status').notNull().default('active'),    // active | suspended
    totpSecret: text('totp_secret'),      // encrypted at rest; NULL = not enrolled
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    backupCodes: text('backup_codes').array(), // hashed single-use codes
    lastLogin: timestamp('last_login', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_users_org_email').on(t.orgId, t.email)],
);
