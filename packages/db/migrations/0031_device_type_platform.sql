-- Add device_type and platform columns to devices
-- device_type: signage | kiosk | kitchen  (what the device is used for)
-- platform:    tizen | tizen-sbb | browser | android | webos | linux

ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "device_type" text NOT NULL DEFAULT 'signage',
  ADD COLUMN IF NOT EXISTS "platform"    text NOT NULL DEFAULT 'tizen';
