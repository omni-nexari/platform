-- 0077_billing_system.sql
-- Multi-tier billing system: pricing plans, subscriptions, invoices, screen metering.
-- Supports two billing flows:
--   Direct:   Nexari bills org via Stripe (metered, multi-currency)
--   Reseller: Nexari invoices SI at wholesale; SI handles client billing
-- Trial: Nexari-managed 60-day / 3-screen default, extensible by superadmin or SI.

-- -----------------------------------------------------------------------
-- management_companies: billing model + Stripe customer + default commission
-- -----------------------------------------------------------------------
ALTER TABLE "management_companies"
  ADD COLUMN IF NOT EXISTS "billing_model" text NOT NULL DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text,
  ADD COLUMN IF NOT EXISTS "default_commission_pct" numeric(5,2);

-- -----------------------------------------------------------------------
-- Master plan definitions
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pricing_plans" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_key"         text        NOT NULL UNIQUE,
  "name"             text        NOT NULL,
  "module"           text        NOT NULL,          -- signage | pos | both
  "screens_included" integer     NOT NULL DEFAULT 1,
  "billing_period"   text        NOT NULL DEFAULT 'monthly', -- monthly | annual
  "is_public"        boolean     NOT NULL DEFAULT true,
  "is_active"        boolean     NOT NULL DEFAULT true,
  "sort_order"       integer     NOT NULL DEFAULT 0,
  "description"      text,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- Per-currency prices  (one row per plan × currency)
-- All monetary values in minor units (cents, pence, etc.)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pricing_plan_prices" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"                     uuid        NOT NULL REFERENCES "pricing_plans"("id"),
  "currency"                    text        NOT NULL,
  "amount_cents"                integer     NOT NULL,
  "extra_screen_cents"          integer     NOT NULL DEFAULT 0,
  "stripe_price_id"             text,
  "stripe_extra_screen_price_id" text,
  "is_active"                   boolean     NOT NULL DEFAULT true,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("plan_id", "currency")
);

-- -----------------------------------------------------------------------
-- Per-SI pricing config (wholesale rates + markup cap + commission)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "management_company_pricing" (
  "id"                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "management_company_id" uuid          NOT NULL REFERENCES "management_companies"("id"),
  "plan_id"               uuid          NOT NULL REFERENCES "pricing_plans"("id"),
  "currency"              text          NOT NULL,
  "wholesale_cents"       integer,                   -- reseller: what SI pays Nexari
  "max_markup_pct"        numeric(5,2),               -- cap on SI retail price above master
  "commission_pct"        numeric(5,2),               -- direct: % Nexari pays SI
  "created_by_owner_id"   uuid,
  "created_at"            timestamptz   NOT NULL DEFAULT now(),
  "updated_at"            timestamptz   NOT NULL DEFAULT now(),
  UNIQUE ("management_company_id", "plan_id", "currency")
);

-- -----------------------------------------------------------------------
-- Per-org pricing overrides (grandfathered / negotiated / promo)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "org_pricing_overrides" (
  "id"               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid          NOT NULL REFERENCES "organisations"("id"),
  "plan_id"          uuid          NOT NULL REFERENCES "pricing_plans"("id"),
  "currency"         text          NOT NULL,
  "override_cents"   integer       NOT NULL,
  "reason"           text,
  "expires_at"       timestamptz,
  "created_by_type"  text          NOT NULL,          -- owner | management_company_admin
  "created_by_id"    uuid          NOT NULL,
  "created_at"       timestamptz   NOT NULL DEFAULT now(),
  "updated_at"       timestamptz   NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- Subscriptions (one active record per org)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "org_subscriptions" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                    uuid        NOT NULL REFERENCES "organisations"("id"),
  "plan_id"                   uuid        NOT NULL REFERENCES "pricing_plans"("id"),
  "currency"                  text        NOT NULL DEFAULT 'CAD',
  "status"                    text        NOT NULL DEFAULT 'trialing',  -- trialing | active | past_due | canceled | paused
  "billing_model"             text        NOT NULL DEFAULT 'direct',    -- direct | reseller
  -- Trial (Nexari-managed: default 60 days, 3 screens; extensible per-org)
  "trial_ends_at"             timestamptz,
  "trial_screen_limit"        integer     NOT NULL DEFAULT 3,
  "trial_extended_by_type"    text,                                     -- owner | management_company_admin
  "trial_extended_by_id"      uuid,
  -- Stripe (direct billing model)
  "stripe_customer_id"        text,
  "stripe_subscription_id"    text,
  "stripe_subscription_item_id" text,                                   -- for metered usage records
  -- Billing period
  "current_period_start"      timestamptz,
  "current_period_end"        timestamptz,
  "canceled_at"               timestamptz,
  "cancel_at_period_end"      boolean     NOT NULL DEFAULT false,
  -- Reseller linkage
  "managed_by_company_id"     uuid,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- Screen usage records (Stripe real-time metered reporting + internal audit)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "screen_usage_records" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid        NOT NULL REFERENCES "organisations"("id"),
  "subscription_id"       uuid        NOT NULL REFERENCES "org_subscriptions"("id"),
  "screen_count"          integer     NOT NULL,
  "reported_at"           timestamptz NOT NULL DEFAULT now(),
  "stripe_usage_record_id" text,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- Invoices
-- Used for both direct-billed orgs (mirrors Stripe invoice) and wholesale
-- invoices sent to SIs in the reseller model.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoices" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid        NOT NULL REFERENCES "organisations"("id"),
  "subscription_id"       uuid        REFERENCES "org_subscriptions"("id"),
  "management_company_id" uuid,
  "currency"              text        NOT NULL DEFAULT 'CAD',
  "amount_cents"          integer     NOT NULL,
  "tax_cents"             integer     NOT NULL DEFAULT 0,
  "total_cents"           integer     NOT NULL,
  "status"                text        NOT NULL DEFAULT 'draft', -- draft | open | paid | void | uncollectible
  "invoice_number"        text,
  "due_at"                timestamptz,
  "paid_at"               timestamptz,
  "stripe_invoice_id"     text,
  "line_items"            text        NOT NULL DEFAULT '[]',    -- JSON
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- Seed: default pricing plans (CAD)
-- These mirror Docs/PRICING.md; superadmin can edit prices in the portal.
-- Annual prices = monthly × 10 (2 months free, ~16% off)
-- -----------------------------------------------------------------------
INSERT INTO "pricing_plans"
  ("plan_key", "name", "module", "screens_included", "billing_period", "sort_order")
VALUES
  ('basic',             'Basic',              'signage', 1, 'monthly', 10),
  ('pro',               'Pro',                'signage', 1, 'monthly', 20),
  ('menu_board',        'Menu Board',         'pos',     3, 'monthly', 30),
  ('bundle_basic_menu', 'Menu Board + Basic', 'both',    3, 'monthly', 40),
  ('bundle_pro_menu',   'Menu Board + Pro',   'both',    3, 'monthly', 50),
  ('basic_annual',      'Basic (Annual)',     'signage', 1, 'annual',  15),
  ('pro_annual',        'Pro (Annual)',       'signage', 1, 'annual',  25)
ON CONFLICT ("plan_key") DO NOTHING;

INSERT INTO "pricing_plan_prices" ("plan_id", "currency", "amount_cents", "extra_screen_cents")
SELECT p.id, v.currency, v.amount_cents, v.extra_screen_cents
FROM "pricing_plans" p
JOIN (VALUES
  -- plan_key,           currency,  amount_cents, extra_screen_cents
  ('basic',             'CAD',      1200,          1200),
  ('pro',               'CAD',      1700,          1700),
  ('menu_board',        'CAD',      4900,          1000),
  ('bundle_basic_menu', 'CAD',      5900,          1200),
  ('bundle_pro_menu',   'CAD',      6900,          1700),
  ('basic_annual',      'CAD',      10000,         10000),
  ('pro_annual',        'CAD',      14200,         14200),
  -- USD (≈ CAD × 0.74, rounded to nearest 50c)
  ('basic',             'USD',       900,           900),
  ('pro',               'USD',      1250,          1250),
  ('menu_board',        'USD',      3600,           750),
  ('bundle_basic_menu', 'USD',      4350,           900),
  ('bundle_pro_menu',   'USD',      5100,          1250),
  ('basic_annual',      'USD',       7500,          7500),
  ('pro_annual',        'USD',      10500,         10500)
) AS v(plan_key, currency, amount_cents, extra_screen_cents)
  ON p.plan_key = v.plan_key
ON CONFLICT ("plan_id", "currency") DO NOTHING;
