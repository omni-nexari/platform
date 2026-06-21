/**
 * License client — handles BOTH online (HMAC heartbeat) and offline (.lic cert) modes.
 *
 * Online mode (default):
 *   Phones home to admin.nexari.ca every ~15 minutes. Requires internet.
 *   Enforcement state is cached in Redis for 24h.
 *
 * Offline mode:
 *   Verifies a signed Ed25519 JWT (.lic file) locally — no network ever needed.
 *   Cert payload contains all entitlements + expiry baked in and cryptographically signed.
 *
 * Both modes:
 *   Enforcement state is loaded on boot and kept in memory.
 *   The same gate functions (canUseSyncPlay, isOverScreenLimit, etc.) work for both.
 */
import { createHmac } from 'node:crypto';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, ne, count } from 'drizzle-orm';
import { db, devices, organizations, posMenus, licenseConfig, logEntries, platformOwners } from '@signage/db';
import { getRedis } from './redis.js';
import { decryptSecret } from './crypto.js';
import { NEXARI_LICENSE_PUBLIC_KEYS } from '@signage/shared';

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const CACHE_KEY = 'license:last-status';
const CACHE_TTL_S = 24 * 60 * 60; // 24h

export type LicenseStatus =
  | 'ok'
  | 'trial'
  | 'grace'
  | 'overlimit'
  | 'suspended'
  | 'revoked';

export interface LicenseState {
  status: LicenseStatus;
  /** 'signage' | 'pos' | 'both'. When null/undefined, defaults to 'signage'. */
  allowedModules: string;
  /** 'basic' | 'pro' | null. Null means no tier restriction (e.g. Nexari-owned keys). */
  signageTier: string | null;
  maxScreens: number | null;
  /** Max POS locations. null = unlimited. */
  maxLocations: number | null;
  /** Screens included per POS location (default 3). */
  posScreensPerLocation: number;
  gracePct: number;
  /** Trial config from the license server (used for initial trial enforcement). */
  trialDays: number;
  trialMaxScreens: number;
  /** ISO string of when this license expires. null = perpetual. */
  expiresAt: string | null;
  /** 'monthly' | 'annual' | null */
  billingPeriod: string | null;
  /** Plan type label e.g. 'signage-pro', 'bundle-basic' */
  planType: string | null;
  /** Wholesale billing rates from the license server (populated via heartbeat) */
  billingCurrency: string | null;
  wholesaleCentsPerSignageScreen: number | null;
  wholesaleCentsPerPosScreen: number | null;
  billingAnchorDay: number | null;
  /** Source of this state */
  source: 'heartbeat' | 'offline-cert' | 'cache' | 'trial';
  checkedAt: string;
}

// ── Offline cert payload shape ───────────────────────────────────────────────
interface OfflineCertPayload {
  kid: string;
  licenseKey: string;
  planType: string;
  modules: string;
  signageTier: string | null;
  maxSignageScreens: number | null;
  maxLocations: number | null;
  posScreensPerLocation: number;
  features: string[];
  billingPeriod: string;
  issuedAt: number;   // unix seconds
  expiresAt: number;  // unix seconds
  graceDays: number;
  partnerName: string | null;
  instanceUrl: string | null;
}

// ── Trial boot timestamp ─────────────────────────────────────────────────────
const TRIAL_START_KEY = 'license:trial-start';
const TRIAL_DAYS_DEFAULT = 60;
const TRIAL_MAX_SCREENS_DEFAULT = 3;

let cachedState: LicenseState | null = null;
/** Computed trial state — used when no heartbeat/cert license is configured. */
let trialCachedState: LicenseState | null = null;
let lastHeartbeatAt: Date = new Date(Date.now() - HEARTBEAT_INTERVAL_MS * 2);

/**
 * Current effective license state.
 * Returns the heartbeat / offline-cert state when configured;
 * falls back to the computed trial state otherwise.
 */
export function getLicenseState(): LicenseState | null {
  return cachedState ?? trialCachedState;
}

/**
 * Returns the HMAC secret used to sign heartbeats (and to sign/verify OAuth
 * proxy state tokens). Reads from DB first, falls back to LICENSE_SECRET env.
 * Returns null if no license is configured (self-hosted without nexari-admin).
 */
export async function getLicenseHmacSecret(): Promise<{ licenseKey: string; hmacSecret: string; serverUrl: string } | null> {
  const dbConfig = await db.query.licenseConfig.findFirst();
  if (dbConfig?.isEnabled && dbConfig.licenseKey && dbConfig.hmacSecret && dbConfig.licenseServerUrl) {
    const hmacSecret = decryptSecret(dbConfig.hmacSecret);
    if (hmacSecret) {
      return { licenseKey: dbConfig.licenseKey, hmacSecret, serverUrl: dbConfig.licenseServerUrl };
    }
  }
  const licenseKey = process.env['LICENSE_KEY'] ?? null;
  const hmacSecret = process.env['LICENSE_SECRET'] ?? null;
  const serverUrl = process.env['LICENSE_SERVER_URL'] ?? null;
  if (licenseKey && hmacSecret && serverUrl) {
    return { licenseKey, hmacSecret, serverUrl };
  }
  return null;
}

/** True when new device pairing should be blocked (suspended, expired trial, or revoked). */
export function isPairingBlocked(): boolean {
  const s = getLicenseState()?.status;
  return s === 'suspended' || s === 'revoked';
}

/** True when the whole instance should be locked out (license revoked). */
export function isInstanceLocked(): boolean {
  return getLicenseState()?.status === 'revoked';
}

// ── Feature gates ─────────────────────────────────────────────────────────────

/** Signage module — false when license is POS-only, expired trial, or revoked. */
export function canUseSignage(): boolean {
  const state = getLicenseState();
  if (!state) return true; // shouldn't happen after boot
  const s = state.status;
  if (s === 'suspended' || s === 'revoked') return false;
  return state.allowedModules !== 'pos';
}

/** SyncPlay and synchronized multi-screen playback — requires Pro tier signage license. */
export function canUseSyncPlay(): boolean {
  const state = getLicenseState();
  if (!state) return false;
  const s = state.status;
  if (s === 'suspended' || s === 'revoked' || s === 'trial') return false;
  if (state.allowedModules === 'pos') return false;
  const tier = state.signageTier;
  return tier === 'pro' || tier === null;
}

/** Video wall grid mapping — requires Pro tier. */
export function canUseVideoWalls(): boolean {
  return canUseSyncPlay();
}

/** Multi-tenant: creating more than one organisation — requires Pro tier. */
export function canUseMultiTenant(): boolean {
  return canUseSyncPlay();
}

/** POS/menu board features — requires 'pos' or 'both' module. */
export function canUsePOS(): boolean {
  const state = getLicenseState();
  if (!state) return false;
  const s = state.status;
  if (s === 'suspended' || s === 'revoked' || s === 'trial') return false;
  const m = state.allowedModules;
  return m === 'pos' || m === 'both';
}

/** Whether the current signage screen count would exceed license limits. */
export function isOverScreenLimit(currentScreens: number): boolean {
  const state = getLicenseState();
  if (!state) return currentScreens >= TRIAL_MAX_SCREENS_DEFAULT;
  if (state.maxScreens == null) return false;
  const limit = Math.floor(state.maxScreens * (1 + (state.gracePct ?? 0) / 100));
  return currentScreens >= limit;
}

/** Whether the current POS location count would exceed license limits. */
export function isOverLocationLimit(currentLocations: number): boolean {
  const state = getLicenseState();
  if (!state) return true; // no license = trial = POS not available
  if (state.maxLocations == null) return false;
  return currentLocations >= state.maxLocations;
}

/** Whether extra POS screens at a location exceed the per-location allowance. */
export function isOverExtraPosScreenLimit(totalScreensAtLocation: number): boolean {
  const state = getLicenseState();
  if (!state) return true;
  const included = state.posScreensPerLocation ?? 3;
  return totalScreensAtLocation > included;
}

/** Human-readable tier name for error messages. */
export function getLicenseTierLabel(): string {
  const state = getLicenseState();
  if (!state || state.source === 'trial') return 'trial';
  const tier = state.signageTier;
  if (tier === 'pro') return 'Pro';
  if (tier === 'basic') return 'Basic';
  return 'your current plan';
}

// ── Offline cert verification ────────────────────────────────────────────────

/**
 * Verify and parse an offline .lic JWT.
 * Returns a LicenseState if valid, throws if signature invalid or cert expired past grace.
 */
export function verifyOfflineCert(jwt: string): LicenseState {
  const parts = jwt.trim().split('.');
  if (parts.length !== 3) throw new Error('Invalid cert format: expected 3 parts');

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Decode header to get kid
  let header: { alg: string; kid: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  } catch {
    throw new Error('Invalid cert header');
  }
  if (header.alg !== 'EdDSA') throw new Error(`Unsupported algorithm: ${header.alg}`);

  const publicKeyPem = NEXARI_LICENSE_PUBLIC_KEYS[header.kid];
  if (!publicKeyPem) throw new Error(`Unknown key id: ${header.kid}`);

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = Buffer.from(sigB64, 'base64url');
  const publicKey = createPublicKey(publicKeyPem);
  const valid = cryptoVerify(null, Buffer.from(signingInput), publicKey, sig);
  if (!valid) throw new Error('Certificate signature is invalid — cert may be tampered');

  // Decode payload
  let payload: OfflineCertPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as OfflineCertPayload;
  } catch {
    throw new Error('Invalid cert payload');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const graceSec = (payload.graceDays ?? 30) * 24 * 3600;

  // Determine status
  let status: LicenseStatus = 'ok';
  if (nowSec > payload.expiresAt + graceSec) {
    status = 'revoked'; // past grace — hard block
  } else if (nowSec > payload.expiresAt) {
    status = 'grace'; // expired but within grace — warn, still functional
  }

  return {
    status,
    allowedModules: payload.modules,
    signageTier: payload.signageTier,
    maxScreens: payload.maxSignageScreens,
    maxLocations: payload.maxLocations,
    posScreensPerLocation: payload.posScreensPerLocation ?? 3,
    gracePct: 10, // offline certs don't carry gracePct (they use graceDays for expiry only)
    trialDays: 0,
    trialMaxScreens: 0,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    billingPeriod: payload.billingPeriod,
    planType: payload.planType,
    billingCurrency: null,
    wholesaleCentsPerSignageScreen: null,
    wholesaleCentsPerPosScreen: null,
    billingAnchorDay: null,
    source: 'offline-cert',
    checkedAt: new Date().toISOString(),
  };
}

// ── Usage collection ─────────────────────────────────────────────────────────

async function collectUsage(): Promise<{
  activeScreens: number;
  signageScreens: number;
  posScreens: number;
  totalOrgs: number;
  usesSignage: boolean;
  usesPos: boolean;
}> {
  const [signageRow] = await db
    .select({ c: count() })
    .from(devices)
    .where(
      and(
        isNull(devices.deletedAt),
        ne(devices.status, 'unclaimed'),
        eq(devices.type, 'signage'),
      ),
    );

  const [posRow] = await db
    .select({ c: count() })
    .from(devices)
    .where(
      and(
        isNull(devices.deletedAt),
        ne(devices.status, 'unclaimed'),
        eq(devices.type, 'kiosk'),
      ),
    );

  const [orgRow] = await db
    .select({ c: count() })
    .from(organizations)
    .where(isNull(organizations.deletedAt));

  const [posMenuRow] = await db
    .select({ c: count() })
    .from(posMenus)
    .where(isNull(posMenus.deletedAt));

  const signageScreens = Number(signageRow?.c ?? 0);
  const posScreens = Number(posRow?.c ?? 0);

  return {
    activeScreens: signageScreens + posScreens,
    signageScreens,
    posScreens,
    totalOrgs: Number(orgRow?.c ?? 0),
    usesSignage: signageScreens > 0,
    usesPos: Number(posMenuRow?.c ?? 0) > 0,
  };
}

async function collectRecentLogs(since: Date): Promise<Array<{
  level: 'error' | 'warn';
  source: string;
  message: string;
  meta?: Record<string, unknown>;
  appVersion?: string;
  loggedAt: number;
}>> {
  try {
    const rows = await db
      .select({
        level: logEntries.level,
        source: logEntries.source,
        message: logEntries.message,
        meta: logEntries.meta,
        appVersion: logEntries.appVersion,
        createdAt: logEntries.createdAt,
      })
      .from(logEntries)
      .where(
        and(
          gte(logEntries.createdAt, since),
          inArray(logEntries.level, ['error', 'warn']),
        ),
      )
      .orderBy(desc(logEntries.createdAt))
      .limit(100);

    return rows.map((r) => ({
      level: r.level as 'error' | 'warn',
      source: r.source.slice(0, 50),
      message: r.message.slice(0, 2000),
      ...(r.meta ? { meta: r.meta as Record<string, unknown> } : {}),
      ...(r.appVersion ? { appVersion: r.appVersion.slice(0, 50) } : {}),
      loggedAt: r.createdAt.getTime(),
    }));
  } catch {
    return [];
  }
}

// ── Heartbeat (online mode) ───────────────────────────────────────────────────

async function sendHeartbeat(): Promise<void> {
  let licenseKey: string | null = null;
  let secret: string | null = null;
  let serverUrl: string | null = null;
  let dbRowId: string | null = null;

  const dbConfig = await db.query.licenseConfig.findFirst();
  if (dbConfig?.isEnabled && dbConfig.licenseKey && dbConfig.hmacSecret && dbConfig.licenseServerUrl) {
    licenseKey = dbConfig.licenseKey;
    secret = decryptSecret(dbConfig.hmacSecret);
    serverUrl = dbConfig.licenseServerUrl;
    dbRowId = dbConfig.id;
  } else {
    licenseKey = process.env['LICENSE_KEY'] ?? null;
    secret = process.env['LICENSE_SECRET'] ?? null;
    serverUrl = process.env['LICENSE_SERVER_URL'] ?? null;
  }

  if (!licenseKey || !secret || !serverUrl) return;

  const timestamp = Date.now();
  const signature = createHmac('sha256', secret)
    .update(`${licenseKey}.${timestamp}`, 'utf8')
    .digest('hex');

  const usage = await collectUsage();
  const logs = await collectRecentLogs(lastHeartbeatAt);

  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      licenseKey,
      timestamp,
      signature,
      ...(process.env['APP_VERSION'] ? { instanceVersion: process.env['APP_VERSION'] } : {}),
      ...(process.env['APP_URL'] ? { instanceUrl: process.env['APP_URL'] } : {}),
      usage,
      ...(logs.length > 0 ? { logs } : {}),
    }),
  });

  if (!res.ok) {
    if (dbRowId) {
      await db.update(licenseConfig).set({
        lastStatus: null,
        lastCheckedAt: new Date(),
        lastError: `license server responded ${res.status}`,
      }).where(eq(licenseConfig.id, dbRowId)).catch(() => undefined);
    }
    throw new Error(`license server responded ${res.status}`);
  }

  const body = (await res.json()) as Omit<LicenseState, 'checkedAt' | 'source'>;
  const state: LicenseState = {
    ...body,
    posScreensPerLocation: body.posScreensPerLocation ?? 3,
    source: 'heartbeat',
    checkedAt: new Date().toISOString(),
  };
  cachedState = state;
  lastHeartbeatAt = new Date();

  if (dbRowId) {
    await db.update(licenseConfig).set({
      lastStatus: state.status,
      lastCheckedAt: new Date(),
      lastError: null,
    }).where(eq(licenseConfig.id, dbRowId)).catch(() => undefined);
  }

  const redis = getRedis();
  if (redis) {
    await redis.set(CACHE_KEY, JSON.stringify(state), 'EX', CACHE_TTL_S).catch(() => undefined);
  }
}

async function loadCachedState(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.get(CACHE_KEY).catch(() => null);
  if (raw) {
    try {
      cachedState = JSON.parse(raw) as LicenseState;
    } catch {
      /* ignore */
    }
  }
}

// ── Boot-time cert loader ─────────────────────────────────────────────────────

/**
 * Try to load and verify the offline cert from the DB.
 * Returns true if an offline cert was found and loaded successfully.
 */
async function tryLoadOfflineCert(): Promise<boolean> {
  try {
    const dbConfig = await db.query.licenseConfig.findFirst();
    const mode = dbConfig?.licenseMode ?? 'online';
    if ((mode === 'offline' || mode === 'both') && dbConfig?.signedCert) {
      const state = verifyOfflineCert(dbConfig.signedCert);
      cachedState = state;
      return true;
    }
  } catch (err) {
    // Corrupt/tampered cert — log but don't crash
    console.error('[license] offline cert verification failed:', err);
  }
  return false;
}

// ── Trial state loader ───────────────────────────────────────────────────────

/**
 * Compute the trial LicenseState from the first platform owner's creation time.
 * This is stored in trialCachedState and returned by getLicenseState() when no
 * heartbeat / offline cert license is configured.
 */
async function loadTrialState(): Promise<void> {
  try {
    const owner = await db.query.platformOwners.findFirst({
      columns: { createdAt: true },
      orderBy: [asc(platformOwners.createdAt)],
    });
    if (!owner) return; // setup not yet complete

    const trialExpiredAt = new Date(owner.createdAt.getTime() + TRIAL_DAYS_DEFAULT * 24 * 60 * 60 * 1000);
    const isExpired = Date.now() > trialExpiredAt.getTime();

    trialCachedState = {
      status: isExpired ? 'suspended' : 'trial',
      allowedModules: 'signage',
      signageTier: 'basic',
      maxScreens: TRIAL_MAX_SCREENS_DEFAULT,
      maxLocations: null,
      posScreensPerLocation: 3,
      gracePct: 0,
      trialDays: TRIAL_DAYS_DEFAULT,
      trialMaxScreens: TRIAL_MAX_SCREENS_DEFAULT,
      expiresAt: trialExpiredAt.toISOString(),
      billingPeriod: null,
      planType: 'trial',
      billingCurrency: null,
      wholesaleCentsPerSignageScreen: null,
      wholesaleCentsPerPosScreen: null,
      billingAnchorDay: null,
      source: 'trial',
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[license] failed to compute trial state:', err);
  }
}

/** Start the license enforcement system. Call once at server startup. */
export function startLicenseHeartbeat(
  log: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void },
): void {
  // Boot sequence:
  // 1. Always compute trial state first (used as fallback when no license configured)
  // 2. If offline cert present → load it (no network)
  // 3. Regardless, also load Redis cache (in case we're in 'both' mode)
  // 4. Start heartbeat loop only if mode is 'online' or 'both'
  void (async () => {
    // Trial state is the lowest-priority fallback — load it first so it's
    // always available even if subsequent steps fail.
    await loadTrialState();

    const offlineLoaded = await tryLoadOfflineCert();
    if (offlineLoaded) {
      log.info('[license] offline cert loaded and verified');
    } else {
      await loadCachedState();
    }

    // Check if heartbeat is needed
    const dbConfig = await db.query.licenseConfig.findFirst().catch(() => null);
    const mode = dbConfig?.licenseMode ?? 'online';
    if (mode === 'offline') {
      // Pure offline — no heartbeat loop
      log.info('[license] running in offline mode, heartbeat disabled');
      return;
    }

    const tick = async (): Promise<void> => {
      try {
        await sendHeartbeat();
      } catch (err) {
        log.error(err, '[license] heartbeat failed (using cached state)');
      }
    };

    setTimeout(() => void tick(), 20_000);
    setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
  })();
}

/**
 * Trigger an immediate heartbeat (e.g. after a license-config save from the UI).
 * Safe to call at any time — errors are swallowed.
 */
export async function triggerHeartbeat(): Promise<void> {
  try {
    await sendHeartbeat();
  } catch {
    /* ignore */
  }
}

