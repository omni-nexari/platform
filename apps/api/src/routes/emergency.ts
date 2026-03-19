import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, emergencyOverrides, devices } from '@signage/db';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { broadcastToDevices } from '../services/ws.js';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

export async function emergencyRoutes(app: FastifyInstance) {
  // ── POST /emergency ─ activate an emergency override ──────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const body = z
      .object({
        scope: z.enum(['org', 'workspace', 'tag', 'device']).default('org'),
        scopeId: z.string().optional(),
        contentType: z.enum(['text', 'media']).default('text'),
        contentText: z.string().min(1).max(1000).optional(),
        autoClearAt: z.string().datetime().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    if (body.data.contentType === 'text' && !body.data.contentText) {
      return reply.status(400).send({ error: 'contentText required when contentType is text' });
    }

    const [override] = await db
      .insert(emergencyOverrides)
      .values({
        orgId: user.orgId,
        createdBy: user.sub,
        scope: body.data.scope,
        scopeId: body.data.scopeId ?? null,
        contentType: body.data.contentType,
        contentText: body.data.contentText ?? null,
        autoClearAt: body.data.autoClearAt ? new Date(body.data.autoClearAt) : null,
      })
      .returning();

    // Determine which devices to broadcast to
    const affectedDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        isNull(devices.deletedAt),
        body.data.scope === 'workspace' && body.data.scopeId
          ? eq(devices.workspaceId, body.data.scopeId)
          : body.data.scope === 'device' && body.data.scopeId
            ? eq(devices.id, body.data.scopeId)
            : undefined,
      ),
    });

    broadcastToDevices(affectedDevices.map((d) => d.id), {
      type: 'emergency_start',
      payload: {
        ...(body.data.contentText != null ? { text: body.data.contentText } : {}),
      },
    });

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'EMERGENCY_ACTIVATED',
      entityType: 'emergency_override',
      entityId: override!.id,
      meta: { scope: body.data.scope, affectedDevices: affectedDevices.length },
      ipAddress: req.ip,
    });

    return reply.status(201).send(override);
  });

  // ── GET /emergency ─ list active overrides for the org ────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const active = await db.query.emergencyOverrides.findMany({
      where: and(
        eq(emergencyOverrides.orgId, user.orgId),
        isNull(emergencyOverrides.clearedAt),
      ),
      orderBy: [desc(emergencyOverrides.createdAt)],
    });
    return reply.send(active);
  });

  // ── DELETE /emergency/:id ─ clear an override ──────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    if (!['owner', 'admin'].includes(user.role))
      return reply.status(403).send({ error: 'Forbidden' });

    const override = await db.query.emergencyOverrides.findFirst({
      where: and(
        eq(emergencyOverrides.id, id),
        eq(emergencyOverrides.orgId, user.orgId),
        isNull(emergencyOverrides.clearedAt),
      ),
    });
    if (!override) return reply.status(404).send({ error: 'Active override not found' });

    await db
      .update(emergencyOverrides)
      .set({ clearedAt: new Date(), clearedBy: user.sub, updatedAt: new Date() })
      .where(eq(emergencyOverrides.id, id));

    const affectedDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        isNull(devices.deletedAt),
        override.scope === 'workspace' && override.scopeId
          ? eq(devices.workspaceId, override.scopeId)
          : override.scope === 'device' && override.scopeId
            ? eq(devices.id, override.scopeId)
            : undefined,
      ),
    });

    broadcastToDevices(affectedDevices.map((d) => d.id), { type: 'emergency_clear' });

    await writeAuditLog({
      orgId: user.orgId,
      actorId: user.sub,
      action: 'EMERGENCY_CLEARED',
      entityType: 'emergency_override',
      entityId: id,
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });
}
