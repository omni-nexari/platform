ALTER TABLE "org_invitations" ADD COLUMN "initial_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;