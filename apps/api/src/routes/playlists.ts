import type { FastifyInstance } from 'fastify';
import { db, playlists, playlistItems, contentItems, workspaceMembers } from '@signage/db';
import { eq, and, isNull, desc, ilike, inArray, sql, getTableColumns } from 'drizzle-orm';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

export async function playlistRoutes(app: FastifyInstance) {

  // ── GET /playlists?workspaceId= ──────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, search, tagIds: rawTagIds } = req.query as { workspaceId?: string; search?: string; tagIds?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const tagIds = (rawTagIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchingIds = tagIds.length > 0 ? await getEntityIdsForTags(workspaceId, 'playlist', tagIds) : null;
    if (matchingIds && matchingIds.length === 0) return reply.send([]);

    const rows = await db.select({
      ...getTableColumns(playlists),
      hasNestedPlaylist: sql<boolean>`exists (
        select 1 from playlist_items
        where playlist_items.playlist_id = ${playlists.id}
          and playlist_items.nested_playlist_id is not null
      )`.as('has_nested_playlist'),
    }).from(playlists)
      .where(and(
        eq(playlists.workspaceId, workspaceId),
        isNull(playlists.deletedAt),
        matchingIds ? inArray(playlists.id, matchingIds) : undefined,
        search ? ilike(playlists.name, `%${search}%`) : undefined,
      ))
      .orderBy(desc(playlists.updatedAt));

    const assignedTagMap = await getAssignedTagsForEntities(workspaceId, 'playlist', rows.map((row) => row.id));
    return reply.send(rows.map((row) => ({ ...row, assignedTags: assignedTagMap[row.id] ?? [] })));
  });

  // ── GET /playlists/:id ───────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const items = await db.query.playlistItems.findMany({
      where: eq(playlistItems.playlistId, id),
      orderBy: [playlistItems.position],
    });

    const contentIds = items.map(i => i.contentId).filter((v): v is string => v != null);
    const nestedIds = items.map(i => i.nestedPlaylistId).filter((v): v is string => v != null);

    const [contentRows, nestedRows] = await Promise.all([
      contentIds.length > 0
        ? db.query.contentItems.findMany({ where: and(inArray(contentItems.id, contentIds), isNull(contentItems.deletedAt)) })
        : Promise.resolve([]),
      nestedIds.length > 0
        ? db.query.playlists.findMany({ where: and(inArray(playlists.id, nestedIds), isNull(playlists.deletedAt)) })
        : Promise.resolve([]),
    ]);

    const contentMap = Object.fromEntries(contentRows.map(c => [c.id, c]));
    const nestedMap = Object.fromEntries(nestedRows.map(p => [p.id, p]));

    const enrichedItems = items.map(item => ({
      ...item,
      content: item.contentId ? (contentMap[item.contentId] ?? null) : null,
      nestedPlaylist: item.nestedPlaylistId ? (nestedMap[item.nestedPlaylistId] ?? null) : null,
    }));

    const assignedTagMap = await getAssignedTagsForEntities(playlist.workspaceId, 'playlist', [playlist.id]);
    return reply.send({ ...playlist, assignedTags: assignedTagMap[playlist.id] ?? [], items: enrichedItems });
  });

  // ── POST /playlists ──────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId: string; name: string;
      description?: string; loop?: boolean;
    };

    if (!body.workspaceId || !body.name?.trim()) {
      return reply.status(400).send({ error: 'workspaceId and name required' });
    }

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [playlist] = await db.insert(playlists).values({
      workspaceId: body.workspaceId,
      createdBy: user.sub,
      name: body.name.trim(),
      description: body.description ?? null,
      loop: body.loop ?? true,
    }).returning();

    return reply.status(201).send(playlist);
  });

  // ── PATCH /playlists/:id ─────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; loop?: boolean };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const updates: Partial<typeof playlists.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.loop !== undefined) updates.loop = body.loop;

    const [updated] = await db.update(playlists).set(updates).where(eq(playlists.id, id)).returning();
    return reply.send(updated);
  });

  // ── DELETE /playlists/:id ────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(playlists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(playlists.id, id));
    return reply.status(204).send();
  });

  // ── PUT /playlists/:id/items ──────────────────────────────────────────────
  // Atomically replaces the entire item list (delete-all + bulk-insert).
  // Body: Array<{ contentId?, nestedPlaylistId?, duration?, transitionEffect? }>
  app.put('/:id/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const incomingItems = req.body as Array<{
      contentId?: string; nestedPlaylistId?: string;
      duration?: number; transitionEffect?: string;
      conditions?: string;
    }>;

    if (!Array.isArray(incomingItems)) {
      return reply.status(400).send({ error: 'Body must be an array' });
    }

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    for (const item of incomingItems) {
      if (!item.contentId && !item.nestedPlaylistId) {
        return reply.status(400).send({ error: 'Each item must have contentId or nestedPlaylistId' });
      }
      // Prevent nesting a playlist inside itself
      if (item.nestedPlaylistId === id) {
        return reply.status(400).send({ error: 'A playlist cannot reference itself' });
      }
    }

    // Resolve content durations for items that don't have an override
    const cIds = incomingItems.map(i => i.contentId).filter((v): v is string => v != null);
    const contentRows = cIds.length > 0
      ? await db.query.contentItems.findMany({ where: inArray(contentItems.id, cIds) })
      : [];
    const contentDurMap = Object.fromEntries(contentRows.map(c => [c.id, c.duration ?? 10]));

    let totalDuration = 0;
    for (const item of incomingItems) {
      const dur = item.duration ?? (item.contentId ? (contentDurMap[item.contentId] ?? 10) : 30);
      totalDuration += dur;
    }

    // Use the first content item as the playlist thumbnail
    const firstContentId = incomingItems.find(i => i.contentId)?.contentId ?? null;

    // Replace items atomically
    await db.delete(playlistItems).where(eq(playlistItems.playlistId, id));

    if (incomingItems.length > 0) {
      await db.insert(playlistItems).values(
        incomingItems.map((item, idx) => ({
          playlistId: id,
          position: idx,
          contentId: item.contentId ?? null,
          nestedPlaylistId: item.nestedPlaylistId ?? null,
          duration: item.duration ?? null,
          transitionEffect: item.transitionEffect ?? 'none',
          conditions: item.conditions ?? '{}',
        })),
      );
    }

    const [updated] = await db.update(playlists).set({
      itemCount: incomingItems.length,
      totalDuration,
      thumbnailContentId: firstContentId,
      updatedAt: new Date(),
    }).where(eq(playlists.id, id)).returning();

    return reply.send(updated);
  });

  // ── POST /playlists/:id/clone ────────────────────────────────────────────
  app.post('/:id/clone', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [cloned] = await db.insert(playlists).values({
      workspaceId: playlist.workspaceId,
      createdBy: user.sub,
      name: `${playlist.name} (Copy)`,
      description: playlist.description,
      loop: playlist.loop,
      totalDuration: playlist.totalDuration,
      itemCount: playlist.itemCount,
      thumbnailContentId: playlist.thumbnailContentId,
    }).returning();

    if (cloned) {
      await cloneEntityTags(playlist.workspaceId, 'playlist', playlist.id, cloned.id);
    }

    const existingItems = await db.query.playlistItems.findMany({
      where: eq(playlistItems.playlistId, id),
      orderBy: [playlistItems.position],
    });

    if (existingItems.length > 0 && cloned) {
      await db.insert(playlistItems).values(
        existingItems.map(item => ({
          playlistId: cloned.id,
          position: item.position,
          contentId: item.contentId,
          nestedPlaylistId: item.nestedPlaylistId,
          duration: item.duration,
          transitionEffect: item.transitionEffect,
          conditions: item.conditions,
        })),
      );
    }

    return reply.status(201).send(cloned);
  });
}
