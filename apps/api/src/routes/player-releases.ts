import type { FastifyInstance } from 'fastify';
import { db, playerReleases, devices, workspaceMembers } from '@signage/db';
import { eq, desc, and, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { sendCommand } from '../services/ws.js';

const CreateReleaseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url(),
  releaseNotes: z.string().optional(),
});

export async function playerReleasesRoutes(app: FastifyInstance) {
  /** Public read: any authenticated user can fetch the latest release */
  app.get('/latest', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const [release] = await db
      .select()
      .from(playerReleases)
      .where(eq(playerReleases.isLatest, true))
      .limit(1);

    return reply.send(release ?? null);
  });

  /** Superadmin: list all releases */
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { role: string };
    if (user.role !== 'superadmin') return reply.status(403).send({ error: 'Forbidden' });

    const releases = await db
      .select()
      .from(playerReleases)
      .orderBy(desc(playerReleases.publishedAt));

    return reply.send(releases);
  });

  /** Superadmin: publish a new release (marks it as latest) */
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { role: string };
    if (user.role !== 'superadmin') return reply.status(403).send({ error: 'Forbidden' });

    const body = CreateReleaseSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { version, downloadUrl, releaseNotes } = body.data;

    // Clear existing latest flag
    await db
      .update(playerReleases)
      .set({ isLatest: false })
      .where(eq(playerReleases.isLatest, true));

    const [release] = await db
      .insert(playerReleases)
      .values({ version, downloadUrl, releaseNotes, isLatest: true })
      .returning();

    return reply.status(201).send(release);
  });

  /** Superadmin: delete a release */
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { role: string };
    if (user.role !== 'superadmin') return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    await db.delete(playerReleases).where(eq(playerReleases.id, id));
    return reply.status(204).send();
  });

  // ── POST /player-releases/:id/deploy  (5-H) ──────────────────────────────
  app.post('/:id/deploy', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { role: string; sub: string; orgId: string };
    if (user.role !== 'superadmin') return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const body = req.body as { workspaceId?: string; deviceIds?: string[] };

    const release = await db.query.playerReleases.findFirst({ where: eq(playerReleases.id, id) });
    if (!release) return reply.status(404).send({ error: 'Release not found' });

    // Resolve target device IDs
    let targetDevices: { id: string }[];

    if (body.deviceIds && body.deviceIds.length > 0) {
      targetDevices = await db.query.devices.findMany({
        where: and(isNull(devices.deletedAt), inArray(devices.id, body.deviceIds)),
        columns: { id: true },
      });
    } else if (body.workspaceId) {
      targetDevices = await db.query.devices.findMany({
        where: and(eq(devices.workspaceId, body.workspaceId), isNull(devices.deletedAt)),
        columns: { id: true },
      });
    } else {
      // Deploy to all devices
      targetDevices = await db.query.devices.findMany({
        where: isNull(devices.deletedAt),
        columns: { id: true },
      });
    }

    let sent = 0;
    for (const device of targetDevices) {
      sendCommand(device.id, {
        type: 'update_player',
        payload: {
          version: release.version,
          downloadUrl: release.downloadUrl,
        },
      });
      sent++;
    }

    return reply.send({ releaseId: id, version: release.version, sentToDevices: sent });
  });
}
