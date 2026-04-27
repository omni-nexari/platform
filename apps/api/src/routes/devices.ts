import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { db, devices, deviceScreenshots, deviceHeartbeats, workspaces, workspaceMembers, schedules, scheduleSlots, playlists, playlistItems, contentItems, syncGroups, syncPlaylists, syncPlaylistItems, playerReleases, playEvents } from '@signage/db';
import { eq, and, isNull, desc, asc, inArray, sql, ilike, gte, lte, lt } from 'drizzle-orm';
import { z } from 'zod';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
import { ClaimDeviceSchema, UpdateDeviceSchema, DeviceCommandSchema, PairRequestSchema } from '@signage/shared';
import { writeAuditLog } from '../services/audit.js';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { MDC_ALL_COMMAND_NAMES } from '../services/mdc.js';
import { dispatchWebhookEvent } from '../services/webhooks.js';
import {
  sendCommand,
  requestRemoteStatus,
  requestMdcControl,
  requestTizenProbe,
  requestTizenCommand,
  isDeviceOnline,
  registerDevice,
  unregisterDevice,
  handleDeviceMessage,
  getDeviceLogs,
  clearDeviceLogs,
  registerLiveViewer,
  unregisterLiveViewer,
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
  type: 'content' | 'playlist' | 'schedule' | 'sync-group';
  name: string;
};

const DEVICE_RECENT_ACTIVITY_MS = 90_000;

function hasRecentDeviceActivity(lastSeen: Date | string | null | undefined): boolean {
  if (!lastSeen) return false;
  const seenAt = lastSeen instanceof Date ? lastSeen.getTime() : new Date(lastSeen).getTime();
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt <= DEVICE_RECENT_ACTIVITY_MS;
}

function resolveReportedDeviceStatus(device: { id: string; status: string | null; lastSeen?: Date | string | null }): string | null {
  if (isDeviceOnline(device.id) || hasRecentDeviceActivity(device.lastSeen)) {
    return 'online';
  }
  return device.status === 'online' ? 'offline' : device.status;
}

const PublishToDevicesSchema = z.object({
  workspaceId: z.string().uuid(),
  deviceIds: z.array(z.string().uuid()).min(1),
  resourceType: z.enum(['content', 'playlist', 'schedule', 'sync-group']),
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
  publishedSyncGroupId?: string | null;
}>) {
  const contentIds = [...new Set(deviceRows.map((device) => device.publishedContentId).filter((value): value is string => !!value))];
  const playlistIds = [...new Set(deviceRows.map((device) => device.publishedPlaylistId).filter((value): value is string => !!value))];
  const scheduleIds = [...new Set(deviceRows.map((device) => device.publishedScheduleId).filter((value): value is string => !!value))];
  const syncGroupIds = [...new Set(deviceRows.map((device) => device.publishedSyncGroupId).filter((value): value is string => !!value))];

  const [contentRows, playlistRows, scheduleRows, syncGroupRows] = await Promise.all([
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
    syncGroupIds.length > 0
      ? db.query.syncGroups.findMany({
          where: and(inArray(syncGroups.id, syncGroupIds), isNull(syncGroups.deletedAt)),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const contentMap = Object.fromEntries(contentRows.map((item) => [item.id, item.name]));
  const playlistMap = Object.fromEntries(playlistRows.map((item) => [item.id, item.name]));
  const scheduleMap = Object.fromEntries(scheduleRows.map((item) => [item.id, item.name]));
  const syncGroupMap = Object.fromEntries(syncGroupRows.map((item) => [item.id, item.name]));

  return Object.fromEntries(deviceRows.map((device) => {
    let target: PublishedTargetSummary | null = null;
    if (device.publishedContentId && contentMap[device.publishedContentId]) {
      target = { id: device.publishedContentId, type: 'content', name: contentMap[device.publishedContentId]! };
    } else if (device.publishedPlaylistId && playlistMap[device.publishedPlaylistId]) {
      target = { id: device.publishedPlaylistId, type: 'playlist', name: playlistMap[device.publishedPlaylistId]! };
    } else if (device.publishedScheduleId && scheduleMap[device.publishedScheduleId]) {
      target = { id: device.publishedScheduleId, type: 'schedule', name: scheduleMap[device.publishedScheduleId]! };
    } else if (device.publishedSyncGroupId && syncGroupMap[device.publishedSyncGroupId]) {
      target = { id: device.publishedSyncGroupId, type: 'sync-group', name: syncGroupMap[device.publishedSyncGroupId]! };
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

function buildSingleContentPlaylist(content: NonNullable<Awaited<ReturnType<typeof db.query.contentItems.findFirst>>>) {
  return {
    id: `published-content-${content.id}`,
    name: content.name,
    items: [
      {
        id: `published-content-item-${content.id}`,
        playlistId: `published-content-${content.id}`,
        position: 0,
        contentId: content.id,
        nestedPlaylistId: null,
        duration: content.duration ?? 10,
        transitionEffect: 'none',
        conditions: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
        content,
      },
    ],
  };
}

function buildLegacyPublishedSchedule(target: {
  content?: NonNullable<Awaited<ReturnType<typeof db.query.contentItems.findFirst>>> | null;
  playlist?: Awaited<ReturnType<typeof loadPlaylistById>> | null;
  schedule?: Awaited<ReturnType<typeof loadScheduleById>> | null;
}) {
  if (target.schedule) {
    return { ...target.schedule, isActive: true };
  }

  if (target.playlist) {
    return {
      id: `published-playlist-schedule-${target.playlist.id}`,
      workspaceId: target.playlist.workspaceId,
      createdBy: null,
      name: target.playlist.name,
      description: 'Legacy published playlist fallback',
      type: 'override',
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      slots: [
        {
          id: `published-playlist-slot-${target.playlist.id}`,
          scheduleId: `published-playlist-schedule-${target.playlist.id}`,
          playlistId: target.playlist.id,
          contentId: null,
          startTime: null,
          endTime: null,
          recurrenceType: 'daily',
          date: null,
          daysOfWeek: null,
          label: null,
          color: '#3b82f6',
          priority: 9999,
          createdAt: new Date(),
          updatedAt: new Date(),
          playlist: target.playlist,
          content: null,
        },
      ],
    };
  }

  if (target.content) {
    return {
      id: `published-content-schedule-${target.content.id}`,
      workspaceId: target.content.workspaceId,
      createdBy: target.content.uploadedBy,
      name: target.content.name,
      description: 'Legacy published content fallback',
      type: 'override',
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      slots: [
        {
          id: `published-content-slot-${target.content.id}`,
          scheduleId: `published-content-schedule-${target.content.id}`,
          playlistId: null,
          contentId: target.content.id,
          startTime: null,
          endTime: null,
          recurrenceType: 'daily',
          date: null,
          daysOfWeek: null,
          label: null,
          color: '#3b82f6',
          priority: 9999,
          createdAt: new Date(),
          updatedAt: new Date(),
          playlist: null,
          content: target.content,
        },
      ],
    };
  }

  return null;
}

/** 5-C: Compute a 0–100 device health score from the latest heartbeat + device row. */
function computeHealthScore(
  device: { lastSeen?: Date | string | null; playerVersion?: string | null },
  heartbeat: {
    temperatureC?: number | null;
    cpuLoad?: number | null;
    storageFreeBytes?: number | null;
    playerVersion?: string | null;
  } | null,
  latestReleaseVersion: string | null,
): number {
  let score = 0;
  // 30 pts — last seen within 90s
  if (hasRecentDeviceActivity(device.lastSeen)) score += 30;
  else if (device.lastSeen) {
    const age = Date.now() - new Date(device.lastSeen).getTime();
    if (age < 5 * 60 * 1000) score += 15; // within 5 min
  }
  // 20 pts — temperature < 60°C
  const temp = heartbeat?.temperatureC;
  if (temp != null) score += temp < 60 ? 20 : temp < 75 ? 10 : 0;
  // 20 pts — cpu load < 80
  const cpu = heartbeat?.cpuLoad;
  if (cpu != null) score += cpu < 80 ? 20 : cpu < 90 ? 10 : 0;
  // 15 pts — storage free > 100 MB
  const free = heartbeat?.storageFreeBytes;
  if (free != null) score += free > 100 * 1024 * 1024 ? 15 : free > 10 * 1024 * 1024 ? 7 : 0;
  // 15 pts — player version current
  const pv = heartbeat?.playerVersion ?? device.playerVersion;
  if (pv && latestReleaseVersion && pv === latestReleaseVersion) score += 15;
  else if (!latestReleaseVersion) score += 15; // unknown — assume ok
  return Math.min(100, score);
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

    if (existing?.orgId && existing.deviceToken && !existing.deletedAt) {
      // Device reinstalled — reset mdcNetworkStandby so auto-enable fires on next WS connect
      await db
        .update(devices)
        .set({
          duid: duid ?? existing.duid,
          modelName: modelName ?? existing.modelName,
          modelCode: modelCode ?? existing.modelCode,
          serialNumber: serialNumber ?? existing.serialNumber,
          firmwareVersion: firmwareVersion ?? existing.firmwareVersion,
          ipAddress: req.ip ?? null,
          lastSeen: new Date(),
          updatedAt: new Date(),
          mdcNetworkStandby: null,
        })
        .where(eq(devices.id, existing.id));

      return reply.status(200).send({
        status: 'claimed',
        deviceId: existing.id,
        deviceToken: existing.deviceToken,
      });
    }

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
        type: body.data.type ?? 'signage',
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
    const { workspaceId, tagIds: rawTagIds, q, status } = req.query as {
      workspaceId?: string; tagIds?: string; q?: string; status?: string;
    };
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
        q ? ilike(devices.name, `%${q}%`) : undefined,
      ),
      orderBy: [desc(devices.createdAt)],
    });

    const assignedTagMap = workspaceId
      ? await getAssignedTagsForEntities(workspaceId, 'device', list.map((device) => device.id))
      : {};
    const publishedTargetMap = await resolvePublishedTargetMap(list);

    // Latest screenshot per device
    const deviceIds = list.map((d) => d.id);
    const screenshotRows = deviceIds.length > 0
      ? await db
          .select({ deviceId: deviceScreenshots.deviceId, id: deviceScreenshots.id })
          .from(deviceScreenshots)
          .where(inArray(deviceScreenshots.deviceId, deviceIds))
          .orderBy(desc(deviceScreenshots.takenAt))
      : [];
    const latestScreenshotMap: Record<string, string> = {};
    for (const row of screenshotRows) {
      if (!latestScreenshotMap[row.deviceId]) latestScreenshotMap[row.deviceId] = row.id;
    }

    // Overlay live WS status
    const enriched = list.map((d) => ({
      ...d,
      assignedTags: assignedTagMap[d.id] ?? [],
      publishedTarget: publishedTargetMap[d.id] ?? null,
      status: resolveReportedDeviceStatus(d),
      latestScreenshotId: latestScreenshotMap[d.id] ?? null,
    }));

    const result = status ? enriched.filter((d) => d.status === status) : enriched;
    return reply.send(result);
  });

  // ── GET /devices/:id ───────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const [screenshots, latestHeartbeat, latestRelease] = await Promise.all([
      db.query.deviceScreenshots.findMany({
        where: eq(deviceScreenshots.deviceId, id),
        orderBy: [desc(deviceScreenshots.takenAt)],
        limit: 20,
      }),
      db.query.deviceHeartbeats.findFirst({
        where: eq(deviceHeartbeats.deviceId, id),
        orderBy: [desc(deviceHeartbeats.createdAt)],
      }),
      db.query.playerReleases.findFirst({
        where: eq(playerReleases.isLatest, true),
        columns: { version: true },
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
        status: resolveReportedDeviceStatus(device),
        healthScore: computeHealthScore(device, latestHeartbeat ?? null, latestRelease?.version ?? null),
      },
      screenshots,
      latestHeartbeat: latestHeartbeat
        ? { ...latestHeartbeat, currentContentName, nextContentName }
        : null,
    });
  });

  // ── GET /devices/:id/screenshots/:screenshotId ── serve image file ─────────
  app.get('/:id/screenshots/:screenshotId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, screenshotId } = req.params as { id: string; screenshotId: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const shot = await db.query.deviceScreenshots.findFirst({
      where: and(eq(deviceScreenshots.id, screenshotId), eq(deviceScreenshots.deviceId, id)),
    });
    if (!shot) return reply.status(404).send({ error: 'Screenshot not found' });

    const filePath = path.join(process.cwd(), STORAGE_ROOT, shot.storageKey);
    try {
      await fsPromises.access(filePath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(filePath));
  });

  // ── DELETE /devices/:id/screenshots/:screenshotId ─────────────────────────
  app.delete('/:id/screenshots/:screenshotId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, screenshotId } = req.params as { id: string; screenshotId: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const shot = await db.query.deviceScreenshots.findFirst({
      where: and(eq(deviceScreenshots.id, screenshotId), eq(deviceScreenshots.deviceId, id)),
    });
    if (!shot) return reply.status(404).send({ error: 'Screenshot not found' });

    await db.delete(deviceScreenshots).where(eq(deviceScreenshots.id, screenshotId));
    const filePath = path.join(process.cwd(), STORAGE_ROOT, shot.storageKey);
    await fsPromises.unlink(filePath).catch(() => { /* best-effort */ });

    return reply.send({ ok: true });
  });

  // ── GET /devices/:id/screenshot/stream ── SSE live-view relay ─────────────
  // Exempt from rate limiting — one long-lived connection replaces many polls.
  app.get('/:id/screenshot/stream', { config: { rateLimit: false }, onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    // Take full ownership of the raw socket — Fastify must not send its own response
    reply.hijack();

    // SSE headers — keep the raw Node response open
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });
    reply.raw.write(':\n\n'); // initial comment keeps the connection alive

    // Kick off live capture on the device. Practical floor is ~3 s/frame on Samsung hardware
    // but allow 1 s to let the device report its real capability.
    const rawInterval = (req.query as Record<string, string>).intervalMs;
    const intervalMs = Math.max(1_000, Math.min(10_000, Number(rawInterval) || 1_000));
    sendCommand(device.id, { type: 'start_live_capture', payload: { intervalMs } });

    // Register this SSE connection as a live-frame receiver
    const push = (dataBase64: string) => {
      reply.raw.write(`data: ${dataBase64}\n\n`);
    };
    registerLiveViewer(device.id, push);

    // Send a heartbeat every 15 s so proxies don't close idle connections
    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(':\n\n');
    }, 15_000);

    // Clean up when the client disconnects
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unregisterLiveViewer(device.id, push);
      sendCommand(device.id, { type: 'stop_live_capture' });
    });

    // Fastify must not touch the response after this point
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
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
      online: isDeviceOnline(id) || hasRecentDeviceActivity(device.lastSeen),
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

    if (body.data.resourceType === 'sync-group') {
      const syncGroup = await db.query.syncGroups.findFirst({
        where: and(
          eq(syncGroups.id, body.data.resourceId),
          eq(syncGroups.workspaceId, body.data.workspaceId),
          isNull(syncGroups.deletedAt),
        ),
      });
      if (!syncGroup) return reply.status(404).send({ error: 'Sync group not found' });
    }

    const publishPatch = {
      publishedContentId: body.data.resourceType === 'content' ? body.data.resourceId : null,
      publishedPlaylistId: body.data.resourceType === 'playlist' ? body.data.resourceId : null,
      publishedScheduleId: body.data.resourceType === 'schedule' ? body.data.resourceId : null,
      publishedSyncGroupId: body.data.resourceType === 'sync-group' ? body.data.resourceId : null,
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
        publishedSyncGroupId: null,
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

    // Before powering off, ensure network standby is enabled so the device
    // can be woken up again. Without it, power_on via network will not work.
    if (cmd.command === 'power_off' && device.mdcNetworkStandby !== 1) {
      try {
        const nsResult = await requestMdcControl(id, 'network_standby_set', { value: 1 }, 10_000);
        if (nsResult.ok) {
          await db.update(devices).set({ mdcNetworkStandby: 1, updatedAt: new Date() }).where(eq(devices.id, id));
        }
      } catch {
        // Non-blocking — proceed with power_off even if this fails
      }
    }

    // Map discriminated-union command to WsCommand (payload varies by type)
    const wsCmd = 'payload' in cmd
      ? { type: cmd.command, payload: (cmd as { command: string; payload: unknown }).payload }
      : { type: cmd.command };

    sendCommand(id, wsCmd as Parameters<typeof sendCommand>[1]);

    // Immediately write powerState to DB so the 15s UI poll reflects the change
    if (cmd.command === 'power_off') {
      await db.update(devices).set({ powerState: 'off', updatedAt: new Date() }).where(eq(devices.id, id));
    } else if (cmd.command === 'power_on') {
      await db.update(devices).set({ powerState: 'on', updatedAt: new Date() }).where(eq(devices.id, id));
    } else if (cmd.command === 'set_ntp') {
      await db.update(devices).set({
        ntpEnabled: true,
        ntpServer: cmd.payload.server || null,
        ntpTimezone: cmd.payload.timezone || null,
        updatedAt: new Date(),
      }).where(eq(devices.id, id));
    }

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

    // Auto-enable network standby whenever it is not confirmed ON.
    // Fires on first pairing (null), after reinstall (null), or if mdc_poll found it off (0).
    if (device.orgId && device.mdcNetworkStandby !== 1) {
      setTimeout(() => {
        requestMdcControl(deviceId, 'network_standby_set', { value: 1 }, 10_000)
          .then(async (result) => {
            if (result.ok) {
              await db.update(devices).set({ mdcNetworkStandby: 1, updatedAt: new Date() }).where(eq(devices.id, deviceId));
            }
          })
          .catch(() => { /* best-effort */ });
      }, 3000);
    }

    app.log.info({ deviceId }, 'Device connected via WS');
    try {
      socket.send(JSON.stringify({ type: 'server_ack', payload: { timestamp: new Date().toISOString(), reason: 'connected' } }));
    } catch {}

    // Kick off periodic screenshots on the device.
    // The interval command also triggers an immediate capture after 3 s.
    const intervalMin = device.screenshotIntervalMin ?? 5;
    setTimeout(() => {
      sendCommand(deviceId, { type: 'set_screenshot_interval', payload: { minutes: intervalMin } });
    }, 5_000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on('message', async (rawData: any) => {
      const rawText = rawData.toString() as string;
      let messageType: string | undefined;
      try {
        const parsed = JSON.parse(rawText) as { type?: string; event?: string };
        messageType = parsed.type || parsed.event;
      } catch {}

      await handleDeviceMessage(deviceId, rawText);

      if (messageType === 'heartbeat') {
        try {
          socket.send(JSON.stringify({ type: 'server_ack', payload: { timestamp: new Date().toISOString(), reason: 'heartbeat' } }));
        } catch {}
      }
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

  // ── GET /devices/time ─ lightweight server timestamp for player clock sync ─
  app.get('/time', async (_req, reply) => {
    return reply.send({ timestamp: Date.now() });
  });

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

    const [device, workspaceSchedules] = await Promise.all([
      db.query.devices.findFirst({
        where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
      }),
      loadWorkspaceSchedules(workspaceId),
    ]);

    if (!device) return reply.status(404).send({ error: 'Device not found' });

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

    const legacyPublishedSchedule = buildLegacyPublishedSchedule({
      content: publishedContent ?? null,
      playlist: publishedPlaylist,
      schedule: publishedSchedule,
    });

    return reply.send({
      schedules: legacyPublishedSchedule
        ? [legacyPublishedSchedule, ...workspaceSchedules]
        : workspaceSchedules,
    });
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

    // Resolve device-level default playlist override before workspace fallback.
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

    // Resolve sync group + its sync playlist when publishedSyncGroupId is set
    let publishedSyncGroup: {
      id: string; groupId: number; mode: string;
      syncPlaylist: { id: string; name: string; items: Array<{ id: string; contentId: string | null; durationSeconds: number | null; sortOrder: number; content: typeof contentItems.$inferSelect | null }> } | null;
    } | null = null;

    if (device.publishedSyncGroupId) {
      const sg = await db.query.syncGroups.findFirst({
        where: and(eq(syncGroups.id, device.publishedSyncGroupId), isNull(syncGroups.deletedAt)),
      });
      if (sg && sg.syncPlaylistId) {
        const sp = await db.query.syncPlaylists.findFirst({
          where: and(eq(syncPlaylists.id, sg.syncPlaylistId), isNull(syncPlaylists.deletedAt)),
        });
        if (sp) {
          const spItems = await db.query.syncPlaylistItems.findMany({
            where: eq(syncPlaylistItems.syncPlaylistId, sp.id),
            orderBy: [syncPlaylistItems.sortOrder],
          });
          const spContentIds = [...new Set(spItems.map((i) => i.contentId).filter((v): v is string => !!v))];
          const spContentRows = spContentIds.length > 0
            ? await db.query.contentItems.findMany({
                where: and(inArray(contentItems.id, spContentIds), isNull(contentItems.deletedAt)),
              })
            : [];
          const spContentMap = Object.fromEntries(spContentRows.map((c) => [c.id, c]));
          publishedSyncGroup = {
            id: sg.id,
            groupId: sg.groupId,
            mode: sg.mode,
            syncPlaylist: {
              id: sp.id,
              name: sp.name,
              items: spItems.map((item) => ({
                id: item.id,
                contentId: item.contentId,
                durationSeconds: item.durationSeconds,
                sortOrder: item.sortOrder,
                content: item.contentId ? (spContentMap[item.contentId] ?? null) : null,
              })),
            },
          };
        }
      }
    }

    const compatibilityDefaultPlaylist = publishedPlaylist
      ?? (publishedContent ? buildSingleContentPlaylist(publishedContent) : null)
      ?? defaultPlaylist;

    return reply.send({
      workspace,
      deviceType: device.type ?? 'signage',
      defaultPlaylist: compatibilityDefaultPlaylist,
      publishedContent,
      publishedPlaylist,
      publishedSchedule,
      publishedSyncGroup,
      zones: device.zones ?? [],
    });
  });

  // ── GET /devices/device/playlist/:id ─ fetch playlist by ID (device-auth) ─
  app.get('/device/playlist/:id', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const playlist = await loadPlaylistById(id);
    if (!playlist || (playlist as any).workspaceId !== auth.workspaceId) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.send(playlist);
  });

  // ── GET /devices/device/content/:id ─ fetch content metadata (device-auth) ─
  app.get('/device/content/:id', async (req, reply) => {
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
    if (!item) return reply.status(404).send({ error: 'Not found' });
    return reply.send(item);
  });

  // ── GET /devices/device/web-proxy ─ proxy a remote URL, stripping framing headers ──
  // Used by WEB_URL content type so iframes can load sites that send X-Frame-Options.
  app.get('/device/web-proxy', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { url } = req.query as Record<string, string | undefined>;
    if (!url) return reply.status(400).send({ error: 'url query param required' });

    let targetUrl: URL;
    try {
      targetUrl = new URL(url);
    } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return reply.status(400).send({ error: 'Only http/https URLs are supported' });
    }

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (SmartTV; Tizen 4.0) NexariSignage/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
      });
    } catch (err: any) {
      return reply.status(502).send({ error: 'Failed to fetch upstream URL', detail: err?.message });
    }

    // Forward status and content-type
    reply.code(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) reply.header('Content-Type', contentType);

    // Strip framing-prevention headers; remove frame-ancestors from CSP
    const csp = upstream.headers.get('content-security-policy');
    if (csp) {
      const cleanedCsp = csp
        .split(';')
        .map((d) => d.trim())
        .filter((d) => !d.toLowerCase().startsWith('frame-ancestors'))
        .join('; ');
      reply.header('Content-Security-Policy', cleanedCsp);
    }
    // Do NOT forward X-Frame-Options — omitting it removes the restriction
    reply.header('Cache-Control', 'no-store');
    reply.header('Access-Control-Allow-Origin', '*');

    const body = await upstream.arrayBuffer();
    return reply.send(Buffer.from(body));
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
    const fileSize = stat.size;
    const mimeType = item.mimeType ?? 'application/octet-stream';
    const disposition = `inline; filename="${item.originalName ?? id}"`;

    // Common headers always sent
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', disposition);
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Accept-Ranges', 'bytes');

    const rangeHeader = (req.headers as Record<string, string | undefined>)['range'];
    if (rangeHeader) {
      // Parse "bytes=start-end"
      const [startStr, endStr] = rangeHeader.replace(/^bytes=/, '').split('-');
      const start = startStr ? parseInt(startStr, 10) || 0 : 0;
      const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
      if (start > end || start >= fileSize) {
        reply.header('Content-Range', `bytes */${fileSize}`);
        return reply.status(416).send();
      }
      const chunkSize = end - start + 1;
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Content-Length', String(chunkSize));
      return reply.send(createReadStream(absPath, { start, end }));
    }

    reply.header('Content-Length', String(fileSize));
    return reply.send(createReadStream(absPath));
  });

  // ── GET /devices/device/content/:id/html5/:token/* ─ serve extracted HTML5 package ──
  // The device token is embedded in the path (not query string) so that all
  // relative asset requests (scripts, stylesheets, images) made by the iframe
  // automatically carry the token and are served from the same route.
  app.get('/device/content/:id/html5/:token/*', async (req, reply) => {
    const { id, token } = req.params as { id: string; token: string; '*': string };
    const filePath = ((req.params as Record<string, string>)['*'] || 'index.html').replace(/\.\./g, '');

    // Validate the JWT token from the path parameter
    let decoded: { sub: string; workspaceId: string; type: string } | null = null;
    try {
      decoded = req.server.jwt.verify(token) as unknown as { sub: string; workspaceId: string; type: string };
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }
    if (!decoded || (decoded as { type?: string }).type !== 'device') {
      return reply.status(401).send({ error: 'Invalid token type' });
    }

    const item = await db.query.contentItems.findFirst({
      where: and(
        eq(contentItems.id, id),
        eq(contentItems.workspaceId, (decoded as { workspaceId: string }).workspaceId),
        isNull(contentItems.deletedAt),
      ),
    });
    if (!item || !item.filePath || item.type !== 'html5') {
      return reply.status(404).send({ error: 'HTML5 content not found' });
    }

    const zipPath = path.resolve(STORAGE_ROOT, item.filePath);
    if (!existsSync(zipPath)) {
      return reply.status(404).send({ error: 'Package file not found on disk' });
    }

    // Extract ZIP to temp dir keyed by content id (cached across requests)
    const extractDir = path.join(os.tmpdir(), 'nexari-html5', id);
    const indexPath = path.join(extractDir, 'index.html');
    if (!existsSync(indexPath)) {
      await fsPromises.mkdir(extractDir, { recursive: true });
      try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, /* overwrite */ true);
      } catch (err: any) {
        return reply.status(500).send({ error: 'Failed to extract HTML5 package', detail: err?.message });
      }
    }

    const servedPath = path.join(extractDir, filePath);
    if (!existsSync(servedPath)) {
      return reply.status(404).send({ error: `File not found in package: ${filePath}` });
    }

    // Determine MIME type from extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.htm':  'text/html; charset=utf-8',
      '.js':   'application/javascript',
      '.mjs':  'application/javascript',
      '.css':  'text/css',
      '.json': 'application/json',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif':  'image/gif',
      '.svg':  'image/svg+xml',
      '.webp': 'image/webp',
      '.ico':  'image/x-icon',
      '.woff': 'font/woff',
      '.woff2':'font/woff2',
      '.ttf':  'font/ttf',
      '.mp4':  'video/mp4',
      '.webm': 'video/webm',
      '.mp3':  'audio/mpeg',
      '.txt':  'text/plain',
    };
    const mime = mimeMap[ext] ?? 'application/octet-stream';
    reply.header('Content-Type', mime);
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    return reply.send(createReadStream(servedPath));
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

  // ── POST /devices/:id/remote-key ─ MDC key injection via LAN TCP ──────────
  app.post('/:id/remote-key', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { key?: string };
    const key = body.key ?? '';

    if (!MDC_ALL_COMMAND_NAMES.has(key)) {
      return reply.status(400).send({ error: `Unknown command '${key}'. Valid commands: ${[...MDC_ALL_COMMAND_NAMES].join(', ')}` });
    }

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    // Forward the command to the device via WebSocket. The player app receives
    // it and calls http://127.0.0.1:9615/remote-key on its local MDC bridge
    // Node server, which then sends the MDC binary packet to 127.0.0.1:1515.
    // This works regardless of network topology — no inbound TCP needed.
    const delivered = sendCommand(device.id, { type: 'remote_key', payload: { key } });
    if (!delivered) {
      return reply.status(503).send({ error: 'Device is offline or not connected via WebSocket' });
    }
    return reply.send({ ok: true, key });
  });

  // ── GET /devices/:id/remote-status ─ request real MDC status ack ─────────
  app.get('/:id/remote-status', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    if (!isDeviceOnline(device.id)) {
      return reply.status(503).send({ error: 'Device is offline or not connected via WebSocket' });
    }

    try {
      const status = await requestRemoteStatus(device.id, 10_000);
      return reply.send(status);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(504).send({ error: msg });
    }
  });

  // ── POST /devices/:id/mdc-control ─ raw MDC command via WS relay ──────────
  app.post('/:id/mdc-control', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { action?: string; [key: string]: unknown };
    const action = body.action ?? '';
    if (!action) return reply.status(400).send({ error: 'action is required' });

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    // ── save_mdc_id: persist to DB then prime server.js in-memory ID ─────────
    if (action === 'save_mdc_id') {
      const rawId = body.id;
      const mdcId = typeof rawId === 'number' ? rawId : parseInt(String(rawId ?? ''), 10);
      if (isNaN(mdcId) || mdcId < 0 || mdcId > 254) return reply.status(400).send({ error: 'Invalid MDC ID (0–254)' });

      await db.update(devices).set({ mdcId, updatedAt: new Date() }).where(eq(devices.id, id));

      // Prime the in-memory ID on the device (best-effort)
      try { await requestMdcControl(device.id, 'set_mdc_id', { id: mdcId }, 5_000); } catch {}
      return reply.send({ ok: true, mdcId });
    }

    // ── For all other actions: read stored mdcId and inject as displayId ─────
    const storedMdcId: number | undefined = typeof device.mdcId === 'number' ? device.mdcId : undefined;

    try {
      const { action: _a, ...rest } = body;
      // Inject stored MDC ID as displayId if caller didn't supply one
      const payload = {
        ...rest,
        ...(storedMdcId != null && rest.displayId == null ? { displayId: storedMdcId } : {}),
      };
      // Scan actions probe up to 10 IDs sequentially — give them a longer budget.
      const mdcTimeout = (action === 'mdc_id_scan' || action === 'mdc_conn_type_fix') ? 20_000 : 10_000;
      const result = await requestMdcControl(device.id, action, payload, mdcTimeout);

      // Write-back: update DB immediately so the 15s UI poll reflects the new value
      if (result.ok) {
        const dbSet: Partial<typeof devices.$inferInsert> = { updatedAt: new Date() };
        const v = typeof body.value === 'number' ? body.value : undefined;
        if (action === 'set_volume') {
          const level = typeof body.level === 'number' ? body.level : undefined;
          if (level != null) dbSet.mdcVolume = Math.max(0, Math.min(100, level));
        } else if (action === 'set_mute') {
          if (typeof body.mute === 'boolean') dbSet.mdcMute = body.mute;
        } else if (action === 'set_source') {
          const SOURCE_BYTES: Record<string, number> = {
            HDMI1: 0x21, HDMI2: 0x23, HDMI3: 0x31, HDMI4: 0x33,
            PC: 0x14, DVI: 0x18, DP: 0x25, AV: 0x08, COMPONENT: 0x0C, INTERNAL_USB: 0x62,
          };
          const byte = typeof body.source === 'string' ? SOURCE_BYTES[body.source] : undefined;
          if (byte != null) dbSet.mdcInput = byte;
        } else if (action === 'network_standby_set'  && v != null) dbSet.mdcNetworkStandby  = v;
        else if (action === 'standby_set'     && v != null) dbSet.mdcStandby         = v;
        else if (action === 'remote_control_set' && v != null) dbSet.mdcRemoteControl = v;
        else if (action === 'safety_lock_set' && v != null) dbSet.mdcSafetyLock      = v;
        else if (action === 'menu_orientation_set' && v != null) dbSet.mdcMenuOrientation = v;
        else if (action === 'src_orientation_set'  && v != null) dbSet.mdcSrcOrientation  = v;
        else if (action === 'url_launcher_address_set') {
          const addr = typeof body.urlAddress === 'string' ? body.urlAddress.trim() : undefined;
          if (addr != null) dbSet.mdcUrlLauncherAddress = addr;
        } else if ((action === 'mdc_id_scan' || action === 'mdc_conn_type_fix') && typeof (result as Record<string, unknown>).displayId === 'number') {
          dbSet.mdcId = (result as Record<string, unknown>).displayId as number;
        } else if (action === 'osd_display_set') {
          // Flip the individual bit in the stored bitmask
          const osdType  = typeof body.osdType  === 'number' ? body.osdType  : null;
          const osdOnOff = typeof body.osdOnOff === 'number' ? body.osdOnOff : null;
          if (osdType != null && osdOnOff != null) {
            const current = (await db.query.devices.findFirst({ where: eq(devices.id, id) }))?.mdcOsdStatus ?? 0;
            dbSet.mdcOsdStatus = osdOnOff ? (current | (1 << osdType)) : (current & ~(1 << osdType));
          }
        }
        if (Object.keys(dbSet).length > 1) {
          await db.update(devices).set(dbSet).where(eq(devices.id, id));
        }
      }

      // For GET actions that return data fields, decode them from the raw `data` bytes
      // if the player hasn't forwarded them as named fields (older player versions).
      const response = result as Record<string, unknown>;
      if (action === 'url_launcher_address_get' && result.ok && response.urlAddress == null && Array.isArray(result.data)) {
        const bytes = result.data as number[];
        const offset = bytes.length > 0 && bytes[0] === 0x82 ? 1 : 0;
        response.urlAddress = bytes.slice(offset).map((b) => String.fromCharCode(b)).join('');
      }

      return reply.send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(504).send({ error: msg });
    }
  });

  // ── POST /devices/:id/tizen-probe ─ request on-device Samsung/Tizen API probe ──
  app.post('/:id/tizen-probe', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    try {
      const result = await requestTizenProbe(device.id, 30_000);
      return reply.send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(504).send({ error: msg });
    }
  });

  // ── POST /devices/:id/tizen-command ─ run a write action on the TV via WebSocket ──
  app.post('/:id/tizen-command', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { action?: unknown; params?: unknown };

    if (typeof body.action !== 'string' || !body.action) {
      return reply.status(400).send({ error: 'action (string) is required' });
    }

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    try {
      const result = await requestTizenCommand(device.id, body.action, body.params, 8_000);
      return reply.send(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(504).send({ error: msg });
    }
  });

  // ── GET /devices/:id/heartbeats  (5-A) ────────────────────────────────────
  app.get('/:id/heartbeats', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const { from: fromStr, to: toStr, limit: rawLimit } = req.query as {
      from?: string; to?: string; limit?: string;
    };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const limit = Math.min(Number(rawLimit ?? 200), 500);
    const now = new Date();
    const to   = toStr   ? new Date(toStr)   : now;
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 48 * 60 * 60 * 1000);

    const rows = await db.query.deviceHeartbeats.findMany({
      where: and(
        eq(deviceHeartbeats.deviceId, id),
        gte(deviceHeartbeats.createdAt, from),
        lte(deviceHeartbeats.createdAt, to),
      ),
      orderBy: [desc(deviceHeartbeats.createdAt)],
      limit,
    });

    return reply.send({ deviceId: id, from: from.toISOString(), to: to.toISOString(), rows });
  });

  // ── GET /devices/health  (5-B) ─────────────────────────────────────────────
  // Must be registered BEFORE /:id routes so it doesn't match as an id
  app.get('/health', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, notSeenMinutes: rawMin } = req.query as {
      workspaceId?: string; notSeenMinutes?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.sub),
      ),
    });
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const notSeenMinutes = Math.max(1, Number(rawMin ?? 5));
    const cutoff = new Date(Date.now() - notSeenMinutes * 60 * 1000);

    const offlineDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.workspaceId, workspaceId),
        isNull(devices.deletedAt),
        lt(devices.lastSeen, cutoff),
      ),
      columns: { id: true, name: true, status: true, lastSeen: true, playerVersion: true },
    });

    const result = offlineDevices.filter(d => d.status !== 'unclaimed').map(d => ({
      ...d,
      status: resolveReportedDeviceStatus(d),
      lastSeenAgoMs: d.lastSeen ? Date.now() - new Date(d.lastSeen).getTime() : null,
    }));

    return reply.send({ workspaceId, notSeenMinutes, devices: result });
  });

  // ── GET /devices/:id/screenshots  (5-G — separate paginated endpoint) ─────
  app.get('/:id/screenshots', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const { limit: rawLimit, before } = req.query as { limit?: string; before?: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const limit = Math.min(Number(rawLimit ?? 20), 100);

    const rows = await db.query.deviceScreenshots.findMany({
      where: and(
        eq(deviceScreenshots.deviceId, id),
        before
          ? lt(deviceScreenshots.id, before)
          : undefined,
      ),
      orderBy: [desc(deviceScreenshots.takenAt)],
      limit,
    });

    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id ?? null : null;
    return reply.send({ screenshots: rows, nextCursor });
  });

  // ── POST /devices/:id/move  (5-E) ──────────────────────────────────────────
  app.post('/:id/move', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { targetWorkspaceId?: string };

    if (!body.targetWorkspaceId) return reply.status(400).send({ error: 'targetWorkspaceId required' });

    if (!['prime_owner', 'owner', 'admin', 'superadmin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Only owners and admins can move devices' });
    }

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const targetWs = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, body.targetWorkspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!targetWs) return reply.status(404).send({ error: 'Target workspace not found or outside your org' });

    if (device.workspaceId === body.targetWorkspaceId) {
      return reply.status(400).send({ error: 'Device is already in that workspace' });
    }

    // Clear published targets when moving
    const [updated] = await db.update(devices).set({
      workspaceId: body.targetWorkspaceId,
      publishedContentId: null,
      publishedPlaylistId: null,
      publishedScheduleId: null,
      publishedSyncGroupId: null,
      updatedAt: new Date(),
    }).where(eq(devices.id, id)).returning();

    return reply.send(updated);
  });

  // ── POST /devices/bulk-command  (5-F) ──────────────────────────────────────
  app.post('/bulk-command', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      deviceIds?: string[];
      command?: Record<string, unknown>;
    };

    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.deviceIds || body.deviceIds.length === 0) return reply.status(400).send({ error: 'deviceIds required' });
    if (!body.command) return reply.status(400).send({ error: 'command required' });

    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, body.workspaceId),
        eq(workspaceMembers.userId, user.sub),
      ),
    });
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const targetDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, body.workspaceId),
        inArray(devices.id, body.deviceIds),
        isNull(devices.deletedAt),
      ),
      columns: { id: true, status: true, lastSeen: true },
    });

    const sent: string[] = [];
    const skipped: string[] = [];

    for (const device of targetDevices) {
      const online = resolveReportedDeviceStatus(device) === 'online';
      if (online) {
        sendCommand(device.id, body.command as Parameters<typeof sendCommand>[1]);
        sent.push(device.id);
      } else {
        skipped.push(device.id);
      }
    }

    return reply.send({ sent, skipped });
  });

  // ── POST /devices/device/play-events ─ batch proof-of-play ingest ─────────
  // Authenticated with a device JWT (type === 'device').
  // Accepts up to 100 events per request; discards entries with invalid timestamps.
  app.post('/device/play-events', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const body = req.body as {
      events?: Array<{
        contentId?: string;
        playlistId?: string;
        scheduleId?: string;
        zoneId?: string;
        startedAt: string;
        endedAt: string;
        durationMs: number;
        completedFull?: boolean;
        source?: string;
      }>;
    };

    if (!Array.isArray(body?.events) || body.events.length === 0) {
      return reply.status(400).send({ error: 'events array required' });
    }

    const MAX_BATCH = 100;
    const VALID_SOURCES = new Set(['schedule', 'playlist', 'default', 'emergency']);

    const rows = body.events.slice(0, MAX_BATCH)
      .map(e => {
        const startedAt = new Date(e.startedAt);
        const endedAt   = new Date(e.endedAt);
        if (isNaN(startedAt.getTime()) || isNaN(endedAt.getTime())) return null;
        if (endedAt < startedAt) return null;
        return {
          deviceId:      auth.deviceId,
          contentId:     e.contentId  ?? null,
          playlistId:    e.playlistId ?? null,
          scheduleId:    e.scheduleId ?? null,
          zoneId:        e.zoneId     ?? null,
          startedAt,
          endedAt,
          durationMs:    Math.max(0, Math.round(Number(e.durationMs))),
          completedFull: e.completedFull ?? true,
          source:        VALID_SOURCES.has(e.source ?? '') ? (e.source as string) : 'schedule',
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      return reply.status(400).send({ error: 'No valid events in batch' });
    }

    await db.insert(playEvents).values(rows);

    void dispatchWebhookEvent(auth.orgId, 'play_event.created', {
      deviceId: auth.deviceId,
      count: rows.length,
    });

    return reply.status(201).send({ inserted: rows.length });
  });
}

