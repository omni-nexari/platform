import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '');
}

function getAllowedOrigins(): Set<string> {
  const configuredAppUrl = process.env['APP_URL'] ?? 'https://ds.chiho.app';
  const extraOrigins = (process.env['APP_EXTRA_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    normalizeOrigin(configuredAppUrl),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...extraOrigins.map(normalizeOrigin),
  ]);
}

export async function registerPlugins(app: FastifyInstance) {
  const allowedOrigins = getAllowedOrigins();
  const jwtSecret = process.env['JWT_SECRET'];

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // API-only; CSP handled by web app
  });

  await app.register(fastifyCors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: { cookieName: 'access_token', signed: false },
    sign: { expiresIn: '15m' },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(fastifyWebsocket);

  await app.register(fastifyMultipart, {
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
  });

  // Decorate with authenticate hook used by protected routes
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Platform owner — strict (was 'super_admin', now 'platform_owner')
  app.decorate('authenticatePlatformOwner', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const payload = req.user as { type?: string };
      if (payload.type !== 'platform_owner') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Management company admin — strict
  app.decorate(
    'authenticateManagementCompanyAdmin',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
        const payload = req.user as { type?: string };
        if (payload.type !== 'management_company_admin') {
          return reply.status(403).send({ error: 'Forbidden' });
        }
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  );

  // Platform admin — accepts platform_owner OR management_company_admin
  app.decorate('authenticatePlatformAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const payload = req.user as { type?: string };
      if (
        payload.type !== 'platform_owner' &&
        payload.type !== 'management_company_admin'
      ) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Backward-compat alias (used by existing routes before rename)
  app.decorate('authenticateSuperAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const payload = req.user as { type?: string };
      if (payload.type !== 'platform_owner') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}
