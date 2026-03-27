-- Migration 0021: Widen sync_groups.group_id from SMALLINT to INTEGER
-- SMALLINT is signed (-32768..32767) but CRC-16 produces 0..65535 (unsigned),
-- causing "integer out of range" errors for values > 32767.

ALTER TABLE "sync_groups"
  ALTER COLUMN "group_id" TYPE INTEGER;
