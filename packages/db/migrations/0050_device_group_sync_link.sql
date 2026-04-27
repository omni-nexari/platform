-- Bridge device_groups → sync_groups so a "sync" type device group can own a SyncPlay session
ALTER TABLE device_groups
  ADD COLUMN IF NOT EXISTS sync_group_id uuid REFERENCES sync_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_device_groups_sync_group_id ON device_groups(sync_group_id);
