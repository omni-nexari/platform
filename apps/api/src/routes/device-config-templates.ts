import type { FastifyInstance } from 'fastify';
import { db, deviceConfigTemplates, devices, workspaceMembers } from '@signage/db';
import { eq, and, isNull } from 'drizzle-orm';
import { UpdateDeviceSchema } from '@signage/shared';
import { sendCommand } from '../services/ws.js';

type AuthUser = { sub: string; orgId: string; role: string };

const ADMIN_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'superadmin']);

export async function deviceConfigTemplatesRoutes(app: FastifyInstance) {

  // ── GET /device-config-templates ─────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const templates = await db.query.deviceConfigTemplates.findMany({
      where: eq(deviceConfigTemplates.orgId, user.orgId),
      orderBy: deviceConfigTemplates.createdAt,
    });
    return reply.send(templates);
  });

  // ── POST /device-config-templates ────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const body = req.body as { name?: string; description?: string; config?: Record<string, unknown> };
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });

    const [template] = await db.insert(deviceConfigTemplates).values({
      orgId: user.orgId,
      name: body.name.trim(),
      description: body.description ?? null,
      config: body.config ?? {},
      createdBy: user.sub,
    }).returning();

    return reply.status(201).send(template);
  });

  // ── PATCH /device-config-templates/:id ───────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; config?: Record<string, unknown> };

    const template = await db.query.deviceConfigTemplates.findFirst({
      where: and(eq(deviceConfigTemplates.id, id), eq(deviceConfigTemplates.orgId, user.orgId)),
    });
    if (!template) return reply.status(404).send({ error: 'Template not found' });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch['name'] = body.name.trim();
    if (body.description !== undefined) patch['description'] = body.description;
    if (body.config !== undefined) patch['config'] = body.config;

    const [updated] = await db.update(deviceConfigTemplates)
      .set(patch)
      .where(eq(deviceConfigTemplates.id, id))
      .returning();

    return reply.send(updated);
  });

  // ── DELETE /device-config-templates/:id ──────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const template = await db.query.deviceConfigTemplates.findFirst({
      where: and(eq(deviceConfigTemplates.id, id), eq(deviceConfigTemplates.orgId, user.orgId)),
    });
    if (!template) return reply.status(404).send({ error: 'Template not found' });

    await db.delete(deviceConfigTemplates).where(eq(deviceConfigTemplates.id, id));
    return reply.send({ ok: true });
  });

  // ── POST /device-config-templates/:id/apply ───────────────────────────────
  app.post('/:id/apply', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const body = req.body as { deviceIds?: string[] };
    if (!body.deviceIds || body.deviceIds.length === 0) {
      return reply.status(400).send({ error: 'deviceIds required' });
    }

    const template = await db.query.deviceConfigTemplates.findFirst({
      where: and(eq(deviceConfigTemplates.id, id), eq(deviceConfigTemplates.orgId, user.orgId)),
    });
    if (!template) return reply.status(404).send({ error: 'Template not found' });

    const parsed = UpdateDeviceSchema.safeParse(template.config);
    if (!parsed.success) return reply.status(400).send({ error: 'Template config invalid', details: parsed.error.flatten() });

    const targetDevices = await db.query.devices.findMany({
      where: and(
        eq(devices.orgId, user.orgId),
        isNull(devices.deletedAt),
      ),
      columns: { id: true, workspaceId: true },
    });
    const deviceSet = new Set(body.deviceIds);
    const eligible = targetDevices.filter(d => deviceSet.has(d.id));

    if (eligible.length === 0) return reply.status(404).send({ error: 'No matching devices found' });

    const configPatch = parsed.data as Record<string, unknown>;
    const patchForDb: Record<string, unknown> = { updatedAt: new Date() };
    const allowedFields = ['timezone', 'screenOrientation', 'irLock', 'buttonLock', 'autoPowerOn',
      'screenshotIntervalMin', 'ntpEnabled', 'ntpServer', 'ntpTimezone', 'alertThresholds'];

    for (const key of allowedFields) {
      if (key in configPatch) patchForDb[key] = configPatch[key];
    }

    // Apply to each device
    await Promise.all(
      eligible.map(async (device) => {
        await db.update(devices).set(patchForDb).where(eq(devices.id, device.id));

        // Send WS commands for NTP / IR lock / button lock if included
        if ('ntpServer' in configPatch || 'ntpTimezone' in configPatch) {
          const server   = configPatch['ntpServer']   as string | undefined;
          const timezone = configPatch['ntpTimezone'] as string | undefined;
          if (server && timezone) {
            sendCommand(device.id, { type: 'set_ntp', payload: { server, timezone } });
          }
        }
        if ('irLock' in configPatch) {
          sendCommand(device.id, { type: 'set_ir_lock', payload: { lock: configPatch['irLock'] as boolean } });
        }
        if ('buttonLock' in configPatch) {
          sendCommand(device.id, { type: 'set_button_lock', payload: { lock: configPatch['buttonLock'] as boolean } });
        }
      }),
    );

    return reply.send({ applied: eligible.length, deviceIds: eligible.map(d => d.id) });
  });
}
