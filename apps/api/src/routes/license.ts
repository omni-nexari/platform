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
      return reply.send({
        configured: false,
        status: 'trial',
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
      posScreensPerLocation: state.posScreensPerLocation,
      gracePct: state.gracePct,
      expiresAt: state.expiresAt,
      billingPeriod: state.billingPeriod,
      planType: state.planType,
      source: state.source,
      checkedAt: state.checkedAt,
      features: {
        syncplay: canUseSyncPlay(),
        videowall: canUseVideoWalls(),
        multiTenant: canUseMultiTenant(),
        pos: canUsePOS(),
      },
    });
  });
}
