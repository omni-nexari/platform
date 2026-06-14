import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  db,
  platformOwners,
  organizations,
  users,
  workspaces,
  devices,
  deviceScreenshots,
  orgStorageQuotas,
  managementCompanies,
  managementCompanyAdmins,
  managementCompanyAdminInvitations,
  clientOrgOwnerInvitations,
  contentItems,
  playlists,
  schedules,
  playEvents,
  portalAnalyticsPreferences,
  portalAnalyticsDrilldownPresets,
  portalAnalyticsAlertStates,
  platformAdminNotifications,
  supportTickets,
  supportTicketMessages,
  platformIntegrations,
  licenseConfig,
  orgLicenseAllocations,
  orgSubscriptions,
} from '@signage/db';
import { encryptSecret } from '../services/crypto.js';
import { bustUberCredCache } from '../lib/uber-eats.js';import { eq, isNull, count, sql, desc, and, inArray, asc, sum, gte, lte, gt } from 'drizzle-orm';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  CreateManagementCompanySchema,
  InviteManagementCompanyAdminSchema,
  InviteClientOrgOwnerSchema,
  ManagementCompanyBrandingSchema,
  CreateSupportTicketSchema,
  ReplyToTicketSchema,
  UpdateTicketSchema,
} from '@signage/shared';
import { sendInviteEmail, sendSupportNotificationEmail } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
const BRANDING_ASSET_TYPES = new Set(['logo', 'favicon', 'login-background']);
const MAIN_ACCESS_COOKIE = 'access_token';
const MAIN_REFRESH_COOKIE = 'refresh_token';
const MAIN_CSRF_COOKIE = 'csrf_token';
const SA_ACCESS_COOKIE = 'sa_access_token';
const SA_CSRF_COOKIE = 'sa_csrf_token';

async function findExistingPath(startPath: string): Promise<{ path: string; exact: boolean }> {
  let currentPath = path.resolve(startPath);

  while (true) {
    try {
      await fs.stat(currentPath);
      return { path: currentPath, exact: currentPath === path.resolve(startPath) };
    } catch {
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        return { path: path.resolve(startPath), exact: false };
      }
      currentPath = parentPath;
    }
  }
}

function parseConnectionLabel(value: string | undefined): { host: string | null; database: string | null } {
  if (!value) return { host: null, database: null };

  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname || null,
      database: parsed.pathname ? parsed.pathname.replace(/^\//, '') || null : null,
    };
  } catch {
    return { host: null, database: null };
  }
}

async function getDirectorySize(absPath: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true, encoding: 'utf8' }) as Dirent[];
  } catch {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.stat(entryPath).catch(() => null);
      total += stats?.size ?? 0;
    }
  }

  return total;
}

function getBrandAssetExtension(filename: string, mime: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext) return ext;

  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'image/gif':
      return '.gif';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    default:
      return '';
  }
}

function getBrandAssetContentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

const secureCookies = process.env['COOKIE_SECURE'] !== 'false';

function setPortalAccessCookie(reply: FastifyReply, token: string) {
  void reply.setCookie(SA_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

function setPortalCsrfCookie(reply: FastifyReply, token = randomToken(24)) {
  void reply.setCookie(SA_CSRF_COOKIE, token, {
    httpOnly: false,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return token;
}

function clearPortalAccessCookie(reply: FastifyReply) {
  reply.clearCookie(SA_ACCESS_COOKIE, { path: '/' });
}

function clearPortalCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(SA_CSRF_COOKIE, { path: '/' });
}

function setMainAccessCookie(reply: FastifyReply, token: string) {
  void reply.setCookie(MAIN_ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 2,
  });
}

function setMainCsrfCookie(reply: FastifyReply, token = randomToken(24)) {
  void reply.setCookie(MAIN_CSRF_COOKIE, token, {
    httpOnly: false,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 2,
  });
  return token;
}

function clearMainRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(MAIN_REFRESH_COOKIE, { path: '/auth/refresh' });
}

function deletedSlugTombstone(slug: string): string {
  return `${slug}--deleted-${randomToken(4)}`;
}

function deletedEmailTombstone(email: string, uniquePart: string): string {
  const [localPart, domainPart] = email.split('@');
  if (!localPart || !domainPart) {
    return `${email}--deleted-${uniquePart}`;
  }
  return `${localPart}+deleted-${uniquePart}@${domainPart}`;
}

function csvEscape(value: string | number | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function inviteExpiry(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function parseDate(input: string | undefined, fallback: Date): Date {
  if (!input) return fallback;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? fallback : value;
}

function buildSummaryDeltas(
  currentSummary: Record<string, number>,
  previousSummary: Record<string, number>,
) {
  return Object.fromEntries(
    Object.keys(currentSummary).map((key) => {
      const current = Number(currentSummary[key] ?? 0);
      const previous = Number(previousSummary[key] ?? 0);
      const change = current - previous;
      const percentChange = previous === 0 ? null : Number((((change) / previous) * 100).toFixed(1));
      return [key, { current, previous, change, percentChange }];
    }),
  );
}

type PlatformAdminCaller =
  | { sub: string; type: 'platform_owner'; email: string; name: string }
  | {
      sub: string;
      type: 'management_company_admin';
      managementCompanyId: string;
      email: string;
      name: string;
      role: string;
    };

function isOwnerCaller(
  caller: PlatformAdminCaller,
): caller is Extract<PlatformAdminCaller, { type: 'platform_owner' }> {
  return caller.type === 'platform_owner';
}

function readPortalAccessToken(req: FastifyRequest): string | null {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return req.cookies?.[SA_ACCESS_COOKIE] ?? null;
}

function getPortalCaller(app: FastifyInstance, req: FastifyRequest): PlatformAdminCaller | null {
  const token = readPortalAccessToken(req);
  if (!token) return null;

  try {
    return app.jwt.verify<PlatformAdminCaller>(token);
  } catch {
    return null;
  }
}

async function buildPortalAuthUser(caller: PlatformAdminCaller) {
  if (caller.type === 'platform_owner') {
    const owner = await db.query.platformOwners.findFirst({
      where: eq(platformOwners.id, caller.sub),
    });
    if (!owner) return null;

    return {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      type: 'platform_owner' as const,
    };
  }

  const admin = await db.query.managementCompanyAdmins.findFirst({
    where: eq(managementCompanyAdmins.id, caller.sub),
  });
  if (!admin || admin.suspendedAt) return null;

  const company = await db.query.managementCompanies.findFirst({
    where: and(
      eq(managementCompanies.id, admin.managementCompanyId),
      isNull(managementCompanies.deletedAt),
    ),
  });

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    managementCompanyId: admin.managementCompanyId,
    type: 'management_company_admin' as const,
    companyName: company?.name ?? null,
    companySlug: company?.slug ?? null,
    companyLogoUrl: company?.logoUrl ?? null,
    companyPortalTitle: company?.portalTitle ?? null,
    companyFaviconUrl: company?.faviconUrl ?? null,
    companyPrimaryColor: company?.primaryColor ?? null,
    companyAccentColor: company?.accentColor ?? null,
    companySidebarBg: company?.sidebarBg ?? null,
    companyHeadingFontPreset: company?.headingFontPreset ?? null,
    companyBodyFontPreset: company?.bodyFontPreset ?? null,
    companyLoginBackgroundUrl: company?.loginBackgroundUrl ?? null,
    companyPlan: company?.plan ?? null,
  };
}

type PortalAnalyticsSettings = {
  thresholds: {
    storageUsagePct: number;
    storageGrowthPct: number;
    storageSevereUsagePct: number;
    onlineDeviceDropCount: number;
    severeOnlineDeviceDropCount: number;
    playDropPct: number;
    severePlayDropPct: number;
  };
  notifications: {
    storageGrowth: boolean;
    deviceDrop: boolean;
    playAnomaly: boolean;
  };
  repeatHours: number;
};

type PortalAnalyticsAlert = {
  id: 'storage-growth' | 'device-drop' | 'play-anomaly';
  tone: 'accent' | 'warning' | 'danger';
  title: string;
  description: string;
  drilldownLabel?: string;
  drilldown?: {
    orgId: string;
    workspaceId: string;
    view: 'workspace' | 'devices' | 'content' | 'analytics';
    searchParams?: Record<string, string>;
  };
};

const DEFAULT_PORTAL_ANALYTICS_SETTINGS: PortalAnalyticsSettings = {
  thresholds: {
    storageUsagePct: 80,
    storageGrowthPct: 15,
    storageSevereUsagePct: 90,
    onlineDeviceDropCount: 3,
    severeOnlineDeviceDropCount: 6,
    playDropPct: 20,
    severePlayDropPct: 35,
  },
  notifications: {
    storageGrowth: true,
    deviceDrop: true,
    playAnomaly: true,
  },
  repeatHours: 12,
};

function getPortalAnalyticsActor(caller: PlatformAdminCaller) {
  return {
    actorType: caller.type,
    actorId: caller.sub,
  };
}

function mergePortalAnalyticsSettings(input: unknown): PortalAnalyticsSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawThresholds = raw['thresholds'] && typeof raw['thresholds'] === 'object'
    ? raw['thresholds'] as Record<string, unknown>
    : {};
  const rawNotifications = raw['notifications'] && typeof raw['notifications'] === 'object'
    ? raw['notifications'] as Record<string, unknown>
    : {};

  const numberOr = (value: unknown, fallback: number) => {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : fallback;
  };

  return {
    thresholds: {
      storageUsagePct: numberOr(rawThresholds['storageUsagePct'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.storageUsagePct),
      storageGrowthPct: numberOr(rawThresholds['storageGrowthPct'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.storageGrowthPct),
      storageSevereUsagePct: numberOr(rawThresholds['storageSevereUsagePct'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.storageSevereUsagePct),
      onlineDeviceDropCount: numberOr(rawThresholds['onlineDeviceDropCount'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.onlineDeviceDropCount),
      severeOnlineDeviceDropCount: numberOr(rawThresholds['severeOnlineDeviceDropCount'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.severeOnlineDeviceDropCount),
      playDropPct: numberOr(rawThresholds['playDropPct'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.playDropPct),
      severePlayDropPct: numberOr(rawThresholds['severePlayDropPct'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.thresholds.severePlayDropPct),
    },
    notifications: {
      storageGrowth: typeof rawNotifications['storageGrowth'] === 'boolean' ? rawNotifications['storageGrowth'] : DEFAULT_PORTAL_ANALYTICS_SETTINGS.notifications.storageGrowth,
      deviceDrop: typeof rawNotifications['deviceDrop'] === 'boolean' ? rawNotifications['deviceDrop'] : DEFAULT_PORTAL_ANALYTICS_SETTINGS.notifications.deviceDrop,
      playAnomaly: typeof rawNotifications['playAnomaly'] === 'boolean' ? rawNotifications['playAnomaly'] : DEFAULT_PORTAL_ANALYTICS_SETTINGS.notifications.playAnomaly,
    },
    repeatHours: Math.max(1, numberOr(raw['repeatHours'], DEFAULT_PORTAL_ANALYTICS_SETTINGS.repeatHours)),
  };
}

export async function superAdminRoutes(app: FastifyInstance) {

  async function buildPortalAnalyticsPayload(
    caller: PlatformAdminCaller,
    from: Date,
    to: Date,
  ) {
    const companyId = isOwnerCaller(caller) ? null : caller.managementCompanyId;
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const orgScope = companyId
      ? and(isNull(organizations.deletedAt), eq(organizations.managementCompanyId, companyId))
      : isNull(organizations.deletedAt);

    const [orgRow] = await db
      .select({
        total: count(),
        suspended: sql<number>`COUNT(*) FILTER (WHERE ${organizations.suspendedAt} IS NOT NULL)::int`,
      })
      .from(organizations)
      .where(orgScope);

    const [userRow] = await db
      .select({ total: count() })
      .from(users)
      .innerJoin(organizations, eq(users.orgId, organizations.id))
      .where(
        and(
          orgScope,
          isNull(users.deletedAt),
        ),
      );

    const [workspaceRow] = await db
      .select({ total: count() })
      .from(workspaces)
      .innerJoin(organizations, eq(workspaces.orgId, organizations.id))
      .where(and(orgScope, isNull(workspaces.deletedAt)));

    const [deviceRow] = await db
      .select({
        total: count(),
        online: sql<number>`COUNT(*) FILTER (WHERE ${devices.status} = 'online')::int`,
      })
      .from(devices)
      .innerJoin(organizations, eq(devices.orgId, organizations.id))
      .where(and(orgScope, isNull(devices.deletedAt)));

    const [contentRow] = await db
      .select({ total: count() })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .innerJoin(organizations, eq(workspaces.orgId, organizations.id))
      .where(and(orgScope, isNull(workspaces.deletedAt), isNull(contentItems.deletedAt)));

    const [playlistRow] = await db
      .select({ total: count() })
      .from(playlists)
      .innerJoin(workspaces, eq(playlists.workspaceId, workspaces.id))
      .innerJoin(organizations, eq(workspaces.orgId, organizations.id))
      .where(and(orgScope, isNull(workspaces.deletedAt), isNull(playlists.deletedAt)));

    const [scheduleRow] = await db
      .select({
        total: count(),
        active: sql<number>`COUNT(*) FILTER (WHERE ${schedules.isActive} = true)::int`,
      })
      .from(schedules)
      .innerJoin(workspaces, eq(schedules.workspaceId, workspaces.id))
      .innerJoin(organizations, eq(workspaces.orgId, organizations.id))
      .where(and(orgScope, isNull(workspaces.deletedAt), isNull(schedules.deletedAt)));

    const [storageUsageRow] = await db
      .select({ used: sum(contentItems.fileSize) })
      .from(contentItems)
      .innerJoin(workspaces, eq(contentItems.workspaceId, workspaces.id))
      .innerJoin(organizations, eq(workspaces.orgId, organizations.id))
      .where(and(orgScope, isNull(workspaces.deletedAt), isNull(contentItems.deletedAt)));

    const [storageLimitRow] = await db
      .select({ limit: sum(orgStorageQuotas.limitBytes) })
      .from(orgStorageQuotas)
      .innerJoin(organizations, eq(orgStorageQuotas.orgId, organizations.id))
      .where(orgScope);

    const [screenshotRow] = await db
      .select({ total: count() })
      .from(deviceScreenshots)
      .innerJoin(devices, eq(deviceScreenshots.deviceId, devices.id))
      .innerJoin(organizations, eq(devices.orgId, organizations.id))
      .where(and(orgScope, isNull(devices.deletedAt)));

    const [playTotalsRow] = await db
      .select({
        total: count(),
        durationMs: sum(playEvents.durationMs),
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(organizations, eq(devices.orgId, organizations.id))
      .where(and(orgScope, isNull(devices.deletedAt), gte(playEvents.startedAt, from), lte(playEvents.startedAt, to)));

    const playsByDayRows = await db
      .select({
        date: sql<string>`DATE_TRUNC('day', ${playEvents.startedAt})::DATE::TEXT`,
        plays: count(),
        durationMs: sum(playEvents.durationMs),
      })
      .from(playEvents)
      .innerJoin(devices, eq(playEvents.deviceId, devices.id))
      .innerJoin(organizations, eq(devices.orgId, organizations.id))
      .where(and(orgScope, isNull(devices.deletedAt), gte(playEvents.startedAt, from), lte(playEvents.startedAt, to)))
      .groupBy(sql`DATE_TRUNC('day', ${playEvents.startedAt})`)
      .orderBy(asc(sql`DATE_TRUNC('day', ${playEvents.startedAt})`));

    const monthWindow = new Date(to);
    monthWindow.setUTCDate(1);
    monthWindow.setUTCHours(0, 0, 0, 0);
    monthWindow.setUTCMonth(monthWindow.getUTCMonth() - 5);

    const organizationsByMonthRows = await db
      .select({
        month: sql<string>`DATE_TRUNC('month', ${organizations.createdAt})::DATE::TEXT`,
        organizations: count(),
      })
      .from(organizations)
      .where(and(orgScope, gte(organizations.createdAt, monthWindow), lte(organizations.createdAt, to)))
      .groupBy(sql`DATE_TRUNC('month', ${organizations.createdAt})`)
      .orderBy(asc(sql`DATE_TRUNC('month', ${organizations.createdAt})`));

    const planBreakdownRows = await db
      .select({ plan: organizations.plan, total: count() })
      .from(organizations)
      .where(orgScope)
      .groupBy(organizations.plan)
      .orderBy(desc(count()));

    const [pendingClientInviteRow] = await db
      .select({ total: count() })
      .from(clientOrgOwnerInvitations)
      .innerJoin(organizations, eq(clientOrgOwnerInvitations.organizationId, organizations.id))
      .where(
        and(
          orgScope,
          isNull(clientOrgOwnerInvitations.acceptedAt),
          isNull(clientOrgOwnerInvitations.revokedAt),
        ),
      );

    const [pendingResellerInviteRow] = await db
      .select({ total: count() })
      .from(managementCompanyAdminInvitations)
      .where(
        and(
          companyId ? eq(managementCompanyAdminInvitations.managementCompanyId, companyId) : undefined,
          isNull(managementCompanyAdminInvitations.acceptedAt),
          isNull(managementCompanyAdminInvitations.revokedAt),
        ),
      );

    const [resellerAdminRow] = await db
      .select({ total: count() })
      .from(managementCompanyAdmins)
      .where(
        and(
          companyId ? eq(managementCompanyAdmins.managementCompanyId, companyId) : undefined,
          isNull(managementCompanyAdmins.suspendedAt),
        ),
      );

    const topOrganizations = await db.execute(sql`
      SELECT
        o.id AS org_id,
        o.name,
        o.slug,
        ${isOwnerCaller(caller) ? sql`mc.name AS reseller_name,` : sql``}
        (
          SELECT COUNT(*)::int
          FROM workspaces w
          WHERE w.org_id = o.id AND w.deleted_at IS NULL
        ) AS workspace_count,
        (
          SELECT COUNT(*)::int
          FROM devices d
          WHERE d.org_id = o.id AND d.deleted_at IS NULL
        ) AS device_count,
        (
          SELECT COUNT(*)::int
          FROM users u
          WHERE u.org_id = o.id AND u.deleted_at IS NULL
        ) AS user_count,
        COALESCE((
          SELECT SUM(COALESCE(ci.file_size, 0))::bigint
          FROM content_items ci
          INNER JOIN workspaces w2 ON w2.id = ci.workspace_id
          WHERE w2.org_id = o.id
            AND w2.deleted_at IS NULL
            AND ci.deleted_at IS NULL
        ), 0)::text AS storage_used_bytes,
        (
          SELECT COUNT(*)::int
          FROM play_events pe
          INNER JOIN devices d2 ON d2.id = pe.device_id
          WHERE d2.org_id = o.id
            AND pe.started_at >= ${fromIso}::timestamptz
            AND pe.started_at <= ${toIso}::timestamptz
        ) AS play_count,
        o.created_at::text AS created_at,
        CASE WHEN o.suspended_at IS NULL THEN 'active' ELSE 'suspended' END AS status
      FROM organisations o
      ${isOwnerCaller(caller) ? sql`LEFT JOIN management_companies mc ON mc.id = o.management_company_id` : sql``}
      WHERE o.deleted_at IS NULL
      ${companyId ? sql`AND o.management_company_id = ${companyId}` : sql``}
      ORDER BY play_count DESC, device_count DESC, o.created_at DESC
      LIMIT 10
    `) as unknown as Array<{
      org_id: string;
      name: string;
      slug: string;
      reseller_name?: string | null;
      workspace_count: number;
      device_count: number;
      user_count: number;
      storage_used_bytes: string;
      play_count: number;
      created_at: string;
      status: string;
    }>;

    const recentOrganizations = await db.execute(sql`
      SELECT
        o.id AS org_id,
        o.name,
        o.slug,
        ${isOwnerCaller(caller) ? sql`mc.name AS reseller_name,` : sql``}
        o.created_at::text AS created_at,
        CASE WHEN o.suspended_at IS NULL THEN 'active' ELSE 'suspended' END AS status
      FROM organisations o
      ${isOwnerCaller(caller) ? sql`LEFT JOIN management_companies mc ON mc.id = o.management_company_id` : sql``}
      WHERE o.deleted_at IS NULL
      ${companyId ? sql`AND o.management_company_id = ${companyId}` : sql``}
      ORDER BY o.created_at DESC
      LIMIT 8
    `) as unknown as Array<{
      org_id: string;
      name: string;
      slug: string;
      reseller_name?: string | null;
      created_at: string;
      status: string;
    }>;

    const topWorkspaces = await db.execute(sql`
      SELECT
        w.id AS workspace_id,
        w.name,
        w.slug,
        o.id AS org_id,
        o.name AS org_name,
        o.slug AS org_slug,
        ${isOwnerCaller(caller) ? sql`mc.name AS reseller_name,` : sql``}
        (
          SELECT COUNT(*)::int
          FROM devices d
          WHERE d.workspace_id = w.id
            AND d.deleted_at IS NULL
        ) AS device_count,
        (
          SELECT COUNT(*)::int
          FROM devices d
          WHERE d.workspace_id = w.id
            AND d.deleted_at IS NULL
            AND d.status = 'online'
        ) AS online_device_count,
        (
          SELECT COUNT(*)::int
          FROM devices d
          WHERE d.workspace_id = w.id
            AND d.deleted_at IS NULL
            AND d.status IN ('offline', 'error')
        ) AS offline_device_count,
        (
          SELECT COUNT(*)::int
          FROM content_items ci
          WHERE ci.workspace_id = w.id
            AND ci.deleted_at IS NULL
        ) AS content_count,
        (
          SELECT COUNT(*)::int
          FROM play_events pe
          INNER JOIN devices d2 ON d2.id = pe.device_id
          WHERE d2.workspace_id = w.id
            AND pe.started_at >= ${fromIso}::timestamptz
            AND pe.started_at <= ${toIso}::timestamptz
        ) AS play_count,
        w.created_at::text AS created_at
      FROM workspaces w
      INNER JOIN organisations o ON o.id = w.org_id
      ${isOwnerCaller(caller) ? sql`LEFT JOIN management_companies mc ON mc.id = o.management_company_id` : sql``}
      WHERE w.deleted_at IS NULL
        AND o.deleted_at IS NULL
      ${companyId ? sql`AND o.management_company_id = ${companyId}` : sql``}
      ORDER BY play_count DESC, device_count DESC, content_count DESC, w.created_at DESC
      LIMIT 10
    `) as unknown as Array<{
      workspace_id: string;
      name: string;
      slug: string;
      org_id: string;
      org_name: string;
      org_slug: string;
      reseller_name?: string | null;
      device_count: number;
      online_device_count: number;
      offline_device_count: number;
      content_count: number;
      play_count: number;
      created_at: string;
    }>;

    const topResellers = isOwnerCaller(caller)
      ? (await db.execute(sql`
          SELECT
            mc.id AS company_id,
            mc.name,
            (
              SELECT COUNT(*)::int
              FROM organisations o
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
            ) AS org_count,
            (
              SELECT COUNT(*)::int
              FROM organisations o
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
                AND o.suspended_at IS NOT NULL
            ) AS suspended_org_count,
            (
              SELECT COUNT(*)::int
              FROM users u
              INNER JOIN organisations o ON o.id = u.org_id
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
                AND u.deleted_at IS NULL
            ) AS user_count,
            (
              SELECT COUNT(*)::int
              FROM workspaces w
              INNER JOIN organisations o ON o.id = w.org_id
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
                AND w.deleted_at IS NULL
            ) AS workspace_count,
            (
              SELECT COUNT(*)::int
              FROM devices d
              INNER JOIN organisations o ON o.id = d.org_id
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
                AND d.deleted_at IS NULL
            ) AS device_count,
            COALESCE((
              SELECT SUM(COALESCE(ci.file_size, 0))::bigint
              FROM content_items ci
              INNER JOIN workspaces w ON w.id = ci.workspace_id
              INNER JOIN organisations o ON o.id = w.org_id
              WHERE o.management_company_id = mc.id
                AND o.deleted_at IS NULL
                AND w.deleted_at IS NULL
                AND ci.deleted_at IS NULL
            ), 0)::text AS storage_used_bytes
          FROM management_companies mc
          WHERE mc.deleted_at IS NULL
          ORDER BY org_count DESC, device_count DESC, mc.created_at DESC
          LIMIT 10
        `) as unknown as Array<{
          company_id: string;
          name: string;
          org_count: number;
          suspended_org_count: number;
          user_count: number;
          workspace_count: number;
          device_count: number;
          storage_used_bytes: string;
        }>)
      : [];

    const [resellerCountRow] = isOwnerCaller(caller)
      ? await db
          .select({ total: count() })
          .from(managementCompanies)
          .where(isNull(managementCompanies.deletedAt))
      : [{ total: 0 }];

    const summary = {
      totalResellers: Number(resellerCountRow?.total ?? 0),
      totalOrganizations: Number(orgRow?.total ?? 0),
      suspendedOrganizations: Number(orgRow?.suspended ?? 0),
      totalUsers: Number(userRow?.total ?? 0),
      totalWorkspaces: Number(workspaceRow?.total ?? 0),
      totalDevices: Number(deviceRow?.total ?? 0),
      onlineDevices: Number(deviceRow?.online ?? 0),
      totalContentItems: Number(contentRow?.total ?? 0),
      totalPlaylists: Number(playlistRow?.total ?? 0),
      totalSchedules: Number(scheduleRow?.total ?? 0),
      activeSchedules: Number(scheduleRow?.active ?? 0),
      totalStorageUsedBytes: Number(storageUsageRow?.used ?? 0),
      totalStorageLimitBytes: Number(storageLimitRow?.limit ?? 0),
      totalScreenshots: Number(screenshotRow?.total ?? 0),
      totalPendingClientInvites: Number(pendingClientInviteRow?.total ?? 0),
      totalPendingResellerInvites: Number(pendingResellerInviteRow?.total ?? 0),
      resellerAdminCount: Number(resellerAdminRow?.total ?? 0),
      totalPlays: Number(playTotalsRow?.total ?? 0),
      totalPlayDurationMs: Number(playTotalsRow?.durationMs ?? 0),
    };

    return {
      scope: isOwnerCaller(caller) ? 'platform_owner' : 'reseller',
      from: from.toISOString(),
      to: to.toISOString(),
      summary,
      totalManagementCompanies: summary.totalResellers,
      totalResellers: summary.totalResellers,
      totalOrgs: summary.totalOrganizations,
      totalOrganizations: summary.totalOrganizations,
      suspendedOrgs: summary.suspendedOrganizations,
      suspendedOrganizations: summary.suspendedOrganizations,
      totalUsers: summary.totalUsers,
      playsByDay: playsByDayRows.map((row) => ({
        date: row.date,
        plays: Number(row.plays ?? 0),
        durationMs: Number(row.durationMs ?? 0),
      })),
      organizationsByMonth: organizationsByMonthRows.map((row) => ({
        month: row.month,
        organizations: Number(row.organizations ?? 0),
      })),
      planBreakdown: planBreakdownRows.map((row) => ({
        plan: row.plan,
        count: Number(row.total ?? 0),
      })),
      topOrganizations: topOrganizations.map((row) => ({
        orgId: row.org_id,
        name: row.name,
        slug: row.slug,
        resellerName: row.reseller_name ?? null,
        workspaceCount: Number(row.workspace_count ?? 0),
        deviceCount: Number(row.device_count ?? 0),
        userCount: Number(row.user_count ?? 0),
        storageUsedBytes: Number(row.storage_used_bytes ?? 0),
        playCount: Number(row.play_count ?? 0),
        createdAt: row.created_at,
        status: row.status,
      })),
      recentOrganizations: recentOrganizations.map((row) => ({
        orgId: row.org_id,
        name: row.name,
        slug: row.slug,
        resellerName: row.reseller_name ?? null,
        createdAt: row.created_at,
        status: row.status,
      })),
      topWorkspaces: topWorkspaces.map((row) => ({
        workspaceId: row.workspace_id,
        name: row.name,
        slug: row.slug,
        orgId: row.org_id,
        orgName: row.org_name,
        orgSlug: row.org_slug,
        resellerName: row.reseller_name ?? null,
        deviceCount: Number(row.device_count ?? 0),
        onlineDeviceCount: Number(row.online_device_count ?? 0),
        offlineDeviceCount: Number(row.offline_device_count ?? 0),
        contentCount: Number(row.content_count ?? 0),
        playCount: Number(row.play_count ?? 0),
        createdAt: row.created_at,
      })),
      topResellers: topResellers.map((row) => ({
        companyId: row.company_id,
        name: row.name,
        orgCount: Number(row.org_count ?? 0),
        suspendedOrgCount: Number(row.suspended_org_count ?? 0),
        userCount: Number(row.user_count ?? 0),
        workspaceCount: Number(row.workspace_count ?? 0),
        deviceCount: Number(row.device_count ?? 0),
        storageUsedBytes: Number(row.storage_used_bytes ?? 0),
      })),
    };
  }

  async function buildPortalAnalyticsResponse(
    caller: PlatformAdminCaller,
    from: Date,
    to: Date,
    compareMode: 'none' | 'previous_period' = 'previous_period',
  ) {
    const settings = await getPortalAnalyticsSettings(caller);
    const current = await buildPortalAnalyticsPayload(caller, from, to);

    if (compareMode !== 'previous_period') {
      const payload = { ...current, comparison: null };
      const alerts = buildPortalAnalyticsAlerts(payload, settings);
      await syncPortalAnalyticsNotifications(caller, alerts, settings);
      return { ...payload, settings, alerts };
    }

    const rangeMs = Math.max(1, to.getTime() - from.getTime());
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - rangeMs);
    const previous = await buildPortalAnalyticsPayload(caller, previousFrom, previousTo);

    const payload = {
      ...current,
      comparison: {
        mode: 'previous_period' as const,
        previousFrom: previous.from,
        previousTo: previous.to,
        previousSummary: previous.summary,
        deltas: buildSummaryDeltas(
          current.summary as Record<string, number>,
          previous.summary as Record<string, number>,
        ),
      },
    };

    const alerts = buildPortalAnalyticsAlerts(payload, settings);
    await syncPortalAnalyticsNotifications(caller, alerts, settings);

    return { ...payload, settings, alerts };
  }

  async function getPortalAnalyticsSettings(caller: PlatformAdminCaller): Promise<PortalAnalyticsSettings> {
    const actor = getPortalAnalyticsActor(caller);
    const existing = await db.query.portalAnalyticsPreferences.findFirst({
      where: and(
        eq(portalAnalyticsPreferences.actorType, actor.actorType),
        eq(portalAnalyticsPreferences.actorId, actor.actorId),
      ),
    });
    return mergePortalAnalyticsSettings(existing?.settings ?? null);
  }

  function buildPortalAnalyticsAlerts(
    payload: Awaited<ReturnType<typeof buildPortalAnalyticsPayload>> & { comparison: ReturnType<typeof buildSummaryDeltas> | null } | {
      summary: Awaited<ReturnType<typeof buildPortalAnalyticsPayload>>['summary'];
      topWorkspaces: Awaited<ReturnType<typeof buildPortalAnalyticsPayload>>['topWorkspaces'];
      comparison: { deltas: Record<string, { change: number; percentChange: number | null }> } | null;
    },
    settings: PortalAnalyticsSettings,
  ): PortalAnalyticsAlert[] {
    const alerts: PortalAnalyticsAlert[] = [];
    const comparison = payload.comparison && 'deltas' in payload.comparison
      ? payload.comparison as { deltas: Record<string, { change: number; percentChange: number | null }> }
      : null;
    const storageUsagePct = payload.summary.totalStorageLimitBytes > 0
      ? (payload.summary.totalStorageUsedBytes / payload.summary.totalStorageLimitBytes) * 100
      : 0;
    const topWorkspaceByContent = [...payload.topWorkspaces].sort((left, right) => right.contentCount - left.contentCount)[0];
    const topWorkspaceByOffline = [...payload.topWorkspaces].sort((left, right) => right.offlineDeviceCount - left.offlineDeviceCount)[0];
    const topWorkspaceByPlays = [...payload.topWorkspaces].sort((left, right) => right.playCount - left.playCount)[0];
    const storageDelta = comparison?.deltas['totalStorageUsedBytes'];
    const onlineDeviceDelta = comparison?.deltas['onlineDevices'];
    const playDelta = comparison?.deltas['totalPlays'];

    if (
      storageUsagePct >= settings.thresholds.storageUsagePct
      || (storageDelta?.percentChange != null && storageDelta.percentChange >= settings.thresholds.storageGrowthPct)
    ) {
      alerts.push({
        id: 'storage-growth',
        tone: storageUsagePct >= settings.thresholds.storageSevereUsagePct ? 'danger' : 'warning',
        title: 'Storage pressure is rising',
        description: storageDelta?.percentChange != null
          ? `${Math.round(storageDelta.percentChange)}% storage growth versus the previous period.`
          : 'Storage usage exceeded the configured operating threshold.',
        ...(topWorkspaceByContent ? {
          drilldownLabel: 'Inspect content-heavy workspace',
          drilldown: {
            orgId: topWorkspaceByContent.orgId,
            workspaceId: topWorkspaceByContent.workspaceId,
            view: 'content' as const,
            searchParams: { sort: 'size' },
          },
        } : {}),
      });
    }

    if (
      payload.topWorkspaces.some((workspace) => workspace.offlineDeviceCount > 0)
      || (onlineDeviceDelta?.change != null && Math.abs(onlineDeviceDelta.change) >= settings.thresholds.onlineDeviceDropCount && onlineDeviceDelta.change < 0)
    ) {
      alerts.push({
        id: 'device-drop',
        tone: onlineDeviceDelta != null && Math.abs(onlineDeviceDelta.change) >= settings.thresholds.severeOnlineDeviceDropCount ? 'danger' : 'warning',
        title: 'Device availability dropped',
        description: onlineDeviceDelta?.change != null && onlineDeviceDelta.change < 0
          ? `${Math.abs(onlineDeviceDelta.change).toLocaleString()} fewer devices are online than in the previous period.`
          : 'At least one tracked workspace currently has offline or errored devices.',
        ...(topWorkspaceByOffline ? {
          drilldownLabel: 'Open affected devices',
          drilldown: {
            orgId: topWorkspaceByOffline.orgId,
            workspaceId: topWorkspaceByOffline.workspaceId,
            view: 'devices' as const,
            searchParams: { status: 'offline' },
          },
        } : {}),
      });
    }

    if (playDelta?.percentChange != null && playDelta.percentChange <= -settings.thresholds.playDropPct) {
      alerts.push({
        id: 'play-anomaly',
        tone: playDelta.percentChange <= -settings.thresholds.severePlayDropPct ? 'danger' : 'accent',
        title: 'Play volume is below baseline',
        description: `Proof-of-play is down ${Math.abs(Math.round(playDelta.percentChange))}% versus the previous period.`,
        ...(topWorkspaceByPlays ? {
          drilldownLabel: 'Open workspace analytics',
          drilldown: {
            orgId: topWorkspaceByPlays.orgId,
            workspaceId: topWorkspaceByPlays.workspaceId,
            view: 'analytics' as const,
          },
        } : {}),
      });
    }

    return alerts.slice(0, 3);
  }

  async function syncPortalAnalyticsNotifications(
    caller: PlatformAdminCaller,
    alerts: PortalAnalyticsAlert[],
    settings: PortalAnalyticsSettings,
  ) {
    const actor = getPortalAnalyticsActor(caller);
    const existingStates = await db.query.portalAnalyticsAlertStates.findMany({
      where: and(
        eq(portalAnalyticsAlertStates.actorType, actor.actorType),
        eq(portalAnalyticsAlertStates.actorId, actor.actorId),
      ),
    });
    const stateMap = new Map(existingStates.map((state) => [state.alertKey, state]));
    const activeKeys = new Set<string>(alerts.map((alert) => alert.id));
    const now = new Date();
    const repeatMs = settings.repeatHours * 3_600_000;

    const routeEnabled: Record<PortalAnalyticsAlert['id'], boolean> = {
      'storage-growth': settings.notifications.storageGrowth,
      'device-drop': settings.notifications.deviceDrop,
      'play-anomaly': settings.notifications.playAnomaly,
    };

    for (const alert of alerts) {
      const fingerprint = JSON.stringify({
        title: alert.title,
        description: alert.description,
        workspaceId: alert.drilldown?.workspaceId ?? null,
      });
      const state = stateMap.get(alert.id);
      const shouldCreateNotification = routeEnabled[alert.id] && (
        !state
        || state.fingerprint !== fingerprint
        || state.resolvedAt != null
        || (state.lastTriggeredAt != null && now.getTime() - state.lastTriggeredAt.getTime() >= repeatMs)
      );

      if (shouldCreateNotification) {
        await db.insert(platformAdminNotifications).values({
          actorType: actor.actorType,
          actorId: actor.actorId,
          type: `analytics_${alert.id.replace(/-/g, '_')}`,
          title: alert.title,
          body: alert.description,
          entityType: alert.drilldown ? 'workspace' : 'analytics_alert',
          entityId: alert.drilldown?.workspaceId ?? null,
        });
      }

      if (state) {
        await db.update(portalAnalyticsAlertStates)
          .set({ fingerprint, lastTriggeredAt: now, resolvedAt: null, updatedAt: now })
          .where(eq(portalAnalyticsAlertStates.id, state.id));
      } else {
        await db.insert(portalAnalyticsAlertStates).values({
          actorType: actor.actorType,
          actorId: actor.actorId,
          alertKey: alert.id,
          fingerprint,
          lastTriggeredAt: now,
          resolvedAt: null,
        });
      }
    }

    for (const state of existingStates) {
      if (!activeKeys.has(state.alertKey) && state.resolvedAt == null) {
        await db.update(portalAnalyticsAlertStates)
          .set({ resolvedAt: now, updatedAt: now })
          .where(eq(portalAnalyticsAlertStates.id, state.id));
      }
    }
  }

  async function buildSystemHealthPayload() {
      const mem = process.memoryUsage();
      const resolvedStorageRoot = path.resolve(STORAGE_ROOT);
      const { path: storageStatsPath, exact: storagePathExists } = await findExistingPath(resolvedStorageRoot);
      const storageStats = await fs.statfs(storageStatsPath);
      const storageTotal = storageStats.bsize * storageStats.blocks;
      const storageFree = storageStats.bsize * storageStats.bavail;
      const storageUsed = Math.max(0, storageTotal - storageFree);
      const databaseConnection = parseConnectionLabel(process.env['DATABASE_URL']);
      const redisConnection = parseConnectionLabel(process.env['REDIS_URL']);

      const postgresStartedAt = Date.now();
      let postgresError: string | null = null;
      let postgresDbSizeBytes: number | null = null;
      try {
        const sizeResult = await db.execute(sql`SELECT pg_database_size(current_database()) AS size`);
        const sizeRow = (sizeResult as unknown as Array<{ size: string | number }>)[0];
        postgresDbSizeBytes = sizeRow ? Number(sizeRow.size) : null;
      } catch (error) {
        postgresError = error instanceof Error ? error.message : 'Unknown PostgreSQL error';
      }
      const postgresLatencyMs = Date.now() - postgresStartedAt;

      const redisUrl = process.env['REDIS_URL'];
      let redisLatencyMs: number | null = null;
      let redisError: string | null = null;
      if (redisUrl) {
        const redisClient = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
        });

        const redisStartedAt = Date.now();
        try {
          await redisClient.connect();
          await redisClient.ping();
          redisLatencyMs = Date.now() - redisStartedAt;
        } catch (error) {
          redisError = error instanceof Error ? error.message : 'Unknown Redis error';
        } finally {
          await redisClient.quit().catch(async () => {
            await redisClient.disconnect();
          });
        }
      }

      const [orgsRow] = await db
        .select({ total: count() })
        .from(organizations)
        .where(isNull(organizations.deletedAt));

      const [usersRow] = await db
        .select({ total: count() })
        .from(users)
        .where(isNull(users.deletedAt));

      const [workspacesRow] = await db
        .select({ total: count() })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt));

      const [devicesRow] = await db
        .select({ total: count() })
        .from(devices)
        .where(isNull(devices.deletedAt));

      const [managementCompaniesRow] = await db
        .select({ total: count() })
        .from(managementCompanies)
        .where(isNull(managementCompanies.deletedAt));

      const workspaceRows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          orgId: workspaces.orgId,
          orgName: organizations.name,
        })
        .from(workspaces)
        .innerJoin(organizations, eq(organizations.id, workspaces.orgId))
        .where(and(isNull(workspaces.deletedAt), isNull(organizations.deletedAt)));

      const deviceRows = await db
        .select({
          id: devices.id,
          name: devices.name,
          orgId: devices.orgId,
          workspaceId: devices.workspaceId,
          orgName: organizations.name,
          workspaceName: workspaces.name,
        })
        .from(devices)
        .leftJoin(organizations, eq(organizations.id, devices.orgId))
        .leftJoin(workspaces, eq(workspaces.id, devices.workspaceId))
        .where(isNull(devices.deletedAt));

      const managementBrandingRows = await db
        .select({
          id: managementCompanies.id,
          name: managementCompanies.name,
          slug: managementCompanies.slug,
        })
        .from(managementCompanies)
        .where(isNull(managementCompanies.deletedAt));

      const screenshotMetaRows = await db
        .select({
          deviceId: deviceScreenshots.deviceId,
          screenshotCount: count(deviceScreenshots.id),
          lastTakenAt: sql<string | null>`max(${deviceScreenshots.takenAt})`,
        })
        .from(deviceScreenshots)
        .groupBy(deviceScreenshots.deviceId);
      const screenshotMetaByDeviceId = new Map(
        screenshotMetaRows.map((row) => [row.deviceId, row]),
      );

      const workspaceUploadUsage = (
        await Promise.all(
          workspaceRows.map(async (row) => ({
            workspaceId: row.id,
            workspaceName: row.name,
            orgId: row.orgId,
            orgName: row.orgName,
            bytes: await getDirectorySize(path.join(resolvedStorageRoot, row.orgId, row.id)),
          })),
        )
      ).sort((left, right) => right.bytes - left.bytes);

      const screenshotUsage = (
        await Promise.all(
          deviceRows.map(async (row) => {
            const meta = screenshotMetaByDeviceId.get(row.id);
            return {
              deviceId: row.id,
              deviceName: row.name,
              orgId: row.orgId,
              workspaceId: row.workspaceId,
              orgName: row.orgName,
              workspaceName: row.workspaceName,
              bytes: await getDirectorySize(path.join(resolvedStorageRoot, row.id)),
              screenshotCount: Number(meta?.screenshotCount ?? 0),
              lastScreenshotAt: meta?.lastTakenAt ?? null,
            };
          }),
        )
      ).sort((left, right) => right.bytes - left.bytes);

      const managementBrandingUsage = (
        await Promise.all(
          managementBrandingRows.map(async (row) => ({
            managementCompanyId: row.id,
            companyName: row.name,
            companySlug: row.slug,
            bytes: await getDirectorySize(path.join(resolvedStorageRoot, 'management_branding', row.id)),
          })),
        )
      ).sort((left, right) => right.bytes - left.bytes);

      const orgStorageTotalsMap = new Map<
        string,
        {
          orgId: string;
          orgName: string | null;
          workspaceUploadBytes: number;
          screenshotBytes: number;
          screenshotCount: number;
          totalBytes: number;
        }
      >();

      for (const entry of workspaceUploadUsage) {
        const existing = orgStorageTotalsMap.get(entry.orgId) ?? {
          orgId: entry.orgId,
          orgName: entry.orgName,
          workspaceUploadBytes: 0,
          screenshotBytes: 0,
          screenshotCount: 0,
          totalBytes: 0,
        };
        existing.orgName = existing.orgName ?? entry.orgName;
        existing.workspaceUploadBytes += entry.bytes;
        existing.totalBytes += entry.bytes;
        orgStorageTotalsMap.set(entry.orgId, existing);
      }

      for (const entry of screenshotUsage) {
        if (!entry.orgId) continue;
        const existing = orgStorageTotalsMap.get(entry.orgId) ?? {
          orgId: entry.orgId,
          orgName: entry.orgName,
          workspaceUploadBytes: 0,
          screenshotBytes: 0,
          screenshotCount: 0,
          totalBytes: 0,
        };
        existing.orgName = existing.orgName ?? entry.orgName;
        existing.screenshotBytes += entry.bytes;
        existing.screenshotCount += entry.screenshotCount;
        existing.totalBytes += entry.bytes;
        orgStorageTotalsMap.set(entry.orgId, existing);
      }

      const orgStorageTotals = Array.from(orgStorageTotalsMap.values()).sort(
        (left, right) => right.totalBytes - left.totalBytes,
      );

      const totalWorkspaceUploadBytes = workspaceUploadUsage.reduce((sum, entry) => sum + entry.bytes, 0);
      const totalScreenshotBytes = screenshotUsage.reduce((sum, entry) => sum + entry.bytes, 0);
      const totalScreenshotCount = screenshotUsage.reduce((sum, entry) => sum + entry.screenshotCount, 0);
      const totalManagementBrandingBytes = managementBrandingUsage.reduce((sum, entry) => sum + entry.bytes, 0);

      return {
        process: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
          external: mem.external,
          uptime: process.uptime(),
          nodeVersion: process.version,
          pid: process.pid,
        },
        db: {
          totalOrgs: Number(orgsRow?.total ?? 0),
          totalUsers: Number(usersRow?.total ?? 0),
          totalWorkspaces: Number(workspacesRow?.total ?? 0),
          totalDevices: Number(devicesRow?.total ?? 0),
          totalManagementCompanies: Number(managementCompaniesRow?.total ?? 0),
        },
        storage: {
          rootPath: resolvedStorageRoot,
          statsPath: storageStatsPath,
          exactPathExists: storagePathExists,
          totalBytes: storageTotal,
          freeBytes: storageFree,
          usedBytes: storageUsed,
          workspaceUploadBytes: totalWorkspaceUploadBytes,
          screenshotBytes: totalScreenshotBytes,
          screenshotCount: totalScreenshotCount,
          managementBrandingBytes: totalManagementBrandingBytes,
          workspaceUploads: workspaceUploadUsage,
          screenshotUsage,
          orgTotals: orgStorageTotals,
          managementBranding: managementBrandingUsage,
        },
        services: {
          postgres: {
            ok: postgresError === null,
            latencyMs: postgresLatencyMs,
            host: databaseConnection.host,
            database: databaseConnection.database,
            dbSizeBytes: postgresDbSizeBytes,
            error: postgresError,
          },
          redis: {
            configured: Boolean(redisUrl),
            ok: Boolean(redisUrl) && redisError === null,
            latencyMs: redisLatencyMs,
            host: redisConnection.host,
            error: redisError,
          },
        },
      };
  }

  // ── GET /superadmin/auth/company-assets/:companyId/:fileName  (public) ─────
  app.get('/auth/company-assets/:companyId/:fileName', async (req, reply) => {
    const { companyId, fileName } = req.params as { companyId: string; fileName: string };
    const safeFileName = path.basename(fileName);

    const company = await db.query.managementCompanies.findFirst({
      where: and(eq(managementCompanies.id, companyId), isNull(managementCompanies.deletedAt)),
      columns: { id: true },
    });
    if (!company) return reply.status(404).send({ error: 'Not found' });

    const absPath = path.resolve(STORAGE_ROOT, 'management_branding', companyId, safeFileName);
    try {
      const buf = await fs.readFile(absPath);
      reply.header('content-type', getBrandAssetContentType(safeFileName));
      return reply.send(buf);
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  app.get('/auth/csrf', async (_req, reply) => {
    setPortalCsrfCookie(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req, reply) => {
    const caller = getPortalCaller(app, req);
    if (!caller) return reply.status(401).send({ error: 'Unauthorized' });

    const user = await buildPortalAuthUser(caller);
    if (!user) {
      clearPortalAccessCookie(reply);
      clearPortalCsrfCookie(reply);
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (!req.cookies?.[SA_CSRF_COOKIE]) {
      setPortalCsrfCookie(reply);
    }

    return reply.send({ user });
  });

  app.post('/auth/logout', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const csrfResult = await (app as FastifyInstance & {
      verifyCsrf: (req: unknown, reply: unknown) => Promise<unknown> | unknown;
    }).verifyCsrf(req, reply);
    if (csrfResult) return csrfResult;

    clearPortalAccessCookie(reply);
    clearPortalCsrfCookie(reply);
    return reply.status(204).send();
  });

  // ── POST /superadmin/auth/login  (platform owner) ──────────────────────────
  app.post('/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const owner = await db.query.platformOwners.findFirst({
      where: eq(platformOwners.email, body.data.email.toLowerCase()),
    });
    if (!owner) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await argon2.verify(owner.passwordHash, body.data.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    await db
      .update(platformOwners)
      .set({ lastLogin: new Date(), updatedAt: new Date() })
      .where(eq(platformOwners.id, owner.id));

    const accessToken = app.jwt.sign(
      { sub: owner.id, type: 'platform_owner', email: owner.email, name: owner.name ?? '' },
      { expiresIn: '8h' },
    );

    setPortalAccessCookie(reply, accessToken);
    setPortalCsrfCookie(reply);

    return reply.send({
      user: { id: owner.id, email: owner.email, name: owner.name, type: 'platform_owner' },
    });
  });

  // ── GET /superadmin/auth/company/:slug  (public — login page branding) ──────
  app.get('/auth/company/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const company = await db.query.managementCompanies.findFirst({
      where: and(eq(managementCompanies.slug, slug), isNull(managementCompanies.deletedAt)),
    });
    if (!company || company.slug.startsWith('pending-')) {
      return reply.status(404).send({ error: 'Company not found' });
    }
    return reply.send({
      name: company.name,
      slug: company.slug,
      logoUrl: company.logoUrl ?? null,
      portalTitle: company.portalTitle ?? null,
      faviconUrl: company.faviconUrl ?? null,
      primaryColor: company.primaryColor ?? null,
      accentColor: company.accentColor ?? null,
      sidebarBg: company.sidebarBg ?? null,
      headingFontPreset: company.headingFontPreset ?? null,
      bodyFontPreset: company.bodyFontPreset ?? null,
      loginBackgroundUrl: company.loginBackgroundUrl ?? null,
      suspendedAt: company.suspendedAt ?? null,
    });
  });

  // ── POST /superadmin/auth/company-login  (management company admin) ─────────
  app.post('/auth/company-login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const admin = await db.query.managementCompanyAdmins.findFirst({
      where: eq(managementCompanyAdmins.email, body.data.email.toLowerCase()),
    });
    if (!admin) return reply.status(401).send({ error: 'Invalid credentials' });
    if (admin.suspendedAt) return reply.status(403).send({ error: 'Account suspended' });

    const valid = await argon2.verify(admin.passwordHash, body.data.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    await db
      .update(managementCompanyAdmins)
      .set({ lastLogin: new Date(), updatedAt: new Date() })
      .where(eq(managementCompanyAdmins.id, admin.id));

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, admin.managementCompanyId),
    });

    const accessToken = app.jwt.sign(
      {
        sub: admin.id,
        type: 'management_company_admin',
        managementCompanyId: admin.managementCompanyId,
        email: admin.email,
        name: admin.name ?? '',
        role: admin.role,
      },
      { expiresIn: '8h' },
    );

    setPortalAccessCookie(reply, accessToken);
    setPortalCsrfCookie(reply);

    return reply.send({
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        managementCompanyId: admin.managementCompanyId,
        type: 'management_company_admin',
        companyName: company?.name ?? null,
        companySlug: company?.slug ?? null,
        companyLogoUrl: company?.logoUrl ?? null,
        companyPortalTitle: company?.portalTitle ?? null,
        companyFaviconUrl: company?.faviconUrl ?? null,
        companyPrimaryColor: company?.primaryColor ?? null,
        companyAccentColor: company?.accentColor ?? null,
        companySidebarBg: company?.sidebarBg ?? null,
        companyHeadingFontPreset: company?.headingFontPreset ?? null,
        companyBodyFontPreset: company?.bodyFontPreset ?? null,
        companyLoginBackgroundUrl: company?.loginBackgroundUrl ?? null,
        companyPlan: company?.plan ?? null,
      },
    });
  });

  // ── GET /superadmin/management-companies  (platform owner only) ─────────────
  app.get(
    '/management-companies',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      const companies = await db.query.managementCompanies.findMany({
        where: isNull(managementCompanies.deletedAt),
        orderBy: [desc(managementCompanies.createdAt)],
      });

      const adminCounts = await db
        .select({ companyId: managementCompanyAdmins.managementCompanyId, cnt: count() })
        .from(managementCompanyAdmins)
        .where(isNull(managementCompanyAdmins.suspendedAt))
        .groupBy(managementCompanyAdmins.managementCompanyId);

      const orgCounts = await db
        .select({ companyId: organizations.managementCompanyId, cnt: count() })
        .from(organizations)
        .where(isNull(organizations.deletedAt))
        .groupBy(organizations.managementCompanyId);

      const adminMap = Object.fromEntries(adminCounts.map((r) => [r.companyId, Number(r.cnt)]));
      const orgMap = Object.fromEntries(orgCounts.map((r) => [r.companyId ?? '', Number(r.cnt)]));

      return reply.send(
        companies.map((c) => ({
          ...c,
          adminCount: adminMap[c.id] ?? 0,
          orgCount: orgMap[c.id] ?? 0,
        })),
      );
    },
  );

  // ── POST /superadmin/management-companies  (platform owner only) ────────────
  app.post(
    '/management-companies',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const body = CreateManagementCompanySchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const caller = req.user as PlatformAdminCaller;
      const { companyName, initialAdminEmail, initialAdminName, plan, allowedModules } = body.data;

      // Slug is set by the admin during first-time onboarding; name is known immediately
      const tempSlug = `pending-${randomToken(4)}`;
      const [company] = await db
        .insert(managementCompanies)
        .values({
          name: companyName,
          slug: tempSlug,
          plan: plan ?? 'basic',
          allowedModules: allowedModules ?? 'signage',
          createdByOwnerId: caller.sub,
        })
        .returning();
      if (!company) return reply.status(500).send({ error: 'Failed to create management company' });

      const token = randomToken();
      await db.insert(managementCompanyAdminInvitations).values({
        managementCompanyId: company.id,
        invitedByOwnerId: caller.sub,
        email: initialAdminEmail.toLowerCase(),
        recipientName: initialAdminName || null,
        role: 'owner',
        token,
        expiresAt: inviteExpiry(7),
      });

      try {
        await sendInviteEmail(initialAdminEmail, token, {
          recipientName: initialAdminName,
          orgRole: 'owner',
          inviteType: 'management_company_admin',
          companyName,
          plan: plan ?? 'basic',
          allowedModules: allowedModules ?? 'signage',
          branding: {
            portalTitle: company.portalTitle ?? null,
            logoUrl: company.logoUrl ?? null,
            primaryColor: company.primaryColor ?? null,
            accentColor: company.accentColor ?? null,
          },
        });
      } catch (err) {
        app.log.error({ err }, 'Failed to send management company admin invite email');
      }

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'system',
        action: 'MANAGEMENT_COMPANY_CREATED',
        entityType: 'management_company',
        entityId: company.id,
        meta: { adminEmail: initialAdminEmail, companyName, plan: plan ?? 'basic', allowedModules: allowedModules ?? 'signage' },
        ipAddress: req.ip,
      });

      return reply.status(201).send({ company, initialInviteSent: true });
    },
  );

  // ── GET /superadmin/management-companies/:id  (owner or own-company MCA) ────
  app.get(
    '/management-companies/:id',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const [adminsRow] = await db
        .select({ total: count() })
        .from(managementCompanyAdmins)
        .where(
          and(
            eq(managementCompanyAdmins.managementCompanyId, id),
            isNull(managementCompanyAdmins.suspendedAt),
          ),
        );
      const [orgsRow] = await db
        .select({ total: count() })
        .from(organizations)
        .where(and(eq(organizations.managementCompanyId, id), isNull(organizations.deletedAt)));

      return reply.send({
        ...company,
        adminCount: Number(adminsRow?.total ?? 0),
        orgCount: Number(orgsRow?.total ?? 0),
      });
    },
  );

  // ── PATCH /superadmin/management-companies/:id  (platform owner only) ───────
  app.patch(
    '/management-companies/:id',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          name: z.string().min(2).max(120).optional(),
          billingEmail: z.string().email().nullable().optional(),
          suspended: z.boolean().optional(),
          plan: z.enum(['basic', 'pro']).optional(),
          allowedModules: z.enum(['signage', 'pos', 'both']).optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Not found' });

      const newSuspendedAt: Date | null =
        body.data.suspended === true
          ? new Date()
          : body.data.suspended === false
            ? null
            : (company.suspendedAt ?? null);

      const [updated] = await db
        .update(managementCompanies)
        .set({
          name: body.data.name ?? company.name,
          billingEmail:
            body.data.billingEmail !== undefined ? body.data.billingEmail : company.billingEmail,
          plan: body.data.plan ?? company.plan,
          allowedModules: body.data.allowedModules ?? company.allowedModules,
          suspendedAt: newSuspendedAt,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanies.id, id))
        .returning();

      // Cascade allowedModules → child organisations' settings.modules so
      // their sidebars reflect the change immediately.
      if (body.data.allowedModules !== undefined && body.data.allowedModules !== company.allowedModules) {
        const childOrgs = await db
          .select({ id: organizations.id, settings: organizations.settings })
          .from(organizations)
          .where(
            and(
              eq(organizations.managementCompanyId, id),
              isNull(organizations.deletedAt),
            ),
          );
        for (const org of childOrgs) {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(org.settings || '{}') as Record<string, unknown>;
          } catch {
            parsed = {};
          }
          parsed.modules = body.data.allowedModules;
          await db
            .update(organizations)
            .set({ settings: JSON.stringify(parsed), updatedAt: new Date() })
            .where(eq(organizations.id, org.id));
        }
      }

      return reply.send(updated);
    },
  );

  // ── DELETE /superadmin/management-companies/:id  (platform owner only) ───
  app.delete(
    '/management-companies/:id',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Not found' });

      const [orgsRow] = await db
        .select({ total: count() })
        .from(organizations)
        .where(and(eq(organizations.managementCompanyId, id), isNull(organizations.deletedAt)));

      const activeOrgCount = Number(orgsRow?.total ?? 0);
      if (activeOrgCount > 0) {
        return reply.status(409).send({
          error: 'Delete blocked. Remove or reassign all client organizations first.',
        });
      }

      const now = new Date();
      const companyAdmins = await db.query.managementCompanyAdmins.findMany({
        where: eq(managementCompanyAdmins.managementCompanyId, id),
        columns: { id: true, email: true, suspendedAt: true },
      });

      await db
        .update(managementCompanies)
        .set({
          slug: deletedSlugTombstone(company.slug),
          deletedAt: now,
          suspendedAt: company.suspendedAt ?? now,
          updatedAt: now,
        })
        .where(eq(managementCompanies.id, id));

      for (const admin of companyAdmins) {
        await db
          .update(managementCompanyAdmins)
          .set({
            email: deletedEmailTombstone(admin.email, admin.id),
            suspendedAt: admin.suspendedAt ?? now,
            updatedAt: now,
          })
          .where(eq(managementCompanyAdmins.id, admin.id));
      }

      await db
        .update(managementCompanyAdminInvitations)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(managementCompanyAdminInvitations.managementCompanyId, id),
            isNull(managementCompanyAdminInvitations.acceptedAt),
            isNull(managementCompanyAdminInvitations.revokedAt),
          ),
        );

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'system',
        action: 'MANAGEMENT_COMPANY_DELETED',
        entityType: 'management_company',
        entityId: id,
        meta: { name: company.name },
        ipAddress: req.ip,
      });

      return reply.status(204).send();
    },
  );

  // ── PATCH /superadmin/management-companies/:id/branding  ──────────────────
  app.patch(
    '/management-companies/:id/branding',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = ManagementCompanyBrandingSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const [updated] = await db
        .update(managementCompanies)
        .set({
          portalTitle:
            body.data.portalTitle !== undefined ? body.data.portalTitle : company.portalTitle,
          logoUrl: body.data.logoUrl !== undefined ? body.data.logoUrl : company.logoUrl,
          faviconUrl:
            body.data.faviconUrl !== undefined ? body.data.faviconUrl : company.faviconUrl,
          primaryColor:
            body.data.primaryColor !== undefined
              ? body.data.primaryColor
              : company.primaryColor,
          accentColor:
            body.data.accentColor !== undefined ? body.data.accentColor : company.accentColor,
          sidebarBg:
            body.data.sidebarBg !== undefined ? body.data.sidebarBg : company.sidebarBg,
          headingFontPreset:
            body.data.headingFontPreset !== undefined
              ? body.data.headingFontPreset
              : company.headingFontPreset,
          bodyFontPreset:
            body.data.bodyFontPreset !== undefined
              ? body.data.bodyFontPreset
              : company.bodyFontPreset,
          loginBackgroundUrl:
            body.data.loginBackgroundUrl !== undefined
              ? body.data.loginBackgroundUrl
              : company.loginBackgroundUrl,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanies.id, id))
        .returning();

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'user',
        action: 'MANAGEMENT_COMPANY_BRANDING_UPDATED',
        entityType: 'management_company',
        entityId: id,
        meta: {
          portalTitle: updated?.portalTitle ?? null,
          logoUrl: updated?.logoUrl ?? null,
          faviconUrl: updated?.faviconUrl ?? null,
          primaryColor: updated?.primaryColor ?? null,
          accentColor: updated?.accentColor ?? null,
          sidebarBg: updated?.sidebarBg ?? null,
          headingFontPreset: updated?.headingFontPreset ?? null,
          bodyFontPreset: updated?.bodyFontPreset ?? null,
          loginBackgroundUrl: updated?.loginBackgroundUrl ?? null,
        },
        ipAddress: req.ip,
      });

      return reply.send(updated);
    },
  );

  // ── POST /superadmin/management-companies/:id/branding-assets/:assetType ───
  app.post(
    '/management-companies/:id/branding-assets/:assetType',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, assetType } = req.params as { id: string; assetType: string };
      const caller = req.user as PlatformAdminCaller;

      if (!BRANDING_ASSET_TYPES.has(assetType)) {
        return reply.status(400).send({ error: 'Unsupported branding asset type' });
      }

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const company = await db.query.managementCompanies.findFirst({
        where: and(eq(managementCompanies.id, id), isNull(managementCompanies.deletedAt)),
        columns: { id: true },
      });
      if (!company) return reply.status(404).send({ error: 'Not found' });

      const file = await req.file();
      if (!file) return reply.status(400).send({ error: 'No file provided' });
      if (!file.mimetype.startsWith('image/')) {
        return reply.status(400).send({ error: 'Branding assets must be image files' });
      }

      const ext = getBrandAssetExtension(file.filename, file.mimetype);
      const relDir = path.join('management_branding', id);
      const relFile = `${assetType}-${randomToken(8)}${ext}`;
      const absDir = path.resolve(STORAGE_ROOT, relDir);
      const absPath = path.resolve(absDir, relFile);

      await fs.mkdir(absDir, { recursive: true });

      let fileSize = 0;
      const writeStream = createWriteStream(absPath);
      for await (const chunk of file.file) {
        writeStream.write(chunk);
        fileSize += chunk.length;
        if (fileSize > 10 * 1024 * 1024) {
          writeStream.destroy();
          await fs.unlink(absPath).catch(() => undefined);
          return reply.status(413).send({ error: 'Branding asset exceeds 10 MB limit' });
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const url = `/api/superadmin/auth/company-assets/${id}/${relFile}`;

      await writeAuditLog({
        actorId: caller.sub,
        actorType: 'user',
        action: 'MANAGEMENT_COMPANY_BRANDING_ASSET_UPLOADED',
        entityType: 'management_company',
        entityId: id,
        meta: { assetType, url },
        ipAddress: req.ip,
      });

      return reply.status(201).send({ assetType, url });
    },
  );

  // ── GET /superadmin/management-companies/:id/admins ─────────────────────────
  app.get(
    '/management-companies/:id/admins',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const admins = await db.query.managementCompanyAdmins.findMany({
        where: eq(managementCompanyAdmins.managementCompanyId, id),
        columns: {
          id: true,
          managementCompanyId: true,
          email: true,
          name: true,
          role: true,
          lastLogin: true,
          suspendedAt: true,
          createdAt: true,
        },
      });

      const pendingInvites = await db.query.managementCompanyAdminInvitations.findMany({
        where: and(
          eq(managementCompanyAdminInvitations.managementCompanyId, id),
          isNull(managementCompanyAdminInvitations.acceptedAt),
          isNull(managementCompanyAdminInvitations.revokedAt),
        ),
        columns: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      });

      return reply.send({ admins, pendingInvites });
    },
  );

  // ── POST /superadmin/management-companies/:id/admins  (invite) ──────────────
  app.post(
    '/management-companies/:id/admins',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = InviteManagementCompanyAdminSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Not found' });

      const token = randomToken();
      await db.insert(managementCompanyAdminInvitations).values({
        managementCompanyId: id,
        invitedByOwnerId: isOwnerCaller(caller) ? caller.sub : null,
        invitedByAdminId: !isOwnerCaller(caller) ? caller.sub : null,
        email: body.data.email.toLowerCase(),
        recipientName: body.data.name || null,
        role: body.data.role,
        token,
        expiresAt: inviteExpiry(7),
      });

      try {
        await sendInviteEmail(body.data.email, token, {
          ...(body.data.name ? { recipientName: body.data.name } : {}),
          orgRole: body.data.role,
          inviteType: 'management_company_admin',
          companyName: company.name,
          branding: {
            portalTitle: company.portalTitle ?? company.name,
            logoUrl: company.logoUrl ?? null,
            primaryColor: company.primaryColor ?? null,
            accentColor: company.accentColor ?? null,
          },
        });
      } catch (err) {
        app.log.error({ err }, 'Failed to send management company admin invite email');
      }

      return reply.status(201).send({
        email: body.data.email,
        role: body.data.role,
        managementCompanyId: id,
      });
    },
  );

  // ── PATCH /superadmin/management-companies/:id/admins/:adminId ──────────────
  app.patch(
    '/management-companies/:id/admins/:adminId',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, adminId } = req.params as { id: string; adminId: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = z
        .object({
          role: z.enum(['owner', 'admin', 'billing']).optional(),
          suspended: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
      const admin = await db.query.managementCompanyAdmins.findFirst({
        where: and(
          eq(managementCompanyAdmins.id, adminId),
          eq(managementCompanyAdmins.managementCompanyId, id),
        ),
      });
      if (!admin) return reply.status(404).send({ error: 'Admin not found' });

      const newSuspendedAt: Date | null =
        body.data.suspended === true
          ? new Date()
          : body.data.suspended === false
            ? null
            : (admin.suspendedAt ?? null);

      const [updated] = await db
        .update(managementCompanyAdmins)
        .set({
          role: body.data.role ?? admin.role,
          suspendedAt: newSuspendedAt,
          updatedAt: new Date(),
        })
        .where(eq(managementCompanyAdmins.id, adminId))
        .returning();

      return reply.send(updated);
    },
  );

  // ── DELETE /superadmin/management-companies/:id/invites/:inviteId ─────────
  app.delete(
    '/management-companies/:id/invites/:inviteId',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, inviteId } = req.params as { id: string; inviteId: string };
      const caller = req.user as PlatformAdminCaller;

      if (!isOwnerCaller(caller) && caller.managementCompanyId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const company = await db.query.managementCompanies.findFirst({
        where: eq(managementCompanies.id, id),
      });
      if (!company || company.deletedAt) return reply.status(404).send({ error: 'Company not found' });

      const invite = await db.query.managementCompanyAdminInvitations.findFirst({
        where: and(
          eq(managementCompanyAdminInvitations.id, inviteId),
          eq(managementCompanyAdminInvitations.managementCompanyId, id),
        ),
      });
      if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
      if (invite.acceptedAt) return reply.status(409).send({ error: 'Invitation already accepted' });

      await db
        .update(managementCompanyAdminInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(managementCompanyAdminInvitations.id, inviteId));

      return reply.status(204).send();
    },
  );

  // ── GET /superadmin/orgs ────────────────────────────────────────────────────
  app.get('/orgs', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const companyId = isOwnerCaller(caller) ? null : caller.managementCompanyId;

    const whereClause = companyId
      ? and(isNull(organizations.deletedAt), eq(organizations.managementCompanyId, companyId))
      : isNull(organizations.deletedAt);

    const orgs = await db.query.organizations.findMany({
      where: whereClause,
      orderBy: [desc(organizations.createdAt)],
    });

    const memberCounts = await db
      .select({ orgId: users.orgId, cnt: count() })
      .from(users)
      .where(isNull(users.deletedAt))
      .groupBy(users.orgId);

    const countMap = Object.fromEntries(memberCounts.map((r) => [r.orgId, Number(r.cnt)]));
    return reply.send(orgs.map((o) => ({ ...o, memberCount: countMap[o.id] ?? 0 })));
  });

  // ── GET /superadmin/orgs/:id ────────────────────────────────────────────────
  app.get('/orgs/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const members = await db.query.users.findMany({
      where: eq(users.orgId, id),
      columns: { id: true, name: true, email: true, orgRole: true, status: true, createdAt: true },
    });

    const pendingInvites = await db.query.clientOrgOwnerInvitations.findMany({
      where: and(
        eq(clientOrgOwnerInvitations.organizationId, id),
        isNull(clientOrgOwnerInvitations.acceptedAt),
        isNull(clientOrgOwnerInvitations.revokedAt),
      ),
      columns: { id: true, email: true, expiresAt: true, createdAt: true },
    });
    const pendingInvitesWithRole = pendingInvites.map((inv) => ({ ...inv, role: 'owner' }));

    return reply.send({ org, members, pendingInvites: pendingInvitesWithRole });
  });

  // ── POST /superadmin/orgs ───────────────────────────────────────────────────
  app.post('/orgs', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;

    const body = z
      .object({
        ownerEmail: z.string().email(),
        ownerName: z.string().min(1).max(120),
        managementCompanyId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const resolvedCompanyId = isOwnerCaller(caller)
      ? (body.data.managementCompanyId ?? null)
      : caller.managementCompanyId;

    if (!resolvedCompanyId) {
      return reply.status(400).send({
        error: 'managementCompanyId is required when creating an org as platform owner',
      });
    }

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, resolvedCompanyId),
    });
    if (!company || company.deletedAt) {
      return reply.status(404).send({ error: 'Management company not found' });
    }

    const tempSlug = `pending-${randomToken(4)}`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: '(pending)',
        slug: tempSlug,
        plan: 'starter',
        status: 'pending',
        managementCompanyId: resolvedCompanyId,
        originatingAdminId: isOwnerCaller(caller) ? null : caller.sub,
        primaryAccountManagerId: isOwnerCaller(caller) ? null : caller.sub,
        billingOwnerCompanyId: resolvedCompanyId,
      })
      .returning();
    if (!org) return reply.status(500).send({ error: 'Failed to create org' });

    const token = randomToken();
    await db.insert(clientOrgOwnerInvitations).values({
      organizationId: org.id,
      managementCompanyId: resolvedCompanyId,
      invitedByOwnerId: isOwnerCaller(caller) ? caller.sub : null,
      invitedByAdminId: isOwnerCaller(caller) ? null : caller.sub,
      email: body.data.ownerEmail.toLowerCase(),
      token,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(body.data.ownerEmail, token, {
        recipientName: body.data.ownerName,
        orgRole: 'owner',
        inviteType: 'client_org_owner',
        companyName: company.name,
        branding: {
          portalTitle: company.portalTitle ?? company.name,
          logoUrl: company.logoUrl ?? null,
          primaryColor: company.primaryColor ?? null,
          accentColor: company.accentColor ?? null,
        },
      });
    } catch (err) {
      app.log.error({ err }, 'Failed to send client org owner invite email');
    }

    await writeAuditLog({
      actorId: caller.sub,
      actorType: 'system',
      action: 'CLIENT_ORG_CREATED',
      entityType: 'organisation',
      entityId: org.id,
      meta: { ownerEmail: body.data.ownerEmail, managementCompanyId: resolvedCompanyId },
      ipAddress: req.ip,
    });

    return reply.status(201).send({
      org: { id: org.id, slug: org.slug, status: org.status, managementCompanyId: resolvedCompanyId },
    });
  });

  // ── PATCH /superadmin/orgs/:id ──────────────────────────────────────────────
  app.patch('/orgs/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        name: z.string().min(2).max(100).optional(),
        plan: z.enum(['basic', 'pro']).optional(),
        modules: z.enum(['signage', 'pos', 'both']).optional(),
        suspended: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const newSuspendedAt: Date | null =
      body.data.suspended === true
        ? new Date()
        : body.data.suspended === false
          ? null
          : (org.suspendedAt ?? null);

    // Merge `modules` into the settings JSON (preserves other settings fields)
    let newSettings = org.settings;
    if (body.data.modules !== undefined) {
      try {
        const parsed = JSON.parse(org.settings || '{}') as Record<string, unknown>;
        parsed.modules = body.data.modules;
        newSettings = JSON.stringify(parsed);
      } catch {
        newSettings = JSON.stringify({ modules: body.data.modules });
      }
    }

    const [updated] = await db
      .update(organizations)
      .set({
        name: body.data.name ?? org.name,
        plan: body.data.plan ?? org.plan,
        settings: newSettings,
        suspendedAt: newSuspendedAt,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /superadmin/orgs/:id  (platform owner only) ─────────────────────
  app.delete('/orgs/:id', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    await db
      .update(organizations)
      .set({
        slug: deletedSlugTombstone(org.slug),
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id));

    await writeAuditLog({
      orgId: id,
      actorId: (req.user as { sub: string }).sub,
      actorType: 'system',
      action: 'ORG_DELETED',
      entityType: 'organisation',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // ── POST /superadmin/orgs/:id/invite ───────────────────────────────────────
  app.post('/orgs/:id/invite', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Org not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(120).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const companyId = org.managementCompanyId ?? (!isOwnerCaller(caller) ? caller.managementCompanyId : null);
    if (!companyId) return reply.status(400).send({ error: 'Org has no management company assigned' });

    const company = await db.query.managementCompanies.findFirst({
      where: eq(managementCompanies.id, companyId),
    });

    const token = randomToken();
    await db.insert(clientOrgOwnerInvitations).values({
      organizationId: id,
      managementCompanyId: companyId,
      invitedByOwnerId: isOwnerCaller(caller) ? caller.sub : null,
      invitedByAdminId: isOwnerCaller(caller) ? null : caller.sub,
      email: body.data.email.toLowerCase(),
      token,
      expiresAt: inviteExpiry(7),
    });

    try {
      await sendInviteEmail(body.data.email, token, {
        ...(body.data.name ? { recipientName: body.data.name } : {}),
        orgRole: 'owner',
        inviteType: 'client_org_owner',
        ...(company?.name ? { companyName: company.name } : {}),
        ...(company
          ? {
              branding: {
                portalTitle: company.portalTitle ?? company.name,
                logoUrl: company.logoUrl ?? null,
                primaryColor: company.primaryColor ?? null,
                accentColor: company.accentColor ?? null,
              },
            }
          : {}),
      });
    } catch (err) {
      app.log.error({ err }, 'Failed to send client org owner invite email');
    }

    return reply.status(201).send({ email: body.data.email });
  });

  // ── DELETE /superadmin/orgs/:id/invites/:inviteId ──────────────────────────
  app.delete(
    '/orgs/:id/invites/:inviteId',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id, inviteId } = req.params as { id: string; inviteId: string };
      const caller = req.user as PlatformAdminCaller;

      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
      if (!org || org.deletedAt) return reply.status(404).send({ error: 'Org not found' });

      if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const invite = await db.query.clientOrgOwnerInvitations.findFirst({
        where: and(
          eq(clientOrgOwnerInvitations.id, inviteId),
          eq(clientOrgOwnerInvitations.organizationId, id),
        ),
      });
      if (!invite) return reply.status(404).send({ error: 'Invitation not found' });
      if (invite.acceptedAt) return reply.status(409).send({ error: 'Invitation already accepted' });

      await db
        .update(clientOrgOwnerInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(clientOrgOwnerInvitations.id, inviteId));

      return reply.status(204).send();
    },
  );

  // ── GET /superadmin/analytics ───────────────────────────────────────────────
  app.get('/analytics', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const q = req.query as { from?: string; to?: string; compare?: 'none' | 'previous_period' };
    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));

    return reply.send(await buildPortalAnalyticsResponse(caller, from, to, q.compare ?? 'previous_period'));
  });

  app.get('/analytics/preferences', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    return reply.send(await getPortalAnalyticsSettings(caller));
  });

  app.put('/analytics/preferences', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const body = z.object({
      thresholds: z.object({
        storageUsagePct: z.number().min(1).max(100),
        storageGrowthPct: z.number().min(1).max(500),
        storageSevereUsagePct: z.number().min(1).max(100),
        onlineDeviceDropCount: z.number().min(1).max(10_000),
        severeOnlineDeviceDropCount: z.number().min(1).max(10_000),
        playDropPct: z.number().min(1).max(100),
        severePlayDropPct: z.number().min(1).max(100),
      }),
      notifications: z.object({
        storageGrowth: z.boolean(),
        deviceDrop: z.boolean(),
        playAnomaly: z.boolean(),
      }),
      repeatHours: z.number().min(1).max(168),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const actor = getPortalAnalyticsActor(caller);
    const existing = await db.query.portalAnalyticsPreferences.findFirst({
      where: and(
        eq(portalAnalyticsPreferences.actorType, actor.actorType),
        eq(portalAnalyticsPreferences.actorId, actor.actorId),
      ),
    });

    if (existing) {
      await db.update(portalAnalyticsPreferences)
        .set({ settings: body.data, updatedAt: new Date() })
        .where(eq(portalAnalyticsPreferences.id, existing.id));
    } else {
      await db.insert(portalAnalyticsPreferences).values({
        actorType: actor.actorType,
        actorId: actor.actorId,
        settings: body.data,
      });
    }

    return reply.send(body.data);
  });

  app.get('/analytics/presets', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);

    const presets = await db.query.portalAnalyticsDrilldownPresets.findMany({
      where: and(
        eq(portalAnalyticsDrilldownPresets.actorType, actor.actorType),
        eq(portalAnalyticsDrilldownPresets.actorId, actor.actorId),
      ),
      orderBy: [desc(portalAnalyticsDrilldownPresets.pinned), desc(portalAnalyticsDrilldownPresets.updatedAt)],
    });

    return reply.send(presets);
  });

  app.post('/analytics/presets', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);
    const body = z.object({
      name: z.string().min(1).max(120),
      orgId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      view: z.enum(['workspace', 'devices', 'content', 'analytics']),
      searchParams: z.record(z.string()).optional(),
      pinned: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, body.data.orgId) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Organization not found' });
    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, body.data.workspaceId), eq(workspaces.orgId, body.data.orgId), isNull(workspaces.deletedAt)),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const [created] = await db.insert(portalAnalyticsDrilldownPresets).values({
      actorType: actor.actorType,
      actorId: actor.actorId,
      name: body.data.name,
      orgId: body.data.orgId,
      workspaceId: body.data.workspaceId,
      view: body.data.view,
      searchParams: body.data.searchParams ?? {},
      pinned: body.data.pinned ?? false,
    }).returning();

    return reply.status(201).send(created);
  });

  app.delete('/analytics/presets/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);
    const { id } = req.params as { id: string };

    const existing = await db.query.portalAnalyticsDrilldownPresets.findFirst({ where: eq(portalAnalyticsDrilldownPresets.id, id) });
    if (!existing) return reply.status(404).send({ error: 'Preset not found' });
    if (existing.actorType !== actor.actorType || existing.actorId !== actor.actorId) {
      return reply.status(404).send({ error: 'Preset not found' });
    }

    await db.delete(portalAnalyticsDrilldownPresets).where(eq(portalAnalyticsDrilldownPresets.id, id));
    return reply.status(204).send();
  });

  app.get('/notifications', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);
    const q = req.query as { page?: string; limit?: string };
    const page = Math.max(1, parseInt(q.page ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10)));
    const offset = (page - 1) * limit;

    const base = and(
      eq(platformAdminNotifications.actorType, actor.actorType),
      eq(platformAdminNotifications.actorId, actor.actorId),
      eq(platformAdminNotifications.dismissed, false),
    );

    const notifications = await db.query.platformAdminNotifications.findMany({
      where: base,
      orderBy: [desc(platformAdminNotifications.createdAt)],
      limit,
      offset,
    });

    const [totalRow] = await db.select({ total: count() }).from(platformAdminNotifications).where(base);
    const [unreadRow] = await db.select({ total: count() }).from(platformAdminNotifications).where(and(base, isNull(platformAdminNotifications.readAt)));

    return reply.send({
      notifications,
      total: Number(totalRow?.total ?? 0),
      unreadCount: Number(unreadRow?.total ?? 0),
      page,
      limit,
    });
  });

  app.patch('/notifications/:id/read', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);
    const { id } = req.params as { id: string };

    const existing = await db.query.platformAdminNotifications.findFirst({ where: eq(platformAdminNotifications.id, id) });
    if (!existing || existing.actorType !== actor.actorType || existing.actorId !== actor.actorId) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const [updated] = await db.update(platformAdminNotifications)
      .set({ readAt: new Date() })
      .where(eq(platformAdminNotifications.id, id))
      .returning();

    return reply.send({ notification: updated });
  });

  app.post('/notifications/mark-all-read', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);

    await db.update(platformAdminNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(platformAdminNotifications.actorType, actor.actorType),
        eq(platformAdminNotifications.actorId, actor.actorId),
        isNull(platformAdminNotifications.readAt),
      ));

    return reply.send({ ok: true });
  });

  app.delete('/notifications/:id', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const actor = getPortalAnalyticsActor(caller);
    const { id } = req.params as { id: string };
    const existing = await db.query.platformAdminNotifications.findFirst({ where: eq(platformAdminNotifications.id, id) });
    if (!existing || existing.actorType !== actor.actorType || existing.actorId !== actor.actorId) {
      return reply.status(404).send({ error: 'Not found' });
    }

    await db.update(platformAdminNotifications)
      .set({ dismissed: true })
      .where(eq(platformAdminNotifications.id, id));

    return reply.status(204).send();
  });

  app.get('/analytics/export.csv', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as PlatformAdminCaller;
    const q = req.query as { from?: string; to?: string; compare?: 'none' | 'previous_period' };
    const to = parseDate(q.to, new Date());
    const from = parseDate(q.from, new Date(to.getTime() - 30 * 86_400_000));
    const payload = await buildPortalAnalyticsResponse(caller, from, to, q.compare ?? 'previous_period');

    const rows: Array<Record<string, string | number | null>> = [];

    rows.push({
      section: 'meta',
      label: 'scope',
      value: payload.scope,
      previousValue: payload.comparison?.mode === 'previous_period' ? 'previous_period' : null,
      delta: null,
      percentChange: null,
      name: null,
      slug: null,
      resellerName: null,
      organizations: null,
      devices: null,
      users: null,
      plays: null,
      storageUsedBytes: null,
      createdAt: payload.from,
      date: payload.to,
      durationMs: null,
      status: null,
      href: null,
    });

    for (const [key, value] of Object.entries(payload.summary)) {
      const delta = payload.comparison?.deltas[key] ?? null;
      rows.push({
        section: 'summary',
        label: key,
        value,
        previousValue: delta?.previous ?? null,
        delta: delta?.change ?? null,
        percentChange: delta?.percentChange ?? null,
        name: null,
        slug: null,
        resellerName: null,
        organizations: null,
        devices: null,
        users: null,
        plays: null,
        storageUsedBytes: null,
        createdAt: null,
        date: null,
        durationMs: null,
        status: null,
        href: null,
      });
    }

    for (const row of payload.playsByDay) {
      rows.push({
        section: 'plays_by_day',
        label: row.date,
        value: row.plays,
        previousValue: null,
        delta: null,
        percentChange: null,
        name: null,
        slug: null,
        resellerName: null,
        organizations: null,
        devices: null,
        users: null,
        plays: row.plays,
        storageUsedBytes: null,
        createdAt: null,
        date: row.date,
        durationMs: row.durationMs,
        status: null,
        href: null,
      });
    }

    for (const row of payload.topResellers) {
      rows.push({
        section: 'top_resellers',
        label: row.name,
        value: row.orgCount,
        previousValue: null,
        delta: null,
        percentChange: null,
        name: row.name,
        slug: null,
        resellerName: row.name,
        organizations: row.orgCount,
        devices: row.deviceCount,
        users: row.userCount,
        plays: null,
        storageUsedBytes: row.storageUsedBytes,
        createdAt: null,
        date: null,
        durationMs: null,
        status: null,
        href: `/superadmin/companies/${row.companyId}`,
      });
    }

    for (const row of payload.topOrganizations) {
      rows.push({
        section: 'top_organizations',
        label: row.name,
        value: row.playCount,
        previousValue: null,
        delta: null,
        percentChange: null,
        name: row.name,
        slug: row.slug,
        resellerName: row.resellerName,
        organizations: row.workspaceCount,
        devices: row.deviceCount,
        users: row.userCount,
        plays: row.playCount,
        storageUsedBytes: row.storageUsedBytes,
        createdAt: row.createdAt,
        date: null,
        durationMs: null,
        status: row.status,
        href: payload.scope === 'platform_owner' ? `/superadmin/orgs/${row.orgId}` : `/management/orgs/${row.orgId}`,
      });
    }

    for (const row of payload.recentOrganizations) {
      rows.push({
        section: 'recent_organizations',
        label: row.name,
        value: row.status,
        previousValue: null,
        delta: null,
        percentChange: null,
        name: row.name,
        slug: row.slug,
        resellerName: row.resellerName,
        organizations: null,
        devices: null,
        users: null,
        plays: null,
        storageUsedBytes: null,
        createdAt: row.createdAt,
        date: null,
        durationMs: null,
        status: row.status,
        href: payload.scope === 'platform_owner' ? `/superadmin/orgs/${row.orgId}` : `/management/orgs/${row.orgId}`,
      });
    }

    const headers = [
      'section', 'label', 'value', 'previousValue', 'delta', 'percentChange', 'name', 'slug',
      'resellerName', 'organizations', 'devices', 'users', 'plays', 'storageUsedBytes',
      'createdAt', 'date', 'durationMs', 'status', 'href',
    ];
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
    ].join('\r\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${payload.scope}-analytics-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`);
    return reply.send(csv);
  });

  // ── GET /superadmin/orgs/:id/quota ─────────────────────────────────────────
  app.get('/orgs/:id/quota', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });
    const defaults: Record<string, number> = {
      basic: 5_368_709_120,
      starter: 5_368_709_120, // legacy alias
      pro: 53_687_091_200,
    };

    return reply.send(
      quota ?? {
        orgId: id,
        limitBytes: defaults[org.plan] ?? defaults['basic'],
        usedBytes: 0,
        alertThresholdPct: 90,
      },
    );
  });

  // ── PATCH /superadmin/orgs/:id/quota ───────────────────────────────────────
  app.patch('/orgs/:id/quota', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as PlatformAdminCaller;

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });

    if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z
      .object({
        limitBytes: z.number().int().positive(),
        alertThresholdPct: z.number().int().min(50).max(99).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const existing = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, id),
    });

    let quota;
    if (existing) {
      [quota] = await db
        .update(orgStorageQuotas)
        .set({
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? existing.alertThresholdPct,
          updatedAt: new Date(),
        })
        .where(eq(orgStorageQuotas.orgId, id))
        .returning();
    } else {
      [quota] = await db
        .insert(orgStorageQuotas)
        .values({
          orgId: id,
          limitBytes: body.data.limitBytes,
          alertThresholdPct: body.data.alertThresholdPct ?? 90,
        })
        .returning();
    }

    await writeAuditLog({
      orgId: id,
      actorId: caller.sub,
      actorType: 'system',
      action: 'QUOTA_UPDATED',
      entityType: 'organisation',
      entityId: id,
      meta: { limitBytes: body.data.limitBytes },
      ipAddress: req.ip,
    });

    return reply.send(quota);
  });

  // ── GET /superadmin/system/health  (platform owner only) ───────────────────
  app.get(
    '/system/health',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      return reply.send(await buildSystemHealthPayload());
    },
  );

  app.get(
    '/system/storage-report.csv',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      const report = await buildSystemHealthPayload();
      const lines = [
        ['section', 'label', 'sub_label', 'bytes', 'count', 'last_timestamp'],
        ...report.storage.orgTotals.map((row: {
          orgId: string;
          orgName: string | null;
          workspaceUploadBytes: number;
          screenshotBytes: number;
          screenshotCount: number;
          totalBytes: number;
        }) => [
          'org_total',
          row.orgName ?? row.orgId,
          `${row.orgId} | uploads=${row.workspaceUploadBytes} | screenshots=${row.screenshotBytes}`,
          row.totalBytes,
          row.screenshotCount,
          '',
        ]),
        ...report.storage.workspaceUploads.map((row) => [
          'workspace_upload',
          row.workspaceName,
          row.orgName ? `${row.orgName} | ${row.workspaceId}` : row.workspaceId,
          row.bytes,
          '',
          '',
        ]),
        ...report.storage.screenshotUsage.map((row) => [
          'device_screenshot',
          row.deviceName,
          row.workspaceName
            ? `${row.orgName ?? ''} | ${row.workspaceName} | ${row.deviceId}`
            : `${row.orgName ?? ''} | ${row.deviceId}`,
          row.bytes,
          row.screenshotCount,
          row.lastScreenshotAt ?? '',
        ]),
        ...report.storage.managementBranding.map((row) => [
          'management_branding',
          row.companyName,
          row.companySlug ? `${row.companySlug} | ${row.managementCompanyId}` : row.managementCompanyId,
          row.bytes,
          '',
          '',
        ]),
      ];

      const csv = lines
        .map((line) => line.map((value: string | number | null | undefined) => csvEscape(value)).join(','))
        .join('\n');

      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="system-storage-report-${new Date().toISOString().slice(0, 10)}.csv"`);
      return reply.send(csv);
    },
  );

  // ── POST /superadmin/orgs/:id/impersonate  (platform owner or scoped MCA) ───
  app.post(
    '/orgs/:id/impersonate',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const caller = req.user as PlatformAdminCaller;
      const { id } = req.params as { id: string };

      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
      if (!org || org.deletedAt) return reply.status(404).send({ error: 'Organization not found' });
      if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      if (org.suspendedAt) return reply.status(409).send({ error: 'Organization is suspended' });

      const owner = await db.query.users.findFirst({
        where: and(
          eq(users.orgId, id),
          inArray(users.orgRole, ['owner', 'admin']),
          isNull(users.deletedAt),
        ),
        orderBy: [sql`CASE WHEN ${users.orgRole} = 'owner' THEN 1 ELSE 2 END`],
      });
      if (!owner)
        return reply.status(404).send({ error: 'No admin-level user found in organization' });

      const accessToken = app.jwt.sign(
        {
          sub: owner.id,
          orgId: id,
          role: owner.orgRole,
          email: owner.email,
          name: owner.name ?? '',
          type: 'user',
          impersonatedBy: caller.sub,
        },
        { expiresIn: '2h' },
      );

      setMainAccessCookie(reply, accessToken);
      setMainCsrfCookie(reply);
      clearMainRefreshCookie(reply);

      await writeAuditLog({
        orgId: id,
        actorId: caller.sub,
        actorType: 'system',
        action: 'IMPERSONATE_ORG',
        entityType: 'organisation',
        entityId: id,
        ipAddress: req.ip,
        meta: { impersonatedUserId: owner.id, impersonatedEmail: owner.email },
      });

      return reply.send({
        org: { id: org.id, name: org.name, slug: org.slug },
        user: {
          id: owner.id,
          email: owner.email,
          name: owner.name,
          role: owner.orgRole,
          impersonatedBy: caller.sub,
        },
      });
    },
  );

  // ── GET /superadmin/orgs/:id/devices ────────────────────────────────────────
  app.get(
    '/orgs/:id/devices',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const caller  = req.user as PlatformAdminCaller;

      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
      if (!org || org.deletedAt) return reply.status(404).send({ error: 'Not found' });
      if (!isOwnerCaller(caller) && org.managementCompanyId !== caller.managementCompanyId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const list = await db
        .select({ id: devices.id, name: devices.name, status: devices.status })
        .from(devices)
        .where(and(eq(devices.orgId, id), isNull(devices.deletedAt)))
        .orderBy(asc(devices.name));

      return reply.send(list);
    },
  );

  // =========================================================================
  // SUPPORT TICKETS — Superadmin (platform_owner) routes
  // =========================================================================

  // ── GET /superadmin/support/tickets ────────────────────────────────────────
  app.get(
    '/support/tickets',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { status, category, partyType, companyId, orgId, page } = req.query as {
        status?: string; category?: string; partyType?: string;
        companyId?: string; orgId?: string; page?: string;
      };
      const pageNum = Math.max(1, parseInt(page ?? '1', 10));
      const limit = 40;
      const offset = (pageNum - 1) * limit;

      const filters = [
        status    ? sql`t.status = ${status}`                       : undefined,
        category  ? sql`t.category = ${category}`                   : undefined,
        partyType ? sql`t.party_type = ${partyType}`                : undefined,
        companyId ? sql`t.company_id = ${companyId}::uuid`          : undefined,
        orgId     ? sql`t.org_id = ${orgId}::uuid`                  : undefined,
      ].filter(Boolean);

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = await db.execute<{
        id: string; party_type: string; company_id: string | null; org_id: string | null;
        party_name: string; submitted_by_name: string; submitted_by_email: string;
        category: string; subject: string; status: string; priority: string;
        assigned_to_owner_id: string | null; closed_at: string | null;
        message_count: number; created_at: string; updated_at: string;
      }>(sql`
        SELECT t.id, t.party_type, t.company_id, t.org_id,
          COALESCE(mc.name, o.name, 'Unknown') AS party_name,
          t.submitted_by_name, t.submitted_by_email,
          t.category, t.subject, t.status, t.priority,
          t.assigned_to_owner_id, t.closed_at,
          (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count,
          t.created_at, t.updated_at
        FROM support_tickets t
        LEFT JOIN management_companies mc ON mc.id = t.company_id
        LEFT JOIN organisations o ON o.id = t.org_id
        ${whereClause}
        ORDER BY t.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const totalRows = await db.execute<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total FROM support_tickets t ${whereClause}
      `);
      const total = (totalRows[0] as { total: number } | undefined)?.total ?? 0;

      return reply.send({ tickets: rows, total, page: pageNum, limit });
    },
  );

  // ── GET /superadmin/support/unread-count ───────────────────────────────────
  // Returns tickets that have at least one message from a non-superadmin sender
  // posted after the last superadmin reply (or after ticket creation if no SA reply).
  app.get(
    '/support/unread-count',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      const unreadRows = await db.execute<{ unread: number }>(sql`
        SELECT COUNT(DISTINCT t.id)::int AS unread
        FROM support_tickets t
        WHERE t.status NOT IN ('resolved', 'closed')
          AND EXISTS (
            SELECT 1 FROM support_ticket_messages m
            WHERE m.ticket_id = t.id
              AND m.sender_type != 'superadmin'
              AND m.created_at > COALESCE(
                (SELECT MAX(m2.created_at) FROM support_ticket_messages m2
                 WHERE m2.ticket_id = t.id AND m2.sender_type = 'superadmin'),
                t.created_at - INTERVAL '1 second'
              )
          )
      `);
      const unread = (unreadRows[0] as { unread: number } | undefined)?.unread ?? 0;
      return reply.send({ unread });
    },
  );

  // ── POST /superadmin/support/tickets ───────────────────────────────────────
  app.post(
    '/support/tickets',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const caller = req.user as PlatformAdminCaller;
      const body = CreateSupportTicketSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const { partyType, companyId, orgId, category, subject, priority, message } = body.data;

      if (partyType === 'management_company' && !companyId) {
        return reply.status(400).send({ error: 'companyId required for management_company tickets' });
      }
      if (partyType === 'client_org' && !orgId) {
        return reply.status(400).send({ error: 'orgId required for client_org tickets' });
      }

      const [ticket] = await db.insert(supportTickets).values({
        partyType,
        companyId: companyId ?? null,
        orgId: orgId ?? null,
        submittedByAdminId: null,
        submittedByUserId: null,
        submittedByName: caller.name ?? 'Platform Admin',
        submittedByEmail: caller.email,
        category,
        subject,
        priority: priority ?? 'medium',
        assignedToOwnerId: caller.sub,
      }).returning();

      if (message) {
        await db.insert(supportTicketMessages).values({
          ticketId: ticket!.id,
          senderType: 'superadmin',
          senderId: caller.sub,
          senderName: caller.name ?? 'Platform Admin',
          body: message,
        });
      }

      // Email the target party
      const notifyEmail = await resolvePartyEmail(companyId ?? null, orgId ?? null);
      if (notifyEmail) {
        void sendSupportNotificationEmail({
          to: notifyEmail.email,
          recipientName: notifyEmail.name,
          subject,
          body: message ?? '',
          ticketId: ticket!.id,
          notifyTarget: partyType === 'management_company' ? 'reseller' : 'client',
        }).catch(() => undefined);
      }

      return reply.status(201).send({ ticket: ticket! });
    },
  );

  // ── GET /superadmin/support/tickets/:id ────────────────────────────────────
  app.get(
    '/support/tickets/:id',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

      const messages = await db.query.supportTicketMessages.findMany({
        where: eq(supportTicketMessages.ticketId, id),
        orderBy: asc(supportTicketMessages.createdAt),
      });

      const partyName = await resolvePartyName(ticket.companyId, ticket.orgId);

      return reply.send({
        ...ticket,
        partyName,
        messages: messages.map(formatMessage),
      });
    },
  );

  // ── POST /superadmin/support/tickets/:id/messages ─────────────────────────
  app.post(
    '/support/tickets/:id/messages',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const caller = req.user as PlatformAdminCaller;
      const { id } = req.params as { id: string };
      const body = ReplyToTicketSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
      if (ticket.status === 'closed') {
        return reply.status(409).send({ error: 'Cannot reply to a closed ticket' });
      }

      const [msg] = await db.insert(supportTicketMessages).values({
        ticketId: id,
        senderType: 'superadmin',
        senderId: caller.sub,
        senderName: caller.name ?? 'Platform Admin',
        body: body.data.body,
        attachmentUrls: body.data.attachmentUrls?.join('\n') ?? null,
      }).returning();

      await db.update(supportTickets).set({ updatedAt: new Date() }).where(eq(supportTickets.id, id));

      // Notify the other party
      void sendSupportNotificationEmail({
        to: ticket.submittedByEmail,
        recipientName: ticket.submittedByName,
        subject: ticket.subject,
        body: body.data.body,
        ticketId: id,
        notifyTarget: ticket.partyType === 'management_company' ? 'reseller' : 'client',
      }).catch(() => undefined);

      return reply.status(201).send({ message: formatMessage(msg!) });
    },
  );

  // ── PATCH /superadmin/support/tickets/:id ─────────────────────────────────
  app.patch(
    '/support/tickets/:id',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdateTicketSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.data.status !== undefined) {
        updates['status'] = body.data.status;
        if (body.data.status === 'closed') updates['closedAt'] = new Date();
        else if (ticket.status === 'closed') updates['closedAt'] = null;
      }
      if (body.data.priority !== undefined) updates['priority'] = body.data.priority;
      if ('assignedToOwnerId' in body.data) updates['assignedToOwnerId'] = body.data.assignedToOwnerId;

      await db.update(supportTickets).set(updates).where(eq(supportTickets.id, id));

      return reply.send({ ok: true });
    },
  );

  // =========================================================================
  // SUPPORT TICKETS — Reseller (management_company_admin) routes
  // All under /support/reseller/* — auth: authenticateManagementCompanyAdmin
  // =========================================================================

  // ── GET /superadmin/support/reseller/tickets ───────────────────────────────
  app.get(
    '/support/reseller/tickets',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const { status, category } = req.query as { status?: string; category?: string };

      const filters = [
        sql`(t.company_id = ${caller.managementCompanyId}::uuid OR t.org_id IN (
          SELECT id FROM organisations WHERE management_company_id = ${caller.managementCompanyId}::uuid
        ))`,
        status   ? sql`t.status = ${status}`   : undefined,
        category ? sql`t.category = ${category}` : undefined,
      ].filter(Boolean);

      const rows = await db.execute<{
        id: string; party_type: string; company_id: string | null; org_id: string | null;
        party_name: string; submitted_by_name: string;
        category: string; subject: string; status: string; priority: string;
        message_count: number; created_at: string; updated_at: string;
      }>(sql`
        SELECT t.id, t.party_type, t.company_id, t.org_id,
          COALESCE(mc.name, o.name, 'Unknown') AS party_name,
          t.submitted_by_name,
          t.category, t.subject, t.status, t.priority,
          (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count,
          t.created_at, t.updated_at
        FROM support_tickets t
        LEFT JOIN management_companies mc ON mc.id = t.company_id
        LEFT JOIN organisations o ON o.id = t.org_id
        WHERE ${sql.join(filters, sql` AND `)}
        ORDER BY t.updated_at DESC
        LIMIT 100
      `);

      return reply.send({ tickets: rows });
    },
  );

  // ── GET /superadmin/support/reseller/unread-count ─────────────────────────
  app.get(
    '/support/reseller/unread-count',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const resellerUnreadRows = await db.execute<{ unread: number }>(sql`
        SELECT COUNT(DISTINCT t.id)::int AS unread
        FROM support_tickets t
        WHERE t.status NOT IN ('resolved', 'closed')
          AND (
            t.company_id = ${caller.managementCompanyId}::uuid
            OR t.org_id IN (SELECT id FROM organisations WHERE management_company_id = ${caller.managementCompanyId}::uuid)
          )
          AND EXISTS (
            SELECT 1 FROM support_ticket_messages m
            WHERE m.ticket_id = t.id
              AND m.sender_type = 'superadmin'
              AND m.created_at > COALESCE(
                (SELECT MAX(m2.created_at) FROM support_ticket_messages m2
                 WHERE m2.ticket_id = t.id AND m2.sender_type != 'superadmin'),
                t.created_at - INTERVAL '1 second'
              )
          )
      `);
      const unread = (resellerUnreadRows[0] as { unread: number } | undefined)?.unread ?? 0;
      return reply.send({ unread });
    },
  );

  // ── POST /superadmin/support/reseller/tickets ─────────────────────────────
  app.post(
    '/support/reseller/tickets',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const body = CreateSupportTicketSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const { category, subject, priority, message, orgId } = body.data;

      // If opening on behalf of a client org, validate the org belongs to this company
      if (orgId) {
        const org = await db.query.organizations.findFirst({
          where: and(
            eq(organizations.id, orgId),
            eq(organizations.managementCompanyId, caller.managementCompanyId),
            isNull(organizations.deletedAt),
          ),
          columns: { id: true },
        });
        if (!org) return reply.status(403).send({ error: 'Org does not belong to your company' });
      }

      const [ticket] = await db.insert(supportTickets).values({
        partyType: orgId ? 'client_org' : 'management_company',
        companyId: caller.managementCompanyId,
        orgId: orgId ?? null,
        submittedByAdminId: caller.sub,
        submittedByName: caller.name ?? caller.email,
        submittedByEmail: caller.email,
        category,
        subject,
        priority: priority ?? 'medium',
      }).returning();

      if (message) {
        await db.insert(supportTicketMessages).values({
          ticketId: ticket!.id,
          senderType: 'reseller',
          senderId: caller.sub,
          senderName: caller.name ?? caller.email,
          body: message,
        });
      }

      // Notify superadmin
      void notifySuperAdmins(subject, message ?? '', ticket!.id).catch(() => undefined);

      return reply.status(201).send({ ticket: ticket! });
    },
  );

  // ── GET /superadmin/support/reseller/tickets/:id ──────────────────────────
  app.get(
    '/support/reseller/tickets/:id',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const { id } = req.params as { id: string };
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

      const allowed =
        ticket.companyId === caller.managementCompanyId ||
        (ticket.orgId && await db.query.organizations.findFirst({
          where: and(
            eq(organizations.id, ticket.orgId),
            eq(organizations.managementCompanyId, caller.managementCompanyId),
          ),
          columns: { id: true },
        }).then(Boolean));

      if (!allowed) return reply.status(403).send({ error: 'Forbidden' });

      const messages = await db.query.supportTicketMessages.findMany({
        where: eq(supportTicketMessages.ticketId, id),
        orderBy: asc(supportTicketMessages.createdAt),
      });

      return reply.send({ ...ticket, messages: messages.map(formatMessage) });
    },
  );

  // ── POST /superadmin/support/reseller/tickets/:id/messages ────────────────
  app.post(
    '/support/reseller/tickets/:id/messages',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const { id } = req.params as { id: string };
      const body = ReplyToTicketSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

      const allowed =
        ticket.companyId === caller.managementCompanyId ||
        (ticket.orgId && await db.query.organizations.findFirst({
          where: and(
            eq(organizations.id, ticket.orgId),
            eq(organizations.managementCompanyId, caller.managementCompanyId),
          ),
          columns: { id: true },
        }).then(Boolean));

      if (!allowed) return reply.status(403).send({ error: 'Forbidden' });
      if (ticket.status === 'closed') return reply.status(409).send({ error: 'Ticket is closed' });

      const [msg] = await db.insert(supportTicketMessages).values({
        ticketId: id,
        senderType: 'reseller',
        senderId: caller.sub,
        senderName: caller.name ?? caller.email,
        body: body.data.body,
        attachmentUrls: body.data.attachmentUrls?.join('\n') ?? null,
      }).returning();

      await db.update(supportTickets)
        .set({ updatedAt: new Date(), ...(ticket.status === 'resolved' ? { status: 'in_progress' } : {}) })
        .where(eq(supportTickets.id, id));

      void notifySuperAdmins(ticket.subject, body.data.body, id).catch(() => undefined);

      return reply.status(201).send({ message: formatMessage(msg!) });
    },
  );

  // ── POST /superadmin/support/reseller/tickets/:id/attachments ─────────────
  app.post(
    '/support/reseller/tickets/:id/attachments',
    { onRequest: [app.authenticateManagementCompanyAdmin] },
    async (req, reply) => {
      const caller = req.user as Extract<PlatformAdminCaller, { type: 'management_company_admin' }>;
      const { id } = req.params as { id: string };
      const ticket = await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
        columns: { id: true, companyId: true },
      });
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
      if (ticket.companyId !== caller.managementCompanyId) return reply.status(403).send({ error: 'Forbidden' });
      return uploadSupportAttachment(req, reply, id);
    },
  );

  // ── POST /superadmin/support/tickets/:id/attachments (owner) ──────────────
  app.post(
    '/support/tickets/:id/attachments',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      return uploadSupportAttachment(req, reply, id);
    },
  );

  // ── GET /superadmin/support/attachments/:ticketId/:filename ───────────────
  app.get(
    '/support/attachments/:ticketId/:filename',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { ticketId, filename } = req.params as { ticketId: string; filename: string };
      // Validate file belongs to a message in this ticket
      const msgs = await db.query.supportTicketMessages.findMany({
        where: eq(supportTicketMessages.ticketId, ticketId),
        columns: { attachmentUrls: true },
      });
      const allUrls = msgs.flatMap(m => (m.attachmentUrls ?? '').split('\n').filter(Boolean));
      const expected = `/api/v1/superadmin/support/attachments/${ticketId}/${filename}`;
      if (!allUrls.includes(expected)) return reply.status(404).send({ error: 'Not found' });

      const absPath = path.resolve(STORAGE_ROOT, 'support_attachments', ticketId, filename);
      const fileBuffer = await fs.readFile(absPath).catch(() => null);
      if (!fileBuffer) return reply.status(404).send({ error: 'File not found' });

      const contentType = getBrandAssetContentType(filename);
      return reply.type(contentType).send(fileBuffer);
    },
  );

  // ── Platform integrations (OAuth app credentials) ────────────────────────

  /** GET /superadmin/integrations/:type — returns config without exposing the secret */
  app.get(
    '/integrations/:type',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { type } = req.params as { type: string };
      const row = await db.query.platformIntegrations.findFirst({
        where: eq(platformIntegrations.type, type),
      });
      return reply.send({
        type,
        clientId:  row?.clientId  ?? null,
        hasSecret: Boolean(row?.clientSecretEnc),
        enabled:   row?.enabled   ?? false,
      });
    },
  );

  /** POST /superadmin/integrations/:type — upsert credentials */
  app.post(
    '/integrations/:type',
    { onRequest: [app.authenticatePlatformAdmin] },
    async (req, reply) => {
      const { type } = req.params as { type: string };
      const ALLOWED_TYPES = new Set(['uber_eats', 'google_calendar', 'microsoft_calendar']);
      if (!ALLOWED_TYPES.has(type)) {
        return reply.status(400).send({ error: 'Unknown integration type' });
      }
      const body = req.body as { clientId?: string; clientSecret?: string; enabled?: boolean };
      const clientId     = typeof body.clientId     === 'string' ? body.clientId.trim()     : undefined;
      const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : undefined;
      const enabled      = typeof body.enabled      === 'boolean' ? body.enabled             : undefined;

      const existing = await db.query.platformIntegrations.findFirst({
        where: eq(platformIntegrations.type, type),
      });

      if (existing) {
        await db.update(platformIntegrations)
          .set({
            ...(clientId     !== undefined ? { clientId }                                    : {}),
            ...(clientSecret !== undefined ? { clientSecretEnc: encryptSecret(clientSecret) ?? undefined } : {}),
            ...(enabled      !== undefined ? { enabled }                                     : {}),
            updatedAt: new Date(),
          })
          .where(eq(platformIntegrations.type, type));
      } else {
        await db.insert(platformIntegrations).values({
          type,
          clientId:        clientId        ?? null,
          clientSecretEnc: clientSecret ? (encryptSecret(clientSecret) ?? null) : null,
          enabled:         enabled ?? true,
        });
      }

      if (type === 'uber_eats') bustUberCredCache();
      return reply.status(204).send();
    },
  );

  // ── License config ── GET/PUT /superadmin/license-config ─────────────────
  // Management admins (and platform owners) can read and update the license
  // credentials. The HMAC secret is stored encrypted; it is never returned
  // in GET (only a masked hint so the UI can show it is set).

  app.get('/license-config', async (req, reply) => {
    const caller = getPortalCaller(app, req);
    if (!caller) return reply.status(401).send({ error: 'Unauthorized' });

    const row = await db.query.licenseConfig.findFirst();
    if (!row) {
      return reply.send({ configured: false });
    }

    return reply.send({
      configured: true,
      licenseKey: row.licenseKey,
      hmacSecretSet: !!row.hmacSecret,
      licenseServerUrl: row.licenseServerUrl,
      isEnabled: row.isEnabled,
      lastStatus: row.lastStatus,
      lastCheckedAt: row.lastCheckedAt,
      lastError: row.lastError,
    });
  });

  app.put('/license-config', async (req, reply) => {
    const caller = getPortalCaller(app, req);
    if (!caller) return reply.status(401).send({ error: 'Unauthorized' });

    const body = z.object({
      licenseKey: z.string().min(1).max(100).optional(),
      hmacSecret: z.string().min(1).max(500).optional(),
      licenseServerUrl: z.string().url().max(500).optional(),
      isEnabled: z.boolean().optional(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const { licenseKey, hmacSecret, licenseServerUrl, isEnabled } = body.data;

    const existing = await db.query.licenseConfig.findFirst();

    const patch = {
      ...(licenseKey !== undefined ? { licenseKey } : {}),
      ...(hmacSecret !== undefined ? { hmacSecret: encryptSecret(hmacSecret) } : {}),
      ...(licenseServerUrl !== undefined ? { licenseServerUrl } : {}),
      ...(isEnabled !== undefined ? { isEnabled } : {}),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(licenseConfig).set(patch).where(eq(licenseConfig.id, existing.id));
    } else {
      await db.insert(licenseConfig).values({
        licenseKey: licenseKey ?? null,
        hmacSecret: hmacSecret ? (encryptSecret(hmacSecret) ?? null) : null,
        licenseServerUrl: licenseServerUrl ?? null,
        isEnabled: isEnabled ?? true,
      });
    }

    // Trigger an immediate heartbeat after config change
    const { triggerHeartbeat } = await import('../services/license-client.js');
    void triggerHeartbeat();

    return reply.status(204).send();
  });

  // ── License allocations ── GET /superadmin/license-allocations ─────────────
  // Management admins can see all their client orgs with current usage and
  // their allocated screen limits. POST/PUT per-org to set limits.

  app.get('/license-allocations', async (req, reply) => {
    const caller = getPortalCaller(app, req);
    if (!caller) return reply.status(401).send({ error: 'Unauthorized' });

    // Get all orgs belonging to this management company
    const mcaId = caller.type === 'management_company_admin' ? caller.managementCompanyId : null;
    if (!mcaId) return reply.status(403).send({ error: 'Management company admins only' });

    // Orgs managed by this company (via org_subscriptions)
    const managed = await db.query.orgSubscriptions.findMany({
      where: and(
        eq(orgSubscriptions.managedByCompanyId, mcaId),
        eq(orgSubscriptions.status, 'active'),
      ),
      columns: { orgId: true },
    });

    const orgIds = managed.map((m) => m.orgId);
    if (!orgIds.length) return reply.send({ orgs: [] });

    // Fetch org details
    const orgs = await db.query.organizations.findMany({
      where: and(inArray(organizations.id, orgIds), isNull(organizations.deletedAt)),
      columns: { id: true, name: true, slug: true },
    });

    // Fetch existing allocations
    const allocs = await db.query.orgLicenseAllocations.findMany({
      where: inArray(orgLicenseAllocations.orgId, orgIds),
    });
    const allocByOrg = new Map(allocs.map((a) => [a.orgId, a]));

    // Current screen counts per org
    const signageRows = await db
      .select({ orgId: devices.orgId, c: count() })
      .from(devices)
      .where(
        and(
          inArray(devices.orgId, orgIds),
          isNull(devices.deletedAt),
          eq(devices.type, 'signage'),
        ),
      )
      .groupBy(devices.orgId);

    const posRows = await db
      .select({ orgId: devices.orgId, c: count() })
      .from(devices)
      .where(
        and(
          inArray(devices.orgId, orgIds),
          isNull(devices.deletedAt),
          eq(devices.type, 'kiosk'),
        ),
      )
      .groupBy(devices.orgId);

    const sigByOrg = new Map(signageRows.map((r) => [r.orgId, Number(r.c)]));
    const posByOrg  = new Map(posRows.map((r) => [r.orgId, Number(r.c)]));

    const result = orgs.map((org) => {
      const alloc = allocByOrg.get(org.id);
      return {
        orgId:              org.id,
        orgName:            org.name,
        orgSlug:            org.slug,
        maxSignageScreens:  alloc?.maxSignageScreens ?? null,
        maxPosScreens:      alloc?.maxPosScreens     ?? null,
        enabledModules:     alloc?.enabledModules     ?? null,
        notes:              alloc?.notes              ?? null,
        currentSignageScreens: sigByOrg.get(org.id) ?? 0,
        currentPosScreens:     posByOrg.get(org.id)  ?? 0,
      };
    });

    return reply.send({ orgs: result });
  });

  app.put('/license-allocations/:orgId', async (req, reply) => {
    const caller = getPortalCaller(app, req);
    if (!caller) return reply.status(401).send({ error: 'Unauthorized' });
    if (caller.type !== 'management_company_admin') return reply.status(403).send({ error: 'Forbidden' });

    const { orgId } = req.params as { orgId: string };

    // Verify this org belongs to the caller's company
    const sub = await db.query.orgSubscriptions.findFirst({
      where: and(
        eq(orgSubscriptions.orgId, orgId),
        eq(orgSubscriptions.managedByCompanyId, caller.managementCompanyId),
      ),
    });
    if (!sub) return reply.status(404).send({ error: 'Org not found or not managed by your company' });

    const body = z.object({
      maxSignageScreens: z.number().int().min(0).nullable().optional(),
      maxPosScreens:     z.number().int().min(0).nullable().optional(),
      enabledModules:    z.array(z.enum(['signage', 'pos'])).nullable().optional(),
      notes:             z.string().max(500).nullable().optional(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const existing = await db.query.orgLicenseAllocations.findFirst({
      where: eq(orgLicenseAllocations.orgId, orgId),
    });

    const patch = {
      managementCompanyId: caller.managementCompanyId,
      updatedById:         caller.sub,
      updatedAt:           new Date(),
      ...(body.data.maxSignageScreens !== undefined ? { maxSignageScreens: body.data.maxSignageScreens } : {}),
      ...(body.data.maxPosScreens     !== undefined ? { maxPosScreens:     body.data.maxPosScreens }     : {}),
      ...(body.data.enabledModules    !== undefined ? { enabledModules:    body.data.enabledModules }    : {}),
      ...(body.data.notes             !== undefined ? { notes:             body.data.notes }             : {}),
    };

    if (existing) {
      await db.update(orgLicenseAllocations).set(patch).where(eq(orgLicenseAllocations.orgId, orgId));
    } else {
      await db.insert(orgLicenseAllocations).values({ orgId, ...patch });
    }

    return reply.status(204).send();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function uploadSupportAttachment(req: FastifyRequest, reply: FastifyReply, ticketId: string) {
  const file = await req.file();
  if (!file) return reply.status(400).send({ error: 'No file provided' });

  const ALLOWED_MIME = new Set([
    'image/png','image/jpeg','image/webp','image/gif',
    'application/pdf','text/plain','text/csv',
    'application/zip',
  ]);
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return reply.status(400).send({ error: 'File type not allowed' });
  }

  const ext = path.extname(file.filename).toLowerCase() || '.bin';
  const filename = `${randomToken(12)}${ext}`;
  const absDir = path.resolve(STORAGE_ROOT, 'support_attachments', ticketId);
  await fs.mkdir(absDir, { recursive: true });
  const absPath = path.resolve(absDir, filename);

  let fileSize = 0;
  const ws = createWriteStream(absPath);
  for await (const chunk of file.file) {
    ws.write(chunk);
    fileSize += chunk.length;
    if (fileSize > 20 * 1024 * 1024) {
      ws.destroy();
      await fs.unlink(absPath).catch(() => undefined);
      return reply.status(413).send({ error: 'Attachment exceeds 20 MB limit' });
    }
  }
  await new Promise<void>((resolve, reject) => { ws.end(); ws.on('finish', resolve); ws.on('error', reject); });

  const url = `/api/v1/superadmin/support/attachments/${ticketId}/${filename}`;
  return reply.status(201).send({ url });
}

function formatMessage(m: {
  id: string; ticketId: string; senderType: string; senderId: string;
  senderName: string; body: string; attachmentUrls: string | null; createdAt: Date | string;
}) {
  return {
    ...m,
    attachmentUrls: (m.attachmentUrls ?? '').split('\n').filter(Boolean),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
  };
}

async function resolvePartyName(companyId: string | null, orgId: string | null): Promise<string> {
  if (companyId) {
    const c = await db.query.managementCompanies.findFirst({ where: eq(managementCompanies.id, companyId), columns: { name: true } });
    if (c) return c.name;
  }
  if (orgId) {
    const o = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } });
    if (o) return o.name;
  }
  return 'Unknown';
}

async function resolvePartyEmail(companyId: string | null, orgId: string | null) {
  if (companyId) {
    const admin = await db.query.managementCompanyAdmins.findFirst({
      where: and(eq(managementCompanyAdmins.managementCompanyId, companyId), eq(managementCompanyAdmins.role, 'owner')),
      columns: { email: true, name: true },
    });
    if (admin) return { email: admin.email, name: admin.name ?? admin.email };
  }
  if (orgId) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.orgId, orgId), eq(users.orgRole, 'prime_owner'), isNull(users.deletedAt)),
      columns: { email: true, name: true },
    });
    if (user) return { email: user.email, name: user.name ?? user.email };
  }
  return null;
}

async function notifySuperAdmins(subject: string, body: string, ticketId: string) {
  const owners = await db.query.platformOwners.findMany({ columns: { email: true, name: true } });
  await Promise.allSettled(owners.map(o => sendSupportNotificationEmail({
    to: o.email,
    ...(o.name != null ? { recipientName: o.name } : {}),
    subject,
    body,
    ticketId,
    notifyTarget: 'superadmin',
  })));
}
