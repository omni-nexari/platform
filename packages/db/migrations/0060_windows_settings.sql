-- Per-device Windows player settings (auto-launch, daily reboot, kiosk PIN,
-- rotation, proxy, asset cache, etc.). Stored as a single JSONB blob so we
-- can grow the shape without further migrations.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "windows_settings" jsonb;
