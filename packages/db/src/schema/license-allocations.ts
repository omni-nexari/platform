import { pgTable, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { organizations } from './auth.js';

// ---------------------------------------------------------------------------
// Org license allocations
// Partners (management company admins) can allocate screen quotas and control
// which modules each client org can access. This is separate from billing —
// it's the partner's decision about how to distribute their licensed capacity.
//
// Rules:
//  - maxSignageScreens / maxPosScreens: null = unlimited within platform license
//  - enabledModules: null = all modules the org's plan supports; otherwise a
//    subset array (e.g. ['signage'])
//  - One row per org (upsert on orgId)
// ---------------------------------------------------------------------------
export const orgLicenseAllocations = pgTable('org_license_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }).unique(),
  managementCompanyId: uuid('management_company_id'), // which partner set this

  // Screen limits — null means the org can use the full platform license capacity
  maxSignageScreens: integer('max_signage_screens'),
  maxPosScreens: integer('max_pos_screens'),

  // Module access override — null means no override (org plan applies)
  enabledModules: text('enabled_modules').array(),

  notes: text('notes'),
  updatedById: uuid('updated_by_id'), // management_company_admin id who last updated this

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrgLicenseAllocation = typeof orgLicenseAllocations.$inferSelect;
export type OrgLicenseAllocationInsert = typeof orgLicenseAllocations.$inferInsert;
