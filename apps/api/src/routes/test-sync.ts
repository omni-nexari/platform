import type { FastifyInstance } from 'fastify';
import { getRedis } from '../services/redis.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const PEER_TTL_S    = 15;   // peer registration expiry (keep-alive is 5s, so 15s = 3 missed)
const LOG_CAP       = 500;  // max log entries per device kept in Redis
const LOG_TTL_S     = 3600; // 1h expiry on log lists
const SIGNAL_TTL_S  = 60;   // SDP/ICE signal queue expiry

const PEER_KEY  = (groupId: string) => `tsync:peers:${groupId}`;
const LOG_KEY   = (deviceId: string) => `tsync:logs:${deviceId}`;
const SIG_KEY   = (deviceId: string) => `tsync:signals:${deviceId}`;

// ── Helper ─────────────────────────────────────────────────────────────────────
function redisOrError(reply: any) {
  const r = getRedis();
  if (!r) { reply.status(503).send({ error: 'Redis unavailable' }); return null; }
  return r;
}

// ── Route plugin ───────────────────────────────────────────────────────────────
export async function testSyncRoutes(app: FastifyInstance) {

  /**
   * POST /test-sync/register
   * Body: { deviceId: string, role: 'sbb'|'qbc', ip: string }
   * Stores peer info in a Redis hash keyed by groupId (default 'synctest-001').
   */
  app.post('/register', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { deviceId, role, ip, groupId = 'synctest-001', sessionId } = req.body as {
      deviceId: string; role: string; ip: string; groupId?: string; sessionId?: string;
    };
    if (!deviceId || !role || !ip) {
      return reply.status(400).send({ error: 'deviceId, role, ip required' });
    }

    const key = PEER_KEY(groupId);
    const previousRaw = await redis.hget(key, deviceId);
    let previousSessionId = '';
    if (previousRaw) {
      try { previousSessionId = JSON.parse(previousRaw)?.sessionId ?? ''; } catch {}
    }
    if (sessionId && previousRaw && previousSessionId !== sessionId) {
      await redis.del(SIG_KEY(deviceId));
    }
    await redis.hset(key, deviceId, JSON.stringify({ deviceId, role, ip, sessionId: sessionId ?? null, registeredAt: Date.now() }));
    await redis.expire(key, PEER_TTL_S);
    return reply.send({ ok: true, serverTimeMs: Date.now() });
  });

  /**
   * GET /test-sync/peers?groupId=synctest-001
   * Returns all registered peers for a group.
   */
  app.get('/peers', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { groupId = 'synctest-001' } = req.query as { groupId?: string };
    const raw = await redis.hgetall(PEER_KEY(groupId));
    if (!raw) return reply.send({ peers: [], serverTimeMs: Date.now() });

    const now = Date.now();
    const peers = Object.values(raw)
      .map((v) => { try { return JSON.parse(v); } catch { return null; } })
      .filter((p) => p && (now - p.registeredAt) < PEER_TTL_S * 1000);

    return reply.send({ peers, serverTimeMs: Date.now() });
  });

  /**
   * POST /test-sync/signal/:targetDeviceId
   * Body: { from: string, seq: number, body: object }
   * Pushes a WebRTC SDP/ICE candidate to the target device's queue.
   */
  app.post('/signal/:targetDeviceId', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { targetDeviceId } = req.params as { targetDeviceId: string };
    const { from, seq = 0, sessionId, body } = req.body as { from: string; seq?: number; sessionId?: string; body: unknown };
    if (!from || !body) return reply.status(400).send({ error: 'from, body required' });

    const key = SIG_KEY(targetDeviceId);
    const entry = JSON.stringify({ from, seq, sessionId: sessionId ?? null, body, at: Date.now() });
    await redis.rpush(key, entry);
    await redis.expire(key, SIGNAL_TTL_S);
    // Cap queue to 100 entries (ice candidate storm guard)
    await redis.ltrim(key, -100, -1);
    return reply.send({ ok: true, serverTimeMs: Date.now() });
  });

  /**
   * GET /test-sync/signals/:deviceId?since=N
   * Returns all signals in queue at index > since (0-based).
   * Drain pattern: client passes last received index; server returns newer entries.
   */
  app.get('/signals/:deviceId', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { deviceId } = req.params as { deviceId: string };
    const { since = '0' } = req.query as { since?: string };
    const fromIdx = Math.max(0, parseInt(since, 10));

    const key = SIG_KEY(deviceId);
    const raw = await redis.lrange(key, fromIdx, -1);
    const entries = raw
      .map((v, i) => { try { return { idx: fromIdx + i, ...JSON.parse(v) }; } catch { return null; } })
      .filter(Boolean);

    return reply.send({ entries, nextSince: fromIdx + raw.length, serverTimeMs: Date.now() });
  });

  /**
   * POST /test-sync/log
   * Body: { deviceId, level, msg, ts?, engineMode?, driftMs?, ntpOffsetMs? }
   * Stores log entry in a Redis list (capped at LOG_CAP).
   */
  app.post('/log', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { deviceId, level = 'info', msg, ts, engineMode, driftMs, ntpOffsetMs } = req.body as {
      deviceId: string; level?: string; msg: string; ts?: number;
      engineMode?: string; driftMs?: number; ntpOffsetMs?: number;
    };
    if (!deviceId || !msg) return reply.status(400).send({ error: 'deviceId, msg required' });

    const entry = JSON.stringify({
      deviceId, level, msg,
      ts: ts ?? Date.now(),
      engineMode: engineMode ?? null,
      driftMs: driftMs ?? null,
      ntpOffsetMs: ntpOffsetMs ?? null,
    });

    const key = LOG_KEY(deviceId);
    await redis.rpush(key, entry);
    await redis.ltrim(key, -LOG_CAP, -1); // keep newest LOG_CAP entries
    await redis.expire(key, LOG_TTL_S);
    return reply.send({ ok: true });
  });

  /**
   * GET /test-sync/logs?deviceId=X&limit=200
   * Returns recent log entries for a device.
   */
  app.get('/logs', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { deviceId, limit = '200' } = req.query as { deviceId?: string; limit?: string };
    if (!deviceId) return reply.status(400).send({ error: 'deviceId required' });

    const n = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
    const key = LOG_KEY(deviceId);
    const raw = await redis.lrange(key, -n, -1);
    const entries = raw
      .map((v) => { try { return JSON.parse(v); } catch { return null; } })
      .filter(Boolean);

    return reply.send({ deviceId, entries });
  });

  /**
   * DELETE /test-sync/logs?deviceId=X
   * Clears the log list for a device (useful for fresh test runs).
   */
  app.delete('/logs', async (req, reply) => {
    const redis = redisOrError(reply);
    if (!redis) return;

    const { deviceId } = req.query as { deviceId?: string };
    if (!deviceId) return reply.status(400).send({ error: 'deviceId required' });

    await redis.del(LOG_KEY(deviceId));
    return reply.status(204).send();
  });
}
