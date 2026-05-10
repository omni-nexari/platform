-- Windows Player support: extend devices + player_releases for cross-platform Electron player.

-- ── devices: Windows-specific identity / OS introspection ────────────────────
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "os_version" text;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "cpu_model" text;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "gpu_model" text;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "display_count" integer;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "primary_display_index" integer;
-- OS-level controls (separate from MDC, which only applies to Samsung Tizen TVs)
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "system_volume" integer;       -- 0-100
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "system_muted" boolean;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "system_brightness" integer;   -- 0-100 (DDC/CI)
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "windows_build" text;

-- ── player_releases: per-platform release channel ────────────────────────────
ALTER TABLE "player_releases" ADD COLUMN IF NOT EXISTS "platform" text NOT NULL DEFAULT 'tizen';
ALTER TABLE "player_releases" ADD COLUMN IF NOT EXISTS "manifest_url" text;   -- electron-updater latest.yml location
ALTER TABLE "player_releases" ADD COLUMN IF NOT EXISTS "sha512" text;          -- installer hash (for electron-updater)
ALTER TABLE "player_releases" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;

-- Drop the old version-only unique constraint and replace with (platform, version) so each
-- platform can independently version. Tizen rows keep the default 'tizen' platform.
DO $$ BEGIN
  ALTER TABLE "player_releases" DROP CONSTRAINT "player_releases_version_unique";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "player_releases_platform_version_unique"
  ON "player_releases" ("platform", "version");

-- isLatest must now be unique per platform, not globally.
CREATE UNIQUE INDEX IF NOT EXISTS "player_releases_one_latest_per_platform"
  ON "player_releases" ("platform") WHERE "is_latest" = true;
