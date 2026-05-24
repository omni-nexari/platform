import type { FastifyInstance } from 'fastify';
import { db, playlists, playlistItems, playlistFolders, contentItems, workspaceMembers, workspaces, scheduleSlots, devices } from '@signage/db';
import { eq, and, isNull, isNotNull, desc, ilike, inArray, sql, getTableColumns, gte, asc } from 'drizzle-orm';
import { cloneEntityTags, getAssignedTagsForEntities, getEntityIdsForTags } from '../services/entityTags.js';
import { validatePlaylistItemConditions } from '@signage/shared';
import { logActivity } from '../services/activity-logger.js';

type AuthUser = { sub: string; orgId: string; role: string };

const APPROVE_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager']);

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

/**
 * Recursively checks that none of the nestedPlaylistIds would create a cycle
 * or exceed the maximum nesting depth (3 levels).
 * Returns an error string if the check fails, or null if it passes.
 */
async function checkNestedPlaylistDepth(
  rootId: string,
  nestedIds: string[],
  depth: number,
): Promise<string | null> {
  if (depth >= 3) return 'Nested playlist depth cannot exceed 3 levels';
  if (nestedIds.includes(rootId)) return 'Circular nested playlist reference detected';

  const childItemLists = await Promise.all(
    nestedIds.map((nid) =>
      db.query.playlistItems.findMany({
        where: eq(playlistItems.playlistId, nid),
        columns: { nestedPlaylistId: true },
      }),
    ),
  );

  for (const childItems of childItemLists) {
    const grandchildIds = childItems
      .map((i) => i.nestedPlaylistId)
      .filter((v): v is string => v != null);
    if (grandchildIds.length > 0) {
      const err = await checkNestedPlaylistDepth(rootId, grandchildIds, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

export async function playlistRoutes(app: FastifyInstance) {

  // ── GET /playlists?workspaceId=&page=&limit= ─────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, search, tagIds: rawTagIds, page: rawPage, limit: rawLimit, folderId } = req.query as {
      workspaceId?: string; search?: string; tagIds?: string; page?: string; limit?: string; folderId?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const page = Math.max(Number(rawPage ?? 1), 1);
    const limit = Math.min(Number(rawLimit ?? 50), 200);
    const offset = (page - 1) * limit;

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const tagIds = (rawTagIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchingIds = tagIds.length > 0 ? await getEntityIdsForTags(workspaceId, 'playlist', tagIds) : null;
    if (matchingIds && matchingIds.length === 0) return reply.send({ items: [], total: 0, page, limit });

    const conditions = and(
      eq(playlists.workspaceId, workspaceId),
      isNull(playlists.deletedAt),
      matchingIds ? inArray(playlists.id, matchingIds) : undefined,
      search ? ilike(playlists.name, `%${search}%`) : undefined,
      folderId === 'root' ? isNull(playlists.folderId) : folderId ? eq(playlists.folderId, folderId) : undefined,
    );

    const [rows, totalResult] = await Promise.all([
      db.select({
        ...getTableColumns(playlists),
        hasNestedPlaylist: sql<boolean>`exists (
          select 1 from playlist_items
          where playlist_items.playlist_id = ${playlists.id}
            and playlist_items.nested_playlist_id is not null
        )`.as('has_nested_playlist'),
      }).from(playlists)
        .where(conditions)
        .orderBy(desc(playlists.updatedAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` })
        .from(playlists)
        .where(conditions)
        .then((r) => r[0]?.count ?? 0),
    ]);

    const assignedTagMap = await getAssignedTagsForEntities(workspaceId, 'playlist', rows.map((row) => row.id));

    // Fetch preview content IDs (first 4 per playlist, ordered by position)
    const playlistIds = rows.map((r) => r.id);
    const previewMap: Record<string, string[]> = {};
    const expiredMap: Record<string, boolean> = {};

    if (playlistIds.length > 0) {
      const previewItems = await db
        .select({ playlistId: playlistItems.playlistId, contentId: playlistItems.contentId, position: playlistItems.position })
        .from(playlistItems)
        .where(and(inArray(playlistItems.playlistId, playlistIds), isNotNull(playlistItems.contentId)))
        .orderBy(asc(playlistItems.position));

      for (const item of previewItems) {
        if (!previewMap[item.playlistId]) previewMap[item.playlistId] = [];
        if (previewMap[item.playlistId]!.length < 4) {
          previewMap[item.playlistId]!.push(item.contentId!);
        }
      }

      const expiredItems = await db
        .selectDistinct({ playlistId: playlistItems.playlistId })
        .from(playlistItems)
        .innerJoin(contentItems, and(
          eq(playlistItems.contentId, contentItems.id),
          isNotNull(contentItems.validUntil),
          sql`${contentItems.validUntil} < NOW()`,
          isNull(contentItems.deletedAt),
        ))
        .where(inArray(playlistItems.playlistId, playlistIds));

      for (const item of expiredItems) {
        expiredMap[item.playlistId] = true;
      }
    }

    return reply.send({
      items: rows.map((row) => ({
        ...row,
        assignedTags: assignedTagMap[row.id] ?? [],
        previewContentIds: previewMap[row.id] ?? [],
        hasExpiredContent: expiredMap[row.id] ?? false,
      })),
      total: totalResult,
      page,
      limit,
    });
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
      description?: string; loop?: boolean; shuffle?: boolean;
      folderId?: string | null;
      isSmartPlaylist?: boolean; smartFilters?: unknown;
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
      shuffle: body.shuffle ?? false,
      folderId: body.folderId ?? null,
      isSmartPlaylist: body.isSmartPlaylist ?? false,
      smartFilters: body.smartFilters != null ? JSON.stringify(body.smartFilters) : null,
    }).returning();

    logActivity({ userId: user.sub, workspaceId: body.workspaceId, eventType: 'playlist_created', eventData: { playlistId: playlist?.id, name: body.name } });
    return reply.status(201).send(playlist);
  });

  // ── PATCH /playlists/:id ─────────────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string; description?: string; loop?: boolean; shuffle?: boolean;
      folderId?: string | null; isSmartPlaylist?: boolean; smartFilters?: unknown;
    };

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
    if (body.shuffle !== undefined) updates.shuffle = body.shuffle;
    if (body.folderId !== undefined) updates.folderId = body.folderId;
    if (body.isSmartPlaylist !== undefined) updates.isSmartPlaylist = body.isSmartPlaylist;
    if (body.smartFilters !== undefined) updates.smartFilters = body.smartFilters != null ? JSON.stringify(body.smartFilters) : null;

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
      conditions?: string | Record<string, unknown>; weight?: number;
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
      // Conditions validation (3-B)
      const rawConditions = typeof item.conditions === 'string'
        ? (() => { try { return JSON.parse(item.conditions as string); } catch { return null; } })()
        : item.conditions;
      const condErr = validatePlaylistItemConditions(rawConditions);
      if (condErr) return reply.status(400).send({ error: `Invalid conditions: ${condErr}` });
    }

    // Nested depth guard (3-H): ensure no nested playlist creates a cycle or exceeds depth 3
    const nestedIds = incomingItems.map(i => i.nestedPlaylistId).filter((v): v is string => v != null);
    if (nestedIds.length > 0) {
      const depthError = await checkNestedPlaylistDepth(id, nestedIds, 0);
      if (depthError) return reply.status(400).send({ error: depthError });
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
          weight: item.weight ?? 1,
          contentId: item.contentId ?? null,
          nestedPlaylistId: item.nestedPlaylistId ?? null,
          duration: item.duration ?? null,
          transitionEffect: item.transitionEffect ?? 'none',
          conditions: typeof item.conditions === 'string'
            ? item.conditions
            : item.conditions != null ? JSON.stringify(item.conditions) : '{}',
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

  // ── POST /playlists/:id/items (add single item) ─────────────────────────
  app.post('/:id/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      contentId?: string; nestedPlaylistId?: string;
      duration?: number; transitionEffect?: string;
      conditions?: string | Record<string, unknown>;
      position?: number; weight?: number;
    };

    if (!body.contentId && !body.nestedPlaylistId) {
      return reply.status(400).send({ error: 'contentId or nestedPlaylistId required' });
    }
    if (body.nestedPlaylistId === id) {
      return reply.status(400).send({ error: 'A playlist cannot reference itself' });
    }

    const rawConditions = typeof body.conditions === 'string'
      ? (() => { try { return JSON.parse(body.conditions as string); } catch { return null; } })()
      : body.conditions;
    const condErr = validatePlaylistItemConditions(rawConditions);
    if (condErr) return reply.status(400).send({ error: `Invalid conditions: ${condErr}` });

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Depth guard for nested playlists
    if (body.nestedPlaylistId) {
      const depthErr = await checkNestedPlaylistDepth(id, [body.nestedPlaylistId], 0);
      if (depthErr) return reply.status(400).send({ error: depthErr });
    }

    const currentItems = await db.query.playlistItems.findMany({
      where: eq(playlistItems.playlistId, id),
      orderBy: [asc(playlistItems.position)],
    });

    const insertAt = body.position !== undefined
      ? Math.min(Math.max(body.position, 0), currentItems.length)
      : currentItems.length;

    // Resolve duration
    let dur = body.duration ?? null;
    if (!dur && body.contentId) {
      const content = await db.query.contentItems.findFirst({
        where: eq(contentItems.id, body.contentId),
        columns: { duration: true },
      });
      dur = content?.duration ?? null;
    }

    // Shift positions of items at or after insertAt
    if (insertAt < currentItems.length) {
      await db.update(playlistItems)
        .set({ position: sql`${playlistItems.position} + 1` })
        .where(and(
          eq(playlistItems.playlistId, id),
          gte(playlistItems.position, insertAt),
        ));
    }

    const [newItem] = await db.insert(playlistItems).values({
      playlistId: id,
      position: insertAt,
      weight: body.weight ?? 1,
      contentId: body.contentId ?? null,
      nestedPlaylistId: body.nestedPlaylistId ?? null,
      duration: body.duration ?? null,
      transitionEffect: body.transitionEffect ?? 'none',
      conditions: typeof body.conditions === 'string'
        ? body.conditions
        : body.conditions != null ? JSON.stringify(body.conditions) : '{}',
    }).returning();

    // Recalculate totals
    const allItems = await db.query.playlistItems.findMany({
      where: eq(playlistItems.playlistId, id),
    });
    const totalDuration = allItems.reduce((acc, it) => acc + (it.duration ?? 10), 0);

    const firstContentId = allItems
      .sort((a, b) => a.position - b.position)
      .find((i) => i.contentId)?.contentId ?? null;

    await db.update(playlists).set({
      itemCount: allItems.length,
      totalDuration,
      thumbnailContentId: firstContentId,
      updatedAt: new Date(),
    }).where(eq(playlists.id, id));

    return reply.status(201).send(newItem);
  });

  // ── PATCH /playlists/:id/items/:itemId (update single item) ──────────────
  app.patch('/:id/items/:itemId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, itemId } = req.params as { id: string; itemId: string };
    const body = req.body as {
      duration?: number | null;
      transitionEffect?: string;
      conditions?: string | Record<string, unknown>;
      weight?: number;
    };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const item = await db.query.playlistItems.findFirst({
      where: eq(playlistItems.id, itemId),
    });
    if (!item || item.playlistId !== id) return reply.status(404).send({ error: 'Item not found' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.duration !== undefined) patch['duration'] = body.duration;
    if (body.transitionEffect !== undefined) patch['transitionEffect'] = body.transitionEffect;
    if (body.weight !== undefined) patch['weight'] = body.weight;
    if (body.conditions !== undefined) {
      const rawConditions = typeof body.conditions === 'string'
        ? (() => { try { return JSON.parse(body.conditions as string); } catch { return null; } })()
        : body.conditions;
      const condErr = validatePlaylistItemConditions(rawConditions);
      if (condErr) return reply.status(400).send({ error: `Invalid conditions: ${condErr}` });
      patch['conditions'] = typeof body.conditions === 'string'
        ? body.conditions
        : JSON.stringify(body.conditions);
    }

    const [updated] = await db.update(playlistItems).set(patch).where(eq(playlistItems.id, itemId)).returning();
    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));
    return reply.send(updated);
  });

  // ── DELETE /playlists/:id/items/:itemId ───────────────────────────────────
  app.delete('/:id/items/:itemId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id, itemId } = req.params as { id: string; itemId: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const item = await db.query.playlistItems.findFirst({
      where: eq(playlistItems.id, itemId),
    });
    if (!item || item.playlistId !== id) return reply.status(404).send({ error: 'Item not found' });

    await db.delete(playlistItems).where(eq(playlistItems.id, itemId));

    // Re-sequence remaining items
    const remaining = await db.query.playlistItems.findMany({
      where: eq(playlistItems.playlistId, id),
      orderBy: [asc(playlistItems.position)],
    });
    await Promise.all(
      remaining.map((it, idx) =>
        it.position !== idx
          ? db.update(playlistItems).set({ position: idx }).where(eq(playlistItems.id, it.id))
          : Promise.resolve(),
      ),
    );

    const totalDuration = remaining.reduce((acc, it) => acc + (it.duration ?? 10), 0);
    const firstContentId = remaining.find((i) => i.contentId)?.contentId ?? null;

    await db.update(playlists).set({
      itemCount: remaining.length,
      totalDuration,
      thumbnailContentId: firstContentId,
      updatedAt: new Date(),
    }).where(eq(playlists.id, id));

    return reply.send({ ok: true });
  });

  // ── PUT /playlists/:id/items/reorder ────────────────────────────────────
  app.put('/:id/items/reorder', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as Array<{ id: string; position: number }>;

    if (!Array.isArray(body)) return reply.status(400).send({ error: 'Body must be an array' });

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await Promise.all(
      body.map(({ id: itemId, position }) =>
        db.update(playlistItems)
          .set({ position })
          .where(and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, id))),
      ),
    );

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));
    return reply.send({ ok: true });
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

  // ── POST /playlists/:id/sync-smart  (3-D Smart Playlists) ────────────────
  app.post('/:id/sync-smart', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });
    if (!playlist.isSmartPlaylist) return reply.status(400).send({ error: 'Playlist is not a smart playlist' });
    if (!playlist.smartFilters) return reply.status(400).send({ error: 'Smart filters not configured' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    let filters: {
      types?: string[];
      tagIds?: string[];
      folderId?: string;
      maxItems?: number;
      sortBy?: string;
    } = {};
    try { filters = JSON.parse(playlist.smartFilters); } catch {
      return reply.status(400).send({ error: 'Invalid smartFilters JSON' });
    }

    // Build content query conditions
    const queryConditions = and(
      eq(contentItems.workspaceId, playlist.workspaceId),
      isNull(contentItems.deletedAt),
      filters.types && filters.types.length > 0 ? inArray(contentItems.type, filters.types) : undefined,
      filters.folderId ? eq(contentItems.folderId, filters.folderId) : undefined,
    );

    // Resolve tag filter
    let matchingContentIds: string[] | null = null;
    if (filters.tagIds && filters.tagIds.length > 0) {
      const { getEntityIdsForTags: getTagIds } = await import('../services/entityTags.js');
      matchingContentIds = await getTagIds(playlist.workspaceId, 'content', filters.tagIds);
      if (matchingContentIds.length === 0) {
        // No content matches tags — clear the playlist
        await db.delete(playlistItems).where(eq(playlistItems.playlistId, id));
        const [updated] = await db.update(playlists)
          .set({ itemCount: 0, totalDuration: 0, thumbnailContentId: null, updatedAt: new Date() })
          .where(eq(playlists.id, id)).returning();
        return reply.send({ ...updated, synced: 0 });
      }
    }

    const sortField = filters.sortBy === 'name' ? contentItems.name
      : filters.sortBy === 'size' ? contentItems.fileSize
      : contentItems.createdAt;

    const resolvedItems = await db.select({
      id: contentItems.id,
      duration: contentItems.duration,
    }).from(contentItems)
      .where(and(
        queryConditions,
        matchingContentIds ? inArray(contentItems.id, matchingContentIds) : undefined,
      ))
      .orderBy(desc(sortField))
      .limit(filters.maxItems ?? 200);

    await db.delete(playlistItems).where(eq(playlistItems.playlistId, id));

    if (resolvedItems.length > 0) {
      await db.insert(playlistItems).values(
        resolvedItems.map((item, idx) => ({
          playlistId: id,
          position: idx,
          contentId: item.id,
          duration: item.duration ?? null,
          transitionEffect: 'none',
          conditions: '{}',
        })),
      );
    }

    const totalDuration = resolvedItems.reduce((acc, i) => acc + (i.duration ?? 10), 0);

    const [updated] = await db.update(playlists).set({
      itemCount: resolvedItems.length,
      totalDuration,
      thumbnailContentId: resolvedItems[0]?.id ?? null,
      updatedAt: new Date(),
    }).where(eq(playlists.id, id)).returning();

    return reply.send({ ...updated, synced: resolvedItems.length });
  });

  // ── Playlist Folders (3-E) ────────────────────────────────────────────────

  app.get('/folders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const folders = await db.query.playlistFolders.findMany({
      where: eq(playlistFolders.workspaceId, workspaceId),
      orderBy: [asc(playlistFolders.position), asc(playlistFolders.name)],
    });
    return reply.send(folders);
  });

  app.post('/folders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; name?: string; parentId?: string | null };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [folder] = await db.insert(playlistFolders).values({
      workspaceId: body.workspaceId,
      name: body.name.trim(),
      parentId: body.parentId ?? null,
    }).returning();

    return reply.status(201).send(folder);
  });

  app.patch('/folders/:folderId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { folderId } = req.params as { folderId: string };
    const body = req.body as { name?: string; parentId?: string | null };

    const folder = await db.query.playlistFolders.findFirst({ where: eq(playlistFolders.id, folderId) });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    const member = await checkWorkspaceAccess(folder.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const [updated] = await db.update(playlistFolders).set({
      ...(body.name !== undefined && { name: body.name.trim() }),
      ...(body.parentId !== undefined && { parentId: body.parentId }),
      updatedAt: new Date(),
    }).where(eq(playlistFolders.id, folderId)).returning();

    return reply.send(updated);
  });

  app.delete('/folders/:folderId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { folderId } = req.params as { folderId: string };

    const folder = await db.query.playlistFolders.findFirst({ where: eq(playlistFolders.id, folderId) });
    if (!folder) return reply.status(404).send({ error: 'Folder not found' });

    const member = await checkWorkspaceAccess(folder.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    // Move child folders and playlists up
    await db.update(playlistFolders)
      .set({ parentId: folder.parentId, updatedAt: new Date() })
      .where(eq(playlistFolders.parentId, folderId));
    await db.update(playlists)
      .set({ folderId: folder.parentId ?? null, updatedAt: new Date() })
      .where(eq(playlists.folderId, folderId));
    await db.delete(playlistFolders).where(eq(playlistFolders.id, folderId));

    return reply.send({ success: true });
  });

  app.put('/folders/reorder', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; items?: Array<{ id: string; position: number }> };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!Array.isArray(body.items) || body.items.length === 0) return reply.status(400).send({ error: 'items required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    await Promise.all(
      body.items.map(({ id: fid, position }) =>
        db.update(playlistFolders)
          .set({ position, updatedAt: new Date() })
          .where(and(eq(playlistFolders.id, fid), eq(playlistFolders.workspaceId, body.workspaceId!))),
      ),
    );
    return reply.send({ success: true });
  });

  app.post('/move-to-folder', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId?: string; playlistIds?: string[]; folderId?: string | null };
    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.playlistIds || body.playlistIds.length === 0) return reply.status(400).send({ error: 'playlistIds required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    if (body.folderId) {
      const folder = await db.query.playlistFolders.findFirst({
        where: and(eq(playlistFolders.id, body.folderId), eq(playlistFolders.workspaceId, body.workspaceId)),
      });
      if (!folder) return reply.status(404).send({ error: 'Folder not found' });
    }

    await db.update(playlists)
      .set({ folderId: body.folderId ?? null, updatedAt: new Date() })
      .where(and(
        eq(playlists.workspaceId, body.workspaceId),
        inArray(playlists.id, body.playlistIds),
        isNull(playlists.deletedAt),
      ));

    return reply.send({ success: true, count: body.playlistIds.length });
  });

  // ── Playlist Approval Workflow (3-F) ─────────────────────────────────────

  app.post('/:id/submit-review', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    if (playlist.approvalState !== 'draft' && playlist.approvalState !== 'rejected') {
      return reply.status(400).send({ error: 'Playlist must be in draft or rejected state to submit for review' });
    }

    const [updated] = await db.update(playlists)
      .set({ approvalState: 'pending_review', updatedAt: new Date() })
      .where(eq(playlists.id, id))
      .returning();
    return reply.send(updated);
  });

  app.post('/:id/approve', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!APPROVE_ROLES.has(user.role)) return reply.status(403).send({ error: 'Only managers and above can approve playlists' });

    const [updated] = await db.update(playlists)
      .set({ approvalState: 'approved', updatedAt: new Date() })
      .where(eq(playlists.id, id))
      .returning();
    return reply.send(updated);
  });

  app.post('/:id/reject', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { note?: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });
    if (!APPROVE_ROLES.has(user.role)) return reply.status(403).send({ error: 'Only managers and above can reject playlists' });

    const [updated] = await db.update(playlists)
      .set({ approvalState: 'rejected', updatedAt: new Date() })
      .where(eq(playlists.id, id))
      .returning();
    return reply.send({ ...updated, note: body.note ?? null });
  });

  // ── GET /playlists/:id/usage  (3-G) ─────────────────────────────────────
  app.get('/:id/usage', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), isNull(playlists.deletedAt)),
    });
    if (!playlist) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(playlist.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const [scheduleRows, deviceRows, nestedRows] = await Promise.all([
      db.select({
        slotId: scheduleSlots.id,
        scheduleId: scheduleSlots.scheduleId,
        daysOfWeek: scheduleSlots.daysOfWeek,
        startTime: scheduleSlots.startTime,
        endTime: scheduleSlots.endTime,
      }).from(scheduleSlots).where(eq(scheduleSlots.playlistId, id)),

      db.select({
        deviceId: devices.id,
        deviceName: devices.name,
      }).from(devices).where(eq(devices.publishedPlaylistId, id)),

      // Playlists that nest this one
      db.select({
        itemId: playlistItems.id,
        parentPlaylistId: playlistItems.playlistId,
      }).from(playlistItems).where(eq(playlistItems.nestedPlaylistId, id)),
    ]);

    return reply.send({
      schedules: scheduleRows,
      devices: deviceRows,
      nestedInPlaylists: nestedRows,
    });
  });

  // ── GET /playlists/:id/export  (3-I) ─────────────────────────────────────
  app.get('/:id/export', { onRequest: [app.authenticate] }, async (req, reply) => {
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
      orderBy: [asc(playlistItems.position)],
    });

    const contentIds = items.map(i => i.contentId).filter((v): v is string => v != null);
    const contentRows = contentIds.length > 0
      ? await db.query.contentItems.findMany({
          where: inArray(contentItems.id, contentIds),
          columns: { id: true, fileHash: true, name: true, type: true },
        })
      : [];
    const contentHashMap = Object.fromEntries(contentRows.map(c => [c.id, c]));

    const exportPayload = {
      exportVersion: 1,
      name: playlist.name,
      description: playlist.description,
      loop: playlist.loop,
      shuffle: playlist.shuffle,
      items: items.map(item => ({
        contentHash: item.contentId ? (contentHashMap[item.contentId]?.fileHash ?? null) : null,
        contentName: item.contentId ? (contentHashMap[item.contentId]?.name ?? null) : null,
        contentType: item.contentId ? (contentHashMap[item.contentId]?.type ?? null) : null,
        nestedPlaylistId: item.nestedPlaylistId,
        duration: item.duration,
        transitionEffect: item.transitionEffect,
        conditions: item.conditions,
        weight: item.weight,
      })),
    };

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="playlist-${id}.json"`);
    return reply.send(exportPayload);
  });

  // ── POST /playlists/import  (3-I) ─────────────────────────────────────────
  app.post('/import', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId?: string;
      name?: string;
      exportPayload?: {
        name: string;
        description?: string;
        loop?: boolean;
        shuffle?: boolean;
        items?: Array<{
          contentHash?: string | null;
          contentName?: string | null;
          duration?: number | null;
          transitionEffect?: string;
          conditions?: string;
          weight?: number;
        }>;
      };
    };

    if (!body.workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (!body.exportPayload) return reply.status(400).send({ error: 'exportPayload required' });

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member || member.role === 'viewer') return reply.status(403).send({ error: 'Forbidden' });

    const ep = body.exportPayload;
    const playlistName = (body.name ?? ep.name ?? 'Imported Playlist').trim();

    const [newPlaylist] = await db.insert(playlists).values({
      workspaceId: body.workspaceId,
      createdBy: user.sub,
      name: playlistName,
      description: ep.description ?? null,
      loop: ep.loop ?? true,
      shuffle: ep.shuffle ?? false,
    }).returning();

    if (!newPlaylist) return reply.status(500).send({ error: 'Failed to create playlist' });

    const importedItems = ep.items ?? [];
    const itemsToInsert: Array<{
      playlistId: string;
      position: number;
      contentId: string | null;
      duration: number | null;
      transitionEffect: string;
      conditions: string;
      weight: number;
    }> = [];
    const unresolved: number[] = [];

    // Match content items by fileHash, then fall back to name
    for (let idx = 0; idx < importedItems.length; idx++) {
      const item = importedItems[idx]!;
      let resolvedContentId: string | null = null;

      if (item.contentHash) {
        const found = await db.query.contentItems.findFirst({
          where: and(
            eq(contentItems.workspaceId, body.workspaceId),
            eq(contentItems.fileHash, item.contentHash),
            isNull(contentItems.deletedAt),
          ),
          columns: { id: true },
        });
        resolvedContentId = found?.id ?? null;
      }

      if (!resolvedContentId && item.contentName) {
        const found = await db.query.contentItems.findFirst({
          where: and(
            eq(contentItems.workspaceId, body.workspaceId),
            eq(contentItems.name, item.contentName),
            isNull(contentItems.deletedAt),
          ),
          columns: { id: true },
        });
        resolvedContentId = found?.id ?? null;
      }

      if (!resolvedContentId) unresolved.push(idx);

      itemsToInsert.push({
        playlistId: newPlaylist.id,
        position: idx,
        contentId: resolvedContentId,
        duration: item.duration ?? null,
        transitionEffect: item.transitionEffect ?? 'none',
        conditions: item.conditions ?? '{}',
        weight: item.weight ?? 1,
      });
    }

    const validItems = itemsToInsert.filter(i => i.contentId !== null);
    if (validItems.length > 0) {
      await db.insert(playlistItems).values(validItems);
    }

    const totalDuration = validItems.reduce((acc, i) => acc + (i.duration ?? 10), 0);

    const [updated] = await db.update(playlists).set({
      itemCount: validItems.length,
      totalDuration,
      thumbnailContentId: validItems[0]?.contentId ?? null,
      updatedAt: new Date(),
    }).where(eq(playlists.id, newPlaylist.id)).returning();

    return reply.status(201).send({
      playlist: updated,
      imported: validItems.length,
      unresolved,
    });
  });
}
