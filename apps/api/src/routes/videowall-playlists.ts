import type { FastifyInstance } from 'fastify';
import {
  db,
  videowallPlaylists,
  videowallPlaylistSlots,
  videowallPlaylistPages,
  deviceGroups,
  deviceGroupMembers,
  devices,
  workspaceMembers,
  contentItems,
} from '@signage/db';
import { eq, and, isNull, inArray, asc, desc } from 'drizzle-orm';
import { sendCommand, isDeviceOnline } from '../services/ws.js';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

export async function videowallPlaylistRoutes(app: FastifyInstance) {

  // ── GET /?workspaceId= ────────────────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.videowallPlaylists.findMany({
      where: and(
        eq(videowallPlaylists.workspaceId, workspaceId),
        isNull(videowallPlaylists.deletedAt),
      ),
      orderBy: [desc(videowallPlaylists.updatedAt)],
    });
    if (rows.length === 0) return reply.send([]);

    // Fetch group info for all playlists in one query
    const groupIds = [...new Set(rows.map((r) => r.groupId).filter((id): id is string => !!id))];
    const groupRows = groupIds.length > 0
      ? await db.select({
          id: deviceGroups.id,
          name: deviceGroups.name,
          videoWallCols: deviceGroups.videoWallCols,
          videoWallRows: deviceGroups.videoWallRows,
        }).from(deviceGroups).where(inArray(deviceGroups.id, groupIds))
      : [];
    const groupMap = Object.fromEntries(groupRows.map((g) => [g.id, g]));

    // Fetch slots in batch for preview thumbnails + counts
    const playlistIds = rows.map((r) => r.id);
    const allSlots = await db.select({
      playlistId: videowallPlaylistSlots.playlistId,
      contentId: videowallPlaylistSlots.contentId,
      positionCol: videowallPlaylistSlots.positionCol,
      positionRow: videowallPlaylistSlots.positionRow,
    }).from(videowallPlaylistSlots)
      .where(inArray(videowallPlaylistSlots.playlistId, playlistIds))
      .orderBy(asc(videowallPlaylistSlots.positionRow), asc(videowallPlaylistSlots.positionCol));

    const slotsByPlaylist: Record<string, typeof allSlots> = {};
    for (const s of allSlots) {
      (slotsByPlaylist[s.playlistId] ??= []).push(s);
    }

    const result = rows.map((pl) => {
      const slots = slotsByPlaylist[pl.id] ?? [];
      const group = pl.groupId ? (groupMap[pl.groupId] ?? null) : null;
      return {
        ...pl,
        group,
        slotCount: slots.length,
        previewContentIds: slots
          .filter((s) => !!s.contentId)
          .slice(0, 4)
          .map((s) => s.contentId!),
      };
    });

    return reply.send(result);
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const pl = await db.query.videowallPlaylists.findFirst({
      where: and(eq(videowallPlaylists.id, id), isNull(videowallPlaylists.deletedAt)),
    });
    if (!pl) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(pl.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Fetch pages ordered by index
    const pages = await db.query.videowallPlaylistPages.findMany({
      where: eq(videowallPlaylistPages.playlistId, id),
      orderBy: [asc(videowallPlaylistPages.pageIndex)],
    });

    // Fetch all slots across all pages
    const pageIds = pages.map((p) => p.id);
    const allSlots = pageIds.length > 0
      ? await db.query.videowallPlaylistSlots.findMany({
          where: inArray(videowallPlaylistSlots.pageId, pageIds),
          orderBy: [asc(videowallPlaylistSlots.positionRow), asc(videowallPlaylistSlots.positionCol)],
        })
      : [];

    // Enrich with content info
    const contentIds = [...new Set(allSlots.map((s) => s.contentId).filter((cid): cid is string => !!cid))];
    const contentRows = contentIds.length > 0
      ? await db.select({
          id: contentItems.id,
          name: contentItems.name,
          thumbnailPath: contentItems.thumbnailPath,
          type: contentItems.type,
          duration: contentItems.duration,
          orientation: contentItems.orientation,
        }).from(contentItems)
          .where(and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)))
      : [];
    const contentMap = Object.fromEntries(contentRows.map((c) => [c.id, c]));

    // Group slots by page id
    const slotsByPage: Record<string, typeof allSlots> = {};
    for (const s of allSlots) {
      (slotsByPage[s.pageId] ??= []).push(s);
    }

    // Fetch group with member positions
    let group: (typeof deviceGroups.$inferSelect & {
      members: Array<typeof deviceGroupMembers.$inferSelect>;
    }) | null = null;
    if (pl.groupId) {
      const g = await db.query.deviceGroups.findFirst({
        where: and(eq(deviceGroups.id, pl.groupId), isNull(deviceGroups.deletedAt)),
      });
      if (g) {
        const members = await db.query.deviceGroupMembers.findMany({
          where: eq(deviceGroupMembers.groupId, pl.groupId),
          orderBy: [asc(deviceGroupMembers.positionRow), asc(deviceGroupMembers.positionCol)],
        });
        group = { ...g, members };
      }
    }

    return reply.send({
      ...pl,
      group,
      pages: pages.map((p) => ({
        ...p,
        slots: (slotsByPage[p.id] ?? []).map((s) => ({
          ...s,
          content: s.contentId ? (contentMap[s.contentId] ?? null) : null,
        })),
      })),
    });
  });

  // ── POST / ────────────────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = req.body as { workspaceId?: string; name?: string; groupId?: string };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [pl] = await db.insert(videowallPlaylists).values({
      workspaceId: body.workspaceId,
      createdBy: user.sub,
      name: body.name.trim(),
      groupId: body.groupId ?? null,
    }).returning();

    return reply.status(201).send(pl);
  });

  // ── PATCH /:id ────────────────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; groupId?: string | null };

    const pl = await db.query.videowallPlaylists.findFirst({
      where: and(eq(videowallPlaylists.id, id), isNull(videowallPlaylists.deletedAt)),
    });
    if (!pl) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(pl.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(videowallPlaylists).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.groupId !== undefined && { groupId: body.groupId }),
      updatedAt: new Date(),
    }).where(eq(videowallPlaylists.id, id)).returning();

    return reply.send(updated);
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };

    const pl = await db.query.videowallPlaylists.findFirst({
      where: and(eq(videowallPlaylists.id, id), isNull(videowallPlaylists.deletedAt)),
    });
    if (!pl) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(pl.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(videowallPlaylists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(videowallPlaylists.id, id));

    return reply.send({ ok: true });
  });

  // ── PUT /:id/slots ────────────────────────────────────────────────────────
  // Replace all slot assignments for the playlist atomically.
  app.put('/:id/slots', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as Array<{
      positionCol: number;
      positionRow: number;
      contentId?: string | null;
      objectFit?: string;
    }>;
    if (!Array.isArray(body)) return reply.status(400).send({ error: 'body must be a slot array' });

    const pl = await db.query.videowallPlaylists.findFirst({
      where: and(eq(videowallPlaylists.id, id), isNull(videowallPlaylists.deletedAt)),
    });
    if (!pl) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(pl.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Atomic replace: delete all then re-insert
    await db.delete(videowallPlaylistSlots).where(eq(videowallPlaylistSlots.playlistId, id));

    if (body.length > 0) {
      await db.insert(videowallPlaylistSlots).values(
        body.map((s) => ({
          playlistId: id,
          positionCol: s.positionCol,
          positionRow: s.positionRow,
          contentId: s.contentId ?? null,
          objectFit: ['cover', 'contain', 'fill'].includes(s.objectFit ?? '') ? s.objectFit! : 'cover',
        })),
      );
    }

    await db.update(videowallPlaylists)
      .set({ updatedAt: new Date() })
      .where(eq(videowallPlaylists.id, id));

    const newSlots = await db.query.videowallPlaylistSlots.findMany({
      where: eq(videowallPlaylistSlots.playlistId, id),
      orderBy: [asc(videowallPlaylistSlots.positionRow), asc(videowallPlaylistSlots.positionCol)],
    });

    return reply.send(newSlots);
  });

  // ── POST /:id/publish ─────────────────────────────────────────────────────
  // Publishes per-cell content to every member device in the wall group.
  // Each device gets publishedContentId set to its cell's assigned content.
  app.post('/:id/publish', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };

    const pl = await db.query.videowallPlaylists.findFirst({
      where: and(eq(videowallPlaylists.id, id), isNull(videowallPlaylists.deletedAt)),
    });
    if (!pl) return reply.status(404).send({ error: 'Not found' });
    if (!pl.groupId) return reply.status(400).send({ error: 'No wall group assigned to this playlist' });

    const member = await checkWorkspaceAccess(pl.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Fetch the wall group
    const group = await db.query.deviceGroups.findFirst({
      where: and(eq(deviceGroups.id, pl.groupId), isNull(deviceGroups.deletedAt)),
    });
    if (!group || group.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Wall group not found' });
    }
    if (group.type !== 'videowall') {
      return reply.status(400).send({ error: 'Device group is not a videowall group' });
    }

    // Fetch group member device positions
    const memberRows = await db.query.deviceGroupMembers.findMany({
      where: eq(deviceGroupMembers.groupId, pl.groupId),
      orderBy: [asc(deviceGroupMembers.positionRow), asc(deviceGroupMembers.positionCol)],
    });
    if (memberRows.length === 0) return reply.send({ updated: 0, pushed: 0, skipped: 0 });

    // Build slot map from page 0 (first page) only
    const firstPage = await db.query.videowallPlaylistPages.findFirst({
      where: eq(videowallPlaylistPages.playlistId, id),
      orderBy: [asc(videowallPlaylistPages.pageIndex)],
    });
    const pageSlots = firstPage
      ? await db.query.videowallPlaylistSlots.findMany({
          where: eq(videowallPlaylistSlots.pageId, firstPage.id),
        })
      : [];
    const slotMap: Record<string, string | null> = {};
    for (const s of pageSlots) {
      slotMap[`${s.positionCol},${s.positionRow}`] = s.contentId;
    }

    // Update each member device: set publishedContentId to its assigned cell content
    let updated = 0;
    for (const m of memberRows) {
      if (m.positionCol == null || m.positionRow == null) continue;
      const contentId = slotMap[`${m.positionCol},${m.positionRow}`] ?? null;
      await db.update(devices).set({
        publishedContentId: contentId,
        publishedPlaylistId: null,
        publishedScheduleId: null,
        publishedSyncGroupId: null,
        updatedAt: new Date(),
      }).where(and(
        eq(devices.id, m.deviceId),
        eq(devices.orgId, user.orgId),
        isNull(devices.deletedAt),
      ));
      updated++;
    }

    // Notify online devices to reload their content
    let pushed = 0;
    let skipped = 0;
    for (const m of memberRows) {
      if (isDeviceOnline(m.deviceId)) {
        sendCommand(m.deviceId, { type: 'refresh_schedule' });
        pushed++;
      } else {
        skipped++;
      }
    }

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'VIDEOWALL_PLAYLIST_PUBLISH',
      entityType: 'videowall_playlist',
      entityId: id,
      ipAddress: req.ip,
      meta: { groupId: pl.groupId, deviceCount: updated, pushed, skipped },
    });

    return reply.send({ updated, pushed, skipped });
  });
}
