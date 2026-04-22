-- Playlist folders table
CREATE TABLE IF NOT EXISTS "playlist_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "parent_id" uuid,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "playlist_folders_workspace_id_idx" ON "playlist_folders" ("workspace_id");

-- Add folder and approval columns to playlists
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "folder_id" uuid REFERENCES "playlist_folders"("id") ON DELETE SET NULL;
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "approval_state" text NOT NULL DEFAULT 'approved';
