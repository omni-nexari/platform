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
import { eq, and, isNull, desc, ne } from 'drizzle-orm';
import { writeAuditLog } from '../services/audit.js';
import { sendCommand, isDeviceOnline } from '../services/ws.js';

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
 * Derive a Samsung SyncPlay groupId (0–65535) from a UUID string using CRC-16/CCITT.
 * The result is used as the numeric group identifier passed to b2bapis/webapis.
 */
function crc16(str: string): number {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
  }
  return crc & 0xFFFF;
}

/**
 * Find a groupId that is not already in use within this org.
 * Tries CRC-16 of the UUID first; if that collides, increments until free.
 */
async function allocateGroupId(orgId: string, syncGroupUuid: string): Promise<number> {
  const existing = await db.query.syncGroups.findMany({
    where: and(eq(syncGroups.orgId, orgId), isNull(syncGroups.deletedAt)),
    columns: { groupId: true },
  });
  const usedIds = new Set(existing.map(g => g.groupId));
  let candidate = crc16(syncGroupUuid);
  for (let attempt = 0; attempt < 65536; attempt++) {
    const probe = (candidate + attempt) % 65536;
    if (!usedIds.has(probe)) return probe;
  }
  throw new Error('No available groupId in range 0–65535');
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
    with: { members: true, syncPlaylist: { with: { items: { with: { content: true } } } } },
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
    const groupId = await allocateGroupId(user.orgId, newId);

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
