-- Create videowall_playlist_pages
CREATE TABLE "videowall_playlist_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "playlist_id" uuid NOT NULL REFERENCES "videowall_playlists"("id") ON DELETE CASCADE,
  "page_index" integer DEFAULT 0 NOT NULL,
  "name" text DEFAULT 'Page 1' NOT NULL,
  "duration_ms" integer DEFAULT 5000 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_page_per_playlist" UNIQUE ("playlist_id", "page_index")
);
--> statement-breakpoint

-- Add page_id to slots (nullable first, for the data migration below)
ALTER TABLE "videowall_playlist_slots" ADD COLUMN "page_id" uuid REFERENCES "videowall_playlist_pages"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Migrate existing data: create a default "Page 1" for every existing playlist
-- and point its existing slots at that page.
DO $$
DECLARE
  pl RECORD;
  new_page_id UUID;
BEGIN
  FOR pl IN SELECT id FROM videowall_playlists LOOP
    INSERT INTO videowall_playlist_pages (playlist_id, page_index, name, duration_ms)
    VALUES (pl.id, 0, 'Page 1', 5000)
    RETURNING id INTO new_page_id;

    UPDATE videowall_playlist_slots SET page_id = new_page_id WHERE playlist_id = pl.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- Now make page_id NOT NULL
ALTER TABLE "videowall_playlist_slots" ALTER COLUMN "page_id" SET NOT NULL;
--> statement-breakpoint

-- Drop old playlist-level unique constraint (auto-named by Postgres)
ALTER TABLE "videowall_playlist_slots"
  DROP CONSTRAINT IF EXISTS "videowall_playlist_slots_playlist_id_position_col_position_row_key";
--> statement-breakpoint

-- Add new page-level unique constraint
ALTER TABLE "videowall_playlist_slots"
  ADD CONSTRAINT "uniq_slot_per_page" UNIQUE ("page_id", "position_col", "position_row");
