import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registerSwagger } from './swagger.js';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import { getRedis, isAccessTokenRevoked } from '../services/redis.js';

const CSRF_COOKIE = 'csrf_token';
const SA_ACCESS_COOKIE = 'sa_access_token';
const SA_CSRF_COOKIE = 'sa_csrf_token';

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
  await registerSwagger(app);

  const allowedOrigins = getAllowedOrigins();
  const jwtSecret = process.env['JWT_SECRET'];
  const shouldLogAuthDiagnostics = process.env['NODE_ENV'] !== 'production';

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // API-only; CSP handled by web app
    frameguard: false,            // Allow kiosk/kitchen pages to be embedded in TV iframes
  });

  await app.register(fastifyCors, {
    origin(origin, callback) {
      // No origin header (server-to-server, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Tizen / packaged .wgt apps send Origin: "null" (file:// equivalent)
      // Also allow any file:// or app:// scheme used by local TV apps
      if (
        origin === 'null' ||
        origin.startsWith('file://') ||
        origin.startsWith('app://')
      ) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      // In development, allow any private-network origin (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      // so the DS app is reachable from LAN IPs (e.g. http://192.168.1.110:5173).
      if (process.env['NODE_ENV'] !== 'production') {
        try {
          const { hostname } = new URL(origin);
          if (
            /^192\.168\./.test(hostname) ||
            /^10\./.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
          ) {
            callback(null, true);
            return;
          }
        } catch { /* invalid origin URL — fall through to deny */ }
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
    max: 600,
    timeWindow: '1 minute',
    redis: getRedis() ?? undefined,
  });

  await app.register(fastifyWebsocket);

  await app.register(fastifyMultipart, {
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
  });

  function getSessionCookieNames(req: FastifyRequest) {
    if (req.url.startsWith('/superadmin')) {
      return {
        accessCookie: SA_ACCESS_COOKIE,
        refreshCookie: null,
        csrfCookie: SA_CSRF_COOKIE,
      };
    }

    return {
      accessCookie: 'access_token',
      refreshCookie: 'refresh_token',
      csrfCookie: CSRF_COOKIE,
    };
  }

  function requiresCsrf(req: FastifyRequest) {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
    const sessionCookies = getSessionCookieNames(req);
    const hasCookieSession = Boolean(
      req.cookies?.[sessionCookies.accessCookie]
      || (sessionCookies.refreshCookie ? req.cookies?.[sessionCookies.refreshCookie] : undefined),
    );
    const hasAuthorizationHeader = Boolean(req.headers.authorization);
    return hasCookieSession && !hasAuthorizationHeader;
  }

  async function verifyCsrf(req: FastifyRequest, reply: FastifyReply) {
    if (!requiresCsrf(req)) return;
    const { csrfCookie } = getSessionCookieNames(req);
    const cookieToken = req.cookies?.[csrfCookie];
    const headerToken = req.headers['x-csrf-token'];
    const normalizedHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (!cookieToken || !normalizedHeader || cookieToken !== normalizedHeader) {
      return reply.status(403).send({ error: 'Invalid CSRF token' });
    }
  }

  async function verifyPortalJwt(req: FastifyRequest, reply: FastifyReply) {
    const authorization = req.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : null;
    const cookieToken = req.cookies?.[SA_ACCESS_COOKIE];
    const token = bearerToken || cookieToken;

    if (!token) {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }

    try {
      const payload = app.jwt.verify(token);
      (req as FastifyRequest & { user: unknown }).user = payload;
      return payload as { type?: string };
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }
  }

  app.decorate('verifyCsrf', verifyCsrf);

  // Decorate with authenticate hook used by protected routes
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const payload = req.user as { sub?: string; iat?: number };
      if (payload?.sub && typeof payload.iat === 'number') {
        const revoked = await isAccessTokenRevoked(payload.sub, payload.iat);
        if (revoked) return reply.status(401).send({ error: 'Unauthorized' });
      }
      const csrfResult = await verifyCsrf(req, reply);
      if (csrfResult) return csrfResult;
    } catch (error) {
      if (shouldLogAuthDiagnostics && req.url.startsWith('/auth/')) {
        req.log.warn({
          url: req.url,
          method: req.method,
          hasCookieHeader: Boolean(req.headers.cookie),
          cookieKeys: Object.keys(req.cookies ?? {}),
          hasAccessCookie: Boolean(req.cookies?.access_token),
          hasRefreshCookie: Boolean(req.cookies?.refresh_token),
          hasAuthorizationHeader: Boolean(req.headers.authorization),
          authError: error instanceof Error ? error.message : String(error),
        }, 'Auth cookie verification failed');
      }
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Platform owner — strict (was 'super_admin', now 'platform_owner')
  app.decorate('authenticatePlatformOwner', async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = await verifyPortalJwt(req, reply);
    if (!payload) return;
    const csrfResult = await verifyCsrf(req, reply);
    if (csrfResult) return csrfResult;
    if (payload.type !== 'platform_owner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // Management company admin — strict
  app.decorate(
    'authenticateManagementCompanyAdmin',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const payload = await verifyPortalJwt(req, reply);
      if (!payload) return;
      const csrfResult = await verifyCsrf(req, reply);
      if (csrfResult) return csrfResult;
      if (payload.type !== 'management_company_admin') {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    },
  );

  // Platform admin — accepts platform_owner OR management_company_admin
  app.decorate('authenticatePlatformAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = await verifyPortalJwt(req, reply);
    if (!payload) return;
    const csrfResult = await verifyCsrf(req, reply);
    if (csrfResult) return csrfResult;
    if (
      payload.type !== 'platform_owner' &&
      payload.type !== 'management_company_admin'
    ) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  // Backward-compat alias (used by existing routes before rename)
  app.decorate('authenticateSuperAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = await verifyPortalJwt(req, reply);
    if (!payload) return;
    const csrfResult = await verifyCsrf(req, reply);
    if (csrfResult) return csrfResult;
    if (payload.type !== 'platform_owner') {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });
}
