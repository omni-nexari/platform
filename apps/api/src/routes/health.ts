import type { FastifyInstance } from 'fastify';
import { db } from '@signage/db';
import { sql } from 'drizzle-orm';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    let dbStatus = 'ok';
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbStatus = 'error';
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded';
    return reply
      .status(status === 'ok' ? 200 : 503)
      .send({
        status,
        db: dbStatus,
        uptime_s: Math.floor(process.uptime()),
        version: process.env['npm_package_version'] ?? '0.1.0',
      });
  });
}
