-- Add indexes on sync_groups for common lookup patterns
CREATE INDEX IF NOT EXISTS idx_sync_groups_workspace_id ON sync_groups (workspace_id);
CREATE INDEX IF NOT EXISTS idx_sync_groups_org_id ON sync_groups (org_id);
