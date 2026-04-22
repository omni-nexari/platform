-- Phase 5-D: Device Config Templates
CREATE TABLE IF NOT EXISTS "device_config_templates" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "description" text,
  "config"      jsonb NOT NULL DEFAULT '{}',
  "created_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "device_config_templates_org_id_idx" ON "device_config_templates"("org_id");
