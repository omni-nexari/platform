-- Add shuffle mode to playlists and weight to playlist_items
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "shuffle" boolean NOT NULL DEFAULT false;
ALTER TABLE "playlist_items" ADD COLUMN IF NOT EXISTS "weight" integer NOT NULL DEFAULT 1;
