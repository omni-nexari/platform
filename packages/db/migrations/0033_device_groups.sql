-- Add manufacturer column to devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer text;

-- Device groups
CREATE TABLE IF NOT EXISTS device_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organisations(id),
  workspace_id      uuid REFERENCES workspaces(id),
  name              text NOT NULL,
  type              text NOT NULL DEFAULT 'location',
  description       text,
  video_wall_cols   integer,
  video_wall_rows   integer,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Device group members
CREATE TABLE IF NOT EXISTS device_group_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id     uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  position      integer,
  position_col  integer,
  position_row  integer,
  added_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_device_groups_org_id ON device_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_device_groups_workspace_id ON device_groups(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_group_members_unique ON device_group_members(group_id, device_id);
