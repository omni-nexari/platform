-- 0076_pos_item_86.sql — POS Phase 1: Item "86" reason + timestamp
-- Adds an optional reason and a "since" timestamp recorded when an item is
-- marked unavailable (sold out / 86'd). Both nullable — no data backfill needed.

ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "unavailable_reason" text;
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "unavailable_since" timestamptz;
