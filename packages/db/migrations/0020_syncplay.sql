-- Migration 0020: SyncPlay — sync playlists, sync groups, device publish target
-- Run with: psql $DATABASE_URL -f 0020_syncplay.sql

-- ─── 1. Sync playlists ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sync_playlists" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "created_by"   UUID NOT NULL REFERENCES "users"("id"),
  "name"         TEXT NOT NULL,
  "deleted_at"   TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_sync_playlists_workspace"
  ON "sync_playlists"("workspace_id")
  WHERE "deleted_at" IS NULL;

-- ─── 2. Sync playlist items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sync_playlist_items" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sync_playlist_id" UUID NOT NULL REFERENCES "sync_playlists"("id") ON DELETE CASCADE,
  "content_id"       UUID REFERENCES "content_items"("id") ON DELETE SET NULL,
  "duration_seconds" INTEGER,       -- null = use content default
  "sort_order"       INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_sync_playlist_items_playlist"
  ON "sync_playlist_items"("sync_playlist_id", "sort_order");

-- ─── 3. Extend sync_groups (table already exists from migration 0008) ─────────
ALTER TABLE "sync_groups"
  ADD COLUMN IF NOT EXISTS "sync_playlist_id" UUID REFERENCES "sync_playlists"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "mode"             TEXT NOT NULL DEFAULT 'native-samsung',
  ADD COLUMN IF NOT EXISTS "deleted_at"       TIMESTAMPTZ;

-- ─── 4. Extend sync_group_members (table already exists from migration 0008) ──
ALTER TABLE "sync_group_members"
  ADD COLUMN IF NOT EXISTS "leader_priority" INTEGER NOT NULL DEFAULT 0;

-- ─── 5. Add published_sync_group_id to devices ───────────────────────────────
ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "published_sync_group_id" UUID REFERENCES "sync_groups"("id") ON DELETE SET NULL;

-- Update the single-publish-target check to include sync groups
ALTER TABLE "devices"
  DROP CONSTRAINT IF EXISTS "devices_single_publish_target_chk";

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_single_publish_target_chk"
  CHECK (
    (CASE WHEN published_content_id   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN published_playlist_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN published_schedule_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN published_sync_group_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );

-- ─── 6. Add sync target columns to schedule_slots ────────────────────────────
ALTER TABLE "schedule_slots"
  ADD COLUMN IF NOT EXISTS "sync_group_id"    UUID REFERENCES "sync_groups"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "sync_playlist_id" UUID REFERENCES "sync_playlists"("id") ON DELETE SET NULL;
