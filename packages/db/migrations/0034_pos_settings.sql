-- POS restaurant profile per workspace
CREATE TABLE IF NOT EXISTS pos_restaurants (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     uuid NOT NULL REFERENCES organisations(id),
  workspace_id               uuid NOT NULL REFERENCES workspaces(id),
  name                       text NOT NULL DEFAULT '',
  address                    text,
  phone                      text,
  email                      text,
  currency                   text NOT NULL DEFAULT 'USD',
  tax_rate_pct               integer NOT NULL DEFAULT 0,
  receipt_header             text,
  receipt_footer             text,
  business_hours             jsonb,
  loyalty_enabled            boolean NOT NULL DEFAULT false,
  loyalty_points_per_dollar  integer NOT NULL DEFAULT 1,
  loyalty_redemption_rate    integer NOT NULL DEFAULT 100,
  settings                   jsonb NOT NULL DEFAULT '{}',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_restaurants_workspace ON pos_restaurants(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_restaurants_workspace_unique ON pos_restaurants(workspace_id);

-- POS dining tables
CREATE TABLE IF NOT EXISTS pos_tables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  number       integer NOT NULL,
  name         text,
  seats        integer NOT NULL DEFAULT 4,
  location     text,
  status       text NOT NULL DEFAULT 'available',
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_tables_workspace ON pos_tables(workspace_id);

-- POS kiosk display config per workspace
CREATE TABLE IF NOT EXISTS pos_kiosk_config (
  workspace_id          uuid PRIMARY KEY REFERENCES workspaces(id),
  orientation           text NOT NULL DEFAULT 'portrait',
  welcome_message       text,
  idle_timeout_seconds  integer NOT NULL DEFAULT 60,
  logo_url              text,
  qr_ordering_enabled   boolean NOT NULL DEFAULT false,
  primary_color         text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
