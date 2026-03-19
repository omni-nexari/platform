import type { FastifyInstance } from 'fastify';
import { db, tagCategories, workspaceTags, workspaces, tagAssignments } from '@signage/db';
import { eq, and, asc, isNull, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';

type AuthUser = { sub: string; orgId: string; role: string };

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  availableFor: z.array(z.enum(['device', 'content', 'playlist', 'schedule'])).default([]),
});

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  availableFor: z.array(z.enum(['device', 'content', 'playlist', 'schedule'])).optional(),
});

const CreateTagSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

const UpdateTagSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

// ── Helper: verify workspace belongs to auth user's org ───────────────────────

async function verifyWorkspace(wsId: string, orgId: string) {
  return db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, wsId), eq(workspaces.orgId, orgId), isNull(workspaces.deletedAt)),
  });
}

export async function tagRoutes(app: FastifyInstance) {

  // ── GET /tags?workspaceId=:wsId ───────────────────────────────────────────
  // Returns all categories with their tags for the workspace
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const ws = await verifyWorkspace(workspaceId, user.orgId);
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    const categories = await db.query.tagCategories.findMany({
      where: eq(tagCategories.workspaceId, workspaceId),
      orderBy: [asc(tagCategories.position), asc(tagCategories.createdAt)],
    });

    // Fetch all tags for this workspace and group by category
    const tags = await db.query.workspaceTags.findMany({
      where: eq(workspaceTags.workspaceId, workspaceId),
      orderBy: [asc(workspaceTags.position), asc(workspaceTags.createdAt)],
    });

    // Fetch usage counts per tag per entity type
    const usageRows = await db.execute(sql`
      SELECT tag_id, entity_type, COUNT(*)::int AS cnt
      FROM tag_assignments
      WHERE workspace_id = ${workspaceId}
      GROUP BY tag_id, entity_type
    `) as unknown as { tag_id: string; entity_type: string; cnt: number }[];
    const usageMap = new Map<string, Record<string, number>>();
    for (const row of usageRows) {
      if (!usageMap.has(row.tag_id)) {
        usageMap.set(row.tag_id, { device: 0, content: 0, playlist: 0, schedule: 0 });
      }
      usageMap.get(row.tag_id)![row.entity_type] = row.cnt;
    }

    const tagsByCategory = new Map<string, (typeof tags[0] & { usage: Record<string, number> })[]>();
    for (const tag of tags) {
      const arr = tagsByCategory.get(tag.categoryId) ?? [];
      arr.push({ ...tag, usage: usageMap.get(tag.id) ?? { device: 0, content: 0, playlist: 0, schedule: 0 } });
      tagsByCategory.set(tag.categoryId, arr);
    }

    const result = categories.map((cat) => ({
      ...cat,
      tags: tagsByCategory.get(cat.id) ?? [],
    }));

    return reply.send(result);
  });

  // ── GET /tags/:tagId/usage ─────────────────────────────────────────────────
  // Returns entity names grouped by type for a given tag
  app.get('/:tagId/usage', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { tagId } = req.params as { tagId: string };

    const tag = await db.query.workspaceTags.findFirst({ where: eq(workspaceTags.id, tagId) });
    if (!tag) return reply.status(404).send({ error: 'Tag not found' });

    const ws = await verifyWorkspace(tag.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.execute(sql`
      SELECT
        ta.entity_id,
        ta.entity_type,
        CASE ta.entity_type
          WHEN 'device'   THEN d.name
          WHEN 'content'  THEN c.name
          WHEN 'playlist' THEN p.name
          WHEN 'schedule' THEN s.name
        END AS name
      FROM tag_assignments ta
      LEFT JOIN devices       d ON ta.entity_type = 'device'   AND ta.entity_id = d.id
      LEFT JOIN content_items c ON ta.entity_type = 'content'  AND ta.entity_id = c.id
      LEFT JOIN playlists     p ON ta.entity_type = 'playlist' AND ta.entity_id = p.id
      LEFT JOIN schedules     s ON ta.entity_type = 'schedule' AND ta.entity_id = s.id
      WHERE ta.tag_id = ${tagId}
      ORDER BY ta.entity_type, name
    `) as unknown as { entity_id: string; entity_type: string; name: string | null }[];

    const result: Record<string, { id: string; name: string }[]> = {
      device: [], content: [], playlist: [], schedule: [],
    };
    for (const row of rows) {
      const bucket = result[row.entity_type];
      if (bucket) bucket.push({ id: row.entity_id, name: row.name ?? 'Deleted item' });
    }
    return reply.send(result);
  });

  // ── GET /tags/assignments?workspaceId=&entityId=&entityType= ─────────────
  // Returns all tag IDs assigned to a specific entity
  app.get('/assignments', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, entityId, entityType } = req.query as {
      workspaceId?: string; entityId?: string; entityType?: string;
    };
    if (!workspaceId || !entityId || !entityType)
      return reply.status(400).send({ error: 'workspaceId, entityId and entityType are required' });

    const ws = await verifyWorkspace(workspaceId, user.orgId);
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    const rows = await db.query.tagAssignments.findMany({
      where: and(
        eq(tagAssignments.workspaceId, workspaceId),
        eq(tagAssignments.entityId, entityId),
        eq(tagAssignments.entityType, entityType),
      ),
    });

    return reply.send(rows.map((r) => r.tagId));
  });

  // ── POST /tags/:tagId/assign ───────────────────────────────────────────────
  // Attach a tag to an entity (device / content / playlist / schedule)
  app.post('/:tagId/assign', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { tagId } = req.params as { tagId: string };
    const body = z.object({
      entityId: z.string().uuid(),
      entityType: z.enum(['device', 'content', 'playlist', 'schedule']),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const tag = await db.query.workspaceTags.findFirst({ where: eq(workspaceTags.id, tagId) });
    if (!tag) return reply.status(404).send({ error: 'Tag not found' });
    const ws = await verifyWorkspace(tag.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    await db.insert(tagAssignments).values({
      tagId,
      entityId: body.data.entityId,
      entityType: body.data.entityType,
      workspaceId: tag.workspaceId,
    }).onConflictDoNothing();

    return reply.status(201).send({ success: true });
  });

  // ── POST /tags/bulk-assign ────────────────────────────────────────────────
  // Replace tag assignments for many entities in one request
  app.post('/bulk-assign', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = z.object({
      workspaceId: z.string().uuid(),
      entityType: z.enum(['device', 'content', 'playlist', 'schedule']),
      entityIds: z.array(z.string().uuid()).min(1),
      tagIds: z.array(z.string().uuid()).default([]),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const ws = await verifyWorkspace(body.data.workspaceId, user.orgId);
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    const validTags = body.data.tagIds.length
      ? await db.query.workspaceTags.findMany({
          where: and(
            eq(workspaceTags.workspaceId, body.data.workspaceId),
            inArray(workspaceTags.id, body.data.tagIds),
          ),
          columns: { id: true },
        })
      : [];

    if (validTags.length !== body.data.tagIds.length) {
      return reply.status(400).send({ error: 'One or more tags do not belong to this workspace' });
    }

    await db.delete(tagAssignments).where(
      and(
        eq(tagAssignments.workspaceId, body.data.workspaceId),
        eq(tagAssignments.entityType, body.data.entityType),
        inArray(tagAssignments.entityId, body.data.entityIds),
      ),
    );

    if (body.data.tagIds.length > 0) {
      await db.insert(tagAssignments).values(
        body.data.entityIds.flatMap((entityId) =>
          body.data.tagIds.map((tagId) => ({
            workspaceId: body.data.workspaceId,
            entityType: body.data.entityType,
            entityId,
            tagId,
          })),
        ),
      );
    }

    return reply.send({ success: true, count: body.data.entityIds.length });
  });

  // ── DELETE /tags/:tagId/assign/:entityId ───────────────────────────────────
  // Detach a tag from an entity
  app.delete('/:tagId/assign/:entityId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { tagId, entityId } = req.params as { tagId: string; entityId: string };

    const tag = await db.query.workspaceTags.findFirst({ where: eq(workspaceTags.id, tagId) });
    if (!tag) return reply.status(404).send({ error: 'Tag not found' });
    const ws = await verifyWorkspace(tag.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    await db.delete(tagAssignments).where(
      and(eq(tagAssignments.tagId, tagId), eq(tagAssignments.entityId, entityId)),
    );
    return reply.send({ success: true });
  });

  // ── POST /tags/categories ─────────────────────────────────────────────────
  app.post('/categories', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const body = z.object({ workspaceId: z.string().uuid() }).merge(CreateCategorySchema).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const ws = await verifyWorkspace(body.data.workspaceId, user.orgId);
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    const [cat] = await db
      .insert(tagCategories)
      .values({
        workspaceId: body.data.workspaceId,
        name: body.data.name,
        color: body.data.color,
        availableFor: body.data.availableFor,
      })
      .returning();

    return reply.status(201).send({ ...cat, tags: [] });
  });

  // ── PATCH /tags/categories/:id ────────────────────────────────────────────
  app.patch('/categories/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const existing = await db.query.tagCategories.findFirst({ where: eq(tagCategories.id, id) });
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    // Verify workspace ownership
    const ws = await verifyWorkspace(existing.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const body = UpdateCategorySchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const [updated] = await db
      .update(tagCategories)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(tagCategories.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /tags/categories/:id ───────────────────────────────────────────
  app.delete('/categories/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const existing = await db.query.tagCategories.findFirst({ where: eq(tagCategories.id, id) });
    if (!existing) return reply.status(404).send({ error: 'Category not found' });

    const ws = await verifyWorkspace(existing.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    // Cascade delete handled by DB FK; tags deleted automatically
    await db.delete(tagCategories).where(eq(tagCategories.id, id));
    return reply.send({ success: true });
  });

  // ── POST /tags/categories/:categoryId/tags ────────────────────────────────
  app.post('/categories/:categoryId/tags', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { categoryId } = req.params as { categoryId: string };

    const cat = await db.query.tagCategories.findFirst({ where: eq(tagCategories.id, categoryId) });
    if (!cat) return reply.status(404).send({ error: 'Category not found' });

    const ws = await verifyWorkspace(cat.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const body = CreateTagSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const [tag] = await db
      .insert(workspaceTags)
      .values({
        categoryId,
        workspaceId: cat.workspaceId,
        name: body.data.name,
        color: body.data.color ?? null,
      })
      .returning();

    return reply.status(201).send(tag);
  });

  // ── PATCH /tags/categories/:categoryId/tags/:tagId ────────────────────────
  app.patch('/categories/:categoryId/tags/:tagId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { categoryId, tagId } = req.params as { categoryId: string; tagId: string };

    const cat = await db.query.tagCategories.findFirst({ where: eq(tagCategories.id, categoryId) });
    if (!cat) return reply.status(404).send({ error: 'Category not found' });

    const ws = await verifyWorkspace(cat.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    const body = UpdateTagSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const [updated] = await db
      .update(workspaceTags)
      .set(body.data)
      .where(and(eq(workspaceTags.id, tagId), eq(workspaceTags.categoryId, categoryId)))
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Tag not found' });
    return reply.send(updated);
  });

  // ── DELETE /tags/categories/:categoryId/tags/:tagId ───────────────────────
  app.delete('/categories/:categoryId/tags/:tagId', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { categoryId, tagId } = req.params as { categoryId: string; tagId: string };

    const cat = await db.query.tagCategories.findFirst({ where: eq(tagCategories.id, categoryId) });
    if (!cat) return reply.status(404).send({ error: 'Category not found' });

    const ws = await verifyWorkspace(cat.workspaceId, user.orgId);
    if (!ws) return reply.status(403).send({ error: 'Forbidden' });

    await db
      .delete(workspaceTags)
      .where(and(eq(workspaceTags.id, tagId), eq(workspaceTags.categoryId, categoryId)));

    return reply.send({ success: true });
  });
}
