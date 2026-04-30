-- SyncPlay Phase 4: server-side observability columns.
-- Group-level: manifest version, aggregate state, current item index.
-- Member-level: last-seen IP (LAN), drift, playback-rate snapshot, ready state, last report time.

ALTER TABLE sync_groups
  ADD COLUMN IF NOT EXISTS manifest_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS current_item_index integer NOT NULL DEFAULT 0;

ALTER TABLE sync_group_members
  ADD COLUMN IF NOT EXISTS last_seen_ip text,
  ADD COLUMN IF NOT EXISTS drift_ms integer,
  ADD COLUMN IF NOT EXISTS playback_rate_x1000 integer,
  ADD COLUMN IF NOT EXISTS ready_state text NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS last_report_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sync_group_members_last_report_at
  ON sync_group_members(sync_group_id, last_report_at DESC);
