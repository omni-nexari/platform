import type { FastifyInstance } from 'fastify';
import {
  getLicenseState,
  canUseSignage,
  canUseSyncPlay,
  canUseVideoWalls,
  canUseMultiTenant,
  canUsePOS,
} from '../services/license-client.js';

export async function licenseRoutes(app: FastifyInstance) {
  // ── GET /license/status ─────────────────────────────────────────────────────
  app.get('/status', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const state = getLicenseState();

    // After boot, getLicenseState() always returns the trial state when no paid
    // license is configured.  The !state branch is a safety fallback for the
    // very short window between server start and async trial-state loading.
    if (!state) {
      return reply.send({
        configured: false,
        status: 'trial',
        features: {
          signage: true,
          syncplay: false,
          videowall: false,
          multiTenant: false,
          pos: false,
        },
        trial: {
          maxScreens: 3,
          days: 60,
          expiresAt: null,
        },
      });
    }

    const isTrialMode = state.source === 'trial';

    return reply.send({
      configured: !isTrialMode,
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
      ...(isTrialMode && {
        trial: {
          maxScreens: state.maxScreens ?? 3,
          days: 60,
          expiresAt: state.expiresAt,
        },
      }),
      features: {
        signage: canUseSignage(),
        syncplay: canUseSyncPlay(),
        videowall: canUseVideoWalls(),
        multiTenant: canUseMultiTenant(),
        pos: canUsePOS(),
      },
    });
  });
}
