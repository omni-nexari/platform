-- Phase 8: Sensor Integration + Trigger Rules

CREATE TABLE IF NOT EXISTS "sensor_sources" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"    uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name"            text NOT NULL,
  "type"            text NOT NULL DEFAULT 'webhook',
  "unit"            text,
  "config"          jsonb NOT NULL DEFAULT '{}',
  "api_key_id"      uuid REFERENCES "api_keys"("id") ON DELETE SET NULL,
  "last_reading_at" timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sensor_sources_workspace_id_idx" ON "sensor_sources"("workspace_id");

CREATE TABLE IF NOT EXISTS "sensor_readings" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sensor_id"   uuid NOT NULL REFERENCES "sensor_sources"("id") ON DELETE CASCADE,
  "value"       real NOT NULL,
  "unit"        text,
  "metadata"    jsonb,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sensor_readings_sensor_id_recorded_at_idx"
  ON "sensor_readings"("sensor_id", "recorded_at" DESC);

CREATE TABLE IF NOT EXISTS "trigger_rules" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"        uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "sensor_id"           uuid REFERENCES "sensor_sources"("id") ON DELETE CASCADE,
  "name"                text NOT NULL,
  "conditions"          jsonb NOT NULL DEFAULT '[]',
  "action_type"         text NOT NULL,
  "action_target_id"    uuid,
  "action_payload"      jsonb,
  "device_scope"        text NOT NULL DEFAULT 'all',
  "device_scope_value"  text,
  "cooldown_seconds"    integer NOT NULL DEFAULT 300,
  "is_active"           boolean NOT NULL DEFAULT true,
  "last_fired_at"       timestamptz,
  "fire_count"          integer NOT NULL DEFAULT 0,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "trigger_rules_workspace_id_idx" ON "trigger_rules"("workspace_id");
CREATE INDEX IF NOT EXISTS "trigger_rules_sensor_id_idx"    ON "trigger_rules"("sensor_id");
