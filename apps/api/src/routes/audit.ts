import type { FastifyInstance } from 'fastify';
import { db } from '@signage/db';
import { sql } from 'drizzle-orm';

type AuthUser = { sub: string; orgId: string; role: string };

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_type: string;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  meta: string;
  ip_address: string | null;
  created_at: string;
};

type ActorRow = { id: string; name: string | null };
type CountRow = { total: string };

export async function auditRoutes(app: FastifyInstance) {

  // ── GET /audit?page=&limit=&actorId= ───────────────────────────────────────
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const q = req.query as { page?: string; limit?: string; actorId?: string };

    const page = Math.max(1, parseInt(q.page ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20')));
    const offset = (page - 1) * limit;

    const [countRow] = await db.execute(sql`
      SELECT COUNT(*)::text AS total
      FROM audit_log
      WHERE org_id = ${actor.orgId}
      ${q.actorId ? sql`AND actor_id = ${q.actorId}` : sql``}
    `) as unknown as CountRow[];

    const entries = await db.execute(sql`
      SELECT
        al.id, al.actor_id, al.actor_type,
        u.name AS actor_name,
        al.action, al.entity_type, al.entity_id,
        al.meta, al.ip_address, al.created_at
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.actor_id
      WHERE al.org_id = ${actor.orgId}
      ${q.actorId ? sql`AND al.actor_id = ${q.actorId}` : sql``}
      ORDER BY al.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `) as unknown as AuditRow[];

    return reply.send({
      entries,
      total: parseInt(countRow?.total ?? '0'),
      page,
      limit,
    });
  });

  // ── GET /audit/actors ──────────────────────────────────────────────────────
  // Distinct actors who appear in this org's audit log (for filter dropdown)
  app.get('/actors', { onRequest: [app.authenticate] }, async (req, reply) => {
    const actor = req.user as AuthUser;

    const actors = await db.execute(sql`
      SELECT DISTINCT u.id, u.name
      FROM audit_log al
      JOIN users u ON u.id = al.actor_id
      WHERE al.org_id = ${actor.orgId}
        AND al.actor_id IS NOT NULL
      ORDER BY u.name
    `) as unknown as ActorRow[];

    return reply.send({ actors });
  });
}
