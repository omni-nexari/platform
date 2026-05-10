/**
 * Shared OAuth helpers used by Google + Microsoft calendar providers.
 * Stores tokens encrypted via services/crypto.ts.
 */
import { db, calendarConnections, type calendarConnections as _cc } from '@signage/db';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../crypto.js';

type ConnRow = typeof _cc.$inferSelect;

export interface OAuthProviderConfig {
  /** Token endpoint to call to refresh access tokens. */
  tokenEndpoint: string;
  /** Client ID env var name (e.g. GOOGLE_OAUTH_CLIENT_ID). */
  clientId: string;
  /** Client secret env var. */
  clientSecret: string;
}

/**
 * Ensures the connection has a non-expired access token.  Returns the
 * decrypted access token, refreshing if needed.  Persists the new token back
 * to the DB on refresh.
 *
 * Pass `force: true` to bypass the expiry check and always refresh.
 */
export async function ensureAccessToken(
  conn: ConnRow,
  cfg: OAuthProviderConfig,
  opts?: { force?: boolean },
): Promise<string> {
  const access = decryptSecret(conn.accessToken);
  const refresh = decryptSecret(conn.refreshToken);
  const exp = conn.tokenExpiresAt ? conn.tokenExpiresAt.getTime() : 0;
  const now = Date.now();

  // 60s safety window (skip if force-refresh requested)
  if (!opts?.force && access && exp > now + 60_000) return access;
  if (!refresh) {
    if (!access) {
      const msg = 'No tokens stored on this connection. Please reconnect.';
      await db.update(calendarConnections)
        .set({ status: 'error', lastErrorMessage: msg, updatedAt: new Date() })
        .where(eq(calendarConnections.id, conn.id));
      throw new Error(msg);
    }
    // No refresh token: if the access token is still valid return it; otherwise
    // the provider will reject it — mark as error so the user is prompted to reconnect.
    if (exp > 0 && exp <= now) {
      const msg = 'Access token has expired and no refresh token is available. Please reconnect.';
      await db.update(calendarConnections)
        .set({ status: 'error', lastErrorMessage: msg, updatedAt: new Date() })
        .where(eq(calendarConnections.id, conn.id));
      throw new Error(msg);
    }
    return access; // still valid — use it as-is
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const msg = `Token refresh failed: ${res.status} ${text.slice(0, 300)}`;
    await db.update(calendarConnections)
      .set({ status: 'error', lastErrorMessage: msg, updatedAt: new Date() })
      .where(eq(calendarConnections.id, conn.id));
    throw new Error(msg);
  }
  const json = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  const newExpires = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000)
    : new Date(Date.now() + 3600 * 1000);

  await db.update(calendarConnections).set({
    accessToken: encryptSecret(json.access_token),
    ...(json.refresh_token ? { refreshToken: encryptSecret(json.refresh_token) } : {}),
    tokenExpiresAt: newExpires,
    status: 'active',
    lastErrorMessage: null,
    updatedAt: new Date(),
  }).where(eq(calendarConnections.id, conn.id));

  return json.access_token;
}

/**
 * Build the public callback URL the OAuth provider should redirect to.
 * Backed by `API_PUBLIC_URL` (defaults to http://localhost:3000).
 */
export function callbackUrl(provider: 'google' | 'microsoft'): string {
  const base = process.env['API_PUBLIC_URL'] ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/v1/integrations/calendar/oauth/${provider}/callback`;
}
