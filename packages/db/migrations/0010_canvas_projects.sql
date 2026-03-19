-- Canvas Projects table
CREATE TABLE IF NOT EXISTS "canvas_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scene_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "canvas_projects"
	ADD CONSTRAINT "canvas_projects_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "canvas_projects"
	ADD CONSTRAINT "canvas_projects_content_item_id_content_items_id_fk"
	FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "canvas_projects"
	ADD CONSTRAINT "canvas_projects_created_by_users_id_fk"
	FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
