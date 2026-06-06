import type { FastifyInstance } from 'fastify';
import { db, contentItems, playlists, playlistItems, schedules, scheduleSlots, workspaceMembers, workspaces, orgStorageQuotas, tagCategories, workspaceTags, tagAssignments } from '@signage/db';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { getQueue, QUEUE_NAMES } from '../queues/index.js';
import { processContentMedia, detectType } from '../services/media-processing.js';

type AuthUser = { sub: string; orgId: string; role: string };

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

const ADMIN_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'c-manager']);

async function checkWorkspaceAccess(wsId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, wsId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

/**
 * Build a fetch-compatible URL from a base URL + path.
 * Handles trailing slashes and ensures the path prefix is correct.
 */
function buildMiUrl(baseUrl: string, miPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = miPath.startsWith('/') ? miPath : `/${miPath}`;
  return `${base}${p}`;
}

/**
 * Validate that a path is a known safe MagicInfo API path.
 * Prevents SSRF to arbitrary internal URLs.
 */
function validateMiPath(miPath: string): boolean {
  return (
    miPath.startsWith('/MagicInfo/restapi/') ||
    miPath.startsWith('/restapi/')
  );
}

/**
 * Make a proxied request to MagicInfo with the api_key header.
 * Uses node fetch with SSL verification disabled for self-signed certs.
 */
async function miRequest(
  baseUrl: string,
  token: string,
  method: string,
  miPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = buildMiUrl(baseUrl, miPath);

  // Node 18+ fetch with TLS override via env — we use undici's env var
  // ALTERNATIVELY use the https module for self-signed cert support.
  // We use node:https directly to control rejectUnauthorized.
  const https = await import('node:https');
  const agent = new https.Agent({ rejectUnauthorized: false });

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'api_key': token,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // @ts-expect-error -- undici/node fetch accepts dispatcher
    dispatcher: new (await import('undici').then(m => m.Agent))({ connect: { rejectUnauthorized: false } }),
  });

  let data: unknown = null;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await response.json();
  } else if (response.ok) {
    data = await response.text();
  }

  return { ok: response.ok, status: response.status, data };
}

// ── Tag helper: find-or-create a category then find-or-create tags ────────────

async function getOrCreateTagCategory(workspaceId: string, name: string, color = '#6366f1'): Promise<string> {
  const existing = await db.query.tagCategories.findFirst({
    where: and(eq(tagCategories.workspaceId, workspaceId), eq(tagCategories.name, name)),
  });
  if (existing) return existing.id;

  const [created] = await db.insert(tagCategories).values({
    workspaceId,
    name,
    color,
    availableFor: ['content', 'playlist', 'schedule', 'device'],
  }).returning();
  return created!.id;
}

async function getOrCreateTag(workspaceId: string, categoryId: string, tagName: string): Promise<string> {
  const existing = await db.query.workspaceTags.findFirst({
    where: and(
      eq(workspaceTags.workspaceId, workspaceId),
      eq(workspaceTags.categoryId, categoryId),
      eq(workspaceTags.name, tagName),
    ),
  });
  if (existing) return existing.id;

  const [created] = await db.insert(workspaceTags).values({
    workspaceId,
    categoryId,
    name: tagName,
    color: null,
  }).returning();
  return created!.id;
}

async function assignTag(workspaceId: string, tagId: string, entityId: string, entityType: 'content' | 'playlist' | 'schedule' | 'device') {
  await db.insert(tagAssignments).values({ workspaceId, tagId, entityId, entityType }).onConflictDoNothing();
}

// ═════════════════════════════════════════════════════════════════════════════
// Routes
// ═════════════════════════════════════════════════════════════════════════════

export async function migrationRoutes(app: FastifyInstance) {

  // ── POST /migration/magicinfo/connect ─────────────────────────────────────
  // Authenticates against MagicInfo and returns the api_token.
  // Credentials are NEVER stored server-side; token is returned to the client
  // and kept in React component state only.
  app.post('/magicinfo/connect', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      baseUrl: z.string().url().max(500),
      username: z.string().min(1).max(200),
      password: z.string().min(1).max(200),
      totpCode: z.string().length(6).optional(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { baseUrl, username, password, totpCode } = body.data;
    const payload: Record<string, string> = {
      grantType: 'password',
      username,
      password,
    };
    if (totpCode) payload['totp'] = totpCode;

    try {
      const url = buildMiUrl(baseUrl, '/MagicInfo/restapi/v2.0/auth');

      const https = await import('node:https');
      const dispatcher = new (await import('undici').then(m => m.Agent))({ connect: { rejectUnauthorized: false } });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        // @ts-expect-error -- undici dispatcher
        dispatcher,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return reply.status(401).send({
          error: `MagicInfo authentication failed (HTTP ${res.status})`,
          detail: text.slice(0, 500),
        });
      }

      const data = await res.json() as Record<string, unknown>;
      const token = data['token'] as string | undefined;
      if (!token) {
        return reply.status(401).send({ error: 'MagicInfo login succeeded but no token returned' });
      }

      return reply.send({ token });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Could not reach MagicInfo server: ${msg}` });
    }
  });

  // ── POST /migration/magicinfo/proxy ───────────────────────────────────────
  // Generic proxy for MagicInfo list/detail API calls.
  // Used by the wizard's Review + Select steps to fetch devices/content/playlists/schedules.
  app.post('/magicinfo/proxy', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      baseUrl: z.string().url().max(500),
      token: z.string().min(1),
      method: z.enum(['GET', 'POST']).default('GET'),
      path: z.string().min(1).max(1000),
      body: z.unknown().optional(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { baseUrl, token, method, path: miPath, body: miBody } = body.data;

    // SSRF guard — only allow known MagicInfo API paths
    if (!validateMiPath(miPath)) {
      return reply.status(400).send({ error: 'Invalid MagicInfo path. Must start with /MagicInfo/restapi/ or /restapi/' });
    }

    try {
      const result = await miRequest(baseUrl, token, method, miPath, miBody);
      return reply.status(result.ok ? 200 : result.status).send(result.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `MagicInfo proxy error: ${msg}` });
    }
  });

  // ── POST /migration/magicinfo/download-and-upload ─────────────────────────
  // Downloads a content file from MagicInfo server-side (avoids CORS/binary
  // transfer to browser) and inserts it into the Nexari content pipeline.
  app.post('/magicinfo/download-and-upload', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = z.object({
      baseUrl: z.string().url().max(500),
      token: z.string().min(1),
      miContentId: z.string().min(1).max(200),
      fileName: z.string().min(1).max(500),
      mimeType: z.string().min(1).max(200),
      workspaceId: z.string().uuid(),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { baseUrl, token, miContentId, fileName, mimeType, workspaceId } = body.data;

    // Workspace access check
    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    if (!ADMIN_ROLES.has(user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions to upload content' });
    }

    // Storage quota check
    const quota = await db.query.orgStorageQuotas.findFirst({
      where: eq(orgStorageQuotas.orgId, user.orgId),
    });
    if (quota && quota.usedBytes >= quota.limitBytes) {
      return reply.status(507).send({ error: 'Storage quota exceeded' });
    }

    // Workspace approval setting
    const wsRow = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { settings: true },
    });
    let wsSettings: { approvalRequired?: boolean } = {};
    try { wsSettings = JSON.parse(wsRow?.settings ?? '{}'); } catch { /* ignore */ }
    const initialApprovalState = wsSettings.approvalRequired && !new Set(['prime_owner', 'owner', 'admin', 'a-manager']).has(user.role) ? 'draft' : 'approved';

    // Build download URL
    const downloadPath = `/MagicInfo/restapi/v2.0/cms/contents/${encodeURIComponent(miContentId)}/download`;
    if (!validateMiPath(downloadPath)) {
      return reply.status(400).send({ error: 'Invalid content ID' });
    }

    const downloadUrl = buildMiUrl(baseUrl, downloadPath);

    try {
      const dispatcher = new (await import('undici').then(m => m.Agent))({ connect: { rejectUnauthorized: false } });
      const res = await fetch(downloadUrl, {
        headers: { 'api_key': token, 'Accept': '*/*' },
        // @ts-expect-error -- undici dispatcher
        dispatcher,
      });

      if (!res.ok) {
        return reply.status(res.status).send({
          error: `MagicInfo download failed (HTTP ${res.status}). Ensure your MagicInfo account has admin-level permissions for content download.`,
        });
      }

      if (!res.body) {
        return reply.status(502).send({ error: 'MagicInfo returned empty response body' });
      }

      const type = detectType(mimeType, fileName);
      const ext = path.extname(fileName) || '';
      const fileId = crypto.randomUUID();
      const relDir = path.join(user.orgId, workspaceId);
      const relPath = path.join(relDir, `${fileId}${ext}`);
      const absDir = path.resolve(STORAGE_ROOT, relDir);
      const absPath = path.resolve(STORAGE_ROOT, relPath);

      await fs.mkdir(absDir, { recursive: true });

      // Stream MagicInfo response → disk + SHA-256
      let fileSize = 0;
      const hashStream = crypto.createHash('sha256');
      const writeStream = createWriteStream(absPath);

      const reader = res.body.getReader();
      await new Promise<void>((resolve, reject) => {
        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) {
              writeStream.end();
              return;
            }
            writeStream.write(value);
            hashStream.update(value);
            fileSize += value.length;
            pump();
          }).catch(reject);
        }
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        pump();
      });

      const fileHash = hashStream.digest('hex');

      // Duplicate detection within workspace
      const duplicate = await db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.workspaceId, workspaceId),
          eq(contentItems.fileHash, fileHash),
          isNull(contentItems.deletedAt),
        ),
      });
      if (duplicate) {
        await fs.unlink(absPath).catch(() => undefined);
        return reply.status(409).send({
          error: 'Duplicate file detected',
          nexariContentId: duplicate.id,
          conflict: true,
        });
      }

      const name = path.basename(fileName, ext);

      const [item] = await db.insert(contentItems).values({
        workspaceId,
        uploadedBy: user.sub,
        type,
        name,
        originalName: fileName,
        mimeType,
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
        await queue.add('process', { contentId: item.id }, { jobId: `process-${item.id}` });
      } else {
        try { await processContentMedia(item.id); } catch { /* non-fatal */ }
      }

      if (quota) {
        await db.update(orgStorageQuotas)
          .set({ usedBytes: quota.usedBytes + fileSize, updatedAt: new Date() })
          .where(eq(orgStorageQuotas.orgId, user.orgId));
      }

      return reply.status(201).send({ nexariContentId: item.id, name: item.name, type: item.type, status: item.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Download/upload failed: ${msg}` });
    }
  });

  // ── POST /migration/magicinfo/ensure-tags ─────────────────────────────────
  // Idempotently creates a tag category and set of tags, returning the tag ID map.
  // Called once before the migration batch starts.
  app.post('/magicinfo/ensure-tags', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = z.object({
      workspaceId: z.string().uuid(),
      categoryName: z.string().min(1).max(80),
      tagNames: z.array(z.string().min(1).max(80)).max(500),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { workspaceId, categoryName, tagNames } = body.data;

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const categoryId = await getOrCreateTagCategory(workspaceId, categoryName);

    const tagMap: Record<string, string> = {};
    for (const name of tagNames) {
      const tagId = await getOrCreateTag(workspaceId, categoryId, name);
      tagMap[name] = tagId;
    }

    return reply.send({ categoryId, tagMap });
  });

  // ── POST /migration/magicinfo/assign-tags ─────────────────────────────────
  // Assigns multiple tags to a single entity.
  app.post('/magicinfo/assign-tags', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;

    const body = z.object({
      workspaceId: z.string().uuid(),
      entityId: z.string().uuid(),
      entityType: z.enum(['content', 'playlist', 'schedule', 'device']),
      tagIds: z.array(z.string().uuid()).max(200),
    }).safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { workspaceId, entityId, entityType, tagIds } = body.data;

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    for (const tagId of tagIds) {
      await assignTag(workspaceId, tagId, entityId, entityType);
    }

    return reply.send({ success: true, count: tagIds.length });
  });
}
