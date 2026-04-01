CREATE TABLE "log_entries" (
  "id"          BIGSERIAL PRIMARY KEY,
  "source"      TEXT        NOT NULL,  -- 'api' | 'ds' | 'tizen' | 'tizen-sbb'
  "level"       TEXT        NOT NULL,  -- 'debug' | 'info' | 'warn' | 'error'
  "message"     TEXT        NOT NULL,
  "meta"        JSONB,
  "org_id"      UUID        REFERENCES "organisations"("id") ON DELETE CASCADE,
  "device_id"   UUID        REFERENCES "devices"("id") ON DELETE SET NULL,
  "user_id"     UUID        REFERENCES "users"("id") ON DELETE SET NULL,
  "app_version" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_log_entries_level_time"  ON "log_entries" ("level",     "created_at" DESC);
CREATE INDEX "idx_log_entries_source_time" ON "log_entries" ("source",    "created_at" DESC);
CREATE INDEX "idx_log_entries_device_time" ON "log_entries" ("device_id", "created_at" DESC) WHERE "device_id" IS NOT NULL;
CREATE INDEX "idx_log_entries_org_time"    ON "log_entries" ("org_id",    "created_at" DESC) WHERE "org_id"    IS NOT NULL;
