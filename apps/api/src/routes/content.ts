import type { FastifyInstance } from 'fastify';
import { db, contentItems, contentFolders, contentVersions, playlistItems, workspaceMembers, workspaces, orgStorageQuotas, users, scheduleSlots, devices, calendarConnections } from '@signage/db';
import { eq, and, isNull, isNotNull, desc, ilike, or, sql, getTableColumns, asc, inArray } from 'drizzle-orm';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { notifyContentFailed, notifyStorageThresholdCrossing } from '../services/notifications.js';
import { dispatchWebhookEvent } from '../services/webhooks.js';
import {
  generateImageThumb,
  generateVideoThumb,
  generatePdfThumb,
  generatePresentationThumb,
  generateHtml5Thumb,
  processContentMedia,
} from '../services/media-processing.js';
import { getQueue, QUEUE_NAMES } from '../queues/index.js';
import { listEventsForConnection } from '../services/calendar/index.js';
import {
  CreateChannelGroupSchema,
  UpdateChannelGroupSchema,
  ImportM3USchema,
  parseM3U,
  ChannelGroupMetadataSchema,
} from '@signage/shared';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const FFPROBE_BIN = (() => {
  const configured = process.env['FFPROBE_PATH'];
  if (configured) return configured;
  if (/ffmpeg(\.exe)?$/i.test(FFMPEG_BIN)) {
    return FFMPEG_BIN.replace(/ffmpeg(\.exe)?$/i, (_match, ext: string | undefined) => `ffprobe${ext ?? ''}`);
  }
  return 'ffprobe';
})();

/** Resize any image to a 400-wide JPEG thumbnail. */
// Helpers moved to services/media-processing.ts
// (generateImageThumb / generateVideoThumb / generatePdfThumb /
//  generatePresentationThumb / probeVideo / probeImage)

type AuthUser = { sub: string; orgId: string; role: string };

// Roles that are allowed to upload content
const UPLOAD_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'c-manager']);
// Roles that are allowed to approve / reject content
const APPROVE_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager']);

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/bmp', 'image/heic',
]);
const VIDEO_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/mp2t',
]);

function detectType(mime: string, filename: string): 'image' | 'video' | 'html5' | 'pdf' | 'presentation' {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (VIDEO_MIMES.has(mime)) return 'video';
  const ext = path.extname(filename).toLowerCase();
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (ext === '.zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'html5';
  if (['.pptx', '.ppt'].includes(ext)) return 'presentation';
  return 'image';
}

async function checkWorkspaceAccess(wsId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, wsId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

export async function contentRoutes(app: FastifyInstance) {

  // ── GET /content/widgets/weather?lat=&lon=&units= ─────────────────────────
  const weatherCache = new Map<string, { data: unknown; cachedAt: number }>();
  const WEATHER_TTL_MS = 15 * 60 * 1000;

  function weatherLabel(code: number): string {
    if (code === 0) return 'Clear sky';
    if (code <= 3) return 'Partly cloudy';
    if (code <= 48) return 'Fog';
    if (code <= 55) return 'Drizzle';
    if (code <= 65) return 'Rain';
    if (code <= 75) return 'Snow';
    if (code <= 82) return 'Showers';
    if (code <= 99) return 'Thunderstorm';
    return 'Unknown';
  }

  function weatherIcon(code: number): string {
    if (code === 0)  return '☀️';
    if (code <= 2)   return '🌤️';
    if (code === 3)  return '☁️';
    if (code <= 48)  return '🌫️';
    if (code <= 55)  return '🌦️';
    if (code <= 65)  return '🌧️';
    if (code <= 75)  return '❄️';
    if (code <= 82)  return '🌦️';
    if (code <= 99)  return '⛈️';
    return '🌡️';
  }

  app.get('/widgets/weather', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { lat, lon, units = 'metric' } = req.query as { lat?: string; lon?: string; units?: string };
    if (!lat || !lon) return reply.status(400).send({ error: 'lat and lon are required' });

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) return reply.status(400).send({ error: 'Invalid lat/lon' });

    const cacheKey = `${latNum.toFixed(2)}_${lonNum.toFixed(2)}_${units}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < WEATHER_TTL_MS) {
      return reply.send(cached.data);
    }

    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}&current=temperature_2m,weather_code&temperature_unit=${tempUnit}&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return reply.status(502).send({ error: 'Weather service unavailable' });

    const raw = await res.json() as Record<string, unknown>;
    const current = raw['current'] as Record<string, unknown> | undefined;
    const code = typeof current?.['weather_code'] === 'number' ? current['weather_code'] : 0;
    const temp = typeof current?.['temperature_2m'] === 'number' ? current['temperature_2m'] : null;

    const data = {
      temp,
      unit: units === 'imperial' ? '°F' : '°C',
      code,
      label: weatherLabel(code),
      icon: weatherIcon(code),
    };

    weatherCache.set(cacheKey, { data, cachedAt: Date.now() });
    return reply.send(data);
  });

  // ── GET /content/folders?workspaceId= ────────────────────────────────────
  app.get('/folders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const folders = await db.query.contentFolders.findMany({
      where: eq(contentFolders.workspaceId, workspaceId),
      orderBy: [asc(contentFolders.position), asc(contentFolders.name)],
    });

    return reply.send(folders);
  });

  // ── POST /content/folders ────────────────────────────────────────────────
  app.post('/folders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; parentId?: string | null };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [folder] = await db.insert(contentFolders).values({
      workspaceId: body.workspaceId,
      name: body.name.trim(),
      parentId: body.parentId ?? null,
    }).returning();

    return reply.status(201).send(folder);
  });

  // ── PATCH /content/folders/:id ───────────────────────────────────────────
  app.patch('/folders/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; parentId?: string | null };

    const folder = await db.query.contentFolders.findFirst({ where: eq(contentFolders.id, id) });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    const member = await checkWorkspaceAccess(folder.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(contentFolders).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.parentId !== undefined && { parentId: body.parentId }),
      updatedAt: new Date(),
    }).where(eq(contentFolders.id, id)).returning();

    return reply.send(updated);
  });

  // ── DELETE /content/folders/:id ──────────────────────────────────────────
  app.delete('/folders/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const folder = await db.query.contentFolders.findFirst({ where: eq(contentFolders.id, id) });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    const member = await checkWorkspaceAccess(folder.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    await db.update(contentFolders)
      .set({ parentId: folder.parentId, updatedAt: new Date() })
      .where(eq(contentFolders.parentId, id));

    await db.update(contentItems)
      .set({ folderId: folder.parentId ?? null, updatedAt: new Date() })
      .where(eq(contentItems.folderId, id));

    await db.delete(contentFolders).where(eq(contentFolders.id, id));
    return reply.send({ success: true });
  });

  // ── POST /content/move-to-folder ─────────────────────────────────────────
  app.post('/move-to-folder', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; contentIds?: string[]; folderId?: string | null };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.contentIds || body.contentIds.length === 0) return reply.status(400).send({ error: 'contentIds required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    if (body.folderId) {
      const folder = await db.query.contentFolders.findFirst({
        where: and(eq(contentFolders.id, body.folderId), eq(contentFolders.workspaceId, body.workspaceId)),
      });
      if (!folder) return reply.status(404).send({ error: 'Folder not found' });
    }

    await db.update(contentItems)
      .set({ folderId: body.folderId ?? null, updatedAt: new Date() })
      .where(and(eq(contentItems.workspaceId, body.workspaceId), inArray(contentItems.id, body.contentIds), isNull(contentItems.deletedAt)));

    return reply.send({ success: true, count: body.contentIds.length });
  });

  // ── GET /content?workspaceId=&q=&type=&status=&sort=&order=&page=&limit= ──
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const q = req.query as Record<string, string>;
    const wsId = q['workspaceId'];
    if (!wsId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const limit = Math.min(Number(q['limit'] ?? 50), 200);
    const offset = (Math.max(Number(q['page'] ?? 1), 1) - 1) * limit;
    const tagIds = (q['tagIds'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const trashed = q['trashed'] === 'true';

    // Build filters
    const conditions: ReturnType<typeof and>[] = [
      eq(contentItems.workspaceId, wsId),
      trashed ? isNotNull(contentItems.deletedAt) : isNull(contentItems.deletedAt),
    ] as ReturnType<typeof and>[];

    if (tagIds.length > 0) {
      const matchingIds = await getEntityIdsForTags(wsId, 'content', tagIds);
      if (matchingIds.length === 0) {
        return reply.send({ items: [], total: 0, page: Number(q['page'] ?? 1), limit });
      }
      conditions.push(inArray(contentItems.id, matchingIds) as ReturnType<typeof and>);
    }

    if (q['q']) {
      conditions.push(ilike(contentItems.name, `%${q['q']}%`));
    }
    if (q['type']) {
      const types = q['type'].split(',').map((t) => t.trim());
      conditions.push(inArray(contentItems.type, types) as ReturnType<typeof and>);
    }
    if (q['status']) {
      conditions.push(eq(contentItems.status, q['status']));
    }
    if (q['folderId']) {
      if (q['folderId'] === 'root') conditions.push(isNull(contentItems.folderId));
      else conditions.push(eq(contentItems.folderId, q['folderId']));
    }
    if (q['orientation']) {
      conditions.push(eq(contentItems.orientation, q['orientation']));
    }

    const sortField = q['sort'] === 'name' ? contentItems.name
      : q['sort'] === 'size' ? contentItems.fileSize
      : q['sort'] === 'updatedAt' ? contentItems.updatedAt
      : contentItems.createdAt;
    const orderDir = q['order'] === 'asc' ? sortField : desc(sortField);

    const [rows, total] = await Promise.all([
      db.select({
        ...getTableColumns(contentItems),
        playlistCount: sql<number>`(
          select count(*)::int from ${playlistItems}
          where ${playlistItems.contentId} = ${contentItems.id}
        )`.as('playlistCount'),
      }).from(contentItems)
        .where(and(...conditions))
        .orderBy(orderDir)
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(contentItems)
        .where(and(...conditions))
        .then((r) => r[0]?.count ?? 0),
    ]);

    const assignedTagMap = await getAssignedTagsForEntities(wsId, 'content', rows.map((row) => row.id));

    return reply.send({
      items: rows.map((row) => ({ ...row, assignedTags: assignedTagMap[row.id] ?? [] })),
      total,
      page: Number(q['page'] ?? 1),
      limit,
    });
  });

  // ── POST /content/upload  (multipart) ─────────────────────────────────────
  app.post('/upload', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const q = req.query as Record<string, string>;
    const wsId = q['workspaceId'];
    if (!wsId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to upload content' });

    // Determine initial approval state based on workspace settings
    const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalState = wsSettings.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    // Check storage quota
    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, user.orgId),
    });
    if (quota && quota.usedBytes >= quota.limitBytes) {
      return reply.status(507).send({ error: 'Storage quota exceeded' });
    }

    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    const mime = data.mimetype;
    const originalName = data.filename;
    const type = detectType(mime, originalName);

    // Build storage path: STORAGE_ROOT/{orgId}/{wsId}/{uuid}.ext
    const ext = path.extname(originalName) || '';
    const fileId = crypto.randomUUID();
    const relDir = path.join(user.orgId, wsId);
    const relPath = path.join(relDir, `${fileId}${ext}`);
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(STORAGE_ROOT, relPath);

    await fs.mkdir(absDir, { recursive: true });

    // Stream to disk while computing SHA-256 for duplicate detection
    let fileSize = 0;
    const hashStream = crypto.createHash('sha256');
    const writeStream = (await import('node:fs')).createWriteStream(absPath);
    for await (const chunk of data.file) {
      writeStream.write(chunk);
      hashStream.update(chunk);
      fileSize += chunk.length;
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    const fileHash = hashStream.digest('hex');

    // Reject malicious ZIPs (zip-slip / zip-bomb) before doing any DB work.
    if (type === 'html5') {
      const { validateZip } = await import('../services/zip-validation.js');
      const v = await validateZip(absPath);
      if (!v.ok) {
        await fs.unlink(absPath).catch(() => undefined);
        return reply.status(400).send({ error: `Invalid HTML5 package: ${v.error}` });
      }
    }

    // Check for duplicate within workspace
    const duplicate = await db.query.contentItems.findFirst({
      where: and(
        eq(contentItems.workspaceId, wsId),
        eq(contentItems.fileHash, fileHash),
        isNull(contentItems.deletedAt),
      ),
    });
    if (duplicate) {
      await fs.unlink(absPath).catch(() => undefined);
      return reply.status(409).send({ error: 'Duplicate file detected', conflict: duplicate });
    }

    // Content name defaults to original file name without extension
    const name = path.basename(originalName, ext);

    // Insert DB row immediately with `status: 'processing'`. Thumbnail + metadata
    // are populated asynchronously by the BullMQ worker (Step 3).
    // If Redis is unavailable we fall back to inline processing inside this request.
    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type,
      name,
      originalName,
      mimeType: mime,
      fileSize,
      fileHash,
      filePath: relPath.replace(/\\/g, '/'),
      metadata: '{}',
      status: 'processing',
      approvalState: initialApprovalState,
    }).returning();
    if (!item) {
      return reply.status(500).send({ error: 'Failed to create content row' });
    }

    const queue = getQueue<{ contentId: string }>(QUEUE_NAMES.mediaProcessing);
    if (queue) {
      // Async path — worker updates the row to `status: 'ready'` when done.
      await queue.add('process', { contentId: item.id }, {
        jobId: `process-${item.id}`,
      });
    } else {
      // Inline fallback (Redis unavailable) — keeps pre-BullMQ behaviour.
      try {
        await processContentMedia(item.id);
      } catch (err) {
        req.log.error({ err, contentId: item.id }, '[upload] inline media processing failed');
      }
    }

    // Update storage quota usage
    if (quota) {
      await db.update(orgStorageQuotas)
        .set({ usedBytes: quota.usedBytes + fileSize, updatedAt: new Date() })
        .where(eq(orgStorageQuotas.orgId, user.orgId));

      await notifyStorageThresholdCrossing({
        orgId: user.orgId,
        actorUserId: user.sub,
        previousUsedBytes: quota.usedBytes,
        nextUsedBytes: quota.usedBytes + fileSize,
        limitBytes: quota.limitBytes,
      });
    }

    return reply.status(201).send(item);
  });

  // ── POST /content/web-url ─────────────────────────────────────────────────
  app.post('/web-url', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      webUrl?: string;
      refreshInterval?: number;
    };
    const wsId = body.workspaceId;
    if (!wsId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.webUrl) return reply.status(400).send({ error: 'webUrl required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    // Validate URL
    try { new URL(body.webUrl); } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to upload content' });

    // Determine initial approval state based on workspace settings
    const wsRowWeb = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettingsWeb: { approvalRequired?: boolean } = {};
    try { wsSettingsWeb = JSON.parse(wsRowWeb?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalStateWeb = wsSettingsWeb.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type: 'web_url',
      name: body.name.trim(),
      webUrl: body.webUrl,
      refreshInterval: body.refreshInterval ?? 3600,
      status: 'ready',
      approvalState: initialApprovalStateWeb,
    }).returning();

    return reply.status(201).send(item);
  });

  // ── POST /content/zone-layout ─────────────────────────────────────────────
  app.post('/zone-layout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      zones?: unknown[];
    };
    const wsId = body.workspaceId;
    if (!wsId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!Array.isArray(body.zones) || body.zones.length === 0) return reply.status(400).send({ error: 'zones required' });

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    // Determine initial approval state based on workspace settings
    const wsRowZl = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettingsZl: { approvalRequired?: boolean } = {};
    try { wsSettingsZl = JSON.parse(wsRowZl?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalStateZl = wsSettingsZl.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type: 'zone_layout',
      name: body.name.trim(),
      metadata: JSON.stringify({ zones: body.zones }),
      status: 'ready',
      approvalState: initialApprovalStateZl,
    }).returning();

    return reply.status(201).send(item);
  });

  // ── POST /content/calendar ───────────────────────────────────────────────
  app.post('/calendar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      connectionId?: string;
      view?: 'day' | 'week' | 'month' | 'meeting_room';
      selectedCalendarIds?: string[];
      keywordFilter?: string | null;
      privacyMode?: 'titles' | 'busy_only';
      timezone?: string;
      theme?: Record<string, unknown>;
      renderMode?: 'native' | 'image';
      refreshSeconds?: number;
      roomMeta?: { name?: string; capacity?: number; location?: string; bookingUrl?: string; backgroundUrl?: string; logoUrl?: string } | null;
      duration?: number;
    };

    const wsId = body.workspaceId;
    if (!wsId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.connectionId) return reply.status(400).send({ error: 'connectionId required' });

    const view = body.view ?? 'week';
    if (!['day', 'week', 'month', 'meeting_room'].includes(view)) {
      return reply.status(400).send({ error: 'Invalid view' });
    }

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const wsRowCal = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettingsCal: { approvalRequired?: boolean } = {};
    try { wsSettingsCal = JSON.parse(wsRowCal?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalStateCal = wsSettingsCal.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const metadata = JSON.stringify({
      connectionId: body.connectionId,
      view,
      selectedCalendarIds: body.selectedCalendarIds ?? [],
      keywordFilter: body.keywordFilter ?? null,
      privacyMode: body.privacyMode ?? 'titles',
      timezone: body.timezone ?? 'UTC',
      theme: body.theme ?? {},
      renderMode: body.renderMode ?? 'native',
      refreshSeconds: body.refreshSeconds ?? 60,
      roomMeta: body.roomMeta ?? null,
    });

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type: 'calendar',
      name: body.name.trim(),
      duration: body.duration ?? 30,
      status: 'ready',
      approvalState: initialApprovalStateCal,
      metadata,
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/calendar ─────────────────────────────────────────
  app.patch('/:id/calendar', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const patch = req.body as Record<string, unknown>;

    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) });
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'calendar') return reply.status(400).send({ error: 'Not a calendar content item' });
    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
    const allowed = [
      'connectionId', 'view', 'selectedCalendarIds', 'keywordFilter', 'privacyMode',
      'timezone', 'theme', 'renderMode', 'refreshSeconds', 'roomMeta',
    ] as const;
    for (const k of allowed) {
      if (k in patch) meta[k] = patch[k as keyof typeof patch];
    }

    const updates: Record<string, unknown> = { metadata: JSON.stringify(meta) };
    if (typeof patch['name'] === 'string' && (patch['name'] as string).trim()) {
      updates['name'] = (patch['name'] as string).trim();
    }
    if (typeof patch['duration'] === 'number') updates['duration'] = patch['duration'];

    const [updated] = await db.update(contentItems)
      .set(updates as never)
      .where(eq(contentItems.id, id))
      .returning();

    // Invalidate the live-push broker so any devices currently subscribed to
    // this calendar receive the new metadata (view / privacy / filters /
    // calendar selection) on the next push instead of waiting a full poll.
    try {
      const broker = await import('../services/calendar-broker.js');
      broker.invalidate(id);
    } catch { /* broker not loaded — ignore */ }

    return reply.send(updated);
  });

  // ── GET /content/:id/calendar/events?from=&to= ──────────────────────────
  app.get('/:id/calendar/events', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string };

    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, id) });
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'calendar') return reply.status(400).send({ error: 'Not a calendar content item' });
    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    let meta: {
      connectionId?: string;
      selectedCalendarIds?: string[];
      keywordFilter?: string | null;
      privacyMode?: 'titles' | 'busy_only';
    } = {};
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

    try {
      const events = await listEventsForConnection(conn, {
        from: fromD, to: toD,
        calendarIds: meta.selectedCalendarIds,
        keyword: meta.keywordFilter ?? undefined,
      });
      const safe = (meta.privacyMode === 'busy_only')
        ? events.map((e) => ({
            ...e, title: 'Busy', location: null, description: null,
            organizerEmail: null, organizerName: null, attendeeCount: null,
          }))
        : events;
      return reply.send({ events: safe });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(502).send({ error: 'Provider error', detail: msg });
    }
  });

  // ── POST /content/menu-board ──────────────────────────────────────────────
  app.post('/menu-board', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      posWorkspaceId?: string;
      layout?: string;
      showPrices?: boolean;
      showImages?: boolean;
      showDescription?: boolean;
      categoryIds?: string[];
      fontScale?: number;
      accentColor?: string;
      duration?: number;
    };

    const wsId = body.workspaceId;
    if (!wsId)                  return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim())     return reply.status(400).send({ error: 'name required' });
    if (!body.posWorkspaceId)   return reply.status(400).send({ error: 'posWorkspaceId required' });

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const wsRowMb = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettingsMb: { approvalRequired?: boolean } = {};
    try { wsSettingsMb = JSON.parse(wsRowMb?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalStateMb = wsSettingsMb.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const metadata = JSON.stringify({
      posWorkspaceId:  body.posWorkspaceId,
      layout:          body.layout ?? '2-col',
      showPrices:      body.showPrices    ?? true,
      showImages:      body.showImages    ?? true,
      showDescription: body.showDescription ?? false,
      categoryIds:     body.categoryIds   ?? [],
      fontScale:       body.fontScale     ?? 1,
      accentColor:     body.accentColor   ?? null,
    });

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy:  user.sub,
      type:        'menu_board',
      name:        body.name.trim(),
      duration:    body.duration ?? 30,
      status:      'ready',
      approvalState: initialApprovalStateMb,
      metadata,
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/menu-board ─────────────────────────────────────────
  app.patch('/:id/menu-board', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      posWorkspaceId?: string;
      layout?: string;
      showPrices?: boolean;
      showImages?: boolean;
      showDescription?: boolean;
      categoryIds?: string[];
      fontScale?: number;
      accentColor?: string;
      duration?: number;
    };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'menu_board') return reply.status(400).send({ error: 'Not a menu board' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const current = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })();
    const updated = {
      posWorkspaceId:  body.posWorkspaceId  ?? current.posWorkspaceId,
      layout:          body.layout          ?? current.layout,
      showPrices:      body.showPrices      ?? current.showPrices,
      showImages:      body.showImages      ?? current.showImages,
      showDescription: body.showDescription ?? current.showDescription,
      categoryIds:     body.categoryIds     ?? current.categoryIds,
      fontScale:       body.fontScale       ?? current.fontScale,
      accentColor:     body.accentColor     ?? current.accentColor,
    };

    const [patched] = await db.update(contentItems)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.duration != null ? { duration: body.duration } : {}),
        metadata: JSON.stringify(updated),
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(patched);
  });

  // ── POST /content/channel-group ───────────────────────────────────────────
  // Create an IPTV channel group. Channels are stored entirely in the
  // `metadata` JSON column — no schema migration required.
  app.post('/channel-group', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = CreateChannelGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    const { workspaceId: wsId, name, description, folderId, channels, defaultChannelNumber } = parsed.data;

    // Verify metadata invariants (unique numbers, default exists).
    const metaCheck = ChannelGroupMetadataSchema.safeParse({ channels, defaultChannelNumber });
    if (!metaCheck.success) {
      return reply.status(400).send({ error: 'Invalid channel group', issues: metaCheck.error.issues });
    }

    const member = await checkWorkspaceAccess(wsId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to upload content' });

    const wsRowCg = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId), columns: { settings: true } });
    let wsSettingsCg: { approvalRequired?: boolean } = {};
    try { wsSettingsCg = JSON.parse(wsRowCg?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalStateCg = wsSettingsCg.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type: 'channel_group',
      name: name.trim(),
      description: description ?? null,
      folderId: folderId ?? null,
      metadata: JSON.stringify({ channels, defaultChannelNumber }),
      status: 'ready',
      approvalState: initialApprovalStateCg,
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/channel-group ──────────────────────────────────────
  app.patch('/:id/channel-group', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = UpdateChannelGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    const body = parsed.data;

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'channel_group') return reply.status(400).send({ error: 'Not a channel group' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const current = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })() as {
      channels?: unknown; defaultChannelNumber?: number;
    };
    const nextChannels = body.channels ?? (Array.isArray(current.channels) ? current.channels : []);
    const nextDefault = body.defaultChannelNumber ?? current.defaultChannelNumber ?? 1;

    const metaCheck = ChannelGroupMetadataSchema.safeParse({
      channels: nextChannels,
      defaultChannelNumber: nextDefault,
    });
    if (!metaCheck.success) {
      return reply.status(400).send({ error: 'Invalid channel group', issues: metaCheck.error.issues });
    }

    const [patched] = await db.update(contentItems)
      .set({
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        metadata: JSON.stringify(metaCheck.data),
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(patched);
  });

  // ── POST /content/channel-group/import-m3u ────────────────────────────────
  // Pure-parse endpoint: takes an M3U body and returns proposed channels for
  // the dashboard to preview. Does NOT persist anything.
  app.post('/channel-group/import-m3u', { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = ImportM3USchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    const channels = parseM3U(parsed.data.text);
    if (channels.length === 0) {
      return reply.status(400).send({ error: 'No playable channels found in M3U body' });
    }
    return reply.send({ channels, defaultChannelNumber: channels[0]!.number });
  });

  // ── GET /content/:id ──────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Enrich with user display names
    const [uploaderRow, reviewerRow] = await Promise.all([
      item.uploadedBy
        ? db.query.users.findFirst({ where: eq(users.id, item.uploadedBy), columns: { name: true } })
        : null,
      item.reviewedBy
        ? db.query.users.findFirst({ where: eq(users.id, item.reviewedBy), columns: { name: true } })
        : null,
    ]);

    const assignedTagMap = await getAssignedTagsForEntities(item.workspaceId, 'content', [item.id]);

    return reply.send({
      ...item,
      assignedTags: assignedTagMap[item.id] ?? [],
      uploaderName: uploaderRow?.name ?? null,
      reviewerName: reviewerRow?.name ?? null,
    });
  });

  // ── PATCH /content/:id ────────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      duration?: number;
      orientation?: string;
      validFrom?: string | null;
      validUntil?: string | null;
      folderId?: string | null;
      zones?: unknown[];
    };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(contentItems).set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.duration !== undefined && { duration: body.duration }),
      ...(body.orientation !== undefined && { orientation: body.orientation }),
      ...(body.validFrom !== undefined && { validFrom: body.validFrom ? new Date(body.validFrom) : null }),
      ...(body.validUntil !== undefined && { validUntil: body.validUntil ? new Date(body.validUntil) : null }),
      ...(body.folderId !== undefined && { folderId: body.folderId }),
      ...(body.zones !== undefined && item.type === 'zone_layout' && { metadata: JSON.stringify({ zones: body.zones }) }),
      updatedAt: new Date(),
    })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /content/:id ───────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    // Soft delete
    await db.update(contentItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(contentItems.id, id));

    // Decrement quota usage
    if (item.fileSize) {
      const quota = await db.query.orgStorageQuotas.findFirst({
        where: eq(orgStorageQuotas.orgId, user.orgId),
      });
      if (quota) {
        await db.update(orgStorageQuotas)
          .set({ usedBytes: Math.max(0, quota.usedBytes - item.fileSize), updatedAt: new Date() })
          .where(eq(orgStorageQuotas.orgId, user.orgId));
      }
    }

    return reply.status(204).send();
  });
  // ── POST /content/:id/submit-review ────────────────────────────────────────
  app.post('/:id/submit-review', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    if (item.approvalState !== 'draft' && item.approvalState !== 'rejected') {
      return reply.status(400).send({ error: 'Content must be in draft or rejected state to submit for review' });
    }

    const [updated] = await db.update(contentItems)
      .set({ approvalState: 'pending_review', updatedAt: new Date() })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── POST /content/:id/approve ─────────────────────────────────────────────
  app.post('/:id/approve', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!APPROVE_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Only managers and above can approve content' });
    }

    // Check designated reviewer list (prime_owner / owner always bypass)
    if (!['prime_owner', 'owner'].includes(user.role)) {
      const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, item.workspaceId), columns: { settings: true } });
      let wsSettings: { approvalReviewers?: string[] } = {};
      try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
      if (wsSettings.approvalReviewers && wsSettings.approvalReviewers.length > 0
          && !wsSettings.approvalReviewers.includes(user.sub)) {
        return reply.status(403).send({ error: 'You are not a designated approver for this workspace' });
      }
    }

    const [updated] = await db.update(contentItems)
      .set({ approvalState: 'approved', reviewedBy: user.sub, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(contentItems.id, id))
      .returning();

    void dispatchWebhookEvent(user.orgId, 'content.published', {
      contentId: id,
      contentName: item.name,
      contentType: item.type,
      workspaceId: item.workspaceId,
    });

    return reply.send(updated);
  });

  // ── POST /content/:id/reject ──────────────────────────────────────────────
  app.post('/:id/reject', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { note?: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!APPROVE_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Only managers and above can reject content' });
    }

    // Check designated reviewer list (prime_owner / owner always bypass)
    if (!['prime_owner', 'owner'].includes(user.role)) {
      const wsRowReject = await db.query.workspaces.findFirst({ where: eq(workspaces.id, item.workspaceId), columns: { settings: true } });
      let wsSettingsReject: { approvalReviewers?: string[] } = {};
      try { wsSettingsReject = JSON.parse(wsRowReject?.settings ?? '{}'); } catch { /* ignore */ }
      if (wsSettingsReject.approvalReviewers && wsSettingsReject.approvalReviewers.length > 0
          && !wsSettingsReject.approvalReviewers.includes(user.sub)) {
        return reply.status(403).send({ error: 'You are not a designated approver for this workspace' });
      }
    }

    const [updated] = await db.update(contentItems)
      .set({
        approvalState: 'rejected',
        reviewNote: body.note ?? null,
        reviewedBy: user.sub,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── POST /content/:id/duplicate ───────────────────────────────────────────
  app.post('/:id/duplicate', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    // Create new record pointing to same files (no re-upload)
    const { id: _id, createdAt: _ca, updatedAt: _ua, deletedAt: _da,
            reviewedBy: _rb, reviewedAt: _ra, reviewNote: _rn, ...rest } = item;
    const [newItem] = await db.insert(contentItems).values({
      ...rest,
      name: `${item.name} (copy)`,
      uploadedBy: user.sub,
      approvalState: 'approved',
    }).returning();

    if (newItem) await cloneEntityTags(item.workspaceId, 'content', item.id, newItem.id);

    return reply.status(201).send(newItem);
  });

  // ── POST /content/:id/regenerate-thumbnail  (for existing items) ─────────
  app.post('/:id/regenerate-thumbnail', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (item.type !== 'image' && item.type !== 'video' && item.type !== 'pdf' && item.type !== 'presentation' && item.type !== 'html5') {
      return reply.status(400).send({ error: 'Thumbnails only supported for image/video/pdf/presentation/html5' });
    }

    const absPath = path.resolve(STORAGE_ROOT, item.filePath);
    const thumbRel = item.filePath.replace(/(\.[^.]+)?$/, '_thumb.jpg');
    const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);

    try {
      await fs.access(absPath);
    } catch {
      return reply.status(404).send({ error: 'Source file not found on disk' });
    }

    try {
      if (item.type === 'image') {
        await generateImageThumb(absPath, thumbAbs);
      } else if (item.type === 'video') {
        await generateVideoThumb(absPath, thumbAbs);
      } else if (item.type === 'pdf') {
        await generatePdfThumb(absPath, thumbAbs);
      } else if (item.type === 'presentation') {
        await generatePresentationThumb(absPath, thumbAbs);
      } else if (item.type === 'html5') {
        await generateHtml5Thumb(absPath, thumbAbs);
      }
    } catch (e) {
      await db.update(contentItems)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(contentItems.id, id));

      await notifyContentFailed({
        orgId: user.orgId,
        userId: item.uploadedBy,
        contentId: item.id,
        contentName: item.name,
        reason: 'Thumbnail generation failed',
      });

      return reply.status(500).send({ error: 'Thumbnail generation failed', detail: String(e) });
    }

    const [updated] = await db.update(contentItems)
      .set({ thumbnailPath: thumbRel.replace(/\\/g, '/'), updatedAt: new Date() })
      .where(eq(contentItems.id, id))
      .returning();

    return reply.send(updated);
  });
  // ── GET /content/:id/thumbnail ──────────────────────────────────────────
  // Serves the thumbnail JPEG if one was generated, otherwise falls back to
  // the original file for images (as its own thumbnail).
  app.get('/:id/thumbnail', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) {
      if (process.env['NODE_ENV'] !== 'production') req.log.warn({ contentId: id }, '[thumb] item not found in DB');
      return reply.status(404).send({ error: 'Not found' });
    }

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Use dedicated thumbnail first, fall back to original for images
    const servePath = item.thumbnailPath ?? (item.type === 'image' ? item.filePath : null);
    if (!servePath) {
      if (process.env['NODE_ENV'] !== 'production') req.log.warn({ contentId: id, type: item.type, thumbnailPath: item.thumbnailPath, filePath: item.filePath }, '[thumb] no servePath (no thumbnail and not an image)');
      return reply.status(404).send({ error: 'No thumbnail available' });
    }

    const absPath = path.resolve(STORAGE_ROOT, servePath);
    try { await fs.access(absPath); } catch {
      if (process.env['NODE_ENV'] !== 'production') req.log.warn({ contentId: id, servePath, absPath, storageRoot: STORAGE_ROOT }, '[thumb] file not found on disk');
      return reply.status(404).send({ error: 'Thumbnail not found on disk' });
    }

    const stat = await fs.stat(absPath);
    reply.header('Content-Type', item.thumbnailPath ? 'image/jpeg' : (item.mimeType ?? 'application/octet-stream'));
    reply.header('Content-Length', stat.size);
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(absPath));
  });

  // ── GET /content/:id/file  (stream file) ─────────────────────────────────
  app.get('/:id/file', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const absPath = path.resolve(STORAGE_ROOT, item.filePath);
    try {
      await fs.access(absPath);
    } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    const stat = await fs.stat(absPath);
    reply.header('Content-Type', item.mimeType ?? 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    reply.header('Content-Disposition', `inline; filename="${item.originalName ?? id}"`);
    return reply.send(createReadStream(absPath));
  });

  // ── DELETE /content/bulk ─────────────────────────────────────────────────
  app.delete('/bulk', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; contentIds?: string[] };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.contentIds || body.contentIds.length === 0) return reply.status(400).send({ error: 'contentIds required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    // Load items to calculate quota decrement
    const toDelete = await db.select({ id: contentItems.id, fileSize: contentItems.fileSize })
      .from(contentItems)
      .where(and(
        eq(contentItems.workspaceId, body.workspaceId),
        inArray(contentItems.id, body.contentIds),
        isNull(contentItems.deletedAt),
      ));

    if (toDelete.length === 0) return reply.send({ deleted: 0 });

    await db.update(contentItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(contentItems.workspaceId, body.workspaceId),
        inArray(contentItems.id, toDelete.map((i) => i.id)),
      ));

    const totalFreed = toDelete.reduce((sum, i) => sum + (i.fileSize ?? 0), 0);
    if (totalFreed > 0) {
      const quota = await db.query.orgStorageQuotas.findFirst({ where: eq(orgStorageQuotas.orgId, user.orgId) });
      if (quota) {
        await db.update(orgStorageQuotas)
          .set({ usedBytes: Math.max(0, quota.usedBytes - totalFreed), updatedAt: new Date() })
          .where(eq(orgStorageQuotas.orgId, user.orgId));
      }
    }

    return reply.send({ deleted: toDelete.length });
  });

  // ── POST /content/bulk-approve ──────────────────────────────────────────
  app.post('/bulk-approve', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; contentIds?: string[] };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.contentIds || body.contentIds.length === 0) return reply.status(400).send({ error: 'contentIds required' });
    if (!APPROVE_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to approve content' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(contentItems)
      .set({ approvalState: 'approved', reviewedBy: user.sub, reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(contentItems.workspaceId, body.workspaceId),
        inArray(contentItems.id, body.contentIds),
        isNull(contentItems.deletedAt),
      ));

    return reply.send({ approved: body.contentIds.length });
  });

  // ── POST /content/bulk-reject ───────────────────────────────────────────
  app.post('/bulk-reject', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; contentIds?: string[]; note?: string };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.contentIds || body.contentIds.length === 0) return reply.status(400).send({ error: 'contentIds required' });
    if (!APPROVE_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to reject content' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(contentItems)
      .set({
        approvalState: 'rejected',
        reviewNote: body.note ?? null,
        reviewedBy: user.sub,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(contentItems.workspaceId, body.workspaceId),
        inArray(contentItems.id, body.contentIds),
        isNull(contentItems.deletedAt),
      ));

    return reply.send({ rejected: body.contentIds.length });
  });

  // ── POST /content/:id/restore ────────────────────────────────────────────
  app.post('/:id/restore', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNotNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Trashed item not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [restored] = await db.update(contentItems)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(contentItems.id, id))
      .returning();

    // Re-credit quota if file still exists on disk
    if (item.fileSize && item.filePath) {
      const absPath = path.resolve(STORAGE_ROOT, item.filePath);
      const fileExists = await fs.access(absPath).then(() => true).catch(() => false);
      if (fileExists) {
        const quota = await db.query.orgStorageQuotas.findFirst({ where: eq(orgStorageQuotas.orgId, user.orgId) });
        if (quota) {
          await db.update(orgStorageQuotas)
            .set({ usedBytes: quota.usedBytes + item.fileSize, updatedAt: new Date() })
            .where(eq(orgStorageQuotas.orgId, user.orgId));
        }
      }
    }

    return reply.send(restored);
  });

  // ── PUT /content/folders/reorder ─────────────────────────────────────────
  app.put('/folders/reorder', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; items?: Array<{ id: string; position: number }> };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!Array.isArray(body.items) || body.items.length === 0) return reply.status(400).send({ error: 'items required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    await Promise.all(
      body.items.map(({ id, position }) =>
        db.update(contentFolders)
          .set({ position, updatedAt: new Date() })
          .where(and(eq(contentFolders.id, id), eq(contentFolders.workspaceId, body.workspaceId!))),
      ),
    );

    return reply.send({ success: true });
  });

  // ── GET /content/:id/usage ───────────────────────────────────────────────
  app.get('/:id/usage', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [playlistRows, scheduleRows, deviceRows] = await Promise.all([
      db.select({
        playlistItemId: playlistItems.id,
        playlistId: playlistItems.playlistId,
        position: playlistItems.position,
      }).from(playlistItems).where(eq(playlistItems.contentId, id)),

      db.select({
        slotId: scheduleSlots.id,
        scheduleId: scheduleSlots.scheduleId,
        daysOfWeek: scheduleSlots.daysOfWeek,
        startTime: scheduleSlots.startTime,
        endTime: scheduleSlots.endTime,
      }).from(scheduleSlots).where(eq(scheduleSlots.contentId, id)),

      db.select({
        deviceId: devices.id,
        deviceName: devices.name,
      }).from(devices).where(eq(devices.publishedContentId, id)),
    ]);

    return reply.send({
      playlists: playlistRows,
      schedules: scheduleRows,
      devices: deviceRows,
    });
  });

  // ── POST /content/:id/validate-html5 ────────────────────────────────────
  app.post('/:id/validate-html5', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Not found' });
    if (item.type !== 'html5') return reply.status(400).send({ error: 'Content is not HTML5 type' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const absPath = path.resolve(STORAGE_ROOT, item.filePath);
    try { await fs.access(absPath); } catch {
      return reply.status(404).send({ error: 'File not found on disk' });
    }

    // Parse ZIP local file headers to extract filenames
    const MAX_READ = 4 * 1024 * 1024; // 4 MB
    const stat = await fs.stat(absPath);
    const readSize = Math.min(stat.size, MAX_READ);
    const fd = await fs.open(absPath, 'r');
    const buf = Buffer.allocUnsafe(readSize);
    await fd.read(buf, 0, readSize, 0);
    await fd.close();

    const LOCAL_HEADER_SIG = 0x04034b50;
    const filenames: string[] = [];
    let offset = 0;
    while (offset + 30 <= buf.length) {
      const sig = buf.readUInt32LE(offset);
      if (sig !== LOCAL_HEADER_SIG) {
        offset++;
        continue;
      }
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const nameEnd = offset + 30 + nameLen;
      if (nameEnd > buf.length) break;
      const filename = buf.subarray(offset + 30, nameEnd).toString('utf8');
      filenames.push(filename);
      offset = nameEnd + extraLen;
    }

    if (filenames.length === 0) {
      return reply.send({ valid: false, reason: 'Could not read ZIP contents — file may be corrupt or too large' });
    }

    const hasRootIndex = filenames.some((f) => f === 'index.html' || f === './index.html');
    if (!hasRootIndex) {
      return reply.send({ valid: false, reason: 'index.html not found at the root of the ZIP archive', files: filenames });
    }

    return reply.send({ valid: true, files: filenames });
  });

  // ── HTML5 editor — file CRUD inside a content ZIP ────────────────────────
  // All routes share the same auth + workspace check + reload pattern.
  // After any mutation we delete the on-disk extraction cache so the device
  // route (devices.ts) re-extracts on next request.
  {
    const ALLOWED_EXTS = new Set([
      '.html', '.htm', '.css', '.js', '.mjs', '.json',
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
      '.woff', '.woff2', '.ttf', '.txt', '.mp4', '.webm', '.mp3',
    ]);
    const TEXT_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);
    const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file in editor

    /** Reject path traversal / absolute paths. Returns the normalised POSIX path. */
    function safeZipPath(p: string): string | null {
      if (!p || typeof p !== 'string') return null;
      const norm = path.posix.normalize(p.replace(/\\/g, '/').replace(/^\/+/, ''));
      if (norm.startsWith('..') || norm.includes('/../') || norm.includes('\0')) return null;
      const ext = path.extname(norm).toLowerCase();
      if (ext && !ALLOWED_EXTS.has(ext)) return null;
      return norm;
    }

    async function loadHtml5Item(id: string, userId: string): Promise<
      | { error: 404 | 403 }
      | { item: typeof contentItems.$inferSelect & { filePath: string } }
    > {
      const item = await db.query.contentItems.findFirst({
        where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
      });
      if (!item || !item.filePath || item.type !== 'html5') return { error: 404 as const };
      const member = await checkWorkspaceAccess(item.workspaceId, userId);
      if (!member) return { error: 403 as const };
      if (!UPLOAD_ROLES.has((await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, item.workspaceId), eq(workspaceMembers.userId, userId)),
      }))?.role ?? '')) {
        // role check via workspace member already covered above; fall through
      }
      return { item: item as typeof contentItems.$inferSelect & { filePath: string } };
    }

    async function invalidateExtraction(id: string) {
      const os = await import('node:os');
      const extractDir = path.join(os.tmpdir(), 'nexari-html5', id);
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    }

    async function loadZip(absPath: string) {
      const AdmZip = (await import('adm-zip')).default;
      return new AdmZip(absPath);
    }

    async function saveZipAndUpdateRow(itemId: string, absPath: string, zip: import('adm-zip')) {
      zip.writeZip(absPath);
      const stat = await fs.stat(absPath);
      // Re-hash so dedup detection stays accurate after edits.
      const h = crypto.createHash('sha256');
      h.update(await fs.readFile(absPath));
      await db.update(contentItems)
        .set({ fileSize: stat.size, fileHash: h.digest('hex'), updatedAt: new Date() })
        .where(eq(contentItems.id, itemId));
      await invalidateExtraction(itemId);
    }

    // GET /content/:id/html5/files — list entries
    app.get('/:id/html5/files', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      const files = zip.getEntries()
        .filter(e => !e.isDirectory)
        .map(e => {
          const ext = path.extname(e.entryName).toLowerCase();
          return {
            path: e.entryName.replace(/\\/g, '/'),
            size: (e.header as { size?: number }).size ?? 0,
            isText: TEXT_EXTS.has(ext),
          };
        });
      return reply.send({ files });
    });

    // GET /content/:id/html5/file?path= — read file as utf-8
    app.get('/:id/html5/file', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const q = req.query as { path?: string };
      const safe = safeZipPath(q.path ?? '');
      if (!safe) return reply.status(400).send({ error: 'Invalid path' });
      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });

      const ext = path.extname(safe).toLowerCase();
      if (!TEXT_EXTS.has(ext)) return reply.status(415).send({ error: 'Not a text file' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      const entry = zip.getEntry(safe);
      if (!entry) return reply.status(404).send({ error: 'File not in package' });
      const buf = entry.getData();
      if (buf.length > MAX_FILE_BYTES) return reply.status(413).send({ error: 'File too large to edit' });
      return reply.send({ path: safe, content: buf.toString('utf8') });
    });

    // PUT /content/:id/html5/file  { path, content } — update existing file
    app.put('/:id/html5/file', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const body = req.body as { path?: string; content?: string };
      const safe = safeZipPath(body.path ?? '');
      if (!safe) return reply.status(400).send({ error: 'Invalid path' });
      if (typeof body.content !== 'string') return reply.status(400).send({ error: 'content required' });
      const ext = path.extname(safe).toLowerCase();
      if (!TEXT_EXTS.has(ext)) return reply.status(415).send({ error: 'Cannot edit binary files' });
      const buf = Buffer.from(body.content, 'utf8');
      if (buf.length > MAX_FILE_BYTES) return reply.status(413).send({ error: 'File too large' });

      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });
      if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      if (!zip.getEntry(safe)) return reply.status(404).send({ error: 'File not in package' });
      zip.updateFile(safe, buf);
      await saveZipAndUpdateRow(id, absPath, zip);
      return reply.send({ ok: true, path: safe });
    });

    // POST /content/:id/html5/file  { path, content } — add new file
    app.post('/:id/html5/file', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const body = req.body as { path?: string; content?: string };
      const safe = safeZipPath(body.path ?? '');
      if (!safe) return reply.status(400).send({ error: 'Invalid path' });
      const buf = Buffer.from(body.content ?? '', 'utf8');
      if (buf.length > MAX_FILE_BYTES) return reply.status(413).send({ error: 'File too large' });

      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });
      if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      if (zip.getEntry(safe)) return reply.status(409).send({ error: 'File already exists' });
      // Cap total entry count
      if (zip.getEntries().length >= 1000) return reply.status(413).send({ error: 'Too many files in package' });
      zip.addFile(safe, buf);
      await saveZipAndUpdateRow(id, absPath, zip);
      return reply.status(201).send({ ok: true, path: safe });
    });

    // DELETE /content/:id/html5/file?path=
    app.delete('/:id/html5/file', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const q = req.query as { path?: string };
      const safe = safeZipPath(q.path ?? '');
      if (!safe) return reply.status(400).send({ error: 'Invalid path' });
      if (safe === 'index.html') return reply.status(400).send({ error: 'Cannot delete index.html' });

      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });
      if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      if (!zip.getEntry(safe)) return reply.status(404).send({ error: 'File not in package' });
      zip.deleteFile(safe);
      await saveZipAndUpdateRow(id, absPath, zip);
      return reply.send({ ok: true });
    });

    // POST /content/:id/html5/rename-file  { from, to }
    app.post('/:id/html5/rename-file', { onRequest: [app.authenticate] }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const body = req.body as { from?: string; to?: string };
      const fromSafe = safeZipPath(body.from ?? '');
      const toSafe = safeZipPath(body.to ?? '');
      if (!fromSafe || !toSafe) return reply.status(400).send({ error: 'Invalid path' });
      if (fromSafe === toSafe) return reply.send({ ok: true, path: toSafe });

      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });
      if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      const entry = zip.getEntry(fromSafe);
      if (!entry) return reply.status(404).send({ error: 'Source file not in package' });
      if (zip.getEntry(toSafe)) return reply.status(409).send({ error: 'Destination already exists' });
      const data = entry.getData();
      zip.deleteFile(fromSafe);
      zip.addFile(toSafe, data);
      await saveZipAndUpdateRow(id, absPath, zip);
      return reply.send({ ok: true, from: fromSafe, to: toSafe });
    });

    // GET /content/:id/preview/* — serve extracted HTML5 package for the dashboard editor.
    // Authenticated via the same JWT cookie the rest of the dashboard uses.
    // Distinct from the device-side route which uses a single-use token.
    const PREVIEW_MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.htm':  'text/html; charset=utf-8',
      '.css':  'text/css; charset=utf-8',
      '.js':   'application/javascript; charset=utf-8',
      '.mjs':  'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg':  'image/svg+xml',
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif':  'image/gif',
      '.webp': 'image/webp',
      '.ico':  'image/x-icon',
      '.woff': 'font/woff',
      '.woff2':'font/woff2',
      '.ttf':  'font/ttf',
      '.txt':  'text/plain; charset=utf-8',
      '.mp4':  'video/mp4',
      '.webm': 'video/webm',
      '.mp3':  'audio/mpeg',
    };

    app.get('/:id/preview/*', {
      onRequest: [app.authenticate],
      // helmet adds COOP + Origin-Agent-Cluster globally via onSend.  Strip them
      // here (also via onSend) so they win over helmet — last writer wins in
      // Fastify's header map before the response is flushed.
      onSend: async (_req, reply) => {
        reply.removeHeader('Cross-Origin-Opener-Policy');
        reply.removeHeader('Origin-Agent-Cluster');
      },
    }, async (req, reply) => {
      const user = req.user as AuthUser;
      const { id } = req.params as { id: string };
      const wildcard = ((req.params as { '*'?: string })['*'] ?? '').trim();
      const r = await loadHtml5Item(id, user.sub);
      if ('error' in r) return reply.status(r.error).send({ error: r.error === 404 ? 'Not found' : 'Forbidden' });

      const safe = safeZipPath(wildcard || 'index.html');
      if (!safe) return reply.status(400).send({ error: 'Invalid path' });

      const absPath = path.resolve(STORAGE_ROOT, r.item.filePath!);
      const zip = await loadZip(absPath);
      const entry = zip.getEntry(safe);
      if (!entry) return reply.status(404).send({ error: 'Not in package' });
      const buf = entry.getData();

      const ext = path.extname(safe).toLowerCase();
      reply.header('Content-Type', PREVIEW_MIME[ext] ?? 'application/octet-stream');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'SAMEORIGIN');
      return reply.send(buf);
    });
  }

  // ── HTML5 templates ──────────────────────────────────────────────────────
  app.get('/html5/templates', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const { TEMPLATE_LIST } = await import('../services/html5-templates.js');
    return reply.send({ templates: TEMPLATE_LIST });
  });

  app.post('/html5/create', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; templateId?: string; name?: string };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.templateId) return reply.status(400).send({ error: 'templateId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const { buildTemplateZip, TEMPLATE_LIST } = await import('../services/html5-templates.js');
    const valid = TEMPLATE_LIST.find(t => t.id === body.templateId);
    if (!valid) return reply.status(400).send({ error: 'Unknown templateId' });

    let buf: Buffer;
    try {
      buf = buildTemplateZip(body.templateId as never);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to build template', detail: String(err) });
    }

    const fileId = crypto.randomUUID();
    const relDir = path.join(user.orgId, body.workspaceId);
    const relPath = path.join(relDir, `${fileId}.zip`);
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(STORAGE_ROOT, relPath);
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(absPath, buf);

    const fileHash = crypto.createHash('sha256').update(buf).digest('hex');

    const rows = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type: 'html5',
      name: body.name.trim(),
      originalName: `${body.name.trim()}.zip`,
      mimeType: 'application/zip',
      fileSize: buf.length,
      fileHash,
      filePath: relPath.replace(/\\/g, '/'),
      metadata: JSON.stringify({ template: body.templateId, startPage: 'index.html' }),
      status: 'ready',
      approvalState: 'approved',
    }).returning();

    const item = rows[0];
    if (!item) return reply.status(500).send({ error: 'Failed to create content row' });

    // Queue thumbnail generation (same as regular upload)
    const createQueue = getQueue<{ contentId: string }>(QUEUE_NAMES.mediaProcessing);
    if (createQueue) {
      await createQueue.add('process', { contentId: item.id }, { jobId: `process-${item.id}` });
    } else {
      processContentMedia(item.id).catch(err =>
        app.log.error({ err, contentId: item.id }, '[html5/create] inline media processing failed'),
      );
    }

    return reply.status(201).send(item);
  });

  // ── POST /content/import-url ─────────────────────────────────────────────
  app.post('/import-url', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; sourceUrl?: string };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.sourceUrl) return reply.status(400).send({ error: 'sourceUrl required' });

    // Validate URL — only http/https allowed
    let parsedUrl: URL;
    try { parsedUrl = new URL(body.sourceUrl); } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return reply.status(400).send({ error: 'Only http and https URLs are supported' });
    }
    // Reject private/loopback hostnames
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedHosts = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/;
    if (blockedHosts.test(hostname)) {
      return reply.status(400).send({ error: 'Private or loopback URLs are not allowed' });
    }

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions to upload content' });

    // Check quota
    const quota = await db.query.orgStorageQuotas.findFirst({ where: eq(orgStorageQuotas.orgId, user.orgId) });
    if (quota && quota.usedBytes >= quota.limitBytes) {
      return reply.status(507).send({ error: 'Storage quota exceeded' });
    }

    const response = await fetch(body.sourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) {
      return reply.status(502).send({ error: `Remote URL returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const mime = contentType.split(';')[0]!.trim();

    // Infer extension from URL path
    const urlPath = parsedUrl.pathname;
    const ext = path.extname(urlPath) || '';
    const type = detectType(mime, urlPath);

    const fileId = crypto.randomUUID();
    const relDir = path.join(user.orgId, body.workspaceId);
    const relPath = path.join(relDir, `${fileId}${ext}`);
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(STORAGE_ROOT, relPath);

    await fs.mkdir(absDir, { recursive: true });

    const MAX_IMPORT_BYTES = 500 * 1024 * 1024; // 500 MB limit
    let fileSize = 0;
    const writeStream = (await import('node:fs')).createWriteStream(absPath);
    for await (const chunk of response.body) {
      const buf = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as ArrayBufferLike);
      fileSize += buf.length;
      if (fileSize > MAX_IMPORT_BYTES) {
        writeStream.destroy();
        await fs.unlink(absPath).catch(() => undefined);
        return reply.status(413).send({ error: 'Remote file exceeds 500 MB import limit' });
      }
      writeStream.write(buf);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Generate thumbnail (best-effort)
    let thumbnailRelPath: string | undefined;
    if (type === 'image' || type === 'video') {
      const thumbRel = path.join(relDir, `${fileId}_thumb.jpg`);
      const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
      try {
        if (type === 'image') await generateImageThumb(absPath, thumbAbs);
        else await generateVideoThumb(absPath, thumbAbs);
        thumbnailRelPath = thumbRel.replace(/\\/g, '/');
      } catch { /* non-fatal */ }
    }

    const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, body.workspaceId), columns: { settings: true } });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalState = wsSettings.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type,
      name: body.name.trim(),
      originalName: path.basename(urlPath) || body.name.trim(),
      mimeType: mime,
      fileSize,
      filePath: relPath.replace(/\\/g, '/'),
      ...(thumbnailRelPath && { thumbnailPath: thumbnailRelPath }),
      status: 'ready',
      approvalState: initialApprovalState,
      metadata: JSON.stringify({ importedFrom: body.sourceUrl }),
    }).returning();

    if (quota) {
      await db.update(orgStorageQuotas)
        .set({ usedBytes: quota.usedBytes + fileSize, updatedAt: new Date() })
        .where(eq(orgStorageQuotas.orgId, user.orgId));
    }

    return reply.status(201).send(item);
  });

  // ── POST /content/widget-rss ─────────────────────────────────────────────
  app.post('/widget-rss', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; feedUrl?: string; maxItems?: number; duration?: number };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.feedUrl) return reply.status(400).send({ error: 'feedUrl required' });
    try { new URL(body.feedUrl); } catch { return reply.status(400).send({ error: 'Invalid feedUrl' }); }

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, body.workspaceId), columns: { settings: true } });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const approvalState = wsSettings.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type: 'widget',
      name: body.name.trim(),
      duration: body.duration ?? 30,
      status: 'ready',
      approvalState,
      metadata: JSON.stringify({ widgetType: 'rss', feedUrl: body.feedUrl, maxItems: body.maxItems ?? 5 }),
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/widget-rss ───────────────────────────────────────
  app.patch('/:id/widget-rss', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; feedUrl?: string; maxItems?: number; duration?: number };

    const item = await db.query.contentItems.findFirst({ where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)) });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const current = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })();
    if (current.widgetType !== 'rss') return reply.status(400).send({ error: 'Not an RSS widget' });

    if (body.feedUrl) { try { new URL(body.feedUrl); } catch { return reply.status(400).send({ error: 'Invalid feedUrl' }); } }

    const [patched] = await db.update(contentItems).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.duration !== undefined && { duration: body.duration }),
      metadata: JSON.stringify({ ...current, ...(body.feedUrl && { feedUrl: body.feedUrl }), ...(body.maxItems !== undefined && { maxItems: body.maxItems }) }),
      updatedAt: new Date(),
    }).where(eq(contentItems.id, id)).returning();

    return reply.send(patched);
  });

  // ── POST /content/widget-countdown ──────────────────────────────────────
  app.post('/widget-countdown', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; targetDate?: string; title?: string; duration?: number };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.targetDate) return reply.status(400).send({ error: 'targetDate required' });
    if (isNaN(Date.parse(body.targetDate))) return reply.status(400).send({ error: 'Invalid targetDate' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, body.workspaceId), columns: { settings: true } });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const approvalState = wsSettings.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type: 'widget',
      name: body.name.trim(),
      duration: body.duration ?? 30,
      status: 'ready',
      approvalState,
      metadata: JSON.stringify({ widgetType: 'countdown', targetDate: body.targetDate, title: body.title ?? '' }),
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/widget-countdown ─────────────────────────────────
  app.patch('/:id/widget-countdown', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; targetDate?: string; title?: string; duration?: number };

    const item = await db.query.contentItems.findFirst({ where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)) });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const current = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })();
    if (current.widgetType !== 'countdown') return reply.status(400).send({ error: 'Not a countdown widget' });

    if (body.targetDate && isNaN(Date.parse(body.targetDate))) return reply.status(400).send({ error: 'Invalid targetDate' });

    const [patched] = await db.update(contentItems).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.duration !== undefined && { duration: body.duration }),
      metadata: JSON.stringify({ ...current, ...(body.targetDate && { targetDate: body.targetDate }), ...(body.title !== undefined && { title: body.title }) }),
      updatedAt: new Date(),
    }).where(eq(contentItems.id, id)).returning();

    return reply.send(patched);
  });

  // ── POST /content/widget-json-feed ───────────────────────────────────────
  app.post('/widget-json-feed', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; feedUrl?: string; jsonPath?: string; template?: string; refreshInterval?: number; duration?: number };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.feedUrl) return reply.status(400).send({ error: 'feedUrl required' });
    try { new URL(body.feedUrl); } catch { return reply.status(400).send({ error: 'Invalid feedUrl' }); }

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const wsRow = await db.query.workspaces.findFirst({ where: eq(workspaces.id, body.workspaceId), columns: { settings: true } });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const approvalState = wsSettings.approvalRequired && !APPROVE_ROLES.has(user.role) ? 'draft' : 'approved';

    const [item] = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type: 'widget',
      name: body.name.trim(),
      duration: body.duration ?? 30,
      refreshInterval: body.refreshInterval ?? 3600,
      status: 'ready',
      approvalState,
      metadata: JSON.stringify({
        widgetType: 'json_feed',
        feedUrl: body.feedUrl,
        jsonPath: body.jsonPath ?? '$',
        template: body.template ?? '',
      }),
    }).returning();

    return reply.status(201).send(item);
  });

  // ── PATCH /content/:id/widget-json-feed ─────────────────────────────────
  app.patch('/:id/widget-json-feed', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; feedUrl?: string; jsonPath?: string; template?: string; refreshInterval?: number; duration?: number };

    const item = await db.query.contentItems.findFirst({ where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)) });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const current = (() => { try { return JSON.parse(item.metadata ?? '{}'); } catch { return {}; } })();
    if (current.widgetType !== 'json_feed') return reply.status(400).send({ error: 'Not a JSON feed widget' });

    if (body.feedUrl) { try { new URL(body.feedUrl); } catch { return reply.status(400).send({ error: 'Invalid feedUrl' }); } }

    const [patched] = await db.update(contentItems).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.duration !== undefined && { duration: body.duration }),
      ...(body.refreshInterval !== undefined && { refreshInterval: body.refreshInterval }),
      metadata: JSON.stringify({
        ...current,
        ...(body.feedUrl && { feedUrl: body.feedUrl }),
        ...(body.jsonPath !== undefined && { jsonPath: body.jsonPath }),
        ...(body.template !== undefined && { template: body.template }),
      }),
      updatedAt: new Date(),
    }).where(eq(contentItems.id, id)).returning();

    return reply.send(patched);
  });

  // ── POST /content/:id/replace  (replace file, archive old version) ───────
  app.post('/:id/replace', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    // Archive current version before replacing
    await db.insert(contentVersions).values({
      contentItemId: item.id,
      filePath: item.filePath,
      thumbnailPath: item.thumbnailPath ?? null,
      originalName: item.originalName ?? null,
      mimeType: item.mimeType ?? null,
      fileSize: item.fileSize ?? null,
      fileHash: (item as Record<string, unknown>)['fileHash'] as string ?? null,
      uploadedBy: item.uploadedBy,
    });

    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    const mime = data.mimetype;
    const originalName = data.filename;
    const type = detectType(mime, originalName);
    const ext = path.extname(originalName) || '';
    const fileId = crypto.randomUUID();
    const relDir = path.join(user.orgId, item.workspaceId);
    const relPath = path.join(relDir, `${fileId}${ext}`);
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(STORAGE_ROOT, relPath);

    await fs.mkdir(absDir, { recursive: true });

    let fileSize = 0;
    const hashStream = crypto.createHash('sha256');
    const writeStream = (await import('node:fs')).createWriteStream(absPath);
    for await (const chunk of data.file) {
      writeStream.write(chunk);
      hashStream.update(chunk);
      fileSize += chunk.length;
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    const fileHash = hashStream.digest('hex');

    // Generate thumbnail (best-effort)
    let thumbnailRelPath: string | undefined;
    if (type === 'image' || type === 'video') {
      const thumbRel = path.join(relDir, `${fileId}_thumb.jpg`);
      const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
      try {
        if (type === 'image') await generateImageThumb(absPath, thumbAbs);
        else await generateVideoThumb(absPath, thumbAbs);
        thumbnailRelPath = thumbRel.replace(/\\/g, '/');
      } catch { /* non-fatal */ }
    }

    // Update quota delta
    const sizeDelta = fileSize - (item.fileSize ?? 0);
    if (sizeDelta !== 0) {
      const quota = await db.query.orgStorageQuotas.findFirst({ where: eq(orgStorageQuotas.orgId, user.orgId) });
      if (quota) {
        await db.update(orgStorageQuotas)
          .set({ usedBytes: Math.max(0, quota.usedBytes + sizeDelta), updatedAt: new Date() })
          .where(eq(orgStorageQuotas.orgId, user.orgId));
      }
    }

    const [replaced] = await db.update(contentItems).set({
      type,
      originalName,
      mimeType: mime,
      fileSize,
      fileHash,
      filePath: relPath.replace(/\\/g, '/'),
      ...(thumbnailRelPath ? { thumbnailPath: thumbnailRelPath } : {}),
      updatedAt: new Date(),
    }).where(eq(contentItems.id, id)).returning();

    return reply.send(replaced);
  });

  // ── GET /content/:id/versions ────────────────────────────────────────────
  app.get('/:id/versions', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const versions = await db.select().from(contentVersions)
      .where(eq(contentVersions.contentItemId, id))
      .orderBy(desc(contentVersions.createdAt));

    return reply.send(versions);
  });

  // ── POST /content/:id/versions/:versionId/restore ────────────────────────
  app.post('/:id/versions/:versionId/restore', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, versionId } = req.params as { id: string; versionId: string };

    const item = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), isNull(contentItems.deletedAt)),
    });
    if (!item || !item.filePath) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(item.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!UPLOAD_ROLES.has(user.role)) return reply.status(403).send({ error: 'Insufficient permissions' });

    const version = await db.query.contentVersions.findFirst({
      where: and(eq(contentVersions.id, versionId), eq(contentVersions.contentItemId, id)),
    });
    if (!version) return reply.status(404).send({ error: 'Version not found' });

    // Verify the version file still exists on disk
    const versionAbsPath = path.resolve(STORAGE_ROOT, version.filePath);
    try { await fs.access(versionAbsPath); } catch {
      return reply.status(410).send({ error: 'Version file no longer available on disk' });
    }

    // Archive the current file as a new version before restoring
    await db.insert(contentVersions).values({
      contentItemId: item.id,
      filePath: item.filePath,
      thumbnailPath: item.thumbnailPath ?? null,
      originalName: item.originalName ?? null,
      mimeType: item.mimeType ?? null,
      fileSize: item.fileSize ?? null,
      fileHash: (item as Record<string, unknown>)['fileHash'] as string ?? null,
      uploadedBy: item.uploadedBy,
    });

    // Swap to the version's file
    const sizeDelta = (version.fileSize ?? 0) - (item.fileSize ?? 0);
    if (sizeDelta !== 0) {
      const quota = await db.query.orgStorageQuotas.findFirst({ where: eq(orgStorageQuotas.orgId, user.orgId) });
      if (quota) {
        await db.update(orgStorageQuotas)
          .set({ usedBytes: Math.max(0, quota.usedBytes + sizeDelta), updatedAt: new Date() })
          .where(eq(orgStorageQuotas.orgId, user.orgId));
      }
    }

    const [restored] = await db.update(contentItems).set({
      filePath: version.filePath,
      thumbnailPath: version.thumbnailPath,
      originalName: version.originalName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
      fileHash: version.fileHash,
      updatedAt: new Date(),
    }).where(eq(contentItems.id, id)).returning();

    // Remove the restored version entry (it's now the current)
    await db.delete(contentVersions).where(eq(contentVersions.id, versionId));

    return reply.send(restored);
  });
}
