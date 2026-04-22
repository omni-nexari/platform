-- Phase 4-C: Monthly and bi-weekly recurrence
ALTER TABLE "schedule_slots" ADD COLUMN IF NOT EXISTS "month_day"      integer;
ALTER TABLE "schedule_slots" ADD COLUMN IF NOT EXISTS "interval_weeks" integer NOT NULL DEFAULT 1;

-- Phase 4-D: Date range on recurrence
ALTER TABLE "schedule_slots" ADD COLUMN IF NOT EXISTS "recurrence_start_date" text;
ALTER TABLE "schedule_slots" ADD COLUMN IF NOT EXISTS "recurrence_end_date"   text;
