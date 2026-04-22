-- Add file_hash column to content_items for duplicate detection
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "file_hash" text;
CREATE INDEX IF NOT EXISTS "content_items_file_hash_idx" ON "content_items" ("file_hash");
