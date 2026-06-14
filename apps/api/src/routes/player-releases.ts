import type { FastifyInstance } from 'fastify';
import { db, playerReleases, playerReleaseApprovals, devices } from '@signage/db';
import { eq, desc, and, isNull, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { sendCommand } from '../services/ws.js';
import { organizations } from '@signage/db';

const PLATFORMS = ['tizen', 'windows', 'epaper', 'android'] as const;
type ReleasePlatform = typeof PLATFORMS[number];

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
}
