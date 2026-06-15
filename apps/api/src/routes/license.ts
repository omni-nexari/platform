/**
 * License status — read-only endpoint the frontend polls to show a banner when
 * the instance's license is in grace/overlimit/suspended/revoked state, and to
 * know which features are available for the current plan tier.
 *
 * The actual state is owned by the license heartbeat client; this route just
 * surfaces the last-known value to authenticated users.
 */
import type { FastifyInstance } from 'fastify';
import {
  getLicenseState,
  canUseSyncPlay,
  canUseVideoWalls,
  canUseMultiTenant,
  canUsePOS,
} from '../services/license-client.js';

export async function licenseRoutes(app: FastifyInstance) {
  // ── GET /license/status ─────────────────────────────────────────────────────
  app.get('/status', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const state = getLicenseState();
    if (!state) {
      // No license configured (self-hosted dev / internal) — report unlicensed/trial.
      return reply.send({
        configured: false,
        status: 'trial',
        // Feature availability: all restricted in trial mode
        features: {
          syncplay: false,
          videowall: false,
          multiTenant: false,
          pos: false,
        },
        trial: {
          maxScreens: 3,
          days: 60,
        },
      });
    }
    return reply.send({
      configured: true,
      status: state.status,
      allowedModules: state.allowedModules,
      signageTier: state.signageTier,
      maxScreens: state.maxScreens,
      maxLocations: state.maxLocations,
      gracePct: state.gracePct,
      checkedAt: state.checkedAt,
      // Pre-computed feature flags so the frontend doesn't need to re-implement tier logic
      features: {
        syncplay: canUseSyncPlay(),
        videowall: canUseVideoWalls(),
        multiTenant: canUseMultiTenant(),
        pos: canUsePOS(),
      },
    });
  });
}
