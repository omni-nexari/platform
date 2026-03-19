import type { FastifyInstance } from 'fastify';
import { db, smartViews, workspaces } from '@signage/db';
import { CreateSmartViewSchema } from '@signage/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

export async function smartViewsRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, entityType } = req.query as { workspaceId?: string; entityType?: string };

    if (!workspaceId || !entityType) {
      return reply.status(400).send({ error: 'workspaceId and entityType are required' });
    }

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const rows = await db.query.smartViews.findMany({
      where: and(
        eq(smartViews.workspaceId, workspaceId),
        eq(smartViews.entityType, entityType),
      ),
      orderBy: [desc(smartViews.updatedAt), desc(smartViews.createdAt)],
    });

    return reply.send(rows);
  });

  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = CreateSmartViewSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, body.data.workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) return reply.status(404).send({ error: 'Workspace not found' });

    const duplicate = await db.query.smartViews.findFirst({
      where: and(
        eq(smartViews.workspaceId, body.data.workspaceId),
        eq(smartViews.entityType, body.data.entityType),
        eq(smartViews.name, body.data.name),
      ),
    });
    if (duplicate) return reply.status(409).send({ error: 'A smart view with this name already exists' });

    const [created] = await db.insert(smartViews).values({
      workspaceId: body.data.workspaceId,
      entityType: body.data.entityType,
      name: body.data.name,
      filters: body.data.filters,
      createdBy: user.sub,
    }).returning();

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SMART_VIEW_CREATED',
      entityType: 'smart_view',
      entityId: created!.id,
      ipAddress: req.ip,
      meta: { workspaceId: body.data.workspaceId, entityType: body.data.entityType },
    });

    return reply.status(201).send(created);
  });

  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin', 'editor'].includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { id } = req.params as { id: string };

    const existing = await db.query.smartViews.findFirst({
      where: eq(smartViews.id, id),
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Smart view not found' });
    }

    const workspace = await db.query.workspaces.findFirst({
      where: and(
        eq(workspaces.id, existing.workspaceId),
        eq(workspaces.orgId, user.orgId),
        isNull(workspaces.deletedAt),
      ),
    });
    if (!workspace) {
      return reply.status(404).send({ error: 'Smart view not found' });
    }

    await db.delete(smartViews).where(eq(smartViews.id, id));

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'SMART_VIEW_DELETED',
      entityType: 'smart_view',
      entityId: id,
      ipAddress: req.ip,
      meta: { workspaceId: existing.workspaceId, entityType: existing.entityType, name: existing.name },
    });

    return reply.status(204).send();
  });
}
