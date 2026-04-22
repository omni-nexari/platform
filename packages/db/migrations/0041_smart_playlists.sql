-- Add smart playlist support to playlists
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "is_smart_playlist" boolean NOT NULL DEFAULT false;
ALTER TABLE "playlists" ADD COLUMN IF NOT EXISTS "smart_filters" text;
