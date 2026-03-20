-- Migration 0012: platform owners, management companies, and invite tables
-- Renames super_admins → platform_owners and builds the full management
-- company onboarding layer.

-- 1. Rename super_admins to platform_owners --------------------------------
ALTER TABLE super_admins RENAME TO platform_owners;

-- 2. Management companies (resellers / agencies) ---------------------------
CREATE TABLE management_companies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  billing_email       TEXT,
  suspended_at        TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_by_owner_id UUID REFERENCES platform_owners(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Management company admins (separate identity from org users) -----------
CREATE TABLE management_company_admins (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  management_company_id UUID NOT NULL REFERENCES management_companies(id),
  email                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL DEFAULT '',
  name                  TEXT,
  role                  TEXT NOT NULL DEFAULT 'admin', -- owner | admin | billing
  last_login            TIMESTAMPTZ,
  suspended_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Invite tokens for management company admins ---------------------------
CREATE TABLE management_company_admin_invitations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  management_company_id UUID NOT NULL REFERENCES management_companies(id),
  -- one of these will be set depending on who sent the invite
  invited_by_owner_id   UUID REFERENCES platform_owners(id),
  invited_by_admin_id   UUID REFERENCES management_company_admins(id),
  email                 TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'admin',
  token                 TEXT NOT NULL UNIQUE,
  expires_at            TIMESTAMPTZ NOT NULL,
  accepted_at           TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Add management company ownership columns to organisations --------------
ALTER TABLE organisations
  ADD COLUMN management_company_id       UUID REFERENCES management_companies(id),
  ADD COLUMN originating_admin_id        UUID REFERENCES management_company_admins(id),
  ADD COLUMN primary_account_manager_id  UUID REFERENCES management_company_admins(id),
  ADD COLUMN billing_owner_company_id    UUID REFERENCES management_companies(id),
  ADD COLUMN status                      TEXT NOT NULL DEFAULT 'active'; -- pending | active | suspended

-- 6. Invite tokens for client org owners -----------------------------------
CREATE TABLE client_org_owner_invitations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organisations(id),
  management_company_id UUID NOT NULL REFERENCES management_companies(id),
  invited_by_admin_id   UUID NOT NULL REFERENCES management_company_admins(id),
  email                 TEXT NOT NULL,
  token                 TEXT NOT NULL UNIQUE,
  expires_at            TIMESTAMPTZ NOT NULL,
  accepted_at           TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
