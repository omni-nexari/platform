/**
 * Per-account login lockout (Step 15).
 *
 * Independent from fail2ban (which bans by IP). This locks credentials by
 * email-hash so an attacker can't bypass the limit by rotating IPs.
 *
 * Fail-open: when Redis is unavailable, all helpers are no-ops so login
 * continues to work as before.
 */

import { createHash } from 'node:crypto';
import { getRedis } from './redis.js';

const PREFIX = 'login-fail:';
const TTL_SECONDS = 15 * 60;     // 15 minutes
const MAX_ATTEMPTS = 10;          // lock after the 10th failure

function keyFor(email: string): string {
  // SHA-256 truncated to 32 hex chars — avoids storing raw email in Redis.
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  return `${PREFIX}${hash}`;
}

/**
 * Returns the current failure count for the email (0 when none, or Redis
 * is unavailable).
 */
export async function getLoginFailCount(email: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    const v = await r.get(keyFor(email));
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

/** True if `email` has reached the lockout threshold. */
export async function isLoginLocked(email: string): Promise<boolean> {
  return (await getLoginFailCount(email)) >= MAX_ATTEMPTS;
}

/**
 * Record a failed login. Returns the new attempt count.
 * Returns 0 silently when Redis is unavailable (fail-open).
 */
export async function recordLoginFailure(email: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const k = keyFor(email);
  try {
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, TTL_SECONDS);
    return n;
  } catch {
    return 0;
  }
}

/** Clear the failure counter on successful login. */
export async function clearLoginFailures(email: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(keyFor(email));
  } catch {
    /* ignore */
  }
}

export const LOGIN_LOCKOUT_THRESHOLD = MAX_ATTEMPTS;
export const LOGIN_LOCKOUT_TTL_SECONDS = TTL_SECONDS;
