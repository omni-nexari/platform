-- Migration 0013: add logo_url to management_companies + default name for pending setup
ALTER TABLE management_companies ADD COLUMN logo_url TEXT;
ALTER TABLE management_companies ALTER COLUMN name SET DEFAULT '(pending setup)';
