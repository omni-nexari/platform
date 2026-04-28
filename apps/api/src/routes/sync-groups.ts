import type { FastifyInstance } from 'fastify';
import {
  db,
  syncGroups,
  syncGroupMembers,
  syncPlaylists,
  devices,
  workspaces,
  workspaceMembers,
} from '@signage/db';
import { eq, and, isNull, desc, ne, inArray } from 'drizzle-orm';
import { writeAuditLog } from '../services/audit.js';
import { sendCommand, isDeviceOnline } from '../services/ws.js';
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

/**
 * Detect mode from members: if any member device has a non-Samsung modelCode,
 * fall back to 'custom-mixed'.  For now all known devices are Samsung.
 */
async function detectMode(syncGroupId: string): Promise<'native-samsung' | 'custom-mixed'> {
  // All Tizen LFD devices are Samsung — mode is always native-samsung at this stage.
  // Phase 5 will add non-Samsung device detection.
  return 'native-samsung';
}

/**
 * Push SESSION_CONFIG to all online members of a sync group.
 */
async function pushSessionConfig(syncGroupId: string) {
  const group = await db.query.syncGroups.findFirst({
    where: eq(syncGroups.id, syncGroupId),
    with: { members: true },
  });
  if (!group) return;

  for (const member of group.members) {
    if (!isDeviceOnline(member.deviceId)) continue;
    sendCommand(member.deviceId, {
      type: 'SESSION_CONFIG',
      groupId: group.groupId,
      mode: group.mode,
      syncPlaylistId: group.syncPlaylistId ?? null,
    });
  }
}

export async function syncGroupRoutes(app: FastifyInstance) {

  // ── GET /sync-groups?workspaceId= ─────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.syncGroups.findMany({
      where: and(eq(syncGroups.workspaceId, workspaceId), isNull(syncGroups.deletedAt)),
      orderBy: [desc(syncGroups.updatedAt)],
      with: {
        syncPlaylist: { columns: { id: true, name: true } },
        members: {
          with: { device: { columns: { id: true, name: true, status: true, lastSeen: true } } },
        },
      },
    });

    return reply.send(rows);
  });

  // ── GET /sync-groups/:id ──────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
      with: {
        syncPlaylist: { columns: { id: true, name: true } },
        members: {
          with: { device: { columns: { id: true, name: true, status: true, lastSeen: true } } },
        },
      },
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send(group);
  });

  // ── POST /sync-groups ─────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string; syncPlaylistId?: string };

    if (!body.workspaceId || !body.name?.trim()) {
      return reply.status(400).send({ error: 'workspaceId and name required' });
    }

    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, body.workspaceId), eq(workspaces.orgId, user.orgId), isNull(workspaces.deletedAt)),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const wsAccess = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    if (body.syncPlaylistId) {
      const sp = await db.query.syncPlaylists.findFirst({
        where: and(eq(syncPlaylists.id, body.syncPlaylistId), isNull(syncPlaylists.deletedAt)),
      });
      if (!sp) return reply.status(404).send({ error: 'Sync playlist not found' });
    }

    // Reserve a temporary UUID to derive the groupId, then insert with actual id
    const { randomUUID } = await import('node:crypto');
    const newId = randomUUID();
    const groupId = await allocateSyncPlayGroupId(user.orgId, newId);

    const [group] = await db.insert(syncGroups).values({
      id: newId,
      orgId: user.orgId,
      workspaceId: body.workspaceId,
      name: body.name.trim(),
      groupId,
      syncPlaylistId: body.syncPlaylistId ?? null,
      mode: 'native-samsung',
    }).returning();
    if (!group) return reply.status(500).send({ error: 'Failed to create sync group' });
    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SYNC_GROUP_CREATED',
      entityType: 'sync_group',
      entityId: group!.id,
      meta: { name: group!.name },
      ipAddress: req.ip,
    });

    return reply.status(201).send({ ...group!, members: [], syncPlaylist: null });
  });

  // ── PATCH /sync-groups/:id ────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; syncPlaylistId?: string | null };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    if (body.syncPlaylistId) {
      const sp = await db.query.syncPlaylists.findFirst({
        where: and(eq(syncPlaylists.id, body.syncPlaylistId), isNull(syncPlaylists.deletedAt)),
      });
      if (!sp) return reply.status(404).send({ error: 'Sync playlist not found' });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if ('syncPlaylistId' in body) patch.syncPlaylistId = body.syncPlaylistId ?? null;

    const [updated] = await db.update(syncGroups).set(patch).where(eq(syncGroups.id, id)).returning();

    // When a playlist is assigned, ensure all member devices have publishedSyncGroupId set
    if ('syncPlaylistId' in body) {
      const members = await db.query.syncGroupMembers.findMany({
        where: eq(syncGroupMembers.syncGroupId, id),
        columns: { deviceId: true },
      });
      if (members.length > 0) {
        const newPlaylistId = body.syncPlaylistId ?? null;
        if (newPlaylistId) {
          // Assigning a playlist: mark all members as belonging to this sync group
          await db.update(devices)
            .set({ publishedSyncGroupId: id, updatedAt: new Date() })
            .where(inArray(devices.id, members.map((m) => m.deviceId)));
        } else {
          // Clearing the playlist: clear publishedSyncGroupId on member devices
          await db.update(devices)
            .set({ publishedSyncGroupId: null, updatedAt: new Date() })
            .where(inArray(devices.id, members.map((m) => m.deviceId)));
        }
      }
    }

    await pushSessionConfig(id);

    return reply.send(updated);
  });

  // ── DELETE /sync-groups/:id ───────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    // Clear publishedSyncGroupId on all member devices before deleting group
    await db.update(devices)
      .set({ publishedSyncGroupId: null, updatedAt: new Date() })
      .where(eq(devices.publishedSyncGroupId, id));

    await db.update(syncGroups).set({ deletedAt: new Date() }).where(eq(syncGroups.id, id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SYNC_GROUP_DELETED',
      entityType: 'sync_group',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // ── POST /sync-groups/:id/members ─ add devices to a group ───────────────
  app.post('/:id/members', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { deviceIds: string[] };

    if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0) {
      return reply.status(400).send({ error: 'deviceIds array required' });
    }

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
    });
    if (!group) return reply.status(404).send({ error: 'Sync group not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    const targetDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, group.workspaceId),
      ),
      columns: { id: true },
    });
    const validIds = new Set(targetDevices.map(d => d.id));
    const invalid = body.deviceIds.find(did => !validIds.has(did));
    if (invalid) return reply.status(404).send({ error: `Device not found in workspace: ${invalid}` });

    // Get existing members to determine leaderPriority for newcomers
    const existing = await db.query.syncGroupMembers.findMany({
      where: eq(syncGroupMembers.syncGroupId, id),
      columns: { deviceId: true, leaderPriority: true },
    });
    const existingDeviceIds = new Set(existing.map(m => m.deviceId));
    const maxPriority = existing.length > 0 ? Math.max(...existing.map(m => m.leaderPriority)) : -1;

    const newMembers = body.deviceIds
      .filter(did => !existingDeviceIds.has(did))
      .map((did, idx) => ({
        syncGroupId: id,
        deviceId: did,
        tileCol: 0,
        tileRow: 0,
        leaderPriority: maxPriority + 1 + idx,
      }));

    if (newMembers.length > 0) {
      await db.insert(syncGroupMembers).values(newMembers).onConflictDoNothing();
      // Point each newly added device at this sync group so the schedule endpoint
      // returns publishedSyncGroup and the player routes to SyncPlay mode.
      const newDeviceIds = newMembers.map(m => m.deviceId);
      await db.update(devices)
        .set({ publishedSyncGroupId: id, updatedAt: new Date() })
        .where(inArray(devices.id, newDeviceIds));
    }

    const mode = await detectMode(id);
    await db.update(syncGroups).set({ mode, updatedAt: new Date() }).where(eq(syncGroups.id, id));
    await pushSessionConfig(id);

    const updated = await db.query.syncGroups.findFirst({
      where: eq(syncGroups.id, id),
      with: {
        syncPlaylist: { columns: { id: true, name: true } },
        members: {
          with: { device: { columns: { id: true, name: true, status: true, lastSeen: true } } },
        },
      },
    });

    return reply.send(updated);
  });

  // ── DELETE /sync-groups/:id/members/:deviceId ─ remove a device ──────────
  app.delete('/:id/members/:deviceId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, deviceId } = req.params as { id: string; deviceId: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
    });
    if (!group) return reply.status(404).send({ error: 'Sync group not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    await db.delete(syncGroupMembers)
      .where(and(eq(syncGroupMembers.syncGroupId, id), eq(syncGroupMembers.deviceId, deviceId)));

    // Clear publishedSyncGroupId on removed device if it was pointing at this group
    await db.update(devices)
      .set({ publishedSyncGroupId: null, updatedAt: new Date() })
      .where(and(eq(devices.id, deviceId), eq(devices.publishedSyncGroupId, id)));

    const mode = await detectMode(id);
    await db.update(syncGroups).set({ mode, updatedAt: new Date() }).where(eq(syncGroups.id, id));

    // Tell the removed device to stop SyncPlay
    if (isDeviceOnline(deviceId)) {
      sendCommand(deviceId, { type: 'SYNC_PLAY', action: 'STOP' });
    }

    return reply.status(204).send();
  });
}
