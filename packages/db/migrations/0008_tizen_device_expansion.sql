-- Migration 0008: Tizen LFD device expansion
-- Run with: psql $DATABASE_URL -f 0008_tizen_device_expansion.sql

-- ─── 1. Devices: Tizen hardware identity + telemetry ─────────────────────────
ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "duid"                    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "model_name"              TEXT,
  ADD COLUMN IF NOT EXISTS "model_code"              TEXT,
  ADD COLUMN IF NOT EXISTS "serial_number"           TEXT,
  ADD COLUMN IF NOT EXISTS "mac_address"             TEXT,
  ADD COLUMN IF NOT EXISTS "connection_type"         TEXT,
  ADD COLUMN IF NOT EXISTS "wifi_ssid"               TEXT,
  ADD COLUMN IF NOT EXISTS "wifi_strength"           INTEGER,
  ADD COLUMN IF NOT EXISTS "screen_orientation"      TEXT,
  ADD COLUMN IF NOT EXISTS "power_state"             TEXT NOT NULL DEFAULT 'on',
  ADD COLUMN IF NOT EXISTS "ir_lock"                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "button_lock"             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "auto_power_on"           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "ntp_enabled"             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "ntp_server"              TEXT,
  ADD COLUMN IF NOT EXISTS "ntp_timezone"            TEXT,
  ADD COLUMN IF NOT EXISTS "clock_drift_ms"          INTEGER,
  ADD COLUMN IF NOT EXISTS "latitude"                DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude"               DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "location_label"          TEXT,
  ADD COLUMN IF NOT EXISTS "zones"                   JSONB,
  ADD COLUMN IF NOT EXISTS "screenshot_interval_min" INTEGER,
  ADD COLUMN IF NOT EXISTS "default_playlist_id"     UUID REFERENCES "playlists"("id") ON DELETE SET NULL;

-- ─── 2. Workspaces: workspace-wide default fallback playlist ──────────────────
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "default_playlist_id" UUID REFERENCES "playlists"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "logo_url"            TEXT;

-- ─── 3. Device screenshots: content tracking + trigger type ──────────────────
ALTER TABLE "device_screenshots"
  ADD COLUMN IF NOT EXISTS "content_id" UUID REFERENCES "content_items"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "trigger"    TEXT;

-- ─── 4. Device heartbeats ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "device_heartbeats" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_id"           UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "player_version"      TEXT,
  "firmware_version"    TEXT,
  "power_state"         TEXT,
  "clock_drift_ms"      INTEGER,
  "ir_lock"             BOOLEAN,
  "button_lock"         BOOLEAN,
  "cpu_load"            REAL,
  "storage_free_bytes"  BIGINT,
  "temperature_c"       REAL,
  "current_content_id"  UUID REFERENCES "content_items"("id") ON DELETE SET NULL,
  "next_content_id"     UUID REFERENCES "content_items"("id") ON DELETE SET NULL,
  "next_starts_at"      TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_device_heartbeats_device_time"
  ON "device_heartbeats"("device_id", "created_at" DESC);

-- ─── 5. Play events (proof-of-play) — partitioned by started_at ───────────────
CREATE TABLE IF NOT EXISTS "play_events" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "device_id"      UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "content_id"     UUID REFERENCES "content_items"("id") ON DELETE SET NULL,
  "zone_id"        TEXT,
  "started_at"     TIMESTAMPTZ NOT NULL,
  "ended_at"       TIMESTAMPTZ NOT NULL,
  "duration_ms"    BIGINT NOT NULL,
  "completed_full" BOOLEAN NOT NULL DEFAULT TRUE,
  "source"         TEXT NOT NULL DEFAULT 'schedule',
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id", "started_at")
) PARTITION BY RANGE ("started_at");

CREATE INDEX IF NOT EXISTS "idx_play_events_device"  ON "play_events"("device_id");
CREATE INDEX IF NOT EXISTS "idx_play_events_content" ON "play_events"("content_id");
CREATE INDEX IF NOT EXISTS "idx_play_events_started" ON "play_events"("started_at" DESC);

-- Create 13 monthly partitions (March 2026 → March 2027)
CREATE TABLE IF NOT EXISTS "play_events_2026_03" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_04" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_05" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_06" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_07" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_08" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_09" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_10" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_11" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS "play_events_2026_12" PARTITION OF "play_events"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS "play_events_2027_01" PARTITION OF "play_events"
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS "play_events_2027_02" PARTITION OF "play_events"
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS "play_events_2027_03" PARTITION OF "play_events"
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

-- ─── 6. Sync groups (VideoWall — Phase 3) — created now for schema completeness
CREATE TABLE IF NOT EXISTS "sync_groups" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "group_id"     SMALLINT NOT NULL,
  "layout"       JSONB,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "sync_group_members" (
  "sync_group_id" UUID NOT NULL REFERENCES "sync_groups"("id") ON DELETE CASCADE,
  "device_id"     UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "tile_col"      SMALLINT NOT NULL DEFAULT 0,
  "tile_row"      SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("sync_group_id", "device_id")
);
