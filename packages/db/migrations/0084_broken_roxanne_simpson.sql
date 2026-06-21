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
ALTER TABLE "firmware_release_approvals" ADD CONSTRAINT "firmware_release_approvals_release_id_firmware_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."firmware_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_firmware_release_approvals_release_company" ON "firmware_release_approvals" USING btree ("release_id","management_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_releases_model_version_unique" ON "firmware_releases" USING btree ("firmware_model","version");