-- Phase 7: Outbound Webhooks

CREATE TABLE IF NOT EXISTS "outbound_webhooks" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "url"        text NOT NULL,
  "secret"     text NOT NULL,
  "events"     text[] NOT NULL DEFAULT '{}',
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outbound_webhooks_org_id_idx" ON "outbound_webhooks"("org_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id"      uuid NOT NULL REFERENCES "outbound_webhooks"("id") ON DELETE CASCADE,
  "event_type"      text NOT NULL,
  "payload"         jsonb NOT NULL,
  "status"          text NOT NULL DEFAULT 'pending',
  "response_status" integer,
  "response_body"   text,
  "attempt_count"   integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at"    timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx"     ON "webhook_deliveries"("status", "next_attempt_at")
  WHERE status IN ('pending', 'failed');
