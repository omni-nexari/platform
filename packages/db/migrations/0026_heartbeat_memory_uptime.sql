-- Add memory and device uptime columns to device_heartbeats
ALTER TABLE device_heartbeats
  ADD COLUMN IF NOT EXISTS memory_free_bytes bigint,
  ADD COLUMN IF NOT EXISTS memory_total_bytes bigint,
  ADD COLUMN IF NOT EXISTS device_uptime_sec integer;
