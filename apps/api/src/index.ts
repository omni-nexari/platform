import Fastify, { type FastifyBaseLogger, type FastifyRequest, type FastifyReply } from 'fastify';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import fastifyStatic from '@fastify/static';
import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { startLogCleanup } from './services/log-cleanup.js';
import { startLogAlerts } from './services/log-alert.js';
import { startJobs } from './services/jobs.js';
import { startLicenseHeartbeat } from './services/license-client.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import { closeQueues } from './queues/index.js';
import { createPinoDbStream } from './services/pino-db-stream.js';
import { warmupOllama } from './services/ollama.js';
import { resetOnlineStatuses } from './services/ws.js';

// DS production build — served at port 3000 so the TV doesn't need port 5174 open in firewall
const _dir = dirname(fileURLToPath(import.meta.url));
const dsDist = resolve(_dir, '../../../apps/ds/dist');

const PORT = Number(process.env['API_PORT'] ?? 3000);

async function start() {
  const isDev = process.env['NODE_ENV'] !== 'production';

  // Build a multistream logger:
  //   stream 1 → stdout (pretty in dev, JSON in prod)
  //   stream 2 → DB insertion for warn/error only
  const dbStream = createPinoDbStream();
  const streams: pino.StreamEntry[] = isDev
    ? [
        { stream: pino.transport({ target: 'pino-pretty', options: { colorize: true } }) },
        { level: 'warn', stream: dbStream },
      ]
    : [
        { stream: process.stdout },
        { level: 'warn', stream: dbStream },
      ];

  const logger: FastifyBaseLogger = pino({ level: 'info' }, pino.multistream(streams));

  const app = Fastify({ loggerInstance: logger, maxParamLength: 2048, trustProxy: true });

  startLogCleanup();
  startLogAlerts();
  startJobs();
  startLicenseHeartbeat(app.log);
  startWorkers(app.log);

  // Reset any stale 'online' DB statuses from a previous abrupt shutdown.
  // The connections map is always empty at boot, so these are guaranteed stale.
  await resetOnlineStatuses();

  await registerPlugins(app);

  // ── Kiosk / Kitchen display SPA ───────────────────────────────────────────
  // Serve the DS production build so the TV player can load kiosk/kitchen pages
  // directly from port 3000 (already open in Windows Firewall via the CMS connection)
  // without needing a separate port 5174.
  if (existsSync(dsDist)) {
    await app.register(fastifyStatic, {
      root: dsDist,
      serve: false,           // manual routes only — avoids conflicts with API
      decorateReply: true,
    });

    const serveSpa = (_: FastifyRequest, reply: FastifyReply) => reply.sendFile('index.html');
    app.get('/kiosk/*',   serveSpa);
    app.get('/kitchen/*', serveSpa);

    // JS / CSS bundles referenced by the SPA
    app.get('/assets/*', (req: FastifyRequest, reply: FastifyReply) =>
      reply.sendFile('assets/' + (req.params as { '*': string })['*']));

    app.get('/favicon.svg', (_: FastifyRequest, reply: FastifyReply) =>
      reply.sendFile('favicon.svg'));
  } else {
    app.log.warn(`DS dist not found at ${dsDist} — kiosk/kitchen display URLs will not work. Run: pnpm --filter @signage/ds build`);
  }

  await app.register(registerRoutes, { prefix: '/api/v1' });

  // Safety-net: redirect /api/* → /api/v1/* for any DS build that still calls /api.
  // Guards against infinite-redirect loops: paths already starting with v1/ return 404.
  app.all('/api/*', async (req, reply) => {
    const tail = (req.params as Record<string, string>)['*'];
    if (!tail || tail.startsWith('v1/') || tail === 'v1') {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found' });
    }
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return reply.redirect(`/api/v1/${tail}${qs}`, 307);
  });

  // Graceful shutdown — close BullMQ workers and queues so jobs aren't
  // silently lost on SIGTERM (systemd restart). Idempotent.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`[shutdown] ${signal} received — closing workers/queues`);
    try { await stopWorkers(); } catch (err) { app.log.error(err, '[shutdown] stopWorkers failed'); }
    try { await closeQueues(); } catch (err) { app.log.error(err, '[shutdown] closeQueues failed'); }
    try { await app.close(); } catch (err) { app.log.error(err, '[shutdown] app.close failed'); }
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    warmupOllama(); // pre-load model into RAM so first chat request is instant
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
