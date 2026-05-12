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
    const body = req.body as { name?: string; syncPlaylistId?: string | null; syncRelayMode?: 'lan' | 'cloud'; pinnedLeaderId?: string | null };

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
    if (body.syncRelayMode !== undefined) patch.syncRelayMode = body.syncRelayMode;
    if ('pinnedLeaderId' in body) patch.pinnedLeaderId = body.pinnedLeaderId ?? null;

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
          // Clear other published targets to satisfy the single-publish-target constraint.
          await db.update(devices)
            .set({
              publishedSyncGroupId: id,
              publishedContentId: null,
              publishedPlaylistId: null,
              publishedScheduleId: null,
              updatedAt: new Date(),
            })
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
      // Clear all other published targets to satisfy the single-publish-target constraint.
      const newDeviceIds = newMembers.map(m => m.deviceId);
      await db.update(devices)
        .set({
          publishedSyncGroupId: id,
          publishedContentId: null,
          publishedPlaylistId: null,
          publishedScheduleId: null,
          updatedAt: new Date(),
        })
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

  // ── POST /sync-groups/:id/manifest ─ generate + push SYNC_GROUP_INIT ────
  // Builds the LAN-cacheable manifest (peers + priorities + playlist) and pushes
  // it over the device WS to every online member. Bumps manifest_version.
  app.post('/:id/manifest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
      with: {
        members: { with: { device: true } },
        syncPlaylist: { with: { items: { with: { content: true } } } },
      },
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    // Sort members: respect pinnedLeaderId first, then leaderPriority, then platform priority.
    const PLAT_PRI: Record<string, number> = { tizen: 0, 'tizen-sbb': 1, windows: 2, android: 3, browser: 4 };
    const platPri = (dev: any) => PLAT_PRI[(dev as any)?.platform ?? ''] ?? 99;
    const pinnedId = (group as any).pinnedLeaderId as string | null ?? null;
    const sortedMembers = [...group.members].sort((a, b) => {
      if (pinnedId) {
        if (a.deviceId === pinnedId) return -1;
        if (b.deviceId === pinnedId) return 1;
      }
      if (a.leaderPriority !== b.leaderPriority) return a.leaderPriority - b.leaderPriority;
      return platPri(a.device) - platPri(b.device);
    });
    const leaderPriority = sortedMembers.map((m) => m.deviceId);
    const peers = sortedMembers.map((m) => ({
      deviceId: m.deviceId,
      lastKnownIp: m.lastSeenIp ?? (m.device as any)?.lastKnownIp ?? null,
      port: 9615,
      platform: (m.device as any)?.platform ?? 'tizen',
    }));

    const syncRelayMode: string = (group as any).syncRelayMode ?? 'lan';

    let playlistPayload: { id: string; items: Array<Record<string, unknown>> } | null = null;
    if (group.syncPlaylist) {
      const items = [...(group.syncPlaylist as any).items]
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
        .filter((i: any) => i.content)
        .map((i: any) => ({
          id: i.id,
          contentId: i.contentId,
          name: i.content.name,
          type: i.content.type,
          filePath: i.content.filePath,
          fileHash: i.content.fileHash,
          mimeType: i.content.mimeType,
          duration: i.durationSeconds ?? i.content.duration ?? 10,
        }));
      playlistPayload = { id: group.syncPlaylist.id, items };
    }

    const newVersion = (group.manifestVersion ?? 0) + 1;
    await db.update(syncGroups)
      .set({ manifestVersion: newVersion, state: 'preparing', updatedAt: new Date() })
      .where(eq(syncGroups.id, id));

    const allTizen = sortedMembers.length > 0 && sortedMembers.every(m => {
      const plat = (m.device as any)?.platform ?? 'tizen';
      return plat === 'tizen' || plat === 'tizen-sbb';
    });
    // For cross-OS groups always use the centralised API relay so no device needs
    // to host its own relay server (Windows has none; Android's bridge is optional).
    const appUrl = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
    const relayUrl = !allTizen
      ? appUrl.replace(/^http/, 'ws') + '/api/v1/sync-relay/ws'
      : null;

    const manifest = {
      type: 'SYNC_GROUP_INIT' as const,
      syncGroupId: group.id,
      version: newVersion,
      groupId: group.groupId,
      leaderPriority,
      peers,
      relayUrl,
      syncRelayMode,
      allTizen,
      playlist: playlistPayload,
    };

    let pushed = 0;
    for (const m of sortedMembers) {
      if (isDeviceOnline(m.deviceId) && sendCommand(m.deviceId, manifest)) pushed += 1;
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SYNC_GROUP_MANIFEST_PUSHED',
      entityType: 'sync_group',
      entityId: id,
      meta: { version: newVersion, members: sortedMembers.length, pushed },
      ipAddress: req.ip,
    });

    return reply.send({ version: newVersion, members: sortedMembers.length, pushed });
  });

  // ── POST /sync-groups/:id/priorities ─ reorder leader priority ──────────
  app.post('/:id/priorities', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { deviceIds: string[] };

    if (!Array.isArray(body.deviceIds) || body.deviceIds.length === 0) {
      return reply.status(400).send({ error: 'deviceIds array required' });
    }

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
      with: { members: true },
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    const memberIds = new Set(group.members.map((m) => m.deviceId));
    const unknown = body.deviceIds.find((d) => !memberIds.has(d));
    if (unknown) return reply.status(400).send({ error: `Device not in group: ${unknown}` });

    for (let i = 0; i < body.deviceIds.length; i += 1) {
      await db.update(syncGroupMembers)
        .set({ leaderPriority: i })
        .where(and(
          eq(syncGroupMembers.syncGroupId, id),
          eq(syncGroupMembers.deviceId, body.deviceIds[i]!),
        ));
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SYNC_GROUP_PRIORITIES_UPDATED',
      entityType: 'sync_group',
      entityId: id,
      meta: { order: body.deviceIds },
      ipAddress: req.ip,
    });

    return reply.send({ ok: true });
  });

  // ── GET /sync-groups/:id/state ─ live observability ─────────────────────
  app.get('/:id/state', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
      with: {
        members: {
          with: { device: { columns: { id: true, name: true, status: true, lastSeen: true } } },
        },
      },
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    const sortedMembers = [...group.members].sort((a, b) => a.leaderPriority - b.leaderPriority);
    const FRESH_MS = 5_000;
    const now = Date.now();
    const liveDeviceIds = sortedMembers
      .filter((m) => m.lastReportAt && now - new Date(m.lastReportAt).getTime() <= FRESH_MS)
      .map((m) => m.deviceId);
    const leader = liveDeviceIds[0] ?? null;

    return reply.send({
      id: group.id,
      state: group.state,
      currentItemIndex: group.currentItemIndex,
      manifestVersion: group.manifestVersion,
      leader,
      members: sortedMembers.map((m) => ({
        deviceId: m.deviceId,
        name: (m.device as any)?.name ?? null,
        leaderPriority: m.leaderPriority,
        readyState: m.readyState,
        driftMs: m.driftMs,
        playbackRate: m.playbackRate != null ? m.playbackRate / 1000 : null,
        lastSeenIp: m.lastSeenIp,
        lastReportAt: m.lastReportAt,
        live: liveDeviceIds.includes(m.deviceId),
      })),
    });
  });

  // ── POST /sync-groups/:id/force-resync ─ emergency broadcast ───────────
  app.post('/:id/force-resync', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };

    const group = await db.query.syncGroups.findFirst({
      where: and(eq(syncGroups.id, id), isNull(syncGroups.deletedAt)),
      with: { members: true },
    });
    if (!group) return reply.status(404).send({ error: 'Not found' });

    const wsAccess = await checkWorkspaceAccess(group.workspaceId, user.sub);
    if (!wsAccess) return reply.status(403).send({ error: 'Forbidden' });

    let pushed = 0;
    for (const m of group.members) {
      if (isDeviceOnline(m.deviceId)) {
        const ok = sendCommand(m.deviceId, {
          type: 'SYNC_RESET',
          syncGroupId: id,
          ...(body.reason ? { reason: body.reason } : {}),
        });
        if (ok) pushed += 1;
      }
    }

    await db.update(syncGroups)
      .set({ state: 'preparing', updatedAt: new Date() })
      .where(eq(syncGroups.id, id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SYNC_GROUP_FORCE_RESYNC',
      entityType: 'sync_group',
      entityId: id,
      meta: { pushed, members: group.members.length, ...(body.reason ? { reason: body.reason } : {}) },
      ipAddress: req.ip,
    });

    return reply.send({ pushed, members: group.members.length });
  });
}
