-- 0077_pos_phase2.sql — POS Phase 2: allergens, nutrition info, menu schedules

-- ── posItems: allergen declarations (free-form string[], Canadian SFCR + custom) ──
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "allergens" jsonb DEFAULT '[]'::jsonb;

-- ── posItems: optional per-serving nutrition info ──
ALTER TABLE "pos_items" ADD COLUMN IF NOT EXISTS "nutrition_info" jsonb;

-- ── posMenuSchedules: day-part / time-of-day menu switching ──
CREATE TABLE IF NOT EXISTS "pos_menu_schedules" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "menu_id"      uuid NOT NULL REFERENCES "pos_menus"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "label"        text NOT NULL,
  "day_of_week"  jsonb DEFAULT NULL,
  "start_time"   time NOT NULL,
  "end_time"     time NOT NULL,
  "is_active"    boolean NOT NULL DEFAULT true,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_pos_menu_schedules_workspace" ON "pos_menu_schedules"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_pos_menu_schedules_menu"      ON "pos_menu_schedules"("menu_id");
