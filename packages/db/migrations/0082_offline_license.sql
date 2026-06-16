-- Add offline license certificate support to license_config
ALTER TABLE "license_config" ADD COLUMN "signed_cert" text;
ALTER TABLE "license_config" ADD COLUMN "license_mode" text DEFAULT 'online' NOT NULL;
ALTER TABLE "license_config" ADD COLUMN "cert_expires_at" timestamp with time zone;
