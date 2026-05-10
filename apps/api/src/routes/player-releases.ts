import type { FastifyInstance } from 'fastify';
import { db, playerReleases, devices } from '@signage/db';
import { eq, desc, and, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { sendCommand } from '../services/ws.js';

const PLATFORMS = ['tizen', 'windows', 'epaper', 'android'] as const;
type ReleasePlatform = typeof PLATFORMS[number];

const CreateReleaseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url(),
  releaseNotes: z.string().optional(),
  platform: z.enum(PLATFORMS).default('tizen'),
  manifestUrl: z.string().url().optional(),
  sha512: z.string().optional(),
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
   *  Defaults to 'tizen' for back-compat with the existing Tizen player. */
  app.get('/latest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const platform = parsePlatform((req.query as { platform?: string })?.platform);
    const [release] = await db
      .select()
      .from(playerReleases)
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)))
      .limit(1);

    return reply.send(release ?? null);
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

    const { version, downloadUrl, releaseNotes, platform, manifestUrl, sha512, sizeBytes } = body.data;

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
        },
      });
      sent++;
    }

    return reply.send({ releaseId: id, version: release.version, platform: release.platform, sentToDevices: sent });
  });
}
