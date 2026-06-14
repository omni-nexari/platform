import {
  pgTable,
  uuid,
  text,
  timestamp,
  inet,
} from 'drizzle-orm/pg-core';

// Renamed from super_admins in migration 0012
export const platformOwners = pgTable('platform_owners', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  lastLogin: timestamp('last_login', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('starter'),
  settings: text('settings').notNull().default('{}'), // stored as JSON string
  status: text('status').notNull().default('active'), // pending | active | suspended
  // management company ownership — bare UUIDs to avoid circular schema import
  managementCompanyId: uuid('management_company_id'),
  originatingAdminId: uuid('originating_admin_id'),
  primaryAccountManagerId: uuid('primary_account_manager_id'),
  billingOwnerCompanyId: uuid('billing_owner_company_id'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgInvitations = pgTable('org_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  invitedBy: uuid('invited_by').notNull(),
  email: text('email').notNull(),
  orgRole: text('org_role').notNull(),
  token: text('token').notNull().unique(),
  initialWorkspaceId: uuid('initial_workspace_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  actorId: uuid('actor_id'),
  actorType: text('actor_type').notNull().default('user'), // user | device | system
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  meta: text('meta').notNull().default('{}'),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
