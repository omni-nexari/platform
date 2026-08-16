import type { FastifyInstance } from 'fastify';

export async function licenseRoutes(app: FastifyInstance) {
  app.get('/status', { onRequest: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      configured: true,
      status: 'ok',
      mode: 'standalone',
      allowedModules: 'both',
      signageTier: 'pro',
      maxScreens: null,
      maxLocations: null,
      expiresAt: null,
      planType: 'standalone',
      features: {
        signage: true,
        syncplay: true,
        videowall: true,
        multiTenant: true,
        pos: true,
      },
    });
  });
}
