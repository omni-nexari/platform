import type { FastifyInstance } from 'fastify';
import { db } from '@signage/db';
import { sql } from 'drizzle-orm';
import { getJobMetrics } from '../services/jobs.js';

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

  // ── GET /health/jobs ─ per-job runtime metrics ────────────────────────────
  app.get('/health/jobs', async (_req, reply) => {
    const metrics = getJobMetrics();
    const jobList = Object.entries(metrics).map(([name, m]) => ({
      name,
      lastRunAt:      m.lastRunAt?.toISOString() ?? null,
      lastDurationMs: m.lastDurationMs,
      errorCount:     m.errorCount,
      runCount:       m.runCount,
    }));
    return reply.send({ jobs: jobList });
  });
}
