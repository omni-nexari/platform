import type { FastifyInstance } from 'fastify';
import {
  db, devices, deviceGroups, deviceGroupMembers,
  workspaces, workspaceMembers, schedules, playlists, contentItems,
  syncGroups, syncGroupMembers,
} from '@signage/db';
import { eq, and, isNull, inArray, asc } from 'drizzle-orm';
import { DeviceCommandSchema } from '@signage/shared';
import { sendCommand, isDeviceOnline } from '../services/ws.js';
import { writeAuditLog } from '../services/audit.js';
import { allocateSyncPlayGroupId } from '../services/syncplay-allocator.js';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

/** Hydrate the linked sync group (when type='sync') onto a device-group row. */
async function hydrateSyncGroup(group: typeof deviceGroups.$inferSelect) {
  if (!group.syncGroupId) return null;
  const sg = await db.query.syncGroups.findFirst({
    where: eq(syncGroups.id, group.syncGroupId),
    with: { syncPlaylist: { columns: { id: true, name: true } } },
  });
  if (!sg) return null;
  return {
    id: sg.id,
    groupId: sg.groupId,
    mode: sg.mode,
    syncPlaylistId: sg.syncPlaylistId,
    syncPlaylistName: sg.syncPlaylist?.name ?? null,
  };
}

export async function deviceGroupsRoutes(app: FastifyInstance) {
  // ── GET /device-groups?workspaceId= ──────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.deviceGroups.findMany({
      where: and(
        eq(deviceGroups.workspaceId, workspaceId),
        isNull(deviceGroups.deletedAt),
      ),
      orderBy: [asc(deviceGroups.name)],
    });

    // Hydrate syncGroup info for sync-type rows so the list page can show
    // the linked playlist + numeric SyncPlay groupId without an extra round-trip.
    const hydrated = await Promise.all(
      rows.map(async (g) => ({
        ...g,
        syncGroup: g.type === 'sync' ? await hydrateSyncGroup(g) : null,
      })),
    );

    return reply.send(hydrated);
  });

  // ── GET /device-groups/:id ───────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    if (group.workspaceId) {
      const member = await checkWorkspaceAccess(group.workspaceId, user.sub);
      if (!member) return reply.status(403).send({ error: 'Forbidden' });
    }

    const members = await db.query.deviceGroupMembers.findMany({
      where: eq(deviceGroupMembers.groupId, id),
      orderBy: [asc(deviceGroupMembers.position)],
    });

    const memberDeviceIds = members.map((m) => m.deviceId);
    const memberDevices = memberDeviceIds.length > 0
      ? await db.query.devices.findMany({
          where: and(inArray(devices.id, memberDeviceIds), isNull(devices.deletedAt)),
        })
      : [];
    const deviceMap = Object.fromEntries(memberDevices.map((d) => [d.id, d]));

    // For sync-type groups, also fetch sync_group_members so the SyncPlay panel
    // can render which devices are part of the SyncPlay session. Member management
    // for sync-type groups happens through /sync-groups/:syncGroupId/members.
    let syncGroupHydrated: Awaited<ReturnType<typeof hydrateSyncGroup>> = null;
    let syncMembers: Array<{ deviceId: string; leaderPriority: number; tileCol: number; tileRow: number; device: typeof memberDevices[number] | null }> = [];
    if (group.type === 'sync' && group.syncGroupId) {
      syncGroupHydrated = await hydrateSyncGroup(group);
      const rawSyncMembers = await db.query.syncGroupMembers.findMany({
        where: eq(syncGroupMembers.syncGroupId, group.syncGroupId),
      });
      const syncDeviceIds = rawSyncMembers.map((m) => m.deviceId);
      const syncDevices = syncDeviceIds.length > 0
        ? await db.query.devices.findMany({
            where: and(inArray(devices.id, syncDeviceIds), isNull(devices.deletedAt)),
          })
        : [];
      const syncDeviceMap = Object.fromEntries(syncDevices.map((d) => [d.id, d]));
      syncMembers = rawSyncMembers.map((m) => ({
        deviceId: m.deviceId,
        leaderPriority: m.leaderPriority,
        tileCol: m.tileCol,
        tileRow: m.tileRow,
        device: syncDeviceMap[m.deviceId] ?? null,
      }));
    }

    return reply.send({
      ...group,
      members: members.map((m) => ({ ...m, device: deviceMap[m.deviceId] ?? null })),
      syncGroup: syncGroupHydrated,
      syncMembers,
    });
  });

  // ── POST /device-groups ──────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = req.body as {
      workspaceId?: string;
      name: string;
      type?: string;
      description?: string;
      videoWallCols?: number;
      videoWallRows?: number;
    };
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    if (body.workspaceId) {
      const workspace = await db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, body.workspaceId),
          eq(workspaces.orgId, user.orgId),
          isNull(workspaces.deletedAt),
        ),
      });
      if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });
      const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
      if (!member) return reply.status(403).send({ error: 'Forbidden' });
    }

    const [group] = await db.insert(deviceGroups).values({
      orgId: user.orgId,
      workspaceId: body.workspaceId ?? null,
      name: body.name.trim(),
      type: body.type ?? 'location',
      description: body.description ?? null,
      videoWallCols: body.videoWallCols ?? null,
      videoWallRows: body.videoWallRows ?? null,
    }).returning();
    if (!group) return reply.status(500).send({ error: 'Failed to create device group' });

    // For type='sync', auto-create a backing sync_groups row so the device group
    // owns a Samsung SyncPlay session. The CRC-16 numeric groupId is allocated
    // here and stored on sync_groups.group_id; device_groups.sync_group_id links them.
    if (group.type === 'sync' && body.workspaceId) {
      const { randomUUID } = await import('node:crypto');
      const syncGroupUuid = randomUUID();
      const numericGroupId = await allocateSyncPlayGroupId(user.orgId, syncGroupUuid);
      const [sg] = await db.insert(syncGroups).values({
        id: syncGroupUuid,
        orgId: user.orgId,
        workspaceId: body.workspaceId,
        name: group.name,
        groupId: numericGroupId,
        mode: 'native-samsung',
      }).returning();
      if (sg) {
        await db.update(deviceGroups)
          .set({ syncGroupId: sg.id, updatedAt: new Date() })
          .where(eq(deviceGroups.id, group.id));
        group.syncGroupId = sg.id;
      }
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_GROUP_CREATED',
      entityType: 'device_group',
      entityId: group.id,
      ipAddress: req.ip,
      meta: { name: group.name, type: group.type },
    });

    const syncGroup = group.type === 'sync' ? await hydrateSyncGroup(group) : null;
    return reply.status(201).send({ ...group, syncGroup });
  });

  // ── PATCH /device-groups/:id ─────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string | null;
      videoWallCols?: number | null;
      videoWallRows?: number | null;
    };

    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch['name'] = body.name.trim();
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.videoWallCols !== undefined) patch['videoWallCols'] = body.videoWallCols;
    if (body.videoWallRows !== undefined) patch['videoWallRows'] = body.videoWallRows;

    const [updated] = await db.update(deviceGroups).set(patch).where(eq(deviceGroups.id, id)).returning();

    // Keep the linked sync_groups.name in step with the device group name.
    if (body.name !== undefined && group.syncGroupId) {
      await db.update(syncGroups)
        .set({ name: body.name.trim(), updatedAt: new Date() })
        .where(eq(syncGroups.id, group.syncGroupId));
    }

    return reply.send(updated);
  });

  // ── DELETE /device-groups/:id (soft) ────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    await db.update(deviceGroups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(deviceGroups.id, id));

    // Cascade: when a sync-type device group is deleted, soft-delete the linked
    // sync_groups row and clear publishedSyncGroupId on member devices so they
    // stop the SyncPlay session on next heartbeat. Online devices receive a
    // STOP command via the sync_group_members fan-out.
    if (group.syncGroupId) {
      await db.update(devices)
        .set({ publishedSyncGroupId: null, updatedAt: new Date() })
        .where(eq(devices.publishedSyncGroupId, group.syncGroupId));
      const syncMembers = await db.query.syncGroupMembers.findMany({
        where: eq(syncGroupMembers.syncGroupId, group.syncGroupId),
      });
      for (const m of syncMembers) {
        if (isDeviceOnline(m.deviceId)) {
          sendCommand(m.deviceId, { type: 'SYNC_PLAY', action: 'STOP' });
        }
      }
      await db.update(syncGroups)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(syncGroups.id, group.syncGroupId));
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_GROUP_DELETED',
      entityType: 'device_group',
      entityId: id,
      ipAddress: req.ip,
      meta: { name: group.name },
    });

    return reply.send({ ok: true });
  });

  // ── PUT /device-groups/:id/members (atomic replace) ──────────────────────
  app.put('/:id/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as Array<{
      deviceId: string;
      position?: number;
      positionCol?: number;
      positionRow?: number;
    }>;
    if (!Array.isArray(body)) return reply.status(400).send({ error: 'Body must be an array' });

    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    await db.transaction(async (tx) => {
      await tx.delete(deviceGroupMembers).where(eq(deviceGroupMembers.groupId, id));
      if (body.length > 0) {
        await tx.insert(deviceGroupMembers).values(
          body.map((m, idx) => ({
            groupId: id,
            deviceId: m.deviceId,
            position: m.position ?? idx,
            positionCol: m.positionCol ?? null,
            positionRow: m.positionRow ?? null,
          })),
        );
      }
    });

    await db.update(deviceGroups).set({ updatedAt: new Date() }).where(eq(deviceGroups.id, id));
    return reply.send({ ok: true, memberCount: body.length });
  });

  // ── POST /device-groups/:id/publish ──────────────────────────────────────
  app.post('/:id/publish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as { resourceType: string; resourceId: string };
    if (!body.resourceType || !body.resourceId) {
      return reply.status(400).send({ error: 'resourceType and resourceId required' });
    }

    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    if (body.resourceType === 'content') {
      const item = await db.query.contentItems.findFirst({
        where: and(eq(contentItems.id, body.resourceId), isNull(contentItems.deletedAt)),
      });
      if (!item) return reply.status(404).send({ error: 'Content not found' });
    } else if (body.resourceType === 'playlist') {
      const pl = await db.query.playlists.findFirst({
        where: and(eq(playlists.id, body.resourceId), isNull(playlists.deletedAt)),
      });
      if (!pl) return reply.status(404).send({ error: 'Playlist not found' });
    } else if (body.resourceType === 'schedule') {
      const sched = await db.query.schedules.findFirst({
        where: and(eq(schedules.id, body.resourceId), isNull(schedules.deletedAt)),
      });
      if (!sched) return reply.status(404).send({ error: 'Schedule not found' });
    }

    const members = await db.query.deviceGroupMembers.findMany({
      where: eq(deviceGroupMembers.groupId, id),
    });
    if (members.length === 0) return reply.send({ updated: 0, refreshedDeviceIds: [] });

    const deviceIds = members.map((m) => m.deviceId);

    await db.update(devices).set({
      publishedContentId: body.resourceType === 'content' ? body.resourceId : null,
      publishedPlaylistId: body.resourceType === 'playlist' ? body.resourceId : null,
      publishedScheduleId: body.resourceType === 'schedule' ? body.resourceId : null,
      publishedSyncGroupId: null,
      updatedAt: new Date(),
    }).where(and(
      eq(devices.orgId, user.orgId),
      inArray(devices.id, deviceIds),
      isNull(devices.deletedAt),
    ));

    const refreshedDeviceIds: string[] = [];
    for (const deviceId of deviceIds) {
      if (!isDeviceOnline(deviceId)) continue;
      sendCommand(deviceId, { type: 'refresh_schedule' });
      refreshedDeviceIds.push(deviceId);
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_GROUP_PUBLISH',
      entityType: 'device_group',
      entityId: id,
      ipAddress: req.ip,
      meta: { resourceType: body.resourceType, resourceId: body.resourceId, deviceCount: deviceIds.length },
    });

    return reply.send({
      updated: deviceIds.length,
      refreshedDeviceIds,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
    });
  });

  // ── POST /device-groups/:id/command ──────────────────────────────────────
  app.post('/:id/command', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const parsed = DeviceCommandSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, id), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) return reply.status(404).send({ error: 'Not found' });

    const members = await db.query.deviceGroupMembers.findMany({
      where: eq(deviceGroupMembers.groupId, id),
    });

    const sent: string[] = [];
    const skipped: string[] = [];
    for (const m of members) {
      if (!isDeviceOnline(m.deviceId)) { skipped.push(m.deviceId); continue; }
      const { command: cmdType, ...cmdRest } = parsed.data;
      sendCommand(m.deviceId, { type: cmdType, ...cmdRest } as unknown as Parameters<typeof sendCommand>[1]);
      sent.push(m.deviceId);
    }

    return reply.send({ sent, skipped });
  });
}
