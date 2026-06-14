import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { organizations } from './auth.js';
import { managementCompanies } from './management.js';

// ---------------------------------------------------------------------------
// Master plan definitions
// planKey examples: basic | pro | menu_board | bundle_basic_menu | bundle_pro_menu
// ---------------------------------------------------------------------------
export const pricingPlans = pgTable('pricing_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  planKey: text('plan_key').notNull().unique(),          // slug used in code & DB
  name: text('name').notNull(),                          // human display name
  module: text('module').notNull(),                      // signage | pos | both
  screensIncluded: integer('screens_included').notNull().default(1),
  billingPeriod: text('billing_period').notNull().default('monthly'), // monthly | annual
  isPublic: boolean('is_public').notNull().default(true), // shown on public pricing page
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Per-currency prices  (one row per plan × currency)
// All amounts in minor units (cents/pence/etc.)
// ---------------------------------------------------------------------------
export const pricingPlanPrices = pgTable('pricing_plan_prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => pricingPlans.id),
  currency: text('currency').notNull(),                  // CAD | USD | GBP | EUR | AUD
  amountCents: integer('amount_cents').notNull(),         // base price per screen/location per month
  extraScreenCents: integer('extra_screen_cents').notNull().default(0), // per extra screen above screensIncluded
  // Stripe Price IDs — populated when superadmin syncs plans to Stripe
  stripePriceId: text('stripe_price_id'),
  stripeExtraScreenPriceId: text('stripe_extra_screen_price_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Per-management-company pricing
// Supports two billing models:
//   reseller: Nexari invoices SI at wholesaleCents; SI bills clients however they choose
//   direct:   Nexari bills clients directly via Stripe, pays SI commissionPct
// maxMarkupPct caps how much SIs may charge above master price (null = no cap)
// ---------------------------------------------------------------------------
export const managementCompanyPricing = pgTable('management_company_pricing', {
  id: uuid('id').primaryKey().defaultRandom(),
  managementCompanyId: uuid('management_company_id')
    .notNull()
    .references(() => managementCompanies.id),
  planId: uuid('plan_id').notNull().references(() => pricingPlans.id),
  currency: text('currency').notNull(),
  wholesaleCents: integer('wholesale_cents'),              // reseller model: what SI pays Nexari
  maxMarkupPct: numeric('max_markup_pct', { precision: 5, scale: 2 }), // direct model markup cap
  commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }), // direct model payout to SI
  createdByOwnerId: uuid('created_by_owner_id'),           // bare UUID — FK to platform_owners
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Per-org pricing overrides  (grandfathered / negotiated / promo pricing)
// Can be created by superadmin (owner) or a management company admin.
// expiresAt = null means the override is permanent until manually removed.
// ---------------------------------------------------------------------------
export const orgPricingOverrides = pgTable('org_pricing_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  planId: uuid('plan_id').notNull().references(() => pricingPlans.id),
  currency: text('currency').notNull(),
  overrideCents: integer('override_cents').notNull(),
  reason: text('reason'),                                  // grandfathered | negotiated | promo
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdByType: text('created_by_type').notNull(),        // owner | management_company_admin
  createdById: uuid('created_by_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Subscriptions  (one active subscription per org at a time)
//
// billingModel:
//   direct   — Nexari bills this org via Stripe (stripeCustomerId / stripeSubscriptionId used)
//   reseller — SI is billed by Nexari at wholesale; SI handles billing their client
//
// Trial: managed by Nexari (not Stripe), so we can flex defaults and extend.
// Default: 60 days, 3 screens. Superadmin or SI can extend per-org.
// ---------------------------------------------------------------------------
export const orgSubscriptions = pgTable('org_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  planId: uuid('plan_id').notNull().references(() => pricingPlans.id),
  currency: text('currency').notNull().default('CAD'),
  // trialing | active | past_due | canceled | paused
  status: text('status').notNull().default('trialing'),
  // direct | reseller
  billingModel: text('billing_model').notNull().default('direct'),

  // ------- Trial -------
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  trialScreenLimit: integer('trial_screen_limit').notNull().default(3),
  trialExtendedByType: text('trial_extended_by_type'),     // owner | management_company_admin
  trialExtendedById: uuid('trial_extended_by_id'),         // bare UUID

  // ------- Stripe (direct billing model only) -------
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionItemId: text('stripe_subscription_item_id'), // for metered usage records

  // ------- Billing period -------
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),

  // ------- Reseller linkage -------
  managedByCompanyId: uuid('managed_by_company_id'),       // bare UUID — FK to management_companies

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Screen usage records
// Logged each time we report metered usage to Stripe (or track internally for
// reseller-model orgs). Provides an audit trail and enables usage analytics.
// ---------------------------------------------------------------------------
export const screenUsageRecords = pgTable('screen_usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  subscriptionId: uuid('subscription_id').notNull().references(() => orgSubscriptions.id),
  screenCount: integer('screen_count').notNull(),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  stripeUsageRecordId: text('stripe_usage_record_id'),     // set after Stripe API call
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Invoices
// Used for both direct-billed orgs (mirrors Stripe invoice) and reseller
// wholesale invoices sent to management companies.
// ---------------------------------------------------------------------------
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  subscriptionId: uuid('subscription_id').references(() => orgSubscriptions.id),
  // Set when this is a wholesale invoice to an SI (reseller model)
  managementCompanyId: uuid('management_company_id'),
  currency: text('currency').notNull().default('CAD'),
  amountCents: integer('amount_cents').notNull(),
  taxCents: integer('tax_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  // draft | open | paid | void | uncollectible
  status: text('status').notNull().default('draft'),
  invoiceNumber: text('invoice_number'),                   // e.g. "INV-2026-00001"
  dueAt: timestamp('due_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  stripeInvoiceId: text('stripe_invoice_id'),
  lineItems: text('line_items').notNull().default('[]'),   // JSON array of line items
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type PricingPlan = typeof pricingPlans.$inferSelect;
export type PricingPlanInsert = typeof pricingPlans.$inferInsert;
export type PricingPlanPrice = typeof pricingPlanPrices.$inferSelect;
export type PricingPlanPriceInsert = typeof pricingPlanPrices.$inferInsert;
export type ManagementCompanyPricing = typeof managementCompanyPricing.$inferSelect;
export type ManagementCompanyPricingInsert = typeof managementCompanyPricing.$inferInsert;
export type OrgPricingOverride = typeof orgPricingOverrides.$inferSelect;
export type OrgPricingOverrideInsert = typeof orgPricingOverrides.$inferInsert;
export type OrgSubscription = typeof orgSubscriptions.$inferSelect;
export type OrgSubscriptionInsert = typeof orgSubscriptions.$inferInsert;
export type ScreenUsageRecord = typeof screenUsageRecords.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceInsert = typeof invoices.$inferInsert;
