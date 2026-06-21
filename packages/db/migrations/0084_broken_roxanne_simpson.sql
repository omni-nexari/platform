CREATE TABLE "firmware_release_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"management_company_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "firmware_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firmware_model" text NOT NULL,
	"version" text NOT NULL,
	"sw_version_string" text NOT NULL,
	"file_name" text NOT NULL,
	"download_url" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"release_notes" text,
	"is_latest" boolean DEFAULT false NOT NULL,
	"superadmin_approved_at" timestamp with time zone,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"resend_api_key_enc" text,
	"smtp_host" text,
	"smtp_port" integer DEFAULT 587,
	"smtp_secure" boolean DEFAULT true NOT NULL,
	"smtp_user" text,
	"smtp_password_enc" text,
	"from_admin" text,
	"from_mail" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "license_config" ADD COLUMN "signed_cert" text;--> statement-breakpoint
ALTER TABLE "license_config" ADD COLUMN "license_mode" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "license_config" ADD COLUMN "cert_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "firmware_release_approvals" ADD CONSTRAINT "firmware_release_approvals_release_id_firmware_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."firmware_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_firmware_release_approvals_release_company" ON "firmware_release_approvals" USING btree ("release_id","management_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_releases_model_version_unique" ON "firmware_releases" USING btree ("firmware_model","version");--> statement-breakpoint
CREATE UNIQUE INDEX "player_releases_platform_version_unique" ON "player_releases" USING btree ("platform","version");