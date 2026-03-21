import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createReadStream, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { db, devices, deviceScreenshots, deviceHeartbeats, workspaces, schedules, scheduleSlots, playlists, playlistItems, contentItems } from '@signage/db';
import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { z } from 'zod';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
import { ClaimDeviceSchema, UpdateDeviceSchema, DeviceCommandSchema, PairRequestSchema } from '@signage/shared';
import { writeAuditLog } from '../services/audit.js';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import {
  sendCommand,
  isDeviceOnline,
  registerDevice,
  unregisterDevice,
  handleDeviceMessage,
  getDeviceLogs,
  clearDeviceLogs,
} from '../services/ws.js';
import { notifyDeviceStatusChange } from '../services/notifications.js';

/** 6-char uppercase code avoiding confusable chars (0,O,I,1) */
function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(6);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

type AuthUser = { sub: string; orgId: string; role: string };

type PublishedTargetSummary = {
  id: string;
  type: 'content' | 'playlist' | 'schedule';
  name: string;
};

const PublishToDevicesSchema = z.object({
  workspaceId: z.string().uuid(),
  deviceIds: z.array(z.string().uuid()).min(1),
  resourceType: z.enum(['content', 'playlist', 'schedule']),
  resourceId: z.string().uuid(),
});

const UnpublishDevicesSchema = z.object({
  workspaceId: z.string().uuid(),
  deviceIds: z.array(z.string().uuid()).min(1),
});

async function resolvePublishedTargetMap(deviceRows: Array<{
  id: string;
  publishedContentId: string | null;
  publishedPlaylistId: string | null;
  publishedScheduleId: string | null;
}>) {
  const contentIds = [...new Set(deviceRows.map((device) => device.publishedContentId).filter((value): value is string => !!value))];
  const playlistIds = [...new Set(deviceRows.map((device) => device.publishedPlaylistId).filter((value): value is string => !!value))];
  const scheduleIds = [...new Set(deviceRows.map((device) => device.publishedScheduleId).filter((value): value is string => !!value))];

  const [contentRows, playlistRows, scheduleRows] = await Promise.all([
    contentIds.length > 0
      ? db.query.contentItems.findMany({
          where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
    playlistIds.length > 0
      ? db.query.playlists.findMany({
          where: and(inArray(playlists.id, playlistIds), isNull(playlists.deletedAt)),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
    scheduleIds.length > 0
      ? db.query.schedules.findMany({
          where: and(inArray(schedules.id, scheduleIds), isNull(schedules.deletedAt)),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const contentMap = Object.fromEntries(contentRows.map((item) => [item.id, item.name]));
  const playlistMap = Object.fromEntries(playlistRows.map((item) => [item.id, item.name]));
  const scheduleMap = Object.fromEntries(scheduleRows.map((item) => [item.id, item.name]));

  return Object.fromEntries(deviceRows.map((device) => {
    let target: PublishedTargetSummary | null = null;
    if (device.publishedContentId && contentMap[device.publishedContentId]) {
      target = { id: device.publishedContentId, type: 'content', name: contentMap[device.publishedContentId] };
    } else if (device.publishedPlaylistId && playlistMap[device.publishedPlaylistId]) {
      target = { id: device.publishedPlaylistId, type: 'playlist', name: playlistMap[device.publishedPlaylistId] };
    } else if (device.publishedScheduleId && scheduleMap[device.publishedScheduleId]) {
      target = { id: device.publishedScheduleId, type: 'schedule', name: scheduleMap[device.publishedScheduleId] };
    }
    return [device.id, target];
  })) as Record<string, PublishedTargetSummary | null>;
}

async function loadPlaylistsWithItems(playlistIds: string[]) {
  const uniquePlaylistIds = [...new Set(playlistIds.filter(Boolean))];
  if (uniquePlaylistIds.length === 0) return new Map();

  const playlistRows = await db.query.playlists.findMany({
    where: and(inArray(playlists.id, uniquePlaylistIds), isNull(playlists.deletedAt)),
  });
  if (playlistRows.length === 0) return new Map();

  const itemRows = await db.query.playlistItems.findMany({
    where: inArray(playlistItems.playlistId, playlistRows.map((playlist) => playlist.id)),
    orderBy: [desc(playlistItems.position)],
  });

  const contentIds = [...new Set(itemRows.map((item) => item.contentId).filter((value): value is string => !!value))];
  const contentRows = contentIds.length > 0
    ? await db.query.contentItems.findMany({
        where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)),
      })
    : [];

  const contentMap = Object.fromEntries(contentRows.map((content) => [content.id, content]));
  const itemsByPlaylistId = new Map<string, Array<typeof itemRows[number] & { content: typeof contentRows[number] | null }>>();

  for (const item of itemRows) {
    const playlistItemsForRow = itemsByPlaylistId.get(item.playlistId) ?? [];
    playlistItemsForRow.push({
      ...item,
      content: item.contentId ? (contentMap[item.contentId] ?? null) : null,
    });
    itemsByPlaylistId.set(item.playlistId, playlistItemsForRow);
  }

  return new Map(playlistRows.map((playlist) => [
    playlist.id,
    {
      ...playlist,
      items: itemsByPlaylistId.get(playlist.id) ?? [],
    },
  ]));
}

async function hydrateSchedules(scheduleRows: Array<typeof schedules.$inferSelect>) {
  if (scheduleRows.length === 0) return [];

  const slotRows = await db.query.scheduleSlots.findMany({
    where: inArray(scheduleSlots.scheduleId, scheduleRows.map((schedule) => schedule.id)),
  });

  const playlistMap = await loadPlaylistsWithItems(
    slotRows.map((slot) => slot.playlistId).filter((value): value is string => !!value),
  );
  const contentIds = [...new Set(slotRows.map((slot) => slot.contentId).filter((value): value is string => !!value))];
  const contentRows = contentIds.length > 0
    ? await db.query.contentItems.findMany({
        where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)),
      })
    : [];
  const contentMap = Object.fromEntries(contentRows.map((content) => [content.id, content]));
  const slotsByScheduleId = new Map<string, Array<typeof slotRows[number] & {
    playlist: Awaited<ReturnType<typeof loadPlaylistsWithItems>> extends Map<string, infer T> ? T | null : null;
    content: typeof contentRows[number] | null;
  }>>();

  for (const slot of slotRows) {
    const scheduleSlotsForRow = slotsByScheduleId.get(slot.scheduleId) ?? [];
    scheduleSlotsForRow.push({
      ...slot,
      playlist: slot.playlistId ? (playlistMap.get(slot.playlistId) ?? null) : null,
      content: slot.contentId ? (contentMap[slot.contentId] ?? null) : null,
    });
    slotsByScheduleId.set(slot.scheduleId, scheduleSlotsForRow);
  }

  return scheduleRows.map((schedule) => ({
    ...schedule,
    slots: slotsByScheduleId.get(schedule.id) ?? [],
  }));
}

async function loadScheduleById(scheduleId: string) {
  const scheduleRow = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, scheduleId), isNull(schedules.deletedAt)),
  });
  if (!scheduleRow) return null;

  const [hydrated] = await hydrateSchedules([scheduleRow]);
  return hydrated ?? null;
}

async function loadWorkspaceSchedules(workspaceId: string) {
  const scheduleRows = await db.query.schedules.findMany({
    where: and(eq(schedules.workspaceId, workspaceId), eq(schedules.isActive, true), isNull(schedules.deletedAt)),
  });

  return hydrateSchedules(scheduleRows);
}

async function loadPlaylistById(playlistId: string) {
  const playlistMap = await loadPlaylistsWithItems([playlistId]);
  return playlistMap.get(playlistId) ?? null;
}

export async function deviceRoutes(app: FastifyInstance) {
  // ── POST /devices/pair/request ─ unauthenticated, called by the Tizen device ─
  app.post('/pair/request', async (req, reply) => {
    const body = PairRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const { duid, modelName, modelCode, serialNumber, firmwareVersion } = body.data;

    // If this DUID already has a live device token, re-issue pairing code for migration
    const existing = duid
      ? await db.query.devices.findFirst({ where: eq(devices.duid, duid) })
      : null;

    let code = '';
    for (let i = 0; i < 5; i++) {
      const candidate = generatePairingCode();
      const taken = await db.query.devices.findFirst({
        where: eq(devices.pairingCode, candidate),
      });
      if (!taken) { code = candidate; break; }
    }
    if (!code) return reply.status(503).send({ error: 'Code generation failed, retry' });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    let device;
    if (existing) {
      // Reuse the existing device row; refresh pairing code
      [device] = await db
        .update(devices)
        .set({
          pairingCode: code,
          pairingExpiresAt: expiresAt,
          duid: duid ?? existing.duid,
          modelName: modelName ?? existing.modelName,
          modelCode: modelCode ?? existing.modelCode,
          serialNumber: serialNumber ?? existing.serialNumber,
          firmwareVersion: firmwareVersion ?? existing.firmwareVersion,
          ipAddress: req.ip ?? null,
          updatedAt: new Date(),
        })
        .where(eq(devices.id, existing.id))
        .returning();
    } else {
      [device] = await db
        .insert(devices)
        .values({
          pairingCode: code,
          pairingExpiresAt: expiresAt,
          status: 'unclaimed',
          duid: duid ?? null,
          modelName: modelName ?? null,
          modelCode: modelCode ?? null,
          serialNumber: serialNumber ?? null,
          firmwareVersion: firmwareVersion ?? null,
          ipAddress: req.ip ?? null,
        })
        .returning();
    }

    return reply.status(201).send({ deviceId: device!.id, code, expiresAt });
  });

  // ── GET /devices/pair/status ─ device polls until claimed ──────────────────
  app.get('/pair/status', async (req, reply) => {
    const { code } = req.query as { code?: string };
    if (!code) return reply.status(400).send({ error: 'code query param required' });

    const device = await db.query.devices.findFirst({
      where: eq(devices.pairingCode, code.toUpperCase()),
    });
    if (!device) return reply.status(404).send({ error: 'Code not found or expired' });

    if (!device.orgId || !device.deviceToken) {
      return reply.send({ status: 'pending' });
    }

    // Return token once, then clear the pairing code
    const token = device.deviceToken;
    await db
      .update(devices)
      .set({ pairingCode: null, pairingExpiresAt: null, updatedAt: new Date() })
      .where(eq(devices.id, device.id));

    return reply.send({ status: 'claimed', deviceId: device.id, deviceToken: token });
  });

  // ── POST /devices/pair/claim ─ authenticated user pairs a device ───────────
  app.post('/pair/claim', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = ClaimDeviceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, body.data.workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const device = await db.query.devices.findFirst({
      where: and(
        eq(devices.pairingCode, body.data.code.toUpperCase()),
        isNull(devices.orgId),
      ),
    });
    if (!device) return reply.status(404).send({ error: 'Pairing code not found or already claimed' });

    if (device.pairingExpiresAt && device.pairingExpiresAt < new Date()) {
      return reply.status(410).send({ error: 'Pairing code has expired' });
    }

    // Issue a 10-year device JWT
    const deviceToken = app.jwt.sign(
      { sub: device.id, type: 'device', orgId: user.orgId, workspaceId: body.data.workspaceId },
      { expiresIn: '87600h' },
    );

    const [updated] = await db
      .update(devices)
      .set({
        orgId: user.orgId,
        workspaceId: body.data.workspaceId,
        name: body.data.name ?? device.name,
        status: 'offline',
        deviceToken,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id))
      .returning();

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_PAIRED',
      entityType: 'device',
      entityId: device.id,
      ipAddress: req.ip,
    });

    return reply.status(201).send({ device: updated });
  });

  // ── GET /devices ─ list devices for org (optional ?workspaceId=) ───────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, tagIds: rawTagIds } = req.query as { workspaceId?: string; tagIds?: string };
    const tagIds = (rawTagIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchingIds = workspaceId && tagIds.length > 0
      ? await getEntityIdsForTags(workspaceId, 'device', tagIds)
      : null;
    if (matchingIds && matchingIds.length === 0) return reply.send([]);

    const list = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        isNull(devices.deletedAt),
        workspaceId ? eq(devices.workspaceId, workspaceId) : undefined,
        matchingIds ? inArray(devices.id, matchingIds) : undefined,
      ),
      orderBy: [desc(devices.createdAt)],
    });

    const assignedTagMap = workspaceId
      ? await getAssignedTagsForEntities(workspaceId, 'device', list.map((device) => device.id))
      : {};
    const publishedTargetMap = await resolvePublishedTargetMap(list);

    // Overlay live WS status
    const enriched = list.map((d) => ({
      ...d,
      assignedTags: assignedTagMap[d.id] ?? [],
      publishedTarget: publishedTargetMap[d.id] ?? null,
      status: isDeviceOnline(d.id) ? 'online' : d.status === 'online' ? 'offline' : d.status,
    }));

    return reply.send(enriched);
  });

  // ── GET /devices/:id ───────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const [screenshots, latestHeartbeat] = await Promise.all([
      db.query.deviceScreenshots.findMany({
        where: eq(deviceScreenshots.deviceId, id),
        orderBy: [desc(deviceScreenshots.takenAt)],
        limit: 20,
      }),
      db.query.deviceHeartbeats.findFirst({
        where: eq(deviceHeartbeats.deviceId, id),
        orderBy: [desc(deviceHeartbeats.createdAt)],
      }),
    ]);

    // Resolve content names for heartbeat now-playing data
    let currentContentName: string | null = null;
    let nextContentName: string | null = null;
    if (latestHeartbeat?.currentContentId || latestHeartbeat?.nextContentId) {
      const ids = [latestHeartbeat.currentContentId, latestHeartbeat.nextContentId].filter(Boolean) as string[];
      const contents = await db.query.contentItems.findMany({
        where: inArray(contentItems.id, ids),
        columns: { id: true, name: true },
      });
      const nameMap = Object.fromEntries(contents.map((c) => [c.id, c.name]));
      currentContentName = latestHeartbeat.currentContentId ? (nameMap[latestHeartbeat.currentContentId] ?? null) : null;
      nextContentName = latestHeartbeat.nextContentId ? (nameMap[latestHeartbeat.nextContentId] ?? null) : null;
    }

    const assignedTagMap = await getAssignedTagsForEntities(device.workspaceId ?? '', 'device', [id]);
    const publishedTargetMap = await resolvePublishedTargetMap([device]);

    return reply.send({
      device: {
        ...device,
        assignedTags: assignedTagMap[id] ?? [],
        publishedTarget: publishedTargetMap[id] ?? null,
        status: isDeviceOnline(id) ? 'online' : device.status === 'online' ? 'offline' : device.status,
      },
      screenshots,
      latestHeartbeat: latestHeartbeat
        ? { ...latestHeartbeat, currentContentName, nextContentName }
        : null,
    });
  });

  // ── GET /devices/:id/logs ─ recent in-memory device console logs ──────────
  app.get('/:id/logs', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const { limit: rawLimit } = req.query as { limit?: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const limit = Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 500;
    return reply.send({
      deviceId: id,
      online: isDeviceOnline(id),
      logs: getDeviceLogs(id, limit),
    });
  });

  // ── DELETE /devices/:id/logs ─ clear recent in-memory device console logs ─
  app.delete('/:id/logs', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    clearDeviceLogs(id);
    return reply.status(204).send();
  });

  // ── POST /devices/publish ─ assign content / playlist / schedule to devices ─
  app.post('/publish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = PublishToDevicesSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, body.data.workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const targetDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, body.data.workspaceId),
        inArray(devices.id, body.data.deviceIds),
        isNull(devices.deletedAt),
      ),
    });
    if (targetDevices.length !== body.data.deviceIds.length) {
      return reply.status(404).send({ error: 'One or more devices were not found in this workspace' });
    }

    if (body.data.resourceType === 'content') {
      const content = await db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.id, body.data.resourceId),
          eq(contentItems.workspaceId, body.data.workspaceId),
          isNull(contentItems.deletedAt),
        ),
      });
      if (!content) return reply.status(404).send({ error: 'Content not found' });
    }

    if (body.data.resourceType === 'playlist') {
      const playlist = await db.query.playlists.findFirst({
        where: and(
          eq(playlists.id, body.data.resourceId),
          eq(playlists.workspaceId, body.data.workspaceId),
          isNull(playlists.deletedAt),
        ),
      });
      if (!playlist) return reply.status(404).send({ error: 'Playlist not found' });
    }

    if (body.data.resourceType === 'schedule') {
      const schedule = await db.query.schedules.findFirst({
        where: and(
          eq(schedules.id, body.data.resourceId),
          eq(schedules.workspaceId, body.data.workspaceId),
          isNull(schedules.deletedAt),
        ),
      });
      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
    }

    const publishPatch = {
      publishedContentId: body.data.resourceType === 'content' ? body.data.resourceId : null,
      publishedPlaylistId: body.data.resourceType === 'playlist' ? body.data.resourceId : null,
      publishedScheduleId: body.data.resourceType === 'schedule' ? body.data.resourceId : null,
      updatedAt: new Date(),
    };

    await db
      .update(devices)
      .set(publishPatch)
      .where(and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, body.data.workspaceId),
        inArray(devices.id, body.data.deviceIds),
        isNull(devices.deletedAt),
      ));

    const refreshedDeviceIds: string[] = [];
    for (const device of targetDevices) {
      if (!isDeviceOnline(device.id)) continue;
      sendCommand(device.id, { type: 'refresh_schedule' });
      refreshedDeviceIds.push(device.id);
    }

    await Promise.all(targetDevices.map((device) => writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_PUBLISH_TARGET_UPDATED',
      entityType: 'device',
      entityId: device.id,
      meta: { resourceType: body.data.resourceType, resourceId: body.data.resourceId },
      ipAddress: req.ip,
    })));

    return reply.send({
      updated: targetDevices.length,
      refreshedDeviceIds,
      resourceType: body.data.resourceType,
      resourceId: body.data.resourceId,
    });
  });

  // ── POST /devices/unpublish ─ clear per-device published override ─────────
  app.post('/unpublish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = UnpublishDevicesSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, body.data.workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const targetDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, body.data.workspaceId),
        inArray(devices.id, body.data.deviceIds),
        isNull(devices.deletedAt),
      ),
    });
    if (targetDevices.length !== body.data.deviceIds.length) {
      return reply.status(404).send({ error: 'One or more devices were not found in this workspace' });
    }

    await db
      .update(devices)
      .set({
        publishedContentId: null,
        publishedPlaylistId: null,
        publishedScheduleId: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, body.data.workspaceId),
        inArray(devices.id, body.data.deviceIds),
        isNull(devices.deletedAt),
      ));

    const refreshedDeviceIds: string[] = [];
    for (const device of targetDevices) {
      if (!isDeviceOnline(device.id)) continue;
      sendCommand(device.id, { type: 'refresh_schedule' });
      refreshedDeviceIds.push(device.id);
    }

    await Promise.all(targetDevices.map((device) => writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_PUBLISH_TARGET_CLEARED',
      entityType: 'device',
      entityId: device.id,
      ipAddress: req.ip,
    })));

    return reply.send({ updated: targetDevices.length, refreshedDeviceIds });
  });

  // ── PATCH /devices/:id ─────────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const body = UpdateDeviceSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const [updated] = await db
      .update(devices)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── POST /devices/:id/replace ─ transfer config to a newly paired device ──
  app.post('/:id/replace', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = z.object({ newDeviceCode: z.string().trim().min(6).max(12) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const oldDevice = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!oldDevice) return reply.status(404).send({ error: 'Device not found' });

    const newDevice = await db.query.devices.findFirst({
      where: and(
        eq(devices.pairingCode, body.data.newDeviceCode.toUpperCase()),
        isNull(devices.orgId),
        isNull(devices.deletedAt),
      ),
    });
    if (!newDevice) return reply.status(404).send({ error: 'Replacement device code not found or already claimed' });
    if (newDevice.pairingExpiresAt && newDevice.pairingExpiresAt < new Date()) {
      return reply.status(410).send({ error: 'Replacement device code has expired' });
    }

    const deviceToken = app.jwt.sign(
      { sub: newDevice.id, type: 'device', orgId: user.orgId, workspaceId: oldDevice.workspaceId },
      { expiresIn: '87600h' },
    );

    const [updatedReplacement] = await db
      .update(devices)
      .set({
        orgId: oldDevice.orgId,
        workspaceId: oldDevice.workspaceId,
        name: oldDevice.name,
        status: 'offline',
        timezone: oldDevice.timezone,
        resolution: oldDevice.resolution,
        settings: oldDevice.settings,
        deviceToken,
        screenOrientation: oldDevice.screenOrientation,
        powerState: oldDevice.powerState,
        irLock: oldDevice.irLock,
        buttonLock: oldDevice.buttonLock,
        autoPowerOn: oldDevice.autoPowerOn,
        ntpEnabled: oldDevice.ntpEnabled,
        ntpServer: oldDevice.ntpServer,
        ntpTimezone: oldDevice.ntpTimezone,
        latitude: oldDevice.latitude,
        longitude: oldDevice.longitude,
        locationLabel: oldDevice.locationLabel,
        zones: oldDevice.zones,
        screenshotIntervalMin: oldDevice.screenshotIntervalMin,
        defaultPlaylistId: oldDevice.defaultPlaylistId,
        pairingCode: null,
        pairingExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, newDevice.id))
      .returning();

    await cloneEntityTags(oldDevice.workspaceId ?? '', 'device', oldDevice.id, newDevice.id);

    await db
      .update(devices)
      .set({
        deletedAt: new Date(),
        status: 'offline',
        updatedAt: new Date(),
      })
      .where(eq(devices.id, oldDevice.id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_REPLACED',
      entityType: 'device',
      entityId: oldDevice.id,
      ipAddress: req.ip,
      meta: { replacementDeviceId: newDevice.id, replacementDeviceCode: body.data.newDeviceCode.toUpperCase() },
    });

    return reply.send({ device: updatedReplacement, replacedDeviceId: oldDevice.id });
  });

  // ── DELETE /devices/:id ────────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    await db
      .update(devices)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(devices.id, id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_DELETED',
      entityType: 'device',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // ── POST /devices/:id/command ─ send remote command ────────────────────────
  app.post('/:id/command', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const body = DeviceCommandSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (!isDeviceOnline(id)) {
      return reply.status(409).send({ error: 'Device is offline' });
    }

    const cmd = body.data;
    // Map discriminated-union command to WsCommand (payload varies by type)
    const wsCmd = 'payload' in cmd
      ? { type: cmd.command, payload: (cmd as { command: string; payload: unknown }).payload }
      : { type: cmd.command };

    sendCommand(id, wsCmd as Parameters<typeof sendCommand>[1]);

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_COMMAND_SENT',
      entityType: 'device',
      entityId: id,
      meta: { command: cmd.command },
      ipAddress: req.ip,
    });

    return reply.send({ sent: true, command: cmd.command });
  });

  // ── GET /ws/device ─ WebSocket endpoint for Tizen devices ──────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/ws/device', { websocket: true }, async (socket: any, req: any) => {
    const token = (req.query as Record<string, string | undefined>).token;
    if (!token) {
      socket.close(4001, 'Missing token');
      return;
    }

    let payload: { sub: string; type: string; orgId: string };
    try {
      payload = app.jwt.verify<{ sub: string; type: string; orgId: string }>(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    if (payload.type !== 'device') {
      socket.close(4003, 'Invalid token type');
      return;
    }

    const deviceId = payload.sub;
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, deviceId), isNull(devices.deletedAt)),
    });
    if (!device) {
      socket.close(4004, 'Device not found');
      return;
    }

    registerDevice(deviceId, socket as { send: (d: string) => void; close: () => void; readyState: number });
    await db
      .update(devices)
      .set({ status: 'online', lastSeen: new Date(), updatedAt: new Date() })
      .where(eq(devices.id, deviceId));

    if (device.orgId && device.workspaceId && device.status !== 'online') {
      await notifyDeviceStatusChange({
        orgId: device.orgId,
        workspaceId: device.workspaceId,
        deviceId,
        deviceName: device.name,
        status: 'online',
      });
    }

    app.log.info({ deviceId }, 'Device connected via WS');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('message', async (rawData: any) => {
      await handleDeviceMessage(deviceId, rawData.toString() as string);
    });

    socket.on('close', async () => {
      unregisterDevice(deviceId);
      await db
        .update(devices)
        .set({ status: 'offline', updatedAt: new Date() })
        .where(eq(devices.id, deviceId));

      if (device.orgId && device.workspaceId) {
        await notifyDeviceStatusChange({
          orgId: device.orgId,
          workspaceId: device.workspaceId,
          deviceId,
          deviceName: device.name,
          status: 'offline',
        });
      }
      app.log.info({ deviceId }, 'Device disconnected');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('error', (err: any) => {
      app.log.error({ deviceId, err }, 'Device WS error');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Device-authenticated routes  (JWT type === 'device')
  // Used by the Tizen player app to fetch schedule / content
  // ════════════════════════════════════════════════════════════════════════════

  /** Decode and verify a device JWT from the Authorization header or ?token= query param */
  function authenticateDevice(req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]): { deviceId: string; orgId: string; workspaceId: string } | null {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (req.query as Record<string, string | undefined>).token;
    if (!token) { reply.status(401).send({ error: 'Missing device token' }); return null; }
    try {
      const p = app.jwt.verify<{ sub: string; type: string; orgId: string; workspaceId: string }>(token);
      if (p.type !== 'device') { reply.status(403).send({ error: 'Invalid token type' }); return null; }
      return { deviceId: p.sub, orgId: p.orgId, workspaceId: p.workspaceId };
    } catch {
      reply.status(401).send({ error: 'Invalid or expired device token' });
      return null;
    }
  }

  // ── GET /devices/device/schedule ─ full schedule + content manifest ─────────
  app.get('/device/schedule', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { workspaceId } = auth;

    const workspaceSchedules = await loadWorkspaceSchedules(workspaceId);

    return reply.send({ schedules: workspaceSchedules });
  });

  // ── GET /devices/device/workspace ─ workspace info inc. defaults ──────────
  app.get('/device/workspace', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Device not found' });

    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, auth.workspaceId), isNull(workspaces.deletedAt)),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    // Include device-level default playlist override before workspace fallback.
    let defaultPlaylist = null;
    const effectiveDefaultPlaylistId = device.defaultPlaylistId ?? workspace.defaultPlaylistId;
    if (effectiveDefaultPlaylistId) {
      defaultPlaylist = await loadPlaylistById(effectiveDefaultPlaylistId);
    }

    const [publishedContent, publishedPlaylist, publishedSchedule] = await Promise.all([
      device.publishedContentId
        ? db.query.contentItems.findFirst({
          where: and(eq(contentItems.id, device.publishedContentId), isNull(contentItems.deletedAt)),
        })
        : Promise.resolve(null),
      device.publishedPlaylistId
        ? loadPlaylistById(device.publishedPlaylistId)
        : Promise.resolve(null),
      device.publishedScheduleId
        ? loadScheduleById(device.publishedScheduleId)
        : Promise.resolve(null),
    ]);

    return reply.send({ workspace, defaultPlaylist, publishedContent, publishedPlaylist, publishedSchedule });
  });

  // ── GET /devices/device/content/:id/file ─ stream content file to device ──
  app.get('/device/content/:id/file', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const item = await db.query.contentItems.findFirst({
      where: and(
        eq(contentItems.id, id),
        eq(contentItems.workspaceId, auth.workspaceId),
        isNull(contentItems.deletedAt),
      ),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Content not found' });

    const absPath = path.resolve(STORAGE_ROOT, item.filePath);
    try {
      await fsPromises.access(absPath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    const stat = await fsPromises.stat(absPath);
    reply.header('Content-Type', item.mimeType ?? 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    reply.header('Content-Disposition', `inline; filename="${item.originalName ?? id}"`);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(absPath));
  });

  // ── GET /devices/device/emergency ─ active emergency override ────────────
  app.get('/device/emergency', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { orgId, workspaceId } = auth;

    const { emergencyOverrides } = await import('@signage/db');
    const { or } = await import('drizzle-orm');

    const active = await db.query.emergencyOverrides.findFirst({
      where: and(
        eq(emergencyOverrides.orgId, orgId),
        isNull(emergencyOverrides.clearedAt),
        or(
          eq(emergencyOverrides.scope, 'org'),
          and(eq(emergencyOverrides.scope, 'workspace'), eq(emergencyOverrides.scopeId, workspaceId)),
        ),
      ),
      orderBy: [desc(emergencyOverrides.createdAt)],
    });

    return reply.send({ emergency: active ?? null });
  });
}

