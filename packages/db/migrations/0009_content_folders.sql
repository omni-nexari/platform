CREATE TABLE IF NOT EXISTS "content_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "content_folders"
		ADD CONSTRAINT "content_folders_workspace_id_workspaces_id_fk"
		FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
	ALTER TABLE "content_folders"
		ADD CONSTRAINT "content_folders_parent_id_content_folders_id_fk"
		FOREIGN KEY ("parent_id") REFERENCES "public"."content_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "content_items"
	ADD COLUMN IF NOT EXISTS "folder_id" uuid;

DO $$ BEGIN
	ALTER TABLE "content_items"
		ADD CONSTRAINT "content_items_folder_id_content_folders_id_fk"
		FOREIGN KEY ("folder_id") REFERENCES "public"."content_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;