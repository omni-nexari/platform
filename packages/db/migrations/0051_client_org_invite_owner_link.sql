-- Migration 0051: Allow platform owners to send client org owner invitations
-- Previously invited_by_admin_id was NOT NULL and FK-constrained to
-- management_company_admins, meaning only management company admins could
-- create client org invitations. Platform owners also need this ability.
-- Pattern mirrors management_company_admin_invitations (one of two cols is set).

ALTER TABLE client_org_owner_invitations
  ADD COLUMN IF NOT EXISTS invited_by_owner_id UUID REFERENCES platform_owners(id);

ALTER TABLE client_org_owner_invitations
  ALTER COLUMN invited_by_admin_id DROP NOT NULL;
