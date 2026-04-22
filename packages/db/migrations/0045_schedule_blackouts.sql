-- Phase 4-H: Holiday / blackout dates
CREATE TABLE IF NOT EXISTS "schedule_blackouts" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" uuid NOT NULL REFERENCES "schedules"("id") ON DELETE CASCADE,
  "date"        text NOT NULL,
  "label"       text,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "schedule_blackouts_schedule_id_idx" ON "schedule_blackouts"("schedule_id");
