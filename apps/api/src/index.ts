import Fastify, { type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { registerPlugins } from './plugins/index.js';
import { registerRoutes } from './routes/index.js';
import { startLogCleanup } from './services/log-cleanup.js';
import { startJobs } from './services/jobs.js';
import { createPinoDbStream } from './services/pino-db-stream.js';

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
  await app.register(registerRoutes, { prefix: '/api/v1' });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
