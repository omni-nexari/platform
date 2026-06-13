/**
 * License status — read-only endpoint the frontend polls to show a banner when
 * the instance's license is in grace/overlimit/suspended/revoked state.
 *
 * The actual state is owned by the license heartbeat client; this route just
 * surfaces the last-known value to authenticated users.
 */
import type { FastifyInstance } from 'fastify';
import { getLicenseState } from '../services/license-client.js';

export async function licenseRoutes(app: FastifyInstance) {
  // ── GET /license/status ─────────────────────────────────────────────────────
  app.get('/status', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const state = getLicenseState();
    if (!state) {
      // No license configured (self-hosted dev / internal) — report unlimited.
      return reply.send({ configured: false, status: 'ok' });
    }
    return reply.send({
      configured: true,
      status: state.status,
      maxScreens: state.maxScreens,
      gracePct: state.gracePct,
      checkedAt: state.checkedAt,
    });
  });
}
