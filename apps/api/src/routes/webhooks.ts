import type { FastifyInstance } from 'fastify';
import { db, outboundWebhooks, webhookDeliveries } from '@signage/db';
import { eq, and, desc } from 'drizzle-orm';
import { generateWebhookSecret, signWebhookPayload, type WebhookEventType } from '../services/webhooks.js';
import { writeAuditLog } from '../services/audit.js';

type AuthUser = { sub: string; orgId: string; role: string };

const ADMIN_ROLES = new Set(['prime_owner', 'owner', 'admin', 'a-manager', 'superadmin']);

/** All supported outbound event types */
export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'device.offline',
  'device.online',
  'device.command',
  'content.published',
  'playlist.published',
  'schedule.activated',
  'schedule.deactivated',
  'emergency.activated',
  'emergency.cleared',
  'sensor.reading',
  'trigger.fired',
  'play_event.created',
];

export async function webhooksRoutes(app: FastifyInstance) {

  // ── GET /webhooks — list org webhooks ─────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const hooks = await db.query.outboundWebhooks.findMany({
      where: eq(outboundWebhooks.orgId, user.orgId),
      orderBy: [desc(outboundWebhooks.createdAt)],
    });
    // Never expose secrets in list
    return reply.send(hooks.map(({ secret: _s, ...h }) => h));
  });

  // ── GET /webhooks/events — list all subscribable event types ──────────────
  app.get('/events', { onRequest: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ events: WEBHOOK_EVENT_TYPES });
  });

  // ── GET /webhooks/:id — single webhook (no secret) ────────────────────────
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });
    const { secret: _s, ...rest } = hook;
    return reply.send(rest);
  });

  // ── POST /webhooks — create ───────────────────────────────────────────────
  app.post('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const body = req.body as { name?: string; url?: string; events?: string[] };
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name required' });
    if (!body.url?.trim())  return reply.status(400).send({ error: 'url required' });

    try { new URL(body.url); }
    catch { return reply.status(400).send({ error: 'url must be a valid HTTPS URL' }); }

    const invalidEvents = (body.events ?? []).filter(e => !WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType));
    if (invalidEvents.length > 0) {
      return reply.status(400).send({ error: `Unknown event types: ${invalidEvents.join(', ')}` });
    }

    const secret = generateWebhookSecret();
    const [hook] = await db.insert(outboundWebhooks).values({
      orgId:     user.orgId,
      name:      body.name.trim(),
      url:       body.url.trim(),
      secret,
      events:    body.events ?? [],
      createdBy: user.sub,
    }).returning();

    // Return secret only on creation
    void writeAuditLog({ orgId: user.orgId, actorId: user.sub, action: 'WEBHOOK_CREATED', entityType: 'outbound_webhook', entityId: hook?.id ?? null, meta: { name: body.name, url: body.url }, ipAddress: req.ip });
    return reply.status(201).send({ ...(hook ?? {}) });
  });

  // ── PATCH /webhooks/:id — update ──────────────────────────────────────────
  app.patch('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; url?: string; events?: string[]; isActive?: boolean };

    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });

    if (body.url) {
      try { new URL(body.url); }
      catch { return reply.status(400).send({ error: 'url must be a valid URL' }); }
    }
    if (body.events) {
      const invalid = body.events.filter(e => !WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType));
      if (invalid.length > 0) return reply.status(400).send({ error: `Unknown event types: ${invalid.join(', ')}` });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name     !== undefined) patch['name']     = body.name.trim();
    if (body.url      !== undefined) patch['url']      = body.url.trim();
    if (body.events   !== undefined) patch['events']   = body.events;
    if (body.isActive !== undefined) patch['isActive'] = body.isActive;

    const [updated] = await db.update(outboundWebhooks).set(patch).where(eq(outboundWebhooks.id, id)).returning();
    const { secret: _s, ...rest } = updated!;
    return reply.send(rest);
  });

  // ── POST /webhooks/:id/rotate-secret — regenerate signing secret ──────────
  app.post('/:id/rotate-secret', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });

    const secret = generateWebhookSecret();
    const [updated] = await db.update(outboundWebhooks)
      .set({ secret, updatedAt: new Date() })
      .where(eq(outboundWebhooks.id, id))
      .returning();

    void writeAuditLog({ orgId: user.orgId, actorId: user.sub, action: 'WEBHOOK_SECRET_ROTATED', entityType: 'outbound_webhook', entityId: id, ipAddress: req.ip });
    return reply.send({ id: updated!.id, secret });
  });

  // ── DELETE /webhooks/:id ──────────────────────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });

    await db.delete(outboundWebhooks).where(eq(outboundWebhooks.id, id));
    void writeAuditLog({ orgId: user.orgId, actorId: user.sub, action: 'WEBHOOK_DELETED', entityType: 'outbound_webhook', entityId: id, meta: { name: hook.name }, ipAddress: req.ip });
    return reply.send({ ok: true });
  });

  // ── POST /webhooks/:id/test — send a test delivery ────────────────────────
  app.post('/:id/test', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!ADMIN_ROLES.has(user.role)) return reply.status(403).send({ error: 'Forbidden' });

    const { id } = req.params as { id: string };
    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });

    const testPayload = JSON.stringify({
      event:     'webhook.test',
      timestamp: new Date().toISOString(),
      message:   'This is a test delivery from OmniHub Signage',
      orgId:     user.orgId,
      webhookId: id,
    });

    let status: number | null = null;
    let body: string | null = null;
    let ok = false;

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type':        'application/json',
          'X-Signage-Signature': signWebhookPayload(hook.secret, testPayload),
          'X-Signage-Event':     'webhook.test',
          'X-Signage-Attempt':   '1',
        },
        body: testPayload,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      body   = await res.text().catch(() => null);
      ok     = res.ok;
    } catch (err) {
      body = err instanceof Error ? err.message : String(err);
    }

    return reply.send({ ok, responseStatus: status, responseBody: body });
  });

  // ── GET /webhooks/:id/deliveries — delivery log ───────────────────────────
  app.get('/:id/deliveries', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; status?: string };

    const hook = await db.query.outboundWebhooks.findFirst({
      where: and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.orgId, user.orgId)),
    });
    if (!hook) return reply.status(404).send({ error: 'Not found' });

    const limit = Math.min(Number(q.limit ?? 50), 200);
    const deliveries = await db.query.webhookDeliveries.findMany({
      where: and(
        eq(webhookDeliveries.webhookId, id),
        q.status ? eq(webhookDeliveries.status, q.status) : undefined,
      ),
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit,
    });

    return reply.send(deliveries);
  });
}
