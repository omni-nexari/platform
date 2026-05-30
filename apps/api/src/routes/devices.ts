import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { db, devices, deviceScreenshots, deviceHeartbeats, workspaces, workspaceMembers, schedules, scheduleSlots, playlists, playlistItems, contentItems, syncGroups, syncGroupMembers, syncPlaylists, syncPlaylistItems, playerReleases, playEvents, deviceGroupMembers, deviceGroups, calendarConnections, deviceRules, bleScanResults, posRestaurants, canvasProjects } from '@signage/db';
import { eq, and, isNull, desc, asc, inArray, sql, ilike, gte, lte, lt } from 'drizzle-orm';
import { z } from 'zod';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';
import { ClaimDeviceSchema, UpdateDeviceSchema, DeviceCommandSchema, PairRequestSchema, buildWallGeometry, WindowsPlayerSettingsSchema } from '@signage/shared';
import type { WallMember, WallBezels } from '@signage/shared';
import { writeAuditLog } from '../services/audit.js';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { logActivity } from '../services/activity-logger.js';
import { MDC_ALL_COMMAND_NAMES } from '../services/mdc.js';
import { dispatchWebhookEvent } from '../services/webhooks.js';
import {
  sendCommand,
  broadcastToDevices,
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
  getLatestFrame,
  registerBleScanSubscriber,
  unregisterBleScanSubscriber,
  emitBleScanResult,
} from '../services/ws.js';
import { notifyDeviceStatusChange } from '../services/notifications.js';
import { ensureEpaperVariant, type EpaperFitMode } from '../services/epaper-variants.js';

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

// Per-device throttle for auto-issued `screenshot_auto` commands triggered by the
// /devices list endpoint when a device has no thumbnail yet. Prevents the 15 s
// portal poll from flooding the player with capture commands.
const autoScreenshotRequestAt = new Map<string, number>();

function hasRecentDeviceActivity(lastSeen: Date | string | null | undefined): boolean {
  if (!lastSeen) return false;
  const seenAt = lastSeen instanceof Date ? lastSeen.getTime() : new Date(lastSeen).getTime();
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt <= DEVICE_RECENT_ACTIVITY_MS;
}

function resolveReportedDeviceStatus(device: {
  id: string;
  status: string | null;
  lastSeen?: Date | string | null;
  powerState?: string | null;
  nextWakeAt?: Date | string | null;
}): string | null {
  if (isDeviceOnline(device.id) || hasRecentDeviceActivity(device.lastSeen)) {
    return 'online';
  }
  // Device pre-notified the server that it is sleeping and provided a future wake time.
  if (device.powerState === 'sleeping' && device.nextWakeAt) {
    const wakeAt = device.nextWakeAt instanceof Date ? device.nextWakeAt : new Date(String(device.nextWakeAt));
    if (!isNaN(wakeAt.getTime()) && wakeAt > new Date()) return 'sleeping';
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

// ── SBB compatibility filter ────────────────────────────────────────────────
// Tizen 4 / SSSP4 SBB players don't support channel_group (IPTV) content yet.
// Strip those items from device-bound payloads so the player never has to
// render an unsupported type.
const SBB_UNSUPPORTED_CONTENT_TYPES = new Set(['channel_group']);

function isContentSupportedByDevice(
  device: { platform?: string | null } | null | undefined,
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return true;
  if (device?.platform === 'tizen-sbb' && SBB_UNSUPPORTED_CONTENT_TYPES.has(contentType)) return false;
  return true;
}

function filterPlaylistItemsForDevice<P extends { items: Array<{ content: { type?: string | null } | null }> }>(
  device: { platform?: string | null } | null | undefined,
  playlist: P | null | undefined,
): P | null {
  if (!playlist) return playlist ?? null;
  return {
    ...playlist,
    items: playlist.items.filter((item) => !item.content || isContentSupportedByDevice(device, item.content.type)),
  };
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

// ── Canvas URL enrichment (backward-compat) ──────────────────────────────────
// Old Tizen wgt clients (api.js without the CANVAS block) set content.url to the
// /file endpoint which returns 404 for canvas items.  resolveCanvasUrl() in
// player.ts also checks metadata.canvasUrl, so we inject that field here so the
// old wgt picks up the correct HTML renderer URL without needing a redeploy.
function enrichCanvasContent<T extends { type?: string | null; id?: string | null; metadata?: unknown }>(
  content: T,
  deviceToken: string,
  apiBase: string,
): T {
  if (!content || content.type !== 'canvas' || !content.id) return content;
  try {
    const existing: Record<string, unknown> =
      typeof content.metadata === 'string'
        ? (JSON.parse((content.metadata as string) || '{}') as Record<string, unknown>)
        : content.metadata && typeof content.metadata === 'object'
        ? (content.metadata as Record<string, unknown>)
        : {};
    const canvasUrl = `${apiBase}/devices/device/content/${content.id}/canvas.html?token=${encodeURIComponent(deviceToken)}`;
    return { ...content, metadata: JSON.stringify({ ...existing, canvasUrl }) };
  } catch {
    return content;
  }
}

function enrichCanvasPlaylist<P extends {
  items: Array<{ content?: { type?: string | null; id?: string | null; metadata?: unknown } | null }>;
}>(playlist: P | null | undefined, deviceToken: string, apiBase: string): P | null {
  if (!playlist) return playlist ?? null;
  return {
    ...playlist,
    items: playlist.items.map((item) =>
      item.content
        ? { ...item, content: enrichCanvasContent(item.content, deviceToken, apiBase) }
        : item,
    ),
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
    // E-paper extras — optional. Persist only when sent so existing TV pair flow is unaffected.
    const epaperKind = body.data.kind ?? null;
    const epaperPlatform = body.data.platform ?? null;
    const epaperPanelW = body.data.panelW ?? null;
    const epaperPanelH = body.data.panelH ?? null;
    const epaperOrientation = body.data.orientation ?? null;
    const epaperApiVersion = body.data.epaperApiVersion ?? null;

    // If this DUID (or serial as fallback) already has a live device token, auto-resume without re-pairing.
    // NOTE: DUID lookup intentionally omits isNull(deletedAt) — a soft-deleted row still holds the unique
    // DUID constraint. If we only search non-deleted rows we get null and then INSERT, which hits the
    // unique constraint and returns a 500. We must find any row (deleted or not) and UPDATE it instead.
    const existingByDuid = duid
      ? await db.query.devices.findFirst({ where: eq(devices.duid, duid) })
      : null;
    const existing = existingByDuid ?? (serialNumber
      ? await db.query.devices.findFirst({ where: and(eq(devices.serialNumber, serialNumber), isNull(devices.deletedAt)) })
      : null);

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
          ...(epaperKind ? { kind: epaperKind } : {}),
          ...(epaperPlatform ? { platform: epaperPlatform } : {}),
          ...(epaperPanelW ? { panelW: epaperPanelW } : {}),
          ...(epaperPanelH ? { panelH: epaperPanelH } : {}),
          ...(epaperOrientation ? { panelOrientation: epaperOrientation } : {}),
          ...(epaperApiVersion ? { epaperApiVersion: epaperApiVersion } : {}),
        })
        .where(eq(devices.id, existing.id));

      return reply.status(200).send({
        status: 'claimed',
        deviceId: existing.id,
        deviceToken: existing.deviceToken,
      });
    }

    // NOTE: Soft-deleted devices are intentionally NOT auto-resumed here.
    // When a device has been removed from the dashboard (deletedAt set), it must
    // go through fresh pairing so the admin can choose which workspace to assign it to.

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
      // Reuse the existing device row; refresh pairing code.
      // When the device was previously soft-deleted, also reset its claimed state
      // so /pair/status returns 'pending' and the dashboard must re-claim it.
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
          deletedAt: null,
          ...(existing.deletedAt ? { orgId: null, workspaceId: null, deviceToken: null, status: 'unclaimed' } : {}),
          ...(epaperKind ? { kind: epaperKind } : {}),
          ...(epaperPlatform ? { platform: epaperPlatform } : {}),
          ...(epaperPanelW ? { panelW: epaperPanelW } : {}),
          ...(epaperPanelH ? { panelH: epaperPanelH } : {}),
          ...(epaperOrientation ? { panelOrientation: epaperOrientation } : {}),
          ...(epaperApiVersion ? { epaperApiVersion: epaperApiVersion } : {}),
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
          kind: epaperKind ?? 'tv',
          ...(epaperPlatform ? { platform: epaperPlatform } : {}),
          panelW: epaperPanelW ?? null,
          panelH: epaperPanelH ?? null,
          panelOrientation: epaperOrientation ?? null,
          epaperApiVersion: epaperApiVersion ?? null,
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

    // Which devices have at least one enabled rule?
    const deviceIds = list.map((d) => d.id);
    const enabledRuleRows = deviceIds.length > 0
      ? await db
          .select({ deviceId: deviceRules.deviceId })
          .from(deviceRules)
          .where(and(inArray(deviceRules.deviceId, deviceIds), eq(deviceRules.enabled, true)))
      : [];
    const devicesWithRules = new Set(enabledRuleRows.map((r) => r.deviceId));

    // Latest screenshot per device
    const screenshotRows = deviceIds.length > 0
      ? await db
          .select({ deviceId: deviceScreenshots.deviceId, id: deviceScreenshots.id, takenAt: deviceScreenshots.takenAt })
          .from(deviceScreenshots)
          .where(inArray(deviceScreenshots.deviceId, deviceIds))
          .orderBy(desc(deviceScreenshots.takenAt))
      : [];
    const latestScreenshotMap: Record<string, { id: string; takenAt: Date | null }> = {};
    for (const row of screenshotRows) {
      if (!latestScreenshotMap[row.deviceId]) latestScreenshotMap[row.deviceId] = { id: row.id, takenAt: row.takenAt };
    }

    // Auto-request a fresh capture for any online device that:
    //   a) has no thumbnail yet, OR
    //   b) has a stale thumbnail (takenAt older than 5 minutes)
    // Throttled per device (30 s) so the 15 s portal poll doesn't spam the player.
    const STALE_THRESHOLD_MS = 5 * 60 * 1_000;
    for (const d of list) {
      const entry = latestScreenshotMap[d.id];
      const isMissing = !entry;
      const isStale = entry && entry.takenAt && (Date.now() - entry.takenAt.getTime() > STALE_THRESHOLD_MS);
      if (!isMissing && !isStale) continue;
      if (!isDeviceOnline(d.id)) continue;
      const last = autoScreenshotRequestAt.get(d.id) ?? 0;
      if (Date.now() - last < 30_000) continue;
      autoScreenshotRequestAt.set(d.id, Date.now());
      sendCommand(d.id, { type: 'screenshot_auto' });
    }

    // Overlay live WS status
    const enriched = list.map((d) => ({
      ...d,
      assignedTags: assignedTagMap[d.id] ?? [],
      publishedTarget: publishedTargetMap[d.id] ?? null,
      status: resolveReportedDeviceStatus(d),
      latestScreenshotId: latestScreenshotMap[d.id]?.id ?? null,
      // In-memory timestamp: changes on every new screenshot even if DB row hasn't updated yet.
      // Used by the portal as a ?t= cache-buster so the browser re-fetches the image file.
      latestFrameAt: getLatestFrame(d.id)?.updatedAt?.getTime() ?? null,
      hasRules: devicesWithRules.has(d.id),
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

    const filePath = path.resolve(STORAGE_ROOT, shot.storageKey);
    try {
      await fsPromises.access(filePath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(filePath));
  });

  // ── DELETE /devices/:id/screenshots  (delete ALL) ────────────────────────
  app.delete('/:id/screenshots', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const shots = await db.query.deviceScreenshots.findMany({
      where: eq(deviceScreenshots.deviceId, id),
      columns: { id: true, storageKey: true },
    });

    await db.delete(deviceScreenshots).where(eq(deviceScreenshots.deviceId, id));
    await Promise.allSettled(
      shots.map((s) => fsPromises.unlink(path.resolve(STORAGE_ROOT, s.storageKey))),
    );

    return reply.send({ ok: true, count: shots.length });
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
    const filePath = path.resolve(STORAGE_ROOT, shot.storageKey);
    await fsPromises.unlink(filePath).catch(() => { /* best-effort */ });

    return reply.send({ ok: true });
  });

  // ── GET /devices/:id/screenshot/latest ── serve latest frame ─────────────
  // Serves only from the in-memory latestFrameStore (populated by screenshot_data WS messages).
  // If the store is empty (e.g. just after server restart) and the device is connected,
  // immediately push screenshot_auto so the next portal poll (a few seconds later) succeeds.
  app.get('/:id/screenshot/latest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    const frame = getLatestFrame(id);
    if (frame) {
      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'no-store');
      return reply.send(frame.buf);
    }

    // In-memory store empty (e.g. after a server restart) — fall back to the
    // persisted thumbnail.jpg written by the auto-screenshot pipeline.
    try {
      const thumbPath = path.resolve(STORAGE_ROOT, id, 'thumbnail.jpg');
      if (existsSync(thumbPath)) {
        const buf = await fsPromises.readFile(thumbPath);
        reply.header('Content-Type', 'image/jpeg');
        reply.header('Cache-Control', 'no-store');
        return reply.send(buf);
      }
    } catch { /* fall through to 404 */ }

    // Memory empty — kick an immediate screenshot if the device is online so the next
    // portal poll lands a real image instead of another 404.
    if (isDeviceOnline(id)) {
      sendCommand(id, { type: 'screenshot_auto' });
    }

    return reply.status(404).send({ error: 'No screenshot available yet' });
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
      if (device.kind === 'epaper') {
        // E-paper: distinct event so the renderer can react without bundling
        // TV-only side-effects (videowall clear, etc.).
        sendCommand(device.id, { type: 'epaper_playlist_changed' });
      } else {
        sendCommand(device.id, { type: 'refresh_schedule' });
        // Clear any stale videowall manifest so the device reverts to normal rendering
        sendCommand(device.id, { type: 'VIDEOWALL_CLEAR' });
      }
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

    logActivity({
      userId: user.sub,
      workspaceId: body.data.workspaceId,
      eventType: 'device_assigned',
      eventData: {
        deviceIds: body.data.deviceIds,
        resourceType: body.data.resourceType,
        resourceId: body.data.resourceId,
      },
    });

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
      sendCommand(device.id, { type: 'VIDEOWALL_CLEAR' });
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

    // When device.type changes, keep settings.posDisplayType in sync so the
    // player serves the correct URL without needing a separate pos-display PATCH.
    let settingsOverride: string | undefined;
    if (body.data.type !== undefined && body.data.type !== device.type) {
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(device.settings || '{}'); } catch { /* ignore */ }

      if (body.data.type === 'kiosk') {
        // Preserve existing kiosk orientation; default to portrait if coming from elsewhere
        const cur = settings['posDisplayType'];
        if (cur !== 'kiosk-portrait' && cur !== 'kiosk-landscape') {
          settings['posDisplayType'] = 'kiosk-portrait';
        }
      } else if (body.data.type === 'kitchen') {
        settings['posDisplayType'] = 'kitchen';
      } else if (body.data.type === 'order-pad') {
        settings['posDisplayType'] = 'order-pad';
      } else if (body.data.type === 'signage' || body.data.type === 'menu-board') {
        // unlink from any POS display slot
        delete settings['posDisplayType'];
        delete settings['posWorkspaceId'];
      }
      // 'pos' (generic POS role) keeps whatever posDisplayType/posWorkspaceId was already set
      settingsOverride = JSON.stringify(settings);
    }

    const [updated] = await db
      .update(devices)
      .set({
        ...body.data,
        ...(settingsOverride !== undefined ? { settings: settingsOverride } : {}),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── PATCH /devices/:id/pos-display ─ pair / unpair a POS display slot ─────
  app.patch('/:id/pos-display', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const bodySchema = z.object({
      posDisplayType: z.enum(['kiosk-portrait', 'kiosk-landscape', 'kitchen', 'order-pad']).nullable(),
      posWorkspaceId: z.string().uuid().nullable().optional(),
    });
    const body = bodySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(device.settings || '{}'); } catch { /* ignore */ }

    // Map posDisplayType → device.type so filters in the dashboard work correctly
    const posTypeToDeviceType: Record<string, string> = {
      'kiosk-portrait': 'kiosk',
      'kiosk-landscape': 'kiosk',
      'kitchen': 'kitchen',
      'order-pad': 'order-pad',
    };

    let newDeviceType: string;
    if (body.data.posDisplayType === null) {
      delete settings['posDisplayType'];
      delete settings['posWorkspaceId'];
      // Keep the device's existing type so it stays visible in the POS deploy picker.
      // Reverting to 'signage' would hide it and prevent re-pairing.
      newDeviceType = device.type;
    } else {
      settings['posDisplayType'] = body.data.posDisplayType;
      settings['posWorkspaceId'] = body.data.posWorkspaceId ?? '';
      newDeviceType = posTypeToDeviceType[body.data.posDisplayType] ?? 'signage';
    }

    const [updated] = await db
      .update(devices)
      .set({ settings: JSON.stringify(settings), type: newDeviceType, updatedAt: new Date() })
      .where(eq(devices.id, id))
      .returning();

    // Auto-generate the kiosk/kitchen display token for the workspace if it
    // doesn't already exist. This ensures the schedule endpoint can build a
    // kiosk URL immediately without requiring a separate manual step.
    const assignedDisplayType = body.data.posDisplayType;
    const assignedWorkspaceId = body.data.posWorkspaceId;
    if (assignedDisplayType && assignedWorkspaceId && assignedDisplayType !== 'order-pad') {
      const tokenKey = assignedDisplayType === 'kitchen' ? 'kitchen' : 'kiosk';
      try {
        const restaurant = await db.query.posRestaurants.findFirst({
          where: eq(posRestaurants.workspaceId, assignedWorkspaceId),
          columns: { id: true, settings: true },
        });
        const rSettings = (restaurant?.settings != null && typeof restaurant.settings === 'object' && !Array.isArray(restaurant.settings))
          ? restaurant.settings as Record<string, unknown>
          : {};
        const rTokens = (rSettings['displayTokens'] != null && typeof rSettings['displayTokens'] === 'object' && !Array.isArray(rSettings['displayTokens']))
          ? rSettings['displayTokens'] as Record<string, unknown>
          : {};
        if (typeof rTokens[tokenKey] !== 'string') {
          const displayToken = app.jwt.sign(
            { sub: assignedWorkspaceId, type: 'display', displayType: tokenKey, orgId: user.orgId, workspaceId: assignedWorkspaceId },
            { expiresIn: '87600h' },
          );
          const newRSettings = { ...rSettings, displayTokens: { ...rTokens, [tokenKey]: displayToken } };
          if (restaurant) {
            await db.update(posRestaurants)
              .set({ settings: newRSettings, updatedAt: new Date() })
              .where(eq(posRestaurants.id, restaurant.id));
          } else {
            await db.insert(posRestaurants)
              .values({ orgId: user.orgId, workspaceId: assignedWorkspaceId, name: '', settings: newRSettings });
          }
        }
      } catch {
        // Non-fatal: token generation failure is not a reason to block pairing.
        // The schedule endpoint will still produce a URL without a token as fallback.
      }
    }

    // Immediately push refresh_schedule so the player loads the POS URL
    // without waiting for its 60-second poll cycle.
    sendCommand(id, { type: 'refresh_schedule' });

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

    // Notify the device (if currently connected) so it clears its token and
    // shows the pairing screen immediately without waiting for the next API poll.
    sendCommand(id, { type: 'DEVICE_DELETED' });

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

  // ── POST /devices/:id/wake ─ Wake-on-LAN via a peer relay device ───────────
  // Picks an online device in the same workspace + same /24 subnet and tells it
  // to broadcast a WoL magic packet for the target's MAC address. Works across
  // Tizen / Windows / e-paper players (they all implement the `wake_on_lan`
  // command using Node `dgram` UDP broadcast to 255.255.255.255:9).
  app.post('/:id/wake', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const target = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!target) return reply.status(404).send({ error: 'Not found' });
    if (!target.macAddress) {
      return reply.status(400).send({ error: 'Target device has no recorded MAC address' });
    }

    // Find peers in the same workspace that are currently online (WS connected).
    const candidates = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        eq(devices.workspaceId, target.workspaceId!),
        isNull(devices.deletedAt),
      ),
      columns: { id: true, ipAddress: true, lastSeen: true, platform: true, kind: true },
    });

    // Prefer peers in the same /24 subnet, then any online peer.
    const targetIp = target.ipAddress ?? null;
    const subnet24 = (ip: string | null | undefined) => (ip ? ip.split('.').slice(0, 3).join('.') : null);
    const targetSubnet = subnet24(targetIp);

    const onlineCandidates = candidates
      .filter((c) => c.id !== target.id && isDeviceOnline(c.id))
      .sort((a, b) => {
        const aSub = subnet24(a.ipAddress) === targetSubnet ? 1 : 0;
        const bSub = subnet24(b.ipAddress) === targetSubnet ? 1 : 0;
        if (aSub !== bSub) return bSub - aSub;
        const aSeen = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const bSeen = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return bSeen - aSeen;
      });

    const relay = onlineCandidates[0];
    if (!relay) {
      return reply.status(409).send({
        error: 'No online peer device available to broadcast Wake-on-LAN',
        hint: 'At least one Tizen / Windows / e-paper player on the same LAN must be online.',
      });
    }

    sendCommand(relay.id, {
      type: 'wake_on_lan',
      payload: { targetMac: target.macAddress },
    });

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'DEVICE_COMMAND_SENT',
      entityType: 'device',
      entityId: target.id,
      meta: { command: 'wake_on_lan', viaRelayDeviceId: relay.id },
      ipAddress: req.ip,
    });

    return reply.send({ sent: true, viaRelayDeviceId: relay.id, targetMac: target.macAddress });
  });
  // Helper: load + auth-check an e-paper device. Returns null and writes an
  // error response if the caller is not allowed or the device is not e-paper.
  async function loadEpaperDevice(reqAny: { params: unknown; user: unknown }, replyAny: { status: (n: number) => { send: (b: unknown) => unknown } }): Promise<{ id: string; orgId: string | null; kind: string; epaperSettings: unknown } | null> {
    const user = reqAny.user as AuthUser;
    const { id } = reqAny.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) { replyAny.status(404).send({ error: 'Not found' }); return null; }
    if (device.kind !== 'epaper') { replyAny.status(400).send({ error: 'Device is not an e-paper panel' }); return null; }
    return device as never;
  }

  // ── POST /devices/:id/epaper/wake ─ wake panel out of sleep ─────────────
  app.post('/:id/epaper/wake', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const device = await loadEpaperDevice(req as never, reply as never);
    if (!device) return;
    const sent = sendCommand(device.id, { type: 'epaper_wake_now' });
    await writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'DEVICE_COMMAND_SENT',
      entityType: 'device', entityId: device.id, meta: { command: 'epaper_wake_now', sent },
      ipAddress: req.ip,
    });
    return reply.send({ sent });
  });

  // ── POST /devices/:id/epaper/refresh-now ─ force full panel defrag ─────
  app.post('/:id/epaper/refresh-now', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const device = await loadEpaperDevice(req as never, reply as never);
    if (!device) return;
    const sent = sendCommand(device.id, { type: 'epaper_refresh_now' });
    await writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'DEVICE_COMMAND_SENT',
      entityType: 'device', entityId: device.id, meta: { command: 'epaper_refresh_now', sent },
      ipAddress: req.ip,
    });
    return reply.send({ sent });
  });

  // ── POST /devices/:id/epaper/sleep ─ force the panel to sleep now ───────
  app.post('/:id/epaper/sleep', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const device = await loadEpaperDevice(req as never, reply as never);
    if (!device) return;
    const sent = sendCommand(device.id, { type: 'epaper_force_sleep' });
    await writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'DEVICE_COMMAND_SENT',
      entityType: 'device', entityId: device.id, meta: { command: 'epaper_force_sleep', sent },
      ipAddress: req.ip,
    });
    return reply.send({ sent });
  });

  // ── PATCH /devices/:id/epaper/settings ─ update + push e-paper policy ──
  // Body: same shape as the epaper_settings_changed payload. Persisted to
  // devices.epaper_settings (jsonb) and pushed via WS if device is online.
  const EpaperSettingsSchema = z.object({
    networkStandby: z.enum(['ON', 'OFF']).optional(),
    autoSleep: z.string().optional(),
    screenRefreshTime: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).nullable().optional(),
    ledMode: z.enum(['ON', 'OFF', 'AUTO']).optional(),
    batteryWarningIcon: z.boolean().optional(),
    minSwapRateSec: z.number().int().min(15).max(3600).optional(),
  });
  app.patch('/:id/epaper/settings', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const device = await loadEpaperDevice(req as never, reply as never);
    if (!device) return;
    const parsed = EpaperSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const merged = Object.assign({}, (device.epaperSettings as Record<string, unknown> | null) ?? {}, parsed.data);
    await db.update(devices).set({ epaperSettings: merged, updatedAt: new Date() }).where(eq(devices.id, device.id));

    // Strip undefineds for the WS push (exactOptionalPropertyTypes).
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) payload[k] = v;
    }
    const sent = sendCommand(device.id, { type: 'epaper_settings_changed', payload: payload as never });
    await writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'DEVICE_SETTINGS_UPDATED',
      entityType: 'device', entityId: device.id, meta: { kind: 'epaper', sent, fields: Object.keys(parsed.data) },
      ipAddress: req.ip,
    });
    return reply.send({ ok: true, sent, settings: merged });
  });

  // ── PATCH /devices/:id/windows-settings ─ Windows player config push ──────
  // Body: WindowsPlayerSettings (partial). Merged onto existing JSON column
  // and pushed to the device via WS.
  app.patch('/:id/windows-settings', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, params.id), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (device.orgId !== user.orgId) return reply.status(403).send({ error: 'Forbidden' });

    const parsed = WindowsPlayerSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const merged = Object.assign({}, (device.windowsSettings as Record<string, unknown> | null) ?? {}, parsed.data);
    await db.update(devices).set({ windowsSettings: merged, updatedAt: new Date() }).where(eq(devices.id, device.id));

    const sent = sendCommand(device.id, { type: 'set_windows_settings', payload: { settings: merged } });
    await writeAuditLog({
      orgId: user.orgId, actorId: user.sub, action: 'DEVICE_SETTINGS_UPDATED',
      entityType: 'device', entityId: device.id, meta: { kind: 'windows', sent, fields: Object.keys(parsed.data) },
      ipAddress: req.ip,
    });
    return reply.send({ ok: true, sent, settings: merged });
  });

  // ── GET /devices/device/epaper/policy ─ device-auth, returns merged policy ─
  // The e-paper client calls this on boot (and after epaper_settings_changed).
  // Returns the device-specific epaper_settings merged onto sensible defaults.
  app.get('/device/epaper/policy', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (device.kind !== 'epaper') return reply.status(400).send({ error: 'Not an e-paper device' });

    // Push-first defaults — match defaultConfig in apps/nexari-epaper/js/config.js
    const defaults = {
      networkStandby: 'ON',
      autoSleep: 'NEVER',
      screenRefreshTime: { hour: 2, minute: 0 },
      ledMode: 'AUTO',
      batteryWarningIcon: true,
      minSwapRateSec: 15,
    };
    const settings = Object.assign({}, defaults, (device.epaperSettings as Record<string, unknown> | null) ?? {});
    return reply.send({
      panelW: device.panelW,
      panelH: device.panelH,
      orientation: device.panelOrientation,
      settings,
    });
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

    // Always run periodic screenshots. Use the user-configured interval, or fall back to
    // 10 minutes so device-card thumbnails stay fresh even when the user sets "never".
    const DEFAULT_SCREENSHOT_INTERVAL_MIN = 10;
    const intervalMin = (device.screenshotIntervalMin && device.screenshotIntervalMin > 0)
      ? device.screenshotIntervalMin
      : DEFAULT_SCREENSHOT_INTERVAL_MIN;
    setTimeout(async () => {
      sendCommand(deviceId, { type: 'set_screenshot_interval', payload: { minutes: intervalMin } });
      // If we applied the default (DB was null/0), persist it so the portal card shows the real value.
      if (!(device.screenshotIntervalMin && device.screenshotIntervalMin > 0)) {
        try {
          await db.update(devices)
            .set({ screenshotIntervalMin: DEFAULT_SCREENSHOT_INTERVAL_MIN })
            .where(eq(devices.id, deviceId));
        } catch (_) {}
      }
    }, 5_000);

    // Request one screenshot ~3 s after connect to populate the device-card thumbnail
    // immediately after registration or server restarts.
    setTimeout(() => {
      sendCommand(deviceId, { type: 'screenshot_auto' });
    }, 3_000);

    // Push persisted Windows settings (if any) so the device's local store is
    // in sync with the portal after restart / reinstall.
    if (device.windowsSettings && typeof device.windowsSettings === 'object') {
      setTimeout(() => {
        sendCommand(deviceId, {
          type: 'set_windows_settings',
          payload: { settings: device.windowsSettings as Record<string, unknown> },
        });
      }, 4_000);
    }

    // Re-push VIDEOWALL_INIT for any videowall group this device belongs to.
    // Without this, a device that reconnects after a reinstall plays full-screen
    // and never enters sync mode because it has no wall manifest.
    setTimeout(async () => {
      try {
        const memberships = await db.query.deviceGroupMembers.findMany({
          where: eq(deviceGroupMembers.deviceId, deviceId),
        });
        for (const membership of memberships) {
          const group = await db.query.deviceGroups.findFirst({
            where: and(eq(deviceGroups.id, membership.groupId), isNull(deviceGroups.deletedAt)),
          });
          if (!group || group.type !== 'videowall' || !group.videoWallCols || !group.videoWallRows) continue;

          const allMembers = await db.query.deviceGroupMembers.findMany({
            where: eq(deviceGroupMembers.groupId, group.id),
          });
          const memberDeviceIds = allMembers.map((m) => m.deviceId);
          const memberDeviceRows = await db.query.devices.findMany({
            where: and(inArray(devices.id, memberDeviceIds), isNull(devices.deletedAt)),
          });
          const deviceMap = Object.fromEntries(memberDeviceRows.map((d) => [d.id, d]));

          const wallMembers: WallMember[] = allMembers
            .filter((m) => m.positionCol != null && m.positionRow != null)
            .map((m) => ({
              positionCol: m.positionCol!,
              positionRow: m.positionRow!,
              colSpan: m.colSpan,
              rowSpan: m.rowSpan,
              nativeWidthPx: m.nativeWidthPx,
              nativeHeightPx: m.nativeHeightPx,
              tileRotation: m.tileRotation,
            }));

          const bezels: WallBezels | null =
            (group.bezelTopMm != null || group.bezelRightMm != null || group.bezelBottomMm != null || group.bezelLeftMm != null)
              ? { topMm: Number(group.bezelTopMm ?? 0), rightMm: Number(group.bezelRightMm ?? 0), bottomMm: Number(group.bezelBottomMm ?? 0), leftMm: Number(group.bezelLeftMm ?? 0) }
              : null;

          const geometry = buildWallGeometry(wallMembers, group.videoWallCols, group.videoWallRows, bezels);
          const sortedMembers = [...allMembers]
            .filter((m) => m.positionCol != null && m.positionRow != null)
            .sort((a, b) => {
              const aPinned = (group as any).pinnedLeaderId === a.deviceId ? 0 : 1;
              const bPinned = (group as any).pinnedLeaderId === b.deviceId ? 0 : 1;
              if (aPinned !== bPinned) return aPinned - bPinned;
              const platPri = (id: string) => {
                const p = (deviceMap[id] as any)?.platform ?? '';
                return ({ tizen: 0, 'tizen-sbb': 1, windows: 2, android: 3, browser: 4 } as Record<string, number>)[p] ?? 99;
              };
              const ap = platPri(a.deviceId), bp = platPri(b.deviceId);
              if (ap !== bp) return ap - bp;
              return (a.positionRow! - b.positionRow!) || (a.positionCol! - b.positionCol!);
            });
          const leaderPriority = sortedMembers.map((m) => m.deviceId);
          const peers = sortedMembers.map((m) => ({
            deviceId: m.deviceId,
            lastKnownIp: (deviceMap[m.deviceId] as any)?.ipAddress ?? null,
            port: 9615,
            platform: (deviceMap[m.deviceId] as any)?.platform ?? 'tizen',
          }));
          const allTizen = peers.every((p) => p.platform === 'tizen' || p.platform === 'tizen-sbb');
          const leaderDev = deviceMap[sortedMembers[0]?.deviceId ?? ''] as any;
          const relayMode = (group as any).syncRelayMode ?? 'lan';
          const relayUrl = relayMode === 'lan' && leaderDev?.ipAddress && ['tizen','tizen-sbb','windows','android'].includes(leaderDev.platform ?? '')
            ? `ws://${leaderDev.ipAddress}:9616` : null;

          const myMember = allMembers.find((m) => m.deviceId === deviceId);
          if (!myMember || myMember.positionCol == null || myMember.positionRow == null) continue;

          sendCommand(deviceId, {
            type: 'VIDEOWALL_INIT',
            mode: 'videowall',
            deviceGroupId: group.id,
            geometry,
            leaderPriority,
            peers,
            allTizen,
            relayUrl,
            syncRelayMode: relayMode,
            myCell: {
              deviceId,
              positionCol: myMember.positionCol,
              positionRow: myMember.positionRow,
              colSpan: myMember.colSpan ?? 1,
              rowSpan: myMember.rowSpan ?? 1,
              tileRotation: myMember.tileRotation ?? '0',
              nativeWidthPx: myMember.nativeWidthPx ?? null,
              nativeHeightPx: myMember.nativeHeightPx ?? null,
            },
          });
          app.log.info({ deviceId, groupId: group.id }, 'VIDEOWALL_INIT re-pushed on device reconnect');
        }
      } catch (e) {
        app.log.warn({ deviceId, err: e }, 'Failed to re-push VIDEOWALL_INIT on reconnect');
      }
    }, 4_000);

    // Push rule sets so the device starts evaluation immediately on connect/reconnect.
    setTimeout(async () => {
      try {
        const { publishRuleSetsToDevice } = await import('../services/rule-sets.js');
        await publishRuleSetsToDevice(deviceId);
        app.log.info({ deviceId }, 'Rule sets pushed on device connect');
      } catch (e) {
        app.log.warn({ deviceId, err: e }, 'Failed to push rule sets on device connect');
      }
    }, 3_000);

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
      try {
        const broker = await import('../services/calendar-broker.js');
        broker.unsubscribeDevice(deviceId);
      } catch { /* broker import failed — ignore */ }
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

  // ── POST /devices/group-sync-play ─ relay synchronized start cue to all wall panels ─
  // Called by the leader panel after it decides the syncedStartMs start time.
  // Broadcasts VIDEOWALL_SYNC_PLAY to every member of the group via their WS
  // connection so Tizen 4 followers (whose local bridge XHR may be blocked)
  // still receive the cue over their guaranteed WS connection.
  app.post('/group-sync-play', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const body = req.body as { groupId?: string; syncedStartMs?: number };
    if (!body?.groupId || typeof body.syncedStartMs !== 'number' || !Number.isFinite(body.syncedStartMs)) {
      return reply.status(400).send({ error: 'groupId (string) and syncedStartMs (number) required' });
    }

    // Verify the calling device is actually a member of this group.
    const membership = await db.query.deviceGroupMembers.findFirst({
      where: and(
        eq(deviceGroupMembers.deviceId, auth.deviceId),
        eq(deviceGroupMembers.groupId, body.groupId),
      ),
    });
    if (!membership) return reply.status(403).send({ error: 'Device is not a member of this group' });

    // Broadcast to all members.
    const allMembers = await db.query.deviceGroupMembers.findMany({
      where: eq(deviceGroupMembers.groupId, body.groupId),
    });
    const deviceIds = allMembers.map((m) => m.deviceId);
    broadcastToDevices(deviceIds, {
      type: 'VIDEOWALL_SYNC_PLAY',
      payload: { syncedStartMs: body.syncedStartMs },
    } as any);

    return reply.send({ ok: true, broadcast: deviceIds.length });
  });

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

  // ── POST /devices/device/ble-scan-result ─ device self-reports BLE scan ─────
  app.post('/device/ble-scan-result', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const body = req.body as { beacons?: unknown[] };
    const beacons = Array.isArray(body?.beacons) ? body.beacons : [];
    const scannedAt = new Date();
    await db.insert(bleScanResults).values({ deviceId: auth.deviceId, beacons: beacons as never, scannedAt });
    emitBleScanResult(auth.deviceId, beacons, scannedAt);
    return reply.send({ ok: true });
  });

  // ── GET /:id/ble-scan/stream ─ SSE push of live BLE scan results ───────────
  app.get('/:id/ble-scan/stream', { config: { rateLimit: false }, onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(':\n\n');

    const push = (data: { beacons: unknown[]; scannedAt: string }) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    registerBleScanSubscriber(id, push);

    const heartbeat = setInterval(() => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(':\n\n');
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unregisterBleScanSubscriber(id, push);
    });

    await new Promise<void>((resolve) => { req.raw.on('close', resolve); });
  });

  // ── GET /devices/device/schedule ─ full schedule + content manifest ─────────
  app.get('/device/schedule', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { workspaceId } = auth;

    const [device, workspaceSchedules] = await Promise.all([
      db.query.devices.findFirst({
        where: eq(devices.id, auth.deviceId),
      }),
      loadWorkspaceSchedules(workspaceId),
    ]);

    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (device.deletedAt) return reply.status(401).send({ error: 'Device has been removed' });

    const [publishedContentRaw, publishedPlaylistRaw, publishedSchedule] = await Promise.all([
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

    // SBB compatibility: drop unsupported content types
    const publishedContent = publishedContentRaw && isContentSupportedByDevice(device, publishedContentRaw.type)
      ? publishedContentRaw
      : null;
    const publishedPlaylist = filterPlaylistItemsForDevice(device, publishedPlaylistRaw);
    if (publishedSchedule) {
      publishedSchedule.slots = publishedSchedule.slots
        .filter((slot) => !slot.content || isContentSupportedByDevice(device, slot.content.type))
        .map((slot) => slot.playlist
          ? { ...slot, playlist: filterPlaylistItemsForDevice(device, slot.playlist) }
          : slot);
    }

    // Extract device token for canvas URL enrichment so old wgt clients receive
    // metadata.canvasUrl and resolveCanvasUrl() can find the HTML renderer.
    const _dTok = (req.headers.authorization as string | undefined)?.startsWith('Bearer ')
      ? (req.headers.authorization as string).slice(7)
      : (req.query as Record<string, string | undefined>).token ?? '';
    const _apiBase = `${req.protocol}://${req.hostname}/api/v1`;

    // Enrich canvas items in schedule slots before building legacy schedule
    if (publishedSchedule) {
      publishedSchedule.slots = publishedSchedule.slots.map((slot) => ({
        ...slot,
        content: slot.content ? enrichCanvasContent(slot.content, _dTok, _apiBase) : slot.content,
        playlist: slot.playlist ? enrichCanvasPlaylist(slot.playlist, _dTok, _apiBase) : slot.playlist,
      }));
    }

    const legacyPublishedSchedule = buildLegacyPublishedSchedule({
      content: publishedContent ? enrichCanvasContent(publishedContent, _dTok, _apiBase) : null,
      playlist: enrichCanvasPlaylist(publishedPlaylist, _dTok, _apiBase),
      schedule: publishedSchedule,
    });

    // ── POS display injection for legacy schedule endpoint ───────────────────
    // Android / player-web only reads this endpoint, not publishedContent from
    // the workspace endpoint. Inject a synthetic web_url schedule so POS devices
    // don't idle when nothing else is published.
    let posSchedule: typeof legacyPublishedSchedule | null = null;
    if (!legacyPublishedSchedule) {
      try {
        const deviceSettings = JSON.parse(device.settings ?? '{}') as Record<string, unknown>;
        const posDisplayType = typeof deviceSettings['posDisplayType'] === 'string' ? deviceSettings['posDisplayType'] : null;
        const posWorkspaceId = typeof deviceSettings['posWorkspaceId'] === 'string' ? deviceSettings['posWorkspaceId'] : null;
        if (posDisplayType && posWorkspaceId) {
          const appUrl = `${req.protocol}://${req.hostname}`;
          let posUrl: string | null = null;
          if (posDisplayType === 'order-pad') {
            posUrl = `${appUrl}/workspaces/${posWorkspaceId}/pos`;
          } else if (posDisplayType === 'kiosk-portrait' || posDisplayType === 'kiosk-landscape' || posDisplayType === 'kitchen') {
            const restaurant = await db.query.posRestaurants.findFirst({
              where: eq(posRestaurants.workspaceId, posWorkspaceId),
              columns: { settings: true },
            });
            const dtObj = restaurant?.settings != null && typeof restaurant.settings === 'object' && !Array.isArray(restaurant.settings)
              ? (restaurant.settings as Record<string, unknown>)['displayTokens']
              : null;
            const tokens = dtObj != null && typeof dtObj === 'object' && !Array.isArray(dtObj)
              ? dtObj as Record<string, unknown>
              : {};
            const tokenKey = posDisplayType === 'kitchen' ? 'kitchen' : 'kiosk';
            const dt = typeof tokens[tokenKey] === 'string' ? tokens[tokenKey] : null;
            // Build URL with token when available; fall back to tokenless URL so the
            // player still loads the page even if the token hasn't been generated yet.
            if (posDisplayType === 'kiosk-portrait') {
              posUrl = dt
                ? `${appUrl}/kiosk/${posWorkspaceId}/portrait?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kiosk/${posWorkspaceId}/portrait`;
            } else if (posDisplayType === 'kiosk-landscape') {
              posUrl = dt
                ? `${appUrl}/kiosk/${posWorkspaceId}/landscape?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kiosk/${posWorkspaceId}/landscape`;
            } else {
              posUrl = dt
                ? `${appUrl}/kitchen/${posWorkspaceId}?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kitchen/${posWorkspaceId}`;
            }
          }
          if (posUrl) {
            const contentId = `pos-content-${device.id}`;
            posSchedule = {
              id: `pos-schedule-${device.id}`,
              workspaceId: posWorkspaceId,
              createdBy: null,
              name: 'POS Display',
              description: 'POS display injection',
              type: 'override',
              isActive: true,
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              slots: [
                {
                  id: `pos-slot-${device.id}`,
                  scheduleId: `pos-schedule-${device.id}`,
                  playlistId: null,
                  contentId,
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
                  content: {
                    id: contentId,
                    workspaceId: posWorkspaceId,
                    orgId: device.orgId,
                    name: 'POS Display',
                    type: 'html',
                    url: posUrl,
                    webUrl: posUrl,
                    filePath: null,
                    mimeType: 'text/html',
                    fileSize: null,
                    uploadedBy: null,
                    metadata: '{}',
                    tags: null,
                    originalName: null,
                    thumbnailPath: null,
                    transcodedPath: null,
                    androidFilePath: null,
                    deletedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  } as unknown as NonNullable<typeof publishedContent>,
                },
              ],
            } as unknown as typeof legacyPublishedSchedule;
          }
        }
      } catch {
        // If settings parsing fails, fall through to normal (possibly idle) behaviour
      }
    }

    const filteredWorkspaceSchedules = workspaceSchedules.map((sch) => ({
      ...sch,
      slots: sch.slots
        .filter((slot) => !slot.content || isContentSupportedByDevice(device, slot.content.type))
        .map((slot) => {
          const s = slot.playlist
            ? { ...slot, playlist: filterPlaylistItemsForDevice(device, slot.playlist) }
            : slot;
          return {
            ...s,
            content: s.content ? enrichCanvasContent(s.content, _dTok, _apiBase) : s.content,
            playlist: s.playlist ? enrichCanvasPlaylist(s.playlist, _dTok, _apiBase) : s.playlist,
          };
        }),
    }));

    const firstSchedule = legacyPublishedSchedule ?? posSchedule;
    return reply.send({
      schedules: firstSchedule
        ? [firstSchedule, ...filteredWorkspaceSchedules]
        : filteredWorkspaceSchedules,
    });
  });

  // ── GET /devices/device/signage-image ─ serve published image resized 240×536 ─
  // ESP32 AMOLED display is 240×536 portrait. Returns a JPEG resized to fit
  // with letterboxing so the player can display it via pushColors().
  app.get('/device/signage-image', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const device = await db.query.devices.findFirst({
      where: eq(devices.id, auth.deviceId),
    });
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (device.deletedAt) return reply.status(401).send({ error: 'Device has been removed' });
    if (!device.publishedContentId) return reply.status(404).send({ error: 'No content published' });

    const content = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, device.publishedContentId), isNull(contentItems.deletedAt)),
    });
    if (!content || content.type !== 'image' || !content.filePath) {
      return reply.status(404).send({ error: 'No image content available' });
    }

    const absPath = path.resolve(STORAGE_ROOT, content.filePath);
    try { await fsPromises.access(absPath); } catch {
      return reply.status(404).send({ error: 'Image file not found on disk' });
    }

    const { default: sharp } = await import('sharp');
    // Rotate landscape images 90° so they fill the 240×536 portrait display.
    // fit:'cover' crops/scales to fill the full screen with no letterboxing.
    const meta = await sharp(absPath).metadata();
    const isLandscape = (meta.width ?? 1) > (meta.height ?? 1);
    const jpeg = await sharp(absPath)
      .rotate(isLandscape ? 90 : 0)
      .resize(240, 536, { fit: 'cover', background: { r: 15, g: 23, b: 42 } })
      .jpeg({ quality: 80 })
      .toBuffer();

    reply.header('Content-Type', 'image/jpeg');
    reply.header('Content-Length', jpeg.length);
    reply.header('Cache-Control', 'no-cache');
    return reply.send(jpeg);
  });
  // ── GET /devices/device/workspace ─ workspace info inc. defaults ──────────
  app.get('/device/workspace', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const device = await db.query.devices.findFirst({
      where: eq(devices.id, auth.deviceId),
    });
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (device.deletedAt) return reply.status(401).send({ error: 'Device has been removed' });

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
    defaultPlaylist = filterPlaylistItemsForDevice(device, defaultPlaylist);

    const [publishedContentRaw, publishedPlaylistRaw, publishedSchedule] = await Promise.all([
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

    // SBB compatibility: drop unsupported content types
    const publishedContent = publishedContentRaw && isContentSupportedByDevice(device, publishedContentRaw.type)
      ? publishedContentRaw
      : null;
    const publishedPlaylist = filterPlaylistItemsForDevice(device, publishedPlaylistRaw);
    if (publishedSchedule) {
      publishedSchedule.slots = publishedSchedule.slots
        .filter((slot) => !slot.content || isContentSupportedByDevice(device, slot.content.type))
        .map((slot) => slot.playlist
          ? { ...slot, playlist: filterPlaylistItemsForDevice(device, slot.playlist) }
          : slot);
    }

    // Resolve sync group + its sync playlist when publishedSyncGroupId is set
    let publishedSyncGroup: {
      id: string; groupId: number; mode: string; allTizen: boolean; relayUrl: string | null; syncRelayMode: string;
      peers: Array<{ deviceId: string; ipAddress: string | null; leaderPriority: number; platform: string | null }>;
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
          // Fetch all members of this sync group with their device IPs for peer coordination
          const memberRows = await db
            .select({ deviceId: syncGroupMembers.deviceId, leaderPriority: syncGroupMembers.leaderPriority, ipAddress: devices.ipAddress, platform: devices.platform })
            .from(syncGroupMembers)
            .leftJoin(devices, eq(devices.id, syncGroupMembers.deviceId))
            .where(eq(syncGroupMembers.syncGroupId, sg.id));
          const peers = memberRows.map((m) => ({ deviceId: m.deviceId, ipAddress: m.ipAddress ?? null, leaderPriority: m.leaderPriority, platform: m.platform ?? null }));
          // Sort by leaderPriority (ascending) so peers[0] is always the elected leader
          peers.sort((a, b) => (a.leaderPriority ?? 999) - (b.leaderPriority ?? 999));
          const allTizen = peers.length > 0 && peers.every((p) => p.platform === 'tizen' || p.platform === 'tizen-sbb');
          const appUrl = (process.env['APP_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
          const sgRelayMode: string = (sg as any).syncRelayMode ?? 'cloud';
          // LAN mode: route through leader's built-in relay (ws://leaderIp:9616).
          // Cloud mode (or fallback when leader has no IP): use centralised API relay.
          const leaderPeer = peers[0]; // already sorted by leaderPriority asc
          const relayUrl = allTizen
            ? null
            : sgRelayMode === 'lan' && leaderPeer?.ipAddress
              ? `ws://${leaderPeer.ipAddress}:9616`
              : appUrl.replace(/^http/, 'ws') + '/api/v1/sync-relay/ws';

          publishedSyncGroup = {
            id: sg.id,
            groupId: sg.groupId,
            mode: sg.mode,
            allTizen,
            relayUrl,
            syncRelayMode: sgRelayMode,
            peers,
            syncPlaylist: {
              id: sp.id,
              name: sp.name,
              items: spItems
                .map((item) => ({
                  id: item.id,
                  contentId: item.contentId,
                  durationSeconds: item.durationSeconds,
                  sortOrder: item.sortOrder,
                  content: item.contentId ? (spContentMap[item.contentId] ?? null) : null,
                }))
                .filter((item) => !item.content || isContentSupportedByDevice(device, item.content.type)),
            },
          };
        }
      }
    }

    // ── POS display injection ────────────────────────────────────────────────
    // If this device is paired as a POS display (posDisplayType in settings) and
    // has no explicitly published content/playlist/schedule, synthesise a virtual
    // content item so the player renders the correct POS URL instead of idle.
    let effectivePublishedContent = publishedContent;
    if (!publishedContent && !publishedPlaylist && !publishedSchedule && !publishedSyncGroup) {
      try {
        const deviceSettings = JSON.parse(device.settings ?? '{}') as Record<string, unknown>;
        const posDisplayType = typeof deviceSettings['posDisplayType'] === 'string' ? deviceSettings['posDisplayType'] : null;
        const posWorkspaceId = typeof deviceSettings['posWorkspaceId'] === 'string' ? deviceSettings['posWorkspaceId'] : null;
        if (posDisplayType && posWorkspaceId) {
          const appUrl = `${req.protocol}://${req.hostname}`;
          let posUrl: string | null = null;

          if (posDisplayType === 'order-pad') {
            posUrl = `${appUrl}/workspaces/${posWorkspaceId}/pos`;
          } else if (posDisplayType === 'kiosk-portrait' || posDisplayType === 'kiosk-landscape' || posDisplayType === 'kitchen') {
            // Kiosk / kitchen displays need a display token — fetch from restaurant settings
            const restaurant = await db.query.posRestaurants.findFirst({
              where: eq(posRestaurants.workspaceId, posWorkspaceId),
              columns: { settings: true },
            });
            const dtObj = restaurant?.settings != null && typeof restaurant.settings === 'object' && !Array.isArray(restaurant.settings)
              ? (restaurant.settings as Record<string, unknown>)['displayTokens']
              : null;
            const tokens = dtObj != null && typeof dtObj === 'object' && !Array.isArray(dtObj)
              ? dtObj as Record<string, unknown>
              : {};
            const tokenKey = posDisplayType === 'kitchen' ? 'kitchen' : 'kiosk';
            const dt = typeof tokens[tokenKey] === 'string' ? tokens[tokenKey] : null;
            // Build URL with token when available; fall back to tokenless URL so the
            // player still loads the page even if the token hasn't been generated yet.
            if (posDisplayType === 'kiosk-portrait') {
              posUrl = dt
                ? `${appUrl}/kiosk/${posWorkspaceId}/portrait?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kiosk/${posWorkspaceId}/portrait`;
            } else if (posDisplayType === 'kiosk-landscape') {
              posUrl = dt
                ? `${appUrl}/kiosk/${posWorkspaceId}/landscape?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kiosk/${posWorkspaceId}/landscape`;
            } else {
              posUrl = dt
                ? `${appUrl}/kitchen/${posWorkspaceId}?dt=${encodeURIComponent(dt)}`
                : `${appUrl}/kitchen/${posWorkspaceId}`;
            }
          }

          if (posUrl) {
            effectivePublishedContent = {
              id: `pos-display-${device.id}`,
              workspaceId: posWorkspaceId,
              orgId: device.orgId,
              name: 'POS Display',
              type: 'html',
              url: posUrl,
              webUrl: posUrl,
              filePath: null,
              mimeType: 'text/html',
              fileSize: null,
              uploadedBy: null,
              metadata: '{}',
              tags: null,
              originalName: null,
              thumbnailPath: null,
              transcodedPath: null,
              androidFilePath: null,
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as unknown as NonNullable<typeof publishedContent>;
          }
        }
      } catch {
        // If settings parsing fails, fall through to normal (possibly idle) behaviour
      }
    }

    const compatibilityDefaultPlaylist = publishedPlaylist
      ?? (effectivePublishedContent ? buildSingleContentPlaylist(effectivePublishedContent) : null)
      ?? defaultPlaylist;

    // Calendar content must only play when explicitly published or scheduled —
    // strip calendar items from the defaultPlaylist fallback so meeting-room
    // content cannot autoplay without an intentional publish/schedule action.
    const safeDefaultPlaylist = compatibilityDefaultPlaylist
      ? {
          ...compatibilityDefaultPlaylist,
          items: compatibilityDefaultPlaylist.items.filter((item: { content?: { type?: string } | null }) => item.content?.type !== 'calendar'),
        }
      : null;

    return reply.send({
      workspace,
      deviceType: device.type ?? 'signage',
      defaultPlaylist: safeDefaultPlaylist,
      publishedContent: effectivePublishedContent,
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
    const [device, playlist] = await Promise.all([
      db.query.devices.findFirst({
        where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
      }),
      loadPlaylistById(id),
    ]);
    if (!playlist || (playlist as any).workspaceId !== auth.workspaceId) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const _dTokP = (req.headers.authorization as string | undefined)?.startsWith('Bearer ')
      ? (req.headers.authorization as string).slice(7)
      : (req.query as Record<string, string | undefined>).token ?? '';
    const _apiBaseP = `${req.protocol}://${req.hostname}/api/v1`;
    return reply.send(enrichCanvasPlaylist(filterPlaylistItemsForDevice(device, playlist), _dTokP, _apiBaseP));
  });

  // ── GET /devices/device/content/:id ─ fetch content metadata (device-auth) ─
  app.get('/device/content/:id', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const [device, item] = await Promise.all([
      db.query.devices.findFirst({
        where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
      }),
      db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.id, id),
          eq(contentItems.workspaceId, auth.workspaceId),
          isNull(contentItems.deletedAt),
        ),
      }),
    ]);
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (!isContentSupportedByDevice(device, item.type)) {
      return reply.status(404).send({ error: 'Content type not supported on this device' });
    }
    const _dTokC = (req.headers.authorization as string | undefined)?.startsWith('Bearer ')
      ? (req.headers.authorization as string).slice(7)
      : (req.query as Record<string, string | undefined>).token ?? '';
    const _apiBaseC = `${req.protocol}://${req.hostname}/api/v1`;
    return reply.send(enrichCanvasContent(item, _dTokC, _apiBaseC));
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

    // Serve the Android-compatible H.264 variant when the requesting client is
    // an Android device (UA contains both 'Android' and 'NexariPlayer').
    const ua = (req.headers as Record<string, string | undefined>)['user-agent'] ?? '';
    const isAndroid = ua.includes('Android') && ua.includes('NexariPlayer');
    let serveFilePath = item.filePath;
    let mimeType = item.mimeType ?? 'application/octet-stream';
    if (isAndroid && item.type === 'video') {
      try {
        const meta = JSON.parse(item.metadata ?? '{}') as Record<string, unknown>;
        if (typeof meta['androidFilePath'] === 'string') {
          serveFilePath = meta['androidFilePath'];
          mimeType = 'video/mp4';
        }
      } catch { /* ignore */ }
    }

    const absPath = path.resolve(STORAGE_ROOT, serveFilePath);
    try {
      await fsPromises.access(absPath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    const stat = await fsPromises.stat(absPath);
    const fileSize = stat.size;
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

  // ── GET /devices/device/content/:id/epaper.jpg ─ pre-rendered variant for e-paper ──
  // Streams a JPEG resized exactly to the requesting device's panel
  // (panel_w × panel_h, oriented per panel_orientation). The image is
  // cached on disk at signage_uploads/epaper/<deviceId>/<contentId>-WxH-<mode>.jpg
  // and re-used on subsequent requests.
  app.get('/device/content/:id/epaper.jpg', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const q = req.query as { mode?: string };
    const mode: EpaperFitMode = q.mode === 'cover' || q.mode === 'pad' ? q.mode : 'contain';

    const [device, item] = await Promise.all([
      db.query.devices.findFirst({
        where: and(eq(devices.id, auth.deviceId), isNull(devices.deletedAt)),
      }),
      // Load by ID only — workspaceId filter is intentionally omitted here because
      // the schedule endpoint serves publishedContentId without a workspace constraint,
      // creating a mismatch when a device's published content lives in a different
      // workspace than the JWT's workspaceId.  We enforce org-level access below.
      db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.id, id),
          isNull(contentItems.deletedAt),
        ),
      }),
    ]);

    if (!device) return reply.status(404).send({ error: 'Device not found' });
    if (!item) return reply.status(404).send({ error: 'Content not found' });

    // Fall back to known panel defaults when panel_w/panel_h are not yet stored
    // (migration 0055 not yet applied, or device registered before e-paper support).
    // EM13DX1 = 1600×1200 (4:3), EM32DX2 = 2560×1440 (16:9).
    const resolvedPanelDims = (d: NonNullable<typeof device>): { panelW: number; panelH: number } | null => {
      if (d.panelW && d.panelH) return { panelW: d.panelW, panelH: d.panelH };
      const mn = (d.modelName ?? '').toUpperCase();
      if (mn.startsWith('EM13')) return { panelW: 1600, panelH: 1200 };
      if (mn.startsWith('EM32')) return { panelW: 2560, panelH: 1440 };
      return null;
    };
    const dims = resolvedPanelDims(device);
    if (!dims) {
      return reply.status(400).send({ error: 'Device panel size not registered' });
    }

    // Org-level access check: content's workspace must belong to the device's org.
    const contentWorkspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, item.workspaceId ?? ''),
    });
    if (!contentWorkspace || contentWorkspace.orgId !== auth.orgId) {
      return reply.status(403).send({ error: 'Content access denied' });
    }

    // Honour the panel's actual physical orientation. If portrait, swap dims.
    const isPortrait = device.panelOrientation === 'portrait';
    const panelW = isPortrait ? Math.min(dims.panelW, dims.panelH) : Math.max(dims.panelW, dims.panelH);
    const panelH = isPortrait ? Math.max(dims.panelW, dims.panelH) : Math.min(dims.panelW, dims.panelH);

    // ── Calendar content ── render an SVG agenda → JPEG variant ─────────
    if (item.type === 'calendar') {
      try {
        let meta: { connectionId?: string; selectedCalendarIds?: string[]; keywordFilter?: string | null; privacyMode?: 'titles' | 'busy_only'; lookaheadHours?: number } = {};
        try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
        if (!meta.connectionId) return reply.status(400).send({ error: 'Calendar has no connection configured' });

        const conn = await db.query.calendarConnections.findFirst({
          where: and(eq(calendarConnections.id, meta.connectionId), isNull(calendarConnections.deletedAt)),
        });
        if (!conn || conn.workspaceId !== item.workspaceId) {
          return reply.status(404).send({ error: 'Calendar connection not found' });
        }

        const lookaheadHours = Math.max(1, Math.min(168, meta.lookaheadHours ?? 48));
        const fromD = new Date();
        const toD = new Date(Date.now() + lookaheadHours * 3_600_000);

        const { listEventsForConnection } = await import('../services/calendar/index.js');
        const events = await listEventsForConnection(conn, {
          from: fromD, to: toD,
          ...(meta.selectedCalendarIds ? { calendarIds: meta.selectedCalendarIds } : {}),
          ...(meta.keywordFilter ? { keyword: meta.keywordFilter } : {}),
        });
        const safe = (meta.privacyMode === 'busy_only')
          ? events.map((e) => ({ ...e, title: 'Busy', location: null, description: null, organizerEmail: null, organizerName: null, attendeeCount: null }))
          : events;

        const { ensureCalendarVariant } = await import('../services/epaper-calendar.js');
        const variant = await ensureCalendarVariant({
          deviceId: device.id,
          contentId: item.id,
          panelW,
          panelH,
          events: safe,
          title: item.name || 'Calendar',
        });

        const stat = await fsPromises.stat(variant.absPath);
        reply.header('Content-Type', 'image/jpeg');
        reply.header('Content-Length', String(stat.size));
        // Calendars change as events do; keep a short cache so the device
        // re-fetches on its next slot tick.
        reply.header('Cache-Control', 'private, max-age=300');
        reply.header('X-Epaper-Variant-Generated', variant.generated ? '1' : '0');
        reply.header('X-Epaper-Variant-Hash', variant.hash);
        reply.header('Accept-Ranges', 'bytes');
        return reply.send(createReadStream(variant.absPath));
      } catch (err) {
        req.log.error({ err, contentId: id, deviceId: device.id }, '[epaper] calendar variant render failed');
        return reply.status(502).send({ error: 'Calendar render failed' });
      }
    }

    // ── Image content ── pre-rendered JPEG variant ──────────────────────
    if (item.type !== 'image' || !item.filePath) {
      return reply.status(415).send({
        error: 'E-paper variants not supported for this content type',
        type: item.type,
      });
    }

    let variant;
    try {
      variant = await ensureEpaperVariant({
        deviceId: device.id,
        contentId: item.id,
        srcRelPath: item.filePath,
        panelW,
        panelH,
        mode,
      });
    } catch (err) {
      req.log.error({ err, contentId: id, deviceId: device.id }, '[epaper] variant render failed');
      return reply.status(500).send({ error: 'Variant render failed' });
    }

    const stat = await fsPromises.stat(variant.absPath);
    reply.header('Content-Type', 'image/jpeg');
    reply.header('Content-Length', String(stat.size));
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('X-Epaper-Variant-Generated', variant.generated ? '1' : '0');
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(createReadStream(variant.absPath));
  });


  app.get('/device/content/:id/calendar/events', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string; token?: string };

    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) });
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'calendar') return reply.status(400).send({ error: 'Not a calendar content item' });
    if (item.workspaceId !== auth.workspaceId) return reply.status(403).send({ error: 'Forbidden' });

    let meta: { connectionId?: string; selectedCalendarIds?: string[]; keywordFilter?: string | null; privacyMode?: 'titles' | 'busy_only' } = {};
    try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
    if (!meta.connectionId) return reply.status(400).send({ error: 'No connection configured' });

    const conn = await db.query.calendarConnections.findFirst({
      where: and(eq(calendarConnections.id, meta.connectionId), isNull(calendarConnections.deletedAt)),
    });
    if (!conn) return reply.status(404).send({ error: 'Connection not found' });
    if (conn.workspaceId !== item.workspaceId) return reply.status(403).send({ error: 'Connection mismatch' });

    const fromD = q.from ? new Date(q.from) : new Date();
    const toD = q.to ? new Date(q.to) : new Date(Date.now() + 7 * 86_400_000);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return reply.status(400).send({ error: 'Invalid from/to' });
    }

    const { listEventsForConnection } = await import('../services/calendar/index.js');
    try {
      const events = await listEventsForConnection(conn, {
        from: fromD, to: toD,
        ...(meta.selectedCalendarIds ? { calendarIds: meta.selectedCalendarIds } : {}),
        ...(meta.keywordFilter ? { keyword: meta.keywordFilter } : {}),
      });
      const safe = (meta.privacyMode === 'busy_only')
        ? events.map((e) => ({ ...e, title: 'Busy', location: null, description: null, organizerEmail: null, organizerName: null, attendeeCount: null }))
        : events;
      return reply.send({ events: safe });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(502).send({ error: 'Provider error', detail: msg });
    }
  });

  // ── GET /devices/device/content/:id/html5/:token/* ─ serve extracted HTML5 package ──
  // The device token is embedded in the path (not query string) so that all
  // relative asset requests (scripts, stylesheets, images) made by the iframe
  // automatically carry the token and are served from the same route.
  app.get('/device/content/:id/html5/:token/*', {
    // TV player apps (Tizen WGT) run at app:// origin and load this in an iframe.
    // Explicitly override any upstream X-Frame-Options / CSP that would block framing,
    // regardless of whether the nginx HTML5 location override has been deployed.
    onSend: async (_req, reply) => {
      reply.removeHeader('X-Frame-Options');
      reply.header('Content-Security-Policy', 'frame-ancestors *;');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }, async (req, reply) => {
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

    // Extract ZIP to temp dir keyed by content id (cached across requests).
    // Use the metadata startPage (default 'index.html') to detect whether the
    // package has already been extracted rather than hardcoding index.html.
    let startPage = 'index.html';
    try {
      const meta = JSON.parse(item.metadata ?? '{}') as Record<string, unknown>;
      if (typeof meta.startPage === 'string' && meta.startPage) {
        startPage = meta.startPage.replace(/^\/+/, '').replace(/\.\./g, '');
      }
    } catch { /* ignore bad metadata */ }

    const extractDir = path.join(os.tmpdir(), 'nexari-html5', id);
    const startPagePath = path.join(extractDir, startPage);
    if (!existsSync(startPagePath)) {
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

  // ── GET /:id/rules — list device BLE rules ──────────────────────────────
  app.get('/:id/rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    const rules = await db.query.deviceRules.findMany({
      where: and(eq(deviceRules.workspaceId, device.workspaceId!), eq(deviceRules.deviceId, id)),
      orderBy: [desc(deviceRules.priority), asc(deviceRules.createdAt)],
    });
    return reply.send({ rules });
  });

  // ── POST /:id/rules — create a BLE rule ─────────────────────────────────
  app.post('/:id/rules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name: string; enabled?: boolean; conditions: unknown; action: unknown; priority?: number };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    if (!body.name || !body.conditions || !body.action) return reply.status(400).send({ error: 'name, conditions and action are required' });
    const [rule] = await db.insert(deviceRules).values({
      workspaceId: device.workspaceId!,
      deviceId: id,
      name: body.name,
      enabled: body.enabled ?? true,
      conditions: body.conditions as never,
      action: body.action as never,
      priority: body.priority ?? 0,
    }).returning();
    return reply.status(201).send(rule);
  });

  // ── PUT /:id/rules/:ruleId — update a BLE rule ───────────────────────────
  app.put('/:id/rules/:ruleId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, ruleId } = req.params as { id: string; ruleId: string };
    const body = req.body as Partial<{ name: string; enabled: boolean; conditions: unknown; action: unknown; priority: number }>;
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    const rule = await db.query.deviceRules.findFirst({
      where: and(eq(deviceRules.id, ruleId), eq(deviceRules.deviceId, id)),
    });
    if (!rule) return reply.status(404).send({ error: 'Rule not found' });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name      != null) patch.name       = body.name;
    if (body.enabled   != null) patch.enabled     = body.enabled;
    if (body.conditions != null) patch.conditions = body.conditions;
    if (body.action    != null) patch.action      = body.action;
    if (body.priority  != null) patch.priority    = body.priority;
    const [updated] = await db.update(deviceRules).set(patch as never).where(eq(deviceRules.id, ruleId)).returning();
    return reply.send(updated);
  });

  // ── DELETE /:id/rules/:ruleId — delete a BLE rule ───────────────────────
  app.delete('/:id/rules/:ruleId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, ruleId } = req.params as { id: string; ruleId: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    await db.delete(deviceRules).where(and(eq(deviceRules.id, ruleId), eq(deviceRules.deviceId, id)));
    return reply.status(204).send();
  });

  // ── POST /:id/rules/publish — push rules to device via WS ───────────────
  app.post('/:id/rules/publish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    const rows = await db.query.deviceRules.findMany({
      where: and(eq(deviceRules.workspaceId, device.workspaceId!), eq(deviceRules.deviceId, id)),
      orderBy: [desc(deviceRules.priority), asc(deviceRules.createdAt)],
    });
    sendCommand(id, { type: 'device_rules', rules: rows } as never);
    return reply.send({ ok: true, ruleCount: rows.length });
  });

  // ── POST /:id/rules/unpublish — clear rules from device via WS ────────────
  app.post('/:id/rules/unpublish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    sendCommand(id, { type: 'device_rules', rules: [] } as never);
    return reply.send({ ok: true });
  });

  // ── POST /:id/return-to-player — relaunch Nexari on the TV ─────────────
  // Tries WS first (device is online), then falls back to Samsung Remote
  // Control WebSocket API on port 8001 (works even when Nexari is killed).
  app.post('/:id/return-to-player', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });

    // Method 1: WS command (works if background-support is enabled)
    sendCommand(id, { type: 'bring_to_front' } as never);

    // Method 2: Samsung Remote Control API on port 8001 (works even when app is killed)
    const tvIp = device.ipAddress;
    if (tvIp) {
      try {
        const { WebSocket: WsClient } = await import('ws') as typeof import('ws');
        const appId = 'zBkMAo0wLV.Nexritv';
        const appName = Buffer.from('Nexari').toString('base64');
        await new Promise<void>((resolve, reject) => {
          const ws = new WsClient(
            `ws://${tvIp}:8001/api/v2/channels/samsung.remote.control?name=${appName}`,
            { handshakeTimeout: 3000 }
          );
          let settled = false;
          const done = (err?: Error) => {
            if (settled) return;
            settled = true;
            try { ws.close(); } catch (_) {}
            err ? reject(err) : resolve();
          };
          ws.on('open', () => {
            ws.send(JSON.stringify({
              method: 'ms.channel.emit',
              params: { event: 'ed.apps.launch', to: 'host', data: { appId } },
            }));
            setTimeout(() => done(), 500);
          });
          ws.on('message', () => done());
          ws.on('error', (e: Error) => done(e));
          setTimeout(() => done(new Error('timeout')), 4000);
        });
        app.log.info({ deviceId: id, tvIp }, 'Samsung Remote Control launch sent');
        return reply.send({ ok: true, method: 'remote_control' });
      } catch (e: any) {
        app.log.warn({ deviceId: id, tvIp, err: e?.message }, 'Samsung Remote Control launch failed — WS command already sent');
        return reply.send({ ok: true, method: 'ws_only', warning: e?.message });
      }
    }

    return reply.send({ ok: true, method: 'ws_only' });
  });

  // ── POST /:id/ble-scan — tell device to run a BLE scan ──────────────────
  app.post('/:id/ble-scan', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    sendCommand(id, { type: 'ble_scan' } as never);
    return reply.send({ ok: true });
  });

  // ── GET /:id/ble-scan/latest — latest BLE scan result ───────────────────
  app.get('/:id/ble-scan/latest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const device = await db.query.devices.findFirst({
      where: and(eq(devices.id, id), eq(devices.orgId, user.orgId), isNull(devices.deletedAt)),
    });
    if (!device) return reply.status(404).send({ error: 'Not found' });
    const latest = await db.query.bleScanResults.findFirst({
      where: eq(bleScanResults.deviceId, id),
      orderBy: [desc(bleScanResults.scannedAt)],
    });
    return reply.send(latest ?? null);
  });

  // ── GET /:deviceId/datasync/:contentId/table ───────────────────────────────
  // Serves a DSTableData payload to the Tizen/Windows datasync renderer.
  // The renderer calls: GET /api/v1/devices/{deviceId}/datasync/{contentId}/table
  // Device auth is via JWT (Bearer header). The deviceId path param is matched
  // against the token subject for an extra sanity check.
  //
  // In-process cache keyed by contentId to avoid hammering the source URL.
  const _datasyncCache = new Map<string, { hash: string; data: unknown; fetchedAt: number }>();

  app.get('/:deviceId/datasync/:contentId/table', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { deviceId: urlDeviceId, contentId } = req.params as { deviceId: string; contentId: string };

    // Extra check: token deviceId must match URL
    if (auth.deviceId !== urlDeviceId) return reply.status(403).send({ error: 'Token / path mismatch' });

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, contentId), isNull(contentItems.deletedAt)),
    });
    if (!item)                          return reply.status(404).send({ error: 'Content not found' });
    if (item.type !== 'datasync')       return reply.status(400).send({ error: 'Not a datasync item' });
    if (item.workspaceId !== auth.workspaceId) return reply.status(403).send({ error: 'Forbidden' });

    const meta = (() => {
      try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; }
    })() as {
      sourceUrl?: string;
      dataPath?: string;
      labelField?: string;
      columns?: { key: string; label: string }[];
      title?: string;
      subtitle?: string;
      refreshSeconds?: number;
    };

    if (!meta.sourceUrl) return reply.status(500).send({ error: 'Datasync item has no sourceUrl' });

    const refreshSecs = Math.max(60, meta.refreshSeconds ?? 300);
    const cached = _datasyncCache.get(contentId);
    const now    = Date.now();

    let rows: Record<string, unknown>[];

    if (cached && now - cached.fetchedAt < refreshSecs * 1000) {
      rows = cached.data as Record<string, unknown>[];
    } else {
      let json: unknown;
      try {
        const res = await fetch(meta.sourceUrl, {
          signal: AbortSignal.timeout(10_000),
          headers: { 'Accept': 'application/json, */*' },
        });
        if (!res.ok) return reply.status(502).send({ error: `Source returned HTTP ${res.status}` });
        json = await res.json();
      } catch (err: any) {
        // If we have stale cache, return it rather than erroring
        if (cached) { rows = cached.data as Record<string, unknown>[]; }
        else return reply.status(502).send({ error: `Fetch failed: ${String(err?.message ?? err)}` });
        rows = rows!;
        json = null; // prevent further processing
      }

      if (json !== null) {
        let arr: unknown = json;
        if (meta.dataPath) {
          for (const key of meta.dataPath.split('.')) {
            if (arr && typeof arr === 'object' && !Array.isArray(arr)) {
              arr = (arr as Record<string, unknown>)[key];
            } else { arr = undefined; break; }
          }
        }
        if (!Array.isArray(arr) && arr && typeof arr === 'object') {
          for (const val of Object.values(arr as Record<string, unknown>)) {
            if (Array.isArray(val)) { arr = val; break; }
          }
        }
        rows = Array.isArray(arr)
          ? (arr as unknown[]).filter((r) => r && typeof r === 'object') as Record<string, unknown>[]
          : [];

        const hash = JSON.stringify(rows);
        _datasyncCache.set(contentId, { hash, data: rows, fetchedAt: now });
      }
    }

    const columns   = Array.isArray(meta.columns) ? meta.columns : [];
    const labelField = meta.labelField ?? '';

    // Build DSTableData: trains = columns, stations = rows, cells = values
    const trains = columns.map((col) => ({
      id:     col.key,
      number: col.label,
      days:   null as string | null,
      status: 'normal',
    }));

    const stations = rows!.map((row, i) => ({
      id:       String(i),
      name:     labelField && row[labelField] != null ? String(row[labelField]) : `Row ${i + 1}`,
      tag:      null as string | null,
      section:  null as string | null,
      type:     'stop',
      position: i,
    }));

    const cells = rows!.flatMap((row, i) =>
      columns.map((col) => ({
        id:        `${col.key}-${i}`,
        trainId:   col.key,
        stationId: String(i),
        value:     row[col.key] != null ? String(row[col.key]) : null,
        note:      null as string | null,
        status:    'normal',
        delayMins: null as number | null,
      })),
    );

    reply.header('Cache-Control', `public, max-age=${refreshSecs}`);
    return reply.send({
      title:    meta.title    ?? item.name,
      subtitle: meta.subtitle ?? '',
      trains,
      stations,
      cells,
    });
  });

  // ── GET /devices/device/widgets/weather — device-auth weather proxy ───────
  app.get('/device/widgets/weather', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { lat, lon, units } = req.query as { lat?: string; lon?: string; units?: string };
    if (!lat || !lon) return reply.status(400).send({ error: 'lat and lon required' });

    const latF = parseFloat(lat);
    const lonF = parseFloat(lon);
    if (isNaN(latF) || isNaN(lonF)) return reply.status(400).send({ error: 'Invalid lat/lon' });

    const mode = req.query && (req.query as Record<string, string>)['mode'] || 'current';
    const baseParams = `latitude=${latF}&longitude=${lonF}&timezone=auto&wind_speed_unit=kmh${units === 'F' ? '&temperature_unit=fahrenheit' : ''}`;
    let weatherUrl: string;
    if (mode === '7day') {
      weatherUrl = `https://api.open-meteo.com/v1/forecast?${baseParams}&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7`;
    } else if (mode === 'hourly') {
      weatherUrl = `https://api.open-meteo.com/v1/forecast?${baseParams}&hourly=temperature_2m,weather_code&forecast_hours=24`;
    } else {
      weatherUrl = `https://api.open-meteo.com/v1/forecast?${baseParams}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m`;
    }

    try {
      const res = await fetch(weatherUrl);
      if (!res.ok) return reply.status(502).send({ error: 'Weather service unavailable' });
      const data = await res.json() as Record<string, unknown>;

      function weatherLabel(code: number): string {
        if (code === 0) return 'Clear Sky';
        if (code === 1 || code === 2 || code === 3) return 'Partly Cloudy';
        if (code <= 48) return 'Foggy';
        if (code <= 67) return 'Rainy';
        if (code <= 77) return 'Snowy';
        if (code <= 82) return 'Showers';
        if (code <= 99) return 'Thunderstorm';
        return 'Unknown';
      }
      function weatherIcon(code: number): string {
        if (code === 0 || code === 1) return '☀️';
        if (code <= 3)  return '⛅';
        if (code <= 48) return '🌫️';
        if (code <= 67) return '🌧️';
        if (code <= 77) return '❄️';
        if (code <= 82) return '🌦️';
        if (code <= 99) return '⛈️';
        return '🌡️';
      }

      if (mode === '7day') {
        const daily = data['daily'] as Record<string, unknown> | undefined;
        const dates  = (daily?.['time']              as string[]  | undefined) ?? [];
        const maxes  = (daily?.['temperature_2m_max'] as number[] | undefined) ?? [];
        const mins   = (daily?.['temperature_2m_min'] as number[] | undefined) ?? [];
        const codes  = (daily?.['weather_code']       as number[] | undefined) ?? [];
        return reply.send(dates.map((date, i) => ({
          date, code: codes[i] ?? 0, label: weatherLabel(codes[i] ?? 0),
          icon: weatherIcon(codes[i] ?? 0), tempMax: maxes[i] ?? null, tempMin: mins[i] ?? null,
        })));
      } else if (mode === 'hourly') {
        const hourly = data['hourly'] as Record<string, unknown> | undefined;
        const times  = (hourly?.['time']           as string[]  | undefined) ?? [];
        const temps  = (hourly?.['temperature_2m'] as number[]  | undefined) ?? [];
        const codes  = (hourly?.['weather_code']   as number[]  | undefined) ?? [];
        return reply.send(times.slice(0, 24).map((time, i) => ({
          time, code: codes[i] ?? 0, icon: weatherIcon(codes[i] ?? 0), temp: temps[i] ?? null,
        })));
      } else {
        const current = data['current'] as Record<string, unknown> | undefined;
        const code = typeof current?.['weather_code'] === 'number' ? current['weather_code'] as number : 0;
        return reply.send({
          temp: current?.['temperature_2m'] ?? null, unit: units === 'F' ? 'F' : 'C',
          code, label: weatherLabel(code), icon: weatherIcon(code),
          wind: current?.['wind_speed_10m'] ?? null, humidity: current?.['relative_humidity_2m'] ?? null,
        });
      }
    } catch (err: any) {
      return reply.status(502).send({ error: 'Failed to fetch weather', detail: err?.message });
    }
  });

  // ── GET /devices/device/widgets/rss — device-auth RSS proxy ──────────────
  app.get('/device/widgets/rss', async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { url } = req.query as { url?: string };
    if (!url) return reply.status(400).send({ error: 'url required' });

    let feedUrl: URL;
    try {
      feedUrl = new URL(url);
    } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }
    if (feedUrl.protocol !== 'http:' && feedUrl.protocol !== 'https:') {
      return reply.status(400).send({ error: 'Only http/https URLs supported' });
    }

    try {
      const res = await fetch(feedUrl.toString(), {
        headers: { 'User-Agent': 'Nexari-Signage-Player/1.0', 'Accept': 'application/rss+xml,application/atom+xml,text/xml,*/*' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return reply.status(502).send({ error: `Feed returned HTTP ${res.status}` });
      const xml = await res.text();

      // Parse titles and links from RSS/Atom XML
      const items: Array<{ title: string; link: string }> = [];
      const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
      const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
      const titleRe = /<title(?:[^>]*)>([\s\S]*?)<\/title>/i;
      const linkRe  = /<link(?:[^>]*)>([^<]*)<\/link>/i;
      const linkHrefRe = /<link[^>]+href=["']([^"']+)["']/i;
      function extractItems(re: RegExp) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          if (items.length >= 20) break;
          const block = m[1] ?? '';
          const titleMatch = titleRe.exec(block);
          const linkMatch  = linkRe.exec(block) || linkHrefRe.exec(block);
          const rawTitle = titleMatch ? titleMatch[1] ?? '' : '';
          const title = rawTitle.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
          const link = linkMatch ? (linkMatch[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
          if (title) items.push({ title, link });
        }
      }
      extractItems(itemRe);
      if (!items.length) extractItems(entryRe);

      return reply.send({ items });
    } catch (err: any) {
      return reply.status(502).send({ error: 'Failed to fetch RSS feed', detail: err?.message });
    }
  });

  // ── GET /devices/device/content/:id/canvas.html — serve canvas as HTML ──
  app.get('/device/content/:id/canvas.html', {
    onSend: async (_req, rep) => {
      rep.removeHeader('X-Frame-Options');
      rep.header('Content-Security-Policy', 'frame-ancestors *;');
      rep.header('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }, async (req, reply) => {
    const auth = authenticateDevice(req as never, reply as never);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), eq(contentItems.workspaceId, auth.workspaceId), isNull(contentItems.deletedAt)),
    });
    if (!item || item.type !== 'canvas') return reply.status(404).send({ error: 'Canvas content not found' });

    // Look up the canvas project via metadata canvasProjectId or by contentItemId
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
    const projectId = typeof meta['canvasProjectId'] === 'string' ? meta['canvasProjectId'] : null;

    const project = projectId
      ? await db.query.canvasProjects.findFirst({
          where: and(eq(canvasProjects.id, projectId), isNull(canvasProjects.deletedAt)),
        })
      : await db.query.canvasProjects.findFirst({
          where: and(eq(canvasProjects.contentItemId, id), isNull(canvasProjects.deletedAt)),
        });

    if (!project) return reply.status(404).send({ error: 'Canvas project not found' });

    const sceneData = project.sceneData as { pages?: unknown[] } | null;
    const settings  = project.settings  as { width?: number; height?: number; background?: string } | null;
    const canvasW = settings?.width  ?? 1920;
    const canvasH = settings?.height ?? 1080;
    const bgColor = settings?.background ?? '#000';

    // Pre-fetch all image assets referenced in the canvas and embed as base64 so the
    // downloaded HTML file is fully self-contained and plays without any server connection.
    function collectImageIds(elements: any[]): string[] {
      const ids: string[] = [];
      for (const el of elements ?? []) {
        if (el.type === 'image' && typeof el.contentItemId === 'string') ids.push(el.contentItemId);
        if (el.type === 'group' && Array.isArray(el.children)) ids.push(...collectImageIds(el.children));
      }
      return ids;
    }
    const allImageIds = ((sceneData as any)?.pages ?? []).flatMap((p: any) => collectImageIds(p?.elements ?? [])) as string[];
    const uniqueImageIds = [...new Set(allImageIds)].filter(Boolean);
    const imageMap: Record<string, string> = {};
    if (uniqueImageIds.length > 0) {
      const imgItems = await db.query.contentItems.findMany({
        where: and(inArray(contentItems.id, uniqueImageIds), eq(contentItems.workspaceId, auth.workspaceId)),
      });
      for (const imgItem of imgItems) {
        if (imgItem.filePath) {
          try {
            const absPath = path.resolve(STORAGE_ROOT, imgItem.filePath);
            const buf = await fsPromises.readFile(absPath);
            imageMap[imgItem.id] = `data:${imgItem.mimeType ?? 'image/jpeg'};base64,${buf.toString('base64')}`;
          } catch { /* file missing — skip */ }
        }
      }
    }
    const imageMapJson = JSON.stringify(imageMap)
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    // Serialize sceneData as JSON for injection into the HTML page
    const sceneJson = JSON.stringify(sceneData ?? { pages: [] })
      .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${canvasW},initial-scale=1">
<title>${item.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${canvasW}px;height:${canvasH}px;overflow:hidden;background:${bgColor};font-family:Inter,system-ui,sans-serif}
#canvas-root{position:absolute;top:0;left:0;width:${canvasW}px;height:${canvasH}px;overflow:hidden;background:${bgColor}}
.ce{position:absolute;overflow:hidden}
.ce-text{overflow:hidden;word-break:break-word}
.ce-img{object-fit:cover;width:100%;height:100%}
.ce-iframe{width:100%;height:100%;border:none;background:transparent}
.ticker-wrap{width:100%;height:100%;overflow:hidden;display:flex;align-items:center}
.ticker-inner{white-space:nowrap;display:inline-block}
@keyframes ticker-left{from{transform:translateX(100%)}to{transform:translateX(-100%)}}
@keyframes ticker-right{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.weather-wrap{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;border-radius:8px}
.clock-wrap{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
</style>
</head>
<body>
<div id="canvas-root"></div>
<script>
(function(){
  var SCENE = ${sceneJson};
  var IMAGE_MAP = ${imageMapJson};
  var CANVAS_W = ${canvasW};
  var CANVAS_H = ${canvasH};
  var root = document.getElementById('canvas-root');

  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function px(n){ return (Number(n)||0)+'px'; }
  function clamp01(n){ return Math.max(0,Math.min(1,Number(n)||0)); }

  // ── Element renderer ────────────────────────────────────────────────────
  function renderElement(el, parent){
    if(el.visible===false) return;
    var x=Number(el.x)||0, y=Number(el.y)||0, w=Number(el.width)||0, h=Number(el.height)||0;
    var rot=Number(el.rotation)||0, op=clamp01(el.opacity==null?1:el.opacity);
    var baseStyle='left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;'
      +'transform:rotate('+rot+'deg);opacity:'+op+';';

    switch(el.type){
      case 'rect':{
        var d=document.createElement('div');
        d.className='ce';
        d.style.cssText=baseStyle+'background:'+esc(el.fill||'transparent')+';'
          +(el.stroke&&el.strokeWidth?'outline:'+el.strokeWidth+'px solid '+esc(el.stroke)+';':'')
          +(el.cornerRadius?'border-radius:'+el.cornerRadius+'px;':'');
        parent.appendChild(d);
        break;
      }
      case 'circle':{
        var d=document.createElement('div');
        d.className='ce';
        d.style.cssText=baseStyle+'background:'+esc(el.fill||'transparent')
          +';border-radius:50%;'
          +(el.stroke&&el.strokeWidth?'outline:'+el.strokeWidth+'px solid '+esc(el.stroke)+';':'');
        parent.appendChild(d);
        break;
      }
      case 'text':{
        var d=document.createElement('div');
        d.className='ce ce-text';
        var align=el.align||'left', va=el.verticalAlign||'top';
        var jc=va==='middle'?'center':va==='bottom'?'flex-end':'flex-start';
        d.style.cssText=baseStyle+'display:flex;align-items:'+jc+';justify-content:'+align+';'
          +'color:'+esc(el.fill||'#fff')+';font-size:'+(el.fontSize||16)+'px;'
          +'font-family:'+esc(el.fontFamily||'Inter,sans-serif')+';'
          +(el.fontStyle?'font-weight:'+(el.fontStyle.includes('bold')?'bold':'normal')+';font-style:'+(el.fontStyle.includes('italic')?'italic':'normal')+';':'')
          +(el.textDecoration?'text-decoration:'+esc(el.textDecoration)+';':'')
          +'line-height:'+(el.lineHeight||1.2)+';letter-spacing:'+(el.letterSpacing||0)+'px;'
          +'padding:'+(el.padding||0)+'px;text-align:'+align+';';
        d.textContent=el.text||'';
        parent.appendChild(d);
        break;
      }
      case 'line':{
        var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('style',baseStyle+'overflow:visible;');
        svg.setAttribute('width',w||1);svg.setAttribute('height',h||1);
        var pts=(el.points||[0,0,w,0]);
        var polyline=document.createElementNS('http://www.w3.org/2000/svg','polyline');
        var ptStr='';
        for(var i=0;i<pts.length;i+=2) ptStr+=(pts[i]||0)+','+(pts[i+1]||0)+' ';
        polyline.setAttribute('points',ptStr.trim());
        polyline.setAttribute('stroke',el.stroke||'#fff');
        polyline.setAttribute('stroke-width',el.strokeWidth||2);
        polyline.setAttribute('fill','none');
        svg.appendChild(polyline);
        parent.appendChild(svg);
        break;
      }
      case 'image':{
        var imgSrc=el.contentItemId?(IMAGE_MAP[el.contentItemId]||el.src):el.src;
        if(imgSrc){
          var d=document.createElement('div');
          d.className='ce';
          d.style.cssText=baseStyle;
          var img=document.createElement('img');
          img.className='ce-img';
          img.style.objectFit=el.objectFit||'cover';
          img.src=imgSrc;
          d.appendChild(img);parent.appendChild(d);
        }
        break;
      }
      case 'group':{
        var d=document.createElement('div');
        d.className='ce';d.style.cssText=baseStyle;
        var children=el.children||[];
        for(var i=0;i<children.length;i++) renderElement(children[i],d);
        parent.appendChild(d);
        break;
      }
      case 'clock':{
        var d=document.createElement('div');
        d.className='ce clock-wrap';
        d.style.cssText=baseStyle+'background:'+esc(el.bgColor||'transparent')+';color:'+esc(el.textColor||'#fff')+';';
        var timeDiv=document.createElement('div');timeDiv.style.cssText='font-size:'+(Math.floor(h*0.35))+'px;font-weight:bold;font-variant-numeric:tabular-nums;';
        var dateDiv=document.createElement('div');dateDiv.style.cssText='font-size:'+(Math.floor(h*0.14))+'px;opacity:0.8;margin-top:4px;';
        d.appendChild(timeDiv);if(el.showDate!==false)d.appendChild(dateDiv);
        parent.appendChild(d);
        (function(td,dd,tz,fmt,showDate){
          function tick(){
            var now=tz?new Date(new Date().toLocaleString('en-US',{timeZone:tz})):new Date();
            var h=now.getHours(),m=now.getMinutes(),s=now.getSeconds();
            var disp;
            if(fmt==='12h'){
              var ampm=h>=12?'PM':'AM';h=h%12||12;
              disp=(h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s+' '+ampm;
            } else {
              disp=(h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s;
            }
            td.textContent=disp;
            if(showDate&&dd) dd.textContent=now.toLocaleDateString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
          }
          tick();setInterval(tick,1000);
        })(timeDiv,dateDiv,el.timezone||'',el.format||'24h',el.showDate!==false);
        break;
      }
      case 'weather':{
        var d=document.createElement('div');
        d.className='ce weather-wrap';
        d.style.cssText=baseStyle+'color:'+esc(el.textColor||'#fff')+';';
        d.innerHTML='<div style="opacity:0.5;font-size:14px">Loading weather\u2026</div>';
        parent.appendChild(d);
        (function(container,lat,lon,unit,mode){
          function wIcon(c){return c===0||c===1?'\u2600\uFE0F':c<=3?'\u26C5':c<=48?'\uD83C\uDF2B\uFE0F':c<=67?'\uD83C\uDF27\uFE0F':c<=77?'\u2744\uFE0F':c<=82?'\uD83C\uDF26\uFE0F':'\u26C8\uFE0F';}
          function wLabel(c){return c===0?'Clear Sky':c<=3?'Partly Cloudy':c<=48?'Foggy':c<=67?'Rainy':c<=77?'Snowy':c<=82?'Showers':c<=99?'Thunderstorm':'Unknown';}
          var tp=unit==='F'?'&temperature_unit=fahrenheit':'';
          var base='latitude='+lat+'&longitude='+lon+'&timezone=auto&wind_speed_unit=kmh'+tp;
          var url;
          if(mode==='7day')url='https://api.open-meteo.com/v1/forecast?'+base+'&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7';
          else if(mode==='hourly')url='https://api.open-meteo.com/v1/forecast?'+base+'&hourly=temperature_2m,weather_code&forecast_hours=24';
          else url='https://api.open-meteo.com/v1/forecast?'+base+'&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m';
          fetch(url).then(function(r){return r.ok?r.json():null;}).then(function(data){
            if(!data){container.innerHTML='<div style="opacity:0.5">Weather unavailable</div>';return;}
            if(mode==='7day'&&data.daily){
              var dd=data.daily,dates=dd.time||[],maxT=dd.temperature_2m_max||[],minT=dd.temperature_2m_min||[],codes=dd.weather_code||[];
              var h7='<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%;padding:8px;">';
              for(var i=0;i<Math.min(dates.length,7);i++)h7+='<div style="text-align:center;flex:1;min-width:60px;"><div style="font-size:22px">'+wIcon(codes[i]||0)+'</div><div style="font-size:11px;opacity:0.8">'+esc((dates[i]||'').slice(5))+'</div><div style="font-size:12px">'+esc(maxT[i]!=null?Math.round(maxT[i])+'\u00B0':'\u2014')+'</div><div style="font-size:11px;opacity:0.7">'+esc(minT[i]!=null?Math.round(minT[i])+'\u00B0':'\u2014')+'</div></div>';
              container.innerHTML=h7+'</div>';
            }else if(mode==='hourly'&&data.hourly){
              var dh=data.hourly,times=dh.time||[],temps=dh.temperature_2m||[],hcodes=dh.weather_code||[];
              var hh='<div style="display:flex;gap:6px;overflow:hidden;padding:8px;">';
              for(var i=0;i<Math.min(times.length,12);i++)hh+='<div style="text-align:center;flex:1;min-width:50px;"><div style="font-size:18px">'+wIcon(hcodes[i]||0)+'</div><div style="font-size:11px;opacity:0.8">'+esc((times[i]||'').slice(11,16))+'</div><div style="font-size:12px">'+esc(temps[i]!=null?Math.round(temps[i])+'\u00B0':'\u2014')+'</div></div>';
              container.innerHTML=hh+'</div>';
            }else if(data.current){
              var cur=data.current,code=cur.weather_code||0;
              container.innerHTML='<div style="font-size:48px;line-height:1">'+wIcon(code)+'</div>'
                +'<div style="font-size:28px;font-weight:bold;margin-top:4px">'+(cur.temperature_2m!=null?Math.round(cur.temperature_2m)+'\u00B0'+esc(unit):'\u2014')+'</div>'
                +'<div style="font-size:14px;opacity:0.8;margin-top:2px">'+wLabel(code)+'</div>'
                +(cur.wind_speed_10m!=null?'<div style="font-size:11px;opacity:0.6;margin-top:2px">\uD83D\uDCA8 '+Math.round(cur.wind_speed_10m)+' km/h</div>':'');
            }else{
              container.innerHTML='<div style="opacity:0.5">Weather unavailable</div>';
            }
          }).catch(function(){container.innerHTML='<div style="opacity:0.5">Weather unavailable</div>';});
        })(d,el.lat||0,el.lon||0,el.unit||'C',el.displayMode||'current');
        break;
      }
      case 'ticker':{
        var d=document.createElement('div');
        d.className='ce ticker-wrap';
        d.style.cssText=baseStyle+'background:'+esc(el.bgColor||'transparent')+';color:'+esc(el.textColor||'#fff')+';font-size:'+(el.fontSize||16)+'px;';
        var inner=document.createElement('div');
        inner.className='ticker-inner';
        var dur=Math.round(66-((el.speed||5)*6));
        var dir=el.direction==='right'?'ticker-right':'ticker-left';
        inner.style.animation=dir+' '+dur+'s linear infinite';
        inner.textContent='Loading feed\u2026';
        d.appendChild(inner);parent.appendChild(d);
        if(el.rssUrl){
          (function(inner2,rssUrl){
            fetch(rssUrl,{headers:{'Accept':'application/rss+xml,application/atom+xml,text/xml,*/*'}})
              .then(function(r){return r.ok?r.text():null;})
              .then(function(xml){
                if(!xml){inner2.textContent='No headlines available  ';return;}
                var items=[];
                try{
                  var doc=(new DOMParser()).parseFromString(xml,'text/xml');
                  var nodes=Array.prototype.slice.call(doc.querySelectorAll('item,entry'),0,30);
                  for(var i=0;i<nodes.length;i++){
                    var t=(nodes[i].querySelector('title')||{}).textContent||'';
                    var clean=t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').trim();
                    if(clean)items.push(clean);
                  }
                }catch(e){}
                inner2.textContent=items.length?(items.join('  \u2022  ')+'  '):'No headlines  ';
              }).catch(function(){inner2.textContent='Feed unavailable  ';});
          })(inner,el.rssUrl);
        } else {
          inner.textContent='RSS feed not configured  ';
        }
        break;
      }
      case 'webpage':{
        var d=document.createElement('div');
        d.className='ce';d.style.cssText=baseStyle;
        var frame=document.createElement('iframe');
        frame.className='ce-iframe';
        frame.src=el.url||'about:blank';
        frame.setAttribute('allowfullscreen','');
        frame.setAttribute('allow','autoplay; fullscreen');
        if(el.refreshIntervalSec&&el.refreshIntervalSec>0){
          (function(f,sec){setInterval(function(){f.src=f.src;},sec*1000);})(frame,el.refreshIntervalSec);
        }
        d.appendChild(frame);parent.appendChild(d);
        break;
      }
      case 'youtube':{
        var d=document.createElement('div');
        d.className='ce';d.style.cssText=baseStyle;
        var rawUrl=el.url||'';
        var vid='';
        var m=rawUrl.match(/(?:v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);
        if(m)vid=m[1];else if(/^[A-Za-z0-9_-]{11}$/.test(rawUrl))vid=rawUrl;
        if(vid){
          var frame=document.createElement('iframe');
          frame.className='ce-iframe';
          frame.src='https://www.youtube.com/embed/'+vid+'?autoplay='+(el.autoplay?1:0)+'&mute='+(el.muted?1:0)+'&loop='+(el.loop?1:0)+(el.loop?'&playlist='+vid:'')+'&controls=0&playsinline=1';
          frame.setAttribute('allowfullscreen','');
          frame.setAttribute('allow','autoplay; fullscreen; encrypted-media');
          d.appendChild(frame);
        }
        parent.appendChild(d);
        break;
      }
    }
  }

  // ── Multi-page renderer ─────────────────────────────────────────────────
  var pages=(SCENE.pages||[]);
  if(!pages.length) return;

  var pageEls=[];
  for(var pi=0;pi<pages.length;pi++){
    var page=pages[pi];
    var pageDiv=document.createElement('div');
    pageDiv.style.cssText='position:absolute;top:0;left:0;width:'+CANVAS_W+'px;height:'+CANVAS_H+'px;'
      +'display:'+(pi===0?'block':'none')+';overflow:hidden;background:'+'${bgColor}'+';';
    var elements=page.elements||[];
    for(var ei=0;ei<elements.length;ei++) renderElement(elements[ei],pageDiv);
    root.appendChild(pageDiv);
    pageEls.push(pageDiv);
  }

  // Cycle pages if more than one
  if(pageEls.length>1){
    var cur=0;
    function nextPage(){
      pageEls[cur].style.display='none';
      cur=(cur+1)%pageEls.length;
      pageEls[cur].style.display='block';
      var dur=(pages[cur].duration||10)*1000;
      setTimeout(nextPage,dur);
    }
    var firstDur=(pages[0].duration||10)*1000;
    setTimeout(nextPage,firstDur);
  }
})();
</script>
</body>
</html>`;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'private, no-cache');
    return reply.send(html);
  });
}

