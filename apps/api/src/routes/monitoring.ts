import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';

const execAsync = promisify(exec);

const MONITORING_BASE_URL = process.env['MONITORING_BASE_URL'] ?? 'http://192.168.1.17:8080';
const MONITORING_USERNAME = process.env['MONITORING_USERNAME'] ?? '';
const MONITORING_PASSWORD = process.env['MONITORING_PASSWORD'] ?? '';
const CROWDSEC_BASE_URL = process.env['CROWDSEC_BASE_URL'] ?? 'http://127.0.0.1:8090';
const CROWDSEC_API_KEY = process.env['CROWDSEC_API_KEY'] ?? '';
const MQTT_HOST = process.env['MQTT_HOST'] ?? '127.0.0.1';
const MQTT_PORT = process.env['MQTT_PORT'] ?? '1883';
const MQTT_USERNAME = process.env['MQTT_USERNAME'] ?? '';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? '';

function monitoringBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${MONITORING_USERNAME}:${MONITORING_PASSWORD}`).toString('base64')}`;
}

async function monitoringFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, MONITORING_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: monitoringBasicAuthHeader() },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Monitoring fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

async function crowdsecFetch<T>(path: string): Promise<T> {
  const url = `${CROWDSEC_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': CROWDSEC_API_KEY },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`CrowdSec fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function monitoringRoutes(app: FastifyInstance) {
  // ── GET /monitoring/netdata ─────────────────────────────────────────────────
  // Proxies Netdata /api/v1/data with chart, after, points query params
  app.get(
    '/netdata',
    { onRequest: [app.authenticatePlatformOwner] },
    async (req, reply) => {
      const { chart, after, points, format } = req.query as Record<string, string | undefined>;
      if (!chart) return reply.status(400).send({ error: 'chart param required' });

      const params: Record<string, string> = { chart };
      if (after !== undefined) params['after'] = after;
      if (points !== undefined) params['points'] = points;
      if (format !== undefined) params['format'] = format;

      try {
        const data = await monitoringFetch<unknown>('/api/v1/data', params);
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitoring unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/netdata/alarms ──────────────────────────────────────────
  app.get(
    '/netdata/alarms',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const data = await monitoringFetch<unknown>('/api/v1/alarms');
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitoring unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/traffic ─────────────────────────────────────────────────
  // Proxies GoAccess /traffic/report.json
  app.get(
    '/traffic',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const data = await monitoringFetch<unknown>('/traffic/report.json');
        return reply.send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitoring unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/ssl-status ──────────────────────────────────────────────
  app.get(
    '/ssl-status',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const url = new URL('/ssl-status', MONITORING_BASE_URL);
        const res = await fetch(url.toString(), {
          headers: { Authorization: monitoringBasicAuthHeader() },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const text = (await res.text()).trim();
        const daysRemaining = parseInt(text, 10);
        return reply.send({ daysRemaining: isNaN(daysRemaining) ? null : daysRemaining });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitoring unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/backup-status ───────────────────────────────────────────
  app.get(
    '/backup-status',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const url = new URL('/backup-status', MONITORING_BASE_URL);
        const res = await fetch(url.toString(), {
          headers: { Authorization: monitoringBasicAuthHeader() },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const raw = (await res.text()).trim();
        // Format: "2026-05-07T10:22:35+08:00 OK 1.9M all-2026-05-07_1022.sql.gz"
        const parts = raw.split(' ');
        const timestamp = parts[0] ?? null;
        const status = parts[1] ?? null;
        const size = parts[2] ?? null;
        const filename = parts[3] ?? null;
        return reply.send({ raw, timestamp, status, size, filename });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Monitoring unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/crowdsec/decisions ──────────────────────────────────────
  app.get(
    '/crowdsec/decisions',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const data = await crowdsecFetch<unknown[]>('/v1/decisions');
        return reply.send(data ?? []);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'CrowdSec unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );

  // ── GET /monitoring/mqtt ────────────────────────────────────────────────────
  // Reads Mosquitto $SYS stats via mosquitto_sub (Netdata has no MQTT module)
  app.get(
    '/mqtt',
    { onRequest: [app.authenticatePlatformOwner] },
    async (_req, reply) => {
      try {
        const topics = [
          '$SYS/broker/clients/connected',
          '$SYS/broker/messages/received',
          '$SYS/broker/messages/sent',
          '$SYS/broker/subscriptions/count',
        ];
        const topicArgs = topics.map((t) => `-t '${t}'`).join(' ');
        const authArgs = MQTT_USERNAME ? `-u '${MQTT_USERNAME}' -P '${MQTT_PASSWORD}'` : '';
        const cmd = `mosquitto_sub -h '${MQTT_HOST}' -p ${MQTT_PORT} ${authArgs} -v ${topicArgs} -C ${topics.length} -W 12`;
        const { stdout } = await execAsync(cmd, { timeout: 14_000 });
        const stats: Record<string, number> = {};
        for (const line of stdout.trim().split('\n')) {
          const space = line.lastIndexOf(' ');
          if (space === -1) continue;
          const topic = line.slice(0, space);
          const val = parseFloat(line.slice(space + 1));
          const key = topic.split('/').pop() ?? topic;
          if (!Number.isNaN(val)) stats[key] = val;
        }
        return reply.send(stats);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'MQTT unavailable';
        return reply.status(502).send({ error: message });
      }
    },
  );
}
