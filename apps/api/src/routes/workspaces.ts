import type { FastifyInstance } from 'fastify';
import { db, workspaces, workspaceMembers, users, devices, contentItems, playlists, schedules } from '@signage/db';
import { eq, and, isNull, count, sql } from 'drizzle-orm';
import { CreateWorkspaceSchema, AddWorkspaceMemberSchema } from '@signage/shared';
import { writeAuditLog } from '../services/audit.js';
import { isDeviceOnline } from '../services/ws.js';

const DEVICE_RECENT_MS = 90_000;
function liveStatus(row: { id: string; status: string | null; lastSeen: Date | null }): string {
  const recentActivity = row.lastSeen
    ? Date.now() - new Date(row.lastSeen).getTime() <= DEVICE_RECENT_MS
    : false;
  if (isDeviceOnline(row.id) || recentActivity) return 'online';
  return row.status === 'online' ? 'offline' : (row.status ?? 'offline');
}

type AuthUser = { sub: string; orgId: string; role: string };

export async function workspaceRoutes(app: FastifyInstance) {
  // ── GET /workspaces ────────────────────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const list = await db.query.workspaces.findMany({
      where: and(eq(workspaces.orgId, user.orgId), isNull(workspaces.deletedAt)),
    });
    return reply.send(list);
  });

  // ── POST /workspaces ───────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const body = CreateWorkspaceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const exists = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.orgId, user.orgId),
        eq(workspaces.slug, body.data.slug),
        isNull(workspaces.deletedAt),
      ),
    });
    if (exists) return reply.status(409).send({ error: 'Slug already in use' });

    const [ws] = await db
      .insert(workspaces)
      .values({ orgId: user.orgId, name: body.data.name, slug: body.data.slug, timezone: body.data.timezone ?? 'UTC' })
      .returning();

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'WORKSPACE_CREATED',
      entityType: 'workspace',
      entityId: ws!.id,
      ipAddress: req.ip,
    });

    return reply.status(201).send(ws);
  });

  // ── GET /workspaces/:id ────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });
    return reply.send(ws);
  });

  // ── PATCH /workspaces/:id ──────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });

    const body = CreateWorkspaceSchema.partial().safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const setData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };

    // Handle approvalRequired setting (merged into settings JSON blob)
    const rawBody = req.body as Record<string, unknown>;
    if (typeof rawBody['approvalRequired'] === 'boolean' || Array.isArray(rawBody['approvalReviewers'])) {
      let currentSettings: Record<string, unknown> = {};
      try { currentSettings = JSON.parse(ws.settings ?? '{}'); } catch { /* ignore */ }
      if (typeof rawBody['approvalRequired'] === 'boolean') {
        currentSettings['approvalRequired'] = rawBody['approvalRequired'];
      }
      if (Array.isArray(rawBody['approvalReviewers'])) {
        // Only accept UUIDs to prevent storing arbitrary data
        currentSettings['approvalReviewers'] = (rawBody['approvalReviewers'] as unknown[])
          .filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v));
      }
      setData['settings'] = JSON.stringify(currentSettings);
    }

    // Player defaults — defaultPlaylistId and logoUrl stored as top-level columns
    if ('defaultPlaylistId' in rawBody) {
      const pid = rawBody['defaultPlaylistId'];
      setData['defaultPlaylistId'] = (typeof pid === 'string' && /^[0-9a-f-]{36}$/i.test(pid)) ? pid : null;
    }
    if ('logoUrl' in rawBody) {
      const url = rawBody['logoUrl'];
      setData['logoUrl'] = typeof url === 'string' && url.length < 2048 ? url : null;
    }

    const [updated] = await db
      .update(workspaces)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(setData as any)
      .where(eq(workspaces.id, id))
      .returning();
    return reply.send(updated);
  });

  // ── DELETE /workspaces/:id ─────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    if (user.role !== 'owner')
      return reply.status(403).send({ error: 'Only org owners can delete workspaces' });

    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });

    await db
      .update(workspaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'WORKSPACE_DELETED',
      entityType: 'workspace',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // ── GET /workspaces/:id/members ────────────────────────────────────────────
  app.get('/:id/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });

    const members = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        name: users.name,
        email: users.email,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, id));

    return reply.send(members);
  });

  // ── POST /workspaces/:id/members ───────────────────────────────────────────
  app.post('/:id/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const body = AddWorkspaceMemberSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    const targetUser = await db.query.users.findFirst({
      where: and(
        eq(users.id, body.data.userId),
        eq(users.orgId, user.orgId),
        isNull(users.deletedAt),
      ),
    });
    if (!targetUser) return reply.status(404).send({ error: 'User not found in this org' });

    await db
      .insert(workspaceMembers)
      .values({
        workspaceId: id,
        userId: body.data.userId,
        role: body.data.role,
        addedBy: user.sub,
      })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: body.data.role, updatedAt: new Date() },
      });

    return reply.status(201).send({ workspaceId: id, userId: body.data.userId, role: body.data.role });
  });

  // ── DELETE /workspaces/:id/members/:userId ─────────────────────────────────
  app.delete('/:id/members/:userId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, userId } = req.params as { id: string; userId: string };
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });

    await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, userId)),
      );

    return reply.status(204).send();
  });

  // ── GET /workspaces/:id/summary ────────────────────────────────────────────
  app.get('/:id/summary', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const ws = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, id),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!ws) return reply.status(404).send({ error: 'Not found' });

    const deviceRows = await db
      .select({ id: devices.id, status: devices.status, lastSeen: devices.lastSeen })
      .from(devices)
      .where(
        and(
          eq(devices.workspaceId, id),
          eq(devices.orgId, user.orgId),
          isNull(devices.deletedAt),
          sql`${devices.status} != 'unclaimed'`,
        ),
      );

    let online = 0, offline = 0, error = 0;
    for (const r of deviceRows) {
      const s = liveStatus(r);
      if (s === 'online') online++;
      else if (s === 'error') error++;
      else offline++;
    }

    const contentRows = await db
      .select({
        type: contentItems.type,
        total: count(),
        active: sql<number>`count(*) filter (where ${contentItems.approvalState} = 'approved')`.mapWith(Number),
      })
      .from(contentItems)
      .where(and(eq(contentItems.workspaceId, id), isNull(contentItems.deletedAt)))
      .groupBy(contentItems.type);

    const playlistRows = await db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where item_count > 0)`.mapWith(Number),
      })
      .from(playlists)
      .where(and(eq(playlists.workspaceId, id), isNull(playlists.deletedAt)));

    const playlistTotal = Number(playlistRows[0]?.total ?? 0);
    const playlistActive = Number(playlistRows[0]?.active ?? 0);

    const scheduleRows = await db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${schedules.isActive} = true)`.mapWith(Number),
      })
      .from(schedules)
      .where(and(eq(schedules.workspaceId, id), isNull(schedules.deletedAt)));

    const scheduleTotal = Number(scheduleRows[0]?.total ?? 0);
    const scheduleActive = Number(scheduleRows[0]?.active ?? 0);

    const powerRows = await db
      .select({ id: devices.id, status: devices.status, lastSeen: devices.lastSeen, powerState: devices.powerState })
      .from(devices)
      .where(
        and(
          eq(devices.workspaceId, id),
          eq(devices.orgId, user.orgId),
          isNull(devices.deletedAt),
          sql`${devices.status} != 'unclaimed'`,
        ),
      );

    let devicePowerOn = 0, devicePowerOff = 0;
    for (const r of powerRows) {
      const n = r.powerState === 'on' ? 1 : (r.powerState === 'off' || r.powerState === 'standby' ? -1 : 0);
      if (n === 1) devicePowerOn++;
      else if (n === -1) devicePowerOff++;
    }

    return reply.send({
      deviceTotal: online + offline + error,
      deviceOnline: online,
      deviceOffline: offline,
      deviceError: error,
      devicePowerOn,
      devicePowerOff,
      contentStats: contentRows.map(r => ({ type: r.type, total: Number(r.total), published: Number(r.active) })),
      playlistTotal,
      playlistActive,
      scheduleTotal,
      scheduleActive,
    });
  });
}
