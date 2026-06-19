CREATE TABLE "email_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL DEFAULT 'resend',
  "resend_api_key_enc" text,
  "smtp_host" text,
  "smtp_port" integer DEFAULT 587,
  "smtp_secure" boolean NOT NULL DEFAULT true,
  "smtp_user" text,
  "smtp_password_enc" text,
  "from_admin" text,
  "from_mail" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
