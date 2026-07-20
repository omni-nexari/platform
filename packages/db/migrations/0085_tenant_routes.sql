CREATE TABLE "tenant_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" text NOT NULL,
	"path_prefix" text DEFAULT '' NOT NULL,
	"route_type" text DEFAULT 'client_org' NOT NULL,
	"management_company_id" uuid NOT NULL,
	"organization_id" uuid,
	"workspace_id" uuid,
	"status" text DEFAULT 'pending_dns' NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"tls_status" text DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_routes" ADD CONSTRAINT "tenant_routes_management_company_id_management_companies_id_fk" FOREIGN KEY ("management_company_id") REFERENCES "public"."management_companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_routes" ADD CONSTRAINT "tenant_routes_organization_id_organisations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_routes" ADD CONSTRAINT "tenant_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_routes_hostname_path_active" ON "tenant_routes" USING btree ("hostname","path_prefix") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "idx_tenant_routes_company" ON "tenant_routes" USING btree ("management_company_id");
--> statement-breakpoint
CREATE INDEX "idx_tenant_routes_org" ON "tenant_routes" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_tenant_routes_workspace" ON "tenant_routes" USING btree ("workspace_id");