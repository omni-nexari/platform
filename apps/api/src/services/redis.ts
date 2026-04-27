import Redis from 'ioredis';

let _client: Redis | null = null;

/**
 * Returns a shared ioredis client, or null if REDIS_URL is not configured.
 * All Redis-backed features degrade gracefully when Redis is unavailable.
 */
export function getRedis(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (!url) return null;
  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    _client.on('error', (err: Error) => {
      // Log but never throw — Redis is optional infrastructure
      console.error('[redis] Connection error:', err.message);
    });
  }
  return _client;
}

// ── Access-token revocation ───────────────────────────────────────────────────
// On logout we record the current timestamp per user. The authenticate decorator
// then rejects any access token whose `iat` (issued-at) is before this timestamp,
// covering the remaining 15-minute JWT window without per-token storage.

const LOGOUT_PREFIX = 'logout:';
const ACCESS_TOKEN_TTL_S = 15 * 60; // must match JWT sign expiresIn: '15m'

/**
 * Mark all access tokens for `userId` that were issued before now as revoked.
 * TTL matches the access token lifetime so the key self-cleans.
 */
export async function recordLogout(userId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`${LOGOUT_PREFIX}${userId}`, Date.now().toString(), 'EX', ACCESS_TOKEN_TTL_S);
  } catch {
    // Non-fatal — worst case the token remains valid for up to 15 min
  }
}

/**
 * Returns true if the access token (identified by its `iat` seconds timestamp)
 * belongs to a user who has logged out after the token was issued.
 * Always returns false if Redis is unavailable (fail-open).
 */
export async function isAccessTokenRevoked(userId: string, iatSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const stored = await redis.get(`${LOGOUT_PREFIX}${userId}`);
    if (!stored) return false;
    return iatSeconds * 1000 < Number(stored);
  } catch {
    return false; // fail-open: don't block auth if Redis is down
  }
}
