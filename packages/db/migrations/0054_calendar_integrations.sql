-- Calendar integrations: Google / Microsoft Outlook / Apple iCloud (CalDAV) / ICS URL
--
-- Two new tables, both org-scoped via workspaces.org_id.  All credential columns
-- (access_token, refresh_token, ics_url, caldav_url, caldav_username,
-- caldav_app_password) store ENCRYPTED text — see apps/api/src/services/crypto.ts.

CREATE TABLE IF NOT EXISTS "calendar_connections" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"        uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id"             uuid REFERENCES "users"("id") ON DELETE CASCADE,
  -- NULL user_id = workspace-shared connection.
  --      user_id = personal connection owned by that user.

  "provider"            text NOT NULL,             -- 'google' | 'microsoft' | 'apple_caldav' | 'ics'
  "display_name"        text NOT NULL,
  "account_email"       text,

  -- OAuth credentials (Google + Microsoft).  Encrypted at rest.
  "access_token"        text,
  "refresh_token"       text,
  "token_expires_at"    timestamptz,
  "scopes"              text NOT NULL DEFAULT '',

  -- ICS URL provider
  "ics_url"             text,

  -- Apple iCloud CalDAV provider.  All encrypted.
  "caldav_url"          text,
  "caldav_username"     text,
  "caldav_app_password" text,

  -- Status tracking
  "status"              text NOT NULL DEFAULT 'active',  -- active | error | revoked
  "last_synced_at"      timestamptz,
  "last_error_message"  text,

  "deleted_at"          timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_calendar_connections_provider
    CHECK (provider IN ('google', 'microsoft', 'apple_caldav', 'ics')),
  CONSTRAINT chk_calendar_connections_status
    CHECK (status IN ('active', 'error', 'revoked'))
);

CREATE INDEX IF NOT EXISTS "calendar_connections_workspace_id_idx"
  ON "calendar_connections"("workspace_id");

CREATE INDEX IF NOT EXISTS "calendar_connections_workspace_user_idx"
  ON "calendar_connections"("workspace_id", "user_id");


-- Cached list of calendars exposed by each connection.  Refreshed on demand
-- via POST /integrations/calendar/connections/:id/sync-calendars and on
-- connection creation.
CREATE TABLE IF NOT EXISTS "calendar_connection_calendars" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id"        uuid NOT NULL REFERENCES "calendar_connections"("id") ON DELETE CASCADE,
  "external_calendar_id" text NOT NULL,
  "name"                 text NOT NULL,
  "color_hex"            text,
  "is_primary"           boolean NOT NULL DEFAULT false,
  "kind"                 text NOT NULL DEFAULT 'user',    -- 'user' | 'room' | 'equipment' | 'group'
  "capacity"             integer,
  "location_label"       text,
  "last_seen_at"         timestamptz NOT NULL DEFAULT now(),
  "created_at"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_calendar_connection_calendars_kind
    CHECK (kind IN ('user', 'room', 'equipment', 'group'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_calendar_connection_calendars_conn_extid"
  ON "calendar_connection_calendars"("connection_id", "external_calendar_id");
