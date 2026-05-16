-- Installed apps list reported by the player (Tizen application.info API).
-- Array of { id, name, version, iconPath } objects.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "installed_apps" jsonb;
