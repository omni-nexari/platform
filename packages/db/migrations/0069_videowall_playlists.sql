CREATE TABLE IF NOT EXISTS "videowall_playlists" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "group_id" uuid REFERENCES "device_groups"("id") ON DELETE SET NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "videowall_playlist_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playlist_id" uuid NOT NULL REFERENCES "videowall_playlists"("id") ON DELETE CASCADE,
  "position_col" integer NOT NULL,
  "position_row" integer NOT NULL,
  "content_id" uuid REFERENCES "content_items"("id") ON DELETE SET NULL,
  "object_fit" text DEFAULT 'cover' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("playlist_id", "position_col", "position_row")
);
