-- Device Rules: device-side condition trees evaluated by TV player devices.
-- These are separate from the server-side sensor trigger_rules (0049_sensors.sql).
--
-- A device_rule holds a recursive ConditionGroup tree (BLE beacon proximity,
-- time window, day-of-week, and nested AND/OR groups). The TV player evaluates
-- the tree locally on each BLE scan cycle and time tick, then executes the
-- configured action (currently: switch active playlist).
--
-- device_id NULL  → workspace-wide (applies to every device in the workspace)
-- device_id set   → device-specific override
-- priority        → higher wins when multiple rules match simultaneously

CREATE TABLE IF NOT EXISTS "device_rules" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "device_id"    uuid REFERENCES "devices"("id") ON DELETE CASCADE,
  "name"         text NOT NULL,
  "enabled"      boolean NOT NULL DEFAULT true,
  "conditions"   jsonb NOT NULL,
  "action"       jsonb NOT NULL,
  "priority"     integer NOT NULL DEFAULT 0,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "device_rules_workspace_id_idx" ON "device_rules" ("workspace_id");
CREATE INDEX IF NOT EXISTS "device_rules_device_id_idx"    ON "device_rules" ("device_id");
