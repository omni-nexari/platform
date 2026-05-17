-- Migration 0071: Workspace Rule Sets
-- Unified rule set system replacing device_rules (BLE/time/day rules) and
-- sensor trigger_rules (sensor-value based rules). Old tables are kept intact
-- for the data migration script below.

-- ── Enum ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "rule_set_target_type" AS ENUM ('device', 'group', 'workspace');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── workspace_rule_sets ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workspace_rule_sets" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"     uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "description"      text,
  "enabled"          boolean NOT NULL DEFAULT true,
  "priority"         integer NOT NULL DEFAULT 0,
  "conditions"       jsonb NOT NULL,
  "action"           jsonb NOT NULL,
  "cooldown_seconds" integer NOT NULL DEFAULT 0,
  "last_fired_at"    timestamptz,
  "fire_count"       integer NOT NULL DEFAULT 0,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_rule_sets_workspace_id_idx"
  ON "workspace_rule_sets" ("workspace_id");

-- ── rule_set_targets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rule_set_targets" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_set_id" uuid NOT NULL REFERENCES "workspace_rule_sets"("id") ON DELETE CASCADE,
  "target_type" rule_set_target_type NOT NULL,
  "target_id"   uuid NOT NULL,
  CONSTRAINT "rule_set_targets_uniq" UNIQUE ("rule_set_id", "target_type", "target_id")
);

CREATE INDEX IF NOT EXISTS "rule_set_targets_rule_set_id_idx" ON "rule_set_targets" ("rule_set_id");
CREATE INDEX IF NOT EXISTS "rule_set_targets_target_id_idx"   ON "rule_set_targets" ("target_id");

-- ── Migrate device_rules → workspace_rule_sets ────────────────────────────────
-- Each device_rule becomes a workspace_rule_set with either a device target
-- (if deviceId is set) or a workspace-wide target (if deviceId is null).
-- The ConditionGroup shape is identical so conditions can be copied as-is.
-- Action is re-wrapped to match the new RuleSetAction union shape.

INSERT INTO "workspace_rule_sets"
  ("id", "workspace_id", "name", "enabled", "priority", "conditions", "action",
   "cooldown_seconds", "created_at", "updated_at")
SELECT
  dr.id,
  dr.workspace_id,
  dr.name,
  dr.enabled,
  dr.priority,
  dr.conditions,
  dr.action,
  0,
  dr.created_at,
  dr.updated_at
FROM "device_rules" dr
ON CONFLICT ("id") DO NOTHING;

-- Targets: device-scoped rules → target_type='device'; workspace-wide → target_type='workspace'
INSERT INTO "rule_set_targets" ("rule_set_id", "target_type", "target_id")
SELECT
  dr.id,
  CASE WHEN dr.device_id IS NOT NULL THEN 'device'::rule_set_target_type
       ELSE 'workspace'::rule_set_target_type
  END,
  COALESCE(dr.device_id, dr.workspace_id)
FROM "device_rules" dr
ON CONFLICT DO NOTHING;

-- ── Migrate trigger_rules (sensor-based) → workspace_rule_sets ───────────────
-- The old trigger_rules use a flat conditions array with a different shape.
-- We wrap them in a single AND group and convert the action to the new union.
-- sensor_value conditions reference sensorId + field + operator + value.

INSERT INTO "workspace_rule_sets"
  ("workspace_id", "name", "enabled", "priority", "conditions", "action",
   "cooldown_seconds", "last_fired_at", "fire_count", "created_at", "updated_at")
SELECT
  tr.workspace_id,
  tr.name,
  tr.is_active,
  0,
  -- Wrap flat conditions array into a ConditionGroup tree.
  -- Each condition becomes a sensor_value leaf referencing the rule's sensorId.
  jsonb_build_object(
    'type', 'group',
    'logic', 'AND',
    'children', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'type',     'sensor_value',
          'sensorId', tr.sensor_id::text,
          'field',    COALESCE(c->>'field', 'value'),
          'operator', c->>'operator',
          'value',    (c->>'value')::numeric
        )
      )
      FROM jsonb_array_elements(tr.conditions) AS c
    )
  ),
  -- Re-wrap action into RuleSetAction shape.
  CASE
    WHEN tr.action_type = 'switch_playlist'  THEN jsonb_build_object('type', 'play_playlist', 'playlistId', tr.action_target_id::text)
    WHEN tr.action_type = 'switch_content'   THEN jsonb_build_object('type', 'play_content',  'contentId',  tr.action_target_id::text)
    WHEN tr.action_type = 'send_notification' THEN jsonb_build_object('type', 'send_notification', 'message',
      COALESCE(tr.action_payload->>'message', tr.name))
    ELSE jsonb_build_object('type', 'send_notification', 'message', tr.name)
  END,
  tr.cooldown_seconds,
  tr.last_fired_at,
  tr.fire_count,
  tr.created_at,
  tr.updated_at
FROM "trigger_rules" tr
WHERE tr.sensor_id IS NOT NULL
  AND jsonb_array_length(tr.conditions) > 0;

-- Targets for migrated trigger_rules: use deviceScope to set targets.
-- all → workspace-wide; device_id → specific device; device_tag is skipped (no clean mapping).
INSERT INTO "rule_set_targets" ("rule_set_id", "target_type", "target_id")
SELECT
  wrs.id,
  CASE WHEN tr.device_scope = 'device_id' THEN 'device'::rule_set_target_type
       ELSE 'workspace'::rule_set_target_type
  END,
  CASE WHEN tr.device_scope = 'device_id' THEN tr.device_scope_value::uuid
       ELSE tr.workspace_id
  END
FROM "trigger_rules" tr
JOIN "workspace_rule_sets" wrs ON wrs.name = tr.name AND wrs.workspace_id = tr.workspace_id
WHERE tr.sensor_id IS NOT NULL
  AND jsonb_array_length(tr.conditions) > 0
  AND (tr.device_scope != 'device_id' OR tr.device_scope_value IS NOT NULL)
ON CONFLICT DO NOTHING;
