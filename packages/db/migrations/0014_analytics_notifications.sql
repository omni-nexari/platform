ALTER TABLE play_events
  ADD COLUMN IF NOT EXISTS playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_play_events_playlist ON play_events (playlist_id);
CREATE INDEX IF NOT EXISTS idx_play_events_schedule ON play_events (schedule_id);