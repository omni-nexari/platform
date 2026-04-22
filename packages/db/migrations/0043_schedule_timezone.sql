-- Phase 4-A: Timezone per schedule
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'UTC';

-- Phase 4-B: Fallback / default slot
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "default_playlist_id" uuid REFERENCES "playlists"("id") ON DELETE SET NULL;
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "default_content_id"  uuid REFERENCES "content_items"("id") ON DELETE SET NULL;
