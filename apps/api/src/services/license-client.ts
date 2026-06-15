/**
 * License heartbeat client.
 *
 * Phones home to the Nexari admin license server every ~15 minutes, reporting
 * screen + org counts so usage can be tracked and billed. The response tells
 * this instance its license status; we cache the last good response in Redis so
 * a transient outage of the license server never locks out a partner's screens.
 *
 * Partners configure three env vars on their install:
 *   LICENSE_KEY         — the plain license key
 *   LICENSE_SECRET      — the HMAC secret
 *   LICENSE_SERVER_URL  — e.g. https://admin.nexari.io
 */
import { createHmac } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, ne, count } from 'drizzle-orm';
import { db, devices, organizations, posMenus, licenseConfig, logEntries } from '@signage/db';
import { getRedis } from './redis.js';
import { decryptSecret } from './crypto.js';

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const CACHE_KEY = 'license:last-status';
const CACHE_TTL_S = 24 * 60 * 60; // 24h

export type LicenseStatus =
  | 'ok'
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
  gracePct: number;
  /** Trial config from the license server (used for initial trial enforcement). */
  trialDays: number;
  trialMaxScreens: number;
  checkedAt: string;
}

// ── Trial boot timestamp ─────────────────────────────────────────────────────
// Stored in Redis so it persists across restarts. Key: 'license:trial-start'
const TRIAL_START_KEY = 'license:trial-start';
const TRIAL_DAYS_DEFAULT = 60;
const TRIAL_MAX_SCREENS_DEFAULT = 3;

let cachedState: LicenseState | null = null;
/** Timestamp of the last successful heartbeat send — used to window log collection. */
let lastHeartbeatAt: Date = new Date(Date.now() - HEARTBEAT_INTERVAL_MS * 2);

/** Current license state (from last heartbeat or Redis cache). */
export function getLicenseState(): LicenseState | null {
  return cachedState;
}

/** True when new device pairing should be blocked (suspended or revoked). */
export function isPairingBlocked(): boolean {
  const s = cachedState?.status;
  return s === 'suspended' || s === 'revoked';
}

/** True when the whole instance should be locked out. */
export function isInstanceLocked(): boolean {
  return cachedState?.status === 'revoked';
}

// ── Feature gates (all return true when no license is configured = dev mode) ─

/** SyncPlay and synchronized multi-screen playback — requires Pro tier. */
export function canUseSyncPlay(): boolean {
  if (!cachedState) return false; // no license = trial = restricted
  const tier = cachedState.signageTier;
  return tier === 'pro' || tier === null; // null = no tier restriction
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
  if (!cachedState) return false;
  const m = cachedState.allowedModules;
  return m === 'pos' || m === 'both';
}

/** Whether the current screen count would exceed license limits. */
export function isOverScreenLimit(currentScreens: number): boolean {
  if (!cachedState) {
    // Trial mode: enforce trial screen limit
    return currentScreens >= TRIAL_MAX_SCREENS_DEFAULT;
  }
  if (cachedState.maxScreens == null) return false;
  const limit = Math.floor(cachedState.maxScreens * (1 + cachedState.gracePct / 100));
  return currentScreens >= limit;
}

/** Human-readable tier name for error messages. */
export function getLicenseTierLabel(): string {
  if (!cachedState) return 'trial';
  const tier = cachedState.signageTier;
  if (tier === 'pro') return 'Pro';
  if (tier === 'basic') return 'Basic';
  return 'your current plan';
}

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

/** Collect recent error/warn log entries to include in the next heartbeat. */
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
      source: r.source,
      message: r.message,
      ...(r.meta ? { meta: r.meta as Record<string, unknown> } : {}),
      ...(r.appVersion ? { appVersion: r.appVersion } : {}),
      loggedAt: r.createdAt.getTime(),
    }));
  } catch {
    return [];
  }
}

async function sendHeartbeat(): Promise<void> {
  // Read credentials from DB (UI-managed) first, fall back to env vars.
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

  if (!licenseKey || !secret || !serverUrl) {
    // No license configured — self-hosted dev / Nexari internal without enforcement
    return;
  }

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
      instanceVersion: process.env['APP_VERSION'] ?? null,
      instanceUrl: process.env['APP_URL'] ?? null,
      usage,
      ...(logs.length > 0 ? { logs } : {}),
    }),
  });

  if (!res.ok) {
    // Update DB error state if we used DB config
    if (dbRowId) {
      await db.update(licenseConfig).set({
        lastStatus: null,
        lastCheckedAt: new Date(),
        lastError: `license server responded ${res.status}`,
      }).where(eq(licenseConfig.id, dbRowId)).catch(() => undefined);
    }
    throw new Error(`license server responded ${res.status}`);
  }

  const body = (await res.json()) as Omit<LicenseState, 'checkedAt'>;
  const state: LicenseState = { ...body, checkedAt: new Date().toISOString() };
  cachedState = state;
  lastHeartbeatAt = new Date();

  // Persist last-known status back into DB row
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

/** Start the heartbeat loop. Call once at server startup. */
export function startLicenseHeartbeat(
  log: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void },
): void {
  void loadCachedState();

  const tick = async (): Promise<void> => {
    try {
      await sendHeartbeat();
    } catch (err) {
      // Never throw — a license-server outage must not crash the platform.
      log.error(err, '[license] heartbeat failed (using cached state)');
    }
  };

  // First beat shortly after boot, then on the interval.
  setTimeout(() => void tick(), 20_000);
  setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
}

/**
 * Trigger an immediate heartbeat (e.g. after a license-config save from the UI).
 * Safe to call at any time — errors are swallowed.
 */
export async function triggerHeartbeat(): Promise<void> {
  try {
    await sendHeartbeat();
  } catch {
    /* ignore — just a best-effort immediate check */
  }
}
