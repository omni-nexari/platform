-- Kitchen display configuration table
CREATE TABLE IF NOT EXISTS "pos_kitchen_config" (
  "workspace_id"       uuid        PRIMARY KEY REFERENCES "workspaces"("id"),
  "column_count"       integer     NOT NULL DEFAULT 3,
  "sound_enabled"      boolean     NOT NULL DEFAULT true,
  "alert_interval_sec" integer     NOT NULL DEFAULT 30,
  "theme"              text        NOT NULL DEFAULT 'dark',
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
