-- Add URL Launcher address column polled from MDC every 5min
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS mdc_url_launcher_address text;
