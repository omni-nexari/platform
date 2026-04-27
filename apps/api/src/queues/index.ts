/**
 * BullMQ queue factory.
 *
 * Phase 1 scaffolding only — defines queue names and the helpers needed to
 * obtain a queue / connection. No queues are actually used yet; later phases
 * (media processing, webhook delivery, recurring jobs) will enqueue jobs and
 * wire the corresponding workers.
 *
 * Design notes:
 * - BullMQ requires its connection to have `maxRetriesPerRequest: null`
 *   (otherwise blocking commands like BRPOPLPUSH used by workers will throw).
 *   The shared `getRedis()` client uses `maxRetriesPerRequest: 0`, so we
 *   maintain a separate dedicated ioredis connection for BullMQ.
 * - All queue access is gated on `REDIS_URL` being set. When Redis is not
 *   configured, `getQueue()` returns null and callers must fall back to the
 *   inline / setInterval code paths.
 */

import IORedis, { type Redis } from 'ioredis';
import { Queue, type ConnectionOptions, type QueueOptions } from 'bullmq';

export const QUEUE_NAMES = {
  mediaProcessing: 'media-processing',
  webhookDelivery: 'webhook-delivery',
  recurring: 'recurring',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let _bullConnection: Redis | null = null;

/**
 * Returns a dedicated ioredis connection configured for BullMQ, or null if
 * `REDIS_URL` is not set. Reused across queues and workers to avoid opening
 * a new TCP connection per queue.
 */
export function getBullConnection(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (!url) return null;
  if (!_bullConnection) {
    _bullConnection = new IORedis(url, {
      // BullMQ requirement — blocking commands cannot have a retry cap
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    _bullConnection.on('error', (err: Error) => {
      console.error('[bullmq] Redis connection error:', err.message);
    });
  }
  return _bullConnection;
}

const _queues = new Map<QueueName, Queue>();

/**
 * Lazily instantiate (and cache) a BullMQ queue. Returns null if Redis is
 * not configured — callers must handle that path explicitly.
 */
export function getQueue<TData = unknown, TResult = unknown>(name: QueueName): Queue<TData, TResult> | null {
  const conn = getBullConnection();
  if (!conn) return null;
  let q = _queues.get(name);
  if (!q) {
    const opts: QueueOptions = {
      connection: conn as unknown as ConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    };
    q = new Queue(name, opts);
    _queues.set(name, q);
  }
  return q as Queue<TData, TResult>;
}

/**
 * Close all open queues and the shared BullMQ Redis connection.
 * Wired into the API graceful shutdown path.
 */
export async function closeQueues(): Promise<void> {
  for (const q of _queues.values()) {
    try { await q.close(); } catch { /* non-fatal */ }
  }
  _queues.clear();
  if (_bullConnection) {
    try { await _bullConnection.quit(); } catch { /* non-fatal */ }
    _bullConnection = null;
  }
}
