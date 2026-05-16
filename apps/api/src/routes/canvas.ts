import type { FastifyInstance } from 'fastify';
import { db, canvasProjects, contentItems, workspaceMembers } from '@signage/db';
import { eq, and, isNull, desc, ilike, sql } from 'drizzle-orm';

type AuthUser = { sub: string; orgId: string; role: string };

async function checkWorkspaceAccess(workspaceId: string, userId: string) {
  return db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
}

export async function canvasRoutes(app: FastifyInstance) {

  // ── GET /canvas?workspaceId=&contentItemId= ─────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, search, contentItemId } = req.query as { workspaceId?: string; search?: string; contentItemId?: string };

    // Single-item lookup by content item ID (no workspaceId required)
    if (contentItemId) {
      const project = await db.query.canvasProjects.findFirst({
        where: and(eq(canvasProjects.contentItemId, contentItemId), isNull(canvasProjects.deletedAt)),
      });
      if (!project) return reply.status(404).send({ error: 'Not found' });
      const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
      if (!member) return reply.status(403).send({ error: 'Forbidden' });
      return reply.send(project);
    }

    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const member = await checkWorkspaceAccess(workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await db.select().from(canvasProjects)
      .where(and(
        eq(canvasProjects.workspaceId, workspaceId),
        isNull(canvasProjects.deletedAt),
        search ? ilike(canvasProjects.name, `%${search}%`) : undefined,
      ))
      .orderBy(desc(canvasProjects.updatedAt));

    return reply.send(rows);
  });

  // ── GET /canvas/:id ──────────────────────────────────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    return reply.send(project);
  });

  // ── POST /canvas ─────────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId: string;
      name: string;
      description?: string;
      width?: number;
      height?: number;
    };

    if (!body.workspaceId || !body.name?.trim()) {
      return reply.status(400).send({ error: 'workspaceId and name required' });
    }

    const member = await checkWorkspaceAccess(body.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const width = body.width ?? 1920;
    const height = body.height ?? 1080;

    // Create the canvas project with a default empty page
    const defaultScene = {
      pages: [{
        id: crypto.randomUUID(),
        title: 'Page 1',
        duration: 10,
        transition: 'none',
        elements: [],
      }],
    };

    const defaultSettings = {
      width,
      height,
      background: '#1a1a2e',
      gridEnabled: true,
      gridSize: 20,
      snapToGrid: true,
      guides: { horizontal: [] as number[], vertical: [] as number[] },
    };

    // Also create a content_items row so canvas shows in the library
    const [contentItem] = await db.insert(contentItems).values({
      workspaceId: body.workspaceId,
      uploadedBy: user.sub,
      type: 'canvas',
      name: body.name.trim(),
      description: body.description ?? null,
      width,
      height,
      orientation: width >= height ? 'landscape' : 'portrait',
      duration: 10,
      status: 'ready',
      approvalState: 'approved',
      metadata: JSON.stringify({ canvasProject: true }),
    }).returning();

    const [project] = await db.insert(canvasProjects).values({
      workspaceId: body.workspaceId,
      contentItemId: contentItem!.id,
      createdBy: user.sub,
      name: body.name.trim(),
      description: body.description ?? null,
      sceneData: defaultScene,
      settings: defaultSettings,
    }).returning();

    // Back-fill the canvas project ID into the content item metadata so the
    // content library can navigate directly to the canvas editor.
    await db.update(contentItems)
      .set({ metadata: JSON.stringify({ canvasProject: true, canvasProjectId: project!.id }) })
      .where(eq(contentItems.id, contentItem!.id));

    return reply.status(201).send(project);
  });

  // ── PUT /canvas/:id — full save with version check ───────────────────────
  app.put('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as {
      sceneData: unknown;
      settings: unknown;
      version: number;
      name?: string;
      description?: string;
    };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    // Optimistic lock — reject if client version is stale
    if (body.version !== undefined && body.version !== project.version) {
      return reply.status(409).send({
        error: 'This design was updated elsewhere. Please refresh to get the latest version.',
        serverVersion: project.version,
      });
    }

    const updates: Record<string, unknown> = {
      sceneData: body.sceneData,
      settings: body.settings,
      version: (project.version ?? 1) + 1,
      updatedAt: new Date(),
    };
    if (body.name !== undefined) updates['name'] = body.name.trim();
    if (body.description !== undefined) updates['description'] = body.description || null;

    const [updated] = await db.update(canvasProjects)
      .set(updates)
      .where(eq(canvasProjects.id, id))
      .returning();

    // Sync name/description to linked content item
    if (project.contentItemId && (body.name || body.description !== undefined)) {
      const contentUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name) contentUpdates['name'] = body.name.trim();
      if (body.description !== undefined) contentUpdates['description'] = body.description || null;
      await db.update(contentItems)
        .set(contentUpdates)
        .where(eq(contentItems.id, project.contentItemId));
    }

    return reply.send(updated);
  });

  // ── PATCH /canvas/:id/auto-save — lightweight partial save ────────────────
  app.patch('/:id/auto-save', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { sceneData: unknown; settings: unknown };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    await db.update(canvasProjects).set({
      sceneData: body.sceneData,
      settings: body.settings,
      updatedAt: new Date(),
    }).where(eq(canvasProjects.id, id));

    return reply.status(204).send();
  });

  // ── PATCH /canvas/:id — update metadata only ─────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates['name'] = body.name.trim();
    if (body.description !== undefined) updates['description'] = body.description || null;

    const [updated] = await db.update(canvasProjects)
      .set(updates)
      .where(eq(canvasProjects.id, id))
      .returning();

    // Sync to content item
    if (project.contentItemId) {
      await db.update(contentItems).set(updates).where(eq(contentItems.id, project.contentItemId));
    }

    return reply.send(updated);
  });

  // ── DELETE /canvas/:id ───────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const now = new Date();
    await db.update(canvasProjects)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(canvasProjects.id, id));

    // Soft-delete the linked content item too
    if (project.contentItemId) {
      await db.update(contentItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(contentItems.id, project.contentItemId));
    }

    return reply.status(204).send();
  });

  // ── POST /canvas/:id/duplicate ───────────────────────────────────────────
  app.post('/:id/duplicate', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const project = await db.query.canvasProjects.findFirst({
      where: and(eq(canvasProjects.id, id), isNull(canvasProjects.deletedAt)),
    });
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const member = await checkWorkspaceAccess(project.workspaceId, user.sub);
    if (!member) return reply.status(403).send({ error: 'Forbidden' });

    const newName = `${project.name} (Copy)`;
    const settings = project.settings as Record<string, unknown>;
    const w = (settings?.width as number) ?? 1920;
    const h = (settings?.height as number) ?? 1080;

    // Create content item for the clone
    const [contentItem] = await db.insert(contentItems).values({
      workspaceId: project.workspaceId,
      uploadedBy: user.sub,
      type: 'canvas',
      name: newName,
      description: project.description,
      width: w,
      height: h,
      orientation: w >= h ? 'landscape' : 'portrait',
      duration: 10,
      status: 'ready',
      approvalState: 'approved',
      metadata: JSON.stringify({ canvasProject: true }),
    }).returning();

    const [cloned] = await db.insert(canvasProjects).values({
      workspaceId: project.workspaceId,
      contentItemId: contentItem!.id,
      createdBy: user.sub,
      name: newName,
      description: project.description,
      sceneData: project.sceneData,
      settings: project.settings,
    }).returning();

    return reply.status(201).send(cloned);
  });
}
