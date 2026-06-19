import type { FastifyInstance } from 'fastify';
import { db, playerReleases, playerReleaseApprovals, devices } from '@signage/db';
import { eq, desc, and, isNull, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { sendCommand } from '../services/ws.js';
import { organizations } from '@signage/db';

const PLATFORMS = ['tizen', 'windows', 'epaper', 'android'] as const;
type ReleasePlatform = typeof PLATFORMS[number];

const PLAYER_BUILDS_ROOT = process.env['PLAYER_BUILDS_ROOT'] ?? '/var/nexari/player-builds';
const UPLOAD_SIZE_LIMIT   = 250 * 1024 * 1024; // 250 MB per file

// Allowed extensions per platform (prevent arbitrary file uploads)
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  tizen:   ['.wgt', '.xml'],
  epaper:  ['.wgt', '.xml'],
  android: ['.apk'],
  windows: ['.exe', '.yml'],
  esp32:   ['.bin'],
};

const CreateReleaseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url(),
  releaseNotes: z.string().optional(),
  platform: z.enum(PLATFORMS).default('tizen'),
  manifestUrl: z.string().url().optional(),
  sha512: z.string().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

function parsePlatform(value: unknown): ReleasePlatform {
  if (typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)) {
    return value as ReleasePlatform;
  }
  return 'tizen';
}

export async function playerReleasesRoutes(app: FastifyInstance) {
  /** Public read: any authenticated user can fetch the latest release for a platform.
   *  Returns approval status: superadminApproved + managementApproved (for this user's company). */
  app.get('/latest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const platform = parsePlatform((req.query as { platform?: string })?.platform);
    const [release] = await db
      .select()
      .from(playerReleases)
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)))
      .limit(1);

    if (!release) return reply.send(null);

    // Determine management company for the calling user (orgId → org.managementCompanyId)
    const caller = req.user as { sub: string; orgId?: string; role?: string; type?: string };
    let managementApproved = false;
    if (caller.orgId) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, caller.orgId),
        columns: { managementCompanyId: true },
      });
      if (org?.managementCompanyId) {
        const approval = await db.query.playerReleaseApprovals.findFirst({
          where: and(
            eq(playerReleaseApprovals.releaseId, release.id),
            eq(playerReleaseApprovals.managementCompanyId, org.managementCompanyId),
          ),
        });
        managementApproved = !!approval;
      } else {
        // Org not under a management company (direct platform owner org) — treat as approved
        managementApproved = true;
      }
    }

    return reply.send({
      ...release,
      superadminApproved: !!release.superadminApprovedAt,
      managementApproved,
    });
  });

  /** Superadmin: list all releases (optional ?platform=) */
  app.get('/', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const platformFilter = (req.query as { platform?: string })?.platform;
    const releases = platformFilter && (PLATFORMS as readonly string[]).includes(platformFilter)
      ? await db.select().from(playerReleases)
          .where(eq(playerReleases.platform, platformFilter))
          .orderBy(desc(playerReleases.publishedAt))
      : await db.select().from(playerReleases)
          .orderBy(desc(playerReleases.publishedAt));

    return reply.send(releases);
  });

  /** Superadmin: publish a new release (marks it as latest for its platform) */
  app.post('/', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const body = CreateReleaseSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { version, downloadUrl, releaseNotes, platform, manifestUrl, sha512, sha256, sizeBytes } = body.data;

    // Clear existing latest flag for this platform only
    await db
      .update(playerReleases)
      .set({ isLatest: false })
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)));

    const [release] = await db
      .insert(playerReleases)
      .values({
        platform, version, downloadUrl, releaseNotes,
        manifestUrl: manifestUrl ?? null,
        sha512: sha512 ?? null,
        sha256: sha256 ?? null,
        sizeBytes: sizeBytes ?? null,
        isLatest: true,
      })
      .returning();

    return reply.status(201).send(release);
  });

  /** Superadmin: delete a release */
  app.delete('/:id', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(playerReleases).where(eq(playerReleases.id, id));
    return reply.status(204).send();
  });

  // ── POST /player-releases/:id/deploy  (5-H) ──────────────────────────────
  app.post('/:id/deploy', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { workspaceId?: string; deviceIds?: string[] };

    const release = await db.query.playerReleases.findFirst({ where: eq(playerReleases.id, id) });
    if (!release) return reply.status(404).send({ error: 'Release not found' });

    // Resolve target device IDs
    let targetDevices: { id: string; platform: string }[];

    if (body.deviceIds && body.deviceIds.length > 0) {
      targetDevices = await db.query.devices.findMany({
        where: and(isNull(devices.deletedAt), inArray(devices.id, body.deviceIds)),
        columns: { id: true, platform: true },
      });
    } else if (body.workspaceId) {
      targetDevices = await db.query.devices.findMany({
        where: and(eq(devices.workspaceId, body.workspaceId), isNull(devices.deletedAt)),
        columns: { id: true, platform: true },
      });
    } else {
      targetDevices = await db.query.devices.findMany({
        where: isNull(devices.deletedAt),
        columns: { id: true, platform: true },
      });
    }

    // Only push to devices whose platform matches the release platform.
    let sent = 0;
    for (const device of targetDevices) {
      if (device.platform !== release.platform) continue;
      sendCommand(device.id, {
        type: 'update_player',
        payload: {
          version: release.version,
          downloadUrl: release.downloadUrl,
          ...(release.sha256 ? { sha256: release.sha256 } : {}),
        },
      });
      sent++;
    }

    return reply.send({ releaseId: id, version: release.version, platform: release.platform, sentToDevices: sent });
  });

  // ── POST /player-releases/:id/approve  (platform owner) ──────────────────
  app.post('/:id/approve', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [updated] = await db
      .update(playerReleases)
      .set({ superadminApprovedAt: new Date() })
      .where(eq(playerReleases.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Release not found' });
    return reply.send(updated);
  });

  // ── GET /player-releases/management-list  (management admin) ─────────────
  // Returns all superadmin-approved releases with this company's approval status.
  app.get('/management-list', { onRequest: [app.authenticateManagementCompanyAdmin] }, async (req, reply) => {
    const caller = req.user as { managementCompanyId: string };
    const platformFilter = (req.query as { platform?: string })?.platform;

    const rows = platformFilter && (PLATFORMS as readonly string[]).includes(platformFilter)
      ? await db.select().from(playerReleases)
          .where(and(isNotNull(playerReleases.superadminApprovedAt), eq(playerReleases.platform, platformFilter)))
          .orderBy(desc(playerReleases.publishedAt))
      : await db.select().from(playerReleases)
          .where(isNotNull(playerReleases.superadminApprovedAt))
          .orderBy(desc(playerReleases.publishedAt));

    // Fetch this company's approvals in one query
    const releaseIds = rows.map((r) => r.id);
    const approvals = releaseIds.length > 0
      ? await db.select({ releaseId: playerReleaseApprovals.releaseId })
          .from(playerReleaseApprovals)
          .where(and(
            inArray(playerReleaseApprovals.releaseId, releaseIds),
            eq(playerReleaseApprovals.managementCompanyId, caller.managementCompanyId),
          ))
      : [];
    const approvedSet = new Set(approvals.map((a) => a.releaseId));

    return reply.send(rows.map((r) => ({ ...r, managementApproved: approvedSet.has(r.id) })));
  });

  // ── POST /player-releases/:id/management-approve  (management admin) ─────
  app.post('/:id/management-approve', { onRequest: [app.authenticateManagementCompanyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as { sub: string; managementCompanyId: string };

    const release = await db.query.playerReleases.findFirst({ where: eq(playerReleases.id, id) });
    if (!release) return reply.status(404).send({ error: 'Release not found' });
    if (!release.superadminApprovedAt) return reply.status(422).send({ error: 'Release not yet approved by platform owner' });

    // Upsert: insert or ignore duplicate
    await db
      .insert(playerReleaseApprovals)
      .values({
        releaseId: id,
        managementCompanyId: caller.managementCompanyId,
        approvedBy: caller.sub,
      })
      .onConflictDoNothing();

    return reply.send({ ok: true });
  });

  // ── POST /player-releases/upload/:platform  ───────────────────────────────
  // Upload one or more player artifacts (WGT + sssp_config.xml, APK, EXE + latest.yml, BIN)
  // for a specific platform. Files are saved to PLAYER_BUILDS_ROOT/{platform}/ which nginx
  // aliases directly so they are immediately downloadable at /{platform}/{filename}.
  // Returns sha256 + sizeBytes of the main artifact, used by the subsequent POST / call.
  app.post('/upload/:platform', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { platform } = req.params as { platform: string };

    // Allow 'esp32' in addition to the release platforms
    const validPlatforms = [...PLATFORMS, 'esp32'] as const;
    if (!(validPlatforms as readonly string[]).includes(platform)) {
      return reply.status(400).send({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
    }

    const allowed = ALLOWED_EXTENSIONS[platform] ?? [];
    const dir = path.join(PLAYER_BUILDS_ROOT, platform);
    await fs.mkdir(dir, { recursive: true });

    const savedFiles: {
      filename: string;
      sizeBytes: number;
      sha256: string;
      downloadUrl: string;
    }[] = [];

    const appUrl = (process.env['APP_URL'] ?? '').replace(/\/+$/, '');

    for await (const part of req.files()) {
      const safeName = path.basename(part.filename);
      const ext = path.extname(safeName).toLowerCase();

      if (allowed.length > 0 && !allowed.includes(ext)) {
        // Drain and reject
        for await (const _ of part.file) { /* drain */ }
        return reply.status(400).send({ error: `File extension ${ext} is not allowed for platform ${platform}` });
      }

      const filePath = path.join(dir, safeName);
      const hash = createHash('sha256');
      let size = 0;

      const ws = createWriteStream(filePath);
      for await (const chunk of part.file) {
        ws.write(chunk);
        hash.update(chunk);
        size += chunk.length;
        if (size > UPLOAD_SIZE_LIMIT) {
          ws.destroy();
          await fs.unlink(filePath).catch(() => {});
          return reply.status(413).send({ error: `File exceeds ${Math.round(UPLOAD_SIZE_LIMIT / 1024 / 1024)} MB limit` });
        }
      }
      await new Promise<void>((res, rej) => {
        ws.end();
        ws.on('finish', res);
        ws.on('error', rej);
      });

      savedFiles.push({
        filename: safeName,
        sizeBytes: size,
        sha256: hash.digest('hex'),
        downloadUrl: `${appUrl}/${platform}/${safeName}`,
      });
    }

    if (!savedFiles.length) {
      return reply.status(400).send({ error: 'No files provided' });
    }

    // Main artifact: the binary (WGT / APK / EXE / BIN)
    const binaryExts = new Set(['.wgt', '.apk', '.exe', '.bin']);
    const artifact = savedFiles.find(f => binaryExts.has(path.extname(f.filename).toLowerCase()))
      ?? savedFiles[0]!;

    // Manifest: SSSP config XML (Tizen/ePaper) or latest.yml (Windows electron-updater)
    const manifestExts = new Set(['.xml', '.yml', '.yaml']);
    const manifest = savedFiles.find(f => manifestExts.has(path.extname(f.filename).toLowerCase()));

    return reply.send({
      files:       savedFiles,
      artifactUrl: artifact.downloadUrl,
      sizeBytes:   artifact.sizeBytes,
      sha256:      artifact.sha256,
      ...(manifest ? { manifestUrl: manifest.downloadUrl } : {}),
    });
  });
}
