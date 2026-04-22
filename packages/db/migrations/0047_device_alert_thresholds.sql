-- Phase 5-I: Per-device alert thresholds
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "alert_thresholds" jsonb;
