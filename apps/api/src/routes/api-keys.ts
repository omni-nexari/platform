import type { FastifyInstance } from 'fastify';
import { db, apiKeys } from '@signage/db';
import { eq, and, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';

type AuthUser = { sub: string; orgId: string; role: string };

const SCOPES = [
  'content:read',
  'content:write',
  'schedules:read',
  'schedules:write',
  'devices:read',
  'sensor:write',
  'analytics:read',
  'player:deploy',
] as const;

function generateKey() {
  const hex = randomBytes(16).toString('hex');
  const rawKey = `sk_live_${hex}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = `sk_live_${hex.substring(0, 8)}`;
  return { rawKey, keyHash, keyPrefix };
}

export async function apiKeysRoutes(app: FastifyInstance) {

  // ── GET /api-keys?workspaceId= ─────────────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as { workspaceId?: string };

    const condition = q.workspaceId
      ? and(
          eq(apiKeys.orgId, actor.orgId),
          or(eq(apiKeys.workspaceId, q.workspaceId), isNull(apiKeys.workspaceId)),
        )
      : and(eq(apiKeys.orgId, actor.orgId), isNull(apiKeys.workspaceId));

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        workspaceId: apiKeys.workspaceId,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(condition)
      .orderBy(apiKeys.createdAt);

    return reply.send({ keys });
  });

  // ── POST /api-keys ─────────────────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const body = z
      .object({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(SCOPES)).min(1),
        workspaceId: z.string().uuid().optional(),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { rawKey, keyHash, keyPrefix } = generateKey();
    const expiresAt = body.data.expiresInDays
      ? new Date(Date.now() + body.data.expiresInDays * 86400000)
      : null;

    const [key] = await db
      .insert(apiKeys)
      .values({
        orgId: actor.orgId,
        workspaceId: body.data.workspaceId ?? null,
        createdBy: actor.sub,
        name: body.data.name,
        keyHash,
        keyPrefix,
        scopes: body.data.scopes.join(' '),
        expiresAt,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        workspaceId: apiKeys.workspaceId,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      });

    // rawKey is returned once — client must copy it; we only store the hash
    return reply.status(201).send({ key: { ...key, rawKey } });
  });

  // ── PATCH /api-keys/:id/revoke ─────────────────────────────────────────────
  app.patch('/:id/revoke', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, actor.orgId)));
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    const [key] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(apiKeys.id, id))
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        revokedAt: apiKeys.revokedAt,
      });

    return reply.send({ key });
  });

  // ── DELETE /api-keys/:id ───────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, actor.orgId)));
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return reply.status(204).send();
  });
}
