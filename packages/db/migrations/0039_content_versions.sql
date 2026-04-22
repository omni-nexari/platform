-- Content versioning: store previous file versions when content is replaced
CREATE TABLE IF NOT EXISTS "content_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_item_id" uuid NOT NULL REFERENCES "content_items"("id") ON DELETE CASCADE,
  "file_path" text NOT NULL,
  "thumbnail_path" text,
  "original_name" text,
  "mime_type" text,
  "file_size" bigint,
  "file_hash" text,
  "uploaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "content_versions_content_item_id_idx" ON "content_versions" ("content_item_id");
