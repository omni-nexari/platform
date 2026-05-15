-- BLE Scan Results: stores results of on-demand BLE scans triggered from the
-- DS dashboard. The TV performs a ~10-second scan and posts results here.
-- Only the latest 5 rows per device are retained (API prunes on insert).

CREATE TABLE IF NOT EXISTS "ble_scan_results" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id"   uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "scanned_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "beacons"     jsonb NOT NULL
);

-- Descending index: latest scan per device is fast to fetch
CREATE INDEX IF NOT EXISTS "ble_scan_results_device_scanned_idx"
  ON "ble_scan_results" ("device_id", "scanned_at" DESC);
