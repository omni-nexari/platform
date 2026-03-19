CREATE TABLE "tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_tag_id_workspace_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."workspace_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_assignments" ADD CONSTRAINT "tag_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_assignment_unique" ON "tag_assignments" USING btree ("tag_id","entity_id");--> statement-breakpoint
CREATE INDEX "idx_tag_assignments_tag" ON "tag_assignments" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_tag_assignments_ws_entity" ON "tag_assignments" USING btree ("workspace_id","entity_type");