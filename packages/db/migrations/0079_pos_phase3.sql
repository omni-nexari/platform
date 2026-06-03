-- Phase 3: bilingual menu items + inventory auto-hide

ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "name_i18n"          jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "description_i18n"   jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "inventory_count"    integer;
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "auto_hide_when_empty" boolean NOT NULL DEFAULT false;
