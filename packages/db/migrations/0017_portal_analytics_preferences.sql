CREATE TABLE IF NOT EXISTS portal_analytics_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_analytics_preferences_actor_idx
  ON portal_analytics_preferences (actor_type, actor_id);

CREATE TABLE IF NOT EXISTS portal_analytics_drilldown_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  name text NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  view text NOT NULL,
  search_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_analytics_drilldown_presets_actor_idx
  ON portal_analytics_drilldown_presets (actor_type, actor_id);

CREATE TABLE IF NOT EXISTS portal_analytics_alert_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  alert_key text NOT NULL,
  fingerprint text NOT NULL,
  last_triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_analytics_alert_states_actor_alert_idx
  ON portal_analytics_alert_states (actor_type, actor_id, alert_key);

CREATE TABLE IF NOT EXISTS platform_admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_admin_notifications_actor_created_idx
  ON platform_admin_notifications (actor_type, actor_id, created_at DESC);