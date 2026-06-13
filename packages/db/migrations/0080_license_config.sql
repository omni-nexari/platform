CREATE TABLE "license_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_key" text,
	"hmac_secret" text,
	"license_server_url" text,
	"last_status" text,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
