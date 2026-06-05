import type { FastifyInstance } from 'fastify';
import { db, syncPlaylists, syncPlaylistItems, contentItems, workspaces, workspaceMembers } from '@signage/db';
import { eq, and, isNull, desc, inArray, asc } from 'drizzle-orm';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

export async function syncPlaylistRoutes(app: FastifyInstance) {

  // ── GET /sync-playlists?workspaceId= ─────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.query.syncPlaylists.findMany({
      where: and(eq(syncPlaylists.workspaceId, workspaceId), isNull(syncPlaylists.deletedAt)),
      orderBy: [desc(syncPlaylists.updatedAt)],
    });

    // Enrich each playlist with item count, total duration, and preview content IDs
    const ids = rows.map((r) => r.id);
    const previewMap: Record<string, string[]> = {};
    const itemCountMap: Record<string, number> = {};
    const durationMap: Record<string, number> = {};

    if (ids.length > 0) {
      const allItems = await db
        .select({
          syncPlaylistId: syncPlaylistItems.syncPlaylistId,
          contentId: syncPlaylistItems.contentId,
          durationSeconds: syncPlaylistItems.durationSeconds,
          sortOrder: syncPlaylistItems.sortOrder,
          contentDuration: contentItems.duration,
          contentType: contentItems.type,
        })
        .from(syncPlaylistItems)
        .leftJoin(contentItems, and(eq(syncPlaylistItems.contentId, contentItems.id), isNull(contentItems.deletedAt)))
        .where(inArray(syncPlaylistItems.syncPlaylistId, ids))
        .orderBy(asc(syncPlaylistItems.sortOrder));

      for (const item of allItems) {
        const pid = item.syncPlaylistId;
        if (!previewMap[pid]) { previewMap[pid] = []; itemCountMap[pid] = 0; durationMap[pid] = 0; }
        itemCountMap[pid]! += 1;
        // duration: item override > content default > fallback 10s
        const dur = item.durationSeconds ?? item.contentDuration ?? 10;
        durationMap[pid]! += dur;
        if (item.contentId && previewMap[pid]!.length < 4) {
          const SYNC_THUMB_TYPES = new Set(['image', 'video', 'pdf', 'presentation', 'html5']);
          if (SYNC_THUMB_TYPES.has(item.contentType ?? '')) {
            previewMap[pid]!.push(item.contentId);
          }
        }
      }
    }

    return reply.send(rows.map((row) => ({
      ...row,
      itemCount: itemCountMap[row.id] ?? 0,
      totalDuration: durationMap[row.id] ?? 0,
      previewContentIds: previewMap[row.id] ?? [],
    })));
  });

  // ── GET /sync-playlists/:id ───────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.syncPlaylists.findFirst({
      where: and(eq(syncPlaylists.id, id), isNull(syncPlaylists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const items = await db.query.syncPlaylistItems.findMany({
      where: eq(syncPlaylistItems.syncPlaylistId, id),
      orderBy: [syncPlaylistItems.sortOrder],
    });

    const contentIds = items.map(i => i.contentId).filter((v): v is string => v != null);
    const contentRows = contentIds.length > 0
      ? await db.query.contentItems.findMany({
          where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)),
        })
      : [];
    const contentMap = Object.fromEntries(contentRows.map(c => [c.id, c]));

    const enrichedItems = items.map(item => ({
      ...item,
      content: item.contentId ? (contentMap[item.contentId] ?? null) : null,
    }));

    return reply.send({ ...playlist, items: enrichedItems });
  });

  // ── POST /sync-playlists ──────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string };

    if (!body.workspaceId || !body.name?.trim()) {
      return reply.status(400).send({ error: 'workspaceId and name required' });
    }

    const workspace = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, body.workspaceId), eq(workspaces.orgId, user.orgId), isNull(workspaces.deletedAt)),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [playlist] = await db.insert(syncPlaylists).values({
      orgId: user.orgId,
      workspaceId: body.workspaceId,
      createdBy: user.sub,
      name: body.name.trim(),
    }).returning();

    return reply.status(201).send({ ...playlist, items: [] });
  });

  // ── PATCH /sync-playlists/:id ─────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string };

    const playlist = await db.query.syncPlaylists.findFirst({
      where: and(eq(syncPlaylists.id, id), isNull(syncPlaylists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(syncPlaylists)
      .set({
        name: body.name?.trim() ?? playlist.name,
        updatedAt: new Date(),
      })
      .where(eq(syncPlaylists.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /sync-playlists/:id ────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.syncPlaylists.findFirst({
      where: and(eq(syncPlaylists.id, id), isNull(syncPlaylists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(syncPlaylists).set({ deletedAt: new Date() }).where(eq(syncPlaylists.id, id));
    return reply.status(204).send();
  });

  // ── PUT /sync-playlists/:id/items ─ atomic replace of item list ───────────
  app.put('/:id/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as Array<{ contentId: string; durationSeconds?: number | null }>;

    if (!Array.isArray(body)) {
      return reply.status(400).send({ error: 'Body must be an array of items' });
    }

    const playlist = await db.query.syncPlaylists.findFirst({
      where: and(eq(syncPlaylists.id, id), isNull(syncPlaylists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Validate all referenced content items exist in the same workspace
    const contentIds = body.map(i => i.contentId).filter(Boolean);
    if (contentIds.length > 0) {
      const existingContent = await db.query.contentItems.findMany({
        where: and(
          inArray(contentItems.id, contentIds),
          eq(contentItems.workspaceId, playlist.workspaceId),
          isNull(contentItems.deletedAt),
        ),
        columns: { id: true },
      });
      const foundIds = new Set(existingContent.map(c => c.id));
      const missing = contentIds.find(cid => !foundIds.has(cid));
      if (missing) return reply.status(404).send({ error: `Content item not found: ${missing}` });
    }

    // Atomic replace: delete all then re-insert
    await db.delete(syncPlaylistItems).where(eq(syncPlaylistItems.syncPlaylistId, id));

    const newItems = body.length > 0
      ? await db.insert(syncPlaylistItems).values(
          body.map((item, idx) => ({
            syncPlaylistId: id,
            contentId: item.contentId ?? null,
            durationSeconds: item.durationSeconds ?? null,
            sortOrder: idx,
          }))
        ).returning()
      : [];

    await db.update(syncPlaylists).set({ updatedAt: new Date() }).where(eq(syncPlaylists.id, id));

    return reply.send(newItems);
  });
}
