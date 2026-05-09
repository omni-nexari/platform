import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Management companies  (resellers / agencies / service providers)
// ---------------------------------------------------------------------------
export const managementCompanies = pgTable('management_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('(pending setup)'),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('starter'), // starter | pro | enterprise
  allowedModules: text('allowed_modules').notNull().default('signage'), // signage | pos | both
  billingEmail: text('billing_email'),
  logoUrl: text('logo_url'),
  portalTitle: text('portal_title'),
  faviconUrl: text('favicon_url'),
  primaryColor: text('primary_color'),
  accentColor: text('accent_color'),
  sidebarBg: text('sidebar_bg'),
  headingFontPreset: text('heading_font_preset'),
  bodyFontPreset: text('body_font_preset'),
  loginBackgroundUrl: text('login_background_url'),
  // bare UUID — FK enforced by migration; avoids circular import with auth.ts
  createdByOwnerId: uuid('created_by_owner_id'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Management company admins  (separate identity from org users)
// ---------------------------------------------------------------------------
export const managementCompanyAdmins = pgTable('management_company_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  managementCompanyId: uuid('management_company_id')
    .notNull()
    .references(() => managementCompanies.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('admin'), // owner | admin | billing
  lastLogin: timestamp('last_login', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Invite tokens for management company admins
// ---------------------------------------------------------------------------
export const managementCompanyAdminInvitations = pgTable(
  'management_company_admin_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    managementCompanyId: uuid('management_company_id')
      .notNull()
      .references(() => managementCompanies.id),
    // one of these will be set depending on who sent the invite
    invitedByOwnerId: uuid('invited_by_owner_id'), // FK to platform_owners — bare UUID
    invitedByAdminId: uuid('invited_by_admin_id').references(
      () => managementCompanyAdmins.id,
    ),
    email: text('email').notNull(),
    recipientName: text('recipient_name'),
    role: text('role').notNull().default('admin'),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// Invite tokens for client org owners
// ---------------------------------------------------------------------------
export const clientOrgOwnerInvitations = pgTable('client_org_owner_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // bare UUIDs to avoid circular import with auth.ts (organisations)
  organizationId: uuid('organization_id').notNull(),
  managementCompanyId: uuid('management_company_id')
    .notNull()
    .references(() => managementCompanies.id),
  // one of these will be set depending on who sent the invite
  invitedByOwnerId: uuid('invited_by_owner_id'), // FK to platform_owners — bare UUID
  invitedByAdminId: uuid('invited_by_admin_id').references(() => managementCompanyAdmins.id),
  email: text('email').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
