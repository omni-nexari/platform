-- Cross-platform sync: relay mode, pinned leader, and videowall member priority.
--
-- syncGroups:       syncRelayMode ('lan'|'cloud'), pinnedLeaderId (device FK, nullable)
-- deviceGroups:     syncRelayMode ('lan'|'cloud'), pinnedLeaderId (device FK, nullable)
-- deviceGroupMembers: leaderPriority (0 = leader, higher = follower)

ALTER TABLE "sync_groups"
  ADD COLUMN IF NOT EXISTS "sync_relay_mode" text NOT NULL DEFAULT 'lan',
  ADD COLUMN IF NOT EXISTS "pinned_leader_id" uuid REFERENCES "devices"("id") ON DELETE SET NULL;

ALTER TABLE "device_groups"
  ADD COLUMN IF NOT EXISTS "sync_relay_mode" text NOT NULL DEFAULT 'lan',
  ADD COLUMN IF NOT EXISTS "pinned_leader_id" uuid REFERENCES "devices"("id") ON DELETE SET NULL;

ALTER TABLE "device_group_members"
  ADD COLUMN IF NOT EXISTS "leader_priority" integer NOT NULL DEFAULT 0;
