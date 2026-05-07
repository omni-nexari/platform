-- E-Paper device support: classify device kind + panel + battery telemetry.
--
-- Push-first power profile: epaper devices keep network standby ON and surface
-- their power/display preferences via epaper_settings_json (rendered on the DS
-- device detail page). Pre-rendered image variants live under
-- signage_uploads/epaper/<deviceId>/.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'tv';
-- 'tv' (Samsung TV/SBB signage), 'epaper' (Samsung e-paper)

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "panel_w" integer;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "panel_h" integer;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "panel_orientation" text;
-- 'landscape' | 'portrait' — separate from existing screen_orientation which
-- tracks B2B/MDC desired orientation. panel_orientation is the runtime-detected
-- physical orientation reported by the player.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "battery_pct" integer;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_wake_reason" text;
-- 'scheduled' | 'push' | 'user' | 'boot' | 'unknown'

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "next_wake_at" timestamp with time zone;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "epaper_api_version" text;

-- Per-device e-paper preferences (see Docs/Plan/PROJECT_PLAN.md and the
-- "E-Paper Device Page" section). Keys:
--   preset, networkStandby, dailyRefreshAt, autoSleep, operatingHours, fitMode,
--   padColor, maxSwapRateSec, grayscale, jpegQuality, batteryWarnIcon,
--   lowBatteryThreshold, criticalBatteryAction, led, heartbeatSec,
--   preCacheLookahead, cacheLimitMb
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "epaper_settings" jsonb;

CREATE INDEX IF NOT EXISTS "idx_devices_kind" ON "devices" ("kind");
