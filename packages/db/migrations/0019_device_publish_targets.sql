ALTER TABLE devices
  ADD COLUMN published_content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  ADD COLUMN published_playlist_id uuid REFERENCES playlists(id) ON DELETE SET NULL,
  ADD COLUMN published_schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL;

ALTER TABLE devices
  ADD CONSTRAINT devices_single_publish_target_chk
  CHECK (
    (CASE WHEN published_content_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN published_playlist_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN published_schedule_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );