CREATE TABLE "platform_integrations" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type"              text NOT NULL UNIQUE,
  "client_id"         text,
  "client_secret_enc" text,
  "enabled"           boolean NOT NULL DEFAULT true,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
