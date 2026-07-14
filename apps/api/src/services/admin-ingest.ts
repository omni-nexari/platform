/**
 * Admin ingest client — forwards support ticket events to the Nexari admin
 * portal (admin.nexari.ca) so the Nexari team can review them.
 *
 * Uses the same HMAC-SHA256 authentication as the license heartbeat.
 * All calls are fire-and-forget; failures are logged but never surfaced to
 * end users.
 */
import { createHmac } from 'node:crypto';
import { db, licenseConfig } from '@signage/db';

// ── Types ────────────────────────────────────────────────────────────────────

interface TicketCreatedPayload {
  type:             'ticket_created';
  instanceUrl?:     string;
  licenseKey:       string;
  timestamp:        number;
  signature:        string;
  ticket: {
    platformTicketId:  string;
    partyType:         string;
    partyName?:        string;
    submittedByName:   string;
    submittedByEmail:  string;
    category:          string;
    subject:           string;
    priority:          string;
    message?:          string;
    platformMessageId?: string;
  };
}

interface MessageAddedPayload {
  type:             'message_added';
  instanceUrl?:     string;
  licenseKey:       string;
  timestamp:        number;
  signature:        string;
  platformTicketId: string;
  message: {
    platformMessageId?: string;
    senderType:         string;
    senderName:         string;
    body:               string;
    attachmentUrls?:    string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getLicenseCredentials(): Promise<{
  licenseKey: string;
  secret: string;
  serverUrl: string;
} | null> {
  // Prefer DB config (set via setup wizard / superadmin UI)
  const dbConfig = await db.query.licenseConfig.findFirst({
    columns: {
      licenseKey: true,
      hmacSecret: true,
      licenseServerUrl: true,
    },
  }).catch(() => null);

  const licenseKey   = dbConfig?.licenseKey     ?? process.env['LICENSE_KEY']        ?? null;
  const hmacSecret   = dbConfig?.hmacSecret      ?? process.env['LICENSE_SECRET']     ?? null;
  const licenseServerUrl = dbConfig?.licenseServerUrl ?? process.env['LICENSE_SERVER_URL'] ?? null;

  if (!licenseKey || !hmacSecret || !licenseServerUrl) return null;

  return { licenseKey, secret: hmacSecret, serverUrl: licenseServerUrl };
}

function sign(licenseKey: string, secret: string): { timestamp: number; signature: string } {
  const timestamp = Date.now();
  const signature = createHmac('sha256', secret)
    .update(`${licenseKey}.${timestamp}`, 'utf8')
    .digest('hex');
  return { timestamp, signature };
}

async function postIngest(
  serverUrl: string,
  payload: TicketCreatedPayload | MessageAddedPayload,
): Promise<void> {
  const url = `${serverUrl.replace(/\/+$/, '')}/support/ingest`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`admin ingest responded ${res.status}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Forward a newly-created support ticket to the Nexari admin portal.
 * Fire-and-forget — caller should not await if it doesn't want to block.
 */
export async function ingestTicketCreated(params: {
  platformTicketId:  string;
  partyType:         string;
  partyName?:        string;
  submittedByName:   string;
  submittedByEmail:  string;
  category:          string;
  subject:           string;
  priority:          string;
  message?:          string;
  platformMessageId?: string;
}): Promise<void> {
  const creds = await getLicenseCredentials();
  if (!creds) return; // not licensed — skip silently

  const { timestamp, signature } = sign(creds.licenseKey, creds.secret);
  const instanceUrl = (process.env['APP_URL'] ?? '').replace(/\/$/, '') || undefined;

  await postIngest(creds.serverUrl, {
    type:        'ticket_created',
    licenseKey:  creds.licenseKey,
    timestamp,
    signature,
    ...(instanceUrl ? { instanceUrl } : {}),
    ticket: { ...params },
  });
}

/**
 * Forward a new message on an existing ticket to the Nexari admin portal.
 * Fire-and-forget.
 */
export async function ingestMessageAdded(params: {
  platformTicketId:   string;
  platformMessageId?: string;
  senderType:         string;
  senderName:         string;
  body:               string;
  attachmentUrls?:    string[];
}): Promise<void> {
  const creds = await getLicenseCredentials();
  if (!creds) return;

  const { timestamp, signature } = sign(creds.licenseKey, creds.secret);
  const instanceUrl = (process.env['APP_URL'] ?? '').replace(/\/$/, '') || undefined;

  await postIngest(creds.serverUrl, {
    type:             'message_added',
    licenseKey:       creds.licenseKey,
    timestamp,
    signature,
    instanceUrl,
    platformTicketId: params.platformTicketId,
    message: {
      ...(params.platformMessageId != null ? { platformMessageId: params.platformMessageId } : {}),
      senderType:        params.senderType,
      senderName:        params.senderName,
      body:              params.body,
      ...(params.attachmentUrls != null ? { attachmentUrls: params.attachmentUrls } : {}),
    },
  });
}
