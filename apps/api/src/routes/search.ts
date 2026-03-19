import type { FastifyInstance } from 'fastify';
import { db, contentItems, playlists, schedules, devices, workspaceMembers } from '@signage/db';
import { eq, and, isNull, ilike, or } from 'drizzle-orm';
import { z } from 'zod';

export async function searchRoutes(app: FastifyInstance) {
  // ── GET /search?q=&workspaceId= ─────────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const query = z
      .object({
        q: z.string().min(1).max(200),
        workspaceId: z.string().uuid(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });

    const { q, workspaceId } = query.data;
    const user = req.user as { sub: string; orgId: string };

    // Verify membership
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.sub),
      ),
    });
    if (!member) return reply.status(403).send({ error: 'Access denied' });

    const term = `%${q}%`;

    const [contentResults, playlistResults, scheduleResults, deviceResults] = await Promise.all([
      db.query.contentItems.findMany({
        where: and(
          eq(contentItems.workspaceId, workspaceId),
          isNull(contentItems.deletedAt),
          or(
            ilike(contentItems.name, term),
            ilike(contentItems.originalName, term),
          ),
        ),
        columns: { id: true, name: true, mimeType: true, type: true, createdAt: true },
        limit: 10,
      }),
      db.query.playlists.findMany({
        where: and(
          eq(playlists.workspaceId, workspaceId),
          isNull(playlists.deletedAt),
          ilike(playlists.name, term),
        ),
        columns: { id: true, name: true, createdAt: true },
        limit: 10,
      }),
      db.query.schedules.findMany({
        where: and(
          eq(schedules.workspaceId, workspaceId),
          isNull(schedules.deletedAt),
          ilike(schedules.name, term),
        ),
        columns: { id: true, name: true, isActive: true, createdAt: true },
        limit: 10,
      }),
      db.query.devices.findMany({
        where: and(
          eq(devices.workspaceId, workspaceId),
          isNull(devices.deletedAt),
          ilike(devices.name, term),
        ),
        columns: { id: true, name: true, status: true, createdAt: true },
        limit: 10,
      }),
    ]);

    return reply.send({
      content: contentResults.map((r) => ({ ...r, entityType: 'content' as const })),
      playlists: playlistResults.map((r) => ({ ...r, entityType: 'playlist' as const })),
      schedules: scheduleResults.map((r) => ({ ...r, entityType: 'schedule' as const })),
      devices: deviceResults.map((r) => ({ ...r, entityType: 'device' as const })),
    });
  });
}
