-- Add plan and allowed_modules columns to management_companies (SI/Reseller tier)
ALTER TABLE management_companies
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS allowed_modules text NOT NULL DEFAULT 'signage';
