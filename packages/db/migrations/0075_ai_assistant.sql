-- ─────────────────────────────────────────────────────────────────────────────
-- 0075_ai_assistant.sql — AI chat assistant + activity tracking
-- ─────────────────────────────────────────────────────────────────────────────

-- AI chat sessions (one per ongoing conversation per user)
CREATE TABLE "ai_chat_sessions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title"         text,
  "archived_at"   timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_ai_chat_sessions_user"
  ON "ai_chat_sessions" ("user_id", "workspace_id");

-- AI chat messages
CREATE TABLE "ai_chat_messages" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id"   uuid NOT NULL REFERENCES "ai_chat_sessions"("id") ON DELETE CASCADE,
  "role"         text NOT NULL,            -- user | assistant | system | tool
  "content"      text NOT NULL DEFAULT '',
  "tool_calls"   jsonb,
  "tool_result"  jsonb,
  "token_count"  integer,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_ai_chat_messages_session"
  ON "ai_chat_messages" ("session_id", "created_at");

-- User activity events (drives Phase 4 personalisation)
CREATE TABLE "user_activity_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"  uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type"    text NOT NULL,
  "event_data"    jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_activity_user_type_time"
  ON "user_activity_events" ("user_id", "event_type", "created_at");

CREATE INDEX "idx_activity_ws_time"
  ON "user_activity_events" ("workspace_id", "created_at");

-- Audit flags: mark records created by the AI assistant
ALTER TABLE "playlists"
  ADD COLUMN IF NOT EXISTS "created_by_ai" boolean NOT NULL DEFAULT false;

ALTER TABLE "schedules"
  ADD COLUMN IF NOT EXISTS "created_by_ai" boolean NOT NULL DEFAULT false;
