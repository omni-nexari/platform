import { pgTable, uuid, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Email config — single-row table for platform-level email delivery settings.
// Managed via the management portal (Settings → Email).
//
// provider:
//   'resend'   — Resend cloud API (default, backward-compat with env vars)
//   'smtp'     — Custom SMTP (Gmail, Office 365, or any SMTP server)
//   'disabled' — Email sending is disabled; operations that send email are no-ops
//
// Secrets (resendApiKeyEnc, smtpPasswordEnc) are AES-256-GCM encrypted using
// the TOKEN_ENCRYPTION_KEY env var — same as the HMAC secret in licenseConfig.
//
// Env-var fallback: if no row exists, the email service falls back to
// RESEND_API_KEY / RESEND_FROM_ADMIN / RESEND_FROM_MAIL env vars so existing
// deployments continue working without any migration action.
// ---------------------------------------------------------------------------
export const emailConfig = pgTable('email_config', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Which transport to use
  provider: text('provider').notNull().default('resend'),

  // Resend (cloud)
  resendApiKeyEnc: text('resend_api_key_enc'), // AES-256-GCM encrypted

  // SMTP
  smtpHost:        text('smtp_host'),
  smtpPort:        integer('smtp_port').default(587),
  smtpSecure:      boolean('smtp_secure').notNull().default(true),
  smtpUser:        text('smtp_user'),
  smtpPasswordEnc: text('smtp_password_enc'), // AES-256-GCM encrypted

  // From addresses (shared by both transports)
  fromAdmin: text('from_admin'), // platform-level emails (invites, onboarding)
  fromMail:  text('from_mail'),  // user-level emails (password reset, org invites)

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailConfig       = typeof emailConfig.$inferSelect;
export type EmailConfigInsert = typeof emailConfig.$inferInsert;
