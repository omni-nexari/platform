import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, logEntries, organizations } from '@signage/db';
import { eq, and, lt, lte, desc, count, sql, inArray } from 'drizzle-orm';
import { logBus } from '../services/log-bus.js';

// ── Constants ─────────────────────────────────────────────────────────────

const VALID_SOURCES = ['api', 'ds', 'tizen', 'tizen-sbb', 'epaper', 'windows', 'android'] as const;
const VALID_LEVELS  = ['debug', 'info', 'warn', 'error'] as const;
const LEVEL_ORDER   = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const MAX_BATCH  = 200;
const MAX_LIMIT  = 500;
const DEF_LIMIT  = 100;
// In production, discard debug entries at ingest. Override with LOG_MIN_LEVEL env var.
const MIN_INGEST_LEVEL = (process.env['LOG_MIN_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug')) as keyof typeof LEVEL_ORDER;

// ── Zod schemas ───────────────────────────────────────────────────────────

const LogEntryInputSchema = z.object({
  level:      z.enum(VALID_LEVELS),
  message:    z.string().max(4_000),
  meta:       z.record(z.unknown()).optional(),
  appVersion: z.string().max(64).optional(),
  createdAt:  z.string().datetime().optional(), // client-side timestamp if provided
});

const IngestBodySchema = z.object({
  entries: z.array(LogEntryInputSchema).min(1).max(MAX_BATCH),
});

// ── Helper ────────────────────────────────────────────────────────────────

function levelOrder(level: string): number {
  return LEVEL_ORDER[level as keyof typeof LEVEL_ORDER] ?? 0;
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function logsRoutes(app: FastifyInstance) {

  /**
   * POST /logs/ingest
   *
   * Accepts a batch of log entries from:
   *  - Authenticated browser users (DS) → source = 'ds'
   *  - Paired Tizen / Tizen-SBB devices → source = 'tizen' | 'tizen-sbb'
   *  - E-paper devices (Tizen 8 e-paper panels) → source = 'epaper'
   *
   * Auth: device JWT (type === 'device')  OR  user session cookie/Bearer.
   */
  app.post('/ingest', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    let resolvedOrgId:    string | null = null;
    let resolvedDeviceId: string | null = null;
    let resolvedUserId:   string | null = null;
    let resolvedSource:   typeof VALID_SOURCES[number];

    // ── Identify caller ──────────────────────────────────────────────────
    if (bearerToken) {
      // Device JWT: { sub: deviceId, type: 'device', orgId, workspaceId, source? }
      let payload: { sub: string; type: string; orgId: string; source?: string };
      try {
        payload = app.jwt.verify<{ sub: string; type: string; orgId: string; source?: string }>(bearerToken);
      } catch {
        return reply.status(401).send({ error: 'Invalid token' });
      }
      if (payload.type !== 'device') {
        return reply.status(403).send({ error: 'Device token required for this endpoint' });
      }

      resolvedDeviceId = payload.sub;
      resolvedOrgId    = payload.orgId;
      const src = (req.body as { source?: string })?.source ?? payload.source;
      const srcMap: Record<string, typeof VALID_SOURCES[number]> = {
        'tizen-sbb': 'tizen-sbb',
        'epaper':    'epaper',
        'windows':   'windows',
        'android':   'android',
        'tizen':     'tizen',
      };
      resolvedSource = srcMap[src ?? ''] ?? 'tizen';
    } else {
      // User session: validate via cookie / user JWT
      try {
        await req.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
      const user = req.user as { sub: string; orgId: string };
      resolvedUserId = user.sub;
      resolvedOrgId  = user.orgId;
      resolvedSource = 'ds';
    }

    // ── Validate body ────────────────────────────────────────────────────
    const parsed = IngestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const minOrder = levelOrder(MIN_INGEST_LEVEL);

    const rows = parsed.data.entries
      .filter((e) => levelOrder(e.level) >= minOrder)
      .map((e) => ({
        source:     resolvedSource,
        level:      e.level,
        message:    e.message,
        meta:       e.meta ?? null,
        orgId:      resolvedOrgId,
        deviceId:   resolvedDeviceId,
        userId:     resolvedUserId,
        appVersion: e.appVersion ?? null,
        createdAt:  e.createdAt ? new Date(e.createdAt) : new Date(),
      }));

    if (rows.length > 0) {
      const inserted = await db.insert(logEntries).values(rows).returning();
      logBus.publish(inserted as Parameters<typeof logBus.publish>[0]);
    }

    return reply.status(204).send();
  });

  /**
   * GET /logs
   *
   * Query log entries.  Accessible to:
   *  - Platform owner  (authenticatePlatformOwner) → sees everything
   *  - Management company admin (authenticateManagementCompanyAdmin) → only their orgs' logs
   *
   * Query params:
   *   source        filter by source ('api' | 'ds' | 'tizen' | 'tizen-sbb' | 'epaper')
   *   min_level     minimum severity ('debug' | 'info' | 'warn' | 'error')
   *   org_id        filter to a specific org  (platform owner only)
   *   device_id     filter to a specific device
   *   before_id     cursor: return rows with id < before_id  (pagination)
   *   limit         number of rows (default 100, max 500)
   */
  app.get('/', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const caller = req.user as { type: string; managementCompanyId?: string };

    const limit    = Math.min(Number(q['limit'] ?? DEF_LIMIT), MAX_LIMIT);
    const beforeId = q['before_id'] ? Number(q['before_id']) : null;
    const minOrder = levelOrder(q['min_level'] ?? 'debug');

    // Build org scope for management company admins
    let allowedOrgIds: string[] | null = null;
    if (caller.type === 'management_company_admin' && caller.managementCompanyId) {
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.managementCompanyId, caller.managementCompanyId),
            sql`${organizations.deletedAt} IS NULL`,
          ),
        );
      allowedOrgIds = orgs.map((o) => o.id);
      if (allowedOrgIds.length === 0) {
        return reply.send({ entries: [], nextCursor: null });
      }
    }

    const conditions = [
      // Level filter
      sql`(CASE
        WHEN ${logEntries.level} = 'debug' THEN 0
        WHEN ${logEntries.level} = 'info'  THEN 1
        WHEN ${logEntries.level} = 'warn'  THEN 2
        WHEN ${logEntries.level} = 'error' THEN 3
        ELSE 0 END) >= ${minOrder}`,
      // Source filter — 'tizen' matches both tizen and tizen-sbb
      q['source'] === 'tizen'
        ? inArray(logEntries.source, ['tizen', 'tizen-sbb'])
        : q['source'] ? eq(logEntries.source, q['source']) : undefined,
      // Org filter
      q['org_id'] && !allowedOrgIds
        ? eq(logEntries.orgId, q['org_id'])
        : undefined,
      // Org scope for management admin
      allowedOrgIds
        ? (q['org_id'] && allowedOrgIds.includes(q['org_id'])
            ? eq(logEntries.orgId, q['org_id'])
            : inArray(logEntries.orgId, allowedOrgIds))
        : undefined,
      // Device filter
      q['device_id'] ? eq(logEntries.deviceId, q['device_id']) : undefined,
      // Cursor
      beforeId ? lt(logEntries.id, beforeId) : undefined,
    ].filter(Boolean) as Parameters<typeof and>[0][];

    const rows = await db
      .select()
      .from(logEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(logEntries.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page    = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

    return reply.send({ entries: page, nextCursor });
  });

  /**
   * GET /logs/ws-token
   *
   * Returns the caller's session token for use as a WebSocket query-param.
   * Browsers cannot inject custom headers on WebSocket connections, and Secure
   * cookies are not sent over ws:// (plain HTTP LAN access).  Calling this
   * normal HTTPS/HTTP endpoint first (credentials: include) returns the raw JWT
   * so the client can pass it as ?token=... when opening the tail socket.
   */
  app.get(
    '/ws-token',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { onRequest: [(app as any).authenticatePlatformAdmin] },
    async (req: any, reply) => {
      const token =
        (req.cookies?.platform_sa_access_token as string | undefined) ??
        (req.cookies?.sa_access_token as string | undefined) ??
        (req.cookies?.access_token   as string | undefined) ??
        null;
      return reply.send({ token });
    },
  );

  /**
   * GET /logs/tail  (WebSocket)
   *
   * Live tail stream — sends newly ingested log entries in real time.
   *
   * Auth: session cookie (platform owner or management company admin).
   * Query params mirror GET /logs filters: source, min_level, org_id, device_id.
   *
   * The server sends JSON frames:  { type: 'entry', data: LogEntry }
   * The client can send { type: 'ping' } to keep the connection alive.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/tail', { websocket: true }, async (socket: any, req: any) => {
    // ── Parse query string directly from req.url ─────────────────────────
    // @fastify/websocket v11 may invoke the handler before Fastify's normal
    // query-parsing lifecycle hook runs, leaving req.query empty.
    // Splitting req.url manually is always reliable.
    const rawQs  = (typeof req.url === 'string' ? req.url.split('?')[1] : '') ?? '';
    const qs     = new URLSearchParams(rawQs);

    app.log.info({ url: req.url, hasToken: Boolean(qs.get('token')), hasCookie: Boolean((req.headers as Record<string, string | undefined>)['cookie']) }, '[logs/tail] WS handler reached');

    // ── Auth ────────────────────────────────────────────────────────────
    // 1. ?token= query param  — fetched by client via GET /logs/ws-token
    //    (browsers can't set custom headers on WebSocket; Secure cookies are
    //    blocked over ws://).
    // 2. Raw cookie header fallback — works when COOKIE_SECURE=false and
    //    @fastify/cookie's onRequest hook hasn't run yet in v11.
    function parseCookie(header: string | undefined, name: string): string | undefined {
      if (!header) return undefined;
      const m = header.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`));
      return m ? decodeURIComponent(m[1]!) : undefined;
    }
    const cookieHeader = (req.headers as Record<string, string | undefined>)['cookie'];
    const token = (
      qs.get('token') ??
      parseCookie(cookieHeader, 'platform_sa_access_token') ??
      parseCookie(cookieHeader, 'sa_access_token') ??
      parseCookie(cookieHeader, 'access_token')
    );
    if (!token) {
      socket.close(4001, 'Missing auth token');
      return;
    }

    let caller: { type: string; sub: string; orgId?: string; managementCompanyId?: string };
    try {
      caller = app.jwt.verify<typeof caller>(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    if (caller.type !== 'platform_owner' && caller.type !== 'management_company_admin') {
      socket.close(4003, 'Forbidden');
      return;
    }

    // ── Resolve allowed org scope ────────────────────────────────────────
    let allowedOrgIds: Set<string> | null = null;
    if (caller.type === 'management_company_admin' && caller.managementCompanyId) {
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.managementCompanyId, caller.managementCompanyId),
            sql`${organizations.deletedAt} IS NULL`,
          ),
        );
      allowedOrgIds = new Set(orgs.map((o) => o.id));
    }

    // ── Parse client-supplied filters (from the same URLSearchParams) ────
    const filterSource   = qs.get('source')    ?? null;
    const filterMinLevel = levelOrder(qs.get('min_level') ?? 'debug');
    const filterOrgId    = qs.get('org_id')    ?? null;
    const filterDeviceId = qs.get('device_id') ?? null;

    // ── Subscribe to logBus ──────────────────────────────────────────────
    const handler = (entry: Parameters<typeof logBus['publish']>[0][0]) => {
      // Level filter
      if (levelOrder(entry.level) < filterMinLevel) return;
      // Source filter — 'tizen' matches both tizen and tizen-sbb
      if (filterSource && filterSource !== 'tizen' && entry.source !== filterSource) return;
      if (filterSource === 'tizen' && entry.source !== 'tizen' && entry.source !== 'tizen-sbb') return;
      // Org scope (management admin)
      if (allowedOrgIds && entry.orgId && !allowedOrgIds.has(entry.orgId)) return;
      // Org id filter (optional extra drill-down)
      if (filterOrgId && entry.orgId !== filterOrgId) return;
      // Device filter
      if (filterDeviceId && entry.deviceId !== filterDeviceId) return;

      if (socket.readyState !== 1) return; // OPEN
      socket.send(JSON.stringify({
        type: 'entry',
        data: { ...entry, createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt },
      }));
    };

    logBus.on('entry', handler);

    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch { /* ignore malformed frames */ }
    });

    socket.on('close', () => {
      logBus.off('entry', handler);
    });
  });

  /**
   * POST /logs/purge   *
   * Manual purge — platform owner only.
   * Body: { level?, source?, older_than_days? }
   */
  app.post('/purge', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const caller = req.user as { type: string };
    if (caller.type !== 'platform_owner') {
      return reply.status(403).send({ error: 'Platform owner only' });
    }

    const body = (req.body ?? {}) as {
      level?: string;
      source?: string;
      older_than_days?: number;
    };

    const conditions = [
      body.level  ? eq(logEntries.level, body.level)   : undefined,
      body.source ? eq(logEntries.source, body.source) : undefined,
      body.older_than_days
        ? lt(logEntries.createdAt, new Date(Date.now() - body.older_than_days * 86_400_000))
        : undefined,
    ].filter(Boolean) as Parameters<typeof and>[0][];

    const deleted = await db
      .delete(logEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .returning({ id: logEntries.id });

    return reply.send({ deleted: deleted.length });
  });

  /**
   * GET /logs/stats
   *
   * Aggregate counts: total, byLevel, bySource, oldestAt, newestAt.
   * Scoped like GET /logs: platform owners see all; management admins see their orgs.
   */
  app.get('/stats', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const caller = req.user as { type: string; managementCompanyId?: string };

    let allowedOrgIds: string[] | null = null;
    if (caller.type === 'management_company_admin' && caller.managementCompanyId) {
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(
          eq(organizations.managementCompanyId, caller.managementCompanyId),
          sql`${organizations.deletedAt} IS NULL`,
        ));
      allowedOrgIds = orgs.map((o) => o.id);
      if (allowedOrgIds.length === 0) {
        return reply.send({ total: 0, byLevel: {}, bySource: {}, oldestAt: null, newestAt: null });
      }
    }

    const cond = allowedOrgIds ? inArray(logEntries.orgId, allowedOrgIds) : undefined;

    const [totals] = await db
      .select({
        total:    count(),
        oldestAt: sql<string | null>`MIN(${logEntries.createdAt})::text`,
        newestAt: sql<string | null>`MAX(${logEntries.createdAt})::text`,
      })
      .from(logEntries)
      .where(cond);

    const byLevelRows  = await db.select({ level:  logEntries.level,  cnt: count() }).from(logEntries).where(cond).groupBy(logEntries.level);
    const bySourceRows = await db.select({ source: logEntries.source, cnt: count() }).from(logEntries).where(cond).groupBy(logEntries.source);

    return reply.send({
      total:    Number(totals?.total ?? 0),
      byLevel:  Object.fromEntries(byLevelRows.map( (r) => [r.level,  Number(r.cnt)])),
      bySource: Object.fromEntries(bySourceRows.map((r) => [r.source, Number(r.cnt)])),
      oldestAt: totals?.oldestAt ?? null,
      newestAt: totals?.newestAt ?? null,
    });
  });

  /**
   * GET /logs/device-timeline?device_id=UUID
   *
   * Returns hourly error/warn/info bucket counts for the last 24 h for one device.
   * Used by the LogViewer sparkline when a device filter is active.
   */
  app.get('/device-timeline', { onRequest: [app.authenticatePlatformAdmin] }, async (req, reply) => {
    const { device_id: deviceId } = req.query as { device_id?: string };
    if (!deviceId) return reply.status(400).send({ error: 'device_id is required' });

    const rows = await db.execute(sql`
      SELECT
        DATE_TRUNC('hour', created_at)::text AS hour,
        COUNT(*) FILTER (WHERE level = 'error')::int AS errors,
        COUNT(*) FILTER (WHERE level = 'warn')::int  AS warns,
        COUNT(*) FILTER (WHERE level = 'info')::int  AS infos
      FROM log_entries
      WHERE device_id = ${deviceId}
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY 1
    `) as unknown as Array<{ hour: string; errors: number; warns: number; infos: number }>;

    return reply.send({ deviceId, last24h: rows });
  });
}
