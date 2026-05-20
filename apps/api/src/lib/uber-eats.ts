/**
 * Uber Eats API helper — OAuth, store provisioning, order operations, webhook
 * verification.
 *
 * Credentials (UBER_CLIENT_ID, UBER_CLIENT_SECRET) are platform-level env vars.
 * Per-workspace: only storeId is stored in posRestaurants.settings.uberEats.
 *
 * Two OAuth flows:
 *   1. authorization_code (scope: eats.pos_provisioning) — one-time per merchant
 *      to discover and provision their store.
 *   2. client_credentials (scopes: eats.store eats.order) — ongoing app token
 *      cached in Redis for order accept/deny/cancel.
 */
import crypto from 'node:crypto';
import { getRedis } from '../services/redis.js';
import { db, platformIntegrations } from '@signage/db';
import { eq } from 'drizzle-orm';
import { decryptSecret } from '../services/crypto.js';

// ── Uber API base URLs ────────────────────────────────────────────────────────
const UBER_AUTH_URL   = 'https://auth.uber.com/oauth/v2/token';
const UBER_API_BASE   = 'https://api.uber.com/v1/eats';
const UBER_MENU_BASE  = 'https://api.uber.com/v2/eats';
const REDIS_APP_TOKEN = 'uber_eats:app_token';
const REDIS_OAUTH_STATE_PREFIX   = 'uber_oauth:state:';
const REDIS_OAUTH_SESSION_PREFIX = 'uber_oauth:session:';

// ── Platform credential loader (DB-first, env var fallback) ─────────────────
let _credCache: { clientId: string; clientSecret: string } | null = null;
let _credCacheAt = 0;
const CRED_CACHE_TTL_MS = 60_000;

export async function getUberCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const now = Date.now();
  if (_credCache && now - _credCacheAt < CRED_CACHE_TTL_MS) return _credCache;

  const row = await db.query.platformIntegrations.findFirst({
    where: eq(platformIntegrations.type, 'uber_eats'),
  });

  const clientId     = row?.clientId     ?? process.env['UBER_CLIENT_ID']     ?? '';
  const clientSecret = row?.clientSecretEnc
    ? (decryptSecret(row.clientSecretEnc) ?? '')
    : (process.env['UBER_CLIENT_SECRET'] ?? '');

  if (!clientId || !clientSecret) {
    throw new Error('Uber Eats credentials not configured — set via superadmin or UBER_CLIENT_ID/UBER_CLIENT_SECRET env vars');
  }

  _credCache   = { clientId, clientSecret };
  _credCacheAt = now;
  return _credCache;
}

/** Bust the in-process credential cache (call after saving new credentials). */
export function bustUberCredCache(): void { _credCache = null; }

export function getUberRedirectUri(): string {
  const uri = process.env['UBER_REDIRECT_URI'];
  if (!uri) throw new Error('UBER_REDIRECT_URI env var not set');
  return uri;
}
/** Public API base URL — used to show the webhook URL to the merchant. */
export function getPublicApiUrl(): string {
  return process.env['PUBLIC_API_URL'] ?? '';
}

// ── Uber API response types ───────────────────────────────────────────────────
interface UberTokenResponse {
  access_token: string;
  token_type:   string;
  expires_in:   number;
  scope:        string;
}

export interface UberStore {
  store_id:          string;
  external_store_id: string | null;
  name:              string;
  location: {
    address:     string;
    city:        string;
    country:     string;
  };
}

// ── 1. Application token (client_credentials, cached) ────────────────────────

/**
 * Returns a cached application-level access token with scopes eats.store +
 * eats.order. Used for all ongoing order operations.
 * Falls back to a fresh token if Redis is unavailable.
 */
export async function getAppToken(): Promise<string> {
  const redis = getRedis();

  // Try the Redis cache first
  if (redis) {
    try {
      const cached = await redis.get(REDIS_APP_TOKEN);
      if (cached) return cached;
    } catch { /* fall through */ }
  }

  const token = await fetchClientCredentialsToken();

  if (redis) {
    try {
      // Cache with a 30s buffer before real expiry (tokens last 30 days)
      await redis.set(REDIS_APP_TOKEN, token.access_token, 'EX', token.expires_in - 30);
    } catch { /* non-fatal */ }
  }

  return token.access_token;
}

async function fetchClientCredentialsToken(): Promise<UberTokenResponse> {
  const { clientId, clientSecret } = await getUberCredentials();
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'client_credentials',
    scope:         'eats.store eats.order',
  });

  const res = await fetch(UBER_AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber token error ${res.status}: ${text}`);
  }
  return res.json() as Promise<UberTokenResponse>;
}

// ── 2. Authorization code flow ────────────────────────────────────────────────

/**
 * Build the Uber OAuth authorize URL for the given state token.
 * Stores {workspaceId, orgId} in Redis under `uber_oauth:state:<state>`.
 */
export async function buildAuthorizeUrl(
  state: string,
  context: { workspaceId: string; orgId: string; returnTo?: string; popup?: boolean },
): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis is required for the Uber OAuth flow');

  await redis.set(
    `${REDIS_OAUTH_STATE_PREFIX}${state}`,
    JSON.stringify(context),
    'EX',
    600, // 10 minutes
  );

  const { clientId } = await getUberCredentials();
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    scope:         'eats.pos_provisioning',
    redirect_uri:  getUberRedirectUri(),
    state,
  });

  return `https://auth.uber.com/oauth/v2/authorize?${params.toString()}`;
}

/**
 * Verify the state parameter from the OAuth callback. Returns the stored
 * context and deletes the state key. Returns null if state is unknown/expired.
 */
export async function consumeOAuthState(
  state: string,
): Promise<{ workspaceId: string; orgId: string; returnTo?: string; popup?: boolean } | null> {
  const redis = getRedis();
  if (!redis) return null;

  const key  = `${REDIS_OAUTH_STATE_PREFIX}${state}`;
  const json = await redis.get(key);
  if (!json) return null;
  await redis.del(key);
  return JSON.parse(json) as { workspaceId: string; orgId: string; returnTo?: string; popup?: boolean };
}

/**
 * Exchange an authorization code for a merchant access token.
 */
export async function exchangeCode(code: string): Promise<UberTokenResponse> {
  const { clientId, clientSecret } = await getUberCredentials();
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'authorization_code',
    redirect_uri:  getUberRedirectUri(),
    code,
  });

  const res = await fetch(UBER_AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber code exchange error ${res.status}: ${text}`);
  }
  return res.json() as Promise<UberTokenResponse>;
}

// ── 3. Temporary OAuth session (stores list + merchant token) ─────────────────

export interface OAuthSession {
  workspaceId:   string;
  orgId:         string;
  merchantToken: string;
  stores:        UberStore[];
}

export async function storeOAuthSession(
  sessionToken: string,
  session: OAuthSession,
): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis is required for the Uber OAuth flow');
  await redis.set(
    `${REDIS_OAUTH_SESSION_PREFIX}${sessionToken}`,
    JSON.stringify(session),
    'EX',
    900, // 15 minutes
  );
}

export async function getOAuthSession(
  sessionToken: string,
): Promise<OAuthSession | null> {
  const redis = getRedis();
  if (!redis) return null;
  const json = await redis.get(`${REDIS_OAUTH_SESSION_PREFIX}${sessionToken}`);
  return json ? (JSON.parse(json) as OAuthSession) : null;
}

export async function deleteOAuthSession(sessionToken: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`${REDIS_OAUTH_SESSION_PREFIX}${sessionToken}`);
}

// ── 4. Store discovery & provisioning ────────────────────────────────────────

/**
 * Retrieve all stores for the merchant who just authorized your app.
 * Uses the merchant's authorization_code access token.
 */
export async function getMerchantStores(merchantToken: string): Promise<UberStore[]> {
  const res = await fetch(`${UBER_API_BASE}/stores`, {
    headers: { Authorization: `Bearer ${merchantToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber GET /stores error ${res.status}: ${text}`);
  }
  const data = await res.json() as { stores?: UberStore[] };
  return data.stores ?? [];
}

/**
 * Provision our app against a specific store using the merchant's token.
 * After this call succeeds, client_credentials tokens can operate the store.
 *
 * @param merchantToken  authorization_code token with eats.pos_provisioning scope
 * @param storeId        Uber store UUID
 * @param integratorStoreId  our internal identifier for this store (workspaceId)
 */
export async function provisionStore(
  merchantToken: string,
  storeId: string,
  integratorStoreId: string,
): Promise<void> {
  const res = await fetch(`${UBER_API_BASE}/stores/${encodeURIComponent(storeId)}/pos_data`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${merchantToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      integrator_store_id:       integratorStoreId,
      is_order_manager:          true,
      require_manual_acceptance: false,
      webhooks_config: {
        webhooks_version: '1.0.0',
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber POST /pos_data error ${res.status}: ${text}`);
  }
}

/**
 * Permanently remove our app's access to a store.
 * Requires the merchant's eats.pos_provisioning token (NOT client_credentials).
 *
 * @param merchantToken  authorization_code token with eats.pos_provisioning scope
 * @param storeId        Uber store UUID
 */
export async function deprovisionStore(
  merchantToken: string,
  storeId: string,
): Promise<void> {
  const res = await fetch(`${UBER_API_BASE}/stores/${encodeURIComponent(storeId)}/pos_data`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${merchantToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Uber DELETE /pos_data error ${res.status}: ${text}`);
  }
}

// ── 5. Order operations ───────────────────────────────────────────────────────

export async function acceptOrder(
  appToken: string,
  uberOrderId: string,
): Promise<void> {
  const res = await fetch(
    `${UBER_API_BASE}/orders/${encodeURIComponent(uberOrderId)}/accept_pos_order`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${appToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber accept order error ${res.status}: ${text}`);
  }
}

export async function denyOrder(
  appToken: string,
  uberOrderId: string,
  reason: string = 'STORE_CLOSED',
): Promise<void> {
  const res = await fetch(
    `${UBER_API_BASE}/orders/${encodeURIComponent(uberOrderId)}/deny_pos_order`,
    {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${appToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber deny order error ${res.status}: ${text}`);
  }
}

// ── 6. Webhook signature verification ────────────────────────────────────────

/**
 * Verify the X-Uber-Signature header against the raw request body.
 * Uber signs with HMAC-SHA256 using the app's CLIENT_SECRET.
 * Returns true if the signature matches.
 */
export async function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
): Promise<boolean> {
  try {
    const { clientSecret } = await getUberCredentials();
    const body   = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    const digest = crypto
      .createHmac('sha256', clientSecret)
      .update(body)
      .digest('hex')
      .toLowerCase();
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signatureHeader.toLowerCase()),
    );
  } catch {
    return false;
  }
}

// ── 7. Menu API (v2) ──────────────────────────────────────────────────────────

/**
 * Upload (replace) the entire menu for a store.
 * Uses the app token (eats.store scope, client_credentials).
 * PUT /v2/eats/stores/{store_id}/menus → 204 No Content
 */
export async function uploadMenu(
  appToken: string,
  storeId: string,
  payload: unknown,
): Promise<void> {
  const res = await fetch(
    `${UBER_MENU_BASE}/stores/${encodeURIComponent(storeId)}/menus`,
    {
      method:  'PUT',
      headers: {
        Authorization:  `Bearer ${appToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber uploadMenu error ${res.status}: ${text}`);
  }
}

/**
 * Toggle availability of a single menu item on Uber.
 * available=false → suspends the item (sold out) until far-future timestamp.
 * available=true  → clears the suspension.
 * POST /v2/eats/stores/{store_id}/menus/items/{item_id} → 204 No Content
 */
export async function updateItemAvailability(
  appToken: string,
  storeId: string,
  itemId: string,
  available: boolean,
): Promise<void> {
  const body = {
    suspension_info: available
      ? { suspension: null }
      : { suspension: { suspend_until: 8640000000, reason: 'Sold out' } },
  };
  const res = await fetch(
    `${UBER_MENU_BASE}/stores/${encodeURIComponent(storeId)}/menus/items/${encodeURIComponent(itemId)}`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${appToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uber updateItemAvailability error ${res.status}: ${text}`);
  }
}
