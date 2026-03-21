import type { FastifyInstance } from 'fastify';
import { db, notifications as notifTable } from '@signage/db';
import { eq, and, isNull, desc, sql, count } from 'drizzle-orm';
import { z } from 'zod';
import { registerBrowserClient, unregisterBrowserClient } from '../services/notifications.js';

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

function isMissingNotificationPrefsTable(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === '42P01',
  );
}

const DEFAULT_PREFS: PrefRow[] = EVENT_KEYS.map((k) => ({
  event_key: k,
  in_app: true,
  email_notify: false,
}));

export async function notificationsRoutes(app: FastifyInstance) {

  // ── GET /notifications/ws ─ browser realtime notification stream ─────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/ws', { websocket: true }, async (socket: any, req: any) => {
    const token = req.cookies?.access_token as string | undefined;
    if (!token) {
      socket.close(4001, 'Missing auth cookie');
      return;
    }

    let payload: { sub: string; orgId: string; role: string };
    try {
      payload = app.jwt.verify<{ sub: string; orgId: string; role: string }>(token);
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    registerBrowserClient(
      payload.sub,
      socket as { send: (d: string) => void; close: () => void; readyState: number },
    );

    socket.on('close', () => {
      unregisterBrowserClient(
        payload.sub,
        socket as { send: (d: string) => void; close: () => void; readyState: number },
      );
    });
  });

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

    let rows: PrefRow[] = [];
    try {
      rows = await db.execute(sql`
        SELECT event_key, in_app, email_notify
        FROM notification_prefs
        WHERE user_id = ${actor.sub}
      `) as unknown as PrefRow[];
    } catch (error) {
      if (!isMissingNotificationPrefsTable(error)) throw error;
      return reply.send({ prefs: DEFAULT_PREFS });
    }

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
      try {
        await db.execute(sql`
          INSERT INTO notification_prefs (user_id, event_key, in_app, email_notify, updated_at)
          VALUES (${actor.sub}, ${pref.eventKey}, ${pref.inApp}, ${pref.email}, NOW())
          ON CONFLICT (user_id, event_key) DO UPDATE
            SET in_app = ${pref.inApp}, email_notify = ${pref.email}, updated_at = NOW()
        `);
      } catch (error) {
        if (!isMissingNotificationPrefsTable(error)) throw error;
        return reply.status(503).send({ error: 'notification_prefs table is missing; run DB migrations' });
      }
    }

    return reply.send({ ok: true });
  });
}

