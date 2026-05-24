import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

// ── Chat sessions (one per ongoing conversation per user) ────────────────────
export const aiChatSessions = pgTable(
  'ai_chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'), // auto-summarised first user message
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ai_chat_sessions_user').on(t.userId, t.workspaceId),
  ],
);

// ── Chat messages ────────────────────────────────────────────────────────────
export const aiChatMessages = pgTable(
  'ai_chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => aiChatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool'
    content: text('content').notNull().default(''),
    /** JSON: tool calls the assistant requested in this turn (Phase 3) */
    toolCalls: jsonb('tool_calls'),
    /** JSON: result of executing a tool call (when role = 'tool') */
    toolResult: jsonb('tool_result'),
    /** Token count (approx) for budgeting context windows */
    tokenCount: integer('token_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ai_chat_messages_session').on(t.sessionId, t.createdAt),
  ],
);

// ── User activity events (drives Phase 4 personalisation) ────────────────────
export const userActivityEvents = pgTable(
  'user_activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** page_view | playlist_created | schedule_created | content_uploaded | device_assigned | … */
    eventType: text('event_type').notNull(),
    /** Free-form JSON: { path?, entityId?, durationMs?, … } */
    eventData: jsonb('event_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_activity_user_type_time').on(t.userId, t.eventType, t.createdAt),
    index('idx_activity_ws_time').on(t.workspaceId, t.createdAt),
  ],
);

// ── Relations ────────────────────────────────────────────────────────────────
export const aiChatSessionsRelations = relations(aiChatSessions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [aiChatSessions.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [aiChatSessions.userId],
    references: [users.id],
  }),
  messages: many(aiChatMessages),
}));

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one }) => ({
  session: one(aiChatSessions, {
    fields: [aiChatMessages.sessionId],
    references: [aiChatSessions.id],
  }),
}));

export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type AiChatSessionInsert = typeof aiChatSessions.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type AiChatMessageInsert = typeof aiChatMessages.$inferInsert;
export type UserActivityEvent = typeof userActivityEvents.$inferSelect;
export type UserActivityEventInsert = typeof userActivityEvents.$inferInsert;
