import type { FastifyInstance } from 'fastify';
import { db, contentItems, contentFolders, playlistItems, workspaceMembers, workspaces, orgStorageQuotas, users } from '@signage/db';
import { eq, and, isNull, desc, ilike, or, sql, getTableColumns, asc, inArray } from 'drizzle-orm';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { notifyContentFailed, notifyStorageThresholdCrossing } from '../services/notifications.js';

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
async function generateImageThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  await sharp(srcAbs)
    .resize(400, 225, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbAbs);
}

/** Extract the first decodable frame of a video as a JPEG thumbnail via ffmpeg. */
async function generateVideoThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  // Try seeking to 1 second first, then fall back to the very first frame
  try {
    await execFileAsync(FFMPEG_BIN, [
      '-ss', '1', '-i', srcAbs,
      '-vframes', '1', '-s', '400x225',
      '-y', thumbAbs,
    ]);
  } catch {
    await execFileAsync(FFMPEG_BIN, [
      '-i', srcAbs,
      '-vframes', '1', '-s', '400x225',
      '-y', thumbAbs,
    ]);
  }
}

// ── Media probing ──────────────────────────────────────────────────────────────
interface VideoMeta {
  width: number | null; height: number | null; duration: number | null;
  fps: number | null; bitRate: number | null; maxBitRate: number | null;
  videoCodec: string | null; codecProfile: string | null; codecLevel: number | null;
}

async function probeVideo(absPath: string): Promise<VideoMeta> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', absPath,
    ]);
    const d = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string; codec_name?: string; profile?: string; level?: number;
        width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string;
        bit_rate?: string; max_bit_rate?: string; duration?: string;
      }>;
      format?: { duration?: string; bit_rate?: string };
    };
    const vs = d.streams?.find(s => s.codec_type === 'video');
    const fmt = d.format;
    let fps: number | null = null;
    const fpsStr = vs?.r_frame_rate ?? vs?.avg_frame_rate;
    if (fpsStr) {
      const [num, den] = fpsStr.split('/').map(Number);
      if (den && den > 0) fps = Math.round((num! / den) * 100) / 100;
    }
    return {
      width: vs?.width ?? null,
      height: vs?.height ?? null,
      duration: fmt?.duration ? parseFloat(fmt.duration) : (vs?.duration ? parseFloat(vs.duration) : null),
      fps,
      bitRate: fmt?.bit_rate ? parseInt(fmt.bit_rate, 10) : null,
      maxBitRate: vs?.max_bit_rate ? parseInt(vs.max_bit_rate, 10) : (vs?.bit_rate ? parseInt(vs.bit_rate, 10) : null),
      videoCodec: vs?.codec_name ?? null,
      codecProfile: vs?.profile ?? null,
      codecLevel: vs?.level ?? null,
    };
  } catch {
    return { width: null, height: null, duration: null, fps: null, bitRate: null, maxBitRate: null, videoCodec: null, codecProfile: null, codecLevel: null };
  }
}

async function probeImage(absPath: string): Promise<{
  width: number | null; height: number | null;
  colorSpace: string | null; hasAlpha: boolean;
  density: number | null; bitsPerSample: number | null;
  channels: number | null; format: string | null; hasProfile: boolean;
  exifOrientation: number | null;
}> {
  try {
    const meta = await sharp(absPath).metadata();
    const DEPTH_BITS: Record<string, number> = { uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32, float: 32, double: 64 };
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      colorSpace: meta.space ?? null,
      hasAlpha: meta.hasAlpha ?? false,
      density: meta.density ?? null,
      bitsPerSample: meta.depth ? (DEPTH_BITS[meta.depth] ?? null) : null,
      channels: meta.channels ?? null,
      format: meta.format ?? null,
      hasProfile: meta.icc != null,
      exifOrientation: meta.orientation ?? null,
    };
  } catch {
    return { width: null, height: null, colorSpace: null, hasAlpha: false, density: null, bitsPerSample: null, channels: null, format: null, hasProfile: false, exifOrientation: null };
  }
}

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

    // Build filters
    const conditions: ReturnType<typeof and>[] = [
      eq(contentItems.workspaceId, wsId),
      isNull(contentItems.deletedAt),
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

    const sortField = q['sort'] === 'name' ? contentItems.name
      : q['sort'] === 'size' ? contentItems.fileSize
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

    // Stream to disk
    let fileSize = 0;
    const writeStream = (await import('node:fs')).createWriteStream(absPath);
    for await (const chunk of data.file) {
      writeStream.write(chunk);
      fileSize += chunk.length;
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Content name defaults to original file name without extension
    const name = path.basename(originalName, ext);

    // Generate thumbnail (best-effort — failures are non-fatal)
    let thumbnailRelPath: string | undefined;
    if (type === 'image' || type === 'video') {
      const thumbRel = path.join(relDir, `${fileId}_thumb.jpg`);
      const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
      try {
        if (type === 'image') {
          await generateImageThumb(absPath, thumbAbs);
        } else {
          await generateVideoThumb(absPath, thumbAbs);
        }
        thumbnailRelPath = thumbRel.replace(/\\/g, '/');
      } catch {
        // Thumbnail generation failed — proceed without
      }
    }

    // Probe media metadata (best-effort)
    let probeWidth: number | null = null;
    let probeHeight: number | null = null;
    let probeDuration: number | null = null;
    let probeMetadata: Record<string, unknown> = {};

    if (type === 'video') {
      const p = await probeVideo(absPath);
      probeWidth = p.width;
      probeHeight = p.height;
      probeDuration = p.duration != null ? Math.round(p.duration) : null;
      probeMetadata = {
        fps: p.fps,
        bitRate: p.bitRate,
        maxBitRate: p.maxBitRate,
        videoCodec: p.videoCodec,
        codecProfile: p.codecProfile,
        codecLevel: p.codecLevel,
      };
    } else if (type === 'image') {
      const p = await probeImage(absPath);
      probeWidth = p.width;
      probeHeight = p.height;
      probeMetadata = {
        colorSpace: p.colorSpace,
        hasAlpha: p.hasAlpha,
        density: p.density,
        bitsPerSample: p.bitsPerSample,
        channels: p.channels,
        format: p.format,
        hasProfile: p.hasProfile,
        exifOrientation: p.exifOrientation,
      };
    }

    const [item] = await db.insert(contentItems).values({
      workspaceId: wsId,
      uploadedBy: user.sub,
      type,
      name,
      originalName,
      mimeType: mime,
      fileSize,
      filePath: relPath.replace(/\\/g, '/'),
      ...(thumbnailRelPath && { thumbnailPath: thumbnailRelPath }),
      ...(probeWidth != null && { width: probeWidth }),
      ...(probeHeight != null && { height: probeHeight }),
      ...(probeDuration != null && { duration: probeDuration }),
      metadata: JSON.stringify(probeMetadata),
      status: 'ready',
      approvalState: initialApprovalState,
    }).returning();

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
    if (item.type !== 'image' && item.type !== 'video') {
      return reply.status(400).send({ error: 'Thumbnails only supported for image/video' });
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
      } else {
        await generateVideoThumb(absPath, thumbAbs);
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
}
