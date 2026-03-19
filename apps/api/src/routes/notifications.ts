import type { FastifyInstance } from 'fastify';
import { db, notifications as notifTable } from '@signage/db';
import { eq, and, isNull, desc, sql, count } from 'drizzle-orm';
import { z } from 'zod';

type AuthUser = { sub: string; orgId: string; role: string };

const EVENT_KEYS = [
  'device_offline',
  'device_online',
  'content_failed',
  'storage_warning',
  'content_expiring',
  'emergency_activated',
  'sensor_rule_fired',
  'invitation_accepted',
] as const;

type PrefRow = { event_key: string; in_app: boolean; email_notify: boolean };

const DEFAULT_PREFS: PrefRow[] = EVENT_KEYS.map((k) => ({
  event_key: k,
  in_app: true,
  email_notify: false,
}));

export async function notificationsRoutes(app: FastifyInstance) {

  // ── GET /notifications?page=&limit= ───────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as { page?: string; limit?: string };

    const page = Math.max(1, parseInt(q.page ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20')));
    const offset = (page - 1) * limit;

    const base = and(
      eq(notifTable.userId, actor.sub),
      eq(notifTable.dismissed, false),
    );

    const items = await db
      .select()
      .from(notifTable)
      .where(base)
      .orderBy(desc(notifTable.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db.select({ total: count() }).from(notifTable).where(base);
    const unreadRows = await db
      .select({ unread: count() })
      .from(notifTable)
      .where(and(eq(notifTable.userId, actor.sub), eq(notifTable.dismissed, false), isNull(notifTable.readAt)));

    return reply.send({
      notifications: items,
      total: Number(totalRows[0]?.total ?? 0),
      unreadCount: Number(unreadRows[0]?.unread ?? 0),
      page,
      limit,
    });
  });

  // ── PATCH /notifications/:id/read ─────────────────────────────────────────
  app.patch('/:id/read', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: notifTable.id })
      .from(notifTable)
      .where(and(eq(notifTable.id, id), eq(notifTable.userId, actor.sub)));
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    const [updated] = await db
      .update(notifTable)
      .set({ readAt: new Date() })
      .where(eq(notifTable.id, id))
      .returning();

    return reply.send({ notification: updated });
  });

  // ── POST /notifications/mark-all-read ─────────────────────────────────────
  app.post('/mark-all-read', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;

    await db
      .update(notifTable)
      .set({ readAt: new Date() })
      .where(and(eq(notifTable.userId, actor.sub), isNull(notifTable.readAt)));

    return reply.send({ ok: true });
  });

  // ── DELETE /notifications/:id (dismiss) ───────────────────────────────────
  app.delete('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: notifTable.id })
      .from(notifTable)
      .where(and(eq(notifTable.id, id), eq(notifTable.userId, actor.sub)));
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    await db.update(notifTable).set({ dismissed: true }).where(eq(notifTable.id, id));
    return reply.status(204).send();
  });

  // ── GET /notifications/prefs ──────────────────────────────────────────────
  app.get('/prefs', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;

    const rows = await db.execute(sql`
      SELECT event_key, in_app, email_notify
      FROM notification_prefs
      WHERE user_id = ${actor.sub}
    `) as unknown as PrefRow[];

    const prefMap = new Map(rows.map((r) => [r.event_key, r]));
    const prefs = EVENT_KEYS.map(
      (k) => prefMap.get(k) ?? DEFAULT_PREFS.find((d) => d.event_key === k)!,
    );

    return reply.send({ prefs });
  });

  // ── PUT /notifications/prefs ──────────────────────────────────────────────
  app.put('/prefs', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const body = z
      .object({
        prefs: z
          .array(
            z.object({
              eventKey: z.string(),
              inApp: z.boolean(),
              email: z.boolean(),
            }),
          )
          .min(1),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    for (const pref of body.data.prefs) {
      await db.execute(sql`
        INSERT INTO notification_prefs (user_id, event_key, in_app, email_notify, updated_at)
        VALUES (${actor.sub}, ${pref.eventKey}, ${pref.inApp}, ${pref.email}, NOW())
        ON CONFLICT (user_id, event_key) DO UPDATE
          SET in_app = ${pref.inApp}, email_notify = ${pref.email}, updated_at = NOW()
      `);
    }

    return reply.send({ ok: true });
  });
}
