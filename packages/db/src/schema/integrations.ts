import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';
import { users } from './users.js';

/**
 * Calendar integrations:
 *   - google         OAuth 2.0
 *   - microsoft      OAuth 2.0 (Microsoft Graph)
 *   - apple_caldav   Basic auth (Apple ID + app-specific password) over CalDAV
 *   - ics            unauthenticated polling of an .ics URL
 *
 * userId NULL  = workspace-shared connection (any member can use it)
 * userId set   = personal connection (visible only to that user)
 *
 * All credential columns are encrypted at rest — see services/crypto.ts.
 */
export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(), // 'google' | 'microsoft' | 'apple_caldav' | 'ics'
    displayName: text('display_name').notNull(),
    accountEmail: text('account_email'),

    accessToken: text('access_token'),       // encrypted
    refreshToken: text('refresh_token'),     // encrypted
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').notNull().default(''),

    icsUrl: text('ics_url'),                 // encrypted

    caldavUrl: text('caldav_url'),           // encrypted
    caldavUsername: text('caldav_username'), // encrypted
    caldavAppPassword: text('caldav_app_password'), // encrypted

    status: text('status').notNull().default('active'), // 'active' | 'error' | 'revoked'
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastErrorMessage: text('last_error_message'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('calendar_connections_workspace_id_idx').on(t.workspaceId),
    index('calendar_connections_workspace_user_idx').on(t.workspaceId, t.userId),
  ],
);

export const calendarConnectionCalendars = pgTable(
  'calendar_connection_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    externalCalendarId: text('external_calendar_id').notNull(),
    name: text('name').notNull(),
    colorHex: text('color_hex'),
    isPrimary: boolean('is_primary').notNull().default(false),
    kind: text('kind').notNull().default('user'), // 'user' | 'room' | 'equipment' | 'group'
    capacity: integer('capacity'),
    locationLabel: text('location_label'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_calendar_connection_calendars_conn_extid')
      .on(t.connectionId, t.externalCalendarId),
  ],
);

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [calendarConnections.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [calendarConnections.userId],
    references: [users.id],
  }),
  calendars: many(calendarConnectionCalendars),
}));

export const calendarConnectionCalendarsRelations = relations(
  calendarConnectionCalendars,
  ({ one }) => ({
    connection: one(calendarConnections, {
      fields: [calendarConnectionCalendars.connectionId],
      references: [calendarConnections.id],
    }),
  }),
);

// ── Platform-level OAuth app credentials ──────────────────────────────────────
// One row per integration type (e.g. 'uber_eats', 'google_calendar', 'microsoft_calendar').
// clientSecretEnc is AES-256-GCM encrypted via services/crypto.ts encryptSecret().
// clientId is stored plaintext — it is not sensitive.
export const platformIntegrations = pgTable('platform_integrations', {
  id:              uuid('id').primaryKey().defaultRandom(),
  type:            text('type').notNull().unique(), // 'uber_eats' | 'google_calendar' | 'microsoft_calendar'
  clientId:        text('client_id'),
  clientSecretEnc: text('client_secret_enc'),       // encrypted via encryptSecret()
  enabled:         boolean('enabled').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
