import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// License config — single-row table storing the Nexari license credentials
// for this platform install. Managed via the management portal UI.
// The hmacSecret is stored encrypted-at-rest using AES-256-GCM (same key as
// TOKEN_ENCRYPTION_KEY). The licenseKey is stored plaintext (not a secret —
// it only identifies the install, not authenticates it).
// ---------------------------------------------------------------------------
export const licenseConfig = pgTable('license_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  licenseKey: text('license_key'),          // NXR-XXXX-XXXX-XXXX-XXXX
  hmacSecret: text('hmac_secret'),          // AES-256-GCM encrypted via encryptSecret
  licenseServerUrl: text('license_server_url'),  // https://admin.nexari.chiho.app

  // Last known status received from the license server
  lastStatus: text('last_status'),          // ok | grace | overlimit | suspended | revoked
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastError: text('last_error'),            // last error message if heartbeat failed

  isEnabled: boolean('is_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LicenseConfig = typeof licenseConfig.$inferSelect;
export type LicenseConfigInsert = typeof licenseConfig.$inferInsert;
