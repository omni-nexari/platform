CREATE TABLE "org_license_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"management_company_id" uuid,
	"max_signage_screens" integer,
	"max_pos_screens" integer,
	"enabled_modules" text[],
	"notes" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_license_allocations_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "org_license_allocations" ADD CONSTRAINT "org_license_allocations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
