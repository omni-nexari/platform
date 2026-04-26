import Fastify, { type FastifyBaseLogger, type FastifyRequest, type FastifyReply } from 'fastify';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import fastifyStatic from '@fastify/static';
import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { startLogCleanup } from './services/log-cleanup.js';
import { startJobs } from './services/jobs.js';
import { createPinoDbStream } from './services/pino-db-stream.js';

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

  const app = Fastify({ loggerInstance: logger });

  startLogCleanup();
  startJobs();

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

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
