-- Add index on devices.platform for efficient tizen-consumer queries.
-- The platform column is already text (added in 0031); no ALTER needed.
-- This migration also documents that 'tizen-consumer' is a valid platform value
-- (consumer Samsung Smart TVs running Nexri-tv player, package nexariottv).

CREATE INDEX IF NOT EXISTS "devices_platform_idx" ON "devices" ("platform");
